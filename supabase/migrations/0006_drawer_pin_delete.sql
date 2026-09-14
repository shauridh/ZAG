-- ============ Perbaikan refund/hapus + uang drawer + PIN owner ============
-- 1) Bug produksi: 0003 menulis stock_movements.kind 'refund'/'batal'/'revisi'
--    tapi CHECK di 0001 belum mengenalinya → refund gagal dengan
--    'violates check constraint "stock_movements_kind_check"'.
-- 2) Uang drawer: kasir bisa mencatat uang MASUK/KELUAR di luar penjualan
--    (modal disetor, beli bensin, uang lebaran, dll) selama shift.
-- 3) PIN owner: aksi sensitif (hapus transaksi, edit beban tetap) diminta PIN.
-- 4) Hapus master: bahan & menu bisa dihapus (ditolak bila sudah terpakai).

-- ============ 1) Fix constraint stock_movements ============
-- Tambah kind baru dulu (constraint lama dilepas, lalu dipasang ulang
-- mencakup semua kind yang pernah ditulis RPC mana pun).
alter table stock_movements drop constraint if exists stock_movements_kind_check;
alter table stock_movements
  add constraint stock_movements_kind_check
  check (kind in ('pembelian','produksi','penjualan','opname','waste','isifryer','lainnya',
                  'refund','batal','revisi'));

-- ============ 2) Uang drawer: kolom & RPC ============
alter table shifts add column if not exists cash_in integer not null default 0;
alter table shifts add column if not exists cash_out integer not null default 0;

create or replace function shift_cash_movement(p_direction text, p_amount integer, p_note text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_shift shifts;
begin
  if v_user is null then raise exception 'Login dulu'; end if;
  if p_direction not in ('in','out') then raise exception 'Arah tidak valid'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Nominal harus lebih dari 0'; end if;
  select * into v_shift from shifts where user_id = v_user and status = 'buka';
  if v_shift.id is null then raise exception 'Tidak ada shift terbuka'; end if;
  if p_direction = 'in' then
    update shifts set cash_in = cash_in + p_amount where id = v_shift.id;
  else
    update shifts set cash_out = cash_out + p_amount where id = v_shift.id;
    -- uang keluar membuat drawer berkurang; blokir bila float kembalian tidak aman
    perform 1 from shifts where id = v_shift.id
      and opening_cash + cash_in - cash_out
          >= coalesce((get_setting('shift','{"float_cash":350000}') ->> 'float_cash')::integer, 350000);
    if not found then raise exception 'Drawer akan kurang dari float kembalian wajib, tidak bisa keluarkan uang'; end if;
  end if;
  return jsonb_build_object('direction', p_direction, 'amount', p_amount, 'note', p_note);
end $$;

-- close_shift sadar uang masuk/keluar: drawer = modal + penjualan tunai + masuk − keluar
create or replace function close_shift(p_closing_cash integer, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_shift shifts;
  v_cash_sales integer;
  v_cash_in integer;
  v_cash_out integer;
  v_expected integer;
  v_diff integer;
  v_float integer;
  v_result jsonb;
begin
  if v_user is null then raise exception 'Login dulu'; end if;
  select * into v_shift from shifts where user_id = v_user and status = 'buka';
  if v_shift.id is null then raise exception 'Tidak ada shift terbuka'; end if;

  v_float := coalesce((get_setting('shift','{"float_cash":350000}') ->> 'float_cash')::integer, 350000);
  v_cash_in := coalesce(v_shift.cash_in, 0);
  v_cash_out := coalesce(v_shift.cash_out, 0);

  -- Penjualan tunai = uang diterima MINUS kembalian: payments menyimpan uang
  -- diterima (nota 27rb dibayar 50rb → kas masuk 27rb, kembali 23rb).
  select coalesce(sum(least(p.amount, t.total)),0) into v_cash_sales
  from payments p join transactions t on t.id = p.transaction_id
  where t.shift_id = v_shift.id and p.method = 'cash' and t.status in ('normal','refund');

  v_expected := v_shift.opening_cash + v_cash_sales + v_cash_in - v_cash_out;
  v_diff := p_closing_cash - v_expected;

  if v_diff < 0 and coalesce(p_note,'') = '' then
    raise exception 'Kas kurang Rp %, wajib isi catatan kejadian', -v_diff;
  end if;

  update shifts
    set closed_at = now(), closing_cash = p_closing_cash, expected_cash = v_expected,
        cash_diff = v_diff, note = p_note, status = 'tutup'
    where id = v_shift.id;

  v_result := jsonb_build_object(
    'shift_id', v_shift.id,
    'opened_at', v_shift.opened_at,
    'closed_at', now(),
    'opening_cash', v_shift.opening_cash,
    'cash_sales', v_cash_sales,
    'cash_in', v_cash_in,
    'cash_out', v_cash_out,
    'expected_cash', v_expected,
    'closing_cash', p_closing_cash,
    'cash_diff', v_diff
  );
  return v_result;
end $$;

-- ============ 3) PIN owner ============
-- Disimpan sebagai hash (sha256) supaya tidak dibaca dari tabel settings.
-- Catatan Supabase: pgcrypto hidup di schema 'extensions', jadi search_path
-- fungsi di bawah harus menyertakannya (public, extensions); tanpa itu
-- digest() tidak ditemukan. convert_to() menghindari error cast text→bytea.
create extension if not exists pgcrypto with schema extensions;

create or replace function check_owner_pin(p_pin text)
returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from settings
    where key = 'owner_pin' and value ->> 'pin_hash' = encode(digest(convert_to(coalesce(p_pin,''), 'UTF8'), 'sha256'), 'hex')
  );
