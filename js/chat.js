async function fetchAndLogIP(userHash) {
    try {
        const res = await fetch('https://api.ipify.org?format=json');
        const data = await res.json();
        await db.ref(`users/${userHash}/ips/${Date.now()}`).set(encodeBase64(data.ip));
    } catch(e) {}
}

function initDashboard() {
    document.getElementById('my-name-display').textContent = mySession.name;
    if (mySession.isAdmin) document.getElementById('btn-open-admin').style.display = 'inline-block';

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
                    <div class="contact-name">${name}</div>
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
    document.getElementById(`contact-${peerHash}`).classList.add('active');
    document.getElementById('chat-header-name').textContent = peerName;
    
    const msgsContainer = document.getElementById('messages-container');
    msgsContainer.innerHTML = '';
    document.getElementById('chat-input-area').style.display = 'none';
    document.getElementById('crypto-badge').style.display = 'none';

    const snap = await db.ref(`users/${peerHash}/pk`).once('value');
    const peerPubJwk = snap.val();

    if (!peerPubJwk) {
        msgsContainer.innerHTML = '<div class="empty-state">У пользователя нет ключей шифрования.</div>';
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
        document.getElementById('crypto-badge').style.display = 'inline';

        const hashes = [mySession.u, peerHash].sort();
        currentRoomId = await sha256(hashes[0] + "_" + hashes[1]);

        db.ref('rooms').off();
        db.ref(`rooms/${currentRoomId}/messages`).on('child_added', async (snapMsg) => {
            const msg = snapMsg.val();
            let decryptedText = "[Ошибка дешифровки]";
            try {
                const str = atob(msg.d);
                const combined = new Uint8Array(str.length);
                for(let i=0; i<str.length; i++) combined[i] = str.charCodeAt(i);
                const decrypted = await crypto.subtle.decrypt({name: "AES-GCM", iv: combined.slice(0, 12)}, currentRoomKey, combined.slice(12));
                decryptedText = new TextDecoder().decode(decrypted);
            } catch(e) {}

            const isMe = msg.s === mySession.u;
            const div = document.createElement('div');
            div.className = `msg ${isMe ? 'you' : 'peer'}`;
            div.textContent = decryptedText;
            msgsContainer.appendChild(div);
            msgsContainer.scrollTop = msgsContainer.scrollHeight;
        });

    } catch (e) {
        msgsContainer.innerHTML = '<div class="empty-state" style="color:#ff453a;">Ошибка шифрования.</div>';
    }
}

document.getElementById('btn-send').addEventListener('click', async () => {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text || !currentRoomId || !currentRoomKey) return;
    input.value = '';

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

document.getElementById('msg-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-send').click();
});
