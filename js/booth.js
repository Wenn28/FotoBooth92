// Alur booth: Pengaturan > Layar awal > Kamera > Review > Bagikan > kembali ke Layar awal.
import { APP_NAME } from "./config.js";
import { loadJSON, renderTemplate, prepareFonts, shotCount, shotRatio } from "./render.js";
import * as cloud from "./cloud.js";
import * as frames from "./frames.js";

const $ = (id) => document.getElementById(id);

// ===== Konstanta =====
const SETTINGS_KEY = "booth.settings.v1";
const IDLE_MS = 120000;          // review/bagikan kembali ke layar awal setelah 2 menit tanpa sentuhan
const BETWEEN_SHOTS_MS = 1200;   // jeda antar foto pada format multi-foto
const JPEG_QUALITY = 0.9;        // kualitas file yang dikirim ke galeri
const CAMERA = { width: { ideal: 1920 }, height: { ideal: 1440 } }; // minta 4:3 resolusi tinggi

const todayISO = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

const DEFAULTS = {
  title: "", date: todayISO(), templateId: "4r-reguler-tegak", filterId: "asli",
  countdown: 3, manual: false, // countdown = detik timer mode otomatis (1-60)
  facing: "user", mirror: false, useCloud: false, galleryOpen: false, eventId: "",
  showTitle: true, // hanya berlaku untuk template bingkai sendiri
  frameId: "",     // bingkai terpilih dari daftar bingkai tersimpan
};

const state = {
  templates: [], filters: [], s: { ...DEFAULTS },
  shots: [], source: "camera", filterId: "asli",
  stream: null, streamFacing: "", run: 0,
  sessionId: "", pngBlob: null, urls: [], idleTimer: 0, user: null,
  frames: [], // bingkai upload operator: [{ id, img, name, mode, onTop, textColor }]
};

const currentFrame = () => state.frames.find((f) => f.id === state.s.frameId) || null;

// Bingkai f yang sudah dicocokkan dengan format t (lapisan dan warna teks berbeda per format)
const fits = new Map();
function fitFor(f, t) {
  const key = `${f.id}|${t.id}`;
  if (!fits.has(key)) {
    let fit = null; // null = ukuran bingkai upload tidak cocok dengan format ini: cetak tanpa bingkai
    if (f.builtin) fit = { ...f, img: frames.builtinFrame(f.builtin, t), mode: "panel", onTop: true, textColor: f.builtin.textColor || null };
    else try { fit = { ...f, ...frames.analyzeFrame(f.img, t) }; } catch { /* lihat komentar di atas */ }
    fits.set(key, fit);
  }
  return fits.get(key);
}
const frameFor = (t) => { const f = currentFrame(); return f ? fitFor(f, t) : null; };

// Opsi render: bingkai terpilih (berlaku di semua format) dan nama acara on/off
function renderExtras(t) {
  const frame = frameFor(t);
  return frame ? { frame, showTitle: state.s.showTitle } : {};
}

// Panduan ukuran mengikuti format terpilih
function updateGuide() {
  const t = template();
  frames.guideBlob(t).then((blob) => {
    const a = $("btnGuide");
    if (a.href.startsWith("blob:")) URL.revokeObjectURL(a.href);
    a.href = URL.createObjectURL(blob);
    a.download = `panduan-bingkai-${t.id}.png`;
  });
}

// ===== Pengaturan (disimpan di perangkat ini) =====
function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; }
  catch { return { ...DEFAULTS }; }
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.s)); } catch { /* mode privat: tetap jalan tanpa simpan */ }
}

const template = () => state.templates.find((t) => t.id === state.s.templateId) || state.templates[0];
const filterOf = (id) => state.filters.find((f) => f.id === id) || state.filters[0];
const cloudActive = () => cloud.configured && state.s.useCloud && Boolean(state.user) && Boolean(state.s.eventId);

// "2026-11-20" -> "20 November 2026"
function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return isNaN(d) ? "" : d.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
}

const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "foto";

function msg(id, text, type = "") {
  $(id).textContent = text;
  $(id).dataset.type = type;
}

