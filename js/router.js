// =========================================================
// router.js - МАРШРУТИЗАЦИЯ И РЕГИСТРАЦИЯ ЮЗЕРОВ (v3.1)
// =========================================================

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

// Переключение видимых экранов
function showView(viewName) {
    Object.values(views).forEach(el => {
        if (el) el.classList.remove('active', 'active-flex');
    });

    if (viewName !== '404') {
        document.body.classList.add('app-theme');
        document.body.style = ""; 
    } else {
        document.body.classList.remove('app-theme');
    }
    
    document.title = viewName === '404' ? "404 Not Found" : "Ghost Core";
    
    const target = views[viewName];
    if (target) {
        if (viewName === 'app' || viewName === 'invite') target.classList.add('active-flex');
        else target.classList.add('active');
    }
}

// Настройка формы регистрации
function setupAuthUI(isLogin, username = "") {
    const title = document.getElementById('auth-title');
    const subtitle = document.getElementById('auth-subtitle');
    const userInput = document.getElementById('reg-username');
    const btn = document.getElementById('btn-register');
    const warningBox = document.getElementById('auth-warning');

    if (warningBox) warningBox.style.display = 'none';

    if (isLogin) {
        title.textContent = "Вход в узле";
        subtitle.textContent = `Вход для псевдонима: ${username}`;
        userInput.style.display = 'none';
        userInput.value = username;
        btn.textContent = "Разблокировать ключи";
    } else {
        title.textContent = "Регистрация в сети";
        subtitle.textContent = "Создайте локальный профиль для связи";
        userInput.style.display = 'block';
        userInput.value = '';
        btn.textContent = "Сгенерировать ключи и войти";
    }
}

// Слушатель изменения Hash в URL
window.addEventListener('hashchange', async () => {
    const hash = window.location.hash;

    // Вход по инвайт-ссылке (например: #/inv/GHOST-XXXXX)
    if (hash.startsWith('#/inv/')) {
        const rawToken = hash.replace('#/inv/', '').trim();
        const hashedToken = await sha256(rawToken);

        try {
            const snap = await db.ref(`invites/${hashedToken}`).once('value');
            if (!snap.exists()) {
                showView('404');
                return;
            }

            currentInviteHash = hashedToken;
            currentInviteData = snap.val();

            if (currentInviteData.registered) {
                const userSnap = await db.ref(`users/${currentInviteData.userHash}`).once('value');
                const userName = userSnap.exists() ? decodeBase64(userSnap.val().n) : "Пользователь";
                setupAuthUI(true, userName);
            } else {
                setupAuthUI(false);
            }

            showView('invite');
        } catch (e) {
            console.error("Ошибка проверки инвайта:", e);
            showView('404');
        }
        return;
    }

    if (hash === '#/admin') {
        if (mySession && mySession.isAdmin) {
            showView('admin');
            if (typeof window.initAdminPanel === 'function') window.initAdminPanel();
        } else {
            showView('404');
        }
        return;
    }

    if (hash === '#/status') {
        showView('status');
        if (typeof window.initStatusRadar === 'function') window.initStatusRadar();
        return;
    }

    if (hash === '#/proxy') {
        showView('proxy');
        if (typeof window.initProxyTester === 'function') window.initProxyTester();
        return;
    }

    if (hash === '#/app') {
        if (mySession) {
            showView('app');
            initDashboard();
            
            // Если пользователь админ - показываем кнопку Админки
            if (mySession.isAdmin) {
                const btnAdmin = document.getElementById('btn-open-admin');
                if (btnAdmin) btnAdmin.style.display = 'inline-block';
            }
        } else {
            showView('404');
        }
        return;
    }

    // По умолчанию если ничего не подошло
    if (mySession) {
        window.location.hash = '#/app';
    } else {
        showView('404');
    }
});

