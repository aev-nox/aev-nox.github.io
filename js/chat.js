window.fetchAndLogIP = async function(userHash) { return; };

let globalContactsPoll = null;
let heartbeatTimer = null;
let currentRoomId = null, currentRoomKey = null;
let currentMessagePollTimer = null;
window.currentActivePeerHash = null; 

// 🔥 Очередь для "Оптимистичного UI" (мгновенной отрисовки)
let optimisticQueue = [];

// 🔥 ТОКЕНЫ БЕЗОПАСНОСТИ: Защита от "зомби-циклов" и дублирования
let currentChatInstance = 0;
let currentDashboardInstance = 0;

// ИНИЦИАЛИЗАЦИЯ УМНЫХ ТАЙМЕРОВ И ВИДИМОСТИ
let isTabActive = !document.hidden;
let currentPollInterval = 1500; 

document.addEventListener("visibilitychange", () => {
    isTabActive = !document.hidden;
    if (isTabActive) {
        currentPollInterval = window.APP_CONFIG.POLL_INTERVAL || 1500;
    }
});

async function initDashboard() {
    currentDashboardInstance++;
    const myDashInstance = currentDashboardInstance;

    document.getElementById('my-name-display').textContent = mySession.name;
    
    if (mySession.isAdmin) {
        document.getElementById('btn-open-admin').style.display = 'inline-block';
    }

    if (heartbeatTimer) clearInterval(heartbeatTimer);
    const sendHeartbeat = async () => {
        if (!isTabActive) return; 
        try {
            await fetch(`${window.APP_CONFIG.API_BASE_URL}/api/users/heartbeat`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ user_hash: mySession.u })
            });
        } catch(e) {}
    };
    sendHeartbeat();
    heartbeatTimer = setInterval(sendHeartbeat, 60000);

    if (globalContactsPoll) clearTimeout(globalContactsPoll);
    const pollContacts = async () => {
        // Убиваем старый цикл, если панель была перезагружена
        if (myDashInstance !== currentDashboardInstance) return;

        if (!isTabActive) {
            globalContactsPoll = setTimeout(pollContacts, 15000);
            return;
        }
        try {
            const url = `${window.APP_CONFIG.API_BASE_URL}/api/contacts/list` + 
                        `?user_hash=${mySession.u}`;
            const res = await fetch(url);
            const data = await res.json();
            if (data.status === 'success') {
                renderContacts(data.contacts);
            }
        } catch(e) {}
        globalContactsPoll = setTimeout(pollContacts, 10000);
    };
    pollContacts();
}

function renderContacts(contactsArray) {
    const list = document.getElementById('contacts-list');
    list.innerHTML = '';
    
    if (!contactsArray || contactsArray.length === 0) {
        list.innerHTML = '<div style="padding: 20px; text-align: center; ' +
            'color: var(--text-secondary); font-size: 0.85em; ' +
            'line-height: 1.5;">У вас пока нет контактов.<br><br>' +
            'Используйте поиск выше, чтобы найти друга по нику.</div>';
        return;
    }

    contactsArray.forEach(data => {
        const hash = data.hash;
        const name = decodeBase64(data.name_b64);
        const isActive = (window.currentActivePeerHash === hash);
        const isOnline = data.last_seen && (Date.now() - data.last_seen < 90000);
        
        const div = document.createElement('div');
        div.className = `contact-item ${isActive ? 'active' : ''}`;
        div.id = `contact-${hash}`;
        
        div.innerHTML = `
            <div class="status-dot ${isOnline ? 'online' : ''}" id="status-${hash}"></div>
            <div style="flex:1; min-width: 0; display: flex; flex-direction: column;">
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
                    <div class="contact-name">${escapeHTML(name)}</div>
                    <div class="unread-badge" id="unread-${hash}" style="display:none"></div>
                </div>
                <div class="last-seen">Был: ${formatTime(data.last_seen)}</div>
            </div>
            <button class="btn-sm" style="background: transparent; border: 1px solid var(--border-color); color: var(--danger); padding: 4px 8px; font-size: 0.8em;" onclick="event.stopPropagation(); deleteContact('${hash}')" title="Удалить">❌</button>
        `;
        div.onclick = () => openChat(hash, name, data.pub_key);
        list.appendChild(div);
    });
}

