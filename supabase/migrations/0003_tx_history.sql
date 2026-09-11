-- ============ Riwayat transaksi: ubah, hapus, refund ============
-- Prinsip proyek: uang & stok hanya bergerak lewat RPC atomik. Transaksi yang
-- sudah lunas tidak pernah diubah diam-diam: edit menerbitkan nota revisi
-- (nota lama ditandai 'direvisi', stok dikembalikan lalu dipotong lagi sesuai
-- nota baru), refund/hapus menyimpan jejak di kolom status + refund_of supaya
-- laporan tetap bisa direkonstruksi.

alter table transactions add column if not exists status text not null default 'normal'
  check (status in ('normal', 'direvisi', 'refund', 'batal'));
alter table transactions add column if not exists refund_of bigint references transactions;
alter table transactions add column if not exists refund_amount integer not null default 0;

create index if not exists idx_tx_status on transactions (status);

-- ============ Refund ============
-- Uang kembali ke pembayar, stok dikembalikan (barang kembali ke rak).
-- Nota refund bertotal negatif dengan payment negatif, jadi kas shift dan
-- laporan per metode bayar otomatis menghitung uang yang keluar.
create or replace function refund_transaction(p_tx_id bigint, p_reason text default null)
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

  -- baris item dicatat sebagai qty negatif agar rekap per item tetap seimbang
  insert into transaction_items (transaction_id, product_id, name, qty, price, hpp)
  select v_refund_id, product_id, name, -qty, price, hpp from transaction_items where transaction_id = v_tx.id;

  insert into payments (transaction_id, method, amount)
  values (v_refund_id, v_method, -v_refund_amount);

  -- kembalikan stok sesuai resep asli
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

-- ============ Hapus (pembatalan) ============
-- Untuk salah input: tidak ada uang yang berpindah, stok dikembalikan,
-- nota lama ditandai 'batal' dan jejaknya tetap ada.
create or replace function delete_transaction(p_tx_id bigint, p_reason text default null)
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

-- ============ Edit (revisi nota) ============
-- Nota lama ditandai 'direvisi' (tidak pernah dihapus), stok dikembalikan,
-- lalu nota baru diterbitkan dengan item & diskon yang benar. Shift diikuti
-- dari nota lama supaya kas shift tetap konsisten; pembayaran lama dipakai
-- ulang (uang sudah menjadi milik kas, yang berubah adalah barang & total).
create or replace function edit_transaction(
  p_tx_id bigint,
  p_items jsonb,
  p_discount integer default 0,
  p_note text default null
)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_tx transactions;
  v_new_id bigint;
  v_subtotal integer := 0;
  v_hpp integer := 0;
  v_total integer := 0;
  v_paid integer := 0;
  v_price integer;
  v_name text;
  v_ihpp integer;
  it record;
  pm record;
  iid bigint;
  need numeric;
