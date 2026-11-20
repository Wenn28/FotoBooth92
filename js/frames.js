// Bingkai yang diupload operator. Disimpan di perangkat (IndexedDB) agar tetap ada setelah halaman dimuat ulang.

const RATIO_TOLERANCE = 0.03;  // selisih rasio yang masih diterima (3%)
const ALPHA_HOLE = 128;        // alpha di bawah ini dianggap "transparan" (area foto berlubang)
const DARK_BG = 0.45;          // kecerahan rata-rata area nama di bawah ini: teks putih

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("booth-assets", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("frames");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function op(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("frames", mode);
    const req = fn(tx.objectStore("frames"));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
  });
}

export async function fileToImage(blob) {
  const img = new Image();
  img.src = URL.createObjectURL(blob);
  await img.decode();
  return img;
}

// Satu record per bingkai, kuncinya id acak. Kembalikan id baru.
export async function saveFrame(blob, name) {
  const id = crypto.randomUUID();
  await op("readwrite", (s) => s.put({ blob, name, at: Date.now() }, id));
  return id;
}
export const deleteFrame = (id) => op("readwrite", (s) => s.delete(id));

// Semua bingkai tersimpan, urut dari yang paling lama diupload: [{ id, name, img }]
export async function loadFrames() {
  const keys = await op("readonly", (s) => s.getAllKeys());
  const recs = await op("readonly", (s) => s.getAll());
  const list = await Promise.all(recs.map(async (r, i) => ({ id: String(keys[i]), name: r.name, at: r.at || 0, img: await fileToImage(r.blob) })));
  return list.sort((a, b) => a.at - b.at);
}

const near = (a, b) => Math.abs(a / b - 1) <= RATIO_TOLERANCE;

// Cek ukuran bingkai terhadap template, lalu tentukan:
// mode "panel" (satu potongan, diulang kiri-kanan) atau "sheet" (satu lembar penuh),
// onTop: true bila SEMUA area foto format ini transparan (bingkai digambar di atas foto);
// bila ada yang tertutup, bingkai jadi latar supaya tidak ada foto yang tertutup.
export function analyzeFrame(img, t) {
  const p = t.panels[0];
  const w = img.naturalWidth, h = img.naturalHeight;
  let mode;
  if (near(w / h, p.w / p.h)) mode = "panel";
  else if (near(w / h, t.canvas.width / t.canvas.height)) mode = "sheet";
  else {
    const sizes = t.panels.length === 1 ? `${p.w} × ${p.h}` : `${p.w} × ${p.h} (satu potongan) atau ${t.canvas.width} × ${t.canvas.height} (satu lembar)`;
    throw new Error(`Ukuran bingkai untuk format ${t.name} harus ${sizes}. File ini ${w} × ${h}.`);
  }

  const c = document.createElement("canvas");
  c.width = mode === "panel" ? p.w : t.canvas.width;
  c.height = mode === "panel" ? p.h : t.canvas.height;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, c.width, c.height);

  // Alpha rata-rata di tengah setiap slot foto (di semua potongan bila bingkai satu lembar)
  const origins = mode === "panel" ? [{ x: 0, y: 0 }] : t.panels;
  const slots = t.panel.filter((el) => el.type === "photo");
  const onTop = origins.every((o) => slots.every((el) => {
    const cx = Math.round(o.x + el.x + el.w / 2), cy = Math.round(o.y + el.y + el.h / 2);
    const d = ctx.getImageData(cx - 20, cy - 20, 40, 40).data;
    let sum = 0;
    for (let i = 3; i < d.length; i += 4) sum += d[i];
    return sum / (d.length / 4) < ALPHA_HOLE;
  }));

  // Warna nama acara: putih bila bingkai di area nama gelap, supaya tetap terbaca
  let textColor = null;
  const title = t.panel.find((el) => el.type === "text" && el.field === "title");
  if (title) {
    const tw = title.maxWidth, th = title.size * 1.4;
    const td = ctx.getImageData(Math.round(title.x - tw / 2), Math.round(title.y - th / 2), tw, Math.round(th)).data;
    let lum = 0, weight = 0;
    for (let i = 0; i < td.length; i += 4) {
      const a = td[i + 3] / 255; // piksel transparan = kertas putih
      const l = (0.2126 * td[i] + 0.7152 * td[i + 1] + 0.0722 * td[i + 2]) / 255;
      lum += l * a + (1 - a); weight++;
    }
    if (lum / weight < DARK_BG) textColor = "#FFFFFF";
  }
  return { mode, onTop, textColor };
}

// Bingkai bawaan (dari templates.json "frames"): satu potongan dengan lubang di setiap posisi foto format t
export function builtinFrame(def, t) {
  const p = t.panels[0];
  const c = document.createElement("canvas");
  c.width = p.w; c.height = p.h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = def.background;
  ctx.fillRect(0, 0, p.w, p.h);
  if (def.panelBorder) {
    const { color, width, insets } = def.panelBorder;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    for (const i of insets) ctx.strokeRect(i, i, p.w - 2 * i, p.h - 2 * i);
  }
  for (const el of t.panel) {
    if (el.type !== "photo") continue;
    if (def.photoBorder) {
      const { color, width } = def.photoBorder;
      ctx.fillStyle = color;
      ctx.fillRect(el.x - width, el.y - width, el.w + 2 * width, el.h + 2 * width);
    }
    ctx.clearRect(el.x, el.y, el.w, el.h);
  }
  return c;
}

// Gambar bingkai: per potongan (diulang) atau satu lembar
export function drawFrame(ctx, t, frame) {
  if (frame.mode === "sheet") ctx.drawImage(frame.img, 0, 0, t.canvas.width, t.canvas.height);
  else for (const p of t.panels) ctx.drawImage(frame.img, p.x, p.y, p.w, p.h);
}

// PNG panduan satu potongan: area foto transparan, area nama ditandai. Dasar desain di Canva dan sejenisnya.
export function guideBlob(t) {
  const p = t.panels[0];
  const c = document.createElement("canvas");
  c.width = p.w; c.height = p.h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#F1E9DD";
  ctx.fillRect(0, 0, p.w, p.h);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const el of t.panel) {
    if (el.type === "photo") {
      // Garis di luar lubang, supaya area foto tetap bersih walau panduan langsung dipakai
      ctx.setLineDash([16, 10]);
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#C8431F";
      ctx.strokeRect(el.x - 4, el.y - 4, el.w + 8, el.h + 8);
      ctx.setLineDash([]);
      ctx.clearRect(el.x, el.y, el.w, el.h); // lubang transparan untuk foto
    } else if (el.type === "text") {
      const half = el.size * 0.8;
      ctx.setLineDash([10, 8]);
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#6B6158";
      ctx.strokeRect(el.x - el.maxWidth / 2, el.y - half, el.maxWidth, half * 2);
      ctx.setLineDash([]);
      ctx.fillStyle = "#6B6158";
      ctx.font = "600 28px system-ui, sans-serif";
      ctx.fillText(el.field === "title" ? "area nama acara (bisa dimatikan)" : "area tanggal", el.x, el.y);
    }
  }
  ctx.fillStyle = "#6B6158";
  ctx.font = "500 18px system-ui, sans-serif";
  ctx.fillText(`Panduan ${t.name}, ${p.w} × ${p.h} px. Kotak merah putus-putus = area foto, biarkan transparan.`, p.w / 2, 28);
  return new Promise((resolve) => c.toBlob(resolve, "image/png"));
}
