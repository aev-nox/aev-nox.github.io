'use strict';

document.getElementById('btn-open-admin').onclick = () => window.location.hash = '#/admin';
document.getElementById('btn-close-admin').onclick = () => window.location.hash = '#/app';

let onlineUsers = new Set();
db.ref('presence').on('value', snap => {
    onlineUsers.clear();
    snap.forEach(c => onlineUsers.add(c.key));
});

function initAdminPanel() {
    db.ref('users').on('value', snap => {
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
            
            let ipsHtml = '';
            if (data.ips) {
                const sorted = Object.entries(data.ips).sort((a,b) => b[0] - a[0]).slice(0, 3);
                ipsHtml = sorted.map(([ts, ipB64]) => `${decodeBase64(ipB64)} <span style="color:#94a3b8;font-size:0.75em">(${formatTime(Number(ts))})</span>`).join('<br>');
            } else ipsHtml = 'Нет данных';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${escapeHTML(name)}</strong><br><span style="font-size:0.7em;color:#94a3b8;">${hash.substring(0,8)}...</span></td>
                <td>${data.isBanned ? '⛔ Забанен' : (isOnline ? '🟢 Онлайн' : '⚪ Оффлайн')}</td>
                <td>${formatTime(data.lastSeen)}</td>
                <td style="font-family:monospace; font-size:0.85em;">${ipsHtml}</td>
                <td class="action-btns">
                    ${data.isBanned 
                        ? `<button class="btn-unban" onclick="toggleBan('${hash}', false)">Разбанить</button>` 
                        : `<button class="btn-ban" onclick="toggleBan('${hash}', true)">Забанить</button>`}
                    <button class="btn-edit" onclick="editUser('${hash}', '${escapeHTML(name)}')">✏️ Имя</button>
                    <button class="btn-sm" style="background:#f59e0b; color:#000;" onclick="resetPassword('${hash}')">🔑 Сброс ключей</button>
                    <button class="btn-sm" style="background:#6366f1;" onclick="regenerateUserLink('${hash}')">🔄 Ссылка</button>
                    <button class="btn-delete" onclick="deleteUserCompletely('${hash}')">❌ Удалить</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    });
}

window.toggleBan = async function(userHash, state) {
    if(confirm(state ? "Заблокировать пользователя?" : "Разблокировать пользователя?")) {
        await db.ref(`users/${userHash}/isBanned`).set(state);
    }
};

window.editUser = async function(userHash, currentName) {
    const newName = prompt("Введите новое имя:", currentName);
    if (newName && newName.trim().length >= 2) {
        await db.ref(`users/${userHash}/n`).set(encodeBase64(newName.trim()));
    }
};

window.resetPassword = async function(userHash) {
    const msg = "Сброс сотрет крипто-ключи пользователя (End-to-End). СТАРЫЕ ЧАТЫ СТАНУТ НЕЧИТАЕМЫМИ.\n\nПродолжить?";
    if (!confirm(msg)) return;

    await db.ref(`users/${userHash}/ph`).remove();
    await db.ref(`users/${userHash}/pk`).remove();
    await db.ref(`users/${userHash}/epk`).remove();
    await db.ref(`users/${userHash}/erk`).remove();
    alert("Ключи сброшены.");
};

window.deleteUserCompletely = async function(userHash) {
    if (!confirm("⚠️ ВНИМАНИЕ: Аккаунт будет удален навсегда! Продолжить?")) return;

    await db.ref(`users/${userHash}`).remove();
    await db.ref(`presence/${userHash}`).remove();
    await db.ref(`admins/${userHash}`).remove();

    const invitesSnap = await db.ref('invites').once('value');
    invitesSnap.forEach(child => {
        if (child.val().userHash === userHash) db.ref(`invites/${child.key}`).remove();
    });
};

window.regenerateUserLink = async function(userHash) {
    if(!confirm("Старая ссылка сгорит (404), будет сгенерирована новая. Продолжить?")) return;

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
    display.innerHTML = `✅ Новая ссылка пользователя:<br><br>` + DOMAINS.map(d => `${d}#/inv/${rawToken}`).join('\n');
};

document.getElementById('btn-generate-invite').addEventListener('click', async () => {
    const rawToken = "GHOST-" + Math.random().toString(36).substring(2, 10).toUpperCase();
    const hashedToken = await sha256(rawToken);
    await db.ref(`invites/${hashedToken}`).set({ createdBy: mySession.u, timestamp: Date.now() });
    
    const display = document.getElementById('invite-links-display');
    display.style.display = 'block';
    display.innerHTML = "Разошлите одну из ссылок:<br><br>" + DOMAINS.map(d => `${d}#/inv/${rawToken}`).join('\n');
});

document.getElementById('btn-change-master-key').addEventListener('click', async () => {
    const newToken = document.getElementById('master-key-input').value.trim();
    if (newToken.length < 6) return alert("Токен от 6 символов!");

    const newHash = await sha256(newToken);
    await db.ref('admin_master_hash').set(newHash);
    
    const statusDiv = document.getElementById('master-key-status');
    statusDiv.style.color = '#22c55e';
    statusDiv.innerHTML = `✅ Ключ обновлен:<br><strong>${window.location.origin}${window.location.pathname}#/root-key/${newToken}</strong>`;
    document.getElementById('master-key-input').value = '';
});