$$;

create or replace function set_owner_pin(p_pin text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  -- hanya admin/owner yang boleh menetapkan PIN — kasir tidak boleh mengganti
  if not is_admin() then raise exception 'Hanya admin yang bisa atur PIN owner'; end if;
  insert into settings (key, value) values ('owner_pin', jsonb_build_object('pin_hash', encode(digest(convert_to(coalesce(p_pin,''), 'UTF8'), 'sha256'), 'hex')))
  on conflict (key) do update set value = excluded.value;
end $$;

-- Hapus transaksi & refund kini wajib PIN owner (kasir tahu PIN via owner).
create or replace function refund_transaction(p_tx_id bigint, p_reason text default null, p_owner_pin text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_tx transactions;
  v_refund_id bigint;
  v_refund_amount integer;
  v_method text;
  v_note text;
  it record;
  iid bigint;
  need numeric;
begin
  if v_user is null then raise exception 'Login dulu'; end if;
  if not check_owner_pin(p_owner_pin) then raise exception 'PIN owner salah'; end if;
  select * into v_tx from transactions where id = p_tx_id;
  if v_tx.id is null then raise exception 'Transaksi tidak ditemukan'; end if;
  if v_tx.status <> 'normal' then raise exception 'Transaksi sudah diproses (status %)', v_tx.status; end if;

  select method into v_method from payments where transaction_id = v_tx.id order by id limit 1;
  v_method := coalesce(v_method, 'qris');
  v_refund_amount := v_tx.total;
  v_note := trim(coalesce(p_reason, ''));
  if v_note = '' then v_note := 'Refund nota ' || coalesce(v_tx.receipt_no, v_tx.id::text);
  else v_note := v_note || ' (refund nota ' || coalesce(v_tx.receipt_no, v_tx.id::text) || ')';
  end if;

  insert into transactions (shift_id, user_id, order_type, channel_fee, subtotal, discount, total, hpp, note, status, refund_of, refund_amount)
  values (v_tx.shift_id, v_user, v_tx.order_type, 0, 0, 0, -v_refund_amount, 0, v_note, 'refund', v_tx.id, v_refund_amount)
  returning id into v_refund_id;

  update transactions
    set receipt_no = 'RF' || to_char(now(),'YYMMDD') || '-' || lpad(v_refund_id::text, 4, '0')
    where id = v_refund_id;

  insert into transaction_items (transaction_id, product_id, name, qty, price, hpp)
  select v_refund_id, product_id, name, -qty, price, hpp from transaction_items where transaction_id = v_tx.id;

  insert into payments (transaction_id, method, amount)
  values (v_refund_id, v_method, -v_refund_amount);

  for it in select * from transaction_items where transaction_id = v_tx.id loop
    for iid, need in select pn.ingredient_id, pn.need from product_needs(it.product_id, it.qty) pn loop
      update ingredients set stock = stock + need where id = iid;
      insert into stock_movements (ingredient_id, qty, kind, ref, user_id)
        values (iid, need, 'refund', 'TX' || v_refund_id::text, v_user);
    end loop;
  end loop;

  update transactions set status = 'refund' where id = v_tx.id;
  return jsonb_build_object(
    'refund_id', v_refund_id,
    'receipt_no', 'RF' || to_char(now(),'YYMMDD') || '-' || lpad(v_refund_id::text, 4, '0'),
    'amount', v_refund_amount,
    'method', v_method
  );
end $$;

create or replace function delete_transaction(p_tx_id bigint, p_reason text default null, p_owner_pin text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_tx transactions;
  it record;
  iid bigint;
  need numeric;
begin
  if v_user is null then raise exception 'Login dulu'; end if;
  if not check_owner_pin(p_owner_pin) then raise exception 'PIN owner salah'; end if;
  select * into v_tx from transactions where id = p_tx_id;
  if v_tx.id is null then raise exception 'Transaksi tidak ditemukan'; end if;
  if v_tx.status <> 'normal' then raise exception 'Transaksi sudah diproses (status %)', v_tx.status; end if;

  for it in select * from transaction_items where transaction_id = v_tx.id loop
    for iid, need in select pn.ingredient_id, pn.need from product_needs(it.product_id, it.qty) pn loop
      update ingredients set stock = stock + need where id = iid;
      insert into stock_movements (ingredient_id, qty, kind, ref, user_id)
        values (iid, need, 'batal', 'TX' || v_tx.id::text, v_user);
    end loop;
  end loop;

  update transactions
    set status = 'batal',
        note = concat_ws(' ', nullif(note, ''), 'Dibatalkan: ' || coalesce(nullif(trim(p_reason), ''), 'tanpa alasan'))
    where id = v_tx.id;
end $$;

-- ============ 4) Kategori beban ============
-- Dipindah ke settings (group 'expense_categories') supaya owner mengaturnya
-- langsung di menu Keuangan. seed lama di tabel expense_categories tetap dibaca.
create or replace function get_expense_categories()
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select value from settings where key = 'expense_categories'),
    (select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by id) from expense_categories),
    '[]'::jsonb
  );
