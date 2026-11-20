// Mesin cetak: membaca template JSON lalu menggambarnya ke <canvas>.
// Semua ukuran layout ada di templates.json (piksel pada 300 dpi), bukan di kode ini.
import { drawFrame } from "./frames.js";

export const FONTS = {
  display: '"Fraunces", Georgia, serif',
  body: '"Plus Jakarta Sans", system-ui, sans-serif',
};
const PLACEHOLDER_FILL = "#EFE6D8"; // kotak contoh di thumbnail template
const PLACEHOLDER_INK = "#6B6158";
const MIN_TEXT_SIZE = 16;           // teks panjang dikecilkan sampai batas ini

export async function loadJSON(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${url} gagal dimuat (${res.status})`);
  return res.json();
}

const photos = (t) => t.panel.filter((el) => el.type === "photo");

// Nomor foto untuk slot di potongan p. shotOffset membuat potongan kanan memakai foto berikutnya.
const shotOf = (p, el) => el.shot + (p.shotOffset || 0);

// Jumlah foto berbeda yang dibutuhkan template
export const shotCount = (t) => Math.max(...t.panels.flatMap((p) => photos(t).map((el) => shotOf(p, el)))) + 1;

// Rasio lebar/tinggi slot pertama yang memakai foto ke-i (untuk bingkai preview kamera)
export function shotRatio(t, i) {
  for (const p of t.panels) {
    const el = photos(t).find((e) => shotOf(p, e) === i);
    if (el) return el.w / el.h;
  }
}

// Font harus termuat sebelum digambar ke canvas, kalau tidak canvas memakai font cadangan
export async function prepareFonts(t) {
  const specs = t.panel
    .filter((el) => el.type === "text")
    .map((el) => `${el.style || "normal"} ${el.weight || 400} ${el.size}px ${FONTS[el.font] || FONTS.body}`);
  await Promise.all(specs.map((s) => document.fonts.load(s).catch(() => null)));
}

// Gambar sumber dengan crop tengah (seperti object-fit: cover), tanpa gepeng
function drawCover(ctx, src, w, h, mirror) {
  const sw = src.naturalWidth || src.videoWidth || src.width;
  const sh = src.naturalHeight || src.videoHeight || src.height;
  const scale = Math.max(w / sw, h / sh);
  const cw = w / scale, ch = h / scale;
  const sx = (sw - cw) / 2, sy = (sh - ch) / 2;
  ctx.save();
  if (mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
  ctx.drawImage(src, sx, sy, cw, ch, 0, 0, w, h);
  ctx.restore();
}

// Terapkan filter per piksel. Urutan: lembut, terang, kontras, saturasi, hangat, sepia, hitam putih.
export function applyFilter(canvas, ops = {}) {
  const ctx = canvas.getContext("2d");
  const { width: w, height: h } = canvas;

  // Efek lembut: tumpuk salinan buram (diperkecil lalu diperbesar) dengan transparansi
  if (ops.soften) {
    const small = document.createElement("canvas");
    small.width = Math.max(1, Math.round(w / 10));
    small.height = Math.max(1, Math.round(h / 10));
    small.getContext("2d").drawImage(canvas, 0, 0, small.width, small.height);
    ctx.save();
    ctx.globalAlpha = ops.soften;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(small, 0, 0, w, h);
    ctx.restore();
  }

  const { brightness = 1, contrast = 1, saturate = 1, warmth = 0, sepia = 0, grayscale = 0 } = ops;
  if (brightness === 1 && contrast === 1 && saturate === 1 && !warmth && !sepia && !grayscale) return;

  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data; // Uint8ClampedArray: nilai otomatis dibatasi 0-255
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] * brightness, g = d[i + 1] * brightness, b = d[i + 2] * brightness;
    r = (r - 128) * contrast + 128; g = (g - 128) * contrast + 128; b = (b - 128) * contrast + 128;
    let lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = lum + (r - lum) * saturate; g = lum + (g - lum) * saturate; b = lum + (b - lum) * saturate;
    if (warmth) { r *= 1 + warmth; b *= 1 - warmth; }
    if (sepia) {
      const sr = 0.393 * r + 0.769 * g + 0.189 * b;
      const sg = 0.349 * r + 0.686 * g + 0.168 * b;
      const sb = 0.272 * r + 0.534 * g + 0.131 * b;
      r += (sr - r) * sepia; g += (sg - g) * sepia; b += (sb - b) * sepia;
    }
    if (grayscale) {
      lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r += (lum - r) * grayscale; g += (lum - g) * grayscale; b += (lum - b) * grayscale;
    }
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  ctx.putImageData(img, 0, 0);
}

// Satu foto yang sudah di-crop dan difilter, seukuran slot
function photoTile(shot, w, h, ops) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  drawCover(c.getContext("2d"), shot.src, w, h, shot.mirror);
  applyFilter(c, ops);
  return c;
}

function drawPlaceholder(ctx, el, x, y, idx) {
  ctx.fillStyle = PLACEHOLDER_FILL;
  ctx.fillRect(x, y, el.w, el.h);
  ctx.fillStyle = PLACEHOLDER_INK;
  ctx.font = `600 ${Math.round(Math.min(el.w, el.h) / 4)}px ${FONTS.body}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(idx + 1), x + el.w / 2, y + el.h / 2);
}

