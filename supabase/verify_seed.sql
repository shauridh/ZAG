-- ============================================================
-- SABANA KASIR — Verifikasi data seed
-- Jalankan di SQL Editor SETELAH 0001_init.sql + seed.sql.
-- Semua query harus mengembalikan nilai "OK". Kalau ada "CEK!",
-- lihat keterangan di kolom catatan.
-- ============================================================

with checks as (
  select 'Jumlah kategori (harap 8)' as cek,
         (select count(*) from categories)::text as hasil,
         case when (select count(*) from categories) = 8 then 'OK' else 'CEK!' end as status
  union all
  select 'Jumlah bahan (harap 41)',
         (select count(*) from ingredients)::text,
         case when (select count(*) from ingredients) = 41 then 'OK' else 'CEK!' end
  union all
  select 'Bahan prepared (harap 8)',
         (select count(*) from ingredients where kind = 'prepared')::text,
         case when (select count(*) from ingredients where kind = 'prepared') = 8 then 'OK' else 'CEK!' end
  union all
  select 'Jumlah produk (harap 28)',
         (select count(*) from products)::text,
         case when (select count(*) from products) = 28 then 'OK' else 'CEK!' end
  union all
  select 'Resep produk terisi (>100 baris)',
         (select count(*) from recipe_items)::text,
         case when (select count(*) from recipe_items) > 100 then 'OK' else 'CEK!' end
  union all
  select 'Resep produksi prepared (harap 15)',
         (select count(*) from ingredient_recipes)::text,
         case when (select count(*) from ingredient_recipes) = 15 then 'OK' else 'CEK!' end
  union all
  select 'Paket bundling (harap 2)',
         (select count(*) from bundles)::text,
         case when (select count(*) from bundles) = 2 then 'OK' else 'CEK!' end
  union all
  select 'Target harian (harap 12)',
         (select count(*) from daily_targets)::text,
         case when (select count(*) from daily_targets) = 12 then 'OK' else 'CEK!' end
  union all
  select 'Zona ongkir (harap 4)',
         (select count(*) from delivery_zones)::text,
         case when (select count(*) from delivery_zones) = 4 then 'OK' else 'CEK!' end
  union all
  select 'Setting tersimpan (harap 10)',
         (select count(*) from settings)::text,
         case when (select count(*) from settings) = 10 then 'OK' else 'CEK!' end
  union all
  select 'Nama toko',
         (select value->>'name' from settings where key = 'store'),
         case when (select value->>'name' from settings where key = 'store') = 'Sabana Drieischicken' then 'OK' else 'CEK!' end
  union all
  select 'HPP 1 ekor ayam (harap ~61350)',
         round(product_hpp(5))::text,
         case when abs(product_hpp(5) - 61350) < 500 then 'OK' else 'CEK!' end
  union all
  select 'HPP Nasi Putih (harap ~1389)',
         round(product_hpp(7))::text,
         case when abs(product_hpp(7) - 1389) < 100 then 'OK' else 'CEK!' end
  union all
  select 'Sekuen id products >= 28',
         (select last_value from products_id_seq)::text,
         case when (select last_value from products_id_seq) >= 28 then 'OK' else 'CEK!' end
  union all
  select 'Sekuen id ingredients >= 57',
         (select last_value from ingredients_id_seq)::text,
         case when (select last_value from ingredients_id_seq) >= 57 then 'OK' else 'CEK!' end
)
select cek, hasil, status from checks
union all
select '--- Profil user ---',
       (select count(*) || ' user terdaftar' from profiles),
       case when (select count(*) from profiles) > 0 then 'OK' else 'BELUM ADA USER (buat di Authentication)' end
order by status desc, cek;

-- Profil user + peran (kasir default; jadikan admin dengan update di bawah)
select p.email_masked, pr.name, pr.role
from (select id, split_part(email,'@',1) || '@…' as email_masked from auth.users) p
join profiles pr on pr.id = p.id;
