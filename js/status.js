const RADAR_CONFIG = {
    frontends: [
        { name: "Github", url: "https://aev-nox.github.io" },
        { name: "Vercel", url: "https://aev-nox.vercel.app" },
        { name: "Google", url: "https://aev-nox.web.app" }
    ],
    edges: [
        { name: "Cloudflare D1", url: "https://db-1.zuq.workers.dev" },
        { name: "Vercel", url: "https://ed-ge-vercel.vercel.app" },
        { name: "Netlify", url: "https://edge-netlify.netlify.app" },
        { name: "Val.town", url: "https://aev-nox.val.run" },
        { 
            name: "Supabase", 
            url: "https://zboprzptouqewmnefdxe.supabase.co/functions/v1/aev-nox" 
        }
    ]
};

const btnOpenStatus = document.getElementById('btn-open-status');
if (btnOpenStatus) {
    btnOpenStatus.onclick = () => window.location.hash = '#/status';
}

const btnCloseStatus = document.getElementById('btn-close-status');
if (btnCloseStatus) {
    btnCloseStatus.onclick = () => {
        const path = localStorage.getItem('ghost_session') ? '#/app' : '';
        window.location.hash = path;
    };
}

function logTerminal(msg, type = 'info') {
    const term = document.getElementById('status-terminal');
    if (!term) return;

    const time = new Date().toLocaleTimeString('ru-RU', { 
        hour: '2-digit', minute: '2-digit', second:'2-digit' 
    });
    
    let color = '#22c55e'; 
    if (type === 'error') color = '#ef4444'; 
    if (type === 'warn') color = '#f59e0b'; 
    if (type === 'system') color = '#60a5fa'; 

    const div = document.createElement('div');
    div.innerHTML = `<span style="color:#64748b;">[${time}]</span> ` +
                    `<span style="color:${color};">${msg}</span>`;
    term.appendChild(div);
    term.scrollTop = term.scrollHeight;
}

async function measurePing(url, isEdge) {
    const start = performance.now();
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        
        const fetchOptions = isEdge 
            ? { method: 'OPTIONS', signal: controller.signal } 
            : { 
                method: 'GET', 
                mode: 'no-cors', 
                cache: 'no-store', 
                signal: controller.signal 
              };
        
        await fetch(url, fetchOptions);
        clearTimeout(timeoutId);

        const latency = Math.round(performance.now() - start);
        
        let status = 'green';
        if (latency > 400) status = 'orange';
        if (latency > 1000) status = 'red';
        
        return { status, latency };
    } catch (err) {
        let errMsg = err.name === 'AbortError' ? 'Таймаут' : err.message;
        logTerminal(`[!] Ошибка коннекта к ${url}: ${errMsg}`, 'error');
        return { status: 'red', latency: -1 };
    }
}

function updateNodeUI(elementId, status, latency) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const dot = el.querySelector('.status-indicator');
    const pingText = el.querySelector('.node-ping');
    
    dot.className = `status-indicator ${status}`;
    pingText.textContent = latency >= 0 ? `${latency} ms` : 'ОФФЛАЙН';
    if (status === 'red') {
        pingText.style.color = '#ef4444';
        pingText.style.fontWeight = 'bold';
    } else if (status === 'orange') {
        pingText.style.color = '#f59e0b';
    } else {
        pingText.style.color = 'var(--text-secondary)';
    }
}

window.runSystemDiagnostics = async function() {
    // 🔥 АВТООПРЕДЕЛЕНИЕ ТЕКУЩЕГО ФРОНТЕНДА
    const frontInfo = document.getElementById('current-frontend-info');
    const coreVersion = document.getElementById('current-core-version');
    
    if (frontInfo && coreVersion) {
        const host = window.location.hostname;
        let hostName = host;
        
        if (host.includes('github.io')) hostName = 'GitHub Pages';
        else if (host.includes('vercel.app')) hostName = 'Vercel';
        else if (host.includes('netlify.app')) hostName = 'Netlify';
        else if (host.includes('web.app') || host.includes('firebaseapp.com')) hostName = 'Google Firebase';
        else if (host === 'localhost' || host === '127.0.0.1') hostName = 'Локальный сервер (Dev)';
        
        frontInfo.textContent = `${hostName} (${host})`;
        coreVersion.textContent = window.APP_CONFIG ? window.APP_CONFIG.VERSION : 'Неизвестно';
    }

    const frontList = document.getElementById('frontend-nodes-list');
    const edgeList = document.getElementById('edge-nodes-list');
    const term = document.getElementById('status-terminal');
    const avgDisplay = document.getElementById('avg-ping-display');
    
    if (!frontList || !edgeList || !term) return;

    term.innerHTML = '';
    avgDisplay.textContent = 'Анализ...';
    avgDisplay.style.color = 'var(--text-secondary)';
    
    const versionStr = window.APP_CONFIG ? window.APP_CONFIG.VERSION : 'Unknown';
    logTerminal(`Инициализация Ghost Radar (Core v${versionStr})...`, 'system');

    frontList.innerHTML = RADAR_CONFIG.frontends.map((f, i) => `
        <div class="node-item" id="front-${i}">
            <div class="node-name">
                <div class="status-indicator gray"></div> ${f.name}
            </div>
            <div class="node-ping">...</div>
        </div>`).join('');

    edgeList.innerHTML = RADAR_CONFIG.edges.map((e, i) => `
        <div class="node-item" id="edge-${i}">
            <div class="node-name">
                <div class="status-indicator gray"></div> ${e.name}
            </div>
            <div class="node-ping">...</div>
        </div>`).join('');

    let totalEdgePing = 0;
    let edgeSuccessCount = 0;

    const checkFrontends = RADAR_CONFIG.frontends.map(async (node, i) => {
        const res = await measurePing(node.url, false);
        updateNodeUI(`front-${i}`, res.status, res.latency);
        if (res.status === 'red') {
            logTerminal(`${node.name} [ОФФЛАЙН]`, 'error');
        }
    });

    const checkEdges = RADAR_CONFIG.edges.map(async (node, i) => {
        logTerminal(`Pinging C2: ${node.name}...`);
        const res = await measurePing(node.url, true);
        updateNodeUI(`edge-${i}`, res.status, res.latency);
        
        if (res.status !== 'red') {
            totalEdgePing += res.latency;
            edgeSuccessCount++;
            logTerminal(`${node.name} [OK] - ${res.latency}ms`);
        } else {
            logTerminal(`${node.name} [ОФФЛАЙН]`, 'error');
        }
    });

    await Promise.all([...checkFrontends, ...checkEdges]);

    if (edgeSuccessCount > 0) {
        const avg = Math.round(totalEdgePing / edgeSuccessCount);
        avgDisplay.textContent = `Средний пинг (API): ${avg} мс`;
        avgDisplay.style.color = avg < 400 ? '#22c55e' : 
            (avg < 1000 ? '#f59e0b' : '#ef4444');
        logTerminal(`Диагностика завершена. Рабочих узлов базы: ` + 
            `${edgeSuccessCount}/${RADAR_CONFIG.edges.length}`, 'system');
    } else {
        avgDisplay.textContent = `CRITICAL: БАЗА НЕДОСТУПНА`;
        avgDisplay.style.color = '#ef4444';
        logTerminal('ВНИМАНИЕ: Все маршруты D1 недоступны!', 'error');
    }
};
