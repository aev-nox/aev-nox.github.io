const views = {
    404: document.getElementById('view-404'),
    invite: document.getElementById('view-invite'),
    app: document.getElementById('view-app'),
    admin: document.getElementById('view-admin')
};

let currentInviteHash = null;
let mySession = JSON.parse(localStorage.getItem('ghost_session')) || null;

function showView(viewName) {
    Object.values(views).forEach(el => el.classList.remove('active', 'active-flex'));
    document.body.classList.toggle('app-theme', viewName !== '404');
    document.title = viewName === '404' ? "404 Not Found" : "Ghost Core";
    
    const target = views[viewName];
    if (viewName === 'app' || viewName === 'invite') target.classList.add('active-flex');
    else target.classList.add('active');
}

async function handleRoute() {
    const hash = window.location.hash;

    if (hash.startsWith('#/root-key/')) {
        const token = hash.replace('#/root-key/', '');
        const tokenHash = await sha256(token);
        const masterSnap = await db.ref('admin_master_hash').once('value');
        
        if (masterSnap.exists() && masterSnap.val() === tokenHash) {
            if (mySession) {
                mySession.isAdmin = true;
                localStorage.setItem('ghost_session', JSON.stringify(mySession));
                alert("👑 Доступ Администратора подтвержден!");
                window.location.hash = '#/admin';
            } else {
                alert("👑 Ключ Админа принят! Зарегистрируйтесь, чтобы открыть панель.");
                sessionStorage.setItem('pending_admin', 'true');
                window.location.hash = '';
            }
            return;
        } else {
            showView('404');
            return;
        }
    }

    if (mySession && hash !== '#/app' && hash !== '#/admin') { 
        window.location.hash = '#/app'; 
        return; 
    }

    if (hash.startsWith('#/inv/')) {
        const token = hash.replace('#/inv/', '');
        currentInviteHash = await sha256(token);
        const snap = await db.ref(`invites/${currentInviteHash}`).once('value');
        if (snap.exists()) showView('invite'); else showView('404');
    } 
    else if (hash === '#/app') {
        if (mySession) { showView('app'); initDashboard(); } else window.location.hash = '';
    }
    else if (hash === '#/admin') {
        if (mySession && mySession.isAdmin) { showView('admin'); initAdminPanel(); } else window.location.hash = '#/app';
    }
    else showView('404');
}

window.addEventListener('hashchange', handleRoute);

// Регистрация
document.getElementById('btn-register').addEventListener('click', async () => {
    const user = document.getElementById('reg-username').value.trim();
    if (user.length < 2) return alert("Имя слишком короткое!");

    const keyPair = await crypto.subtle.generateKey({name: "ECDH", namedCurve: "P-256"}, true, ["deriveKey", "deriveBits"]);
    const pubJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const privJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);

    const userHash = await sha256(user);
    const isAdmin = sessionStorage.getItem('pending_admin') === 'true';

    await db.ref(`users/${userHash}`).update({
        n: encodeBase64(user),
        pk: pubJwk,
        created: Date.now(),
        isBanned: false
    });
    
    await fetchAndLogIP(userHash);
    if (currentInviteHash) await db.ref(`invites/${currentInviteHash}`).remove();
    
    mySession = { u: userHash, name: user, isAdmin: isAdmin, priv: privJwk };
    localStorage.setItem('ghost_session', JSON.stringify(mySession));
    sessionStorage.removeItem('pending_admin');

    window.location.hash = isAdmin ? '#/admin' : '#/app';
});

// Выход
document.getElementById('btn-logout').onclick = () => {
    if (mySession) db.ref(`presence/${mySession.u}`).remove();
    localStorage.removeItem('ghost_session');
    window.location.hash = ''; window.location.reload();
};