// ===== Pindah layar =====
function show(id) {
  document.querySelectorAll(".screen").forEach((el) => { el.hidden = el.id !== id; });
  window.scrollTo(0, 0);
  $(id).querySelector("h1")?.focus({ preventScroll: true });
  armIdle(id === "scrReview" || id === "scrShare");
  if (id === "scrSetup") stopCamera();
}
const current = () => document.querySelector(".screen:not([hidden])")?.id;

function armIdle(on) {
  clearTimeout(state.idleTimer);
  if (on) state.idleTimer = setTimeout(resetSession, IDLE_MS);
}
["pointerdown", "keydown"].forEach((ev) => document.addEventListener(ev, () => {
  const id = current();
  if (id === "scrReview" || id === "scrShare") armIdle(true);
}));

// Ukuran kertas cetak mengikuti template
function updatePageStyle() {
  const { widthIn, heightIn } = template().print;
  $("pageStyle").textContent =
    `@page { size: ${widthIn}in ${heightIn}in; margin: 0; } #printArea img { width: ${widthIn}in; height: ${heightIn}in; }`;
}

// ===== 1. Pengaturan operator =====
function buildSetup() {
  const s = state.s;
  $("inTitle").value = s.title;
  $("inDate").value = s.date;
  $("inTimer").value = String(s.countdown);
  $("inTimer").disabled = s.manual;
  document.querySelector(`input[name="captureMode"][value="${s.manual ? "manual" : "auto"}"]`).checked = true;
  // Saat kolom ditinggalkan: angka dibulatkan dan dipotong ke 1-60; kolom kosong kembali ke nilai sebelumnya
  $("inTimer").addEventListener("change", () => {
    const v = Math.round(Number($("inTimer").value));
    if ($("inTimer").value !== "" && Number.isFinite(v)) s.countdown = Math.min(60, Math.max(1, v));
    $("inTimer").value = String(s.countdown);
  });
  $("inFacing").value = s.facing;
  $("inMirror").checked = s.mirror;
  $("inUseCloud").checked = s.useCloud;
  $("inGalleryOpen").checked = s.galleryOpen;
  $("inShowTitle").checked = s.showTitle;

  $("inFilter").replaceChildren(...state.filters.map((f) => new Option(f.name, f.id, false, f.id === s.filterId)));

  // Pilihan format: thumbnail digambar dari templates.json dengan kotak bernomor
  const list = $("templateList");
  list.replaceChildren();
  for (const t of state.templates) {
    const label = document.createElement("label");
    label.className = "tpl";
    label.innerHTML = `<input type="radio" name="tpl"><canvas width="1800" height="1200" aria-hidden="true"></canvas><span><strong></strong><small></small></span>`;
    const input = label.querySelector("input");
    input.value = t.id;
    input.checked = t.id === s.templateId;
    label.querySelector("strong").textContent = t.name;
    label.querySelector("small").textContent = t.description;
    list.append(label);
  }
  renderThumbs();

  const sync = () => {
    s.title = $("inTitle").value.trim();
    s.date = $("inDate").value;
    s.manual = document.querySelector('input[name="captureMode"]:checked').value === "manual";
    $("inTimer").disabled = s.manual;
    const sec = Number($("inTimer").value);
    if (Number.isInteger(sec) && sec >= 1 && sec <= 60) s.countdown = sec;
    s.facing = $("inFacing").value;
    s.filterId = $("inFilter").value;
    s.mirror = $("inMirror").checked;
    s.useCloud = $("inUseCloud").checked;
    s.galleryOpen = $("inGalleryOpen").checked;
    const prevTemplate = s.templateId;
    s.templateId = list.querySelector("input:checked")?.value || s.templateId;
    const titleChanged = s.showTitle !== $("inShowTitle").checked;
    s.showTitle = $("inShowTitle").checked;
    saveSettings();
    renderCloud();
    // Daftar bingkai digambar ulang hanya saat format berganti: radio bingkai yang sedang diklik tidak boleh hilang
    if (s.templateId !== prevTemplate) { renderFrameCard(); updateGuide(); }
    if (titleChanged) renderThumbs();
  };
  $("scrSetup").addEventListener("input", sync);
  $("scrSetup").addEventListener("change", sync);
}

