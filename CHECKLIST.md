# Checklist Lengkap Sabana Kasir

Checklist operasional & teknis seluruh aplikasi. Centang yang sudah, sisakan yang belum.

---

## 1. Deploy & Setup Awal (sekali)

### Supabase
- [ ] Project dibuat; catat **Project URL** + **anon key** (Settings → API)
- [ ] SQL Editor: jalankan `supabase/migrations/0001_init.sql` (skema, RLS, RPC)
- [ ] SQL Editor: jalankan `0002_delivery_schedule.sql` (jadwal antar)
- [ ] SQL Editor: jalankan `0003_tx_history.sql` (refund/ubah/hapus nota)
- [ ] SQL Editor: jalankan `0004_backfill_profiles.sql` (kalau user dibuat sebelum 0001)
- [ ] SQL Editor: jalankan `0005_menu_photo_storage.sql` (foto menu)
- [ ] SQL Editor: jalankan **`0006_drawer_pin_delete.sql`** (fix refund, uang drawer, PIN owner, hapus master) — **wajib sebelum fitur baru dipakai**
- [ ] SQL Editor: jalankan `supabase/seed.sql` (menu, resep, bahan)
- [ ] Buat user admin di Authentication → Users, lalu:
      `update profiles set role='admin' where id=(select id from auth.users where email='admin@sabana.id');`
- [ ] (Opsional) Storage bucket `qris` untuk gambar QRIS
- [ ] (Opsional) Edge function email laporan shift: `supabase functions deploy email-shift-report` + `supabase secrets set SMTP_USER=... SMTP_PASS=...`

### Vercel
- [ ] Repo GitHub ter-import, framework Vite terdeteksi
- [ ] Environment Variables terisi: `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` *(tanpa ini app jalan mode DEMO!)*
- [ ] Deploy pertama sukses; halaman login tampil **tanpa** badge "DEMO"
- [ ] Domain/URL produksi aktif

### Pasca-migrasi 0006 (wajib sebelum operasional)
- [ ] Login admin → **Keuangan** → **Atur PIN Owner** (4+ digit, simpan untuk owner)
- [ ] Tes refund pertama di Riwayat Transaksi dengan PIN (bisa ke nota demo)
- [ ] Tes Uang Masuk/Keluar di Shift
- [ ] (Produksi) Tab "Beban Tetap" di Pengaturan sudah diisi angka nyata

---

## 2. Perangkat Kasir (per tablet/HP)

- [ ] Buka URL produksi di Chrome/Edge → login kasir/admin
- [ ] **Tambahkan ke layar utama** (install PWA) agar full-screen & offline-ready
- [ ] Pengaturan → **Tablet & Layar**: Keep Awake ON, Fullscreen ON, pilih **Ukuran kartu** (Normal/Besar)
- [ ] Pengaturan → **Printer**: pilih printer Bluetooth, tes cetak struk *(kalau printer bandel → ikuti §2b RawBT)*
- [ ] Pengaturan → **Halaman QRIS**: upload gambar QRIS asli (wajib sebelum pesanan portal bisa dibayar)
- [ ] Coba 1 transaksi penuh + cetak struk thermal nyata
- [ ] Pengaturan → **Toko & Operasional**: nama toko, alamat, telp, footer struk, float kembalian

### 2b. Cetak Struk via RawBT (jalur andal — pakai ini kalau Web Bluetooth gagal)

Kapan dipakai:
- Printer **tersambung tapi kertas tidak keluar** (gejala khas karakteristik salah / firmware non-standar)
- Dialog pair muncul **setiap sesi browser** dan mengganggu
- Ingin cetak **tanpa dialog sama sekali** — RawBT menjadi printer sistem Android

Setup (±5 menit, sekali per HP kasir):
1. Install **RawBT** dari Play Store (gratis).
2. Nyalakan printer; pastikan Bluetooth HP aktif.
3. Buka RawBT → pilih perangkat → pilih printer → selesaikan pairing bila diminta (PIN umum: `0000` atau `1234`).
4. Beri izin **Lokasi** bila Android memintanya (kebutuhan pemindaian Bluetooth).
5. Tes cetak dari dalam RawBT → kertas keluar = RawBT siap.
6. (Disarankan) Jadikan layanan cetak bawaan: Android **Pengaturan → Aplikasi → Aplikasi default → Aplikasi pencetakan → RawBT** (nama menu beda-beda antar merek HP).
7. Di aplikasi kasir: transaksi → panel Lunas → ketuk **Dialog** → pilih **RawBT** → struk tercetak lewat printer sistem, tanpa Web Bluetooth.

Catatan operasional:
- Jalur ini **tidak tersentuh** batasan browser: tidak ada dialog per sesi, tidak butuh ketukan, tetap jalan walau PWA dibuka standalone.
- Kalau RawBT punya opsi auto-start/default printer, aktifkan supaya kasir tidak perlu buka RawBT lagi.
- Kalau RawBT **juga** gagal mencetak (kertas tetap diam): masalahnya di printer/thermaltanya/kertas — tes dengan aplikasi resmi vendor printer sebelum menyalahkan aplikasi kasir.

