-- 0013: komposisi potongan per kemasan (pack_breakdown) — audit jual per potongan
-- Kebutuhan: "1 pack Ayam Potong 9 = 9 potong: 2 sayap, 2 paha atas, 2 paha bawah, 3 dada".
-- Selama ini produksi hanya menambah ANGKA stok; rincian potongan tidak terlihat
-- sehingga kasir tidak tahu berapa sayap/paha/dada yang bisa dijual.
-- Solusi: master bahan boleh menyimpan komposisi (jsonb) utk ditampilkan di
-- Produksi, Riwayat Batch, dan Kasir. Tidak mengubah perhitungan stok/HPP.
-- Idempotent: aman dijalankan berulang.

alter table ingredients
  add column if not exists pack_breakdown jsonb;
-- Bentuk data: [{"name":"Sayap","qty":2},{"name":"Paha Atas","qty":2},
--               {"name":"Paha Bawah","qty":2},{"name":"Dada","qty":3}]
-- null / [] = tidak dirinci (perilaku lama).

comment on column ingredients.pack_breakdown is
  'Rincian isi 1 kemasan per potongan; opsional, hanya untuk tampilan & audit jual.';

-- Jalankan di Supabase SQL Editor, lalu:
notify pgrst, 'reload schema';

-- Contoh isi komposisi untuk bahan ayam (jalan sekali; sesuaikan id bila perlu):
-- update ingredients set pack_breakdown =
--   '[{"name":"Sayap","qty":2},{"name":"Paha Atas","qty":2},{"name":"Paha Bawah","qty":2},{"name":"Dada","qty":3}]'::jsonb
-- where name ilike '%ayam potong 9%';
