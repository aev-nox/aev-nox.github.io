const FIREBASE_PROJECT = "global-student-project";

const NETWORK_NODES = [
    { id: 'direct', name: 'Direct (WebSocket)', url: `https://${FIREBASE_PROJECT}-default-rtdb.europe-west1.firebasedatabase.app`, type: 'WebSocket' },
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

// 1. Поиск лучшего сервера (Failover) - объявляем ПЕРВЫМ
window.triggerFailover = async function(isInitial = false) {
    console.log("[DevOps] 🚀 Запуск поиска оптимального узла...");
    const msgEl = document.getElementById('boot-msg');
    if (msgEl) msgEl.innerText = "Пинг серверов маршрутизации...";

    const promises = NETWORK_NODES.map(async (node) => {
        const start = performance.now();
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2500);
            const pingUrl = node.id === 'direct' ? `${node.url}/.json` : `${node.url}/ghost-ping`;
            
            const res = await fetch(pingUrl, { signal: controller.signal, cache: 'no-store' });
            clearTimeout(timeoutId);
            return { node, ping: Math.round(performance.now() - start), ok: res.ok || node.id !== 'direct' };
        } catch (e) {
            return { node, ping: 9999, ok: false };
        }
    });

    const results = await Promise.all(promises);
    console.log("[DevOps] Результаты пинга:", results);

    const alive = results.filter(r => r.ok).sort((a, b) => a.ping - b.ping);

    if (alive.length > 0) {
        console.log("[DevOps] ✅ Выбран лучший узел:", alive[0].node.name);
        localStorage.setItem('ghost_node', JSON.stringify(alive[0].node));
        window.location.reload();
    } else {
        console.error("[DevOps] ❌ Все узлы заблокированы!");
        if (msgEl) {
            msgEl.innerText = "КРИТИЧЕСКАЯ ОШИБКА: Все шлюзы заблокированы!";
            msgEl.style.color = "#ef4444";
        }
    }
};

// 2. Предохранитель от обрывов связи
function setupCircuitBreaker(activeNode) {
    let isConnected = false;
    let failTimeout;

    const initialTimer = setTimeout(() => {
        if (!isConnected) triggerFailover();
    }, 4000);

    db.ref('.info/connected').on('value', (snap) => {
        isConnected = snap.val() === true;
        
        const btn = document.getElementById('btn-network-status');
        if (btn) {
            btn.innerHTML = isConnected 
                ? `<span style="color:var(--success)">●</span> ${activeNode.name}`
                : `<span style="color:var(--danger)">●</span> Обрыв сети...`;
        }

        if (isConnected) {
            clearTimeout(initialTimer);
            clearTimeout(failTimeout);
            const overlay = document.getElementById('boot-overlay');
            if (overlay) overlay.style.display = 'none';
        } else {
            failTimeout = setTimeout(() => {
                if (!isConnected) triggerFailover();
            }, 4000);
        }
    });
}

// 3. Диагностика сети на странице #/network
window.renderNetworkDiagnostics = async function() {
    const activeNode = JSON.parse(localStorage.getItem('ghost_node'));
    const currentEl = document.getElementById('net-current-node');
    if (currentEl) currentEl.innerText = activeNode ? `${activeNode.name}\n${activeNode.url}` : 'Неизвестно';
    
    const mirrorsEl = document.getElementById('mirrors-list');
    if (mirrorsEl) mirrorsEl.innerHTML = MIRRORS.join('<br>');
    
    const tbody = document.getElementById('network-nodes-list');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Выполняю Live Ping...</td></tr>';

    const promises = NETWORK_NODES.map(async (node) => {
        const start = performance.now();
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2500);
            const pingUrl = node.id === 'direct' ? `${node.url}/.json` : `${node.url}/ghost-ping`;
            
            const res = await fetch(pingUrl, { signal: controller.signal, cache: 'no-store' });
            clearTimeout(timeoutId);
            return { node, ping: Math.round(performance.now() - start), ok: res.ok || node.id !== 'direct' };
        } catch (e) {
            return { node, ping: null, ok: false };
        }
    });

    const results = await Promise.all(promises);
    tbody.innerHTML = '';

    results.forEach(res => {
        let statusBadge, pingText;
        if (!res.ok) {
            statusBadge = `<span style="color:var(--danger); font-weight:bold;">🔴 Ошибка</span>`;
            pingText = "-";
        } else if (res.ping < 250) {
            statusBadge = `<span style="color:var(--success); font-weight:bold;">🟢 Отлично</span>`;
            pingText = `${res.ping} ms`;
        } else {
            statusBadge = `<span style="color:#f59e0b; font-weight:bold;">🟡 Медленно</span>`;
            pingText = `${res.ping} ms`;
        }
        
        const isCurrent = activeNode && activeNode.id === res.node.id ? " (Активен)" : "";
        
        tbody.innerHTML += `
            <tr>
                <td><strong>${res.node.name}</strong>${isCurrent}</td>
                <td style="color:var(--text-secondary); font-size:0.9em;">${res.node.type}</td>
                <td>${pingText}</td>
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

// 4. Инициализация запускается СТРОГО В КОНЦЕ
(async function initSystem() {
    let activeNode = JSON.parse(localStorage.getItem('ghost_node'));
    
    if (!activeNode) {
        const overlay = document.getElementById('boot-overlay');
        if (overlay) overlay.style.display = 'flex';
        await triggerFailover(true);
        return; 
    }

    firebase.initializeApp({
        apiKey: "AIzaSyAzCfA19BfslrhUnFBYOG72Gnd5lm_5YtI",
        authDomain: `${FIREBASE_PROJECT}.firebaseapp.com`,
        projectId: FIREBASE_PROJECT,
        databaseURL: activeNode.url
    });

    window.db = firebase.database();
    window.auth = firebase.auth();

    setupCircuitBreaker(activeNode);
    auth.signInAnonymously().catch(e => console.error("Auth error:", e));

    if (window.onFirebaseReady) window.onFirebaseReady();
})();
