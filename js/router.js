const views = {
    404: document.getElementById('view-404'),
    invite: document.getElementById('view-invite'),
    app: document.getElementById('view-app'),
    admin: document.getElementById('view-admin')
};

let currentInviteHash = null;
let currentInviteData = null;
let mySession = JSON.parse(localStorage.getItem('ghost_session')) || null;
let isFirebaseReady = false; 

auth.signInAnonymously()
    .then(() => {
        isFirebaseReady = true;
        handleRoute(); 
    })
    .catch((error) => {
        console.error("Auth Error:", error);
        alert("Ошибка установки защищенного соединения с базой.");
    });

function showView(viewName) {
    Object.values(views).forEach(el => el.classList.remove('active', 'active-flex'));
    if(viewName !== '404') {
        document.body.classList.add('app-theme');
        document.body.style = ""; 
    } else {
        document.body.classList.remove('app-theme');
    }
    document.title = viewName === '404' ? "404 Not Found" : "Ghost Core";
    
    const target = views[viewName];
    if (viewName === 'app' || viewName === 'invite') target.classList.add('active-flex');
    else target.classList.add('active');
}

function setupAuthUI(isLogin, username = "") {
    const title = document.getElementById('auth-title');
    const subtitle = document.getElementById('auth-subtitle');
    const userInput = document.getElementById('reg-username');
    const btn = document.getElementById('btn-register');
    const warningBox = document.getElementById('auth-warning');
    const passConfirm = document.getElementById('reg-password-confirm');
    const checkboxContainer = document.getElementById('auth-checkbox-container');

    if (isLogin) {
        if (title) title.textContent = "Вход в систему";
        if (subtitle) subtitle.textContent = username ? `Персональный канал: ${username}` : "Введите ваши данные для входа";
        if (warningBox) warningBox.style.display = "none";
        if (passConfirm) passConfirm.style.display = "none";
        if (checkboxContainer) checkboxContainer.style.display = "none";
        userInput.value = username;
        userInput.disabled = (username !== ""); // Разрешаем ввод логина, если зашли без инвайта
        btn.textContent = "Войти в аккаунт";
    } else {
        if (title) title.textContent = "Активация доступа";
        if (subtitle) subtitle.textContent = username ? "Регистрация Администратора" : "Первичная регистрация";
        if (warningBox) warningBox.style.display = "block";
        if (passConfirm) passConfirm.style.display = "block";
        if (checkboxContainer) checkboxContainer.style.display = "flex";
        userInput.value = "";
        userInput.disabled = false;
        btn.textContent = "Зарегистрироваться и войти";
    }
}

async function derivePassKey(userHash, password) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), {name: "PBKDF2"}, false, ["deriveKey"]);
    return await crypto.subtle.deriveKey(
        {name: "PBKDF2", salt: enc.encode(userHash), iterations: 100000, hash: "SHA-256"},
        keyMaterial, {name: "AES-GCM", length: 256}, false, ["encrypt", "decrypt"]
    );
}

async function encryptPrivateKey(userHash, password, privJwk) {
    const passKey = await derivePassKey(userHash, password);
    const enc = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({name: "AES-GCM", iv: iv}, passKey, enc.encode(JSON.stringify(privJwk)));
    const combined = new Uint8Array(12 + encrypted.byteLength);
    combined.set(iv, 0); combined.set(new Uint8Array(encrypted), 12);
    return btoa(String.fromCharCode.apply(null, combined));
}

async function decryptPrivateKey(userHash, password, encryptedB64) {
    const passKey = await derivePassKey(userHash, password);
    const str = atob(encryptedB64);
    const combined = new Uint8Array(str.length);
    for(let i=0; i<str.length; i++) combined[i] = str.charCodeAt(i);
    const decrypted = await crypto.subtle.decrypt({name: "AES-GCM", iv: combined.slice(0, 12)}, passKey, combined.slice(12));
    return JSON.parse(new TextDecoder().decode(decrypted));
}

