window.fetchAndLogIP = async function(userHash) { return; };

let unreadListeners = {};

async function listenUnreadForContact(peerHash) {
    const hashes = [mySession.u, peerHash].sort();
    const roomId = await sha256(hashes[0] + "_" + hashes[1]);
    
    if (unreadListeners[peerHash]) {
        db.ref(`rooms/${unreadListeners[peerHash]}/messages`).off();
    }
    unreadListeners[peerHash] = roomId;
    const readKey = `ghost_read_${roomId}`;
    
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

async function initDashboard() {
    document.getElementById('my-name-display').textContent = mySession.name;
    
    const realAdmin = await isRealAdmin(mySession.u);
    if (realAdmin) document.getElementById('btn-open-admin').style.display = 'inline-block';

    const myPresenceRef = db.ref(`presence/${mySession.u}`);
    const myLastSeenRef = db.ref(`users/${mySession.u}/lastSeen`);
    
    auth.onAuthStateChanged((user) => {
        if (user) {
            db.ref('.info/connected').on('value', (snap) => {
                if (snap.val() === true) {
                    myPresenceRef.onDisconnect().remove();
                    myLastSeenRef.onDisconnect().set(Date.now());
                    myPresenceRef.set(true);
                }
            });
        }
    });

    db.ref(`users/${mySession.u}`).on('value', (snap) => {
        if (!snap.exists()) {
            myPresenceRef.onDisconnect().cancel();
            myLastSeenRef.onDisconnect().cancel();
            myPresenceRef.remove();
            alert("⚠️ Ваш аккаунт был полностью удален администратором.");
            localStorage.removeItem('ghost_session');
            window.location.hash = ''; window.location.reload();
            return;
        }
        const userData = snap.val();
        if (userData.isBanned) {
            alert("⛔ Ваш аккаунт заблокирован!");
            localStorage.removeItem('ghost_session');
            window.location.hash = ''; window.location.reload();
        } else if (!userData.ph) {
            alert("⚠️ Администратор сбросил ваши ключи. Требуется переавторизация.");
            localStorage.removeItem('ghost_session');
            window.location.hash = ''; window.location.reload();
        }
    });

    let initialLoadLink = true;
    db.ref(`users/${mySession.u}/linkRevokedAt`).on('value', (snap) => {
        if (initialLoadLink) { initialLoadLink = false; return; }
        if (snap.exists()) {
            alert("⚠️ Ваша персональная ссылка была обновлена. Доступ закрыт.");
            localStorage.removeItem('ghost_session');
            window.location.hash = ''; window.location.reload();
        }
    });

    let myContactHashes = new Set();
    let allUsersData = {};

    db.ref(`users/${mySession.u}/contacts`).on('value', (snap) => {
        myContactHashes.clear();
        snap.forEach(c => myContactHashes.add(c.key));
        renderContacts();
    });

    db.ref('users').on('value', (snap) => {
        allUsersData = snap.val() || {};
        renderContacts();
    });

    function renderContacts() {
        const list = document.getElementById('contacts-list');
        list.innerHTML = '';
        if (myContactHashes.size === 0) {
            list.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary); font-size: 0.85em;">Нет контактов.<br><br>Используйте поиск выше.</div>';
            return;
        }
        
        myContactHashes.forEach(hash => {
            const data = allUsersData[hash];
            if (!data || !data.n || data.isBanned) return;
            
            const name = decodeBase64(data.n);
            const div = document.createElement('div');
            div.className = 'contact-item';
            div.id = `contact-${hash}`;
            div.innerHTML = `
                <div class="status-dot" id="status-${hash}"></div>
                <div style="flex:1; min-width: 0; display: flex; flex-direction: column;">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
                        <div class="contact-name">${escapeHTML(name)}</div>
                        <div class="unread-badge" id="unread-${hash}" title="Новое сообщение"></div>
                    </div>
                    <div class="last-seen">Был: ${formatTime(data.lastSeen)}</div>
                </div>
                <button class="btn-sm" style="background: transparent; border: 1px solid var(--border-color); color: var(--danger); padding: 4px 8px; font-size: 0.8em;" onclick="event.stopPropagation(); deleteContact('${hash}')">❌</button>
            `;
            div.onclick = () => openChat(hash, name);
            list.appendChild(div);
            listenUnreadForContact(hash);
        });
        db.ref('presence').once('value').then(snap => updatePresenceUI(snap));
    }

    db.ref('presence').on('value', (snap) => updatePresenceUI(snap));

    function updatePresenceUI(snap) {
        document.querySelectorAll('.status-dot').forEach(d => d.classList.remove('online'));
        snap.forEach(child => {
            const dot = document.getElementById(`status-${child.key}`);
            if (dot) dot.classList.add('online');
        });
    }
}

