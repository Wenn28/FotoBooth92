# [NAMA] Photo Booth

Aplikasi photo booth untuk iPad, HP, atau laptop. Dibuat dengan HTML, CSS, dan JavaScript murni, tanpa build step. Format cetak dan filter diatur lewat file JSON. Semua fitur terbuka, dan biaya Rp0.

- **Tanpa cloud (mode lokal):** foto, cetak 4R, unduh PNG, dan bagikan (AirDrop, WhatsApp, dan lainnya lewat menu Share bawaan perangkat).
- **Dengan cloud (opsional):** foto dikirim ke Google Drive Anda, lalu tamu scan QR untuk mengunduhnya di HP. Komponennya Firebase paket Spark (login operator dan data event) serta Google Apps Script (simpan file ke Drive).

## Alur

```
Pengaturan (operator) → Layar awal → Kamera + hitung mundur → Review (filter / ulangi) → Bagikan (cetak, unduh, QR) → Layar awal
```

- Layar review dan bagikan kembali ke layar awal setelah 2 menit tanpa sentuhan.
- Saat venue tanpa internet, foto disimpan di perangkat (IndexedDB), lalu dikirim otomatis begitu online. QR tetap bisa di-scan lebih dulu; fotonya muncul setelah terkirim.
- `sw.js` menyimpan salinan aplikasi, sehingga booth tetap bisa dibuka ulang tanpa internet setelah pernah dibuka sekali.

## File

| File | Isi |
|------|-----|
| `index.html` | Booth: pengaturan, layar awal, kamera, review, bagikan. |
| `galeri.html` | Halaman tamu. `?e=EVENT&s=SESI` menampilkan satu foto (tujuan QR); `?e=EVENT` menampilkan semua foto bila galeri dibuka. |
| `templates.json` | Format cetak. |
| `filters.json` | Filter foto. |
| `js/config.js` | Nama aplikasi, config Firebase, dan URL Apps Script. Kosong = mode lokal. |
| `js/render.js` | Menggambar template ke `<canvas>` (crop tengah, filter, teks). |
| `js/booth.js` | Alur layar booth. |
| `js/cloud.js` | Login, event, dan antrean upload. |
| `apps-script/Code.gs` | Penerima upload ke Google Drive. |
| `firestore.rules` | Aturan keamanan Firestore. |

## Jalankan di komputer

Kamera hanya bisa dibuka lewat HTTPS atau `localhost`.

```
npx serve .
```

Buka `http://localhost:3000`.

## Menambah format cetak

Tambahkan satu objek di `templates.json`. Ukurannya dalam piksel pada 300 dpi (4R = 1800 × 1200).

- `canvas`: ukuran dan warna latar kertas.
- `print`: ukuran kertas dalam inci, dipakai untuk `@page` saat mencetak.
- `panels`: potongan kertas. Isi `panel` digambar ulang di setiap potongan.
- `panel`: elemen dengan koordinat relatif terhadap potongan.
  - `photo`: `shot` adalah urutan foto (0 = foto pertama), lalu `x, y, w, h`. Foto di-crop tengah, tidak gepeng.
  - `text`: `field` berisi `title` atau `date`, dengan `x, y` sebagai titik tengah teks. Teks yang terlalu panjang dikecilkan otomatis sampai muat di `maxWidth`.
- `cutLines`: garis potong, hanya tampil di pratinjau. Isi `{ "x": 900 }` untuk garis tegak atau `{ "y": 600 }` untuk garis datar.
- `overlay` (opsional): path PNG transparan seukuran kanvas, digambar paling atas sebagai bingkai.

Jumlah foto yang diambil kamera dihitung otomatis dari `shot` terbesar.

Secara bawaan, potongan kanan menyalin isi potongan kiri. Tambahkan `"shotOffset": 1` pada potongan kanan agar memakai foto berikutnya, sehingga kiri dan kanan berisi foto berbeda (lihat template `4r-kiri-kanan-2-foto`).

## Bingkai upload (berlaku di semua format)

Di Pengaturan, kartu **Bingkai** berisi pilihan **Tanpa bingkai** dan daftar bingkai tersimpan. Bingkai yang dipilih dipakai di format apa pun, dari 1 foto sampai 4 foto. Posisi foto mengikuti format yang dipilih, jadi unduh **panduan ukuran** setelah memilih format.

