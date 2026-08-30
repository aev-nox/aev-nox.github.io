const btnOpenProxy = document.getElementById('btn-open-proxy');
if (btnOpenProxy) {
    btnOpenProxy.onclick = () => window.location.hash = '#/proxy';
}

const btnCloseProxy = document.getElementById('btn-close-proxy');
if (btnCloseProxy) {
    btnCloseProxy.onclick = () => {
        window.location.hash = localStorage.getItem('ghost_session') ? '#/app' : '';
    };
}

const PROXY_NAMES = {
    "cloudflare": "Cloudflare D1",
    "vercel": "Vercel",
    "netlify": "Netlify",
    "valtown": "Val.town",
    "supabase": "Supabase"
};

window.initProxyTester = function() {
    const container = document.getElementById('proxy-list-container');
    if (!container) return;

    const currentProxy = localStorage.getItem('ghost_db_proxy') || 'cloudflare';
    
    container.innerHTML = Object.keys(PROXY_CONFIGS).map(key => {
        const isSelected = key === currentProxy;
        const name = PROXY_NAMES[key] || key;
        const url = PROXY_CONFIGS[key];

        return `
            <label style="display: flex; align-items: center; justify-content: space-between; background: var(--bg-main); padding: 12px 15px; border-radius: 8px; border: 1px solid ${isSelected ? '#8b5cf6' : 'var(--border-color)'}; cursor: pointer;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <input type="radio" name="proxy_select" value="${key}" ${isSelected ? 'checked' : ''} style="accent-color: #8b5cf6; width: 18px; height: 18px; cursor: pointer;">
                    <div>
                        <div style="font-weight: bold; color: ${isSelected ? '#8b5cf6' : 'var(--text-primary)'}; font-size: 0.95em;">${name}</div>
                        <div style="font-family: monospace; font-size: 0.75em; color: var(--text-secondary); margin-top: 2px;">${url}</div>
                    </div>
                </div>
                ${isSelected ? '<span style="font-size: 0.8em; background: rgba(139, 92, 246, 0.2); color: #c084fc; padding: 3px 8px; border-radius: 4px; font-weight: bold;">Активен</span>' : ''}
            </label>
        `;
    }).join('');
};

const btnApplyProxy = document.getElementById('btn-apply-proxy');
if (btnApplyProxy) {
    btnApplyProxy.onclick = () => {
        const selected = document.querySelector('input[name="proxy_select"]:checked');
        if (!selected) return;

        const newProxy = selected.value;
        const currentProxy = localStorage.getItem('ghost_db_proxy') || 'cloudflare';

        if (newProxy === currentProxy) {
            alert("Этот маршрут уже выбран!");
            return;
        }

        localStorage.setItem('ghost_db_proxy', newProxy);
        alert(`Маршрут переключен на: [${newProxy.toUpperCase()}]. Страница будет перезагружена.`);
        
        window.location.hash = '#/app';
        window.location.reload();
    };
}
