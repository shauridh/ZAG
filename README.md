# Sabana Kasir 🍗

POS (Point of Sale) lengkap untuk usaha fried chicken **Sabana Drieischicken** — kasir, stok, produksi, siklus minyak fryer, pesanan online, laporan, dan keuangan dalam satu aplikasi web (PWA).

## Fitur

| Modul | Isi |
|---|---|
| **Kasir** | Numpad, channel GoFood/GrabFood/ShopeeFood (tanpa pembayaran, komisi otomatis), campuran tunai+QRIS+transfer, struk Bluetooth 58/80mm, notifikasi suara |
| **Shift** | Float kembalian wajib Rp350.000, laporan tutup kasir otomatis ke email pemilik (Gmail) |
| **Menu & Paket** | Produk, kategori, resep bersarang, target harian, paket bundling — semua CRUD dari aplikasi, tanpa hardcode |
| **Bahan & HPP** | Resep produksi bahan setengah jadi, update harga, HPP per produk dihitung ulang otomatis saat harga supplier berubah + peringatan margin |
| **Stok** | Pembelian (stok & harga terupdate otomatis), opname, waste/hangus |
| **Produksi & Fryer** | Batch produksi (marinasi, sambal cup, dll.), siklus minyak fryer (umur hari & jumlah fry), pemasukan minyak jelantah |
| **Pesanan** | Pesanan portal customer realtime + suara, terima/tolak/verifikasi QRIS |
| **Portal Customer** | `/order` — login PIN, katalog, keranjang, checkout peta + ongkir per radius, status QRIS, akun |
| **Dashboard & Laporan** | Grafik omzet/laba, per channel, terlaris, jam sibuk, target vs aktual, laba rugi bulanan, ekspor CSV |
| **Pengaturan** | Toko, struk, QRIS, outlet + zona ongkir (peta), channel, beban tetap, backup/reset demo |

## Menjalankan Lokal (Mode Demo)

```bash
npm install
npm run dev
```

Buka http://localhost:5173. Tanpa `.env`, aplikasi jalan dalam **mode demo**: semua data di localStorage, aturan bisnis identik dengan mode produksi. Login bebas — awali email dengan `admin` untuk peran pemilik (contoh: `admin@sabana.id`).

Perintah lain:

```bash
npm run typecheck   # cek tipe
npm test            # unit test (vitest)
npm run build       # build produksi + PWA ke dist/
python scripts/make-icons.py   # regenerate ikon PWA (stdlib saja)
```

## Deploy ke Produksi (Supabase + Vercel)

### 1. Supabase

1. Buat project di [supabase.com](https://supabase.com), catat **Project URL** & **anon key** (Settings → API).
2. **SQL Editor** → jalankan `supabase/migrations/0001_init.sql` (skema, RLS, RPC atomik).
   - Upgrade dari versi lama? Jalankan juga `0002_delivery_schedule.sql` (jadwal antar), `0003_tx_history.sql` (riwayat), `0004_backfill_profiles.sql` (profil lama), `0005_menu_photo_storage.sql` (foto menu), dan **`0006_drawer_pin_delete.sql`** (wajib: perbaiki refund `stock_movements_kind_check`, tambah uang masuk/keluar drawer, PIN owner, hapus bahan/menu).
3. Masih di SQL Editor → jalankan `supabase/seed.sql` (menu, resep & harga dari file HPP Excel + price list supplier).
4. Buat user pertama di **Authentication → Users** (mis. `admin@sabana.id`). Row `profiles` dibuat otomatis; set `role = 'admin'`:

   ```sql
   update profiles set role = 'admin' where id = (
     select id from auth.users where email = 'admin@sabana.id'
   );
   ```

   > Catatan: kalau user dibuat **sebelum** migrasi `0001` dipasang, row `profiles`
   > tidak terbentuk (trigger belum ada) dan semua tulis master data (produk,
   > kategori, bahan, foto menu) ditolak RLS **tanpa pesan error**. Jalankan
   > `supabase/migrations/0004_backfill_profiles.sql` untuk mengisi row yang
   > hilang, lalu set `role = 'admin'` seperti di atas.

5. **Edge Function email** (opsional, untuk laporan tutup shift):

   ```bash
   supabase functions deploy email-shift-report
   supabase secrets set SMTP_USER=alamatgmailmu SMTP_PASS=apppassword16karakter
   ```

   `SMTP_PASS` = App Password Gmail (akun Google → Security → 2-Step Verification → App passwords).

6. (Opsional) Set Storage bucket `qris` untuk upload gambar QRIS dari halaman Pengaturan.

### 2. Vercel

1. Push repo ini ke GitHub, lalu import di [vercel.com](https://vercel.com) (framework: Vite, terdeteksi otomatis).
2. Environment Variables:

   | Nama | Isi |
   |---|---|
   | `VITE_SUPABASE_URL` | Project URL Supabase |
   | `VITE_SUPABASE_ANON_KEY` | anon key Supabase |

3. Deploy. Aplikasi otomatis keluar dari mode demo dan memakai Postgres.

> `vercel.json` sudah menyertakan rewrite SPA, cache aset, dan header service worker. PWA: setelah deploy, buka di HP → "Tambahkan ke layar utama".

## Konvensi Data (penting)

- **`ingredients.price`** = harga per **satuan dasar** (per potong/cup/liter/kg), bukan per kemasan. Konversi kemasan → dasar terjadi otomatis saat pembelian: `price = unit_cost / pack_content`. Harga minyak 2L Rp43.400 → `21.700/liter`.
- **`pack_content`** = isi per kemasan (ekor ayam = 9 potong, pack cup = 50 cup, dst.).
- **Qty resep** dalam satuan dasar komponen (produk "1 ekor" memakai 9 × bahan marinasi).
- **Bahan setengah jadi** (marinasi, sambal cup) punya resep produksi; HPP produk selalu diekspansi sampai bahan mentah.
- Ganti harga supplier di halaman **Bahan** atau lewat **Pembelian** — semua HPP & peringatan margin terhitung ulang otomatis. Tidak ada harga yang di-hardcode.

## Struktur

```
supabase/migrations/0001_init.sql   skema + RLS + RPC atomik (sumber aturan bisnis)
supabase/seed.sql                   data awal dari HPP Excel + price list PDF
supabase/functions/                 Edge Function email laporan shift
src/lib/db.ts                       lapisan data: mode Supabase + mode demo (aturan sama)
src/lib/hpp.ts                      mesin HPP / ekspansi resep
src/pages/                          Dashboard, Kasir, Pesanan, Produksi, Bahan, Menu, Stok, Shift, Keuangan, Laporan, Pengaturan
src/portal/OrderPortal.tsx          portal customer /order
.agents/skills/                     aturan anti-slop (UI, copy, layout) yang diikuti kode ini
```