// Thumbnail format cetak, digambar dari templates.json (template bingkai ikut memakai bingkai upload)
function renderThumbs() {
  $("templateList").querySelectorAll(".tpl").forEach((label) => {
    const t = state.templates.find((x) => x.id === label.querySelector("input").value);
    prepareFonts(t).then(() => renderTemplate(label.querySelector("canvas"), t, null,
      { title: "Nama acara", dateText: "Tanggal", ...renderExtras(t) }));
  });
}

// ===== Bingkai (berlaku di semua format) =====
// "Tanpa bingkai" + daftar bingkai tersimpan sebagai pilihan radio
function renderFrameCard() {
  const sel = currentFrame();
  $("btnFrameDelete").hidden = !sel || Boolean(sel.builtin); // bingkai bawaan tidak bisa dihapus
  $("showTitleRow").hidden = !sel;
  const t = template();

  const option = (id, checked, imgSrc, name, detail) => {
    const label = document.createElement("label");
    label.className = "frame-opt";
    const radio = document.createElement("input");
    radio.type = "radio"; radio.name = "frame"; radio.value = id; radio.checked = checked;
    label.append(radio);
    if (imgSrc) {
      const img = document.createElement("img");
      img.src = imgSrc; img.width = 72; img.height = 96; img.alt = "";
      label.append(img);
    }
    const info = document.createElement("span");
    info.innerHTML = "<strong></strong><br>";
    info.querySelector("strong").textContent = name;
    info.append(detail);
    label.append(info);
    return label;
  };

  $("frameNow").replaceChildren(
    option("", !sel, null, "Tanpa bingkai", "Latar putih polos."),
    ...state.frames.map((f) => {
      const fit = fitFor(f, t);
      if (f.builtin) return option(f.id, f === sel, fit.img.toDataURL(), f.name, "Bawaan, otomatis mengikuti posisi foto format ini.");
      const size = `${f.img.naturalWidth} × ${f.img.naturalHeight}`;
      if (!fit) return option(f.id, f === sel, f.img.src, f.name, `${size}. Tidak cocok untuk format ${t.name}, jadi dicetak tanpa bingkai.`);
      const where = t.panels.length === 1 ? "satu lembar" : fit.mode === "panel" ? "satu potongan, dipakai di kiri dan kanan" : "satu lembar penuh";
      const layer = fit.onTop ? "bingkai di atas foto" : "foto di atas bingkai";
      const ink = fit.textColor ? ", nama acara putih" : "";
      return option(f.id, f === sel, f.img.src, f.name,
        `${size}, ${where}. Di format ${t.name}: ${layer}${ink}.`);
    }),
  );
}

function selectFrame(id) {
  state.s.frameId = id;
  saveSettings();
  renderFrameCard();
  renderThumbs();
}

async function uploadFrame(file) {
  $("framePick").value = "";
  if (!file) return;
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { msg("frameMsg", "File harus PNG, JPG, atau WebP.", "error"); return; }
  try {
    const img = await frames.fileToImage(file);
    frames.analyzeFrame(img, template()); // menolak ukuran yang tidak cocok dengan format terpilih
    const id = await frames.saveFrame(file, file.name);
    state.frames.push({ id, img, name: file.name });
    msg("frameMsg", `${file.name} tersimpan di perangkat ini dan dipilih.`, "ok");
    selectFrame(id);
  } catch (err) {
    msg("frameMsg", err.message.startsWith("Ukuran") ? err.message : `Bingkai tidak bisa dibuka: ${err.message}`, "error");
  }
}

// Hapus bingkai terpilih, lalu kembali ke "Tanpa bingkai"
async function removeFrame() {
  const sel = currentFrame();
  if (!sel || sel.builtin) return;
  await frames.deleteFrame(sel.id).catch(() => {});
  state.frames = state.frames.filter((f) => f !== sel);
  msg("frameMsg", `${sel.name} dihapus.`);
  selectFrame("");
}

