// ==========================================
// 🛡️ GHOST CORE: SMART NETWORK & CIRCUIT BREAKER
// ==========================================

const FIREBASE_PROJECT = "global-student-project";

// 1. Пул узлов (Direct + Proxies)
const NETWORK_NODES = [
    { id: 'direct', name: 'Direct (Google EU)', url: `https://${FIREBASE_PROJECT}-default-rtdb.europe-west1.firebasedatabase.app` },
    { id: 'deno', name: 'Deno Deploy 🦕', url: 'https://edge-deno.aev-nox.deno.net' },
    { id: 'cf', name: 'Cloudflare ⚡', url: 'https://edge-flare.zuq.workers.dev' },
    { id: 'netlify', name: 'Netlify Edge 💠', url: 'https://edge-netlify.netlify.app' },
    { id: 'vercel', name: 'Vercel Edge 🔺', url: 'https://ed-ge-vercel.vercel.app' }
];

const DOMAINS = [
    window.location.origin + window.location.pathname,
    "https://aev-nox.vercel.app/",
    "https://my-secret-domain.com/" // Заменишь потом на GitLab/GitHub
];

const DEFAULT_MASTER_TOKEN = "INIT-ADMIN-KEY-8f3a9b1c7d2e4f5a";

// 2. Определение текущего узла
let activeNode = JSON.parse(localStorage.getItem('ghost_active_node'));
if (!activeNode) {
    activeNode = NETWORK_NODES[0]; // По умолчанию пробуем Direct
    localStorage.setItem('ghost_active_node', JSON.stringify(activeNode));
}

// 3. Инициализация Firebase через выбранный узел
const firebaseConfig = {
    apiKey: "AIzaSyAzCfA19BfslrhUnFBYOG72Gnd5lm_5YtI",
    authDomain: `${FIREBASE_PROJECT}.firebaseapp.com`,
    projectId: FIREBASE_PROJECT,
    databaseURL: activeNode.url
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();

auth.signInAnonymously().catch(e => console.error("Auth error:", e));

// ==========================================
// ⚙️ ПАТТЕРН "CIRCUIT BREAKER" (ПРЕДОХРАНИТЕЛЬ)
// ==========================================
let connectionTimeout;
let isFirstConnect = true;

db.ref('.info/connected').on('value', (snap) => {
    const isConnected = snap.val() === true;
    updateNetworkUI(isConnected, activeNode);

    if (isConnected) {
        console.log(`[Network] 🟢 Связь стабильна через: ${activeNode.name}`);
        clearTimeout(connectionTimeout);
        isFirstConnect = false;
        
        const overlay = document.getElementById('reconnect-overlay');
        if (overlay) overlay.remove(); // Убираем экран переподключения, если был
    } else {
        console.warn(`[Network] ⚠️ Потеря связи. Ожидание восстановления...`);
        
        // Если это не холодный старт и связи нет > 4 секунд - инициируем Failover
        if (!isFirstConnect) {
            connectionTimeout = setTimeout(() => {
                triggerFailover();
            }, 4000); // 4 секунды на раздумья
        }
    }
});

// Глобальная функция поиска лучшего узла (Failover / Ping Race)
window.triggerFailover = async function(manual = false) {
    showReconnectingScreen(manual);
    console.warn(`[Failover] 🚀 Инициализация гонки узлов...`);

    const pingPromises = NETWORK_NODES.map(async (node) => {
        const start = performance.now();
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3500);
            
            // Если Direct - стучимся в корень. Если прокси - в наш радар /ghost-ping
            const checkUrl = node.id === 'direct' ? `${node.url}/.json` : `${node.url}/ghost-ping`;
            
            await fetch(checkUrl, { signal: controller.signal, mode: 'no-cors' });
            clearTimeout(timeoutId);
            
            return { node, ping: Math.round(performance.now() - start), status: 'ok' };
        } catch (e) {
            return { node, ping: 9999, status: 'error' };
        }
    });

    const results = await Promise.all(pingPromises);
    const aliveNodes = results.filter(r => r.status === 'ok').sort((a, b) => a.ping - b.ping);

    if (aliveNodes.length > 0) {
        const bestNode = aliveNodes[0].node;
        console.log(`[Failover] ✅ Победитель: ${bestNode.name} (${aliveNodes[0].ping}ms)`);
        
        // Если маршрут изменился или запрошено вручную — перезагружаем состояние
        if (bestNode.id !== activeNode.id || manual) {
            localStorage.setItem('ghost_active_node', JSON.stringify(bestNode));
            setTimeout(() => window.location.reload(), 300); // Soft Reload
        } else {
            // Если старый узел оказался лучшим, просто ждем восстановления
            const overlay = document.getElementById('reconnect-overlay');
            if (overlay) overlay.remove();
        }
    } else {
        document.getElementById('reconnect-msg').innerText = "КРИТИЧЕСКИЙ СБОЙ: Все шлюзы заблокированы.";
    }
}

// UI: Экран бесшовного переподключения
function showReconnectingScreen(manual) {
    if (document.getElementById('reconnect-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'reconnect-overlay';
    overlay.innerHTML = `
        <div style="background: var(--bg-surface); padding: 30px; border-radius: 12px; border: 1px solid var(--accent); text-align: center; box-shadow: 0 0 30px rgba(99, 102, 241, 0.2);">
            <h3 style="color: var(--accent); margin-top: 0;">${manual ? '📡 Смена шлюза...' : '📡 Восстановление связи...'}</h3>
            <p id="reconnect-msg" style="color: var(--text-secondary); font-size: 0.9em; margin-bottom: 0;">Поиск самого быстрого и безопасного узла</p>
            <div style="margin-top: 15px; width: 200px; height: 4px; background: var(--bg-main); border-radius: 2px; overflow: hidden; margin-left: auto; margin-right: auto;">
                <div style="width: 50%; height: 100%; background: var(--success); animation: load 1s infinite;"></div>
            </div>
        </div>
        <style>@keyframes load { 0% { transform: translateX(-100%); } 100% { transform: translateX(200%); } }</style>
    `;
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(15, 23, 42, 0.85); z-index: 9999; display: flex; justify-content: center; align-items: center; backdrop-filter: blur(4px);';
    document.body.appendChild(overlay);
}

// UI: Обновление статуса в сайдбаре
function updateNetworkUI(isConnected, node) {
    const btn = document.getElementById('btn-network-status');
    if (!btn) return;
    if (isConnected) {
        btn.innerHTML = `<span style="color:var(--success)">●</span> ${node.name}`;
        btn.style.borderColor = 'var(--border-color)';
    } else {
        btn.innerHTML = `<span style="color:var(--danger)">●</span> Обрыв...`;
        btn.style.borderColor = 'var(--danger)';
    }
}

// ==========================================
// Инициализация Admin Master Key
// ==========================================
async function ensureMasterKeyExists() {
    const snap = await db.ref('admin_master_hash').once('value');
    if (!snap.exists()) {
        const defaultHash = await sha256(DEFAULT_MASTER_TOKEN);
        await db.ref('admin_master_hash').set(defaultHash);
    }
}
ensureMasterKeyExists();

async function isRealAdmin(userHash) {
    if (!userHash) return false;
    const snap = await db.ref(`admins/${userHash}`).once('value');
    return snap.exists() && snap.val() === true;
}
