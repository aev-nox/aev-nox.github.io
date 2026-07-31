// 2. ФУНКЦИЯ ПИНГА (С РАДАРНЫМИ ЛОГАМИ)
async function pingNode(node) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500); 

    try {
        const pingUrl = node.isProxy ? `${node.url}/ghost-ping` : `${node.url}/.json?shallow=true`;
        console.log(`[📡 РАДАР] Стучимся в узел: ${node.id} (${pingUrl})...`);
        const start = Date.now();
        
        const res = await fetch(pingUrl, { signal: controller.signal, cache: 'no-store' });
        clearTimeout(timeoutId);

        console.log(`[📥 ОТВЕТ] Узел ${node.id} вернул статус: ${res.status}`);

        if (res.status === 200 || res.status === 401) {
            return { ...node, ping: Date.now() - start };
        }
        throw new Error(`Invalid Status: ${res.status}`);
    } catch (e) {
        clearTimeout(timeoutId);
        console.warn(`[❌ МЕРТВ] Узел ${node.id} недоступен:`, e.message);
        throw e; 
    }
}

// 3. ЯДРО ЗАГРУЗКИ СИСТЕМЫ (С ЛОГАМИ ПОБЕДИТЕЛЯ)
async function bootGhostSystem() {
    let bestNode;
    try {
        updateNetworkUI('#eab308', 'Гонка пингов...'); 
        bestNode = await Promise.any(GHOST_NODES.map(pingNode));
        console.log(`[🏆 ПОБЕДИТЕЛЬ] Выбран узел: ${bestNode.id}, Пинг: ${bestNode.ping}ms`);
        updateNetworkUI('#22c55e', `Подключен: ${bestNode.id} (${bestNode.ping}ms)`); 
    } catch (error) {
        console.error(`[🚨 КРИТИЧЕСКАЯ ОШИБКА] Все узлы мертвы!`, error);
        bestNode = GHOST_NODES[0];
        updateNetworkUI('#ef4444', 'Сеть недоступна. Fallback...'); 
    }

    console.log(`[🔥 FIREBASE] Инициализация через URL: ${bestNode.url}`);

    const firebaseConfig = {
        apiKey: "AIzaSyAzCfA19BfslrhUnFBYOG72Gnd5lm_5YtI",
        authDomain: "global-student-project.firebaseapp.com",
        projectId: "global-student-project",
        databaseURL: bestNode.url 
    };

    firebase.initializeApp(firebaseConfig);
    window.db = firebase.database();
    window.auth = firebase.auth();

    await auth.signInAnonymously().catch(e => console.error("[-] Ошибка выдачи системного токена", e));

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

    const scripts = ['js/router.js', 'js/chat.js', 'js/admin.js'];
    for (let src of scripts) {
        let script = document.createElement('script');
        script.src = src;
        script.async = false; 
        document.body.appendChild(script);
    }

    let disconnectTimer;
    db.ref('.info/connected').on('value', snap => {
        console.log(`[⚡ WEBSOCKET] Статус соединения: ${snap.val()}`);
        if (snap.val() === true) {
            clearTimeout(disconnectTimer);
            updateNetworkUI('#22c55e', `Подключен: ${bestNode.id}`); 
        } else {
            updateNetworkUI('#f97316', 'Обрыв... Восстанавливаем'); 
            
            disconnectTimer = setTimeout(() => {
                updateNetworkUI('#ef4444', 'Маршрут мертв. Перезапуск...'); 
                console.error("[🔄 РЕСТАРТ] Firebase не смог поднять сокет за 10 секунд. Перезагрузка страницы.");
                window.location.reload();
            }, 10000);
        }
    });
}
