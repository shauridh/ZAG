-- 0012: riwayat batch produksi + satuan asal input (audit dapur)
-- Dapur kadang menginput output dalam satuan BELI (mis. 1 pack = 12 potong).
-- Angka yang tersimpan tetap satuan kecil (konvensi stok), tapi origin_unit
-- dicatat supaya riwayat bisa menampilkan "1 pack (12 potong)" untuk audit.
-- Idempotent: aman dijalankan berulang.

alter table production_batch_items
  add column if not exists origin_unit text;

-- RPC buat batch: simpan origin_unit per output (kolom opsional — payload
-- lama tanpa origin_unit tetap jalan). Sisanya sama dengan semantik 0001+0011:
-- validasi kecukupan, output tanpa resep = langsung, fryer butuh siklus minyak aktif.
create or replace function create_production_batch(
  p_outputs jsonb,               -- [{ingredient_id (prepared), qty, origin_unit?}]
  p_fryer_id bigint default null,
  p_fried_grams numeric default 0,
  p_note text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_bid bigint;
  v_cycle bigint;
  it jsonb; iid bigint; need numeric; have numeric; iname text;
begin
  if v_user is null then raise exception 'Login dulu'; end if;

  -- validasi kecukupan bahan mentah semua output
  for it in select * from jsonb_array_elements(p_outputs) loop
    for iid, need in select inr.ingredient_id, inr.need from ingredient_needs((it->>'ingredient_id')::bigint, (it->>'qty')::numeric) inr loop
      select stock, name into have, iname from ingredients where id = iid;
      if have < need then
        raise exception 'Bahan kurang: % (butuh %, tersedia %)', iname, round(need,2), round(have,2);
      end if;
    end loop;
  end loop;

  if p_fryer_id is not null then
    select id into v_cycle from oil_cycles where fryer_id = p_fryer_id and status = 'aktif';
    if v_cycle is null then raise exception 'Fryer belum diisi minyak (isi fryer dulu)'; end if;
  end if;

  insert into production_batches (user_id, fryer_id, oil_cycle_id, fried_grams, note)
  values (v_user, p_fryer_id, v_cycle, p_fried_grams, p_note)
  returning id into v_bid;

  for it in select * from jsonb_array_elements(p_outputs) loop
    -- catat output (origin_unit = 'buy' bila dapur input dalam satuan kemasan)
    insert into production_batch_items (batch_id, ingredient_id, qty, origin_unit)
    values (v_bid, (it->>'ingredient_id')::bigint, (it->>'qty')::numeric, nullif(it->>'origin_unit', ''));
    update ingredients set stock = stock + (it->>'qty')::numeric where id = (it->>'ingredient_id')::bigint;
    insert into stock_movements (ingredient_id, qty, kind, ref, user_id)
    values ((it->>'ingredient_id')::bigint, (it->>'qty')::numeric, 'produksi', 'PR' || v_bid::text, v_user);

    -- kurangi bahan mentah sesuai resep produksi
    for iid, need in select inr.ingredient_id, inr.need from ingredient_needs((it->>'ingredient_id')::bigint, (it->>'qty')::numeric) inr loop
      update ingredients set stock = stock - need where id = iid;
      insert into stock_movements (ingredient_id, qty, kind, ref, user_id)
      values (iid, -need, 'produksi', 'PR' || v_bid::text, v_user);
    end loop;
  end loop;

  if v_cycle is not null then
    update oil_cycles
      set fry_count = fry_count + 1, fried_grams = fried_grams + p_fried_grams
      where id = v_cycle;
  end if;

  return v_bid;
end $$;

-- Riwayat batch terbaru utk audit dapur: waktu, catatan (templat), dan
-- daftar output (nama bahan + qty satuan kecil + satuan asal bila ada).
-- Dipanggil: select * from recent_batches(20);
create or replace function recent_batches(p_limit int default 20)
returns table (
  id bigint,
  created_at timestamptz,
  note text,
  items jsonb
)
language sql stable security definer set search_path = public as $$
  select b.id,
         b.created_at,
         b.note,
         coalesce(
           jsonb_agg(
             jsonb_build_object(
               'ingredient_id', bi.ingredient_id,
               'name', i.name,
               'qty', bi.qty,
               'origin_unit', bi.origin_unit
             ) order by bi.id
           ) filter (where bi.id is not null),
           '[]'::jsonb
         )
    from production_batches b
    left join production_batch_items bi on bi.batch_id = b.id
    left join ingredients i on i.id = bi.ingredient_id
   group by b.id
   order by b.id desc
   limit p_limit;
$$;

-- Jalankan di Supabase SQL Editor, lalu:
notify pgrst, 'reload schema';

-- Verifikasi:
-- 1) select * from recent_batches(5);  -- kolom items memuat name/qty/origin_unit
-- 2) buat 1 batch dgn origin_unit 'buy' dari app, lalu cek:
--    select origin_unit, qty from production_batch_items order by id desc limit 1;