$$;

-- ============ 5) Hapus master: menu & bahan ============
-- Menu yang sudah punya riwayat tidak boleh hilang (laporan rusak) → suruh
-- nonaktifkan. Menu benar-benar salah input boleh dihapus bersih.
create or replace function delete_product(p_product_id bigint)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_name text;
  v_used bigint;
begin
  if v_user is null then raise exception 'Login dulu'; end if;
  if not is_admin() then raise exception 'Hanya admin yang bisa hapus menu'; end if;
  select name into v_name from products where id = p_product_id;
  if v_name is null then raise exception 'Menu tidak ditemukan'; end if;
  select count(*) into v_used from transaction_items where product_id = p_product_id;
  if v_used = 0 then select count(*) into v_used from order_items where product_id = p_product_id; end if;
  if v_used = 0 then select count(*) into v_used from recipe_items where component_id = p_product_id and kind = 'product'; end if;
  if v_used > 0 then
    raise exception 'Menu % sudah terpakai di transaksi/resep. Pakai tombol Nonaktif, bukan hapus.', v_name;
  end if;
  delete from products where id = p_product_id;
end $$;

create or replace function delete_ingredient(p_ingredient_id bigint)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_name text;
  v_used bigint;
begin
  if v_user is null then raise exception 'Login dulu'; end if;
  if not is_admin() then raise exception 'Hanya admin yang bisa hapus bahan'; end if;
  select name into v_name from ingredients where id = p_ingredient_id;
  if v_name is null then raise exception 'Bahan tidak ditemukan'; end if;
  select count(*) into v_used from stock_movements where ingredient_id = p_ingredient_id;
  if v_used = 0 then select count(*) into v_used from purchase_items where ingredient_id = p_ingredient_id; end if;
  if v_used = 0 then select count(*) into v_used from production_batch_items where ingredient_id = p_ingredient_id; end if;
  if v_used = 0 then select count(*) into v_used from recipe_items where component_id = p_ingredient_id and kind = 'ingredient'; end if;
  if v_used = 0 then select count(*) into v_used from oil_cycles where oil_ingredient_id = p_ingredient_id; end if;
  if v_used > 0 then
    raise exception 'Bahan % sudah punya riwayat stok/transaksi. Nonaktifkan saja lewat tombol Edit.', v_name;
  end if;
  delete from ingredients where id = p_ingredient_id;
end $$;