begin
  if v_user is null then raise exception 'Login dulu'; end if;
  select * into v_tx from transactions where id = p_tx_id;
  if v_tx.id is null then raise exception 'Transaksi tidak ditemukan'; end if;
  if v_tx.status <> 'normal' then raise exception 'Transaksi sudah diproses (status %)', v_tx.status; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Nota revisi minimal punya 1 item'; end if;

  perform check_availability(p_items);

  -- subtotal & HPP nota baru dihitung dari data server, sama seperti penjualan biasa
  for it in select * from jsonb_array_elements(p_items) loop
    select price, name into v_price, v_name from products where id = (it->>'product_id')::bigint;
    if v_price is null then raise exception 'Menu tidak ditemukan: %', it->>'product_id'; end if;
    v_subtotal := v_subtotal + round((it->>'qty')::numeric * v_price);
    v_ihpp := 0;
    for iid, need in select pn.ingredient_id, pn.need from product_needs((it->>'product_id')::bigint, (it->>'qty')::numeric) pn loop
      v_ihpp := v_ihpp + round(need * (select case when kind = 'prepared' then prepared_hpp(id) else price end from ingredients where id = iid));
    end loop;
    v_hpp := v_hpp + v_ihpp;
  end loop;

  v_total := v_subtotal - p_discount;
  if v_total < 0 then raise exception 'Total tidak boleh negatif'; end if;

  -- uang tidak berpindah saat revisi: pembayaran lama dipakai ulang,
  -- jadi total baru tidak boleh melebihi yang sudah dibayar
  select coalesce(sum(amount), 0) into v_paid from payments where transaction_id = v_tx.id;
  if v_tx.order_type not in ('gofood','grabfood','shopeefood') and v_paid < v_total then
    raise exception 'Total revisi Rp % melebihi uang yang sudah dibayar Rp %', v_total, v_paid;
  end if;

  -- kembalikan stok nota lama
  for it in select * from transaction_items where transaction_id = v_tx.id loop
    for iid, need in select pn.ingredient_id, pn.need from product_needs(it.product_id, it.qty) pn loop
      update ingredients set stock = stock + need where id = iid;
      insert into stock_movements (ingredient_id, qty, kind, ref, user_id)
        values (iid, need, 'revisi', 'TX' || v_tx.id::text, v_user);
    end loop;
  end loop;

  update transactions
    set status = 'direvisi',
        note = concat_ws(' ', nullif(note, ''), 'Direvisi: item/diskon diperbarui, lihat nota berikutnya')
    where id = v_tx.id;

  insert into transactions (shift_id, user_id, order_type, channel_fee, subtotal, discount, total, hpp, note, status)
  values (
    v_tx.shift_id, v_user, v_tx.order_type, v_tx.channel_fee,
    v_subtotal, p_discount, v_total, v_hpp,
    coalesce(nullif(trim(p_note), ''), 'Revisi nota ' || coalesce(v_tx.receipt_no, v_tx.id::text)),
    'normal'
  ) returning id into v_new_id;

  update transactions set receipt_no = 'SB' || to_char(now(),'YYMMDD') || '-' || lpad(v_new_id::text, 4, '0')
  where id = v_new_id;

  for it in select * from jsonb_array_elements(p_items) loop
    select price, name into v_price, v_name from products where id = (it->>'product_id')::bigint;
    v_ihpp := 0;
    for iid, need in select pn.ingredient_id, pn.need from product_needs((it->>'product_id')::bigint, (it->>'qty')::numeric) pn loop
      v_ihpp := v_ihpp + round(need * (select case when kind = 'prepared' then prepared_hpp(id) else price end from ingredients where id = iid));
    end loop;
    insert into transaction_items (transaction_id, product_id, name, qty, price, hpp)
    values (v_new_id, (it->>'product_id')::bigint, v_name, (it->>'qty')::numeric, v_price, v_ihpp);
  end loop;

  -- pembayaran lama dipindah ke nota baru
  insert into payments (transaction_id, method, amount)
  select v_new_id, method, amount from payments where transaction_id = v_tx.id;

  -- potong stok sesuai resep nota baru
  for it in select * from jsonb_array_elements(p_items) loop
    for iid, need in select pn.ingredient_id, pn.need from product_needs((it->>'product_id')::bigint, (it->>'qty')::numeric) pn loop
      update ingredients set stock = stock - need where id = iid;
      insert into stock_movements (ingredient_id, qty, kind, ref, user_id)
        values (iid, -need, 'penjualan', 'TX' || v_new_id::text, v_user);
    end loop;
  end loop;

  return v_new_id;
end $$;

-- ============ close_shift: sadar refund & revisi ============
-- Kas drawer hanya dipengaruhi nota normal (uang masuk) dan nota refund
-- (uang keluar, payment negatif). Nota direvisi/batal tidak lagi dihitung
-- karena uangnya kini menempel di nota revisinya.
create or replace function close_shift(p_closing_cash integer, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_shift shifts;
  v_cash_sales integer;
  v_expected integer;
  v_diff integer;
  v_float integer;
  v_result jsonb;
begin
  if v_user is null then raise exception 'Login dulu'; end if;
  select * into v_shift from shifts where user_id = v_user and status = 'buka';
  if v_shift.id is null then raise exception 'Tidak ada shift terbuka'; end if;

  v_float := coalesce((get_setting('shift','{"float_cash":350000}') ->> 'float_cash')::integer, 350000);
  if p_closing_cash < v_float then
    raise exception 'Kas drawer kurang dari float wajib Rp %, tidak bisa tutup shift', v_float;
  end if;

  select coalesce(sum(p.amount),0) into v_cash_sales
  from payments p join transactions t on t.id = p.transaction_id
  where t.shift_id = v_shift.id and p.method = 'cash' and t.status in ('normal','refund');

  v_expected := v_shift.opening_cash + v_cash_sales;
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
    'expected_cash', v_expected,
    'closing_cash', p_closing_cash,
    'cash_diff', v_diff
  );
  return v_result;
end $$;