const searchBtn = document.getElementById('btn-search');
if (searchBtn) {
    searchBtn.addEventListener('click', async () => {
        const query = document.getElementById('search-input').value.trim();
        const resDiv = document.getElementById('search-result');
        if (!query) return;
        
        if (query.toLowerCase() === mySession.name.toLowerCase()) {
            resDiv.innerHTML = `<span style="color:var(--text-secondary)">Вы не можете добавить сами себя</span>`;
            return;
        }
        
        resDiv.innerHTML = "Поиск...";
        resDiv.style.color = "var(--text-secondary)";
        
        const snap = await db.ref('users').once('value');
        let foundHash = null, foundName = null;
        
        snap.forEach(child => {
            if (child.key === mySession.u) return;
            const data = child.val();
            if (data && data.n && !data.isBanned) {
                if (decodeBase64(data.n).toLowerCase() === query.toLowerCase()) {
                    foundHash = child.key; foundName = decodeBase64(data.n);
                }
            }
        });
        
        if (foundHash) {
            resDiv.innerHTML = `<span style="color:var(--success)">✅ Найден!</span><br>
                <button class="btn-sm" style="margin-top:8px; background:var(--success); color:#000; font-weight:bold; width: 100%;" onclick="addContact('${foundHash}', '${escapeHTML(foundName)}')">Написать</button>`;
        } else {
            resDiv.innerHTML = `<span style="color:var(--danger)">❌ Не найден</span>`;
        }
    });
}

window.addContact = async function(hash, name) {
    await db.ref(`users/${mySession.u}/contacts/${hash}`).set(Date.now());
    await db.ref(`users/${hash}/contacts/${mySession.u}`).set(Date.now());
    document.getElementById('search-input').value = '';
    document.getElementById('search-result').innerHTML = '';
    openChat(hash, name);
};

let targetUserToDelete = null;

window.deleteContact = function(peerHash) {
    targetUserToDelete = peerHash;
    document.getElementById('cb-delete-contact').checked = true;
    document.getElementById('cb-clear-chat').checked = true;
    document.getElementById('modal-delete-contact').style.display = 'flex';
};

let currentRoomId = null, currentRoomKey = null;
let currentMessagesCallback = null, currentTtlCallback = null, currentMessagesValueCallback = null;

