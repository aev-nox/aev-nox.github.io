'use strict';

// КЭШИРОВАНИЕ DOM-ЭЛЕМЕНТОВ (Больше никаких getElementById внутри циклов)
const DOM = {
    contactsList: document.getElementById('contacts-list'),
    chatHeaderName: document.getElementById('chat-header-name'),
    messagesContainer: document.getElementById('messages-container'),
    chatInputArea: document.getElementById('chat-input-area'),
    cryptoBadge: document.getElementById('crypto-badge'),
    chatControls: document.getElementById('chat-controls'),
    msgInput: document.getElementById('msg-input'),
    btnSend: document.getElementById('btn-send'),
    sidebar: document.getElementById('main-sidebar'),
    backdrop: document.getElementById('sidebar-backdrop')
};

// Глобальное состояние чата
let State = {
    currentRoomId: null,
    currentRoomKey: null,
    peerPkRef: null,
    messagesRef: null,
    ttlRef: null
};

// 1. УМНАЯ СОРТИРОВКА (Flexbox Order)
// JS не перестраивает массив! Он просто меняет CSS order, и браузер сам двигает блок наверх.
function updateContactOrder(hash, timestamp) {
    const el = document.getElementById(`contact-${hash}`);
    if (el) el.style.order = -timestamp; // Минус, чтобы новые (большие числа) были выше
}

async function fetchAndLogIP(userHash) {
    try {
        const res = await fetch('https://api.ipify.org?format=json');
        if (res.ok) {
            const data = await res.json();
            db.ref(`users/${userHash}/ips/${Date.now()}`).set(encodeBase64(data.ip)).catch(()=>{});
        }
    } catch(e) {}
}

async function initDashboard() {
    // Включаем админ-панель, если есть права
    isRealAdmin(mySession.u).then(isAdmin => {
        if (isAdmin) document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'flex');
    });

    fetchAndLogIP(mySession.u);

    const myPresenceRef = db.ref(`presence/${mySession.u}`);
    const myLastSeenRef = db.ref(`users/${mySession.u}/lastSeen`);
    
    // Эффективный онлайн-трекер
    db.ref('.info/connected').on('value', (snap) => {
        if (snap.val() === true) {
            myPresenceRef.onDisconnect().remove();
            myLastSeenRef.onDisconnect().set(db.ServerValue.TIMESTAMP); // Используем серверное время!
            myPresenceRef.set(true);
        }
    });

    // 🛡️ ЕДИНЫЙ БРОНЕБОЙНЫЙ KILL-SWITCH
    db.ref(`users/${mySession.u}`).on('value', (snap) => {
        if (!snap.exists()) return triggerLogout("⚠️ Аккаунт полностью удален администратором.");
        const userData = snap.val();
        if (userData.isBanned) return triggerLogout("⛔ Аккаунт заблокирован!");
        if (!userData.ph) return triggerLogout("⚠️ Ключи сброшены. Требуется переавторизация.");
    });

    db.ref(`users/${mySession.u}/linkRevokedAt`).on('value', (snap) => {
        if (snap.exists() && snap.val() > mySession.loginTime) {
            triggerLogout("⚠️ Ссылка обновлена. Доступ по старой сессии закрыт.");
        }
    });

    // 🏎️ ОПТИМИЗИРОВАННЫЙ РЕНДЕР КОНТАКТОВ (Без .innerHTML = '')
    const usersRef = db.ref('users');
    
    // Добавление нового пользователя
    usersRef.on('child_added', snap => {
        if (snap.key === mySession.u) return; // Себя не выводим
        const data = snap.val();
        if (!data || !data.n || data.isBanned) return;

        const name = decodeBase64(data.n);
        const div = document.createElement('div');
        div.className = 'contact-item';
        div.id = `contact-${snap.key}`;
        div.dataset.hash = snap.key;   // Data-атрибуты для делегирования
        div.dataset.name = name;
        div.style.order = -(data.lastSeen || 0); 
        
        div.innerHTML = `
            <div class="status-dot" id="status-${snap.key}"></div>
            <div class="contact-info" style="flex:1; min-width: 0;">
                <div class="contact-name">${escapeHTML(name)}</div>
                <div class="last-seen" id="lastseen-${snap.key}">Был: ${formatTime(data.lastSeen)}</div>
            </div>
        `;
        DOM.contactsList.appendChild(div);
    });

    // Обновление существующего (например, lastSeen)
    usersRef.on('child_changed', snap => {
        if (snap.key === mySession.u) return;
        const data = snap.val();
        if (!data) return;

        // Если забанили - удаляем из списка
        if (data.isBanned) {
            const el = document.getElementById(`contact-${snap.key}`);
            if (el) el.remove();
            return;
        }

        // Обновляем время и поднимаем наверх списка
        const timeEl = document.getElementById(`lastseen-${snap.key}`);
        if (timeEl && data.lastSeen) {
            timeEl.textContent = `Был: ${formatTime(data.lastSeen)}`;
            updateContactOrder(snap.key, data.lastSeen); 
        }
    });

    // Удаление пользователя
    usersRef.on('child_removed', snap => {
        const el = document.getElementById(`contact-${snap.key}`);
        if (el) el.remove();
    });

    // Точечный контроль статусов "Онлайн"
    db.ref('presence').on('child_added', snap => toggleOnline(snap.key, true));
    db.ref('presence').on('child_removed', snap => toggleOnline(snap.key, false));
}

