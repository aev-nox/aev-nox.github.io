const PROXY_CONFIGS = {
    "cloudflare": "https://db-1.zuq.workers.dev",
    "vercel": "https://ed-ge-vercel.vercel.app", 
    "netlify": "https://edge-netlify.netlify.app",
    "valtown": "https://aev-nox.val.run",
    "supabase": "https://zboprzptouqewmnefdxe.supabase.co/functions/v1/aev-nox"
};

const DOMAINS = [
    "https://aev-nox.github.io/",
    "https://aev-nox.vercel.app/",
    "https://aev-nox.web.app/"
];

const DEFAULT_MASTER_TOKEN = "INIT-ADMIN-KEY-8f3a9b1c7d2e4f5a";

window.APP_CONFIG = {
    API_BASE_URL: PROXY_CONFIGS["cloudflare"],
    POLL_INTERVAL: 1500,
    VERSION: "2.0-d1"
};

async function startGhostCore(selectedProxy) {
    localStorage.setItem('ghost_db_proxy', selectedProxy);
    window.APP_CONFIG.API_BASE_URL = 
        PROXY_CONFIGS[selectedProxy] || PROXY_CONFIGS["cloudflare"];

    console.log(`[Ghost Proxy] Узел: ${selectedProxy}. API: ` +
        window.APP_CONFIG.API_BASE_URL);

    const appScripts = [
        'js/status.js', 
        'js/proxy.js', 
        'js/chat.js',
        'js/admin.js',
        'js/router.js' 
    ];
    
    for (let src of appScripts) {
        await new Promise((resolve, reject) => {
            if (document.querySelector(`script[src="${src}"]`)) return resolve();
            const s = document.createElement('script');
            s.src = src;
            s.async = false; 
            s.onload = resolve;
            s.onerror = reject;
            document.body.appendChild(s);
        });
    }
}

async function measureGKping(key, urlString) {
    const start = performance.now();
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500); 
        
        const res = await fetch(urlString, { 
            method: 'OPTIONS', signal: controller.signal 
        });
        clearTimeout(timeoutId);
        
        const latency = Math.round(performance.now() - start);
        return { key, status: latency < 600 ? 'green' : 'orange', latency };
    } catch (err) {
        return { key, status: 'red', latency: -1 };
    }
}

async function verifyNodeRobust(key, url) {
    let res = await measureGKping(key, url);
    if (res.status !== 'red') return res;
    
    console.warn(`[Gatekeeper] Сбой узла ${key}. Ждем 1.5с перед тестом...`);
    await new Promise(r => setTimeout(r, 1500));
    
    return await measureGKping(key, url);
}

async function runGatekeeper() {
    const modal = document.getElementById('gatekeeper-modal');
    const list = document.getElementById('gk-nodes-list');
    const btn = document.getElementById('btn-gk-confirm');
    const desc = document.getElementById('gk-desc');
    
    if(!modal) return;
    
    if (!window.location.hash.includes('#/proxy')) {
        desc.textContent = "Выберите, пожалуйста, из доступных серверов для подключения";
        desc.style.color = "#60a5fa";
    }

    modal.style.display = 'flex';
    btn.style.opacity = '0.5';
    btn.style.pointerEvents = 'none';
    btn.textContent = "Поиск доступных узлов...";

    const nodes = [
        { key: 'cloudflare', name: 'Cloudflare D1', url: PROXY_CONFIGS['cloudflare'] },
        { key: 'vercel', name: 'Vercel', url: PROXY_CONFIGS['vercel'] },
        { key: 'netlify', name: 'Netlify', url: PROXY_CONFIGS['netlify'] },
        { key: 'valtown', name: 'Val.town', url: PROXY_CONFIGS['valtown'] },
        { key: 'supabase', name: 'Supabase', url: PROXY_CONFIGS['supabase'] }
    ];

    list.innerHTML = nodes.map(n => `
        <label class="node-item" style="cursor: pointer; border: 1px solid 
        var(--border-color); background: var(--bg-surface); padding: 12px; 
        border-radius: 8px; transition: border 0.2s;" id="gk-node-${n.key}">
            <div class="node-name" style="display:flex; align-items:center; 
            gap:10px;">
                <input type="radio" name="gk_proxy" value="${n.key}" 
                style="accent-color: var(--accent); width:16px; height:16px; 
                cursor:pointer;">
                <div class="status-indicator gray" id="gk-dot-${n.key}"></div> 
                <span style="font-weight: 500; font-size: 0.95em; 
                color: var(--text-primary);">${n.name}</span>
            </div>
            <div class="node-ping" id="gk-ping-${n.key}" style="font-family: 
            monospace; font-size: 0.9em; color: var(--text-secondary);">...</div>
        </label>
    `).join('');

    const radios = document.querySelectorAll('input[name="gk_proxy"]');
    radios.forEach(r => r.addEventListener('change', () => {
        document.querySelectorAll('label[id^="gk-node-"]').forEach(lbl => 
            lbl.style.borderColor = 'var(--border-color)');
        document.getElementById(`gk-node-${r.value}`).style.borderColor = 
            'var(--accent)';
        
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
        btn.textContent = "Подтвердить маршрут";
    }));

    const promises = nodes.map(n => measureGKping(n.key, n.url).then(res => {
        const dot = document.getElementById(`gk-dot-${n.key}`);
        const pingText = document.getElementById(`gk-ping-${n.key}`);
        if(dot) dot.className = `status-indicator ${res.status}`;
        if(pingText) {
            pingText.textContent = res.latency >= 0 ? 
                `${res.latency} ms` : 'ОШИБКА';
            if (res.status === 'red') pingText.style.color = '#ef4444';
        }
        return res;
    }));

    const results = await Promise.all(promises);
    
    const available = results.filter(r => r.status !== 'red')
                             .sort((a,b) => a.latency - b.latency);
    
    if (available.length > 0) {
        const targetRadio = document.querySelector(
            `input[name="gk_proxy"][value="${available[0].key}"]`
        );
        if (targetRadio) {
            targetRadio.checked = true;
            targetRadio.dispatchEvent(new Event('change'));
        }
    } else {
        btn.textContent = "Нет доступных узлов";
    }

    btn.onclick = () => {
        const sel = document.querySelector('input[name="gk_proxy"]:checked');
        if(!sel) return alert("Выберите узел из списка.");
        
        localStorage.setItem('ghost_db_proxy', sel.value);
        modal.style.display = 'none';
        window.location.reload(); 
    };
}

window.addEventListener('DOMContentLoaded', async () => {
    const savedProxy = localStorage.getItem('ghost_db_proxy');
    const isSafeMode = window.location.hash === '#/proxy';

    if (isSafeMode) {
        runGatekeeper();
        return;
    }

    if (savedProxy && PROXY_CONFIGS[savedProxy]) {
        console.log(`[Gatekeeper] Старт проверки узла: ${savedProxy}...`);
        
        const res = await verifyNodeRobust(
            savedProxy, PROXY_CONFIGS[savedProxy]
        );
        
        if (res.status !== 'red') {
            startGhostCore(savedProxy);
        } else {
            console.warn(`[Gatekeeper] ⚠️ Узел ${savedProxy} не отвечает.`);
            runGatekeeper();
        }
    } else {
        runGatekeeper();
    }
});
