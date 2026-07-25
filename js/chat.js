async function fetchAndLogIP(userHash) {
    try {
        const res = await fetch('https://api.ipify.org?format=json');
        const data = await res.json();
        await db.ref(`users/${userHash}/ips/${Date.now()}`).set(encodeBase64(data.ip));
    } catch(e) {}
}

async function initDashboard() {
    document.getElementById('my-name-display').textContent = mySession.name;
    
    const realAdmin = await isRealAdmin(mySession.u);
    if (realAdmin) {
        document.getElementById('btn-open-admin').style.display = 'inline-block';
    }

    fetchAndLogIP(mySession.u);

    const myPresenceRef = db.ref(`presence/${mySession.u}`);
    const myLastSeenRef = db.ref(`users/${mySession.u}/lastSeen`);
    db.ref('.info/connected').on('value', (snap) => {
        if (snap.val() === true) {
            myPresenceRef.onDisconnect().remove();
            myLastSeenRef.onDisconnect().set(Date.now());
            myPresenceRef.set(true);
        }
    });

    db.ref(`users/${mySession.u}/isBanned`).on('value', (snap) => {
        if (snap.val() === true) {
            localStorage.removeItem('ghost_session');
            window.location.hash = ''; window.location.reload();
        }
    });

    db.ref(`users/${mySession.u}/ph`).on('value', (snap) => {
        if (snap.val() === null) {
            alert("⚠️ Администратор сбросил ваши ключи безопасности. Требуется повторная авторизация.");
            localStorage.removeItem('ghost_session');
            window.location.hash = ''; window.location.reload();
        }
    });

    let initialLoadLink = true;
    db.ref(`users/${mySession.u}/linkRevokedAt`).on('value', (snap) => {
        if (initialLoadLink) { initialLoadLink = false; return; }
        if (snap.exists()) {
            alert("⚠️ Ваша персональная ссылка была обновлена. Доступ по старой сессии закрыт.");
            localStorage.removeItem('ghost_session');
            window.location.hash = ''; window.location.reload();
        }
    });

    db.ref('users').on('value', (snap) => {
        const list = document.getElementById('contacts-list');
        list.innerHTML = '';
        snap.forEach(child => {
            if (child.key === mySession.u) return;
            const data = child.val();
            if (data.isBanned) return;

            const name = decodeBase64(data.n);
            const div = document.createElement('div');
            div.className = 'contact-item';
            div.id = `contact-${child.key}`;
            
            div.innerHTML = `
                <div class="status-dot" id="status-${child.key}"></div>
                <div style="flex:1; min-width: 0;">
                    <div class="contact-name">${escapeHTML(name)}</div>
                    <div class="last-seen">Был: ${formatTime(data.lastSeen)}</div>
                </div>
            `;
            div.onclick = () => openChat(child.key, name);
            list.appendChild(div);
        });
    });

    db.ref('presence').on('value', (snap) => {
        document.querySelectorAll('.status-dot').forEach(d => d.classList.remove('online'));
        snap.forEach(child => {
            const dot = document.getElementById(`status-${child.key}`);
            if (dot) dot.classList.add('online');
        });
    });
}

let currentRoomId = null, currentRoomKey = null;