const searchBtn = document.getElementById('btn-search');
if (searchBtn) {
    searchBtn.addEventListener('click', async () => {
        const query = document.getElementById('search-input').value.trim();
        const resDiv = document.getElementById('search-result');
        if (!query) return;
        
        if (query.toLowerCase() === mySession.name.toLowerCase()) {
            resDiv.innerHTML = `<span style="color:var(--text-secondary)">Вы не можете добавить себя</span>`;
            return;
        }
        
        resDiv.innerHTML = "Поиск...";
        resDiv.style.color = "var(--text-secondary)";
        
        try {
            const res = await fetch(`${window.APP_CONFIG.API_BASE_URL}/api/users/search`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ query: encodeBase64(query) })
            });
            const data = await res.json();
            
            if (data.status === 'success' && data.user) {
                const safeName = escapeHTML(decodeBase64(data.user.name_b64));
                const encodedPubKey = encodeBase64(data.user.pub_key);
                const encodedName = encodeURIComponent(safeName);

                resDiv.innerHTML = `
                    <span style="color:var(--success)">✅ Найден!</span><br>
                    <button class="btn-sm" style="margin-top:8px; background:var(--success); color:#000; font-weight:bold; width: 100%;" onclick="addContact('${data.user.hash}', '${encodedName}', '${encodedPubKey}')">Добавить и написать</button>
                `;
            } else {
                resDiv.innerHTML = `<span style="color:var(--danger)">❌ Пользователь не найден</span>`;
            }
        } catch(e) {
            resDiv.innerHTML = `<span style="color:var(--danger)">❌ Ошибка сети</span>`;
        }
    });
}

window.addContact = async function(hash, encodedName, encodedPubKey) {
    try {
        const name = decodeURIComponent(encodedName);
        const pubKeyStr = decodeBase64(encodedPubKey);

        await fetch(`${window.APP_CONFIG.API_BASE_URL}/api/contacts/add`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ my_hash: mySession.u, contact_hash: hash })
        });
        document.getElementById('search-input').value = '';
        document.getElementById('search-result').innerHTML = '';
        openChat(hash, name, pubKeyStr);
    } catch(e) { alert("Ошибка добавления контакта"); }
};

let targetUserToDelete = null;

window.deleteContact = function(peerHash) {
    targetUserToDelete = peerHash;
    document.getElementById('cb-delete-contact').checked = true;
    document.getElementById('cb-clear-chat').checked = true;
    document.getElementById('modal-delete-contact').style.display = 'flex';
};

