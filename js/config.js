// ============================================================
//  R Lab configuration: edit this file before deploying.
// ============================================================

// 1) Paste your Firebase web app config here
//    (Firebase console → Project settings → General → Your apps → SDK setup → Config)
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBRJVvDDO0q8OoGMe7NU8lUFOZDZ-GD7Lw",
  authDomain: "batstateu-rlab.firebaseapp.com",
  projectId: "batstateu-rlab",
  storageBucket: "batstateu-rlab.firebasestorage.app",
  messagingSenderId: "615236802539",
  appId: "1:615236802539:web:275e1132d5fa19ade9abae",
};

// 2) Only Google accounts from this domain can take activities.
//    (Must match the domain in firestore.rules.)
export const SCHOOL_DOMAIN = "g.batstate-u.edu.ph";

// 3) Branding
export const APP_NAME = "BatStateU R Lab";
export const COURSE_LABEL = "Analytics Application";

// 4) R engine (webR), pinned so nothing changes under you on exam day.
//    To upgrade later, change the version, or use ".../latest/webr.mjs".
export const WEBR_URL = "https://webr.r-wasm.org/v0.6.0/webr.mjs";

// 5) How often a student's work is saved (seconds). Lower = more Firestore writes.
//    Each student writes ~2 docs per minute at these values.
export const SAVE_INTERVAL_SEC = 30;      // autosave code + counters
export const SNAPSHOT_INTERVAL_SEC = 30;  // code history for the typing replay
export const HEARTBEAT_SEC = 60;          // "still online" ping when nothing changed