async function handleRoute() {
    if (!isFirebaseReady) return; 

    const hash = window.location.hash;

    // 🔥 Прямой вход (без инвайта)
    if (hash === '' || hash === '#/' || hash === '#/login') {
        if (mySession) {
            window.location.hash = mySession.isAdmin ? '#/admin' : '#/app';
            return;
        }
        setupAuthUI(true, ""); // Открываем форму ВХОДА
        showView('invite');
        return;
    }

    if (hash.startsWith('#/root-key/')) {
        const token = hash.replace('#/root-key/', '');
        const tokenHash = await sha256(token);
        const masterSnap = await db.ref('admin_master_hash').once('value');
        
        if (masterSnap.exists() && masterSnap.val() === tokenHash) {
            if (mySession) {
                await db.ref(`admin_uids/${auth.currentUser.uid}`).set(tokenHash);
                await db.ref(`admins/${mySession.u}`).set(true);
                mySession.isAdmin = true;
                localStorage.setItem('ghost_session', JSON.stringify(mySession));
                window.location.hash = '#/admin';
            } else {
                sessionStorage.setItem('pending_admin', 'true');
                sessionStorage.setItem('pending_admin_token', tokenHash); 
                setupAuthUI(true, ""); // Удобный интерфейс: можно войти в старого админа или зарегать нового
                document.getElementById('auth-title').textContent = "Вход Администратора";
                showView('invite');
            }
            return;
        } else {
            showView('404'); return;
        }
    }

    if (mySession && hash !== '#/app' && hash !== '#/admin') { 
        window.location.hash = '#/app'; return; 
    }

    if (hash.startsWith('#/inv/')) {
        const token = hash.replace('#/inv/', '');
        currentInviteHash = await sha256(token);
        const snap = await db.ref(`invites/${currentInviteHash}`).once('value');
        
        if (snap.exists()) {
            currentInviteData = snap.val();
            if (currentInviteData.userHash) {
                const userSnap = await db.ref(`users/${currentInviteData.userHash}`).once('value');
                if (userSnap.exists()) {
                    setupAuthUI(true, decodeBase64(userSnap.val().n));
                    showView('invite');
                } else {
                    showView('404');
                }
            } else {
                setupAuthUI(false, "");
                showView('invite');
            }
        } else {
            showView('404');
        }
    } 
    else if (hash === '#/app') {
        if (mySession) { showView('app'); initDashboard(); } else window.location.hash = '#/login';
    }
    else if (hash === '#/admin') {
        const hasAdminRights = mySession && await isRealAdmin(mySession.u);
        if (hasAdminRights) {
            showView('admin'); initAdminPanel(); 
        } else {
            window.location.hash = '#/app';
        }
    }
    else showView('404');
}

window.addEventListener('hashchange', () => { if (isFirebaseReady) handleRoute(); });

