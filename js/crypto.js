// =========================================================
// crypto.js - ЯДРО БЕЗОПАСНОСТИ (E2E Шифрование и Санитизация)
// ВЕРСИЯ 3.1: Защита от Base64-инъекций и краша браузера
// =========================================================

// 1. Хэширование (SHA-256)
async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 2. Безопасная кодировка
function encodeBase64(str) {
    return btoa(encodeURIComponent(str));
}

// 🔥 3. БРОНЕБОЙНЫЙ DECODE: Защита от фатальных ошибок Base64
function decodeBase64(b64) {
    try {
        if (!b64) return "";
        return decodeURIComponent(atob(b64));
    } catch (e) {
        console.warn("[SafeDecode] Перехвачена ошибка расшифровки Base64.");
        return escapeHTML(typeof b64 === 'string' ? b64 : "[Ошибка]");
    }
}

// 4. Строгая санитизация HTML (Защита от XSS)
function escapeHTML(str) {
    if (typeof str !== 'string') return "";
    return str.replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}

// ==========================================
// E2E ШИФРОВАНИЕ (ECDH)
// ==========================================

async function generateKeyPair() {
    return await crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" },
        true,
        ["deriveKey", "deriveBits"]
    );
}

async function exportPublicKey(key) {
    return await crypto.subtle.exportKey("jwk", key);
}

async function importPublicKey(jwk) {
    return await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "ECDH", namedCurve: "P-256" },
        true,
        []
    );
}

async function deriveKey(privateKey, publicKey) {
    return await crypto.subtle.deriveKey(
        { name: "ECDH", public: publicKey },
        privateKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

// ==========================================
// ШИФРОВАНИЕ СООБЩЕНИЙ (AES-GCM)
// ==========================================

async function encryptMessage(key, messageText) {
    const enc = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    const cipherBuffer = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        key,
        enc.encode(messageText)
    );
    
    const combined = new Uint8Array(iv.length + cipherBuffer.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(cipherBuffer), iv.length);
    
    let binary = '';
    combined.forEach(b => binary += String.fromCharCode(b));
    return btoa(binary);
}

async function decryptMessage(key, encryptedBase64) {
    try {
        const binaryStr = atob(encryptedBase64);
        const combined = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
            combined[i] = binaryStr.charCodeAt(i);
        }
        
        const iv = combined.slice(0, 12);
        const data = combined.slice(12);
        
        const decryptedBuffer = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv },
            key,
            data
        );
        
        const dec = new TextDecoder();
        return escapeHTML(dec.decode(decryptedBuffer));
    } catch (e) {
        console.warn("[Crypto] Пакет поврежден, расшифровка не удалась.");
        return "[Ошибка расшифровки пакета]";
    }
}
