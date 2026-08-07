// Конфигурации прокси-узлов (Canary Release Pattern)
// 🔥 ИЗМЕНЕНИЕ: const заменены на var для возможности переопределения
var PROXY_CONFIGS = {
    "direct": "https://global-student-project-default-rtdb.europe-west1.firebasedatabase.app",
    "deno": "https://edge-deno.aev-nox.deno.net/?ns=global-student-project-default-rtdb",
    "vercel": "https://ed-ge-vercel.vercel.app/?ns=global-student-project-default-rtdb",
    "netlify": "https://edge-netlify.netlify.app/?ns=global-student-project-default-rtdb",
    "cloudflare": "https://edge-flare.zuq.workers.dev/?ns=global-student-project-default-rtdb"
};

var DOMAINS = [
    window.location.origin + window.location.pathname,
    "https://aev-nox.vercel.app/",
    "https://my-secret-domain.com/"
];

const DEFAULT_MASTER_TOKEN = "INIT-ADMIN-KEY-8f3a9b1c7d2e4f5a";

// 🔥 Функция установки перехватчиков трафика C2
function setupInterceptors(proxyOrigin) {
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        let req = args[0];
        let reqUrl = typeof req === 'string' ? req : req?.url;
        
        if (reqUrl && reqUrl.includes('googleapis.com')) {
            const urlObj = new URL(reqUrl);
            const rewrittenUrl = proxyOrigin + urlObj.pathname + urlObj.search;
            console.warn(`[C2 Intercept] Auth запрос завернут в прокси: -> ${rewrittenUrl}`);
            
            if (typeof req === 'string') args[0] = rewrittenUrl;
            else args[0] = new Request(rewrittenUrl, req);
        }
        return originalFetch.apply(this, args);
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        if (typeof url === 'string' && url.includes('googleapis.com')) {
            const urlObj = new URL(url);
            url = proxyOrigin + urlObj.pathname + urlObj.search;
            console.warn(`[C2 Intercept] XHR Auth завернут в прокси: -> ${url}`);
        }
        return originalOpen.call(this, method, url, ...rest);
    };
}

// ==========================================
// 🔥 ГЛАВНЫЙ ЗАПУСК СИСТЕМЫ (Lazy Init)
// ==========================================
async function startGhostCore(selectedProxy) {
    localStorage.setItem('ghost_db_proxy', selectedProxy);
    const targetDatabaseURL = PROXY_CONFIGS[selectedProxy];
    const proxyOrigin = new URL(targetDatabaseURL).origin;

    if (selectedProxy !== 'direct') {
        setupInterceptors(proxyOrigin);
        console.warn(`[Ghost Proxy] Узел: ${selectedProxy}. WebSockets отключены -> Активирован HTTP Long Polling.`);
        window.WebSocket = undefined; 
    } else {
        console.log("[Ghost Proxy] Прямое подключение. Режим WebSockets активен (Max Speed).");
    }

    firebase.initializeApp({
        apiKey: "AIzaSyAzCfA19BfslrhUnFBYOG72Gnd5lm_5YtI",
        authDomain: "global-student-project.firebaseapp.com",
        projectId: "global-student-project",
        databaseURL: targetDatabaseURL
    });

    window.db = firebase.database();
    window.auth = firebase.auth();

    window.auth.signInAnonymously().catch(error => {
        console.error("[-] Ошибка выдачи системного токена устройства:", error);
    });

    window.isRealAdmin = async function(userHash) {
        if (!userHash) return false;
        const snap = await window.db.ref(`admins/${userHash}`).once('value');
        return snap.exists() && snap.val() === true;
    };

    const snap = await window.db.ref('admin_master_hash').once('value');
    if (!snap.exists()) {
        const defaultHash = await sha256(DEFAULT_MASTER_TOKEN);
        await window.db.ref('admin_master_hash').set(defaultHash);
    }

    // 🔥 ПАТЧ: Строгий порядок загрузки скриптов!
    const appScripts = [
        'js/status.js', 
        'js/proxy.js', 
        'js/chat.js',   // chat.js ДОЛЖЕН быть перед router.js
        'js/admin.js',
        'js/router.js' 
    ];
    
    for (let src of appScripts) {
        await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src;
            s.async = false; 
            s.onload = resolve;
            s.onerror = reject;
            document.body.appendChild(s);
        });
    }
}

// ==========================================
// 🔥 ЛОГИКА GATEKEEPER (ПРИВРАТНИК)
// ==========================================
const savedProxy = localStorage.getItem('ghost_db_proxy');

if (savedProxy) {
    startGhostCore(savedProxy);
} else {
    window.addEventListener('DOMContentLoaded', runGatekeeper);
}