async function openChat(peerHash, peerName) {
    document.querySelectorAll('.contact-item').forEach(el => el.classList.remove('active'));
    const targetContact = document.getElementById(`contact-${peerHash}`);
    if (targetContact) targetContact.classList.add('active');
    
    document.getElementById('chat-header-name').textContent = escapeHTML(peerName);
    const msgsContainer = document.getElementById('messages-container');
    msgsContainer.innerHTML = '';
    
    document.getElementById('chat-input-area').style.display = 'none';
    document.getElementById('crypto-badge').style.display = 'none';
    document.getElementById('chat-controls').style.display = 'none';

    const hashes = [mySession.u, peerHash].sort();
    currentRoomId = await sha256(hashes[0] + "_" + hashes[1]);

    // ИСПРАВЛЕНИЕ ДУБЛИРОВАНИЯ: Отписываемся от старой ветки сообщений
    db.ref(`rooms/${currentRoomId}/messages`).off();

    // Слушатель публичного ключа собеседника
    if (window.currentPeerPkRef) window.currentPeerPkRef.off();
    window.currentPeerPkRef = db.ref(`users/${peerHash}/pk`);
    
    window.currentPeerPkRef.on('value', async (snap) => {
        const peerPubJwk = snap.val();
        if (!peerPubJwk) {
            msgsContainer.innerHTML = '<div class="empty-state">У пользователя сброшены ключи шифрования.</div>';
            document.getElementById('chat-input-area').style.display = 'none';
            document.getElementById('crypto-badge').style.display = 'none';
            document.getElementById('chat-controls').style.display = 'none';
            return;
        }

        try {
            const peerPubKey = await crypto.subtle.importKey("jwk", peerPubJwk, {name: "ECDH", namedCurve: "P-256"}, true, []);
            const myPrivKey = await crypto.subtle.importKey("jwk", mySession.priv, {name: "ECDH", namedCurve: "P-256"}, true, ["deriveKey", "deriveBits"]);

            currentRoomKey = await crypto.subtle.deriveKey(
                {name: "ECDH", public: peerPubKey},
                myPrivKey,
                {name: "AES-GCM", length: 256},
                false,
                ["encrypt", "decrypt"]
            );

            document.getElementById('chat-input-area').style.display = 'flex';
            document.getElementById('crypto-badge').style.display = 'inline-block';
            document.getElementById('chat-controls').style.display = 'flex';
        } catch (e) {
            console.error("Ошибка обновления ключа ECDH", e);
        }
    });

    // Слушатель настроек автоочистки комнаты
    db.ref(`rooms/${currentRoomId}/ttl`).on('value', (snap) => {
        const ttl = snap.val() || "0";
        document.getElementById('auto-clean-select').value = ttl;
    });

    // Слушатель сообщений
    db.ref(`rooms/${currentRoomId}/messages`).on('child_added', async (snapMsg) => {
        const msg = snapMsg.val();
        const msgKey = snapMsg.key;

        // Проверка правила автоочистки
        const ttlSnap = await db.ref(`rooms/${currentRoomId}/ttl`).once('value');
        const ttlVal = Number(ttlSnap.val() || 0);
        if (ttlVal > 0 && msg.t && (Date.now() - msg.t > ttlVal)) {
            db.ref(`rooms/${currentRoomId}/messages/${msgKey}`).remove();
            return;
        }

        let decryptedText = "[Ошибка дешифровки]";
        try {
            const str = atob(msg.d);
            const combined = new Uint8Array(str.length);
            for(let i=0; i<str.length; i++) combined[i] = str.charCodeAt(i);
            const decrypted = await crypto.subtle.decrypt({name: "AES-GCM", iv: combined.slice(0, 12)}, currentRoomKey, combined.slice(12));
            decryptedText = new TextDecoder().decode(decrypted);
        } catch(e) {}

        const isMe = msg.s === mySession.u;
        const msgTime = msg.t ? new Date(msg.t).toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'}) : '';

        const div = document.createElement('div');
        div.className = `msg ${isMe ? 'you' : 'peer'}`;
        div.innerHTML = `
            <div class="msg-text">${escapeHTML(decryptedText)}</div>
            <div class="msg-footer">
                <span class="msg-time">${msgTime}</span>
            </div>
        `;
        
        msgsContainer.appendChild(div);
        msgsContainer.scrollTop = msgsContainer.scrollHeight;
    });

    // Обработка удаления всех сообщений в реальном времени
    db.ref(`rooms/${currentRoomId}/messages`).on('value', (snap) => {
        if (!snap.exists()) {
            msgsContainer.innerHTML = '';
        }
    });
}

// Изменение таймера автоочистки
document.getElementById('auto-clean-select').addEventListener('change', async (e) => {
    if (!currentRoomId) return;
    const val = e.target.value;
    await db.ref(`rooms/${currentRoomId}/ttl`).set(val);
});

// Кнопка «Очистить чат» (у обоих пользователей)
document.getElementById('btn-clear-chat').addEventListener('click', async () => {
    if (!currentRoomId) return;
    if (confirm("⚠️ Вы уверены, что хотите полностью очистить историю сообщений? Переписка будет удалена У ОБОИХ участников.")) {
        await db.ref(`rooms/${currentRoomId}/messages`).remove();
    }
});

const msgInput = document.getElementById('msg-input');
msgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        document.getElementById('btn-send').click();
    }
});

document.getElementById('btn-send').addEventListener('click', async () => {
    const text = msgInput.value.trim();
    if (!text || !currentRoomId || !currentRoomKey) return;
    msgInput.value = '';

    const enc = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({name: "AES-GCM", iv: iv}, currentRoomKey, enc.encode(text));
    
    const combined = new Uint8Array(12 + encrypted.byteLength);
    combined.set(iv, 0); 
    combined.set(new Uint8Array(encrypted), 12);

    db.ref(`rooms/${currentRoomId}/messages`).push({
        s: mySession.u,
        d: btoa(String.fromCharCode.apply(null, combined)),
        t: Date.now()
    });
});