- Ukuran file: **900 × 1200** (satu potongan, otomatis dipakai di kiri dan kanan) atau **1800 × 1200** (satu lembar penuh). Kelipatannya juga diterima, misalnya 1800 × 2400.
- Buat area foto **transparan (PNG)** supaya hiasan bingkai bisa menutupi tepi foto. Kalau ada satu saja area foto di format itu yang tidak transparan (misalnya JPG, atau bingkai yang didesain untuk format lain), bingkai otomatis dijadikan latar dan semua foto ditaruh di atasnya, sehingga tidak ada foto yang tertutup.
- Nama acara otomatis ditulis putih bila bingkai di area nama berwarna gelap. Tulisan ini bisa dimatikan kalau nama sudah ada di desain bingkai.
- **Unduh panduan ukuran** menghasilkan PNG 900 × 1200 dengan area foto transparan, untuk dipakai sebagai dasar desain di Canva atau aplikasi lain.
- Bisa menyimpan banyak bingkai, misalnya satu per acara. **Upload bingkai baru** menambah ke daftar dan langsung memilihnya. Klik bingkai di daftar untuk berganti, dan **Hapus bingkai terpilih** untuk menghapus.
- Bingkai disimpan di perangkat ini (IndexedDB), bukan di cloud. Perangkat lain perlu upload sendiri.

## Menambah filter

Tambahkan objek di `filters.json`. Opsi yang tersedia: `brightness`, `contrast`, `saturate` (1 = asli), `warmth`, `sepia`, `grayscale`, dan `soften`. Filter dihitung per piksel, sehingga hasilnya sama di Safari iPad dan Chrome.

## Setup galeri QR (opsional, Rp0)

### 1. Firebase (paket Spark, tanpa kartu kredit)

1. Buat project di [console.firebase.google.com](https://console.firebase.google.com). Jangan aktifkan Google Analytics.
2. **Project settings > General > Your apps > Web app**. Salin `apiKey`, `authDomain`, `projectId`, dan `appId` ke `js/config.js`.
3. **Authentication > Sign-in method**: aktifkan **Google**.
4. **Authentication > Settings > Authorized domains**: tambahkan domain Vercel Anda, misalnya `nama-anda.vercel.app`.
5. **Firestore Database > Create database** (production mode). Di tab **Rules**, tempel isi `firestore.rules`, lalu **Publish**.

Firebase Storage tidak dipakai, karena sekarang wajib paket Blaze yang meminta kartu kredit.

### 2. Google Drive + Apps Script

1. Di Drive, buat folder (misalnya `Booth`). Klik kanan, pilih **Share > General access: Anyone with the link, Viewer**, supaya foto bisa tampil di galeri tamu.
2. Buka [script.google.com](https://script.google.com) dan buat project baru. Tempel isi `apps-script/Code.gs`.
3. **Project Settings > Script Properties**, lalu isi:
   - `ROOT_FOLDER_ID`: ID folder dari URL `drive.google.com/drive/folders/<ID>`
   - `FIREBASE_API_KEY`: `apiKey` dari `js/config.js`
   - `FIREBASE_PROJECT_ID`: `projectId` dari `js/config.js`
4. Pilih fungsi `testSetup`, klik **Run**, lalu izinkan akses. Periksa **Execution log**: semua baris harus "terisi".
5. **Deploy > New deployment > Web app**. Isi Execute as: **Me**, Who has access: **Anyone**. Salin URL `/exec` ke `APPS_SCRIPT_URL` di `js/config.js`.
6. Setiap kali `Code.gs` diubah: **Deploy > Manage deployments > pensil > Version: New version > Deploy**. URL-nya tetap sama.

### 3. Di booth

Buka **Pengaturan**, pilih **Masuk dengan Google**, centang **Kirim foto ke galeri dan tampilkan QR**, lalu **Buka booth**. Link galeri acara akan muncul di Pengaturan.

## Deploy: GitHub + Vercel

1. Jadikan folder ini repo sendiri (`git init`), lalu push ke GitHub.
2. Di [vercel.com](https://vercel.com), pilih **Add New > Project** dan impor repo itu. Pilih Framework **Other**, kosongkan Build Command, dan isi Output Directory dengan `.`.
3. Setiap `git push` akan otomatis ter-deploy.

**Penting:** paket Vercel Hobby (gratis) hanya untuk pemakaian pribadi atau non-komersial. Kalau booth ini dipakai untuk usaha sewa, pakai **Firebase Hosting** (termasuk paket Spark yang sama) atau upgrade Vercel. Periksa syarat terbaru di situs masing-masing.

## Batas paket gratis

Foto disimpan di Google Drive, jadi berbagi kuota 15 GB dengan Gmail. Firestore Spark dan Apps Script punya kuota harian (baca/tulis dokumen dan panggilan UrlFetch). Angka pastinya bisa berubah, jadi cek halaman kuota resmi Firebase dan Apps Script sebelum acara besar.

## Belum ada (tahap berikutnya)

- GIF, boomerang, dan video
- Hapus background AI dan green screen
- Survei, disclaimer, dan stiker
- Kunci PIN untuk layar Pengaturan
- Slideshow di TV

SMS tidak akan didukung karena pengirimannya selalu berbayar. Sebagai gantinya: QR, WhatsApp, dan menu Share bawaan perangkat.
