const views = {
    404: document.getElementById('view-404'),
    invite: document.getElementById('view-invite'),
    app: document.getElementById('view-app'),
    admin: document.getElementById('view-admin'),
    status: document.getElementById('view-status'),
    proxy: document.getElementById('view-proxy-test')
};

let currentInviteHash = null;
let currentInviteData = null;
let mySession = JSON.parse(localStorage.getItem('ghost_session')) || null;

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

// Проверка админ-прав через API Воркера
window.isRealAdmin = async function(userHash) {
    if (!userHash) return false;
    try {
        const res = await fetch(`${window.APP_CONFIG.API_BASE_URL}/api/admin/check`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ user_hash: userHash })
        });
        const data = await res.json();
        return data.isAdmin === true;
    } catch(e) { return false; }
};

async function handleRoute() {
    const hash = window.location.hash;

    // Мастер-ключ
    if (hash.startsWith('#/root-key/')) {
        const token = hash.replace('#/root-key/', '');
        const tokenHash = await sha256(token);
        
        try {
            const res = await fetch(`${window.APP_CONFIG.API_BASE_URL}/api/auth/claim-admin`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ master_hash: tokenHash, user_hash: mySession ? mySession.u : null })
            });
            const data = await res.json();
            
            if (data.status === 'success') {
                if (mySession) {
                    mySession.isAdmin = true;
                    localStorage.setItem('ghost_session', JSON.stringify(mySession));
                    window.location.hash = '#/admin';
                } else {
                    sessionStorage.setItem('pending_admin', 'true');
                    sessionStorage.setItem('temp_master_hash', tokenHash);
                    setupAuthUI(false, "Администратор");
                    showView('invite');
                }
                return;
            }
        } catch (err) { console.error(err); }
        showView('404'); return;
    }

    if (mySession && hash !== '#/app' && hash !== '#/admin' && hash !== '#/status' && hash !== '#/proxy') { 
        window.location.hash = '#/app'; return; 
    }

    // Инвайты
    if (hash.startsWith('#/inv/')) {
        const token = hash.replace('#/inv/', '');
        currentInviteHash = await sha256(token);
        
        try {
            const res = await fetch(`${window.APP_CONFIG.API_BASE_URL}/api/auth/check-invite`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ invite_hash: currentInviteHash })
            });
            const data = await res.json();

            if (data.status === 'success') {
                currentInviteData = data.invite;
                if (data.invite.user_hash) {
                    setupAuthUI(true, decodeBase64(data.invite.name_b64));
                    showView('invite');
                } else {
                    setupAuthUI(false, "");
                    showView('invite');
                }
            } else {
                showView('404');
            }
        } catch (e) { showView('404'); }
        return;
    } 

    if (hash === '#/app') {
        if (mySession) { showView('app'); initDashboard(); } else window.location.hash = '';
    }
    else if (hash === '#/admin') {
        const hasAdminRights = mySession && await isRealAdmin(mySession.u);
        if (hasAdminRights) {
            showView('admin'); 
            if (typeof initAdminPanel === 'function') initAdminPanel(); 
        } else {
            window.location.hash = '#/app';
        }
    }
    else if (hash === '#/status') {
        showView('status');
        if (typeof runSystemDiagnostics === 'function') runSystemDiagnostics();
    }
    else if (hash === '#/proxy') {
        showView('proxy');
        if (typeof initProxyTester === 'function') initProxyTester();
    }
    else showView('404');
}

window.addEventListener('hashchange', handleRoute);