async function openChat(peerHash, peerName) {
    document.querySelector('.dashboard').classList.add('mobile-chat-active');
    document.querySelectorAll('.contact-item').forEach(el => el.classList.remove('active'));
    const targetContact = document.getElementById(`contact-${peerHash}`);
    if (targetContact) {
        targetContact.classList.add('active');
        targetContact.classList.remove('has-unread');
    }
    
    document.getElementById('chat-header-name').textContent = escapeHTML(peerName);
    const msgsContainer = document.getElementById('messages-container');
    msgsContainer.innerHTML = '';
    
    document.getElementById('chat-input-area').style.display = 'none';
    document.getElementById('crypto-badge').style.display = 'none';
    document.getElementById('chat-controls').style.display = 'none';

    if (currentRoomId) {
        if (currentMessagesCallback) db.ref(`rooms/${currentRoomId}/messages`).off('child_added', currentMessagesCallback);
        if (currentMessagesValueCallback) db.ref(`rooms/${currentRoomId}/messages`).off('value', currentMessagesValueCallback);
        if (currentTtlCallback) db.ref(`rooms/${currentRoomId}/ttl`).off('value', currentTtlCallback);
    }

    const hashes = [mySession.u, peerHash].sort();
    currentRoomId = await sha256(hashes[0] + "_" + hashes[1]);
    currentRoomKey = null;
    localStorage.setItem(`ghost_read_${currentRoomId}`, Date.now());

    if (window.currentPeerPkRef) window.currentPeerPkRef.off();
    window.currentPeerPkRef = db.ref(`users/${peerHash}/pk`);
    
    window.currentPeerPkRef.on('value', async (snap) => {
        const peerPubJwk = snap.val();
        if (!peerPubJwk) {
            msgsContainer.innerHTML = '<div class="empty-state">Ожидание ключей шифрования пользователя...</div>';
            return;
        }
        try {
            const peerPubKey = await crypto.subtle.importKey("jwk", peerPubJwk, {name: "ECDH", namedCurve: "P-256"}, true, []);
            const myPrivKey = await crypto.subtle.importKey("jwk", mySession.priv, {name: "ECDH", namedCurve: "P-256"}, true, ["deriveKey", "deriveBits"]);
            currentRoomKey = await crypto.subtle.deriveKey(
                {name: "ECDH", public: peerPubKey}, myPrivKey,
                {name: "AES-GCM", length: 256}, false, ["encrypt", "decrypt"]
            );
            msgsContainer.innerHTML = ''; // Убираем сообщение "Ожидание ключей"
            document.getElementById('chat-input-area').style.display = 'flex';
            document.getElementById('crypto-badge').style.display = 'inline-block';
            document.getElementById('chat-controls').style.display = 'flex';
        } catch (e) {
            console.error("Ошибка ключа ECDH:", e);
        }
    });

    currentTtlCallback = db.ref(`rooms/${currentRoomId}/ttl`).on('value', (snap) => {
        document.getElementById('auto-clean-select').value = snap.val() || "0";
    });

    currentMessagesCallback = db.ref(`rooms/${currentRoomId}/messages`).on('child_added', async (snapMsg) => {
        const msg = snapMsg.val();
        const msgKey = snapMsg.key;
        const msgRoomId = currentRoomId; 

        if (msg && msg.t) {
            localStorage.setItem(`ghost_read_${msgRoomId}`, msg.t);
            if (targetContact) targetContact.classList.remove('has-unread');
        }

        const ttlSnap = await db.ref(`rooms/${msgRoomId}/ttl`).once('value');
        const ttlVal = Number(ttlSnap.val() || 0);
        if (ttlVal > 0 && msg.t && (Date.now() - msg.t > ttlVal)) {
            db.ref(`rooms/${msgRoomId}/messages/${msgKey}`).remove();
            return;
        }

        // ИСПРАВЛЕНИЕ: Ждем скачивания ключа до 10 секунд (защита от скачков сети)
        let attempts = 0;
        while (!currentRoomKey && attempts < 100 && currentRoomId === msgRoomId) {
            await new Promise(r => setTimeout(r, 100)); 
            attempts++;
        }

        let decryptedText = "[Ошибка: Ключ не установлен (сеть)]";
        if (currentRoomKey) {
            try {
                const str = atob(msg.d);
                const combined = new Uint8Array(str.length);
                for(let i=0; i<str.length; i++) combined[i] = str.charCodeAt(i);
                const decrypted = await crypto.subtle.decrypt({name: "AES-GCM", iv: combined.slice(0, 12)}, currentRoomKey, combined.slice(12));
                decryptedText = new TextDecoder().decode(decrypted);
            } catch(e) { decryptedText = "[Ошибка дешифровки]"; }
        }

        const isMe = msg.s === mySession.u;
        const msgTime = msg.t ? new Date(msg.t).toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'}) : '';

        const div = document.createElement('div');
        div.className = `msg ${isMe ? 'you' : 'peer'}`;
        div.innerHTML = `<div class="msg-text">${escapeHTML(decryptedText)}</div><div class="msg-footer"><span class="msg-time">${msgTime}</span></div>`;
        
        msgsContainer.appendChild(div);
        clearTimeout(window.chatScrollTimeout);
        window.chatScrollTimeout = setTimeout(() => { msgsContainer.scrollTop = msgsContainer.scrollHeight; }, 50);
    });

    currentMessagesValueCallback = db.ref(`rooms/${currentRoomId}/messages`).on('value', (snap) => {
        if (!snap.exists()) msgsContainer.innerHTML = '';
    });
}