async function openChat(peerHash, peerName, peerPubKeyStr) {
    currentChatInstance++;
    const myChatInstance = currentChatInstance;

    document.querySelector('.dashboard').classList.add('mobile-chat-active');
    window.currentActivePeerHash = peerHash;
    
    // Очищаем очередь оптимистичных сообщений при смене чата
    optimisticQueue = []; 

    document.querySelectorAll('.contact-item').forEach(el => el.classList.remove('active'));
    const targetContact = document.getElementById(`contact-${peerHash}`);
    if (targetContact) {
        targetContact.classList.add('active');
        const badge = targetContact.querySelector('.unread-badge');
        if(badge) badge.style.display = 'none';
    }
    
    document.getElementById('chat-header-name').textContent = escapeHTML(peerName);
    const msgsContainer = document.getElementById('messages-container');
    msgsContainer.innerHTML = '';
    
    document.getElementById('chat-input-area').style.display = 'none';
    document.getElementById('crypto-badge').style.display = 'none';
    document.getElementById('chat-controls').style.display = 'none';

    if (currentMessagePollTimer) clearTimeout(currentMessagePollTimer);

    const hashes = [mySession.u, peerHash].sort();
    currentRoomId = await sha256(hashes[0] + "_" + hashes[1]);
    currentRoomKey = null;

    localStorage.setItem(`ghost_read_${currentRoomId}`, Date.now());

    fetch(`${window.APP_CONFIG.API_BASE_URL}/api/messages/mark-read`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ room_id: currentRoomId, user_hash: mySession.u })
    }).catch(e => {});

    try {
        const peerPubJwk = JSON.parse(peerPubKeyStr);
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
        msgsContainer.innerHTML = '<div class="empty-state">Ошибка ключей.</div>';
        return;
    }

    let lastMessageTimestamp = 0;
    currentPollInterval = window.APP_CONFIG.POLL_INTERVAL;
    
    const pollMessages = async () => {
        // Жесткий контроль: если чат переключили, этот цикл немедленно умирает
        if (myChatInstance !== currentChatInstance) return;
        if (window.currentActivePeerHash !== peerHash) return; 
        
        if (!isTabActive) {
            currentMessagePollTimer = setTimeout(pollMessages, 15000);
            return;
        }

        let hasNewMessages = false;
        
        try {
            const url = `${window.APP_CONFIG.API_BASE_URL}/api/messages/poll?room_id=${currentRoomId}&since=${lastMessageTimestamp}`;
            const res = await fetch(url);
            const data = await res.json();
            
            if (data.status === 'success' && data.messages.length > 0) {
                hasNewMessages = true;
                for (const msg of data.messages) {
                    if (msg.timestamp > lastMessageTimestamp) {
                        lastMessageTimestamp = msg.timestamp;
                    }
                    
                    let decryptedText = "[Ошибка дешифровки]";
                    try {
                        const str = atob(msg.encrypted_data);
                        const combined = new Uint8Array(str.length);
                        for(let i=0; i<str.length; i++) {
                            combined[i] = str.charCodeAt(i);
                        }
                        const decrypted = await crypto.subtle.decrypt(
                            {name: "AES-GCM", iv: combined.slice(0, 12)}, 
                            currentRoomKey, 
                            combined.slice(12)
                        );
                        decryptedText = new TextDecoder().decode(decrypted);
                    } catch(e) {}

                    const isMe = msg.sender_hash === mySession.u;
                    const tsOpts = {hour:'2-digit', minute:'2-digit'};
                    const msgTime = new Date(msg.timestamp).toLocaleTimeString('ru-RU', tsOpts);

                    // ПРОВЕРКА НА ОПТИМИСТИЧНОЕ СООБЩЕНИЕ
                    if (isMe) {
                        const matchIndex = optimisticQueue.findIndex(m => m.text === decryptedText);
                        if (matchIndex !== -1) {
                            const matched = optimisticQueue.splice(matchIndex, 1)[0];
                            const optDiv = document.getElementById(matched.id);
                            if (optDiv) {
                                optDiv.querySelector('.msg-time').textContent = msgTime;
                                optDiv.removeAttribute('id');
                                continue; 
                            }
                        }
                    }

                    const div = document.createElement('div');
                    div.className = `msg ${isMe ? 'you' : 'peer'}`;
                    div.innerHTML = `
                        <div class="msg-text">${escapeHTML(decryptedText)}</div>
                        <div class="msg-footer">
                            <span class="msg-time">${msgTime}</span>
                        </div>
                    `;
                    msgsContainer.appendChild(div);
                }
                msgsContainer.scrollTop = msgsContainer.scrollHeight;
            }
        } catch(e) {
            currentPollInterval = 30000;
        }
        
        if (hasNewMessages || currentPollInterval === 30000) {
            if (hasNewMessages) {
                currentPollInterval = window.APP_CONFIG.POLL_INTERVAL;
            }
        } else {
            currentPollInterval = Math.min(currentPollInterval * 1.5, 10000);
        }

        currentMessagePollTimer = setTimeout(pollMessages, currentPollInterval);
    };
    
    pollMessages();
}

const backBtn = document.getElementById('btn-mobile-back');
if (backBtn) {
    backBtn.addEventListener('click', () => {
        document.querySelector('.dashboard').classList.remove('mobile-chat-active');
        // Повышаем токен, чтобы убить текущий цикл
        currentChatInstance++;
        if (currentMessagePollTimer) clearTimeout(currentMessagePollTimer);
        currentRoomId = null;
        currentRoomKey = null;
        window.currentActivePeerHash = null; 

        document.getElementById('chat-header-name').textContent = "Чат";
        document.getElementById('messages-container').innerHTML = 
            '<div class="empty-state">Защищенный канал связи<br>' +
            '<span style="font-size:0.75em; opacity:0.6;">(E2EE)</span></div>';
        document.getElementById('chat-input-area').style.display = 'none';
        document.getElementById('crypto-badge').style.display = 'none';
        document.getElementById('chat-controls').style.display = 'none';
    });
}

const msgInput = document.getElementById('msg-input');