// Teks di tengah titik (x, y); dikecilkan bila lebih lebar dari maxWidth
function drawText(ctx, el, x, y, text) {
  if (!text) return;
  let size = el.size;
  const font = () => `${el.style || "normal"} ${el.weight || 400} ${size}px ${FONTS[el.font] || FONTS.body}`;
  ctx.font = font();
  while (el.maxWidth && ctx.measureText(text).width > el.maxWidth && size > MIN_TEXT_SIZE) {
    size -= 2;
    ctx.font = font();
  }
  ctx.fillStyle = el.color || "#000";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
}

const overlays = new Map();
function loadImage(src) {
  if (!overlays.has(src)) {
    overlays.set(src, new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Bingkai ${src} gagal dimuat`));
      img.src = src;
    }));
  }
  return overlays.get(src);
}

// Render lengkap. shots: [{ src, mirror }] atau null untuk thumbnail contoh.
// opts: { title, dateText, filterOps, showTitle, frame: { img, mode, onTop } }
// Urutan lapisan: latar, bingkai (bila area fotonya tidak transparan), foto, bingkai (bila transparan), teks.
export async function renderTemplate(canvas, t, shots, opts = {}) {
  const { width, height, background = "#FFFFFF" } = t.canvas;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  const { frame } = opts;
  if (frame && !frame.onTop) drawFrame(ctx, t, frame);

  const tiles = new Map(); // potongan kiri dan kanan memakai foto yang sama: cukup diproses sekali
  for (const p of t.panels) {
    for (const el of t.panel) {
      if (el.type !== "photo") continue;
      const x = p.x + el.x, y = p.y + el.y;
      const idx = shotOf(p, el);
      const shot = shots && shots[idx];
      if (!shot) { drawPlaceholder(ctx, el, x, y, idx); continue; }
      const key = `${idx}:${el.w}x${el.h}`;
      if (!tiles.has(key)) tiles.set(key, photoTile(shot, el.w, el.h, opts.filterOps));
      ctx.drawImage(tiles.get(key), x, y);
    }
  }

  if (frame && frame.onTop) drawFrame(ctx, t, frame);
  if (t.overlay) ctx.drawImage(await loadImage(t.overlay), 0, 0, width, height);

  const values = { title: opts.showTitle === false ? "" : opts.title, date: opts.dateText };
  for (const p of t.panels) {
    for (const el of t.panel) {
      if (el.type !== "text") continue;
      const style = frame?.textColor ? { ...el, color: frame.textColor } : el; // teks putih di atas bingkai gelap
      drawText(ctx, style, p.x + el.x, p.y + el.y, values[el.field]);
    }
  }
}