const backBtn = document.getElementById('btn-mobile-back');
if (backBtn) {
    backBtn.addEventListener('click', () => {
        document.querySelector('.dashboard').classList.remove('mobile-chat-active');
        if (currentRoomId) {
            if (currentMessagesCallback) db.ref(`rooms/${currentRoomId}/messages`).off('child_added', currentMessagesCallback);
            if (currentMessagesValueCallback) db.ref(`rooms/${currentRoomId}/messages`).off('value', currentMessagesValueCallback);
            if (currentTtlCallback) db.ref(`rooms/${currentRoomId}/ttl`).off('value', currentTtlCallback);
        }
        currentRoomId = null; currentRoomKey = null;
        document.getElementById('chat-header-name').textContent = "Выберите чат";
        document.getElementById('messages-container').innerHTML = '<div class="empty-state">Защищенный канал связи<br><span style="font-size:0.75em; opacity: 0.6;">(End-to-End Encryption)</span></div>';
        document.getElementById('chat-input-area').style.display = 'none';
        document.getElementById('crypto-badge').style.display = 'none';
        document.getElementById('chat-controls').style.display = 'none';
    });
}

document.getElementById('auto-clean-select').addEventListener('change', async (e) => {
    if (currentRoomId) await db.ref(`rooms/${currentRoomId}/ttl`).set(e.target.value);
});

document.getElementById('btn-clear-chat').addEventListener('click', () => {
    if (!currentRoomId) return;
    document.getElementById('cb-confirm-clear').checked = false;
    document.getElementById('modal-clear-chat').style.display = 'flex';
});

document.getElementById('btn-cancel-clear').addEventListener('click', () => document.getElementById('modal-clear-chat').style.display = 'none');

document.getElementById('btn-confirm-clear').addEventListener('click', async () => {
    if (!currentRoomId) return;
    if (!document.getElementById('cb-confirm-clear').checked) return alert("❌ Подтвердите очистку!");
    await db.ref(`rooms/${currentRoomId}/messages`).remove();
    document.getElementById('modal-clear-chat').style.display = 'none';
});

const msgInput = document.getElementById('msg-input');
msgInput.addEventListener('input', function() {
    this.style.height = 'auto'; 
    this.style.height = (this.scrollHeight) + 'px'; 
    if (this.value === '') this.style.height = 'auto'; 
});
msgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); document.getElementById('btn-send').click(); }
});

document.getElementById('btn-send').addEventListener('click', async () => {
    const text = msgInput.value.trim();
    if (!text || !currentRoomId || !currentRoomKey) return;
    
    msgInput.value = ''; msgInput.style.height = 'auto'; 

    const enc = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({name: "AES-GCM", iv: iv}, currentRoomKey, enc.encode(text));
    
    const combined = new Uint8Array(12 + encrypted.byteLength);
    combined.set(iv, 0); combined.set(new Uint8Array(encrypted), 12);

    db.ref(`rooms/${currentRoomId}/messages`).push({
        s: mySession.u,
        d: btoa(String.fromCharCode.apply(null, combined)),
        t: Date.now()
    });
});

document.getElementById('btn-cancel-delete').addEventListener('click', () => {
    document.getElementById('modal-delete-contact').style.display = 'none';
    targetUserToDelete = null;
});

document.getElementById('btn-confirm-delete').addEventListener('click', async () => {
    if (!targetUserToDelete) return;
    const shouldDeleteContact = document.getElementById('cb-delete-contact').checked;
    const shouldClearChat = document.getElementById('cb-clear-chat').checked;
    const peerHash = targetUserToDelete;
    
    document.getElementById('modal-delete-contact').style.display = 'none';
    targetUserToDelete = null;

    if (shouldDeleteContact) {
        await db.ref(`users/${mySession.u}/contacts/${peerHash}`).remove();
        await db.ref(`users/${peerHash}/contacts/${mySession.u}`).remove();
    }

    const hashes = [mySession.u, peerHash].sort();
    const targetRoomId = await sha256(hashes[0] + "_" + hashes[1]);

    if (shouldClearChat) await db.ref(`rooms/${targetRoomId}`).remove();

    if ((shouldDeleteContact || shouldClearChat) && currentRoomId === targetRoomId) {
        document.getElementById('btn-mobile-back').click();
    }
});