document.getElementById('btn-register').addEventListener('click', async () => {
    if (!isFirebaseReady || !auth.currentUser) return alert("Ожидание защищенного соединения...");

    const user = document.getElementById('reg-username').value.trim();
    const pass = document.getElementById('reg-password').value.trim();
    if (user.length < 2 || pass.length < 4) return alert("Логин от 2 символов, пароль от 4 символов!");

    const userHash = await sha256(user);
    const passHash = await sha256(userHash + ":" + pass); 

    // Проверяем, существует ли пользователь в базе
    const userSnapCheck = await db.ref(`users/${userHash}`).once('value');

    if (userSnapCheck.exists()) {
        // ================= ЛОГИКА ВХОДА =================
        const userData = userSnapCheck.val();
        if (userData.isBanned) return alert("⛔ Аккаунт заблокирован!");

        if (!userData.ph) {
            const keyPair = await crypto.subtle.generateKey({name: "ECDH", namedCurve: "P-256"}, true, ["deriveKey", "deriveBits"]);
            const pubJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
            const privJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
            const encryptedPrivKey = await encryptPrivateKey(userHash, pass, privJwk);

            await db.ref(`users/${userHash}`).update({ 
                pk: pubJwk, 
                epk: encryptedPrivKey, 
                ph: passHash,
                owner_uid: auth.currentUser.uid 
            });
            alert("🔑 Новый пароль установлен. Ключи перегенерированы.");
            
            const isAdmin = await isRealAdmin(userHash);
            mySession = { u: userHash, name: decodeBase64(userData.n), isAdmin: isAdmin, priv: privJwk };
            localStorage.setItem('ghost_session', JSON.stringify(mySession));
            window.location.hash = isAdmin ? '#/admin' : '#/app';
            return;
        }

        if (userData.ph !== passHash) return alert("❌ Неверный пароль!");

        let privJwk = null;
        try {
            privJwk = await decryptPrivateKey(userHash, pass, userData.epk);
        } catch(e) {
            return alert("❌ Ошибка дешифровки ключей. Проверьте пароль.");
        }

        // Обновляем привязку устройства. Игнорируем ошибку, если зашли с нового девайса
        try { await db.ref(`users/${userHash}/owner_uid`).set(auth.currentUser.uid); } catch(e) {}

        const isAdmin = await isRealAdmin(userHash);
        
        // Если админ заходит по мастер-ссылке, прописываем его в базу прав
        const pendingToken = sessionStorage.getItem('pending_admin_token');
        if (isAdmin && pendingToken) {
            try { await db.ref(`admin_uids/${auth.currentUser.uid}`).set(pendingToken); } catch(e) {}
        }

        mySession = { u: userHash, name: decodeBase64(userData.n), isAdmin: isAdmin, priv: privJwk };
        localStorage.setItem('ghost_session', JSON.stringify(mySession));
        sessionStorage.removeItem('pending_admin');
        sessionStorage.removeItem('pending_admin_token');

        window.location.hash = isAdmin ? '#/admin' : '#/app';

    } else {
        // ================= ЛОГИКА РЕГИСТРАЦИИ =================
        const isPendingAdmin = sessionStorage.getItem('pending_admin') === 'true';
        const pendingToken = sessionStorage.getItem('pending_admin_token');

        if (!currentInviteData && !isPendingAdmin) {
            return alert("❌ Ошибка: У вас нет прав для создания нового аккаунта (требуется инвайт).");
        }

        const passConfirm = document.getElementById('reg-password-confirm').value.trim();
        const isChecked = document.getElementById('reg-checkbox').checked;

        if (pass !== passConfirm) return alert("❌ Пароли не совпадают!");
        if (!isChecked) return alert("❌ Подтвердите, что сохранили данные.");

        const keyPair = await crypto.subtle.generateKey({name: "ECDH", namedCurve: "P-256"}, true, ["deriveKey", "deriveBits"]);
        const pubJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
        const privJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);

        const encryptedPrivKey = await encryptPrivateKey(userHash, pass, privJwk);

        await db.ref(`users/${userHash}`).set({
            n: encodeBase64(user),
            pk: pubJwk,
            epk: encryptedPrivKey,
            ph: passHash,
            created: Date.now(),
            isBanned: false,
            owner_uid: auth.currentUser.uid
        });

        if (isPendingAdmin && pendingToken) {
            await db.ref(`admin_uids/${auth.currentUser.uid}`).set(pendingToken);
            await db.ref(`admins/${userHash}`).set(true);
        }

        if (currentInviteHash) {
            await db.ref(`invites/${currentInviteHash}`).update({
                userHash: userHash,
                registered: true,
                registeredAt: Date.now()
            });
        }
        
        mySession = { u: userHash, name: user, isAdmin: isPendingAdmin, priv: privJwk };
        localStorage.setItem('ghost_session', JSON.stringify(mySession));
        sessionStorage.removeItem('pending_admin');
        sessionStorage.removeItem('pending_admin_token');

        window.location.hash = isPendingAdmin ? '#/admin' : '#/app';
    }
});

document.getElementById('btn-logout').onclick = () => {
    if (mySession) db.ref(`presence/${mySession.u}`).remove();
    localStorage.removeItem('ghost_session');
    // 🔥 МЫ БОЛЬШЕ НЕ ДЕЛАЕМ auth.signOut(). Токен устройства остается живым!
    window.location.hash = '#/login'; 
    window.location.reload();
};