// Регистрация или Вход
const btnRegister = document.getElementById('btn-register');
if (btnRegister) {
    btnRegister.addEventListener('click', async () => {
        const userInput = document.getElementById('reg-username');
        const passInput = document.getElementById('reg-password');
        const warningBox = document.getElementById('auth-warning');

        const user = userInput.value.trim();
        const pass = passInput.value.trim();

        if (!pass || pass.length < 6) {
            if (warningBox) {
                warningBox.textContent = "Пароль должен содержать минимум 6 символов!";
                warningBox.style.display = 'block';
            }
            return;
        }

        const isLoginMode = userInput.style.display === 'none';
        if (!isLoginMode && !user) {
            if (warningBox) {
                warningBox.textContent = "Введите ваше имя или псевдоним!";
                warningBox.style.display = 'block';
            }
            return;
        }

        btnRegister.disabled = true;
        btnRegister.textContent = "Генерация ключей...";

        try {
            // Аутентификация в Firebase
            if (!auth.currentUser) {
                await auth.signInAnonymously();
            }

            const passHash = await sha256(pass);
            let userHash;

            if (isLoginMode && currentInviteData) {
                userHash = currentInviteData.userHash;
            } else {
                userHash = await sha256(user + "_" + passHash);
            }

            // Проверка бана
            const banSnap = await db.ref(`users/${userHash}/isBanned`).once('value');
            if (banSnap.val() === true) {
                alert("⛔ Ваш аккаунт заблокирован администратором системы!");
                btnRegister.disabled = false;
                btnRegister.textContent = "Войти";
                return;
            }

            // Генерация ключей ECDH
            const keyPair = await generateKeyPair();
            const pubJwk = await exportPublicKey(keyPair.publicKey);
            const privJwk = await exportPublicKey(keyPair.privateKey);

            // Проверка на статус админа
            const masterHashSnap = await db.ref('admin_master_hash').once('value');
            const isMasterAdmin = masterHashSnap.exists() && masterHashSnap.val() === passHash;

            // Запись профиля в базу (Правила проверят kill_switch и max_users)
            await db.ref(`users/${userHash}`).update({
                n: encodeBase64(user || "Пользователь"),
                pk: pubJwk,
                ph: passHash,
                created: Date.now(),
                isBanned: false,
                owner_uid: auth.currentUser.uid 
            });

            if (isMasterAdmin) {
                await db.ref(`admins/${userHash}`).set(true);
                await db.ref(`admin_uids/${auth.currentUser.uid}`).set(passHash);
            }

            if (currentInviteHash) {
                await db.ref(`invites/${currentInviteHash}`).update({
                    userHash: userHash,
                    registered: true,
                    registeredAt: Date.now()
                });
            }

            mySession = {
                u: userHash,
                name: user || "Пользователь",
                isAdmin: isMasterAdmin,
                priv: privJwk
            };

            localStorage.setItem('ghost_session', JSON.stringify(mySession));
            window.location.hash = isMasterAdmin ? '#/admin' : '#/app';

        } catch (err) {
            console.error("Ошибка авторизации/регистрации:", err);
            alert("❌ Ошибка доступа: Достигнут лимит пользователей, превышена длина имени или включен режим заморозки базы (Kill Switch).");
        } finally {
            btnRegister.disabled = false;
            btnRegister.textContent = "Войти";
        }
    });
}

// Выход
const btnLogout = document.getElementById('btn-logout');
if (btnLogout) {
    btnLogout.onclick = () => {
        if (mySession) {
            db.ref(`presence/${mySession.u}`).remove();
        }
        localStorage.removeItem('ghost_session');
        mySession = null;
        window.location.hash = '#/404';
        location.reload();
    };
}

// Первоначальная проверка при загрузке
document.addEventListener('DOMContentLoaded', () => {
    if (!window.location.hash || window.location.hash === '#') {
        if (mySession) window.location.hash = '#/app';
        else showView('404');
    } else {
        window.dispatchEvent(new Event('hashchange'));
    }
});
