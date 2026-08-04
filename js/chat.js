// =========================================================
// chat.js - ЛОГИКА ЧАТА, АНТИ-СПАМ И E2E ОБМЕН (v3.1)
// =========================================================

window.fetchAndLogIP = async function(userHash) { return; };

let currentRoomId = null;
let currentPeerHash = null;
let currentRoomKey = null;

let currentMessagesCallback = null;
let currentMessagesValueCallback = null;
let currentTtlCallback = null;

let unreadListeners = {};

// Отслеживание непрочитанных сообщений
async function listenUnreadForContact(peerHash) {
    if (!mySession || !mySession.u) return;
    const hashes = [mySession.u, peerHash].sort();
    const roomId = await sha256(hashes[0] + "_" + hashes[1]);
    
    if (unreadListeners[peerHash]) {
        db.ref(`rooms/${unreadListeners[peerHash]}/messages`).off();
    }
    unreadListeners[peerHash] = roomId;

    const readKey = `ghost_read_${roomId}`;
    
    // 🔒 ЛИМИТ: Запрашиваем только самое последнее сообщение для счетчика
    db.ref(`rooms/${roomId}/messages`).limitToLast(1).on('child_added', (snap) => {
        const msg = snap.val();
        if (!msg || !msg.t) return;

        const lastReadTimestamp = Number(localStorage.getItem(readKey) || 0);
        const isFromPeer = msg.s === peerHash;
        const isCurrentActiveRoom = (currentRoomId === roomId);

        if (isCurrentActiveRoom) {
            localStorage.setItem(readKey, Date.now());
            const contactItem = document.getElementById(`contact-${peerHash}`);
            if (contactItem) contactItem.classList.remove('has-unread');
            return;
        }

        if (isFromPeer && msg.t > lastReadTimestamp) {
            const contactItem = document.getElementById(`contact-${peerHash}`);
            if (contactItem) contactItem.classList.add('has-unread');
        }
    });
}

// Инициализация рабочего стола чата
async function initDashboard() {
    if (!mySession) return;
    document.getElementById('my-name-display').textContent = mySession.name;

    // Онлайн текущего юзера
    const presenceRef = db.ref(`presence/${mySession.u}`);
    presenceRef.set(true);
    presenceRef.onDisconnect().remove();

    renderContactsList();
}

// Отрисовка списка контактов
function renderContactsList() {
    if (!mySession) return;
    db.ref(`users/${mySession.u}/contacts`).on('value', async (snap) => {
        const container = document.getElementById('contacts-container');
        if (!container) return;
        container.innerHTML = '';

        if (!snap.exists()) {
            container.innerHTML = '<div style="padding: 15px; text-align: center; color: var(--text-secondary); font-size: 0.85em;">Нет сохраненных контактов</div>';
            return;
        }

        const contactsHashes = Object.keys(snap.val());

        for (const peerHash of contactsHashes) {
            const userSnap = await db.ref(`users/${peerHash}`).once('value');
            if (!userSnap.exists()) continue;

            const userData = userSnap.val();
            const peerName = decodeBase64(userData.n);

            const div = document.createElement('div');
            div.className = 'contact-item';
            div.id = `contact-${peerHash}`;
            div.innerHTML = `
                <div class="status-indicator gray" id="status-${peerHash}"></div>
                <div style="flex-grow: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    <strong>${escapeHTML(peerName)}</strong>
                </div>
            `;

            div.onclick = () => openChat(peerHash, peerName, userData.pk);
            container.appendChild(div);

            // Слушаем онлайн контакта
            db.ref(`presence/${peerHash}`).on('value', pSnap => {
                const ind = document.getElementById(`status-${peerHash}`);
                if (ind) {
                    ind.className = `status-indicator ${pSnap.val() === true ? 'green' : 'gray'}`;
                }
            });

            // Подписка на непрочитанные
            listenUnreadForContact(peerHash);
        }
    });
}