function renderCloud() {
  const s = state.s;
  const signed = Boolean(state.user);
  $("btnSignIn").hidden = !cloud.configured || signed;
  $("cloudUser").hidden = !signed;
  $("useCloudRow").hidden = !signed;
  $("galleryRow").hidden = !signed || !s.useCloud;
  $("btnNewEvent").hidden = !signed || !s.eventId;
  $("eventInfo").hidden = !signed || !s.eventId;

  if (!cloud.configured) {
    $("cloudInfo").textContent = "Mode lokal: galeri QR mati sampai js/config.js diisi (lihat README). Cetak, unduh, dan bagikan tetap jalan.";
    return;
  }
  $("cloudInfo").textContent = signed
    ? "Foto dikirim ke Google Drive pemilik booth, lalu tamu mengunduhnya lewat QR."
    : "Masuk dengan akun Google untuk mengirim foto ke galeri dan menampilkan QR.";
  if (signed) $("cloudWho").textContent = state.user.email || "Akun Google";
  if (s.eventId) {
    const url = cloud.eventUrl(s.eventId);
    const a = document.createElement("a");
    a.href = url; a.target = "_blank"; a.rel = "noopener"; a.textContent = url;
    $("eventInfo").replaceChildren("Link galeri acara: ", a);
  }
}

function renderQueue({ pending, error }) {
  if (!cloud.configured || !state.user) { msg("queueMsg", ""); return; }
  if (pending) msg("queueMsg", `${pending} foto menunggu dikirim.${error ? " Terakhir gagal: " + error : ""}`, error ? "error" : "");
  else msg("queueMsg", "Semua foto sudah terkirim.", "ok");
}

async function openBooth() {
  const s = state.s;
  if (!s.title) {
    msg("setupMsg", "Isi nama acara dulu. Nama ini tercetak di bawah foto.", "error");
    $("inTitle").focus();
    return;
  }
  if (cloud.configured && s.useCloud && state.user) {
    $("btnOpen").disabled = true;
    msg("setupMsg", "Menyiapkan galeri acara…");
    try {
      s.eventId = await cloud.ensureEvent({ eventId: s.eventId, title: s.title, date: s.date, galleryOpen: s.galleryOpen });
      saveSettings();
      renderCloud();
    } catch (err) {
      msg("setupMsg", `Galeri belum siap: ${err.message}. Cek internet, atau matikan "Kirim foto ke galeri" untuk mode lokal.`, "error");
      return;
    } finally {
      $("btnOpen").disabled = false;
    }
  }
  msg("setupMsg", "");
  updatePageStyle();
  updateStart();
  show("scrStart");
}

// ===== 2. Layar awal =====
function updateStart() {
  const s = state.s;
  $("startEvent").textContent = [s.title, formatDate(s.date)].filter(Boolean).join(" · ");
  const n = shotCount(template());
  const how = s.manual ? "tekan Jepret" : `hitung mundur ${s.countdown} detik`;
  $("startHint").textContent = n > 1 ? `Ambil ${n} foto, masing-masing ${how}.` : `Satu foto, ${how}.`;
  msg("startMsg", "");
}

async function loadFileImage(file) {
  const url = URL.createObjectURL(file);
  state.urls.push(url);
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

async function fromFiles(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith("image/"));
  $("filePick").value = "";
  if (!files.length) { msg("startMsg", "File yang dipilih bukan gambar. Pilih foto JPG atau PNG.", "error"); return; }
  try {
    const imgs = await Promise.all(files.map(loadFileImage));
    const n = shotCount(template());
    state.shots = Array.from({ length: n }, (_, i) => ({ src: imgs[i % imgs.length], mirror: false }));
    state.source = "files";
    stopCaptureRun();
    await goReview(files.length < n ? `Format ini butuh ${n} foto, terpilih ${files.length}. Foto dipakai berulang.` : "");
  } catch {
    msg("startMsg", "Foto tidak bisa dibuka. Coba foto lain.", "error");
  }
}

// ===== 3. Kamera =====
function stopCamera() {
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null;
}
const stopCaptureRun = () => {
  state.run++;
  $("countNum").hidden = true;
  if (state.shutter) { state.shutter(false); state.shutter = null; } // batalkan tunggu tombol Jepret
  $("btnShutter").hidden = true;
};

// Mode manual: tunggu tombol Jepret; false bila dibatalkan
function waitShutter() {
  $("btnShutter").hidden = false;
  $("btnShutter").focus();
  return new Promise((resolve) => { state.shutter = resolve; });
}
function pressShutter() {
  const resolve = state.shutter;
  state.shutter = null;
  $("btnShutter").hidden = true;
  resolve?.(true);
}

