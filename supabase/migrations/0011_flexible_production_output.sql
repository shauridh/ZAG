-- 0011: output produksi fleksibel (bahan mentah boleh jadi output langsung)
-- Sebelumnya: bahan tanpa resep dianggap "mengonsumsi dirinya sendiri" -> stok +qty lalu -qty (net 0),
-- dan validasi menolak bila stok < qty. Kini bahan tanpa resep = output langsung (tanpa konsumsi).
create or replace function ingredient_needs(p_ingredient_id bigint, p_qty numeric)
returns table (ingredient_id bigint, need numeric)
language sql stable as $$
  with recursive expand as (
    select p_ingredient_id as iid, p_qty as qty
    where exists (select 1 from ingredient_recipes r where r.ingredient_id = p_ingredient_id)
    union all
    select r.component_id, e.qty * r.qty
    from expand e
    join ingredient_recipes r on r.ingredient_id = e.iid
  )
  select e.iid, sum(e.qty)
  from expand e
  where not exists (select 1 from ingredient_recipes r where r.ingredient_id = e.iid)
  group by e.iid;
$$;

-- create_production_batch tidak perlu diubah: ia sudah memakai ingredient_needs,
-- jadi otomatis ikut semantik baru (output tanpa resep = stok + tanpa pemotongan).
-- Jalankan di Supabase SQL Editor, lalu:
notify pgrst, 'reload schema';

-- Verifikasi (harus mengembalikan 0 baris = tidak ada konsumsi untuk bahan tanpa resep):
-- select * from ingredient_needs((select id from ingredients where name ilike '%ayam potong 9%' limit 1), 9);
