'use strict';

const views = {
    404: document.getElementById('view-404'),
    invite: document.getElementById('view-invite'),
    app: document.getElementById('view-app'),
    admin: document.getElementById('view-admin')
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
    const passConfirmInput = document.getElementById('reg-password-confirm');
    const warningBox = document.getElementById('auth-warning');
    const checkboxesBox = document.getElementById('auth-checkboxes');
    const btn = document.getElementById('btn-register');

    if (isLogin) {
        if (title) title.textContent = "Вход в систему";
        if (subtitle) subtitle.textContent = `Персональный канал: ${username}`;
        if (warningBox) warningBox.style.display = "none";
        if (checkboxesBox) checkboxesBox.style.display = "none";
        if (passConfirmInput) passConfirmInput.style.display = "none";
        
        userInput.value = username;
        userInput.disabled = true;
        btn.textContent = "Войти в аккаунт";
    } else {
        if (title) title.textContent = "Активация доступа";
        if (subtitle) subtitle.textContent = username ? "Регистрация Администратора" : "Первичная регистрация";
        if (warningBox) warningBox.style.display = "block";
        if (checkboxesBox) checkboxesBox.style.display = "flex";
        if (passConfirmInput) passConfirmInput.style.display = "block";
        
        userInput.value = "";
        userInput.disabled = false;
        btn.textContent = "Зарегистрироваться и войти";
    }
}

async function handleRoute() {
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
                } else showView('404');
            } else {
                setupAuthUI(false, "");
                showView('invite');
            }
        } else showView('404');
    } 
    else if (hash === '#/app') {
        if (mySession) { showView('app'); initDashboard(); } else window.location.hash = '';
    }
    else if (hash === '#/admin') {
        const hasAdminRights = mySession && await isRealAdmin(mySession.u);
        if (hasAdminRights) {
            showView('admin'); initAdminPanel(); 
        } else window.location.hash = '#/app';
    }
    else showView('404');
}

window.addEventListener('hashchange', handleRoute);

document.getElementById('btn-register').addEventListener('click', async () => {
    const user = document.getElementById('reg-username').value.trim();
    const pass = document.getElementById('reg-password').value.trim();
    const isLoginMode = document.getElementById('reg-username').disabled;

    if (user.length < 2 || pass.length < 4) return alert("Логин от 2 симв., пароль от 4 симв.!");

    if (!isLoginMode) {
        const passConfirm = document.getElementById('reg-password-confirm').value.trim();
        const understandChecked = document.getElementById('reg-understand').checked;
        if (pass !== passConfirm) return alert("❌ Пароли не совпадают!");
        if (!understandChecked) return alert("❌ Подтвердите ознакомление с правилами!");
    }

    const userHash = await sha256(user);
    const passHash = await sha256(userHash + ":" + pass); 

    // --- ВХОД СУЩЕСТВУЮЩЕГО ---
    if (currentInviteData && currentInviteData.userHash) {
        const targetUserHash = currentInviteData.userHash;
        const targetPassHash = await sha256(targetUserHash + ":" + pass);
        
        const userSnap = await db.ref(`users/${targetUserHash}`).once('value');
        if (!userSnap.exists()) return alert("Ошибка: Аккаунт удален!");
        
        const userData = userSnap.val();
        if (userData.isBanned) return alert("⛔ Аккаунт заблокирован!");

        if (userData.ph !== targetPassHash) return alert("❌ Неверный пароль!");

        let privJwk = null;
        try {
            privJwk = await decryptPrivateKey(targetUserHash, pass, userData.epk);
        } catch(e) {
            return alert("❌ Ошибка дешифровки ключей. Проверьте пароль.");
        }

        const isAdmin = await isRealAdmin(targetUserHash);
        mySession = { u: targetUserHash, name: decodeBase64(userData.n), isAdmin: isAdmin, priv: privJwk, loginTime: Date.now() };
        localStorage.setItem('ghost_session', JSON.stringify(mySession));
        sessionStorage.removeItem('pending_admin');

        window.location.hash = isAdmin ? '#/admin' : '#/app';
    } 
    // --- ПЕРВИЧНАЯ РЕГИСТРАЦИЯ ---
    else {
        const isPendingAdmin = sessionStorage.getItem('pending_admin') === 'true';
        if (!currentInviteData && !isPendingAdmin) return alert("❌ Ошибка прав доступа.");

        const keyPair = await crypto.subtle.generateKey({name: "ECDH", namedCurve: "P-256"}, true, ["deriveKey", "deriveBits"]);
        const pubJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
        const privJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);

        const recoveryCode = generateRecoveryCode();
        const encryptedPrivKey = await encryptPrivateKey(userHash, pass, privJwk);
        const encryptedRecoveryKey = await encryptPrivateKey(userHash, recoveryCode, privJwk); // Двойное шифрование

        await db.ref(`users/${userHash}`).update({
            n: encodeBase64(user),
            pk: pubJwk,
            epk: encryptedPrivKey,
            erk: encryptedRecoveryKey,
            ph: passHash,
            created: firebase.database.ServerValue.TIMESTAMP,
            isBanned: false
        });

        if (isPendingAdmin) await db.ref(`admins/${userHash}`).set(true);

        if (currentInviteHash) {
            await db.ref(`invites/${currentInviteHash}`).update({ userHash: userHash, registered: true });
        }
        
        if (document.getElementById('reg-download').checked) {
            downloadCredentials(user, pass, recoveryCode);
        }

        mySession = { u: userHash, name: user, isAdmin: isPendingAdmin, priv: privJwk, loginTime: Date.now() };
        localStorage.setItem('ghost_session', JSON.stringify(mySession));
        sessionStorage.removeItem('pending_admin');

        window.location.hash = isPendingAdmin ? '#/admin' : '#/app';
    }
});
