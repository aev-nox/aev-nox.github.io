// ==========================================
// 🛡️ GHOST CORE: STABLE CONFIG & FAILOVER
// ==========================================

const FIREBASE_PROJECT = "global-student-project";

const NETWORK_NODES = [
    { id: 'direct', name: 'Direct (Google EU)', url: `https://${FIREBASE_PROJECT}-default-rtdb.europe-west1.firebasedatabase.app`, type: 'WebSocket' },
    { id: 'deno', name: 'Deno Deploy 🦕', url: 'https://edge-deno.aev-nox.deno.net', type: 'HTTP Proxy' },
    { id: 'cf', name: 'Cloudflare ⚡', url: 'https://edge-flare.zuq.workers.dev', type: 'HTTP Proxy' },
    { id: 'netlify', name: 'Netlify Edge 💠', url: 'https://edge-netlify.netlify.app', type: 'HTTP Proxy' },
    { id: 'vercel', name: 'Vercel Edge 🔺', url: 'https://ed-ge-vercel.vercel.app', type: 'HTTP Proxy' }
];

const MIRRORS = [
    window.location.origin + window.location.pathname,
    "https://aev-nox.github.io",
    "https://aev-nox.vercel.app",
    "https://aev-nox.gitlab.io"
];

const DEFAULT_MASTER_TOKEN = "INIT-ADMIN-KEY-8f3a9b1c7d2e4f5a";

// 1. Выбор активного узла без бесконечных перезагрузок
function getInitialNode() {
    try {
        const saved = JSON.parse(localStorage.getItem('ghost_node'));
        if (saved && saved.url) return saved;
    } catch (e) {}
    // По умолчанию берем Direct или Deno (самый быстрый прокси)
    return NETWORK_NODES[0];
}

const activeNode = getInitialNode();

// Нормализуем URL (убираем слеш на конце)
const cleanDatabaseURL = activeNode.url.replace(/\/+$/, "");

// 2. Инициализация Firebase
firebase.initializeApp({
    apiKey: "AIzaSyAzCfA19BfslrhUnFBYOG72Gnd5lm_5YtI",
    authDomain: `${FIREBASE_PROJECT}.firebaseapp.com`,
    projectId: FIREBASE_PROJECT,
    databaseURL: cleanDatabaseURL
});

window.db = firebase.database();
window.auth = firebase.auth();

// 3. Безопасное отслеживание статуса (БЕЗ location.reload)
db.ref('.info/connected').on('value', (snap) => {
    const isConnected = snap.val() === true;
    
    // Скрываем оверлей загрузки сразу при любом ответе
    const overlay = document.getElementById('boot-overlay');
    if (overlay) overlay.style.display = 'none';

    const btn = document.getElementById('btn-network-status');
    if (btn) {
        btn.innerHTML = isConnected 
            ? `<span style="color:var(--success)">●</span> ${activeNode.name}`
            : `<span style="color:#f59e0b">●</span> Подключение (${activeNode.name})...`;
    }
});

// Анонимный вход для Zero Trust
auth.signInAnonymously().then(() => {
    const overlay = document.getElementById('boot-overlay');
    if (overlay) overlay.style.display = 'none';
}).catch(e => {
    console.error("Auth error:", e);
    const overlay = document.getElementById('boot-overlay');
    if (overlay) overlay.style.display = 'none';
});

if (window.onFirebaseReady) window.onFirebaseReady();

// 4. Ручная сфера узла через UI (#/network)
window.triggerFailover = async function(manual = false) {
    const msgEl = document.getElementById('boot-msg');
    if (msgEl) msgEl.innerText = "Сканирование шлюзов...";

    const promises = NETWORK_NODES.map(async (node) => {
        const start = performance.now();
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);
            const pingUrl = node.id === 'direct' ? `${node.url}/.json` : `${node.url}/ghost-ping`;
            
            const res = await fetch(pingUrl, { signal: controller.signal, cache: 'no-store' });
            clearTimeout(timeoutId);
            return { node, ping: Math.round(performance.now() - start), ok: res.ok || node.id !== 'direct' };
        } catch (e) {
            return { node, ping: 9999, ok: false };
        }
    });

    const results = await Promise.all(promises);
    const alive = results.filter(r => r.ok).sort((a, b) => a.ping - b.ping);

    if (alive.length > 0) {
        const best = alive[0].node;
        localStorage.setItem('ghost_node', JSON.stringify(best));
        
        // Перезагружаем ТОЛЬКО если узел действительно изменился или нажата кнопка вручную
        if (best.id !== activeNode.id || manual) {
            window.location.reload();
        }
    } else {
        alert("Ошибка сети: Все шлюзы недоступны.");
    }
};

// 5. Диагностика для вкладки #/network
window.renderNetworkDiagnostics = async function() {
    const currentEl = document.getElementById('net-current-node');
    if (currentEl) currentEl.innerText = `${activeNode.name}\n${cleanDatabaseURL}`;
    
    const mirrorsEl = document.getElementById('mirrors-list');
    if (mirrorsEl) mirrorsEl.innerHTML = MIRRORS.join('<br>');
    
    const tbody = document.getElementById('network-nodes-list');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Live Ping...</td></tr>';

    const promises = NETWORK_NODES.map(async (node) => {
        const start = performance.now();
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);
            const pingUrl = node.id === 'direct' ? `${node.url}/.json` : `${node.url}/ghost-ping`;
            
            await fetch(pingUrl, { signal: controller.signal, cache: 'no-store' });
            clearTimeout(timeoutId);
            return { node, ping: Math.round(performance.now() - start), ok: true };
        } catch (e) {
            return { node, ping: null, ok: false };
        }
    });

    const results = await Promise.all(promises);
    tbody.innerHTML = '';

    results.forEach(res => {
        let statusBadge = res.ok 
            ? `<span style="color:var(--success); font-weight:bold;">🟢 OK</span>` 
            : `<span style="color:var(--danger); font-weight:bold;">🔴 Ошибка</span>`;
        
        const isCurrent = activeNode.id === res.node.id ? " (Активен)" : "";
        
        tbody.innerHTML += `
            <tr>
                <td><strong>${res.node.name}</strong>${isCurrent}</td>
                <td style="color:var(--text-secondary); font-size:0.9em;">${res.node.type}</td>
                <td>${res.ping ? res.ping + ' ms' : '-'}</td>
                <td>${statusBadge}</td>
            </tr>
        `;
    });
};

async function isRealAdmin(userHash) {
    if (!userHash || !window.db) return false;
    const snap = await db.ref(`admins/${userHash}`).once('value');
    return snap.exists() && snap.val() === true;
}