async function openCamera() {
  const facing = state.s.facing;
  if (state.stream?.active && state.streamFacing === facing) return;
  stopCamera();
  if (!navigator.mediaDevices?.getUserMedia) {
    const e = new Error("Kamera butuh HTTPS");
    e.name = "InsecureError";
    throw e;
  }
  state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, ...CAMERA }, audio: false });
  state.streamFacing = facing;
  const v = $("video");
  v.srcObject = state.stream;
  v.classList.toggle("mirror", facing === "user"); // preview selalu seperti cermin untuk kamera depan
  await v.play();
  if (!v.videoWidth) await new Promise((r) => v.addEventListener("loadedmetadata", r, { once: true }));
}

function cameraError(err) {
  const text = {
    NotAllowedError: "Izin kamera ditolak. Buka pengaturan browser, izinkan kamera untuk situs ini, lalu tekan Coba lagi.",
    NotFoundError: "Kamera tidak ditemukan di perangkat ini.",
    NotReadableError: "Kamera sedang dipakai aplikasi lain. Tutup aplikasi itu, lalu tekan Coba lagi.",
    OverconstrainedError: "Kamera yang dipilih tidak tersedia. Ganti pilihan kamera di Pengaturan.",
    InsecureError: "Kamera hanya bisa dibuka lewat HTTPS atau localhost.",
  }[err.name] || `Kamera gagal dibuka: ${err.message}`;
  $("camErrorText").textContent = text;
  $("frame").hidden = true;
  $("camError").hidden = false;
  $("shotLabel").textContent = "Kamera";
  $("btnCamRetry").focus();
}

const wait = (ms, run) => new Promise((r) => setTimeout(() => r(run === state.run), ms));

// Hitung mundur; false bila dibatalkan di tengah jalan
async function countdown(sec, run) {
  const el = $("countNum");
  el.hidden = false;
  for (let k = sec; k > 0; k--) {
    el.textContent = k;
    $("countLive").textContent = String(k);
    if (!(await wait(1000, run))) return false;
  }
  el.hidden = true;
  return true;
}

function grabFrame() {
  const v = $("video");
  const c = document.createElement("canvas");
  c.width = v.videoWidth;
  c.height = v.videoHeight;
  c.getContext("2d").drawImage(v, 0, 0);
  return c;
}

function flash() {
  const el = $("flash");
  el.classList.remove("on");
  void el.offsetWidth; // mulai ulang animasi
  el.classList.add("on");
}

async function startCapture() {
  const run = ++state.run;
  const t = template();
  const n = shotCount(t);
  state.shots = [];
  state.source = "camera";
  $("camError").hidden = true;
  $("frame").hidden = false;
  $("countNum").hidden = true;
  $("frame").style.setProperty("--ratio", shotRatio(t, 0));
  $("shotLabel").textContent = "Membuka kamera…";
  show("scrCapture");

  try { await openCamera(); }
  catch (err) { if (run === state.run) cameraError(err); return; }

  const mirror = state.s.facing === "user" && state.s.mirror;
  const manual = state.s.manual;
  $("scrCapture").classList.toggle("manual", manual);
  for (let i = 0; i < n; i++) {
    $("frame").style.setProperty("--ratio", shotRatio(t, i));
    $("shotLabel").textContent = n > 1 ? `Foto ${i + 1} dari ${n}` : "Lihat ke kamera";
    if (!(await (manual ? waitShutter() : countdown(state.s.countdown, run))) || run !== state.run) return;
    state.shots.push({ src: grabFrame(), mirror });
    flash();
    $("countLive").textContent = "Foto diambil";
    if (!manual && i < n - 1 && !(await wait(BETWEEN_SHOTS_MS, run))) return;
  }
  if (run === state.run) await goReview();
}

function cancelCapture() {
  stopCaptureRun();
  show("scrStart");
}

// ===== 4. Review =====
function drawCutLines(paper, t) {
  paper.querySelectorAll(".cut, .cut-h").forEach((el) => el.remove());
  for (const line of t.cutLines || []) {
    const el = document.createElement("div");
    el.setAttribute("aria-hidden", "true");
    if (line.x != null) { el.className = "cut"; el.style.left = `${(line.x / t.canvas.width) * 100}%`; }
    else { el.className = "cut-h"; el.style.top = `${(line.y / t.canvas.height) * 100}%`; }
    paper.append(el);
  }
}

