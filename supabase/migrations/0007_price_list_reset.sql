-- ============================================================
-- 0007: Halaman Bahan Baku & HPP merged
-- 1) Kolom `small_unit`: satuan kecil hasil konversi isi kemasan
--    (mis. Pack isi 9 potong -> satuan kecil "potong"). Dipakai
--    resep langsung; kosong = pakai satuan beli.
-- 2) import_price_list(): impor/sinkron daftar harga supplier
--    (sumber: Price List Sabana Sharing Mitra) dari aplikasi.
-- 3) reset_operational_data(): kosongkan SEMUA data operasional
--    + master (transaksi, shift, stok, bahan, menu, dst) supaya
--    produksi bisa mulai dari nol. Pengaturan toko & profil user
--    TIDAK tersentuh.
-- 4) clear_owner_pin(): hapus PIN owner (lupa PIN -> set ulang).
-- ============================================================

alter table ingredients add column if not exists small_unit text;

-- ============ 2) Impor price list ============
-- Item: { code, name, buy_unit, pack_content, pack_price, small_unit }
-- pack_price = harga per 1 kemasan utuh; disimpan sbg price = pack_price / pack_content
-- (konvensi lama: price = harga per satuan dasar, dipakai HPP).
create or replace function import_price_list(p_items jsonb, p_replace boolean default false)
returns table (created bigint, updated bigint)
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  it jsonb;
  v_code text; v_name text; v_unit text; v_content numeric; v_pack_price integer; v_small text;
  v_id bigint;
  v_created bigint := 0;
  v_updated bigint := 0;
begin
  if v_user is null then raise exception 'Login dulu'; end if;
  if not is_admin() then raise exception 'Hanya admin yang bisa impor price list'; end if;

  if p_replace then
    -- mode ganti total: hapus master yang tidak punya riwayat, sisanya nonaktifkan
    perform delete_all_master();
  end if;

  for it in select * from jsonb_array_elements(p_items) loop
    v_code := nullif(trim(it->>'code'), '');
    v_name := trim(it->>'name');
    v_unit := coalesce(nullif(trim(it->>'buy_unit'), ''), 'pack');
    v_content := greatest(coalesce(nullif(trim(it->>'pack_content'), '')::numeric, 1), 0.0001);
    v_pack_price := coalesce((it->>'pack_price')::integer, 0);
    v_small := nullif(trim(coalesce(it->>'small_unit', '')), '');

    if v_name is null or v_name = '' then continue; end if;

    select id into v_id from ingredients where code = v_code and v_code is not null limit 1;
    if v_id is null then
      insert into ingredients (name, code, kind, buy_unit, pack_content, price, small_unit, stock, min_stock, active)
      values (v_name, v_code, 'raw', v_unit, v_content, round(v_pack_price / v_content), v_small, 0, 0, true);
      v_created := v_created + 1;
    else
      update ingredients
        set name = v_name, buy_unit = v_unit, pack_content = v_content,
            price = round(v_pack_price / v_content), small_unit = coalesce(v_small, small_unit)
      where id = v_id;
      v_updated := v_updated + 1;
    end if;
  end loop;

  return query select v_created, v_updated;
end $$;

-- ============ 3) Reset total: operasional mulai dari nol ============
-- Hapus master yang aman (tanpa riwayat); yang punya riwayat cukup nonaktif.
-- Dipakai sendirian ATAU dari reset_operational_data (setelah semua riwayat kosong).
create or replace function delete_all_master()
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  delete from daily_targets;
  delete from recipe_items;
  delete from ingredient_recipes;
  delete from bundle_items;
  delete from bundles;
  delete from ingredients;
  delete from products;
  delete from fryers;
end $$;

create or replace function reset_operational_data()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  t text;
begin
  if v_user is null then raise exception 'Login dulu'; end if;
  if not is_admin() then raise exception 'Hanya admin yang bisa reset data'; end if;

  -- riwayat operasional (detail dulu, baru header)
  delete from payments;
  delete from transaction_items;
  delete from transactions;
  delete from order_items;
  delete from orders;
  delete from customer_addresses;
  delete from customers;
  delete from production_batch_items;
  delete from production_batches;
  delete from oil_cycles;
  delete from purchase_items;
  delete from purchases;
  delete from stock_movements;
  delete from expenses;
  delete from other_income;
  delete from expense_categories;
  delete from shifts;

  -- master data (bahan, menu, resep, paket, fryer, target)
  perform delete_all_master();

  -- sequence kembali ke 1 supaya nomor nota/id mulai bersih (best effort)
  foreach t in array array[
    'transactions','transaction_items','payments','orders','order_items','shifts',
    'purchases','purchase_items','stock_movements','production_batches','production_batch_items',
    'oil_cycles','expenses','other_income','expense_categories','customers','customer_addresses',
    'ingredients','products','recipe_items','ingredient_recipes','bundles','bundle_items',
    'fryers','daily_targets'
  ] loop
    begin
      perform setval(pg_get_serial_sequence(t, 'id'), 1, false);
    exception when others then
      null; -- tabel tanpa identity/sequence: abaikan
    end;
  end loop;
end $$;

-- ============ 4) Hapus PIN owner (lupa PIN) ============
create or replace function clear_owner_pin()
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  delete from settings where key = 'owner_pin';
end $$;
