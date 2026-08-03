// Конфигурации прокси-узлов (Canary Release Pattern)
// 🔥 ПАТЧ: Жестко привязываем namespace (?ns=) к кастомным прокси-доменам, 
// чтобы Firebase SDK понимал, к какой БД обращаться, и не выдавал 404.
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

// 🔥 ПРИНУДИТЕЛЬНЫЙ HTTP LONG POLLING ДЛЯ ПРОКСИ
// Чтобы Vercel/Netlify/Cloudflare не обрывали соединение по таймауту сокета,
// мы "прячем" поддержку WebSockets от браузера, переключая транспорт на HTTP GET/POST.
if (activeProxy !== 'direct') {
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
