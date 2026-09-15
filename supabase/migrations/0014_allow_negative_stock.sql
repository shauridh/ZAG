-- 0014: kasir boleh memaksa jual menu habis (stok minus) dgn peringatan
-- Kebutuhan: kartu menu habis kini tetap bisa diklik — kasir diberi peringatan
-- (dapur produksi dadakan / opname tertinggal). Server pun harus menerima:
-- sebelumnya check_availability menolak keras saat stok kurang.
-- Solusi: create_transaction menerima p_allow_negative_stock (default false =
-- perilaku lama). Bahan tetap berkurang (boleh minus) — dibenahi opname menyusul.
-- IDENTITY: salinan persis create_transaction (0001) + 2 perubahan bertanda "CHG".
-- Idempotent: aman dijalankan berulang.

create or replace function create_transaction(
  p_order_type text,
  p_items jsonb,          -- [{product_id, qty}]
  p_payments jsonb,       -- [{method, amount}] (kosong utk channel online)
  p_discount integer default 0,
  p_note text default null,
  p_order_id bigint default null,
  p_allow_negative_stock boolean default false  -- CHG: opsi baru
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_shift bigint;
  v_txid bigint;
  v_subtotal integer := 0;
  v_hpp integer := 0;
  v_fee integer := 0;
  v_total integer := 0;
  v_paid integer := 0;
  it jsonb; pm jsonb;
  v_price integer; v_name text; v_ihpp integer;
  iid bigint; need numeric;
begin
  if v_user is null then raise exception 'Login dulu'; end if;

  -- channel online: tanpa pembayaran, komisi dari settings
  if p_order_type in ('gofood','grabfood','shopeefood') then
    v_fee := round((get_setting('channels','{"gofood":{"fee":10},"grabfood":{"fee":10},"shopeefood":{"fee":10}}')->>p_order_type)::numeric * 0 +
                   coalesce((get_setting('channels','{"gofood":{"fee":10},"grabfood":{"fee":10},"shopeefood":{"fee":10}}') -> p_order_type ->> 'fee')::integer, 10)
                   * (select sum((x->>'qty')::numeric * px.price) from jsonb_array_elements(p_items) x join products px on px.id = (x->>'product_id')::bigint) / 100);
  else
    if exists (select 1 from shifts where user_id = v_user and status = 'buka') then
      select id into v_shift from shifts where user_id = v_user and status = 'buka';
    elsif p_order_type = 'delivery' then
      null; -- pesanan portal boleh tanpa shift
    else
      raise exception 'Buka shift dulu sebelum menjual';
    end if;
  end if;

  -- CHG: tolak keras bila stok kurang, KECUALI kasir sadar habis & memaksa.
  if not coalesce(p_allow_negative_stock, false) then
    perform check_availability(p_items);
  end if;

  -- hitung subtotal & HPP dari data server (harga dari DB, bukan client)
  for it in select * from jsonb_array_elements(p_items) loop
    select price, name into v_price, v_name from products where id = (it->>'product_id')::bigint;
    v_subtotal := v_subtotal + round((it->>'qty')::numeric * v_price);
    v_ihpp := 0;
    for iid, need in select pn.ingredient_id, pn.need from product_needs((it->>'product_id')::bigint, (it->>'qty')::numeric) pn loop
      v_ihpp := v_ihpp + round(need * (select case when kind = 'prepared' then prepared_hpp(id) else price end from ingredients where id = iid));
    end loop;
    v_hpp := v_hpp + v_ihpp;
  end loop;

  v_total := v_subtotal - p_discount;
  if p_order_type not in ('gofood','grabfood','shopeefood') then
    for pm in select * from jsonb_array_elements(p_payments) loop
      v_paid := v_paid + (pm->>'amount')::integer;
    end loop;
    if v_paid < v_total then raise exception 'Pembayaran kurang dari total'; end if;
  end if;

  insert into transactions (shift_id, user_id, order_type, channel_fee, subtotal, discount, total, hpp, note)
  values (v_shift, v_user, p_order_type, v_fee, v_subtotal, p_discount, v_total, v_hpp, p_note)
  returning id into v_txid;

  update transactions set receipt_no = 'SB' || to_char(now(),'YYMMDD') || '-' || lpad(v_txid::text, 4, '0')
  where id = v_txid;

  for it in select * from jsonb_array_elements(p_items) loop
    select price, name into v_price, v_name from products where id = (it->>'product_id')::bigint;
    v_ihpp := 0;
    for iid, need in select pn.ingredient_id, pn.need from product_needs((it->>'product_id')::bigint, (it->>'qty')::numeric) pn loop
      v_ihpp := v_ihpp + round(need * (select case when kind = 'prepared' then prepared_hpp(id) else price end from ingredients where id = iid));
    end loop;
    insert into transaction_items (transaction_id, product_id, name, qty, price, hpp)
    values (v_txid, (it->>'product_id')::bigint, v_name, (it->>'qty')::numeric, v_price, v_ihpp);
  end loop;

  if p_order_type not in ('gofood','grabfood','shopeefood') and p_payments is not null then
    for pm in select * from jsonb_array_elements(p_payments) loop
      insert into payments (transaction_id, method, amount)
      values (v_txid, pm->>'method', (pm->>'amount')::integer);
    end loop;
  end if;

  -- potong stok sesuai resep + catat pergerakan (boleh minus bila dipaksa)
  for it in select * from jsonb_array_elements(p_items) loop
    for iid, need in select pn.ingredient_id, pn.need from product_needs((it->>'product_id')::bigint, (it->>'qty')::numeric) pn loop
      update ingredients set stock = stock - need where id = iid;
      insert into stock_movements (ingredient_id, qty, kind, ref, user_id)
      values (iid, -need, 'penjualan', 'TX' || v_txid::text, v_user);
    end loop;
  end loop;

  if p_order_id is not null then
    update orders set transaction_id = v_txid, status = 'diproses' where id = p_order_id;
  end if;

  return v_txid;
end $$;

-- Jalankan di Supabase SQL Editor, lalu:
notify pgrst, 'reload schema';

-- Verifikasi (argumen ke-7 harus p_allow_negative_stock):
-- select proargnames from pg_proc where proname = 'create_transaction';
