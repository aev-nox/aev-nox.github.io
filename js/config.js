// Конфигурации прокси-узлов (Canary Release Pattern)
// Жестко привязываем namespace (?ns=) к кастомным прокси-доменам
const PROXY_CONFIGS = {
    "direct": "https://global-student-project-default-rtdb.europe-west1.firebasedatabase.app",
    "deno": "https://edge-deno.aev-nox.deno.net/?ns=global-student-project-default-rtdb",
    "vercel": "https://ed-ge-vercel.vercel.app/?ns=global-student-project-default-rtdb",
    "netlify": "https://edge-netlify.netlify.app/?ns=global-student-project-default-rtdb",
    "cloudflare": "https://edge-flare.zuq.workers.dev/?ns=global-student-project-default-rtdb"
};

// Читаем выбранный узел из памяти (по умолчанию - прямой коннект)
const activeProxy = localStorage.getItem('ghost_db_proxy') || 'direct';
const targetDatabaseURL = PROXY_CONFIGS[activeProxy] || PROXY_CONFIGS['direct'];
const proxyOrigin = new URL(targetDatabaseURL).origin; // Чистый домен прокси (например, https://edge-flare.zuq.workers.dev)

// 🔥 ZERO TRUST C2: ПЕРЕХВАТЧИК ТРАФИКА И БЛОКИРОВКА СОКЕТОВ
if (activeProxy !== 'direct') {
    
    // 1. Перехват FETCH (Заворачиваем авторизацию Firebase в наш прокси)
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        let req = args[0];
        let reqUrl = typeof req === 'string' ? req : req?.url;
        
        // Перехватываем вызовы к googleapis.com и подменяем на наш Edge Worker
        if (reqUrl && reqUrl.includes('googleapis.com')) {
            const urlObj = new URL(reqUrl);
            const rewrittenUrl = proxyOrigin + urlObj.pathname + urlObj.search;
            
            console.warn(`[C2 Intercept] Auth запрос завернут в прокси: -> ${rewrittenUrl}`);
            
            if (typeof req === 'string') {
                args[0] = rewrittenUrl;
            } else {
                args[0] = new Request(rewrittenUrl, req);
            }
        }
        return originalFetch.apply(this, args);
    };

    // 2. Перехват XHR (Для старых методов внутри SDK)
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        if (typeof url === 'string' && url.includes('googleapis.com')) {
            const urlObj = new URL(url);
            url = proxyOrigin + urlObj.pathname + urlObj.search;
            console.warn(`[C2 Intercept] XHR Auth завернут в прокси: -> ${url}`);
        }
        return originalOpen.call(this, method, url, ...rest);
    };

    // 3. Отключение WebSockets для форсирования HTTP Long Polling
    console.warn(`[Ghost Proxy] Узел: ${activeProxy}. WebSockets отключены -> Активирован HTTP Long Polling.`);
    window.WebSocket = undefined; 
} else {
    console.log("[Ghost Proxy] Прямое подключение. Режим WebSockets активен (Max Speed).");
}

// Настройка базы и глобальные константы
const firebaseConfig = {
    apiKey: "AIzaSyAzCfA19BfslrhUnFBYOG72Gnd5lm_5YtI",
    authDomain: "global-student-project.firebaseapp.com",
    projectId: "global-student-project",
    databaseURL: targetDatabaseURL
};
firebase.initializeApp(firebaseConfig);

const db = firebase.database();
const auth = firebase.auth(); // Экземпляр авторизации

const DOMAINS = [
    window.location.origin + window.location.pathname,
    "https://aev-nox.vercel.app/",
    "https://my-secret-domain.com/"
];

// Дефолтная ссылка-мастер (можно сменить в админке)
const DEFAULT_MASTER_TOKEN = "INIT-ADMIN-KEY-8f3a9b1c7d2e4f5a";

// 🔥 ZERO TRUST: Принудительная анонимная авторизация устройства
auth.signInAnonymously().catch(error => {
    console.error("[-] Ошибка выдачи системного токена устройства:", error);
});

async function ensureMasterKeyExists() {
    const snap = await db.ref('admin_master_hash').once('value');
    if (!snap.exists()) {
        const defaultHash = await sha256(DEFAULT_MASTER_TOKEN);
        await db.ref('admin_master_hash').set(defaultHash);
    }
}
ensureMasterKeyExists();

// Глобальная функция проверки прав
async function isRealAdmin(userHash) {
    if (!userHash) return false;
    const snap = await db.ref(`admins/${userHash}`).once('value');
    return snap.exists() && snap.val() === true;
}
