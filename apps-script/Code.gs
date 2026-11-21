// Apps Script penerima upload foto booth, disimpan ke Google Drive pemilik.
// Deploy: Deploy > New deployment > Web app, Execute as: Me, Who has access: Anyone.
//
// Nilai rahasia TIDAK ditulis di file ini (supaya aman di GitHub). Isi lewat
// Project Settings > Script Properties:
//   ROOT_FOLDER_ID       1l2SxJJBHy1y2pP3TJ60Yb1MKGe-jZfFf
//   FIREBASE_API_KEY     AIzaSyBtw-aE7E8c_ljw0Y-XdAECBZJs7jAO8Qc
//   FIREBASE_PROJECT_ID  photobooth-4cc61

const MAX_BYTES = 4 * 1024 * 1024; // batas ukuran JPEG
const ID_RE = /^[a-z0-9]{10}$/;

const prop = (name) => PropertiesService.getScriptProperties().getProperty(name);

// Body berupa JSON teks: { idToken, eventId, sessionId, image (base64 JPEG) }
function doPost(e) {
  let step = "baca data";
  try {
    const body = JSON.parse(e.postData.contents);
    if (!ID_RE.test(body.eventId || "") || !ID_RE.test(body.sessionId || "")) return reply({ ok: false, error: "ID event atau sesi tidak valid" });

    step = "cek login";
    const uid = verifyFirebaseToken(body.idToken);
    if (!uid) return reply({ ok: false, error: "Login operator kedaluwarsa, masuk ulang" });

    // Hanya pemilik event yang boleh mengirim foto ke event itu
    step = "baca event";
    const owner = eventOwner(body.eventId);
    if (!owner) return reply({ ok: false, error: "Event tidak ditemukan" });
    if (owner !== uid) return reply({ ok: false, error: "Akun ini bukan pemilik event" });

    // Validasi isi: ukuran dan tanda tangan JPEG (FF D8 FF)
    const bytes = Utilities.base64Decode(body.image || "");
    if (bytes.length === 0 || bytes.length >= MAX_BYTES) return reply({ ok: false, error: "Ukuran foto tidak valid" });
    if ((bytes[0] & 0xff) !== 0xff || (bytes[1] & 0xff) !== 0xd8 || (bytes[2] & 0xff) !== 0xff) {
      return reply({ ok: false, error: "File bukan JPEG" });
    }

    step = "buka folder induk (cek ROOT_FOLDER_ID)";
    const folder = getOrCreateFolder(DriveApp.getFolderById(prop("ROOT_FOLDER_ID")), body.eventId);

    // Upload ulang dari antrean (misalnya koneksi putus setelah file tersimpan) memakai file yang sama
    step = "simpan foto";
    const name = body.sessionId + ".jpg";
    const existing = folder.getFilesByName(name);
    const file = existing.hasNext() ? existing.next() : folder.createFile(Utilities.newBlob(bytes, "image/jpeg", name));
    return reply({ ok: true, fileId: file.getId() });
  } catch (err) {
    return reply({ ok: false, error: `Server error di langkah "${step}": ${err.message}` });
  }
}

// Cek idToken ke Firebase Auth REST API; kembalikan uid bila valid
function verifyFirebaseToken(idToken) {
  if (!idToken) return null;
  const res = UrlFetchApp.fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + prop("FIREBASE_API_KEY"),
    { method: "post", contentType: "application/json", payload: JSON.stringify({ idToken }), muteHttpExceptions: true },
  );
  if (res.getResponseCode() !== 200) return null;
  const users = JSON.parse(res.getContentText()).users;
  return users && users[0] ? users[0].localId : null;
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
  ["ROOT_FOLDER_ID", "FIREBASE_API_KEY", "FIREBASE_PROJECT_ID"].forEach((k) => {
    Logger.log(`${k}: ${prop(k) ? "terisi" : "BELUM DIISI (Project Settings > Script Properties)"}`);
  });
  const root = DriveApp.getFolderById(prop("ROOT_FOLDER_ID"));
  Logger.log("Folder ditemukan: " + root.getName());
  Logger.log(root.getSharingAccess() === DriveApp.Access.ANYONE_WITH_LINK
    ? "Folder sudah dibagikan \"Anyone with the link\": foto bisa tampil di galeri"
    : "BELUM: bagikan folder induk ke \"Anyone with the link\" (Viewer), atau foto tidak tampil di galeri");
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
