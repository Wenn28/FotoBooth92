// Apps Script penerima upload foto dan bingkai booth, disimpan ke Google Drive pemilik.
// Deploy: Deploy > New deployment > Web app, Execute as: Me, Who has access: Anyone.
//
// Nilai rahasia TIDAK ditulis di file ini (supaya aman di GitHub). Isi lewat
// Project Settings > Script Properties:
//   ROOT_FOLDER_ID       1l2SxJJBHy1y2pP3TJ60Yb1MKGe-jZfFf
//   FIREBASE_API_KEY     AIzaSyBtw-aE7E8c_ljw0Y-XdAECBZJs7jAO8Qc
//   FIREBASE_PROJECT_ID  photobooth-4cc61
//   OWNER_EMAIL          email Google operator; akun lain ditolak

const MAX_BYTES = 8 * 1024 * 1024;        // batas ukuran foto sesi (PNG lebih besar dari JPEG)
const MAX_FRAME_BYTES = 5 * 1024 * 1024;  // batas ukuran bingkai
const ID_RE = /^[a-z0-9]{10}$/;
const FRAME_DIR = "frame";
const TRASH_DIR = "terhapus"; // bingkai yang dihapus dari app dipindah ke sini, bukan dihapus dari Drive
const FRAME_MIMES = ["image/png", "image/jpeg", "image/webp"];

const prop = (name) => PropertiesService.getScriptProperties().getProperty(name);

// Body berupa JSON teks: { idToken, action?, ... }. Tanpa action = upload foto sesi:
// { eventId, sessionId, image (base64 JPEG) }
function doPost(e) {
  let step = "baca data";
  try {
    const body = JSON.parse(e.postData.contents);

    step = "cek login";
    const user = verifyFirebaseToken(body.idToken);
    if (!user) return reply({ ok: false, error: "Login operator kedaluwarsa, masuk ulang" });
    const ownerEmail = (prop("OWNER_EMAIL") || "").trim().toLowerCase();
    if (!ownerEmail) return reply({ ok: false, error: "OWNER_EMAIL belum diisi di Script Properties" });
    if (!user.emailVerified || String(user.email || "").toLowerCase() !== ownerEmail) {
      return reply({ ok: false, error: "Akun ini tidak diizinkan" });
    }

    const action = body.action || "photo";
    if (action === "photo") return uploadPhoto(body, user.localId, (s) => { step = s; });

    step = "buka folder bingkai (cek ROOT_FOLDER_ID)";
    const root = DriveApp.getFolderById(prop("ROOT_FOLDER_ID"));
    const dir = getOrCreateFolder(root, FRAME_DIR);

    step = `bingkai: ${action}`;
    if (action === "frameList") return reply({ ok: true, frames: frameEntries(dir) });
    if (action === "frameGet") {
      const file = frameFile(dir, body.fileId);
      if (!file) return reply({ ok: false, error: "Bingkai tidak ditemukan" });
      return reply({ ok: true, mime: file.getMimeType(), data: Utilities.base64Encode(file.getBlob().getBytes()) });
    }
    if (action === "frameUpload") return uploadFrame(body, dir);
    if (action === "frameHide") {
      const file = frameFile(dir, body.fileId);
      if (!file) return reply({ ok: false, error: "Bingkai tidak ditemukan" });
      file.moveTo(getOrCreateFolder(dir, TRASH_DIR));
      return reply({ ok: true });
    }
    return reply({ ok: false, error: "Aksi tidak dikenal" });
  } catch (err) {
    return reply({ ok: false, error: `Server error di langkah "${step}": ${err.message}` });
  }
}

function uploadPhoto(body, uid, setStep) {
  if (!ID_RE.test(body.eventId || "") || !ID_RE.test(body.sessionId || "")) return reply({ ok: false, error: "ID event atau sesi tidak valid" });

  // Hanya pemilik event yang boleh mengirim foto ke event itu
  setStep("baca event");
  const owner = eventOwner(body.eventId);
  if (!owner) return reply({ ok: false, error: "Event tidak ditemukan" });
  if (owner !== uid) return reply({ ok: false, error: "Akun ini bukan pemilik event" });

  // Validasi isi: ukuran dan tanda tangan file (JPEG atau PNG)
  const bytes = Utilities.base64Decode(body.image || "");
  if (bytes.length === 0 || bytes.length >= MAX_BYTES) return reply({ ok: false, error: "Ukuran foto tidak valid" });
  const mime = imageMime(bytes);
  if (mime !== "image/jpeg" && mime !== "image/png") return reply({ ok: false, error: "Foto harus JPEG atau PNG" });

  setStep("buka folder induk (cek ROOT_FOLDER_ID)");
  const folder = getOrCreateFolder(DriveApp.getFolderById(prop("ROOT_FOLDER_ID")), body.eventId);

  // Upload ulang dari antrean (misalnya koneksi putus setelah file tersimpan) memakai file yang sama
  setStep("simpan foto");
  const name = body.sessionId + (mime === "image/png" ? ".png" : ".jpg");
  const existing = folder.getFilesByName(name);
  const file = existing.hasNext() ? existing.next() : folder.createFile(Utilities.newBlob(bytes, mime, name));
  return reply({ ok: true, fileId: file.getId() });
}

