# Photo Booth

Aplikasi photo booth untuk acara: tamu berfoto, hasilnya dicetak, diunduh, atau diambil lewat QR. Istilah kanonik memakai bahasa Indonesia; nama di kode dicatat sebagai alias.

## Language

**Acara**:
Satu kegiatan (misalnya satu pernikahan) dengan nama, tanggal, dan satu galeri sendiri. Alias kode: `event`, `eventId`.
_Avoid_: Event (di teks UI dan dokumen)

**Sesi**:
Satu hasil jadi milik satu rombongan tamu: satu lembar gabungan dengan satu QR, disimpan ke Google Drive pribadi milik operator. Alias kode: `session`, `sessionId`.
_Avoid_: Foto, cetakan

**Bingkai**:
Gambar hiasan milik operator yang dipakai di semua format cetak dan tersedia di setiap perangkat operator. Alias kode: `frame`.
_Avoid_: Frame, overlay, template

**Operator**:
Pemilik booth yang login dengan satu akun Google yang diizinkan; satu-satunya yang boleh mengirim Sesi dan Bingkai ke Drive.
_Avoid_: Admin, user
