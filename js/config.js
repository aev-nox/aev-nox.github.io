// =========================================================================
// 🔥 GHOST ROUTER (Multi-CDN Failover & Smart Bootloader)
// =========================================================================

// 1. ПУЛ ДОМЕНОВ (Сюда можно добавлять сколько угодно резервных прокси)
const GHOST_NODES = [
    { id: "Direct (Google)", url: "https://global-student-project-default-rtdb.europe-west1.firebasedatabase.app", isProxy: false },
    { id: "Cloudflare Node", url: "https://x.zuq.workers.dev", isProxy: true }
    // { id: "Deno Node", url: "https://твой-дено-прокси.deno.dev", isProxy: true }
];

// Утилита: UI Индикатор сети
function updateNetworkUI(color, text) {
    const netDot = document.getElementById('net-dot');
    const netText = document.getElementById('net-text');
    if (netDot) {
        netDot.style.background = color;
        netDot.style.boxShadow = `0 0 6px ${color}`;
    }
    if (netText) netText.textContent = text;
}

// 2. ФУНКЦИЯ ПИНГА
async function pingNode(node) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500); // ⏱ Строгий таймаут 2.5 сек на ответ

    try {
        // Если прокси - стучим в наш спец. маршрут. Если Direct - проверяем доступность корня БД.
        const pingUrl = node.isProxy ? `${node.url}/ghost-ping` : `${node.url}/.json?shallow=true`;
        const start = Date.now();
        
        const res = await fetch(pingUrl, { signal: controller.signal, cache: 'no-store' });
        clearTimeout(timeoutId);

        // 401 Unauthorized - это отличный ответ для Direct (значит база жива, но сработал Zero Trust)
        // 200 OK - отличный ответ для нашего прокси
        if (res.status === 200 || res.status === 401) {
            return { ...node, ping: Date.now() - start };
        }
        throw new Error(`Invalid Status: ${res.status}`);
    } catch (e) {
        clearTimeout(timeoutId);
        throw e; // Прокси или прямой маршрут заблокирован/недоступен
    }
}

// 3. ЯДРО ЗАГРУЗКИ СИСТЕМЫ
async function bootGhostSystem() {
    let bestNode;
    try {
        updateNetworkUI('#eab308', 'Гонка пингов...'); // Желтый
        // Запускаем гонку! Promise.any вернет ТОЛЬКО первого успешного
        bestNode = await Promise.any(GHOST_NODES.map(pingNode));
        updateNetworkUI('#22c55e', `Подключен: ${bestNode.id} (${bestNode.ping}ms)`); // Зеленый
    } catch (error) {
        // Если заблокировано ВООБЩЕ ВСЁ (нет интернета или упали все CDN)
        bestNode = GHOST_NODES[0];
        updateNetworkUI('#ef4444', 'Сеть недоступна. Fallback...'); // Красный
    }

    // 4. ИНИЦИАЛИЗАЦИЯ FIREBASE ЧЕРЕЗ ПОБЕДИТЕЛЯ
    const firebaseConfig = {
        apiKey: "AIzaSyAzCfA19BfslrhUnFBYOG72Gnd5lm_5YtI",
        authDomain: "global-student-project.firebaseapp.com",
        projectId: "global-student-project",
        databaseURL: bestNode.url // 🔥 Вся магия обхода здесь
    };

    firebase.initializeApp(firebaseConfig);
    window.db = firebase.database();
    window.auth = firebase.auth();

    // 5. ПОЛУЧЕНИЕ СИСТЕМНОГО ТОКЕНА
    await auth.signInAnonymously().catch(e => console.error("[-] Ошибка выдачи системного токена", e));

    // 6. ГЛОБАЛЬНЫЕ КОНСТАНТЫ
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

    // 7. 🔥 ДИНАМИЧЕСКАЯ ЗАГРУЗКА ЛОГИКИ (Абсолютно безопасно для старого кода)
    // Эти скрипты загрузятся и выполнятся ТОЛЬКО когда база уже подменена и готова к работе
    const scripts = ['js/router.js', 'js/chat.js', 'js/admin.js'];
    for (let src of scripts) {
        let script = document.createElement('script');
        script.src = src;
        script.async = false; // Важно: сохраняем порядок выполнения (router -> chat -> admin)
        document.body.appendChild(script);
    }

    // 8. МОНИТОР ЖИЗНИ СОЕДИНЕНИЯ (Отлов обрывов во время чата)
    let disconnectTimer;
    db.ref('.info/connected').on('value', snap => {
        if (snap.val() === true) {
            clearTimeout(disconnectTimer);
            updateNetworkUI('#22c55e', `Подключен: ${bestNode.id}`); // Зеленый
        } else {
            updateNetworkUI('#f97316', 'Обрыв... Восстанавливаем'); // Оранжевый
            
            // Если Firebase не смог сам переподключиться за 10 секунд - прокси мертв.
            // Делаем релоад, чтобы код заново запустил "Гонку Пингов" и нашел новый прокси.
            disconnectTimer = setTimeout(() => {
                updateNetworkUI('#ef4444', 'Маршрут мертв. Перезапуск...'); // Красный
                window.location.reload();
            }, 10000);
        }
    });
}

// Запуск системы!
bootGhostSystem();