// Bingkai baru: { name, data (base64) }. File dengan isi sama (hash sama) tidak disimpan dua kali.
function uploadFrame(body, dir) {
  const bytes = Utilities.base64Decode(body.data || "");
  if (bytes.length === 0 || bytes.length > MAX_FRAME_BYTES) return reply({ ok: false, error: "Ukuran bingkai maksimal 5 MB" });
  const mime = imageMime(bytes);
  if (!mime) return reply({ ok: false, error: "Bingkai harus PNG, JPG, atau WebP" });

  const hash = sha256(bytes);
  const dup = frameEntries(dir).filter((f) => f.hash === hash)[0];
  if (dup) return reply({ ok: true, fileId: dup.id, hash, existed: true });

  const name = String(body.name || "bingkai").replace(/[\\/]/g, "_").slice(0, 100);
  const file = dir.createFile(Utilities.newBlob(bytes, mime, name));
  file.setDescription("sha256:" + hash);
  return reply({ ok: true, fileId: file.getId(), hash, existed: false });
}

// Bingkai di folder frame: [{ id, name, hash }]. Hash dihitung sekali lalu disimpan di deskripsi file,
// termasuk untuk file yang ditaruh manual lewat Drive web.
function frameEntries(dir) {
  const out = [];
  const files = dir.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    if (FRAME_MIMES.indexOf(f.getMimeType()) < 0 || f.getSize() > MAX_FRAME_BYTES) continue;
    let desc = f.getDescription() || "";
    if (desc.indexOf("sha256:") !== 0) {
      desc = "sha256:" + sha256(f.getBlob().getBytes());
      f.setDescription(desc);
    }
    out.push({ id: f.getId(), name: f.getName(), hash: desc.slice(7) });
  }
  return out;
}

// File bingkai hanya bila benar-benar ada di folder frame (bukan file Drive sembarang)
function frameFile(dir, fileId) {
  if (!fileId) return null;
  try {
    const f = DriveApp.getFileById(fileId);
    const parents = f.getParents();
    while (parents.hasNext()) if (parents.next().getId() === dir.getId() && !f.isTrashed()) return f;
  } catch (err) { /* ID tidak valid atau tanpa akses */ }
  return null;
}

// Tipe gambar dari tanda tangan byte, bukan dari nama file
function imageMime(b) {
  const u = (i) => b[i] & 0xff;
  if (u(0) === 0xff && u(1) === 0xd8 && u(2) === 0xff) return "image/jpeg";
  if (u(0) === 0x89 && u(1) === 0x50 && u(2) === 0x4e && u(3) === 0x47) return "image/png";
  if (b.length > 12 && u(0) === 0x52 && u(1) === 0x49 && u(2) === 0x46 && u(3) === 0x46 && u(8) === 0x57 && u(9) === 0x45 && u(10) === 0x42 && u(11) === 0x50) return "image/webp";
  return null;
}

function sha256(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)
    .map((x) => ("0" + (x & 0xff).toString(16)).slice(-2)).join("");
}

// Cek idToken ke Firebase Auth REST API; kembalikan { localId, email, emailVerified } bila valid
function verifyFirebaseToken(idToken) {
  if (!idToken) return null;
  const res = UrlFetchApp.fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + prop("FIREBASE_API_KEY"),
    { method: "post", contentType: "application/json", payload: JSON.stringify({ idToken }), muteHttpExceptions: true },
  );
  if (res.getResponseCode() !== 200) return null;
  const users = JSON.parse(res.getContentText()).users;
  return users && users[0] ? users[0] : null;
}

// Baca ownerUid event dari Firestore REST (dokumen event boleh dibaca publik)
function eventOwner(eventId) {
  const res = UrlFetchApp.fetch(
    `https://firestore.googleapis.com/v1/projects/${prop("FIREBASE_PROJECT_ID")}/databases/(default)/documents/events/${eventId}`,
    { muteHttpExceptions: true },
  );
  if (res.getResponseCode() !== 200) return null;
  const owner = JSON.parse(res.getContentText()).fields.ownerUid;
  return owner ? owner.stringValue : null;
}

function getOrCreateFolder(parent, name) {
  const found = parent.getFoldersByName(name);
  return found.hasNext() ? found.next() : parent.createFolder(name);
}

// Diagnosa: pilih testSetup > Run di editor, lalu lihat Execution log
function testSetup() {
  ["ROOT_FOLDER_ID", "FIREBASE_API_KEY", "FIREBASE_PROJECT_ID", "OWNER_EMAIL"].forEach((k) => {
    Logger.log(`${k}: ${prop(k) ? "terisi" : "BELUM DIISI (Project Settings > Script Properties)"}`);
  });
  const root = DriveApp.getFolderById(prop("ROOT_FOLDER_ID"));
  Logger.log("Folder ditemukan: " + root.getName());
  Logger.log(root.getSharingAccess() === DriveApp.Access.ANYONE_WITH_LINK
    ? "Folder sudah dibagikan \"Anyone with the link\": foto bisa tampil di galeri"
    : "BELUM: bagikan folder induk ke \"Anyone with the link\" (Viewer), atau foto tidak tampil di galeri");
  Logger.log("Folder bingkai: " + getOrCreateFolder(root, FRAME_DIR).getName());
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