// 🔥 ПАТЧ: Исправлено склеивание URL (двойные слеши и .json для директа)
async function measureGKping(key, urlString, isEdge) {
    const start = performance.now();
    try {
        const baseUrl = urlString.split('?')[0].replace(/\/$/, ''); // Убираем слеш на конце
        const targetUrl = isEdge ? `${baseUrl}/ghost-ping` : `${baseUrl}/.json`; // Директ стучится в .json
        
        const options = isEdge ? { cache: 'no-store' } : { mode: 'no-cors', cache: 'no-store' };
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1500); 
        
        const res = await fetch(targetUrl, { ...options, signal: controller.signal });
        clearTimeout(timeoutId);
        
        const latency = Math.round(performance.now() - start);
        if (isEdge && !res.ok) throw new Error("HTTP Error");
        
        return { key, status: latency < 400 ? 'green' : 'orange', latency };
    } catch (err) {
        return { key, status: 'red', latency: -1 };
    }
}

async function runGatekeeper() {
    const modal = document.getElementById('gatekeeper-modal');
    const list = document.getElementById('gk-nodes-list');
    const btn = document.getElementById('btn-gk-confirm');
    
    modal.style.display = 'flex';

    const nodes = [
        { key: 'direct', name: 'Direct (Google Server)', url: PROXY_CONFIGS['direct'], isEdge: false },
        { key: 'cloudflare', name: 'Cloudflare Edge Proxy', url: PROXY_CONFIGS['cloudflare'], isEdge: true },
        { key: 'vercel', name: 'Vercel Edge Proxy', url: PROXY_CONFIGS['vercel'], isEdge: true },
        { key: 'netlify', name: 'Netlify Edge Proxy', url: PROXY_CONFIGS['netlify'], isEdge: true },
        { key: 'deno', name: 'Deno Edge Proxy', url: PROXY_CONFIGS['deno'], isEdge: true }
    ];

    list.innerHTML = nodes.map(n => `
        <label class="node-item" style="cursor: pointer; border: 1px solid var(--border-color); background: var(--bg-surface); padding: 12px; border-radius: 8px; transition: border 0.2s;" id="gk-node-${n.key}">
            <div class="node-name" style="display:flex; align-items:center; gap:10px;">
                <input type="radio" name="gk_proxy" value="${n.key}" style="accent-color: var(--accent); width:16px; height:16px; cursor:pointer;">
                <div class="status-indicator gray" id="gk-dot-${n.key}"></div> 
                <span style="font-weight: 500; font-size: 0.95em; color: var(--text-primary);">${n.name}</span>
            </div>
            <div class="node-ping" id="gk-ping-${n.key}" style="font-family: monospace; font-size: 0.9em; color: var(--text-secondary);">...</div>
        </label>
    `).join('');

    const radios = document.querySelectorAll('input[name="gk_proxy"]');
    radios.forEach(r => r.addEventListener('change', () => {
        document.querySelectorAll('label[id^="gk-node-"]').forEach(lbl => lbl.style.borderColor = 'var(--border-color)');
        document.getElementById(`gk-node-${r.value}`).style.borderColor = 'var(--accent)';
    }));

    const promises = nodes.map(n => measureGKping(n.key, n.url, n.isEdge).then(res => {
        const dot = document.getElementById(`gk-dot-${n.key}`);
        const pingText = document.getElementById(`gk-ping-${n.key}`);
        if(dot) dot.className = `status-indicator ${res.status}`;
        if(pingText) {
            pingText.textContent = res.latency >= 0 ? `${res.latency} ms` : 'ОФФЛАЙН';
            if (res.status === 'red') pingText.style.color = '#ef4444';
        }
        return res;
    }));

    const results = await Promise.all(promises);
    
    let bestProxy = 'direct';
    const directRes = results.find(r => r.key === 'direct');
    
    if (directRes && directRes.status === 'red') {
        const availableEdges = results.filter(r => r.key !== 'direct' && r.status !== 'red').sort((a,b) => a.latency - b.latency);
        if (availableEdges.length > 0) {
            bestProxy = availableEdges[0].key;
        } else {
            bestProxy = 'cloudflare';
        }
    }

    const targetRadio = document.querySelector(`input[name="gk_proxy"][value="${bestProxy}"]`);
    if (targetRadio) {
        targetRadio.checked = true;
        targetRadio.dispatchEvent(new Event('change'));
    }

    btn.style.opacity = '1';
    btn.style.pointerEvents = 'auto';
    btn.textContent = "Подтвердить маршрут";

    btn.onclick = () => {
        const selected = document.querySelector('input[name="gk_proxy"]:checked').value;
        modal.style.opacity = '0';
        setTimeout(() => {
            modal.style.display = 'none';
            startGhostCore(selected);
        }, 300);
    };
}