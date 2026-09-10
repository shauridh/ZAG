-- 0002: Jadwal layanan antar opsional per hari & jam operasional.
-- Tersimpan di settings.key='portal'.delivery_schedule (jsonb, boleh null).
-- Tanpa jadwal, on/off antar murni mengikuti saklar manual delivery_enabled.
-- Baris hari yang hilang / jam tidak valid dianggap TUTUP (gagal aman).

create or replace function delivery_schedule_on(p_cfg jsonb)
returns boolean
language sql stable set search_path = public as $$
  with cfg as (
    -- jadwal tidak dipasang (field tidak ada atau null) = biarkan saklar manual yang menentukan
    select (p_cfg ? 'delivery_schedule' and p_cfg -> 'delivery_schedule' is not null) as has_schedule
  ),
  d as (
    select (extract(dow from now()))::int as dow,
           extract(hour from now())::int * 60 + extract(minute from now())::int as now_min
  ),
  day as (
    select
      case d.dow
        when 0 then 'sun' when 1 then 'mon' when 2 then 'tue' when 3 then 'wed'
        when 4 then 'thu' when 5 then 'fri' else 'sat'
      end as key,
      d.now_min
    from d
  ),
  r as (
    select
      coalesce(p_cfg -> 'delivery_schedule' -> day.key ->> 'open',  '') as open,
      coalesce(p_cfg -> 'delivery_schedule' -> day.key ->> 'close', '') as close,
      coalesce((p_cfg -> 'delivery_schedule' -> day.key ->> 'closed')::boolean, true) as closed,
      day.now_min
    from day
  ),
  today as (
    select r.*,
      -- open: 00:00-23:59; close: boleh 24:00 (tengah malam)
      r.open  ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' as open_ok,
      (r.close ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' or r.close = '24:00') as close_ok,
      case when r.close = '24:00' then 1440
           else split_part(r.close, ':', 1)::int * 60 + split_part(r.close, ':', 2)::int
      end as end_min,
      split_part(r.open, ':', 1)::int * 60 + split_part(r.open, ':', 2)::int as start_min
    from r
  )
  select
    not (select has_schedule from cfg)
    or exists (
      select 1 from today
      where not today.closed
        and today.open_ok and today.close_ok
        and today.now_min >= today.start_min
        and (today.now_min < today.end_min or today.close = '24:00')
    );
$$;

-- 0001 sudah mengecek delivery_enabled; jadwal (kalau dipasang) ikut membatasi.
-- Catatan: cocokkan juga penggantian fungsi portal_create_order yang sama di 0001;
-- bagian ini menimpa hanya fungsi tersebut, bukan seluruh skema.
create or replace function portal_create_order(p_token text, p_items jsonb, p_address_id bigint, p_note text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_cid bigint := portal_verify(p_token);
  v_oid bigint;
  it jsonb;
  v_price integer; v_name text;
  v_subtotal integer := 0;
  v_fee integer := 0;
  v_addr customer_addresses;
  v_cfg jsonb;
begin
  if v_cid is null then raise exception 'Sesi habis, silakan masuk lagi'; end if;
  select * into v_addr from customer_addresses where id = p_address_id and customer_id = v_cid;
  if v_addr.id is null then raise exception 'Alamat tidak ditemukan'; end if;
  if coalesce(v_addr.address,'') = '' then raise exception 'Isi alamat dulu di Pengaturan Akun'; end if;

  for it in select * from jsonb_array_elements(p_items) loop
    select price, name into v_price, v_name from products where id = (it->>'product_id')::bigint and is_active;
    if v_price is null then raise exception 'Menu tidak tersedia'; end if;
    v_subtotal := v_subtotal + (it->>'qty')::integer * v_price;
  end loop;

  v_cfg := coalesce(get_setting('portal','{"delivery_enabled":true}'), '{"delivery_enabled":true}');

  -- Layanan antar libur: saklar manual off, atau jadwal terpasang tapi sekarang di luar jam.
  if coalesce(v_addr.label,'') <> 'Ambil Sendiri'
     and (coalesce(v_cfg ->> 'delivery_enabled', 'true')::boolean is not true
          or not delivery_schedule_on(v_cfg)) then
    raise exception 'Layanan antar sedang libur, silakan pilih Ambil Sendiri';
  end if;

  -- ongkir: 0 kalau ambil sendiri (alamat label = 'Ambil Sendiri');
  -- jarak dihitung di server dari titik outlet ke titik alamat, bukan dari client
  if coalesce(v_addr.label,'') <> 'Ambil Sendiri' then
    declare o_lat double precision; o_lng double precision; v_dist double precision;
    begin
      select lat, lng into o_lat, o_lng from outlet_settings where id = 1;
      if o_lat is null then raise exception 'Titik outlet belum diatur admin'; end if;
      if v_addr.lat is null or v_addr.lng is null then
        raise exception 'Pilih titik lokasi di peta dulu';
      end if;
      v_dist := dist_km(o_lat, o_lng, v_addr.lat, v_addr.lng);
      update customer_addresses set distance_km = round(v_dist::numeric, 2) where id = p_address_id;
      v_fee := zone_fee(v_dist);
      if v_fee is null then
        raise exception 'Lokasi di luar radius pengiriman (maks % km)', (select max_radius_km from outlet_settings where id = 1);
      end if;
    end;
  end if;

  perform check_availability(p_items);

  insert into orders (customer_id, address_id, note, subtotal, delivery_fee, total)
  values (v_cid, p_address_id, p_note, v_subtotal, v_fee, v_subtotal + v_fee)
  returning id into v_oid;

  for it in select * from jsonb_array_elements(p_items) loop
    select price, name into v_price, v_name from products where id = (it->>'product_id')::bigint;
    insert into order_items (order_id, product_id, name, qty, price)
    values (v_oid, (it->>'product_id')::bigint, v_name, (it->>'qty')::integer, v_price);
  end loop;

  return v_oid;
end $$;