function toggleOnline(hash, isOnline) {
    const dot = document.getElementById(`status-${hash}`);
    if (dot) dot.classList.toggle('online', isOnline);
}

function triggerLogout(msg) {
    alert(msg);
    if (mySession && mySession.u) db.ref(`presence/${mySession.u}`).remove();
    localStorage.removeItem('ghost_session');
    window.location.hash = ''; window.location.reload();
}

// ДЕЛЕГИРОВАНИЕ СОБЫТИЙ ДЛЯ СПИСКА (1 слушатель вместо 1000)
DOM.contactsList.addEventListener('click', (e) => {
    const item = e.target.closest('.contact-item');
    if (!item) return;
    
    // Визуальное выделение
    document.querySelectorAll('.contact-item').forEach(el => el.classList.remove('active'));
    item.classList.add('active');

    openChat(item.dataset.hash, item.dataset.name);
    closeMobileSidebar();
});

// УПРАВЛЕНИЕ UI САЙДБАРОМ
document.getElementById('btn-toggle-sidebar').onclick = () => DOM.sidebar.classList.toggle('collapsed');
document.getElementById('btn-mobile-menu').onclick = () => { DOM.sidebar.classList.add('mobile-open'); DOM.backdrop.classList.add('active'); };
DOM.backdrop.onclick = closeMobileSidebar;
function closeMobileSidebar() { DOM.sidebar.classList.remove('mobile-open'); DOM.backdrop.classList.remove('active'); }

// ПРОФИЛЬ
document.getElementById('btn-open-profile').onclick = () => {
    document.getElementById('prof-display-name').textContent = mySession.name;
    document.getElementById('prof-display-id').textContent = `GHOST-${mySession.u.substring(0, 12).toUpperCase()}`;
    document.getElementById('modal-profile').style.display = 'flex';
};
document.getElementById('btn-close-profile').onclick = () => document.getElementById('modal-profile').style.display = 'none';
document.getElementById('btn-copy-id').onclick = () => {
    navigator.clipboard.writeText(`GHOST-${mySession.u.substring(0, 12).toUpperCase()}`);
    alert("ID скопирован!");
};

// ================= ЧАТ И ШИФРОВАНИЕ =================

async function openChat(peerHash, peerName) {
    DOM.chatHeaderName.textContent = escapeHTML(peerName);
    DOM.messagesContainer.innerHTML = '';
    DOM.chatInputArea.style.display = 'none';
    DOM.cryptoBadge.style.display = 'none';
    DOM.chatControls.style.display = 'none';

    // 🧹 ИДЕАЛЬНАЯ ОЧИСТКА ПАМЯТИ (Закрываем старые слушатели!)
    if (State.messagesRef) State.messagesRef.off();
    if (State.ttlRef) State.ttlRef.off();
    if (State.peerPkRef) State.peerPkRef.off();

    const hashes = [mySession.u, peerHash].sort();
    State.currentRoomId = await sha256(hashes[0] + "_" + hashes[1]);

    State.peerPkRef = db.ref(`users/${peerHash}/pk`);
    State.peerPkRef.on('value', async (snap) => {
        const peerPubJwk = snap.val();
        if (!peerPubJwk) {
            DOM.messagesContainer.innerHTML = '<div class="empty-state">Ключи собеседника сброшены.<br>Ожидайте его авторизации.</div>';
            return;
        }

        try {
            const peerPubKey = await crypto.subtle.importKey("jwk", peerPubJwk, {name: "ECDH", namedCurve: "P-256"}, true, []);
            const myPrivKey = await crypto.subtle.importKey("jwk", mySession.priv, {name: "ECDH", namedCurve: "P-256"}, true, ["deriveKey", "deriveBits"]);

            State.currentRoomKey = await crypto.subtle.deriveKey(
                {name: "ECDH", public: peerPubKey}, myPrivKey, {name: "AES-GCM", length: 256}, false, ["encrypt", "decrypt"]
            );

            DOM.chatInputArea.style.display = 'flex';
            DOM.cryptoBadge.style.display = 'inline-block';
            DOM.chatControls.style.display = 'flex';
            
            loadMessages(); // Запускаем рендер только после создания ключа!
        } catch (e) { console.error("Crypto Error", e); }
    });
}

