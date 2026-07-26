const firebaseConfig = {
    apiKey: "AIzaSyAzCfA19BfslrhUnFBYOG72Gnd5lm_5YtI",
    authDomain: "global-student-project.firebaseapp.com",
    projectId: "global-student-project",
    databaseURL: "https://global-student-project-default-rtdb.europe-west1.firebasedatabase.app"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

const DOMAINS = [
    window.location.origin + window.location.pathname,
    "https://aev-nox.vercel.app/",
    "https://my-secret-domain.com/"
];

const DEFAULT_MASTER_TOKEN = "INIT-ADMIN-KEY-8f3a9b1c7d2e4f5a";

async function ensureMasterKeyExists() {
    const snap = await db.ref('admin_master_hash').once('value');
    if (!snap.exists()) {
        const defaultHash = await sha256(DEFAULT_MASTER_TOKEN);
        await db.ref('admin_master_hash').set(defaultHash);
    }
}
ensureMasterKeyExists();

async function isRealAdmin(userHash) {
    if (!userHash) return false;
    const snap = await db.ref(`admins/${userHash}`).once('value');
    return snap.exists() && snap.val() === true;
}
