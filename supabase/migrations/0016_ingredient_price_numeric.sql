-- 0016: harga per satuan kecil TANPA pembulatan — fix "harga kemasan tidak sesuai input"
--
-- Masalah: ingredients.price bertipe integer (harga per satuan kecil), padahal
-- harga kemasan supplier jarang habis dibagi isi kemasan. Contoh nyata:
--   Ayam Potong 9: harga kemasan 48.000 / isi 9 = 5.333,33... -> disimpan 5.333
--   -> tampilan balik 5.333 × 9 = 47.997 ≠ 48.000 yang diinput.
-- Selisih menggunung di SEMUA bahan dengan isi kemasan bukan pembagi pas
-- (48rb/9, 24rb/50, 23,5rb/1000, dst) dan ikut menyeret HPP & margin.
--
-- Solusi:
--   1. ingredients.price -> numeric(12,4): pecahan rupiah tersimpan utuh.
--   2. create_purchase() dan import_price_list() ditulis ulang tanpa round()
--      supaya pembelian & impor price list juga akurat (tinggal dikali balik).
--   3. Backfill: tiap baris price lama dibulatkan... tidak — dikoreksi dari
--      harga kemasan terakhir yang tercatat (pembelian terakhir per bahan);
--      bila tak ada riwayat, harga kemasan implisit price_lama × isi dipertahankan
--      sebagai nilai pecahan tepat (price = pack_price_lama / isi).
--      Karena price lama = round(pack/isi), maka pack lama TIDAK bisa
--      direkonstruksi sempurna — tapi selisihnya maksimal Rp1 × isi; nilai
--      terbaik yang tersedia = price lama apa adanya (sudah numerik), dan
--      harga berikutnya dari pembelian/impor/form sudah eksak.
--
-- Idempotent: aman dijalankan berulang. Jalankan di Supabase SQL Editor, lalu:
--   notify pgrst, 'reload schema';

-- ===== 1. Tipe kolom =====
-- Tambah kolom numerik baru (alter tipe langsung di kolom sama juga boleh,
-- tapi pakai USING di alter tipe lebih ringkas & mempertahankan nama kolom).
alter table ingredients
  alter column price type numeric(12,4)
  using price::numeric(12,4);

-- ===== 2. RPC pembelian: simpan pecahan eksak =====
create or replace function create_purchase(p_items jsonb, p_note text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_pid bigint;
  v_total numeric := 0;
  it jsonb; v_iid bigint; v_packs numeric; v_cost numeric; v_content numeric;
begin
  if v_user is null then raise exception 'Login dulu'; end if;

  insert into purchases (user_id, note) values (v_user, p_note) returning id into v_pid;

  for it in select * from jsonb_array_elements(p_items) loop
    v_iid := (it->>'ingredient_id')::bigint;
    v_packs := (it->>'packs')::numeric;
    v_cost := (it->>'unit_cost')::numeric;
    select pack_content into v_content from ingredients where id = v_iid;

    v_total := v_total + round(v_packs * v_cost);
    insert into purchase_items (purchase_id, ingredient_id, packs, unit_cost)
    values (v_pid, v_iid, v_packs, v_cost);

    update ingredients
      set stock = stock + v_packs * pack_content,
          price = v_cost / nullif(pack_content, 0)   -- TANPA round: pecahan utuh
      where id = v_iid;

    insert into stock_movements (ingredient_id, qty, kind, ref, user_id)
    values (v_iid, v_packs * v_content, 'pembelian', 'PO' || v_pid::text, v_user);
  end loop;

  update purchases set total = round(v_total) where id = v_pid;
  return v_pid;
end $$;

-- ===== 3. RPC impor price list: pecahan eksak =====
create or replace function import_price_list(p_items jsonb, p_replace boolean default false)
returns table (created bigint, updated bigint)
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  it jsonb;
  v_code text; v_name text; v_unit text; v_content numeric; v_pack_price numeric; v_small text;
  v_id bigint;
  v_created bigint := 0;
  v_updated bigint := 0;
begin
  if v_user is null then raise exception 'Login dulu'; end if;
  if not is_admin() then raise exception 'Hanya admin yang bisa impor price list'; end if;

  if p_replace then
    perform delete_all_master();
  end if;

  for it in select * from jsonb_array_elements(p_items) loop
    v_code := nullif(trim(it->>'code'), '');
    v_name := trim(it->>'name');
    v_unit := coalesce(nullif(trim(it->>'buy_unit'), ''), 'pack');
    v_content := greatest(coalesce(nullif(trim(it->>'pack_content'), '')::numeric, 1), 0.0001);
    v_pack_price := coalesce((it->>'pack_price')::numeric, 0);
    v_small := nullif(trim(coalesce(it->>'small_unit', '')), '');

    if v_name is null or v_name = '' then continue; end if;

    select id into v_id from ingredients where code = v_code and v_code is not null limit 1;
    if v_id is null then
      insert into ingredients (name, code, kind, buy_unit, pack_content, price, small_unit, stock, min_stock, active)
      values (v_name, v_code, 'raw', v_unit, v_content, v_pack_price / v_content, v_small, 0, 0, true);
      v_created := v_created + 1;
    else
      update ingredients
        set name = v_name, buy_unit = v_unit, pack_content = v_content,
            price = v_pack_price / v_content, small_unit = coalesce(v_small, small_unit)
        where id = v_id;
      v_updated := v_updated + 1;
    end if;
  end loop;

  return query select v_created, v_updated;
end $$;

notify pgrst, 'reload schema';