function buildFilters() {
  $("filterList").replaceChildren(...state.filters.map((f) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip-btn";
    b.textContent = f.name;
    b.dataset.id = f.id;
    b.addEventListener("click", () => { state.filterId = f.id; drawReview(); });
    return b;
  }));
}

async function drawReview() {
  const t = template();
  $("filterList").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.id === state.filterId)));
  try {
    await prepareFonts(t);
    await renderTemplate($("reviewCanvas"), t, state.shots, {
      title: state.s.title, dateText: formatDate(state.s.date), filterOps: filterOf(state.filterId).ops,
      ...renderExtras(t),
    });
    drawCutLines($("reviewPaper"), t);
    $("cutNote").hidden = !t.cutLines?.length;
    // Rasio kertas (tegak atau mendatar) membatasi lebar preview supaya muat satu layar
    for (const id of ["reviewPaper", "sharePaper"]) $(id).style.setProperty("--ratio", t.canvas.width / t.canvas.height);
  } catch (err) {
    msg("reviewMsg", `Hasil gagal digambar: ${err.message}`, "error");
  }
}

async function goReview(note = "") {
  state.filterId = state.s.filterId;
  msg("reviewMsg", note);
  show("scrReview");
  await drawReview();
}

function retake() {
  if (state.source === "files") { show("scrStart"); $("filePick").click(); }
  else startCapture();
}

