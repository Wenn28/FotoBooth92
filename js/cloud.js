// Cloud opsional: login operator (Google), event di Firestore, dan antrean upload foto ke Google Drive.
// Foto disimpan dulu di perangkat (IndexedDB), lalu dikirim saat ada internet. Booth tidak pernah menunggu cloud.
import { firebaseConfig, APPS_SCRIPT_URL } from "./config.js";

const SDK = "https://www.gstatic.com/firebasejs/10.12.2";
const RETRY_MS = 30000;      // coba kirim ulang antrean tiap 30 detik
const NET_TIMEOUT_MS = 10000;

export const configured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && APPS_SCRIPT_URL);

let fb = null; // modul Firebase, dimuat hanya bila cloud dikonfigurasi
let flushing = false;
const listeners = new Set();
let lastStatus = { pending: 0, sent: [], error: "" };

// ID acak huruf kecil + angka, dipakai untuk event dan sesi
export function randomId(len = 10) {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(len)), (b) => chars[b % chars.length]).join("");
}

function withTimeout(promise, ms = NET_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Koneksi terlalu lama, cek internet")), ms)),
  ]);
}

export async function loadFirebase() {
  if (fb) return fb;
  const [appMod, authMod, fsMod] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const app = appMod.initializeApp(firebaseConfig);
  fb = { ...authMod, ...fsMod, auth: authMod.getAuth(app), db: fsMod.getFirestore(app) };
  return fb;
}

// Pantau status login operator; onUser(user|null)
export async function watchUser(onUser) {
  if (!configured) { onUser(null); return; }
  const { auth, onAuthStateChanged } = await loadFirebase();
  onAuthStateChanged(auth, (user) => {
    onUser(user);
    if (user) flushQueue();
  });
}

export async function signIn() {
  const { auth, GoogleAuthProvider, signInWithPopup } = await loadFirebase();
  await signInWithPopup(auth, new GoogleAuthProvider());
}

export async function signOutUser() {
  const { auth, signOut } = await loadFirebase();
  await signOut(auth);
}

export const signedIn = () => Boolean(fb && fb.auth.currentUser);

// Pastikan event cloud ada dan datanya sama dengan pengaturan. Kembalikan eventId.
export async function ensureEvent({ eventId, title, date, galleryOpen }) {
  const { auth, db, doc, getDoc, setDoc, updateDoc, serverTimestamp } = await loadFirebase();
  const uid = auth.currentUser.uid;
  if (eventId) {
    const ref = doc(db, "events", eventId);
    try {
      const snap = await withTimeout(getDoc(ref));
      if (snap.exists() && snap.data().ownerUid === uid) {
        const d = snap.data();
        if (d.name !== title || d.date !== date || d.galleryOpen !== galleryOpen) {
          await withTimeout(updateDoc(ref, { name: title, date, galleryOpen }));
        }
        return eventId;
      }
    } catch (err) {
      // Venue tanpa internet: event lama tetap dipakai, upload menunggu di antrean
      if (!navigator.onLine) return eventId;
      throw err;
    }
  }
  const id = randomId(10);
  await withTimeout(setDoc(doc(db, "events", id), {
    ownerUid: uid, name: title, date, galleryOpen, createdAt: serverTimestamp(),
  }));
  return id;
}

// Link galeri untuk satu sesi (isi QR)
export const sessionUrl = (eventId, sessionId) =>
  new URL(`galeri.html?e=${eventId}&s=${sessionId}`, location.href).href;
export const eventUrl = (eventId) => new URL(`galeri.html?e=${eventId}`, location.href).href;

// ===== Antrean upload di IndexedDB =====
function openQueue() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("booth-queue", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("uploads", { keyPath: "sessionId" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function queueOp(mode, fn) {
  const dbq = await openQueue();
  return new Promise((resolve, reject) => {
    const tx = dbq.transaction("uploads", mode);
    const req = fn(tx.objectStore("uploads"));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
  });
}

const queueAll = () => queueOp("readonly", (s) => s.getAll());
const queueDelete = (id) => queueOp("readwrite", (s) => s.delete(id));

function emit(patch) {
  lastStatus = { ...lastStatus, ...patch };
  listeners.forEach((fn) => fn(lastStatus));
}

export const queueStatus = () => lastStatus;

// Daftar pemantau status antrean: fn({ pending, sent: [sessionId], error })
export function onQueue(fn) {
  listeners.add(fn);
  fn(lastStatus);
  return () => listeners.delete(fn);
}

export async function enqueue(item) {
  await queueOp("readwrite", (s) => s.put({ ...item, createdAt: Date.now() }));
  emit({ pending: (await queueAll()).length });
  flushQueue();
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function uploadOne(item) {
  const { auth, db, doc, setDoc, serverTimestamp } = await loadFirebase();
  const idToken = await auth.currentUser.getIdToken();
  // text/plain agar browser tidak mengirim preflight CORS yang ditolak Apps Script
  const res = await withTimeout(fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ idToken, eventId: item.eventId, sessionId: item.sessionId, image: await blobToBase64(item.blob) }),
  }), 60000);
  const out = await res.json();
  if (!out.ok) throw new Error(out.error || "Upload ditolak server");
  await withTimeout(setDoc(doc(db, "events", item.eventId, "sessions", item.sessionId), {
    fileId: out.fileId, createdAt: serverTimestamp(),
  }));
}

// Kirim semua foto di antrean, satu per satu. Aman dipanggil berkali-kali.
export async function flushQueue() {
  if (!configured || flushing || !signedIn() || !navigator.onLine) return;
  flushing = true;
  try {
    for (const item of await queueAll()) {
      try {
        await uploadOne(item);
        await queueDelete(item.sessionId);
        emit({ sent: [...lastStatus.sent, item.sessionId], error: "" });
      } catch (err) {
        emit({ error: err.message });
        break; // berhenti dulu; dicoba lagi pada putaran berikutnya
      }
    }
  } finally {
    flushing = false;
    emit({ pending: (await queueAll()).length });
  }
}

if (configured) {
  window.addEventListener("online", flushQueue);
  setInterval(flushQueue, RETRY_MS);
  queueAll().then((all) => emit({ pending: all.length })).catch(() => {});
}
