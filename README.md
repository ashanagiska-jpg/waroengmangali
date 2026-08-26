# Warung Mang Ali — Offline Ready

Sistem kasir & inventaris warung yang **tetap jalan tanpa internet**.  
Semua input saat offline disimpan di perangkat (IndexedDB), lalu **otomatis di-upload ke Google Sheet** begitu sinyal kembali.

Live demo lama: [waroengmangali.vercel.app](https://waroengmangali.vercel.app)

---

## Fitur offline

| Fitur | Keterangan |
|--------|------------|
| Mode offline | Jual, kasbon, pengeluaran, ubah stok tetap bisa |
| Antrian sync | Data pending disimpan aman di IndexedDB |
| Auto-upload | Saat online / tab fokus / tiap 45 detik |
| Cache produk | Daftar barang & stok dari kunjungan terakhir |
| PWA | Bisa dipasang ke layar HP (Add to Home Screen) |
| Anti-dobel | ID transaksi dicek di Apps Script agar retry tidak dobel |

---

## Struktur file

```
waroengmangali-offline/
├── index.html              # UI + meta PWA
├── app.js                  # Logika kasir (sudah offline-aware)
├── offline-core.js         # IndexedDB + antrian sync
├── styles.css
├── sw.js                   # Service Worker (cache asset)
├── manifest.webmanifest    # Installable PWA
├── Code.gs                 # Backend Google Apps Script
└── README.md
```

---

## Cara deploy (lengkap)

### 1. Backend Google Apps Script

1. Buka [script.google.com](https://script.google.com) → **New project**
2. Hapus kode default, **tempel seluruh isi `Code.gs`**
3. Simpan → **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Salin URL Web App
5. (Opsional) Jalankan fungsi `setup` / buka spreadsheet yang terbentuk otomatis: **Database Warung Mang Ali**

### 2. Frontend

1. Buka `app.js`, ganti baris:

```js
const WEB_APP_URL = 'https://script.google.com/macros/s/XXXX/exec';
```

dengan URL Web App Anda.

2. Upload **semua file** ke hosting HTTPS:
   - [Vercel](https://vercel.com) (disarankan)
   - Netlify / GitHub Pages / Cloudflare Pages

   Contoh Vercel:
   ```bash
   npx vercel --yes
   ```

3. Buka situs lewat **HTTPS**, izinkan penyimpanan & (opsional) “Add to Home Screen”.

### 3. GitHub

```bash
git clone https://github.com/USERNAME/REPO.git
cd REPO
# salin semua file dari folder ini
git add .
git commit -m "Offline-first: IndexedDB queue + PWA sync ke Google Sheet"
git push
```

---

## Cara kerja singkat

```
User input (jual / kasbon / stok / pengeluaran)
        │
        ▼
  Update data di memori + IndexedDB (cache)
        │
        ▼
  Coba POST ke Apps Script
   ├── sukses → selesai
   └── gagal / offline → masuk antrian syncQueue
        │
        ▼
  Event online / interval / tombol refresh
        │
        ▼
  Proses antrian → Google Sheet
```

Badge kuning/oranye di atas layar menandakan **mode offline** atau **ada data menunggu sync**. Ketuk badge saat online untuk memaksa sync.

---

## Catatan penting

1. **Kunjungan pertama harus online** agar produk & data awal tersimpan di cache.
2. **Jangan clear data browser** jika masih ada antrian pending (badge masih muncul).
3. Foto produk saat offline: simpan dulu tanpa upload Drive; unggah foto ulang saat online jika perlu.
4. Setelah mengubah `Code.gs`, selalu **Deploy → Manage deployments → Edit → New version**.
5. Jika 2 perangkat offline bersamaan mengubah stok barang yang sama, stok di Sheet mengikuti urutan sync (last write wins untuk field stok produk; transaksi penjualan tetap tercatat semua).

---

## Testing offline

1. Buka aplikasi online → pastikan produk termuat.
2. Di Chrome DevTools → Network → centang **Offline**.
3. Lakukan penjualan / kasbon.
4. Matikan Offline → badge akan sinkron, data muncul di Google Sheet.

---

## Lisensi / kredit

Dibangun di atas proyek [ashanagiska-jpg/waroengmangali](https://github.com/ashanagiska-jpg/waroengmangali).  
Versi ini menambahkan lapisan offline-first (IndexedDB + Service Worker + antrian sync).
