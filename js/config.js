// Konfigurasi aplikasi.
// Biarkan firebaseConfig dan APPS_SCRIPT_URL kosong untuk mode lokal:
// booth tetap jalan (download, print, share), hanya galeri QR yang mati.

// Nama aplikasi yang tampil di layar. Placeholder sampai nama final dipilih.
export const APP_NAME = "[NAMA]";

// Isi dari Firebase Console: Project settings > General > Your apps > Web app > Config.
export const firebaseConfig = {
  apiKey: "AIzaSyBtw-aE7E8c_ljw0Y-XdAECBZJs7jAO8Qc",
  authDomain: "photobooth-4cc61.firebaseapp.com",
  projectId: "photobooth-4cc61",
  appId: "1:687558501903:web:b9484268d61481b7b9257a",
};

// URL Web App Apps Script (berakhiran /exec), lihat apps-script/Code.gs dan README.
export const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzUPFcS7p3P0Jkl2nbfHGJGUEAAuM5WMDCh1zIeP4Lhtj5UaX_A0dkDwp1dKxPROqiV6A/exec";
