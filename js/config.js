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

// 1. Инициализация Сети (Гонка Пингов ДО запуска Firebase)
(async function initSystem() {
    let activeNode = JSON.parse(localStorage.getItem('ghost_node'));
    
    // Если узла нет (первый вход) - запускаем принудительный поиск
    if (!activeNode) {
        document.getElementById('boot-overlay').style.display = 'flex';
        await triggerFailover(true); // Найдет узел и перезагрузит страницу
        return; 
    }

    // Если узел найден - инициализируем Firebase
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

// 2. Circuit Breaker (Предохранитель от обрывов)
function setupCircuitBreaker(activeNode) {
    let isConnected = false;
    let failTimeout;

    // Даем 4 секунды на подключение. Если не вышло - ищем новый сервер.
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
        } else {
            // Если отвалились в процессе работы - ждем 4 сек и переключаем
            failTimeout = setTimeout(() => {
                if (!isConnected) triggerFailover();
            }, 4000);
        }
    });
}

// 3. Failover (Умный поиск лучшего сервера)
window.triggerFailover = async function(isInitial = false) {
    if (!isInitial) document.getElementById('boot-overlay').style.display = 'flex';
    document.getElementById('boot-msg').innerText = "Пинг серверов маршрутизации...";

    const promises = NETWORK_NODES.map(async (node) => {
        const start = performance.now();
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);
            const pingUrl = node.id === 'direct' ? `${node.url}/.info.json` : `${node.url}/ghost-ping`;
            
            await fetch(pingUrl, { signal: controller.signal, cache: 'no-store' });
            clearTimeout(timeoutId);
            return { node, ping: Math.round(performance.now() - start), ok: true };
        } catch (e) {
            return { node, ping: 9999, ok: false };
        }
    });

    const results = await Promise.all(promises);
    const alive = results.filter(r => r.ok).sort((a, b) => a.ping - b.ping);

    if (alive.length > 0) {
        localStorage.setItem('ghost_node', JSON.stringify(alive[0].node));
        window.location.reload(); // Мягкая перезагрузка с новым сервером
    } else {
        document.getElementById('boot-msg').innerText = "КРИТИЧЕСКАЯ ОШИБКА: Все шлюзы заблокированы!";
        document.getElementById('boot-msg').style.color = "#ef4444";
    }
};

// 4. Отрисовка страницы диагностики DevOps
window.renderNetworkDiagnostics = async function() {
    const activeNode = JSON.parse(localStorage.getItem('ghost_node'));
    document.getElementById('net-current-node').innerText = activeNode ? `${activeNode.name}\n${activeNode.url}` : 'Неизвестно';
    document.getElementById('mirrors-list').innerHTML = MIRRORS.join('<br>');
    
    const tbody = document.getElementById('network-nodes-list');
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Выполняю Live Ping...</td></tr>';

    const promises = NETWORK_NODES.map(async (node) => {
        const start = performance.now();
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);
            const pingUrl = node.id === 'direct' ? `${node.url}/.info.json` : `${node.url}/ghost-ping`;
            
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
        let statusBadge, pingText;
        if (!res.ok) {
            statusBadge = `<span style="color:var(--danger); font-weight:bold;">🔴 Ошибка</span>`;
            pingText = "-";
        } else if (res.ping < 200) {
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
