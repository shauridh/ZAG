-- ============================================================
-- SABANA KASIR — Skema, RLS, dan RPC atomik
-- Jalankan di SQL Editor Supabase (sekali), lalu jalankan seed.sql
-- Semua perubahan stok WAJIB lewat RPC di file ini.
-- ============================================================

create extension if not exists pgcrypto;

-- ============ Tabel ============
-- PENTING URUTAN: tabel dibuat DULU, baru fungsi helper (is_admin, get_setting)
-- yang membacanya. Postgres memvalidasi isi fungsi SQL saat dibuat, jadi fungsi
-- yang mereferensi tabel sebelum tabelnya ada akan error 42P01.

create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null,
  role text not null default 'kasir' check (role in ('admin','kasir')),
  created_at timestamptz not null default now()
);

create table if not exists categories (
  id bigint generated always as identity primary key,
  name text not null unique,
  sort integer not null default 0
);

create table if not exists ingredients (
  id bigint generated always as identity primary key,
  name text not null,
  code text,
  kind text not null default 'raw' check (kind in ('raw','prepared')),
  buy_unit text not null default 'pack',
  pack_content numeric(12,4) not null default 1,
  price integer not null default 0,
  stock numeric(12,4) not null default 0,
  min_stock numeric(12,4) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists products (
  id bigint generated always as identity primary key,
  name text not null,
  photo text,
  category_id bigint references categories,
  price integer not null default 0,
  unit text not null default 'porsi' check (unit in ('porsi','potong','ekor','cup','paket')),
  is_active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

-- Resep produk: komponen bisa ingredient atau produk lain (induk resep).
create table if not exists recipe_items (
  id bigint generated always as identity primary key,
  product_id bigint not null references products on delete cascade,
  kind text not null check (kind in ('ingredient','product')),
  component_id bigint not null,
  qty numeric(12,4) not null
);

-- Resep produksi bahan setengah jadi: bahan mentah -> prepared.
create table if not exists ingredient_recipes (
  id bigint generated always as identity primary key,
  ingredient_id bigint not null references ingredients on delete cascade,
  component_id bigint not null references ingredients,
  qty numeric(12,4) not null
);

create table if not exists bundles (
  id bigint generated always as identity primary key,
  name text not null,
  price integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists bundle_items (
  id bigint generated always as identity primary key,
  bundle_id bigint not null references bundles on delete cascade,
  product_id bigint not null references products,
  qty integer not null default 1
);

create table if not exists fryers (
  id bigint generated always as identity primary key,
  name text not null,
  capacity_l numeric(8,2),
  is_active boolean not null default true
);

create table if not exists oil_cycles (
  id bigint generated always as identity primary key,
  fryer_id bigint not null references fryers,
  oil_ingredient_id bigint references ingredients,
  oil_liters numeric(10,3) not null default 0,
  oil_cost integer not null default 0,
  fry_count integer not null default 0,
  fried_grams numeric(12,2) not null default 0,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  disposed_liters numeric(10,3),
  jelantah_income integer not null default 0,
  status text not null default 'aktif' check (status in ('aktif','selesai'))
);

create table if not exists stock_movements (
  id bigint generated always as identity primary key,
  ingredient_id bigint not null references ingredients,
  qty numeric(12,4) not null,
  kind text not null check (kind in ('pembelian','produksi','penjualan','opname','waste','isifryer','lainnya')),
  ref text,
  note text,
  user_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists purchases (
  id bigint generated always as identity primary key,
  user_id uuid,
  note text,
  total integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists purchase_items (
  id bigint generated always as identity primary key,
  purchase_id bigint not null references purchases on delete cascade,
  ingredient_id bigint not null references ingredients,
  packs numeric(12,3) not null,
  unit_cost integer not null
);

create table if not exists production_batches (
  id bigint generated always as identity primary key,
  user_id uuid,
  fryer_id bigint references fryers,
  oil_cycle_id bigint references oil_cycles,
  fried_grams numeric(12,2) not null default 0,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists production_batch_items (
  id bigint generated always as identity primary key,
  batch_id bigint not null references production_batches on delete cascade,
  ingredient_id bigint not null references ingredients,
  qty numeric(12,4) not null
);

create table if not exists shifts (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opening_cash integer not null default 0,
  closing_cash integer,
  expected_cash integer,
  cash_diff integer,
  note text,
  status text not null default 'buka' check (status in ('buka','tutup'))
);
create unique index if not exists one_open_shift_per_user on shifts (user_id) where status = 'buka';

create table if not exists transactions (
  id bigint generated always as identity primary key,
  receipt_no text unique,
  shift_id bigint references shifts,
  user_id uuid,
  order_type text not null check (order_type in ('dinein','takeaway','gofood','grabfood','shopeefood','delivery')),
  channel_fee integer not null default 0,
  subtotal integer not null default 0,
  discount integer not null default 0,
  total integer not null default 0,
  hpp integer not null default 0,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists transaction_items (
  id bigint generated always as identity primary key,
  transaction_id bigint not null references transactions on delete cascade,
  product_id bigint references products,
  name text not null,
  qty numeric(12,3) not null,
  price integer not null,
  hpp integer not null default 0
);

create table if not exists payments (
  id bigint generated always as identity primary key,
  transaction_id bigint not null references transactions on delete cascade,
  method text not null check (method in ('cash','qris','transfer')),
  amount integer not null
);

-- ============ Portal customer ============

create table if not exists customers (
  id bigint generated always as identity primary key,
  phone text not null unique,
  name text not null,
  pin_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists customer_addresses (
  id bigint generated always as identity primary key,
  customer_id bigint not null references customers on delete cascade,
  label text not null default 'Rumah',
  address text not null,
  lat double precision,
  lng double precision,
  distance_km numeric(6,2),
  created_at timestamptz not null default now()
);

create table if not exists orders (
  id bigint generated always as identity primary key,
  customer_id bigint not null references customers,
  address_id bigint references customer_addresses,
  status text not null default 'menunggu' check (status in (
    'menunggu','ditolak','qris_dikirim','menunggu_verifikasi','diproses','dikirim','selesai','batal')),
  note text,
  subtotal integer not null default 0,
  delivery_fee integer not null default 0,
  total integer not null default 0,
  transaction_id bigint references transactions,
  reject_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists order_items (
  id bigint generated always as identity primary key,
  order_id bigint not null references orders on delete cascade,
  product_id bigint references products,
  name text not null,
  qty integer not null,
  price integer not null
);

create table if not exists delivery_zones (
  id bigint generated always as identity primary key,
  radius_km numeric(6,2) not null,
  fee integer not null default 0,
  sort integer not null default 0
);

create table if not exists outlet_settings (
  id integer primary key default 1 check (id = 1),
  lat double precision,
  lng double precision,
  max_radius_km numeric(6,2) default 8
);

-- ============ Keuangan & lainnya ============

create table if not exists expense_categories (
  id bigint generated always as identity primary key,
  name text not null unique
);

create table if not exists expenses (
  id bigint generated always as identity primary key,
  category_id bigint references expense_categories,
  amount integer not null,
  note text,
  user_id uuid,
  spent_at date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists other_income (
  id bigint generated always as identity primary key,
  source text not null,
  amount integer not null,
  note text,
  user_id uuid,
  earned_at date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists daily_targets (
  product_id bigint primary key references products on delete cascade,
  qty integer not null default 0
);

create table if not exists settings (
  key text primary key,
  value jsonb not null
);

-- ============ Helper peran & setting (di sini supaya tabelnya sudah ada) ============

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid());
$$;

create or replace function get_setting(p_key text, p_default jsonb default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select value from settings where key = p_key), p_default);
$$;

-- ============ RLS ============

alter table profiles enable row level security;
drop policy if exists "profile read own or admin" on profiles;
create policy "profile read own or admin" on profiles for select to authenticated using (auth.uid() = id or is_admin());
drop policy if exists "profile admin manages" on profiles;
create policy "profile admin manages" on profiles for all to authenticated using (is_admin()) with check (is_admin());

-- Tabel operasional & master: staff baca, admin tulis.
do $$
declare t text;
begin
  foreach t in array array[
    'ingredients','products','recipe_items','ingredient_recipes','bundles','bundle_items',
    'fryers','oil_cycles','stock_movements','purchases','purchase_items',
    'production_batches','production_batch_items','transactions','transaction_items',
    'payments','shifts','daily_targets','expense_categories','expenses','other_income',
    'customers','customer_addresses','orders','order_items'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "staff read" on %I', t);
    execute format('create policy "staff read" on %I for select to authenticated using (true)', t);
  end loop;

  foreach t in array array[
    'ingredients','products','recipe_items','ingredient_recipes','bundles','bundle_items',
    'fryers','daily_targets','expense_categories','oil_cycles'
  ] loop
    execute format('drop policy if exists "admin write" on %I', t);
    execute format('create policy "admin write" on %I for insert to authenticated with check (is_admin())', t);
    execute format('drop policy if exists "admin update" on %I', t);
    execute format('create policy "admin update" on %I for update to authenticated using (is_admin()) with check (is_admin())', t);
    execute format('drop policy if exists "admin delete" on %I', t);
    execute format('create policy "admin delete" on %I for delete to authenticated using (is_admin())', t);
  end loop;
end $$;

-- Pembelian, batch, waste, opname, expense, income: staff boleh insert (via RPC),
-- insert langsung dibuka terbatas ke staff.
drop policy if exists "staff insert purchases" on purchases;
create policy "staff insert purchases" on purchases for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "staff insert purchase_items" on purchase_items;
create policy "staff insert purchase_items" on purchase_items for insert to authenticated with check (true);
drop policy if exists "staff insert production" on production_batches;
create policy "staff insert production" on production_batches for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "staff insert production_items" on production_batch_items;
create policy "staff insert production_items" on production_batch_items for insert to authenticated with check (true);
drop policy if exists "staff insert expenses" on expenses;
create policy "staff insert expenses" on expenses for insert to authenticated with check (true);
drop policy if exists "staff insert other_income" on other_income;
create policy "staff insert other_income" on other_income for insert to authenticated with check (true);
drop policy if exists "staff update shift close" on shifts;
create policy "staff update shift close" on shifts for update to authenticated using (auth.uid() = user_id) with check (true);

alter table categories enable row level security;
drop policy if exists "cat read staff" on categories;
create policy "cat read staff" on categories for select to authenticated using (true);
drop policy if exists "cat read anon" on categories;
create policy "cat read anon" on categories for select to anon using (true);
drop policy if exists "cat admin write" on categories;
create policy "cat admin write" on categories for all to authenticated using (is_admin()) with check (is_admin());

alter table products enable row level security;
drop policy if exists "prod read anon" on products;
create policy "prod read anon" on products for select to anon using (is_active);
alter table bundles enable row level security;
drop policy if exists "bundle read anon" on bundles;
create policy "bundle read anon" on bundles for select to anon using (is_active);
alter table bundle_items enable row level security;
drop policy if exists "bundle item read anon" on bundle_items;
create policy "bundle item read anon" on bundle_items for select to anon using (true);

alter table delivery_zones enable row level security;
drop policy if exists "zone read anon" on delivery_zones;
create policy "zone read anon" on delivery_zones for select to anon using (true);
drop policy if exists "zone read staff" on delivery_zones;
create policy "zone read staff" on delivery_zones for select to authenticated using (true);
drop policy if exists "zone admin write" on delivery_zones;
create policy "zone admin write" on delivery_zones for all to authenticated using (is_admin()) with check (is_admin());

alter table outlet_settings enable row level security;
drop policy if exists "outlet read" on outlet_settings;
create policy "outlet read" on outlet_settings for select using (true);
drop policy if exists "outlet admin write" on outlet_settings;
create policy "outlet admin write" on outlet_settings for all to authenticated using (is_admin()) with check (is_admin());

alter table settings enable row level security;
drop policy if exists "settings read staff" on settings;
create policy "settings read staff" on settings for select to authenticated using (true);
drop policy if exists "settings read anon public" on settings;
create policy "settings read anon public" on settings for select to anon using (key in ('store','qris','portal'));
drop policy if exists "settings admin write" on settings;
create policy "settings admin write" on settings for all to authenticated using (is_admin()) with check (is_admin());

-- Tabel customer/order: tidak ada akses langsung dari client. Semua via RPC
-- security definer dengan token (lihat bawah). Kebijakan "staff read" di atas
-- tetap ada supaya kasir bisa melihat pesanan masuk.

-- Realtime untuk pesanan & transaksi
do $$
begin
  alter publication supabase_realtime add table orders;
  alter publication supabase_realtime add table transactions;
exception when others then null;
end $$;

-- updated_at otomatis untuk orders
create or replace function touch_row() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists orders_touch on orders;
create trigger orders_touch before update on orders for each row execute function touch_row();

-- ============ Hitung kebutuhan bahan (recursive) ============

-- Kebutuhan bahan untuk membuat qty unit produk (recipe bisa bersarang produk).
create or replace function product_needs(p_product_id bigint, p_qty numeric)
returns table (ingredient_id bigint, need numeric)
language sql stable as $$
  with recursive expand as (
    select p_product_id as pid, p_qty as qty
    union all
    select r.component_id, e.qty * r.qty
    from expand e
    join recipe_items r on r.product_id = e.pid and r.kind = 'product'
  )
  select r.component_id, sum(e.qty * r.qty)
  from expand e
  join recipe_items r on r.product_id = e.pid and r.kind = 'ingredient'
  group by r.component_id;
$$;

-- Kebutuhan bahan mentah untuk memproduksi qty unit bahan prepared (bisa bersarang).
create or replace function ingredient_needs(p_ingredient_id bigint, p_qty numeric)
returns table (ingredient_id bigint, need numeric)
language sql stable as $$
  -- Bahan tanpa resep produksi = output langsung (pemotongan/persiapan): TIDAK
  -- mengonsumsi apa pun (lihat 0011_flexible_production_output.sql). Tanpa filter
  -- exists ini, bahan tanpa resep dianggap memakai dirinya sendiri -> stok +qty lalu -qty (net 0).
  with recursive expand as (
    select p_ingredient_id as iid, p_qty as qty
    where exists (select 1 from ingredient_recipes r where r.ingredient_id = p_ingredient_id)
    union all
    select r.component_id, e.qty * r.qty
    from expand e
    join ingredient_recipes r on r.ingredient_id = e.iid
  )
  select e.iid, sum(e.qty)
  from expand e
  where not exists (select 1 from ingredient_recipes r where r.ingredient_id = e.iid)
  group by e.iid;
$$;

create or replace function prepared_hpp(p_ingredient_id bigint) returns numeric
language sql stable as $$
  select coalesce(sum(n.need * i.price), 0)
  from ingredient_needs(p_ingredient_id, 1) n
  join ingredients i on i.id = n.ingredient_id;
$$;

create or replace function product_hpp(p_product_id bigint) returns numeric
language sql stable as $$
  -- price = harga per satuan dasar (konversi kemasan terjadi saat pembelian).
  -- Daun prepared diekspansi ke biaya bahan mentahnya.
  select coalesce(sum(
    case when i.kind = 'prepared' then n.need * prepared_hpp(i.id)
         else n.need * i.price end), 0)
  from product_needs(p_product_id, 1) n
  join ingredients i on i.id = n.ingredient_id;
$$;

-- Validasi ketersediaan sejumlah (product_id, qty); raise exception bila kurang.
create or replace function check_availability(p_items jsonb) returns void
language plpgsql as $$
declare it jsonb; iid bigint; need numeric; have numeric; pname text; iname text;
begin
  for it in select * from jsonb_array_elements(p_items) loop
    for iid, need in select pn.ingredient_id, pn.need from product_needs((it->>'product_id')::bigint, (it->>'qty')::numeric) pn loop
      select stock, name into have, iname from ingredients where id = iid;
      if have < need then
        select name into pname from products where id = (it->>'product_id')::bigint;
        raise exception 'Stok kurang: % (butuh % %, tersedia %) untuk %', iname, round(need,2), 'unit', round(have,2), pname;
      end if;
    end loop;
  end loop;
end $$;

-- ============ RPC: transaksi kasir (atomik) ============

create or replace function create_transaction(
  p_order_type text,
  p_items jsonb,          -- [{product_id, qty}]
  p_payments jsonb,       -- [{method, amount}] (kosong utk channel online)
  p_discount integer default 0,
  p_note text default null,
  p_order_id bigint default null
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

  perform check_availability(p_items);

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

  -- potong stok sesuai resep + catat pergerakan
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

-- ============ RPC: pembelian bahan ============

create or replace function create_purchase(p_items jsonb, p_note text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_pid bigint;
  v_total integer := 0;
  it jsonb; v_iid bigint; v_packs numeric; v_cost integer; v_content numeric;
begin
  if v_user is null then raise exception 'Login dulu'; end if;

  insert into purchases (user_id, note) values (v_user, p_note) returning id into v_pid;

  for it in select * from jsonb_array_elements(p_items) loop
    v_iid := (it->>'ingredient_id')::bigint;
    v_packs := (it->>'packs')::numeric;
    v_cost := (it->>'unit_cost')::integer;
    select pack_content into v_content from ingredients where id = v_iid;

    v_total := v_total + round(v_packs * v_cost);
    insert into purchase_items (purchase_id, ingredient_id, packs, unit_cost)
    values (v_pid, v_iid, v_packs, v_cost);

    update ingredients
      set stock = stock + v_packs * pack_content,
          price = round(v_cost / nullif(pack_content,0))
      where id = v_iid;

    insert into stock_movements (ingredient_id, qty, kind, ref, user_id)
    values (v_iid, v_packs * v_content, 'pembelian', 'PO' || v_pid::text, v_user);
  end loop;

  update purchases set total = v_total where id = v_pid;
  return v_pid;
end $$;

-- ============ RPC: batch produksi ============

create or replace function create_production_batch(
  p_outputs jsonb,               -- [{ingredient_id (prepared), qty}]
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
  r record;
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
    -- catat output
    insert into production_batch_items (batch_id, ingredient_id, qty)
    values (v_bid, (it->>'ingredient_id')::bigint, (it->>'qty')::numeric);
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

-- ============ RPC: siklus minyak fryer ============

create or replace function fill_fryer(p_fryer_id bigint, p_oil_ingredient_id bigint, p_liters numeric)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_cid bigint;
  v_cost integer;
  v_have numeric;
begin
  if v_user is null then raise exception 'Login dulu'; end if;
  if exists (select 1 from oil_cycles where fryer_id = p_fryer_id and status = 'aktif') then
    raise exception 'Fryer ini masih punya siklus aktif, tutup dulu';
  end if;
  -- Siklus hanya MELACAK umur minyak. Stok minyak berkurang per penjualan
  -- sesuai resep (sudah termasuk di HPP), jadi di sini tidak memotong stok lagi.
  select stock into v_have from ingredients where id = p_oil_ingredient_id;
  if v_have < p_liters then
    raise exception 'Stok minyak tinggal % liter, catat pembelian dulu', round(v_have,1);
  end if;

  v_cost := round(p_liters * (select price from ingredients where id = p_oil_ingredient_id));

  insert into oil_cycles (fryer_id, oil_ingredient_id, oil_liters, oil_cost)
  values (p_fryer_id, p_oil_ingredient_id, p_liters, v_cost)
  returning id into v_cid;

  return v_cid;
end $$;

create or replace function end_oil_cycle(p_cycle_id bigint, p_disposed_liters numeric, p_jelantah_income integer)
returns void
language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Login dulu'; end if;
  update oil_cycles
    set status = 'selesai', ended_at = now(), disposed_liters = p_disposed_liters, jelantah_income = p_jelantah_income
    where id = p_cycle_id and status = 'aktif';
  if p_jelantah_income > 0 then
    insert into other_income (source, amount, note, user_id)
    values ('Penjualan minyak jelantah', p_jelantah_income, 'Siklus minyak #' || p_cycle_id::text, v_user);
  end if;
end $$;

-- ============ RPC: shift & float kembalian ============

create or replace function open_shift(p_opening_cash integer) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_float integer;
  v_id bigint;
begin
  if v_user is null then raise exception 'Login dulu'; end if;
  if exists (select 1 from shifts where user_id = v_user and status = 'buka') then
    raise exception 'Masih ada shift yang terbuka';
  end if;
  v_float := coalesce((get_setting('shift','{"float_cash":350000}') ->> 'float_cash')::integer, 350000);
  if p_opening_cash < v_float then
    raise exception 'Modal awal kurang dari float kembalian wajib (Rp %)', v_float;
  end if;
  insert into shifts (user_id, opening_cash) values (v_user, p_opening_cash) returning id into v_id;
  return v_id;
end $$;

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

  -- Penjualan tunai = uang diterima MINUS kembalian (payments menyimpan uang diterima).
  select coalesce(sum(least(p.amount, t.total)),0) into v_cash_sales
  from payments p join transactions t on t.id = p.transaction_id
  where t.shift_id = v_shift.id and p.method = 'cash';

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

-- Ringkasan kas untuk laporan X / tutup shift
create or replace function shift_summary(p_shift_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s shifts; r jsonb;
begin
  select * into s from shifts where id = p_shift_id;
  select jsonb_build_object(
    'shift', to_jsonb(s),
    'by_method', (select jsonb_object_agg(method, sum) from (select method, sum(amount) as sum from payments p join transactions t on t.id=p.transaction_id where t.shift_id = s.id group by method) m),
    'by_channel', (select jsonb_object_agg(order_type, sum) from (select order_type, sum(total) as sum from transactions where shift_id = s.id group by order_type) c),
    'items', (select coalesce(jsonb_agg(row_to_json(x)),'[]'::jsonb) from (
        select ti.name, sum(ti.qty) as qty, sum(ti.price*ti.qty) as total
        from transaction_items ti join transactions t on t.id = ti.transaction_id
        where t.shift_id = s.id group by ti.name order by total desc) x)
  ) into r;
  return r;
end $$;

-- ============ RPC: waste & opname ============

create or replace function log_waste(p_lines jsonb, p_note text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); it jsonb; iid bigint; need numeric;
begin
  if v_user is null then raise exception 'Login dulu'; end if;
  for it in select * from jsonb_array_elements(p_lines) loop
    if it ? 'ingredient_id' then
      update ingredients set stock = stock - (it->>'qty')::numeric where id = (it->>'ingredient_id')::bigint;
      insert into stock_movements (ingredient_id, qty, kind, note, user_id)
      values ((it->>'ingredient_id')::bigint, -(it->>'qty')::numeric, 'waste', p_note, v_user);
    else
      for iid, need in select pn.ingredient_id, pn.need from product_needs((it->>'product_id')::bigint, (it->>'qty')::numeric) pn loop
        update ingredients set stock = stock - need where id = iid;
        insert into stock_movements (ingredient_id, qty, kind, note, user_id)
        values (iid, -need, 'waste', p_note || ' (' || coalesce((select name from products where id=(it->>'product_id')::bigint),'?') || ')', v_user);
      end loop;
    end if;
  end loop;
end $$;

create or replace function opname_stock(p_ingredient_id bigint, p_actual_qty numeric, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_diff numeric;
begin
  if v_user is null then raise exception 'Login dulu'; end if;
  select p_actual_qty - stock into v_diff from ingredients where id = p_ingredient_id;
  update ingredients set stock = p_actual_qty where id = p_ingredient_id;
  insert into stock_movements (ingredient_id, qty, kind, note, user_id)
  values (p_ingredient_id, v_diff, 'opname', p_note, v_user);
end $$;

-- ============ Portal customer: token & RPC ============

create or replace function portal_token(p_cid bigint) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare payload text; sig text; secret text;
begin
  secret := coalesce(get_setting('portal','{"secret":"ubah-ini-di-pengaturan"}') ->> 'secret', 'ubah-ini-di-pengaturan');
  -- convert_to butuh encoding karakter (utf8); base64 adalah format encode().
  -- Padding '=' dibuang dulu (rtrim) supaya karakter '_' di base64url tidak ambigu.
  payload := translate(rtrim(encode(convert_to(json_build_object('cid',p_cid,'exp',(extract(epoch from now())+2592000)::bigint)::text,'utf8'),'base64'), '='), '+/', '-_');
  -- hmac() -> bytea, encode ke base64 text, lalu ubah ke base64url
  -- (rtrim: encode base64 selalu menambah baris baru di akhir)
  sig := encode(hmac(convert_to(payload,'utf8'), convert_to(secret,'utf8'), 'sha256'), 'base64');
  sig := translate(rtrim(sig, chr(10)), '+/=', '-_');
  return payload || '.' || sig;
end $$;

create or replace function portal_verify(p_token text) returns bigint
language plpgsql stable security definer set search_path = public, extensions as $$
declare payload text; sig text; expect text; secret text; cid bigint; exp bigint; j jsonb; v_b64 text;
begin
  if p_token is null or position('.' in p_token) = 0 then return null; end if;
  payload := split_part(p_token, '.', 1);
  sig := split_part(p_token, '.', 2);
  secret := coalesce(get_setting('portal','{"secret":"ubah-ini-di-pengaturan"}') ->> 'secret', 'ubah-ini-di-pengaturan');
  expect := encode(hmac(convert_to(payload,'utf8'), convert_to(secret,'utf8'), 'sha256'), 'base64');
  expect := translate(rtrim(expect, chr(10)), '+/=', '-_');
  if sig <> expect then return null; end if;
  -- base64url -> base64 standar, lalu kembalikan padding '=' (dibuang saat generate)
  v_b64 := translate(payload, '-_', '+/');
  if length(v_b64) % 4 = 2 then v_b64 := v_b64 || '==';
  elsif length(v_b64) % 4 = 3 then v_b64 := v_b64 || '='; end if;
  j := convert_from(decode(v_b64, 'base64'), 'utf8')::jsonb;
  exp := (j->>'exp')::bigint;
  if exp < extract(epoch from now()) then return null; end if;
  cid := (j->>'cid')::bigint;
  if not exists (select 1 from customers where id = cid) then return null; end if;
  return cid;
end $$;

create or replace function portal_register(p_phone text, p_name text, p_pin text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_cid bigint;
begin
  if p_phone !~ '^[0-9+ -]{9,17}$' then raise exception 'Nomor WhatsApp tidak valid'; end if;
  if p_pin !~ '^[0-9]{6}$' then raise exception 'PIN harus 6 angka'; end if;
  if exists (select 1 from customers where phone = p_phone) then
    raise exception 'Nomor sudah terdaftar, silakan masuk';
  end if;
  insert into customers (phone, name, pin_hash)
  values (p_phone, p_name, crypt(p_pin, gen_salt('bf')))
  returning id into v_cid;
  insert into customer_addresses (customer_id, label, address) values (v_cid, 'Rumah', '');
  return jsonb_build_object('token', portal_token(v_cid), 'name', p_name);
end $$;

create or replace function portal_login(p_phone text, p_pin text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare c customers;
begin
  select * into c from customers where phone = p_phone;
  if c.id is null or c.pin_hash <> crypt(p_pin, c.pin_hash) then
    raise exception 'Nomor atau PIN salah';
  end if;
  return jsonb_build_object('token', portal_token(c.id), 'name', c.name);
end $$;

create or replace function portal_get_profile(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_cid bigint := portal_verify(p_token); c customers; a customer_addresses;
begin
  if v_cid is null then raise exception 'Sesi habis, silakan masuk lagi'; end if;
  select * into c from customers where id = v_cid;
  select * into a from customer_addresses where customer_id = v_cid order by id limit 1;
  return jsonb_build_object('phone', c.phone, 'name', c.name, 'address', coalesce(a.address,''), 'label', coalesce(a.label,'Rumah'));
end $$;

create or replace function portal_update_profile(p_token text, p_name text, p_address text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_cid bigint := portal_verify(p_token);
begin
  if v_cid is null then raise exception 'Sesi habis, silakan masuk lagi'; end if;
  update customers set name = p_name where id = v_cid;
  if exists (select 1 from customer_addresses where customer_id = v_cid) then
    update customer_addresses set address = p_address where customer_id = v_cid;
  else
    insert into customer_addresses (customer_id, address) values (v_cid, p_address);
  end if;
end $$;

create or replace function portal_change_pin(p_token text, p_old_pin text, p_new_pin text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_cid bigint := portal_verify(p_token); c customers;
begin
  if v_cid is null then raise exception 'Sesi habis, silakan masuk lagi'; end if;
  select * into c from customers where id = v_cid;
  if c.pin_hash <> crypt(p_old_pin, c.pin_hash) then raise exception 'PIN lama salah'; end if;
  if p_new_pin !~ '^[0-9]{6}$' then raise exception 'PIN baru harus 6 angka'; end if;
  update customers set pin_hash = crypt(p_new_pin, gen_salt('bf')) where id = v_cid;
end $$;

-- hitung ongkir dari jarak; NULL kalau di luar semua zona radius
create or replace function zone_fee(p_km numeric) returns integer
language sql stable security definer set search_path = public as $$
  select fee from delivery_zones where radius_km >= p_km order by radius_km asc limit 1;
$$;

-- Jarak dua titik (km, haversine)
create or replace function dist_km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision
language sql immutable as $$
  select 2 * 6371 * asin( sqrt(
    power(sin(radians(lat2-lat1)/2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2-lng1)/2), 2) ) );
$$;

-- Ketersediaan per produk untuk katalog publik portal
create or replace function portal_availability()
returns table (product_id bigint, max_qty bigint)
language sql stable security definer set search_path = public as $$
  select p.id,
    coalesce((select min(floor(i.stock / n.need))::bigint
      from product_needs(p.id, 1) n
      join ingredients i on i.id = n.ingredient_id), 999)
  from products p where p.is_active;
$$;

-- Alamat customer (dikelola dari portal, token-only)
create or replace function portal_list_addresses(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_cid bigint := portal_verify(p_token);
begin
  if v_cid is null then raise exception 'Sesi habis, silakan masuk lagi'; end if;
  return coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'label', a.label, 'address', a.address,
      'lat', a.lat, 'lng', a.lng, 'distance_km', a.distance_km
    ) order by a.id), '[]'::jsonb)
  from customer_addresses a where a.customer_id = v_cid;
end $$;

create or replace function portal_save_address(
  p_token text, p_id bigint, p_label text, p_address text,
  p_lat double precision, p_lng double precision
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_cid bigint := portal_verify(p_token);
  v_oid bigint;
  v_lat double precision; v_lng double precision;
  v_dist numeric;
begin
  if v_cid is null then raise exception 'Sesi habis, silakan masuk lagi'; end if;
  select lat, lng into v_lat, v_lng from outlet_settings where id = 1;
  if p_lat is not null and v_lat is not null and v_lng is not null then
    v_dist := round(dist_km(v_lat, v_lng, p_lat, p_lng)::numeric, 2);
  else
    v_dist := null;
  end if;

  if p_id is null then
    insert into customer_addresses (customer_id, label, address, lat, lng, distance_km)
    values (v_cid, p_label, p_address, p_lat, p_lng, v_dist)
    returning id into v_oid;
  else
    update customer_addresses
      set label = p_label, address = p_address, lat = p_lat, lng = p_lng, distance_km = v_dist
      where id = p_id and customer_id = v_cid
    returning id into v_oid;
  end if;
  if v_oid is null then raise exception 'Alamat tidak ditemukan'; end if;
  return v_oid;
end $$;

create or replace function portal_delete_address(p_token text, p_id bigint)
returns void
language plpgsql security definer set search_path = public as $$
declare v_cid bigint := portal_verify(p_token);
begin
  if v_cid is null then raise exception 'Sesi habis, silakan masuk lagi'; end if;
  if exists (select 1 from orders where address_id = p_id) then
    raise exception 'Alamat sudah dipakai pesanan, tidak bisa dihapus';
  end if;
  delete from customer_addresses where id = p_id and customer_id = v_cid;
end $$;

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

  -- Layanan antar bisa dimatikan dari Pengaturan: saat off, hanya Ambil Sendiri yang boleh.
  if coalesce(v_addr.label,'') <> 'Ambil Sendiri'
     and coalesce(get_setting('portal','{"delivery_enabled":true}') ->> 'delivery_enabled', 'true')::boolean is not true then
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

create or replace function portal_get_orders(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_cid bigint := portal_verify(p_token);
begin
  if v_cid is null then raise exception 'Sesi habis, silakan masuk lagi'; end if;
  return coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'status', o.status, 'subtotal', o.subtotal, 'delivery_fee', o.delivery_fee,
      'total', o.total, 'note', o.note, 'reject_reason', o.reject_reason,
      'created_at', o.created_at,
      'items', (select coalesce(jsonb_agg(jsonb_build_object('name',i.name,'qty',i.qty,'price',i.price)),'[]'::jsonb)
                from order_items i where i.order_id = o.id)
    ) order by o.created_at desc), '[]'::jsonb)
  from orders o where o.customer_id = v_cid;
end $$;

create or replace function portal_confirm_paid(p_token text, p_order_id bigint)
returns void
language plpgsql security definer set search_path = public as $$
declare v_cid bigint := portal_verify(p_token);
begin
  if v_cid is null then raise exception 'Sesi habis, silakan masuk lagi'; end if;
  update orders set status = 'menunggu_verifikasi'
  where id = p_order_id and customer_id = v_cid and status = 'qris_dikirim';
  if not found then raise exception 'Pesanan tidak bisa dikonfirmasi'; end if;
end $$;

create or replace function portal_cancel_order(p_token text, p_order_id bigint)
returns void
language plpgsql security definer set search_path = public as $$
declare v_cid bigint := portal_verify(p_token);
begin
  if v_cid is null then raise exception 'Sesi habis, silakan masuk lagi'; end if;
  update orders set status = 'batal'
  where id = p_order_id and customer_id = v_cid and status in ('menunggu','qris_dikirim');
  if not found then raise exception 'Pesanan tidak bisa dibatalkan'; end if;
end $$;

-- ============ RPC kasir untuk pesanan portal ============

create or replace function accept_order(p_order_id bigint)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Login dulu'; end if;
  update orders set status = 'qris_dikirim' where id = p_order_id and status = 'menunggu';
  if not found then raise exception 'Pesanan tidak dalam status menunggu'; end if;
end $$;

create or replace function reject_order(p_order_id bigint, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Login dulu'; end if;
  update orders set status = 'ditolak', reject_reason = p_reason where id = p_order_id and status = 'menunggu';
  if not found then raise exception 'Pesanan tidak dalam status menunggu'; end if;
end $$;

create or replace function verify_order_payment(p_order_id bigint)
returns bigint
language plpgsql security definer set search_path = public as $$
declare v_oid orders; v_txid bigint; v_items jsonb;
begin
  if auth.uid() is null then raise exception 'Login dulu'; end if;
  select * into v_oid from orders where id = p_order_id and status = 'menunggu_verifikasi';
  if v_oid.id is null then raise exception 'Pesanan tidak menunggu verifikasi'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('product_id', product_id, 'qty', qty)) filter (where product_id is not null), '[]'::jsonb)
    into v_items from order_items where order_id = p_order_id;

  v_txid := create_transaction('delivery', v_items,
    jsonb_build_array(jsonb_build_object('method','qris','amount', v_oid.total)),
    0, 'Pesanan portal #' || p_order_id::text, p_order_id);

  update orders set status = 'diproses' where id = p_order_id;
  return v_txid;
end $$;

create or replace function set_order_status(p_order_id bigint, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Login dulu'; end if;
  update orders set status = p_status where id = p_order_id;
  if not found then raise exception 'Pesanan tidak ditemukan'; end if;
end $$;

-- ============ Trigger: buat profile otomatis saat user baru ============

create or replace function on_auth_user_created()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)), 'kasir')
  on conflict (id) do nothing;
  return new;
end $$;

do $$
begin
  create trigger auth_user_created after insert on auth.users
  for each row execute function on_auth_user_created();
exception when duplicate_object then null;
end $$;