---

## 3. Master Data (owner/admin, sekali + saat berubah)

- [ ] **Menu & Paket**: semua menu + harga + kategori benar; foto terupload (foto terlihat di Kasir & portal)
- [ ] **Menu**: resep tiap menu diatur (HPP terhitung, margin tampil; chip "HPP belum diatur" harus hilang)
- [ ] **Bahan & HPP**: semua bahan + harga beli per kemasan + isi kemasan (harga per satuan dasar tampil benar)
- [ ] **Bahan**: bahan "prepared" punya resep produksi (Sambal Geprek Cup, dll)
- [ ] **Stok & Pembelian**: catat pembelian awal supaya stok real
- [ ] **Target harian** per menu (dipakai dashboard aktual vs target)
- [ ] **Pengaturan → Outlet & Ongkir**: titik outlet di peta + zona ongkir + jarak maksimal
- [ ] **Pengaturan → Template Struk**: lebar kertas, header/footer, show QR
- [ ] **Pengaturan → Toko**: komisi channel (GoFood/GrabFood/ShopeeFood), umur minyak, margin warning
- [ ] **Keuangan → Kategori**: kategori pengeluaran sesuai kebutuhan
- [ ] **Keuangan → Beban Tetap** (di Pengaturan → tab Beban Tetap): listrik, gaji, sewa, dll
- [ ] **Pengaturan → Owner email/WhatsApp**: supaya laporan tutup shift terkirim otomatis

---

## 4. Operasional Harian — Kasir

### Buka toko
- [ ] **Shift** → Buka Shift, masukkan uang fisik di drawer (≥ float wajib)
- [ ] (Kalau ada) **Uang Masuk** untuk setoran modal tambahan

### Selama berjualan
- [ ] Transaksi tunai/QRIS/transfer lewat **Kasir** (cek kembalian, struk tercetak)
- [ ] Ada uang keluar drawer (belanja mendadak, bayar kurir)? → **Shift → Uang Keluar** (float wajib tetap tersisa otomatis dicek)
- [ ] **Pesanan**: terima/tolak pesanan portal, kirim QRIS, konfirmasi "Pembayaran Masuk" setelah customer bayar
- [ ] Stok menipis? → **Produksi** (batch + isi fryer) dan/atau **Stok → Pembelian**
- [ ] Salah input nota? → **Riwayat** → Hapus (minta PIN owner, stok kembali)
- [ ] Pelanggan batal/refund? → **Riwayat** → Refund (PIN owner, uang keluar otomatis tercatat)
- [ ] Nota perlu dikoreksi? → **Riwayat** → Ubah (nota revisi diterbitkan)

### Tutup toko
- [ ] **Laporan X** (cek sementara) → lalu **Tutup Shift**: hitung uang fisik, isi catatan bila minus
- [ ] Laporan otomatis ke email owner + tombol WhatsApp
- [ ] (Opsional) **Laporan Akhir Hari** → bagikan WhatsApp / unduh CSV

---

## 5. Operasional Rutin — Owner

### Mingguan
- [ ] Dashboard: tren penjualan, menu terlaris, stok kritis
- [ ] **Bahan & HPP → Insight Belanja**: rencana belanja 7 hari (tombol Isi Form Pembelian)
- [ ] Cek fryer: umur minyak / jumlah penggorengan (ganti bila lewat batas)

### Bulanan
- [ ] **Keuangan**: pilih bulan → cek Laba Rugi (omzet, HPP, komisi, beban, laba bersih)
- [ ] Catat semua pengeluaran (kategori) & pemasukan lain (mis. jelantah) bulan berjalan
- [ ] Unduh CSV Keuangan untuk pembukuan/pajak
- [ ] Opname stok fisik: **Stok → Opname** (stok sistem disamakan dengan hitungan fisik)
- [ ] Catat waste/busi: **Stok → Waste**
- [ ] (Punya resep berubah?) perbarui harga bahan → HPP ikut terhitung ulang

---

## 6. Portal Customer (`/order`)

- [ ] Daftar/login pakai nomor HP + PIN 6 digit
- [ ] Katalog + foto menu tampil; stok habis otomatis tertutup
- [ ] Keranjang → checkout: **Ambil Sendiri** (label "Ambil Sendiri") atau **Antar** (ongkir per zona)
- [ ] Pesanan masuk ke kasir → Terima → QRIS muncul → customer "Sudah Bayar" → kasir "Pembayaran Masuk, Proses" → transaksi otomatis tercatat
- [ ] Jadwal delivery & saklar on/off di Pengaturan → Outlet & Ongkir

---

## 7. Keamanan & Perawatan

