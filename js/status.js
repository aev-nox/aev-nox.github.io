// Конфигурация узлов системы
const RADAR_CONFIG = {
    frontends: [
        { name: "GitHub Pages", url: "https://aev-nox.github.io" },
        { name: "Vercel UI", url: "https://aev-nox.vercel.app" },
        { name: "GitLab Pages", url: "https://aev-nox.gitlab.io" }
    ],
    edges: [
        { name: "Deno Edge", url: "https://edge-deno.aev-nox.deno.net" },
        { name: "Vercel Edge", url: "https://ed-ge-vercel.vercel.app" },
        { name: "Netlify Edge", url: "https://edge-netlify.netlify.app" },
        { name: "Cloudflare Edge", url: "https://edge-flare.zuq.workers.dev" }
    ]
};

// Управление кнопками интерфейса
const btnOpenStatus = document.getElementById('btn-open-status');
if (btnOpenStatus) {
    btnOpenStatus.onclick = () => window.location.hash = '#/status';
}

const btnCloseStatus = document.getElementById('btn-close-status');
if (btnCloseStatus) {
    btnCloseStatus.onclick = () => {
        window.location.hash = mySession ? '#/app' : '';
    };
}

// Функция вывода в терминал
function logTerminal(msg, type = 'info') {
    const term = document.getElementById('status-terminal');
    if (!term) return;

    const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second:'2-digit' });
    let color = '#22c55e'; // green
    if (type === 'error') color = '#ef4444'; // red
    if (type === 'warn') color = '#f59e0b'; // orange
    if (type === 'system') color = '#60a5fa'; // blue

    const div = document.createElement('div');
    div.innerHTML = `<span style="color:#64748b;">[${time}]</span> <span style="color:${color};">${msg}</span>`;
    term.appendChild(div);
    term.scrollTop = term.scrollHeight;
}

// Замер пинга до конкретного узла
async function measurePing(url, isEdge) {
    const start = performance.now();
    try {
        const targetUrl = isEdge ? `${url}/ghost-ping` : url;
        const options = isEdge ? { cache: 'no-store' } : { mode: 'no-cors', cache: 'no-store' };
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const res = await fetch(targetUrl, { ...options, signal: controller.signal });
        clearTimeout(timeoutId);

        const latency = Math.round(performance.now() - start);
        
        if (isEdge && !res.ok) throw new Error(`HTTP ${res.status}`);
        
        let status = 'green';
        if (latency > 300) status = 'orange';
        if (latency > 800) status = 'red';
        
        return { status, latency };
    } catch (err) {
        let errMsg = err.name === 'AbortError' ? 'Таймаут соединения (>5с)' : err.message;
        logTerminal(`[!] Ошибка коннекта к ${url}: ${errMsg}`, 'error');
        return { status: 'red', latency: -1 };
    }
}

// Обновление UI конкретного узла
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

// Главная функция запуска диагностики
window.runSystemDiagnostics = async function() {
    const frontList = document.getElementById('frontend-nodes-list');
    const edgeList = document.getElementById('edge-nodes-list');
    const term = document.getElementById('status-terminal');
    const avgDisplay = document.getElementById('avg-ping-display');
    
    if (!frontList || !edgeList || !term) return;

    term.innerHTML = '';
    avgDisplay.textContent = 'Анализ...';
    avgDisplay.style.color = 'var(--text-secondary)';
    
    logTerminal('Инициализация Ghost Radar...', 'system');
    logTerminal('Запуск параллельной проверки узлов...', 'info');

    frontList.innerHTML = RADAR_CONFIG.frontends.map((f, i) => `
        <div class="node-item" id="front-${i}">
            <div class="node-name"><div class="status-indicator gray"></div> ${f.name}</div>
            <div class="node-ping">...</div>
        </div>`).join('');

    edgeList.innerHTML = RADAR_CONFIG.edges.map((e, i) => `
        <div class="node-item" id="edge-${i}">
            <div class="node-name"><div class="status-indicator gray"></div> ${e.name}</div>
            <div class="node-ping">...</div>
        </div>`).join('');

    let totalEdgePing = 0;
    let edgeSuccessCount = 0;

    const checkFrontends = RADAR_CONFIG.frontends.map(async (node, i) => {
        const res = await measurePing(node.url, false);
        updateNodeUI(`front-${i}`, res.status, res.latency);
        if (res.status === 'red') logTerminal(`${node.name} [ОФФЛАЙН] - узел недоступен`, 'error');
        else logTerminal(`${node.name} [OK] - UI узел доступен`);
    });

    const checkEdges = RADAR_CONFIG.edges.map(async (node, i) => {
        logTerminal(`Pinging Edge C2: ${node.name}...`);
        const res = await measurePing(node.url, true);
        updateNodeUI(`edge-${i}`, res.status, res.latency);
        
        if (res.status !== 'red') {
            totalEdgePing += res.latency;
            edgeSuccessCount++;
            logTerminal(`${node.name} [OK] - ${res.latency}ms`);
        } else {
            logTerminal(`${node.name} [ОФФЛАЙН] - проверьте деплой воркера`, 'error');
        }
    });

    await Promise.all([...checkFrontends, ...checkEdges]);

    if (edgeSuccessCount > 0) {
        const avg = Math.round(totalEdgePing / edgeSuccessCount);
        avgDisplay.textContent = `Средний пинг (C2): ${avg} мс`;
        avgDisplay.style.color = avg < 300 ? '#22c55e' : (avg < 800 ? '#f59e0b' : '#ef4444');
        logTerminal(`Диагностика завершена. Рабочих Edge-узлов: ${edgeSuccessCount}/${RADAR_CONFIG.edges.length}`, 'system');
    } else {
        avgDisplay.textContent = `CRITICAL: БАЗА НЕДОСТУПНА`;
        avgDisplay.style.color = '#ef4444';
        logTerminal('ВНИМАНИЕ: Все Edge-прокси недоступны. Мессенджер не сможет отправлять и получать сообщения!', 'error');
    }
};
