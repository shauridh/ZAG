-- ============================================================
-- FIX v2: pay_held_order — self-contained + diagnosa
-- Jalankan SELURUH isi file ini di Supabase SQL Editor, lalu lihat
-- hasil di grid "Results" baris terakhir. Tidak merusak data.
-- ============================================================

-- (1) Hapus SEMUA versi/overload pay_held_order di schema public
--     supaya tidak ada versi lama yang bersembunyi di signature lain.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'pay_held_order' and n.nspname = 'public'
  loop
    execute format('drop function %s', r.sig);
  end loop;
end $$;

-- (2) Buat ulang versi yang benar (dipanggil create_transaction, bukan create_tx)
create function public.pay_held_order(
  p_held_id bigint,
  p_method text,
  p_amount integer,
  p_discount integer default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_held held_orders;
  v_txid bigint;
  v_discount integer;
begin
  if v_user is null then raise exception 'Login dulu'; end if;
  if p_method not in ('cash','qris','transfer') then raise exception 'Metode bayar tidak dikenal'; end if;

  select * into v_held from held_orders where id = p_held_id;
  if not found then raise exception 'Bill tidak ditemukan (mungkin sudah dibayar)'; end if;

  v_discount := coalesce(p_discount, v_held.discount);

  select create_transaction(
    v_held.order_type,
    v_held.items,
    jsonb_build_array(jsonb_build_object('method', p_method, 'amount', p_amount)),
    v_discount,
    v_held.note
  ) into v_txid;

  delete from held_orders where id = p_held_id;
  return jsonb_build_object('id', v_txid);
end $$;

-- Grant standar agar app bisa memanggil
grant execute on function public.pay_held_order(bigint, text, integer, integer) to authenticated;

-- (3) Paksa PostgREST memuat ulang skema
notify pgrst, 'reload schema';

-- (4) HASIL DIAGNOSA — baca 3 kolom ini di grid Results:
--   bill_uji_ada   = 1  -> project ini BENAR (bill uji memang di sini)
--                     0  -> INI BUKAN project yang dipakai app! (cari project ref
--                           ohgqfvghsyithvwikcfn di daftar project Supabase)
--   status_fungsi  = SUDAH BARU -> fix berhasil terpasang di project ini
--   jumlah_overload = 1 -> bersih; >1 berarti sebelumnya ada duplikat (sudah dibersihkan langkah 1)
select
  (select count(*) from public.held_orders where label = 'Uji Bill Buffy') as bill_uji_ada,
  (
    select case when exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where p.proname = 'pay_held_order' and n.nspname = 'public'
        and p.prosrc like '%create_transaction(%'
    ) then 'SUDAH BARU' else 'MASIH LAMA' end
  ) as status_fungsi,
  (
    select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'pay_held_order' and n.nspname = 'public'
  ) as jumlah_overload;
