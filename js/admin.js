document.getElementById('btn-open-admin').onclick = () => window.location.hash = '#/admin';
document.getElementById('btn-close-admin').onclick = () => window.location.hash = '#/app';

let adminPollTimer = null;

// Главная функция отрисовки
window.initAdminPanel = async function() {
    if (!mySession || !mySession.isAdmin) return;
    
    try {
        const res = await fetch(`${window.APP_CONFIG.API_BASE_URL}/api/admin/users`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ admin_hash: mySession.u })
        });
        
        const data = await res.json();
        if (data.status === 'success') {
            const tbody = document.getElementById('admin-users-list');
            if (!tbody) return;
            tbody.innerHTML = '';
            
            data.users.forEach(u => {
                const hash = u.user_hash;
                const name = decodeBase64(u.name_b64);
                // Считаем онлайн, если был активен последние 40 секунд
                const isOnline = u.last_seen && (Date.now() - u.last_seen < 40000);
                
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${escapeHTML(name)}</strong><br><span style="font-size:0.7em;color:#94a3b8;">${hash.substring(0,8)}...</span></td>
                    <td>${u.is_banned ? '⛔ Забанен' : (isOnline ? '🟢 Онлайн' : '⚪ Оффлайн')}</td>
                    <td>${formatTime(u.last_seen)}</td>
                    <td class="action-btns">
                        ${u.is_banned 
                            ? `<button class="btn-unban" onclick="toggleBan('${hash}', false)">Разбанить</button>` 
                            : `<button class="btn-ban" onclick="toggleBan('${hash}', true)">Забанить</button>`}
                        <button class="btn-edit" onclick="editUser('${hash}', '${escapeHTML(name)}')">✏️ Имя</button>
                        <button class="btn-sm" style="background:#f59e0b; color:#000;" onclick="resetPassword('${hash}')">🔑 Сброс пароля</button>
                        <button class="btn-sm" style="background:#6366f1;" onclick="regenerateUserLink('${hash}')">🔄 Ссылка</button>
                        <button class="btn-delete" onclick="deleteUserCompletely('${hash}')">❌ Удалить</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }
    } catch(e) { console.error("Ошибка загрузки админ-панели", e); }

    // Обновляем список каждые 10 секунд пока открыта админка
    if (window.location.hash === '#/admin') {
        if (adminPollTimer) clearTimeout(adminPollTimer);
        adminPollTimer = setTimeout(initAdminPanel, 10000);
    }
};

window.toggleBan = async function(targetHash, state) {
    if(!confirm(state ? "Заблокировать пользователя?" : "Разблокировать пользователя?")) return;
    try {
        await fetch(`${window.APP_CONFIG.API_BASE_URL}/api/admin/ban`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ admin_hash: mySession.u, target_hash: targetHash, state: state })
        });
        initAdminPanel();
    } catch(e) { alert("Ошибка сети"); }
};

window.editUser = async function(targetHash, currentName) {
    const newName = prompt("Введите новое имя:", currentName);
    if (newName && newName.trim().length >= 2) {
        try {
            await fetch(`${window.APP_CONFIG.API_BASE_URL}/api/admin/rename`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ admin_hash: mySession.u, target_hash: targetHash, new_name_b64: encodeBase64(newName.trim()) })
            });
            initAdminPanel();
        } catch(e) { alert("Ошибка сети"); }
    }
};

window.resetPassword = async function(targetHash) {
    const msg = "ВНИМАНИЕ: Сброс пароля сотрет крипто-ключи пользователя. СТАРЫЕ ЧАТЫ СТАНУТ НЕЧИТАЕМЫМИ.\nПродолжить сброс?";
    if (!confirm(msg)) return;
    try {
        await fetch(`${window.APP_CONFIG.API_BASE_URL}/api/admin/reset-keys`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ admin_hash: mySession.u, target_hash: targetHash })
        });
        alert("Ключи сброшены. При следующем входе пользователь должен задать новый пароль.");
        initAdminPanel();
    } catch(e) { alert("Ошибка сети"); }
};

window.deleteUserCompletely = async function(targetHash) {
    if (!confirm("⚠️ ВНИМАНИЕ: Аккаунт будет удален навсегда! Продолжить?")) return;
    try {
        await fetch(`${window.APP_CONFIG.API_BASE_URL}/api/admin/delete`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ admin_hash: mySession.u, target_hash: targetHash })
        });
        initAdminPanel();
    } catch(e) { alert("Ошибка сети"); }
};

window.regenerateUserLink = async function(targetHash) {
    if(!confirm("Старая ссылка сгорит (404), будет сгенерирована новая. Продолжить?")) return;
    
    const rawToken = "GHOST-" + Math.random().toString(36).substring(2, 10).toUpperCase();
    const newInviteHash = await sha256(rawToken);

    try {
        await fetch(`${window.APP_CONFIG.API_BASE_URL}/api/admin/invite/regenerate`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ admin_hash: mySession.u, target_hash: targetHash, invite_hash: newInviteHash })
        });
        
        const display = document.getElementById('invite-links-display');
        display.style.display = 'block';
        display.innerHTML = `✅ Новая персональная ссылка пользователя:<br><br>` + DOMAINS.map(d => `${d}#/inv/${rawToken}`).join('\n');
    } catch(e) { alert("Ошибка генерации ссылки"); }
};

const btnGenerateInvite = document.getElementById('btn-generate-invite');
if (btnGenerateInvite) {
    btnGenerateInvite.addEventListener('click', async () => {
        const rawToken = "GHOST-" + Math.random().toString(36).substring(2, 10).toUpperCase();
        const newInviteHash = await sha256(rawToken);

        try {
            await fetch(`${window.APP_CONFIG.API_BASE_URL}/api/admin/invite/generate`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ admin_hash: mySession.u, invite_hash: newInviteHash })
            });

            const display = document.getElementById('invite-links-display');
            display.style.display = 'block';
            display.innerHTML = "Разошлите одну из этих ссылок:<br><br>" + DOMAINS.map(d => `${d}#/inv/${rawToken}`).join('\n');
        } catch(e) { alert("Ошибка генерации инвайта"); }
    });
}

const btnChangeMasterKey = document.getElementById('btn-change-master-key');
if (btnChangeMasterKey) {
    btnChangeMasterKey.addEventListener('click', async () => {
        const newToken = document.getElementById('master-key-input').value.trim();
        if (newToken.length < 6) return alert("Токен должен быть не менее 6 символов!");

        const newHash = await sha256(newToken);
        try {
            const res = await fetch(`${window.APP_CONFIG.API_BASE_URL}/api/admin/master-key`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ admin_hash: mySession.u, new_master_hash: newHash })
            });
            const data = await res.json();
            if (data.status === 'success') {
                const statusDiv = document.getElementById('master-key-status');
                statusDiv.style.color = '#22c55e';
                statusDiv.innerHTML = `✅ Мастер-ключ обновлен! Новая ссылка админа:<br><strong>${window.location.origin}${window.location.pathname}#/root-key/${newToken}</strong>`;
                document.getElementById('master-key-input').value = '';
            } else {
                alert("Ошибка: " + data.error);
            }
        } catch(e) { alert("Ошибка сети"); }
    });
}
