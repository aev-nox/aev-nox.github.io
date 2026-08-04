// =========================================================
// admin.js - ПАНЕЛЬ АДМИНИСТРАТОРА И УПРАВЛЕНИЕ ЛИМИТАМИ (v3.1)
// =========================================================

document.getElementById('btn-open-admin').onclick = () => window.location.hash = '#/admin';
document.getElementById('btn-close-admin').onclick = () => window.location.hash = '#/app';

let onlineUsers = new Set();

// Отслеживание онлайна для таблицы
db.ref('presence').on('value', snap => {
    onlineUsers.clear();
    snap.forEach(c => {
        if (c.val() === true) onlineUsers.add(c.key);
    });
    if (window.location.hash === '#/admin') {
        initAdminPanel();
    }
});

// 🔥 ДИНАМИЧЕСКИЕ НАСТРОЙКИ СИСТЕМЫ (Броня БД)
const DEFAULT_SETTINGS = {
    max_users: 50,
    max_name_len: 50,
    max_msg_len: 3000,
    max_contacts: 30,
    kill_switch: false
};

// Загрузка актуальных настроек с серверов Google
async function loadDynamicSettings() {
    try {
        const snap = await db.ref('settings').once('value');
        let cfg = snap.exists() ? snap.val() : {};
        
        // Если ветка настроек еще не создана — создаем дефолтные
        if (!snap.exists()) {
            await db.ref('settings').set(DEFAULT_SETTINGS);
            cfg = DEFAULT_SETTINGS;
        }

        const el = (id) => document.getElementById(id);
        if (el('cfg-max-users')) el('cfg-max-users').value = cfg.max_users ?? 50;
        if (el('cfg-max-name')) el('cfg-max-name').value = cfg.max_name_len ?? 50;
        if (el('cfg-max-msg')) el('cfg-max-msg').value = cfg.max_msg_len ?? 3000;
        if (el('cfg-max-contacts')) el('cfg-max-contacts').value = cfg.max_contacts ?? 30;
        if (el('cfg-kill-switch')) el('cfg-kill-switch').value = String(cfg.kill_switch ?? false);
    } catch (err) {
        console.warn("[Admin] Ошибка загрузки глобальных настроек:", err);
    }
}

// Инициализация таблицы и загрузка параметров
function initAdminPanel() {
    loadDynamicSettings();

    db.ref('users').once('value', snap => {
        const tbody = document.getElementById('admin-users-list');
        if (!tbody) return;
        tbody.innerHTML = '';
        
        snap.forEach(child => {
            const data = child.val();
            const hash = child.key;

            // Зачистка сломанных профилей
            if (!data || !data.n) {
                db.ref(`users/${hash}`).remove();
                return;
            }

            const name = decodeBase64(data.n);
            const isOnline = onlineUsers.has(hash);
            
            const tr = document.createElement('tr');
            tr.style.borderBottom = "1px solid var(--border-color)";
            tr.innerHTML = `
                <td style="padding: 12px;"><strong>${escapeHTML(name)}</strong><br><span style="font-size:0.75em;color:var(--text-secondary);">${hash.substring(0,10)}...</span></td>
                <td style="padding: 12px;">${data.isBanned ? '⛔ Забанен' : (isOnline ? '🟢 Онлайн' : '⚪ Оффлайн')}</td>
                <td style="padding: 12px;">${formatTime(data.lastSeen)}</td>
                <td style="padding: 12px; display: flex; gap: 8px;">
                    <button onclick="banUser('${hash}', ${!data.isBanned})" style="background: ${data.isBanned ? 'var(--success)' : 'var(--danger)'}; color: white; padding: 6px 12px; border: none; border-radius: 4px; cursor: pointer;">
                        ${data.isBanned ? 'Разбанить' : 'Забанить'}
                    </button>
                    <button onclick="deleteUser('${hash}')" style="background: var(--bg-hover); color: white; padding: 6px 12px; border: none; border-radius: 4px; cursor: pointer;">Удалить</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    });
}

// Базовые функции админа (Бан и Удаление)
window.banUser = async function(hash, banState) {
    if (confirm(`Вы уверены, что хотите ${banState ? 'забанить' : 'разбанить'} пользователя?`)) {
        await db.ref(`users/${hash}/isBanned`).set(banState);
        initAdminPanel();
    }
};

window.deleteUser = async function(hash) {
    if (confirm("ВНИМАНИЕ! Это действие необратимо. Полностью удалить профиль и все ключи?")) {
        await db.ref(`users/${hash}`).remove();
        await db.ref(`admins/${hash}`).remove();
        initAdminPanel();
    }
};

// 💾 Обработка сохранения динамических настроек
document.addEventListener('click', async (e) => {
    if (e.target && e.target.id === 'btn-save-settings') {
        const btn = e.target;
        btn.disabled = true;
        btn.textContent = "Синхронизация с сервером...";

        // Собираем данные и жестко типизируем (чтобы не сломать Firebase Rules)
        const newSettings = {
            max_users: Number(document.getElementById('cfg-max-users').value),
            max_name_len: Number(document.getElementById('cfg-max-name').value),
            max_msg_len: Number(document.getElementById('cfg-max-msg').value),
            max_contacts: Number(document.getElementById('cfg-max-contacts').value),
            kill_switch: document.getElementById('cfg-kill-switch').value === 'true'
        };

        try {
            await db.ref('settings').set(newSettings);
            alert("✅ Глобальные лимиты и правила успешно обновлены и применены к базе!");
        } catch (err) {
            alert("❌ Ошибка сохранения: Убедитесь, что у вас есть права администратора.\n\n" + err.message);
        } finally {
            btn.disabled = false;
            btn.textContent = "💾 Сохранить и применить глобальные правила";
        }
    }
});

// Генерация Инвайтов
const btnGenerateInvite = document.getElementById('btn-generate-invite');
if (btnGenerateInvite) {
    btnGenerateInvite.addEventListener('click', async () => {
        const rawToken = "GHOST-" + Math.random().toString(36).substring(2, 10).toUpperCase();
        const hashedToken = await sha256(rawToken);
        await db.ref(`invites/${hashedToken}`).set({ createdBy: mySession.u, timestamp: Date.now() });
        
        const display = document.getElementById('invite-links-display');
        display.style.display = 'block';
        display.innerHTML = `✅ Новая персональная ссылка доступа:<br><br>` + DOMAINS.map(d => `${d}#/inv/${rawToken}`).join('<br><br>');
    });
}

// Смена Мастер-Ключа
const btnChangeMasterKey = document.getElementById('btn-change-master-key');
if (btnChangeMasterKey) {
    btnChangeMasterKey.addEventListener('click', async () => {
        const newToken = document.getElementById('master-key-input').value.trim();
        if (newToken.length < 6) return alert("Токен должен быть не менее 6 символов!");

        const newHash = await sha256(newToken);
        await db.ref('admin_master_hash').set(newHash);
        
        const statusDiv = document.getElementById('master-key-status');
        statusDiv.style.color = '#22c55e';
        statusDiv.innerHTML = `✅ Мастер-ключ успешно обновлен!`;
        setTimeout(() => statusDiv.innerHTML = '', 4000);
        document.getElementById('master-key-input').value = '';
    });
}

// Экспорт для роутера
window.initAdminPanel = initAdminPanel;
