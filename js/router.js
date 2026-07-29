const views = {
    404: document.getElementById('view-404'),
    invite: document.getElementById('view-invite'),
    app: document.getElementById('view-app'),
    admin: document.getElementById('view-admin')
};

let currentInviteHash = null;
let currentInviteData = null;
let mySession = JSON.parse(localStorage.getItem('ghost_session')) || null;
let isFirebaseReady = false; // Флаг готовности авторизации

// 🔥 Скрытая анонимная авторизация перед любыми действиями
auth.signInAnonymously()
    .then(() => {
        isFirebaseReady = true;
        console.log("Secure Session Established: ", auth.currentUser.uid);
        handleRoute(); // Запускаем роутер только после того, как получили токен
    })
    .catch((error) => {
        console.error("Auth Error:", error);
        alert("Ошибка установки защищенного соединения с базой. Проверьте настройки Firebase.");
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
        if (subtitle) subtitle.textContent = `Персональный канал: ${username}`;
        if (warningBox) warningBox.style.display = "none";
        if (passConfirm) passConfirm.style.display = "none";
        if (checkboxContainer) checkboxContainer.style.display = "none";
        userInput.value = username;
        userInput.disabled = true;
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
    if (!isFirebaseReady) return; // Ждем токен перед маршрутизацией

    const hash = window.location.hash;

    if (hash.startsWith('#/root-key/')) {
        const token = hash.replace('#/root-key/', '');
        const tokenHash = await sha256(token);
        const masterSnap = await db.ref('admin_master_hash').once('value');
        
        if (masterSnap.exists() && masterSnap.val() === tokenHash) {
            if (mySession) {
                await db.ref(`admins/${mySession.u}`).set(true);
                mySession.isAdmin = true;
                localStorage.setItem('ghost_session', JSON.stringify(mySession));
                window.location.hash = '#/admin';
            } else {
                sessionStorage.setItem('pending_admin', 'true');
                setupAuthUI(false, "Администратор");
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
        if (mySession) { showView('app'); initDashboard(); } else window.location.hash = '';
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

    // ЛОГИКА ВХОДА (УЖЕ ЗАРЕГИСТРИРОВАН)
    if (currentInviteData && currentInviteData.userHash) {
        const targetUserHash = currentInviteData.userHash;
        const targetPassHash = await sha256(targetUserHash + ":" + pass);
        
        const userSnap = await db.ref(`users/${targetUserHash}`).once('value');
        if (!userSnap.exists()) return alert("Ошибка: Аккаунт удален!");
        
        const userData = userSnap.val();
        if (userData.isBanned) return alert("⛔ Аккаунт заблокирован!");

        if (!userData.ph) {
            const keyPair = await crypto.subtle.generateKey({name: "ECDH", namedCurve: "P-256"}, true, ["deriveKey", "deriveBits"]);
            const pubJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
            const privJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
            const encryptedPrivKey = await encryptPrivateKey(targetUserHash, pass, privJwk);

            // 🔥 Сохраняем owner_uid при сбросе ключей
            await db.ref(`users/${targetUserHash}`).update({ 
                pk: pubJwk, 
                epk: encryptedPrivKey, 
                ph: targetPassHash,
                owner_uid: auth.currentUser.uid 
            });
            alert("🔑 Новый пароль установлен. Ключи перегенерированы.");
            
            const isAdmin = await isRealAdmin(targetUserHash);
            mySession = { u: targetUserHash, name: decodeBase64(userData.n), isAdmin: isAdmin, priv: privJwk };
            localStorage.setItem('ghost_session', JSON.stringify(mySession));
            window.location.hash = isAdmin ? '#/admin' : '#/app';
            return;
        }

        if (userData.ph !== targetPassHash) return alert("❌ Неверный пароль!");

        let privJwk = null;
        try {
            privJwk = await decryptPrivateKey(targetUserHash, pass, userData.epk);
        } catch(e) {
            return alert("❌ Ошибка дешифровки ключей. Проверьте пароль.");
        }

        // 🔥 Обновляем привязку устройства к аккаунту при входе
        await db.ref(`users/${targetUserHash}/owner_uid`).set(auth.currentUser.uid);

        const isAdmin = await isRealAdmin(targetUserHash);
        mySession = { u: targetUserHash, name: decodeBase64(userData.n), isAdmin: isAdmin, priv: privJwk };
        localStorage.setItem('ghost_session', JSON.stringify(mySession));
        sessionStorage.removeItem('pending_admin');

        window.location.hash = isAdmin ? '#/admin' : '#/app';
    } 
    // ЛОГИКА ПЕРВИЧНОЙ РЕГИСТРАЦИИ
    else {
        const isPendingAdmin = sessionStorage.getItem('pending_admin') === 'true';
        if (!currentInviteData && !isPendingAdmin) {
            return alert("❌ Ошибка: У вас нет прав для создания нового аккаунта.");
        }

        const passConfirm = document.getElementById('reg-password-confirm').value.trim();
        const isChecked = document.getElementById('reg-checkbox').checked;

        if (pass !== passConfirm) return alert("❌ Пароли не совпадают! Пожалуйста, введите одинаковые пароли.");
        if (!isChecked) return alert("❌ Пожалуйста, подтвердите, что вы сохранили данные (поставьте галочку).");

        const userSnapCheck = await db.ref(`users/${userHash}`).once('value');
        if (userSnapCheck.exists()) return alert("❌ Этот логин уже занят! Пожалуйста, придумайте другой.");

        const keyPair = await crypto.subtle.generateKey({name: "ECDH", namedCurve: "P-256"}, true, ["deriveKey", "deriveBits"]);
        const pubJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
        const privJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);

        const encryptedPrivKey = await encryptPrivateKey(userHash, pass, privJwk);

        // 🔥 Пишем owner_uid при регистрации
        await db.ref(`users/${userHash}`).set({
            n: encodeBase64(user),
            pk: pubJwk,
            epk: encryptedPrivKey,
            ph: passHash,
            created: Date.now(),
            isBanned: false,
            owner_uid: auth.currentUser.uid
        });

        if (isPendingAdmin) await db.ref(`admins/${userHash}`).set(true);

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

        window.location.hash = isPendingAdmin ? '#/admin' : '#/app';
    }
});

document.getElementById('btn-logout').onclick = () => {
    if (mySession) db.ref(`presence/${mySession.u}`).remove();
    localStorage.removeItem('ghost_session');
    // При выходе разрываем защищенное соединение
    auth.signOut().then(() => {
        window.location.hash = ''; 
        window.location.reload();
    });
};
