// =========================================================================
// 🔥 GHOST ROUTER v2.3
// =========================================================================

const GHOST_NODES = [
    { id: "Direct (Google)", url: "https://global-student-project-default-rtdb.europe-west1.firebasedatabase.app", isProxy: false },
    { id: "Cloudflare Node", url: "https://x.zuq.workers.dev", isProxy: true }
];

function updateNetworkUI(color, text) {
    const netDot = document.getElementById('net-dot');
    const netText = document.getElementById('net-text');
    if (netDot) {
        netDot.style.background = color;
        netDot.style.boxShadow = `0 0 6px ${color}`;
    }
    if (netText) netText.textContent = text;
}

async function pingNode(node) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000); 

    try {
        const pingUrl = node.isProxy ? `${node.url}/ghost-ping` : `${node.url}/.json?shallow=true`;
        const start = Date.now();
        
        const res = await fetch(pingUrl, { signal: controller.signal, cache: 'no-store' });
        clearTimeout(timeoutId);

        if (res.status === 200 || res.status === 401) {
            return { ...node, ping: Date.now() - start };
        }
        throw new Error(`Status ${res.status}`);
    } catch (e) {
        clearTimeout(timeoutId);
        throw e;
    }
}

async function bootGhostSystem() {
    let bestNode;
    try {
        updateNetworkUI('#eab308', 'Выбор маршрута...'); 
        bestNode = await Promise.any(GHOST_NODES.map(pingNode));
        updateNetworkUI('#22c55e', `Подключен: ${bestNode.id} (${bestNode.ping}ms)`); 
    } catch (error) {
        console.warn("[!] Прямые каналы недоступны. Использование прокси-узла.");
        // Если все упали или заблокированы, берем прокси-узел по умолчанию
        bestNode = GHOST_NODES[1] || GHOST_NODES[0];
        updateNetworkUI('#f97316', `Резерв: ${bestNode.id}`); 
    }

    const firebaseConfig = {
        apiKey: "AIzaSyAzCfA19BfslrhUnFBYOG72Gnd5lm_5YtI",
        authDomain: "global-student-project.firebaseapp.com",
        projectId: "global-student-project",
        databaseURL: bestNode.url 
    };

    firebase.initializeApp(firebaseConfig);
    window.db = firebase.database();
    window.auth = firebase.auth();

    await auth.signInAnonymously().catch(e => console.error("[-] Ошибка выдачи токена", e));

    window.DOMAINS = [
        window.location.origin + window.location.pathname,
        "https://aev-nox.vercel.app/",
        "https://my-secret-domain.com/"
    ];
    window.DEFAULT_MASTER_TOKEN = "INIT-ADMIN-KEY-8f3a9b1c7d2e4f5a";

    window.ensureMasterKeyExists = async function() {
        const snap = await db.ref('admin_master_hash').once('value');
        if (!snap.exists()) {
            const defaultHash = await sha256(DEFAULT_MASTER_TOKEN);
            await db.ref('admin_master_hash').set(defaultHash);
        }
    };
    ensureMasterKeyExists();

    window.isRealAdmin = async function(userHash) {
        if (!userHash) return false;
        const snap = await db.ref(`admins/${userHash}`).once('value');
        return snap.exists() && snap.val() === true;
    };

    // Последовательно подгружаем логику
    const scripts = ['js/router.js', 'js/chat.js', 'js/admin.js'];
    for (let src of scripts) {
        await new Promise((resolve, reject) => {
            let script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.body.appendChild(script);
        });
    }

    // Мониторинг статуса соединения без перезагрузки страницы
    db.ref('.info/connected').on('value', snap => {
        if (snap.val() === true) {
            updateNetworkUI('#22c55e', `Подключен: ${bestNode.id}`);
        } else {
            updateNetworkUI('#f97316', 'Переподключение...');
        }
    });
}

bootGhostSystem();
