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
            const name = decodeBase64(data.n);
            const isOnline = onlineUsers.has(hash);
            
            let ipsHtml = '';
            if (data.ips) {
                const sorted = Object.entries(data.ips).sort((a,b) => b[0] - a[0]).slice(0, 3);
                ipsHtml = sorted.map(([ts, ipB64]) => `${decodeBase64(ipB64)} <span style="color:#666;font-size:0.8em">(${formatTime(Number(ts))})</span>`).join('<br>');
            } else ipsHtml = 'Нет данных';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${name}</strong><br><span style="font-size:0.7em;color:#666">${hash.substring(0,8)}...</span></td>
                <td>${data.isBanned ? '⛔ Забанен' : (isOnline ? '🟢 Онлайн' : '⚪ Оффлайн')}</td>
                <td>${formatTime(data.lastSeen)}</td>
                <td style="font-family:monospace; font-size:0.9em;">${ipsHtml}</td>
                <td class="action-btns">
                    ${data.isBanned 
                        ? `<button class="btn-unban" onclick="toggleBan('${hash}', false)">Разбанить</button>` 
                        : `<button class="btn-ban" onclick="toggleBan('${hash}', true)">Забанить</button>`}
                    <button class="btn-sm" style="background:#5e5ce6;" onclick="regenerateUserLink('${hash}')">🔄 Перегенерировать ссылку</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    });
}

window.toggleBan = async function(userHash, state) {
    if(confirm(state ? "Точно забанить? Его выкинет мгновенно." : "Разбанить пользователя?")) {
        await db.ref(`users/${userHash}/isBanned`).set(state);
    }
};

// Перегенерация новой персональной ссылки для пользователя
window.regenerateUserLink = async function(userHash) {
    if(!confirm("Старая ссылка пользователя станет недействительной (404). Выдать новую?")) return;

    const rawToken = "GHOST-" + Math.random().toString(36).substring(2, 10).toUpperCase();
    const hashedToken = await sha256(rawToken);

    // Удаляем старые инвайты этого юзера
    const invitesSnap = await db.ref('invites').once('value');
    invitesSnap.forEach(child => {
        if (child.val().userHash === userHash) {
            db.ref(`invites/${child.key}`).remove();
        }
    });

    // Создаем новый привязанный инвайт
    await db.ref(`invites/${hashedToken}`).set({
        userHash: userHash,
        registered: true,
        updatedAt: Date.now()
    });

    const display = document.getElementById('invite-links-display');
    display.style.display = 'block';
    display.innerHTML = `✅ Ссылка пользователя обновлена! Отправьте ему:<br><br>` + DOMAINS.map(d => `${d}#/inv/${rawToken}`).join('\n');
};

// Создание чистого инвайта для нового юзера
document.getElementById('btn-generate-invite').addEventListener('click', async () => {
    const rawToken = "GHOST-" + Math.random().toString(36).substring(2, 10).toUpperCase();
    const hashedToken = await sha256(rawToken);
    await db.ref(`invites/${hashedToken}`).set({ createdBy: mySession.u, timestamp: Date.now() });
    
    const display = document.getElementById('invite-links-display');
    display.style.display = 'block';
    display.innerHTML = "Разошлите одну из этих ссылок:<br><br>" + DOMAINS.map(d => `${d}#/inv/${rawToken}`).join('\n');
});

// Обновление Мастер-Ключа Админа
document.getElementById('btn-change-master-key').addEventListener('click', async () => {
    const newToken = document.getElementById('master-key-input').value.trim();
    if (newToken.length < 6) return alert("Токен должен быть не менее 6 символов!");

    const newHash = await sha256(newToken);
    await db.ref('admin_master_hash').set(newHash);
    
    const statusDiv = document.getElementById('master-key-status');
    statusDiv.style.color = '#32d74b';
    statusDiv.innerHTML = `✅ Мастер-ключ обновлен! Ваша новая ссылка админа:<br><strong>${window.location.origin}${window.location.pathname}#/root-key/${newToken}</strong>`;
    document.getElementById('master-key-input').value = '';
});

handleRoute();
