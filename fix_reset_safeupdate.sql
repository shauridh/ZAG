-- ============================================================
-- FIX: reset_operational_data & delete_all_master gagal dengan
-- "DELETE requires a WHERE clause" (extension pg-safeupdate aktif
-- di project ini). Perbaikan: WHERE true pada delete penuh —
-- semantik sama (hapus semua baris), tapi lolos guard safeupdate.
-- Jalankan SELURUH isi file ini di Supabase SQL Editor (admin).
-- ============================================================

create or replace function public.delete_all_master()
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  delete from daily_targets where true;
  delete from recipe_items where true;
  delete from ingredient_recipes where true;
  delete from bundle_items where true;
  delete from bundles where true;
  delete from ingredients where true;
  delete from products where true;
  delete from fryers where true;
end $$;

create or replace function public.reset_operational_data()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  t text;
begin
  if v_user is null then raise exception 'Login dulu'; end if;
  if not is_admin() then raise exception 'Hanya admin yang bisa reset data'; end if;

  -- riwayat operasional (detail dulu, baru header)
  delete from payments where true;
  delete from transaction_items where true;
  delete from transactions where true;
  delete from order_items where true;
  delete from orders where true;
  delete from customer_addresses where true;
  delete from customers where true;
  delete from production_batch_items where true;
  delete from production_batches where true;
  delete from oil_cycles where true;
  delete from purchase_items where true;
  delete from purchases where true;
  delete from stock_movements where true;
  delete from expenses where true;
  delete from other_income where true;
  delete from expense_categories where true;
  delete from shifts where true;

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

-- ============ VERIFIKASI ============
-- select case when prosrc like '%where true%' then 'SUDAH BARU' else 'MASIH LAMA' end
-- from pg_proc where proname = 'reset_operational_data';