document.getElementById('btn-register').addEventListener('click', async () => {
    const user = document.getElementById('reg-username').value.trim();
    const pass = document.getElementById('reg-password').value.trim();
    if (user.length < 2 || pass.length < 4) return alert("Логин от 2 символов, пароль от 4 символов!");

    const userHash = await sha256(user);
    const passHash = await sha256(userHash + ":" + pass); 

    // ВХОД В СИСТЕМУ
    if (currentInviteData && currentInviteData.user_hash) {
        try {
            const targetUserHash = currentInviteData.user_hash;
            const targetPassHash = await sha256(targetUserHash + ":" + pass);
            
            const res = await fetch(`${window.APP_CONFIG.API_BASE_URL}/api/auth/login`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ user_hash: targetUserHash, pass_hash: targetPassHash })
            });
            const data = await res.json();

            if (data.error) return alert("❌ " + data.error);

            let privJwk = null;
            try {
                privJwk = await decryptPrivateKey(targetUserHash, pass, data.data.enc_priv_key);
            } catch(e) {
                return alert("❌ Ошибка дешифровки ключей. Проверьте пароль.");
            }

            const isAdmin = await isRealAdmin(targetUserHash);
            mySession = { u: targetUserHash, name: decodeBase64(data.data.name_b64), isAdmin: isAdmin, priv: privJwk };
            localStorage.setItem('ghost_session', JSON.stringify(mySession));
            sessionStorage.removeItem('pending_admin');
            
            window.location.hash = isAdmin ? '#/admin' : '#/app';
        } catch (e) {
            alert("Ошибка сети при входе");
        }
    } 
    // ПЕРВИЧНАЯ РЕГИСТРАЦИЯ
    else {
        const isPendingAdmin = sessionStorage.getItem('pending_admin') === 'true';
        if (!currentInviteData && !isPendingAdmin) {
            return alert("❌ Ошибка: У вас нет прав для создания нового аккаунта.");
        }

        const passConfirm = document.getElementById('reg-password-confirm').value.trim();
        const isChecked = document.getElementById('reg-checkbox').checked;

        if (pass !== passConfirm) return alert("❌ Пароли не совпадают!");
        if (!isChecked) return alert("❌ Подтвердите сохранение данных (галочка).");

        const keyPair = await crypto.subtle.generateKey({name: "ECDH", namedCurve: "P-256"}, true, ["deriveKey", "deriveBits"]);
        const pubJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
        const privJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
        const encryptedPrivKey = await encryptPrivateKey(userHash, pass, privJwk);

        try {
            const payload = {
                user_hash: userHash,
                name_b64: encodeBase64(user),
                pub_key: JSON.stringify(pubJwk),
                enc_priv_key: encryptedPrivKey,
                pass_hash: passHash,
                invite_token_hash: currentInviteHash,
                is_admin_claim: isPendingAdmin,
                master_hash: sessionStorage.getItem('temp_master_hash')
            };

            const res = await fetch(`${window.APP_CONFIG.API_BASE_URL}/api/auth/register`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload)
            });
            const data = await res.json();

            // 🔥 Перехват ошибки уникальности никнейма (D1_ERROR / SQLITE_CONSTRAINT)
            if (data.error) {
                if (String(data.error).includes("UNIQUE constraint failed") || String(data.error).includes("SQLITE_CONSTRAINT")) {
                    return alert("❌ Такой пользователь уже существует, выберите другой ник.");
                }
                return alert("❌ " + data.error);
            }

            mySession = { u: userHash, name: user, isAdmin: isPendingAdmin, priv: privJwk };
            localStorage.setItem('ghost_session', JSON.stringify(mySession));
            sessionStorage.removeItem('pending_admin');
            sessionStorage.removeItem('temp_master_hash');

            window.location.hash = isPendingAdmin ? '#/admin' : '#/app';
        } catch (e) {
            alert("Ошибка сети при регистрации");
        }
    }
});

document.getElementById('btn-logout').onclick = async () => {
    if (mySession) {
        try {
            await fetch(`${window.APP_CONFIG.API_BASE_URL}/api/users/offline`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ user_hash: mySession.u })
            });
        } catch(e) {}
    }
    localStorage.removeItem('ghost_session');
    window.location.hash = ''; 
    window.location.reload();
};

// 🔥 ГЛАВНЫЙ ТРИГГЕР ОТРИСОВКИ ИНТЕРФЕЙСА (Без него будет белый экран)
handleRoute();
