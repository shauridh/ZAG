# AGENTS.md — Sabana Kasir

Kasir (POS) fried chicken Sabana Drieischicken. Frontend: Vite + React + TypeScript +
Tailwind + PWA. Backend: Supabase (Postgres + Auth + Realtime + Edge Functions).
Hosting: Vercel.

## Aturan wajib untuk agen

- **Bahasa antarmuka: Indonesia sehari-hari** yang natural (bukan terjemahan kaku).
  Label tombol spesifik konteks (contoh: "Bayar & Cetak", "Buka Shift"), bukan
  "Get Started"/"Learn More" (R-15).
- **antislop**: untuk pekerjaan UI, copy, layout mobile, atau komentar kode, baca
  `DESIGN.md` (arah) lalu skill terkait:
  - Core filter: `.agents/skills/antislop/SKILL.md`
  - UI/visual: `.agents/skills/antislop-ui/SKILL.md`
  - Copy & teks: `.agents/skills/antislop-copywriting/SKILL.md`
  - Layout mobile: `.agents/skills/antislop-layoutmobile/SKILL.md`
  Sebelum mulai, tetapkan mode (during/after). Selesai = wajib lapor **Delivery Gate**
  PASS/FAIL dengan bukti klik satu per satu (R-35).
- **Jangan hardcode data bisnis.** Menu, harga, kategori, bahan, resep, komisi channel,
  zona ongkir, template struk, ambang minyak, float kembalian: semuanya dari database
  (`settings`, tabel master) dan diubah lewat UI admin. Seed SQL hanya data awal.
- **Uang**: simpan sebagai integer rupiah di DB; di UI pakai `fmtRp()` dari
  `src/lib/money.ts`. **Qty/stok**: `numeric(12,4)`.
- **Perubahan stok hanya lewat RPC Postgres** (`create_transaction`,
  `create_production_batch`, `fill_fryer`, `end_oil_cycle`, `close_shift`) agar atomik.
  Frontend tidak pernah update stok langsung.
- **Snapshot HPP** disimpan di `transaction_items.hpp` saat penjualan; laporan historis
  memakai snapshot, bukan harga kini.
- **Konvensi file**: halaman di `src/pages/`, fungsi murni di `src/lib/` (wajib punya
  unit test untuk hitungan), komponen di `src/components/`. Mock mode (demo tanpa
  Supabase) ada di `src/lib/db.ts`; jangan biarkan dua jalur logika bisnis.
- **Struktur SQL**: skema + RLS + RPC di `supabase/migrations/`, data awal di
  `supabase/seed.sql`. Edge function di `supabase/functions/`.
- Komentar kode hanya yang bernilai (kenapa), bukan narasi generik (antislop-code).

## Perintah

```bash
npm run dev        # dev server
npm run build      # typecheck + build produksi
npm test           # vitest run
npm run typecheck  # tsc --noEmit
```
