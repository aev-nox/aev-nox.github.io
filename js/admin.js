// Генератор случайных токенов инвайта
function generateInviteToken() {
    return "GHOST-" + Math.random().toString(36).substr(2, 10).toUpperCase();
}

async function initAdminPanel() {
    if (!mySession || !mySession.isAdmin) return;

    const usersSnap = await db.ref('users').once('value');
    const invitesSnap = await db.ref('invites').once('value');
    
    const users = usersSnap.val() || {};
    const invites = invitesSnap.val() || {};
    
    // Карта привязки: Пользователь -> Инвайт
    let userToInviteMap = {};
    for (let hash in invites) {
        if (invites[hash].userHash) {
            userToInviteMap[invites[hash].userHash] = {
                hash: hash,
                originalToken: invites[hash].originalToken
            };
        }
    }

    const tbody = document.getElementById('admin-users-list');
    if(tbody) tbody.innerHTML = '';

    for (let userHash in users) {
        const u = users[userHash];
        const tr = document.createElement('tr');
        const name = decodeBase64(u.n);
        const status = u.isBanned ? '⛔ Забанен' : '✅ Активен';
        const inviteData = userToInviteMap[userHash];
        
        let actions = '';
        
        // Базовые действия (Бан / Удаление)
        if (u.isBanned) {
            actions += `<button class="btn-unban" onclick="adminUnban('${userHash}')">Разбан</button>`;
        } else {
            actions += `<button class="btn-ban" onclick="adminBan('${userHash}')">Бан</button>`;
        }
        actions += `<button class="btn-delete" onclick="adminDelete('${userHash}')">Удалить</button>`;
        
        // 🔥 УМНОЕ УПРАВЛЕНИЕ ССЫЛКАМИ И ДОСТУПОМ
        if (inviteData && inviteData.originalToken) {
            actions += `<button class="btn-copy" onclick="adminCopyLink('${inviteData.originalToken}')">📋 Копировать ссылку</button>`;
        }
        
        const oldHash = inviteData ? inviteData.hash : '';
        actions += `<button class="btn-reissue" onclick="adminReissueLink('${userHash}', '${oldHash}')">🔄 Перевыпуск</button>`;
        actions += `<button class="btn-restore" onclick="adminRestoreAccess('${userHash}', '${oldHash}')">⚠️ Сброс доступа</button>`;

        tr.innerHTML = `
            <td><strong>${name}</strong></td>
            <td>${status}</td>
            <td>${new Date(u.created).toLocaleDateString()}</td>
            <td class="action-btns">${actions}</td>
        `;
        if(tbody) tbody.appendChild(tr);
    }
}

// ================= ФУНКЦИИ УПРАВЛЕНИЯ =================

window.adminCopyLink = function(token) {
    const link = window.location.origin + window.location.pathname + "#/inv/" + token;
    navigator.clipboard.writeText(link).then(() => {
        alert("✅ Ссылка скопирована в буфер обмена:\n" + link);
    });
}

window.adminReissueLink = async function(userHash, oldInviteHash) {
    if (!confirm("Выпустить новую ссылку для пользователя? Старая навсегда перестанет работать.")) return;
    
    // Удаляем старый инвайт (чтобы по скомпрометированной ссылке не зашли)
    if (oldInviteHash) await db.ref(`invites/${oldInviteHash}`).remove();
    
    // Создаем новый
    const newToken = generateInviteToken();
    const newHash = await sha256(newToken);
    
    await db.ref(`invites/${newHash}`).set({
        created: Date.now(),
        registered: true,
        userHash: userHash,
        originalToken: newToken // Сохраняем оригинал для кнопки "Копировать"
    });
    
    alert("✅ Ссылка успешно перевыпущена!\nНовая ссылка: " + window.location.origin + window.location.pathname + "#/inv/" + newToken);
    initAdminPanel();
}

window.adminRestoreAccess = async function(userHash, oldInviteHash) {
    const text = "🚨 ВНИМАНИЕ! Это действие:\n1. БЕЗВОЗВРАТНО УДАЛИТ ВСЕ ЧАТЫ этого пользователя.\n2. Сбросит его пароль и ключи шифрования.\n3. Сгенерирует новую ссылку для входа.\n\nПродолжить?";
    if (!confirm(text)) return;
    if (!confirm("Последнее предупреждение. Историю переписок будет НЕВОЗМОЖНО восстановить. Сбрасываем?")) return;

    // 1. ЗАЧИСТКА ЧАТОВ У ОБОИХ СОБЕСЕДНИКОВ
    const contactsSnap = await db.ref(`users/${userHash}/contacts`).once('value');
    const contacts = contactsSnap.val() || {};
    for (let contactHash in contacts) {
        // Вычисляем точный ID комнаты так же, как в chat.js
        const arr = [userHash, contactHash].sort();
        const roomId = await sha256(arr[0] + "_" + arr[1]);
        await db.ref(`rooms/${roomId}`).remove(); // Уничтожаем комнату
    }

    // 2. СБРОС КЛЮЧЕЙ
    await db.ref(`users/${userHash}`).update({
        ph: null,  // Пароль удален
        pk: null,  // Публичный ключ удален
        epk: null  // Приватный ключ удален
    });

    // 3. ПЕРЕВЫПУСК ССЫЛКИ
    if (oldInviteHash) await db.ref(`invites/${oldInviteHash}`).remove();
    
    const newToken = generateInviteToken();
    const newHash = await sha256(newToken);
    await db.ref(`invites/${newHash}`).set({
        created: Date.now(),
        registered: true,
        userHash: userHash,
        originalToken: newToken
    });

    alert("✅ Доступ успешно сброшен! Чаты очищены.\n\nПередайте эту новую ссылку пользователю. При входе система попросит его придумать новый пароль:\n\n" + window.location.origin + window.location.pathname + "#/inv/" + newToken);
    initAdminPanel();
}

window.adminBan = async function(userHash) {
    if (confirm("Заблокировать пользователя?")) {
        await db.ref(`users/${userHash}/isBanned`).set(true);
        initAdminPanel();
    }
}

window.adminUnban = async function(userHash) {
    await db.ref(`users/${userHash}/isBanned`).set(false);
    initAdminPanel();
}

window.adminDelete = async function(userHash) {
    if (confirm("Удалить аккаунт навсегда?")) {
        await db.ref(`users/${userHash}`).remove();
        initAdminPanel();
    }
}

// ================= ГЕНЕРАЦИЯ НОВЫХ ИНВАЙТОВ (ДЛЯ НОВИЧКОВ) =================
const btnGenerate = document.getElementById('btn-generate-invite');
if(btnGenerate) {
    btnGenerate.onclick = async () => {
        const token = generateInviteToken();
        const hash = await sha256(token);
        
        await db.ref(`invites/${hash}`).set({
            created: Date.now(),
            registered: false,
            originalToken: token // Сохраняем оригинал в базу
        });
        
        const link = window.location.origin + window.location.pathname + "#/inv/" + token;
        const box = document.getElementById('new-invite-link');
        if(box) box.textContent = link;
    };
}