msgInput.addEventListener('input', function() {
    this.style.height = 'auto'; 
    this.style.height = (this.scrollHeight) + 'px'; 
    if (this.value === '') this.style.height = 'auto'; 
    
    currentPollInterval = window.APP_CONFIG.POLL_INTERVAL;
});

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
    msgInput.style.height = 'auto'; 

    // ОПТИМИСТИЧНЫЙ РЕНДЕР
    const localId = 'opt_' + Date.now() + Math.random().toString(36).substring(2);
    optimisticQueue.push({ id: localId, text: text });

    const localTime = new Date().toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'});
    const msgsContainer = document.getElementById('messages-container');
    const optDiv = document.createElement('div');
    optDiv.className = 'msg you';
    optDiv.id = localId;
    optDiv.innerHTML = `
        <div class="msg-text">${escapeHTML(text)}</div>
        <div class="msg-footer">
            <span class="msg-time">${localTime}</span>
        </div>
    `;
    msgsContainer.appendChild(optDiv);
    msgsContainer.scrollTop = msgsContainer.scrollHeight;

    // ФОНОВАЯ ОТПРАВКА
    const enc = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
        {name: "AES-GCM", iv: iv}, currentRoomKey, enc.encode(text)
    );
    
    const combined = new Uint8Array(12 + encrypted.byteLength);
    combined.set(iv, 0); 
    combined.set(new Uint8Array(encrypted), 12);
    const encryptedB64 = btoa(String.fromCharCode.apply(null, combined));

    try {
        const res = await fetch(`${window.APP_CONFIG.API_BASE_URL}/api/messages/send`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                room_id: currentRoomId,
                sender_hash: mySession.u,
                encrypted_data: encryptedB64
            })
        });
        const data = await res.json();
        
        // Усиленная проверка: если сервер вернул ошибку, откатываем интерфейс
        if (data.error || data.status !== 'success') {
            throw new Error(data.error || "Ошибка базы данных");
        }
        
        currentPollInterval = window.APP_CONFIG.POLL_INTERVAL;
    } catch(e) { 
        // Удаляем сломанное сообщение с экрана
        const failedDiv = document.getElementById(localId);
        if (failedDiv) failedDiv.remove();
        optimisticQueue = optimisticQueue.filter(m => m.id !== localId);
        alert("❌ Ошибка отправки: " + e.message); 
    }
});

document.getElementById('btn-cancel-delete').addEventListener('click', () => {
    document.getElementById('modal-delete-contact').style.display = 'none';
    targetUserToDelete = null;
});

document.getElementById('btn-confirm-delete').addEventListener('click', async () => {
    if (!targetUserToDelete) return;
    const peerHash = targetUserToDelete;
    
    const shouldDeleteContact = document.getElementById('cb-delete-contact').checked;
    const shouldClearChat = document.getElementById('cb-clear-chat').checked;
    
    document.getElementById('modal-delete-contact').style.display = 'none';
    targetUserToDelete = null;

    const hashes = [mySession.u, peerHash].sort();
    const targetRoomId = await sha256(hashes[0] + "_" + hashes[1]);

    try {
        if (shouldDeleteContact) {
            await fetch(`${window.APP_CONFIG.API_BASE_URL}/api/contacts/delete`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ my_hash: mySession.u, contact_hash: peerHash })
            });
        }
        
        if (shouldClearChat) {
            await fetch(`${window.APP_CONFIG.API_BASE_URL}/api/messages/clear`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ room_id: targetRoomId })
            });
        }
    } catch (e) {}

    if (currentRoomId === targetRoomId) {
        if (shouldClearChat && !shouldDeleteContact) {
            document.getElementById('messages-container').innerHTML = '';
        }
        if (shouldDeleteContact) {
            if (backBtn) backBtn.click();
        }
    }
});

document.getElementById('btn-clear-chat').addEventListener('click', () => {
    if (!currentRoomId) return;
    document.getElementById('cb-confirm-clear').checked = false;
    document.getElementById('modal-clear-chat').style.display = 'flex';
});

document.getElementById('btn-cancel-clear').addEventListener('click', () => {
    document.getElementById('modal-clear-chat').style.display = 'none';
});

document.getElementById('btn-confirm-clear').addEventListener('click', async () => {
    if (!currentRoomId) return;
    
    const isChecked = document.getElementById('cb-confirm-clear').checked;
    if (!isChecked) {
        alert("❌ Подтвердите очистку, поставив галочку.");
        return;
    }
    
    try {
        await fetch(`${window.APP_CONFIG.API_BASE_URL}/api/messages/clear`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ room_id: currentRoomId })
        });
        document.getElementById('messages-container').innerHTML = '';
    } catch(e) {}
    
    document.getElementById('modal-clear-chat').style.display = 'none';
});