- [ ] `.env.local.bak` **dihapus dari komputer** (berisi kredensial, tidak ikut git — jangan sampai bocor lewat cara lain) + tambahkan `*.bak` ke `.gitignore`
- [ ] PIN owner hanya diketahui owner; ganti berkala (Keuangan → Ganti PIN Owner)
- [ ] Backup Supabase: aktifkan **daily backup/PITR** (Settings → Add-ons) sebelum data asli mengalir
- [ ] Cek Riwayat transaksi secara berkala untuk jejak 'batal/refund' yang janggal
- [ ] Jangan bagikan anon key di luar env Vercel; kasir memakai akun role `kasir` (bukan admin)
- [ ] Update dependensi berkala (`npm audit`)
- [ ] Kalau build Vercel sukses tapi app tampil "DEMO" → hampir pasti env variable belum terisi

---

## 8. Status Pengujian (terakhir dijalankan)

| Fitur | Status |
|---|---|
| Login admin/kasir, role-based menu | ✅ |
| Kasir: transaksi tunai/QRIS, kembalian, struk | ✅ |
| Ukuran kartu Normal/Besar (Pengaturan → Tablet) | ✅ |
| Foto menu: upload, tampil Kasir/portal, object-contain | ✅ |
| Shift: buka/tutup, laporan X & akhir hari, email+WA | ✅ |
| **Uang masuk/keluar drawer + float guard** | ✅ (baru) |
| **PIN owner: set, verifikasi, refund & hapus wajib PIN** | ✅ (baru, demo) |
| **Hapus bahan & menu (guard "sudah terpakai")** | ✅ (baru, demo) |
| Portal: daftar, pesan, Ambil Sendiri, QRIS, konfirmasi | ✅ |
| Riwayat: ubah/hapus/refund nota | ✅ |
| Produksi, fryer, pembelian, waste, opname | ✅ (UI) |
| Keuangan: laba rugi, kategori & PIN di halaman Keuangan | ✅ (baru) |
| Offline queue + sync ulang | ✅ (unit test) |
| PWA precache + foto demo offline | ✅ |
| Typecheck & 94/94 unit test | ✅ |
| E2E tutup shift demo (`test_shift_e2e.py`): kembalian bukan penjualan, guard float, guard catatan, selisih minus tercatat | ✅ 5/5 |
| E2E Simpan Pesanan/Bill demo (`test_bill_e2e.py`): simpan, guard uang kurang, bayar+kembalian, hilang dari daftar, void | ✅ 5/5 |
| Migrasi 0006 dijalankan di Supabase produksi | ✅ (owner) |
| **Migrasi 0007 dijalankan di Supabase produksi** | ⬜ wajib sebelum go-live (`supabase/migrations/0007_price_list_reset.sql` — kolom satuan kecil + impor price list + reset mulai-dari-nol + hapus PIN) |
| **Migrasi 0008 dijalankan di Supabase produksi** | ✅ versi awal punya bug (`create_tx` tidak ada); **fix v2 `fix_pay_held_order.sql` dijalankan 14 Sep** (drop overload + create_transaction + reload schema; diagnosa: bill_uji_ada=1, SUDAH BARU) |
| **Migrasi 0009 dijalankan di Supabase produksi** | ⬜ penjaga transisi status pesanan portal + kasir bisa menolak pesanan yang sudah bayar tapi belum diverifikasi (`supabase/migrations/0009_portal_status_guard.sql`) |
| **Migrasi 0010 dijalankan di Supabase produksi** | ⬜ koreksi kas drawer: kembalian tunai tidak lagi dihitung penjualan (`supabase/migrations/0010_close_shift_change_fix.sql` — WAJIB, tanpa ini expected_cash tergelembung sebesar kembalian; **terbukti di live 14 Sep**: Laporan X shift #5 cash Rp199.000 vs omzet Rp112.000 = selisih kembalian Rp87.000. Sisi frontend sudah diperbaiki via `byPayment`, sisi `close_shift` server masih menunggu migrasi) |
| Simpan Pesanan (Bill) di **produksi**: simpan → bayar → struk + stok terpotong | ✅ teruji penuh live 14 Sep: simpan ✓ → bayar tunai Rp20rb utk Rp5rb → struk SB260914-0034 + kembalian Rp15rb ✓ → Riwayat kas net Rp5rb ✓ → Shift penjualan tunai +Rp5rb ✓ (cek stok terpotong saat opname berikutnya) |
| Go-live: Pengaturan → **Hapus Semua Data (mulai dari nol)**, lalu **Impor Price List** | ⬜ (produksi mulai bersih; stok diisi via Pembelian) |
| Refund/hapus di **produksi** pasca-0006 | ⬜ uji 1x di live |
| Printer thermal fisik (Bluetooth) | ⬜ uji di HP kasir — Web Bluetooth dulu, kalau gagal jalur **RawBT §2b** |
| RawBT di HP kasir terpasang & teruji | ⬜ (cadangan andal) |
| QRIS asli terupload di produksi | ⬜ |
