# Folder Drive "frame" adalah sumber Bingkai

Bingkai disimpan di folder Drive `frame` dan disalin ke IndexedDB tiap perangkat. Daftar Bingkai tidak dicatat di database lain: isi folder adalah kebenarannya, sehingga file yang ditaruh manual lewat Drive web ikut muncul.

Alasan: tidak ada tabel kedua yang bisa tidak sinkron dengan Drive, dan Firestore tidak perlu diubah. Konsekuensinya, penghapusan di app memindahkan file ke `frame/terhapus` (bukan menghapus), dan identitas bingkai berupa hash isi (SHA-256) yang disimpan di deskripsi file Drive, bukan nama file.

Ditolak: daftar bingkai di Firestore (dua sumber kebenaran) dan link Drive publik langsung ke canvas (canvas "tainted", unduh dan cetak PNG gagal). Karena itu file diambil lewat Apps Script sebagai base64.