// Открытие чата с E2E ключом
async function openChat(peerHash, peerName, peerPubJwk) {
    if (!mySession) return;

    // Отключаем старые слушатели перед входом в новую комнату
    if (currentRoomId) {
        if (currentMessagesCallback) db.ref(`rooms/${currentRoomId}/messages`).off('child_added', currentMessagesCallback);
        if (currentMessagesValueCallback) db.ref(`rooms/${currentRoomId}/messages`).off('value', currentMessagesValueCallback);
        if (currentTtlCallback) db.ref(`rooms/${currentRoomId}/ttl`).off('value', currentTtlCallback);
    }

    currentPeerHash = peerHash;
    const hashes = [mySession.u, peerHash].sort();
    currentRoomId = await sha256(hashes[0] + "_" + hashes[1]);

    // Генерация общего AES ключа через ECDH
    try {
        const myPrivKey = await crypto.subtle.importKey(
            "jwk", mySession.priv, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]
        );
        const peerPubKey = await importPublicKey(peerPubJwk);
        currentRoomKey = await deriveKey(myPrivKey, peerPubKey);
    } catch (e) {
        console.error("Ошибка согласования E2E ключа:", e);
        alert("Не удалось установить защищенное соединение с контактом!");
        return;
    }

    document.getElementById('chat-header-name').textContent = peerName;
    document.getElementById('crypto-badge').style.display = 'block';
    document.getElementById('chat-ttl-select').style.display = 'block';
    document.getElementById('btn-clear-chat').style.display = 'block';
    document.getElementById('chat-input-area').style.display = 'flex';

    const msgContainer = document.getElementById('messages-container');
    msgContainer.innerHTML = '';

    // Сохраняем отметку о прочтении
    localStorage.setItem(`ghost_read_${currentRoomId}`, Date.now());
    const contactItem = document.getElementById(`contact-${peerHash}`);
    if (contactItem) contactItem.classList.remove('has-unread');

    // 🔒 АНТИ-СПАМ ЛИМИТ: Загружаем СТРОГО последние 50 сообщений
    currentMessagesCallback = db.ref(`rooms/${currentRoomId}/messages`).limitToLast(50).on('child_added', async (snap) => {
        const msg = snap.val();
        if (!msg || !msg.d) return;

        let decryptedText = "[Ошибка расшифровки]";
        try {
            decryptedText = await decryptMessage(currentRoomKey, msg.d);
        } catch (e) {
            decryptedText = "[Поврежденный пакет]";
        }

        const isMine = msg.s === mySession.u;
        const msgDiv = document.createElement('div');
        msgDiv.className = `msg ${isMine ? 'mine' : 'peer'}`;
        msgDiv.innerHTML = `
            <div>${decryptedText}</div>
            <div style="font-size: 0.65em; opacity: 0.6; text-align: right; margin-top: 4px;">${formatTime(msg.t)}</div>
        `;
        msgContainer.appendChild(msgDiv);
        msgContainer.scrollTop = msgContainer.scrollHeight;
    });

    // Обработка TTL
    currentTtlCallback = db.ref(`rooms/${currentRoomId}/ttl`).on('value', snap => {
        const ttlVal = snap.val() || 0;
        document.getElementById('chat-ttl-select').value = String(ttlVal);
    });
}

// Отправка зашифрованного сообщения
async function sendMessage() {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text || !currentRoomId || !currentRoomKey) return;

    input.value = '';

    try {
        const encryptedText = await encryptMessage(currentRoomKey, text);
        
        await db.ref(`rooms/${currentRoomId}/messages`).push({
            s: mySession.u,
            d: encryptedText,
            t: Date.now()
        });
    } catch (e) {
        alert("Ошибка отправки: Возможно, превышен лимит длины сообщения или включен Kill Switch.");
        console.error("SendMessage error:", e);
    }
}

document.getElementById('btn-send-message').onclick = sendMessage;
document.getElementById('message-input').onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
};

// Смена TTL для комнаты
document.getElementById('chat-ttl-select').onchange = (e) => {
    if (!currentRoomId) return;
    db.ref(`rooms/${currentRoomId}/ttl`).set(Number(e.target.value));
};

// Добавление контакта по ID
document.getElementById('btn-add-contact').onclick = async () => {
    const input = document.getElementById('add-contact-hash');
    const peerHash = input.value.trim();
    if (!peerHash) return;

    if (peerHash === mySession.u) {
        return alert("Нельзя добавить самого себя в контакты!");
    }

    try {
        const snap = await db.ref(`users/${peerHash}`).once('value');
        if (!snap.exists()) {
            return alert("Пользователь с таким ID не найден в сети!");
        }

        await db.ref(`users/${mySession.u}/contacts/${peerHash}`).set(Date.now());
        input.value = '';
        alert("Контакт успешно добавлен!");
    } catch (e) {
        alert("Ошибка добавления контакта: Превышен лимит контактов или база заморожена.");
    }
};

// Стирание чата
document.getElementById('btn-clear-chat').onclick = async () => {
    if (!currentRoomId) return;
    if (confirm("Вы действительно хотите полностью очистить историю этого чата для обоих участников?")) {
        await db.ref(`rooms/${currentRoomId}/messages`).remove();
        document.getElementById('messages-container').innerHTML = '';
    }
};