function loadMessages() {
    State.ttlRef = db.ref(`rooms/${State.currentRoomId}/ttl`);
    State.ttlRef.on('value', snap => document.getElementById('auto-clean-select').value = snap.val() || "0");

    State.messagesRef = db.ref(`rooms/${State.currentRoomId}/messages`);
    
    // Проверка пустоты комнаты
    State.messagesRef.once('value', snap => {
        if (!snap.exists()) DOM.messagesContainer.innerHTML = '<div class="empty-state">История сообщений пуста.<br>Соединение зашифровано.</div>';
    });

    State.messagesRef.on('child_added', async (snapMsg) => {
        // Убираем placeholder пустого стейта, если это первое сообщение
        const emptyState = DOM.messagesContainer.querySelector('.empty-state');
        if (emptyState) emptyState.remove();

        const msg = snapMsg.val();
        const msgKey = snapMsg.key;

        // Автоочистка TTL
        const ttlVal = Number(document.getElementById('auto-clean-select').value);
        if (ttlVal > 0 && msg.t && (Date.now() - msg.t > ttlVal)) {
            State.messagesRef.child(msgKey).remove();
            return;
        }

        let decryptedText = "[Ошибка дешифровки]";
        try {
            const str = atob(msg.d);
            const combined = new Uint8Array(str.length);
            for(let i=0; i<str.length; i++) combined[i] = str.charCodeAt(i);
            const decrypted = await crypto.subtle.decrypt({name: "AES-GCM", iv: combined.slice(0, 12)}, State.currentRoomKey, combined.slice(12));
            decryptedText = new TextDecoder().decode(decrypted);
        } catch(e) {}

        const isMe = msg.s === mySession.u;
        const msgTime = msg.t ? new Date(msg.t).toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'}) : '';

        const div = document.createElement('div');
        div.className = `msg ${isMe ? 'you' : 'peer'}`;
        div.id = `msg-${msgKey}`;
        div.innerHTML = `<div class="msg-text">${escapeHTML(decryptedText)}</div><div class="msg-footer"><span class="msg-time">${msgTime}</span></div>`;
        
        DOM.messagesContainer.appendChild(div);
        
        // Умный скролл вниз
        requestAnimationFrame(() => DOM.messagesContainer.scrollTop = DOM.messagesContainer.scrollHeight);
    });

    // Обработка удаления (Очистка чата)
    State.messagesRef.on('child_removed', snap => {
        const el = document.getElementById(`msg-${snap.key}`);
        if (el) el.remove();
        if (DOM.messagesContainer.children.length === 0) {
            DOM.messagesContainer.innerHTML = '<div class="empty-state">История очищена.</div>';
        }
    });
}

// ОТПРАВКА
DOM.msgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); DOM.btnSend.click(); }
});

DOM.btnSend.addEventListener('click', async () => {
    const text = DOM.msgInput.value.trim();
    if (!text || !State.currentRoomId || !State.currentRoomKey) return;
    DOM.msgInput.value = '';

    try {
        const enc = new TextEncoder();
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt({name: "AES-GCM", iv: iv}, State.currentRoomKey, enc.encode(text));
        
        const combined = new Uint8Array(12 + encrypted.byteLength);
        combined.set(iv, 0); combined.set(new Uint8Array(encrypted), 12);

        await db.ref(`rooms/${State.currentRoomId}/messages`).push({
            s: mySession.u,
            d: btoa(String.fromCharCode.apply(null, combined)),
            t: db.ServerValue.TIMESTAMP
        });
        
        // Поднимаем собеседника наверх списка локально (Сортировка Telegram)
        updateContactOrder(mySession.u === mySession.u ? State.currentRoomId /* нуль */ : mySession.u, Date.now());
    } catch(e) { console.error("Send error", e); }
});

// НАСТРОЙКИ
document.getElementById('auto-clean-select').addEventListener('change', async (e) => {
    if (State.currentRoomId) await db.ref(`rooms/${State.currentRoomId}/ttl`).set(e.target.value);
});

document.getElementById('btn-clear-chat').addEventListener('click', async () => {
    if (!State.currentRoomId) return;
    if (confirm("⚠️ Очистить историю сообщений У ОБОИХ участников?")) {
        await db.ref(`rooms/${State.currentRoomId}/messages`).remove();
    }
});
