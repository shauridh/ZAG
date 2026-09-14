-- ============================================================
-- 0008 — Simpan Pesanan (bill) untuk pembayaran nanti
-- Kasir bisa menyimpan keranjang, lanjut melayani pelanggan lain,
-- lalu memanggil kembali bill yang sama untuk dibayar/void.
-- Stok baru dikurangi saat bill DIBAYAR, bukan saat disimpan —
-- bahan belum keluar dari gudang sebelum uang masuk.
-- ============================================================

create table if not exists held_orders (
  id bigint generated always as identity primary key,
  shift_id bigint references shifts(id) on delete set null,
  user_id uuid references profiles(id) on delete set null,
  order_type text not null default 'dinein',
  items jsonb not null,          -- [{product_id, name, qty, price}]
  subtotal integer not null default 0,
  discount integer not null default 0,
  total integer not null default 0,
  note text,
  label text,                    -- nama pelanggan / meja, opsional
  created_at timestamptz not null default now()
);

-- RLS: semua staff ter-autentikasi boleh memakai bill kasir
alter table held_orders enable row level security;
drop policy if exists "held_orders staff all" on held_orders;
create policy "held_orders staff all" on held_orders
  for all to authenticated
  using (true) with check (true);

-- ============ RPC: bayar bill tersimpan (atomik + stok) ============
-- Alur: baca bill -> buat transaksi (kurangi stok + validasi via create_transaction)
-- -> hapus bill. create_transaction berisi seluruh aturan bisnis transaksi.
create or replace function pay_held_order(
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

  -- diskon boleh direvisi saat pembayaran
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

-- ============ RPC: void bill (batal tanpa jadi transaksi) ============
create or replace function void_held_order(p_held_id bigint)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Login dulu'; end if;
  if not exists (select 1 from held_orders where id = p_held_id) then
    raise exception 'Bill tidak ditemukan (mungkin sudah dibayar)';
  end if;
  delete from held_orders where id = p_held_id;
end $$;

-- ============ Reset-to-zero: bill tersimpan juga ikut dihapus ============
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
  delete from held_orders;

  -- master data (bahan, menu, resep, paket, fryer, target)
  perform delete_all_master();

  -- sequence kembali ke 1 supaya nomor nota/id mulai bersih (best effort)
  foreach t in array array[
    'transactions','transaction_items','payments','orders','order_items','shifts',
    'purchases','purchase_items','stock_movements','production_batches','production_batch_items',
    'oil_cycles','expenses','other_income','expense_categories','customers','customer_addresses',
    'held_orders',
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
