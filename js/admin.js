// 🔥 Кастомные красивые уведомления (Замена стандартным alert/confirm/prompt)
window.adminAlert = function(msg) {
    const div = document.createElement('div');
    div.style.cssText = "position:fixed;top:20px;right:20px;background:#ef4444;color:#fff;padding:12px 20px;border-radius:8px;z-index:10000;box-shadow:0 10px 15px -3px rgba(0,0,0,0.5); font-weight:500;";
    div.innerText = msg;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 4000);
};

window.adminConfirm = function(msg, onConfirm) {
    const overlay = document.createElement('div');
    overlay.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.75);display:flex;justify-content:center;align-items:center;z-index:10000;";
    const box = document.createElement('div');
    box.style.cssText = "background:var(--bg-surface);padding:25px;border-radius:12px;max-width:400px;text-align:center;border:1px solid var(--border-color);box-shadow:0 25px 50px -12px rgba(0,0,0,0.6);";
    box.innerHTML = `<p style="color:var(--text-primary);margin-bottom:25px;line-height:1.5;">${msg}</p>
                     <div style="display:flex;justify-content:center;gap:15px;">
                        <button id="btn-c-no" style="padding:10px 20px;background:var(--bg-hover);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:bold;">Отмена</button>
                        <button id="btn-c-yes" style="padding:10px 20px;background:var(--danger);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:bold;">Подтвердить</button>
                     </div>`;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    document.getElementById('btn-c-no').onclick = () => overlay.remove();
    document.getElementById('btn-c-yes').onclick = () => { overlay.remove(); onConfirm(); };
};

window.adminPrompt = function(msg, defaultVal, onComplete) {
    const overlay = document.createElement('div');
    overlay.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.75);display:flex;justify-content:center;align-items:center;z-index:10000;";
    const box = document.createElement('div');
    box.style.cssText = "background:var(--bg-surface);padding:25px;border-radius:12px;max-width:400px;text-align:center;border:1px solid var(--border-color);width:90%;box-shadow:0 25px 50px -12px rgba(0,0,0,0.6);";
    box.innerHTML = `<p style="color:var(--text-primary);margin-bottom:15px;font-weight:bold;">${msg}</p>
                     <input type="text" id="prompt-input" value="${defaultVal}" style="width:100%;padding:12px;margin-bottom:25px;background:var(--bg-main);color:#fff;border:1px solid var(--border-color);border-radius:8px;box-sizing:border-box;outline:none;">
                     <div style="display:flex;justify-content:center;gap:15px;">
                        <button id="btn-p-no" style="padding:10px 20px;background:var(--bg-hover);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:bold;">Отмена</button>
                        <button id="btn-p-yes" style="padding:10px 20px;background:var(--accent);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:bold;">Сохранить</button>
                     </div>`;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    
    document.getElementById('prompt-input').focus();
    document.getElementById('btn-p-no').onclick = () => overlay.remove();
    document.getElementById('btn-p-yes').onclick = () => { 
        const val = document.getElementById('prompt-input').value;
        overlay.remove(); 
        if (val) onComplete(val); 
    };
};

document.getElementById('btn-open-admin').onclick = () => window.location.hash = '#/admin';
document.getElementById('btn-close-admin').onclick = () => window.location.hash = '#/app';

let onlineUsers = new Set();
db.ref('presence').on('value', snap => {
    onlineUsers.clear();
    snap.forEach(c => {
        onlineUsers.add(c.key);
    });
    if (window.location.hash === '#/admin') {
        initAdminPanel();
    }
});