// ===== 5. Bagikan =====
const toBlob = (canvas, type, quality) => new Promise((resolve, reject) =>
  canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Gambar gagal dibuat"))), type, quality));

function qrSvg(text) {
  const qr = window.qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

function renderQrStatus({ sent, error }) {
  if (!state.sessionId || $("qrCard").hidden) return;
  let text;
  if (sent.includes(state.sessionId)) text = "Foto sudah ada di galeri.";
  else if (!navigator.onLine) text = "Belum ada internet. QR tetap bisa di-scan sekarang; foto muncul begitu booth online.";
  else if (error) text = `Belum terkirim (${error}). Dicoba lagi otomatis.`;
  else text = "Mengirim foto ke galeri…";
  $("qrStatus").textContent = text;
}

async function goShare() {
  $("btnAccept").disabled = true;
  try {
    const c = $("reviewCanvas");
    const png = await toBlob(c, "image/png");
    state.pngBlob = png;
    state.sessionId = cloud.randomId(10);
    const url = URL.createObjectURL(png);
    state.urls.push(url);
    $("shareImg").width = c.width;
    $("shareImg").height = c.height;
    $("shareImg").src = url;
    $("printImg").src = url;
    $("btnDownload").href = url;
    $("btnDownload").download = `${slug(state.s.title)}-${state.sessionId}.png`;
    const file = new File([png], $("btnDownload").download, { type: "image/png" });
    $("btnShare").hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
    msg("shareMsg", "");

    $("qrCard").hidden = !cloudActive();
    if (cloudActive()) {
      const link = cloud.sessionUrl(state.s.eventId, state.sessionId);
      if (window.qrcode) $("qrBox").innerHTML = qrSvg(link);
      else $("qrBox").textContent = link; // pustaka QR belum termuat: tampilkan link apa adanya
      $("qrStatus").textContent = "Menyimpan foto…";
      await cloud.enqueue({ eventId: state.s.eventId, sessionId: state.sessionId, blob: await toBlob(c, "image/jpeg", JPEG_QUALITY) });
    }
    show("scrShare");
  } catch (err) {
    msg("reviewMsg", `Foto gagal disimpan: ${err.message}`, "error");
  } finally {
    $("btnAccept").disabled = false;
  }
}

async function shareFile() {
  const file = new File([state.pngBlob], $("btnDownload").download, { type: "image/png" });
  try {
    await navigator.share({ files: [file], title: state.s.title });
  } catch (err) {
    if (err.name !== "AbortError") msg("shareMsg", `Gagal membagikan: ${err.message}`, "error");
  }
}

function resetSession() {
  stopCaptureRun();
  state.urls.forEach((u) => URL.revokeObjectURL(u));
  state.urls = [];
  state.shots = [];
  state.pngBlob = null;
  state.sessionId = "";
  $("shareImg").removeAttribute("src");
  $("printImg").removeAttribute("src");
  updateStart();
  show("scrStart");
}

// ===== Mulai =====
async function init() {
  document.querySelectorAll("[data-app-name]").forEach((el) => { el.textContent = APP_NAME; });
  document.title = `${APP_NAME}: Photo Booth`;

  try {
    const [tj, fj] = await Promise.all([loadJSON("templates.json"), loadJSON("filters.json")]);
    state.templates = tj.templates;
    state.filters = fj.filters;
    state.frames = (tj.frames || []).map((def) => ({ id: `bawaan:${def.id}`, name: def.name, builtin: def }));
  } catch (err) {
    $("boot").textContent = `Booth gagal dimuat: ${err.message}. Muat ulang halaman.`;
    $("boot").dataset.type = "error";
    return;
  }
  $("boot").remove();

  state.s = loadSettings();
  if (!state.templates.some((t) => t.id === state.s.templateId)) state.s.templateId = state.templates[0].id;
  if (!state.filters.some((f) => f.id === state.s.filterId)) state.s.filterId = state.filters[0].id;
  // Pengaturan versi sebelumnya menyimpan manual sebagai countdown 0
  if (!(state.s.countdown >= 1)) { state.s.manual = true; state.s.countdown = 3; }

  // Bingkai tersimpan dari sesi sebelumnya
  try {
    state.frames.push(...await frames.loadFrames()); // cocok tidaknya dicek per format di fitFor
  } catch { /* penyimpanan diblokir (mode privat): operator upload ulang */ }
  if (!currentFrame()) state.s.frameId = "";
  updateGuide();

  buildSetup();
  renderFrameCard();
  buildFilters();
  renderCloud();
  cloud.onQueue((st) => { renderQueue(st); renderQrStatus(st); });
  cloud.watchUser((user) => { state.user = user; renderCloud(); renderQueue(cloud.queueStatus()); })
    .catch((err) => { $("cloudInfo").textContent = `Galeri QR tidak bisa dimuat: ${err.message}`; });

  // Tombol
  $("btnOpen").addEventListener("click", openBooth);
  $("btnSignIn").addEventListener("click", () => cloud.signIn().catch((err) => msg("queueMsg", `Gagal masuk: ${err.message}`, "error")));
  $("btnSignOut").addEventListener("click", () => cloud.signOutUser());
  $("btnNewEvent").addEventListener("click", () => {
    state.s.eventId = "";
    state.s.title = "";
    state.s.date = todayISO();
    $("inTitle").value = "";
    $("inDate").value = state.s.date;
    saveSettings();
    renderCloud();
    msg("setupMsg", "Event baru: isi nama acara, lalu Buka booth. Galeri event lama tetap ada.", "ok");
    $("inTitle").focus();
  });
  $("btnSettings").addEventListener("click", () => show("scrSetup"));
  $("btnFramePick").addEventListener("click", () => $("framePick").click());
  $("framePick").addEventListener("change", (e) => uploadFrame(e.target.files[0]));
  $("frameNow").addEventListener("change", (e) => { if (e.target.name === "frame") selectFrame(e.target.value); });
  $("btnFrameDelete").addEventListener("click", removeFrame);
  $("btnStart").addEventListener("click", startCapture);
  $("btnPick").addEventListener("click", () => $("filePick").click());
  $("filePick").addEventListener("change", (e) => fromFiles(e.target.files));
  $("btnCancel").addEventListener("click", cancelCapture);
  $("btnShutter").addEventListener("click", pressShutter);
  $("btnCamRetry").addEventListener("click", startCapture);
  $("btnCamPick").addEventListener("click", () => { show("scrStart"); $("filePick").click(); });
  $("btnCamBack").addEventListener("click", () => show("scrStart"));
  $("btnAccept").addEventListener("click", goShare);
  $("btnRetake").addEventListener("click", retake);
  $("btnPrint").addEventListener("click", () => window.print());
  $("btnShare").addEventListener("click", shareFile);
  $("btnDone").addEventListener("click", resetSession);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && current() === "scrCapture") cancelCapture(); });

  if (state.s.title) { updatePageStyle(); updateStart(); show("scrStart"); }
  else show("scrSetup");

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

init();
