'use strict';

async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const encodeBase64 = (str) => btoa(encodeURIComponent(str));
const decodeBase64 = (b64) => decodeURIComponent(atob(b64));

function formatTime(ts) {
    if(!ts) return "Никогда";
    return new Date(ts).toLocaleString('ru-RU', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'});
}

function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}

// === ЯДРО ШИФРОВАНИЯ (ДВОЙНАЯ ЗАЩИТА) ===

async function derivePassKey(userHash, secretPhrase) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(secretPhrase), {name: "PBKDF2"}, false, ["deriveKey"]);
    return await crypto.subtle.deriveKey(
        {name: "PBKDF2", salt: enc.encode(userHash), iterations: 100000, hash: "SHA-256"},
        keyMaterial, {name: "AES-GCM", length: 256}, false, ["encrypt", "decrypt"]
    );
}

async function encryptPrivateKey(userHash, secretPhrase, privJwk) {
    const passKey = await derivePassKey(userHash, secretPhrase);
    const enc = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({name: "AES-GCM", iv: iv}, passKey, enc.encode(JSON.stringify(privJwk)));
    const combined = new Uint8Array(12 + encrypted.byteLength);
    combined.set(iv, 0); combined.set(new Uint8Array(encrypted), 12);
    return btoa(String.fromCharCode.apply(null, combined));
}

async function decryptPrivateKey(userHash, secretPhrase, encryptedB64) {
    const passKey = await derivePassKey(userHash, secretPhrase);
    const str = atob(encryptedB64);
    const combined = new Uint8Array(str.length);
    for(let i=0; i<str.length; i++) combined[i] = str.charCodeAt(i);
    const decrypted = await crypto.subtle.decrypt({name: "AES-GCM", iv: combined.slice(0, 12)}, passKey, combined.slice(12));
    return JSON.parse(new TextDecoder().decode(decrypted));
}

// Генерация случайного кода восстановления (Например: RC-A1B2-C3D4)
function generateRecoveryCode() {
    const p1 = Math.random().toString(36).substring(2, 6).toUpperCase();
    const p2 = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `RC-${p1}-${p2}`;
}

// Загрузка файла (Скачивание)
function downloadCredentials(login, password, recoveryCode) {
    const link = window.location.href;
    const text = `=== GHOST ZERO-TRUST ACCESS ===\n\nВход: ${link}\nЛогин: ${login}\nПароль: ${password}\n\n=== КОД ВОССТАНОВЛЕНИЯ ===\nЕсли вы забудете пароль, этот код — единственный способ дешифровать вашу переписку:\n\n${recoveryCode}\n\n=================================\nВНИМАНИЕ: Сохраните эти данные в безопасный менеджер паролей и удалите этот файл!`;
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Ghost_Access_${login}.txt`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}