function initAdminPanel() {
    db.ref('users').once('value', snap => {
        const tbody = document.getElementById('admin-users-list');
        tbody.innerHTML = '';
        
        snap.forEach(child => {
            const data = child.val();
            const hash = child.key;

            if (!data || !data.n) {
                db.ref(`users/${hash}`).remove();
                return;
            }

            const name = decodeBase64(data.n);
            const isOnline = onlineUsers.has(hash);
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${escapeHTML(name)}</strong><br><span style="font-size:0.7em;color:#94a3b8;">${hash.substring(0,8)}...</span></td>
                <td>${data.isBanned ? '⛔ Забанен' : (isOnline ? '🟢 Онлайн' : '⚪ Оффлайн')}</td>
                <td>${formatTime(data.lastSeen)}</td>
                <td class="action-btns">
                    ${data.isBanned 
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
    });
}

function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}

window.toggleBan = function(userHash, state) {
    adminConfirm(state ? "Заблокировать пользователя?" : "Разблокировать пользователя?", async () => {
        await db.ref(`users/${userHash}/isBanned`).set(state);
        initAdminPanel();
    });
};

window.editUser = function(userHash, currentName) {
    adminPrompt("Введите новое имя:", currentName, async (newName) => {
        if (newName && newName.trim().length >= 2) {
            await db.ref(`users/${userHash}/n`).set(encodeBase64(newName.trim()));
            initAdminPanel();
        }
    });
};

window.resetPassword = function(userHash) {
    const msg = "ВНИМАНИЕ: Сброс пароля сотрет крипто-ключи пользователя (End-to-End). Он сможет войти и придумать новый пароль, но СТАРЫЕ ЧАТЫ СТАНУТ НЕЧИТАЕМЫМИ.\n\nПродолжить сброс?";
    adminConfirm(msg, async () => {
        await db.ref(`users/${userHash}/ph`).remove();
        await db.ref(`users/${userHash}/pk`).remove();
        await db.ref(`users/${userHash}/epk`).remove();
        adminAlert("Ключи сброшены. При следующем входе по своей ссылке пользователь должен задать новый пароль.");
    });
};

window.deleteUserCompletely = function(userHash) {
    adminConfirm("⚠️ ВНИМАНИЕ: Аккаунт будет удален навсегда! Продолжить?", async () => {
        await db.ref(`users/${userHash}`).remove();
        await db.ref(`presence/${userHash}`).remove();
        await db.ref(`admins/${userHash}`).remove();

        const invitesSnap = await db.ref('invites').once('value');
        invitesSnap.forEach(child => {
            if (child.val().userHash === userHash) db.ref(`invites/${child.key}`).remove();
        });
        
        initAdminPanel();
    });
};

window.regenerateUserLink = function(userHash) {
    adminConfirm("Математика Zero-Knowledge запрещает хранить ссылки в открытом виде. Старая ссылка сгорит (404), будет сгенерирована новая. Продолжить?", async () => {
        const rawToken = "GHOST-" + Math.random().toString(36).substring(2, 10).toUpperCase();
        const hashedToken = await sha256(rawToken);

        const invitesSnap = await db.ref('invites').once('value');
        invitesSnap.forEach(child => {
            if (child.val().userHash === userHash) db.ref(`invites/${child.key}`).remove();
        });

        await db.ref(`invites/${hashedToken}`).set({
            userHash: userHash,
            registered: true,
            updatedAt: Date.now()
        });

        await db.ref(`users/${userHash}/linkRevokedAt`).set(Date.now());

        const display = document.getElementById('invite-links-display');
        display.style.display = 'block';
        display.innerHTML = `✅ Новая персональная ссылка пользователя:<br><br>` + DOMAINS.map(d => `${d}#/inv/${rawToken}`).join('\n');
    });
};

document.getElementById('btn-generate-invite').addEventListener('click', async () => {
    const rawToken = "GHOST-" + Math.random().toString(36).substring(2, 10).toUpperCase();
    const hashedToken = await sha256(rawToken);
    await db.ref(`invites/${hashedToken}`).set({ createdBy: mySession.u, timestamp: Date.now() });
    
    const display = document.getElementById('invite-links-display');
    display.style.display = 'block';
    display.innerHTML = "Разошлите одну из этих ссылок:<br><br>" + DOMAINS.map(d => `${d}#/inv/${rawToken}`).join('\n');
});

document.getElementById('btn-change-master-key').addEventListener('click', async () => {
    const newToken = document.getElementById('master-key-input').value.trim();
    if (newToken.length < 6) return adminAlert("Токен должен быть не менее 6 символов!");

    const newHash = await sha256(newToken);
    await db.ref('admin_master_hash').set(newHash);
    
    const statusDiv = document.getElementById('master-key-status');
    statusDiv.style.color = '#22c55e';
    statusDiv.innerHTML = `✅ Мастер-ключ обновлен! Новая ссылка админа:<br><strong>${window.location.origin}${window.location.pathname}#/root-key/${newToken}</strong>`;
    document.getElementById('master-key-input').value = '';
});

// 🔥 ЭТАП 3: Управление динамической конфигурацией серверов
db.ref('system_config').on('value', snap => {
    // Если в базе пусто, берем дефолтные значения из кода
    const data = snap.val() || {
        PROXY_CONFIGS: window.PROXY_CONFIGS,
        DOMAINS: window.DOMAINS,
        PROXY_NAMES: window.PROXY_NAMES,
        RADAR_CONFIG: window.RADAR_CONFIG
    };
    
    const textarea = document.getElementById('admin-config-json');
    // Обновляем текстарею только если фокус ввода не находится в ней (чтобы не стереть то, что печатает админ)
    if (textarea && document.activeElement !== textarea) { 
        textarea.value = JSON.stringify(data, null, 4);
    }
});

document.getElementById('btn-save-config').addEventListener('click', async () => {
    const btn = document.getElementById('btn-save-config');
    const originalText = btn.innerHTML;
    try {
        const jsonStr = document.getElementById('admin-config-json').value;
        const parsed = JSON.parse(jsonStr); // Проверка на валидность JSON формата
        
        btn.innerHTML = "⏳ Сохранение...";
        btn.style.opacity = '0.7';
        
        await db.ref('system_config').set(parsed);
        
        // Визуальное уведомление об успехе прямо на кнопке
        btn.style.background = '#10b981'; // Green
        btn.innerHTML = "✅ Сохранено!";
        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.style.opacity = '1';
            btn.style.background = '#22c55e';
        }, 2000);
        
    } catch (e) {
        adminAlert("❌ Ошибка сохранения! Проверьте правильность синтаксиса JSON (отсутствующие кавычки, лишние запятые, скобки).");
        btn.innerHTML = originalText;
        btn.style.opacity = '1';
    }
});

handleRoute();
