// Firebase setup shared by the student and instructor pages.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
  setPersistence, browserSessionPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, collection, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { FIREBASE_CONFIG, SCHOOL_DOMAIN } from "./config.js";

export const app = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);
// Session persistence keeps the sign-in token out of IndexedDB, so R code running
// in the webR worker (which can reach IndexedDB but not sessionStorage) cannot read it.
await setPersistence(auth, browserSessionPersistence);
export const db = getFirestore(app);

export {
  onAuthStateChanged, doc, collection, getDoc, getDocs, setDoc, updateDoc, addDoc,
  deleteDoc, onSnapshot, query, orderBy, serverTimestamp,
};

export async function signInGoogle(restrictToSchool) {
  const p = new GoogleAuthProvider();
  const params = { prompt: "select_account" };
  if (restrictToSchool) params.hd = SCHOOL_DOMAIN;
  p.setCustomParameters(params);
  return signInWithPopup(auth, p);
}
export const logout = () => signOut(auth);

export function isSchoolEmail(email) {
  return !!email && email.toLowerCase().endsWith("@" + SCHOOL_DOMAIN.toLowerCase());
}

export async function checkInstructor(user) {
  if (!user?.email) return false;
  try {
    const s = await getDoc(doc(db, "instructors", user.email.toLowerCase()));
    return s.exists();
  } catch { return false; }
}
