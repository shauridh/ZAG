-- 0015: stok bahan jadi CRUD — penyesuaian stok tercatat, bisa diedit/dihapus
-- Masalah: opname lama sekali jalan (update stok langsung); salah ketik susah
-- dikoreksi dan riwayat hanya di stock_movements (tidak bisa dibetulkan).
-- Solusi: penyesuaian tersimpan di tabel stock_adjustments (qty BARU + catatan).
-- Edit/hapus menyesuaikan STOK TERKINI dengan delta yang benar, lalu qty/catatan
-- diubah. Stok tidak pernah mundur — aman walau ada penjualan di antara.
-- Idempotent: aman dijalankan berulang.

create table if not exists stock_adjustments (
  id bigint generated always as identity primary key,
  ingredient_id bigint not null references ingredients on delete cascade,
  -- qty BARU (stok fisik hasil hitung), bukan delta — beda dgn stock_movements.qty (delta).
  qty numeric(12,4) not null,
  prev_qty numeric(12,4) not null default 0,
  note text,
  user_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists stock_adjustments_created_idx on stock_adjustments (created_at desc);

alter table stock_adjustments enable row level security;

drop policy if exists "staff read" on stock_adjustments;
create policy "staff read" on stock_adjustments for select to authenticated using (true);

-- Insert via RPC (pola purchases/production_batches).
drop policy if exists "staff insert stock_adjustments" on stock_adjustments;
create policy "staff insert stock_adjustments" on stock_adjustments for insert to authenticated with check (auth.uid() = user_id);

-- Edit/hapus penyesuaian hanya via RPC yang dicek is_admin() — tidak ada jalur tabel langsung.
drop policy if exists "admin update stock_adjustments" on stock_adjustments;
create policy "admin update stock_adjustments" on stock_adjustments for update to authenticated using (is_admin()) with check (is_admin());
drop policy if exists "admin delete stock_adjustments" on stock_adjustments;
create policy "admin delete stock_adjustments" on stock_adjustments for delete to authenticated using (is_admin());

-- ===== CRUD via RPC (staff boleh buat; admin boleh ubah/hapus) =====

-- Buat penyesuaian: stok disetel ke qty fisik baru, selisih tercatat.
-- Juga menulis baris 'opname' di stock_movements (ledger audit, ref ADJ*)
-- supaya Riwayat Stok memuat semua pergerakan dari satu sumber.
create or replace function create_stock_adjustment(p_ingredient_id bigint, p_qty numeric, p_note text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_prev numeric;
  v_diff numeric;
  v_id bigint;
begin
  if v_user is null then raise exception 'Login dulu'; end if;
  select stock into v_prev from ingredients where id = p_ingredient_id;
  if not found then raise exception 'Bahan tidak ditemukan'; end if;
  v_diff := p_qty - v_prev;
  update ingredients set stock = p_qty where id = p_ingredient_id;
  insert into stock_adjustments (ingredient_id, qty, prev_qty, note, user_id)
  values (p_ingredient_id, p_qty, v_prev, p_note, v_user)
  returning id into v_id;
  insert into stock_movements (ingredient_id, qty, kind, ref, note, user_id)
  values (p_ingredient_id, v_diff, 'opname', 'ADJ' || v_id::text, p_note, v_user);
  return v_id;
end $$;

-- Edit penyesuaian (admin): stok terkini digeser selisih (qty baru - qty lama)
-- untuk bahan yang sama. Aman walau stok sudah berubah sejak penyesuaian.
-- Baris ledger 'opname' (ADJ*) ikut digeser supaya rekonstruksi stok tetap benar.
create or replace function update_stock_adjustment(p_id bigint, p_qty numeric, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_adj stock_adjustments%rowtype;
  v_delta numeric;
begin
  if not is_admin() then raise exception 'Hanya admin yang dapat mengubah penyesuaian stok'; end if;
  select * into v_adj from stock_adjustments where id = p_id;
  if not found then raise exception 'Penyesuaian tidak ditemukan'; end if;
  v_delta := p_qty - v_adj.qty;
  update ingredients set stock = stock + v_delta where id = v_adj.ingredient_id;
  update stock_adjustments set qty = p_qty, note = p_note where id = p_id;
  update stock_movements set qty = qty + v_delta, note = p_note
    where ref = 'ADJ' || p_id::text and kind = 'opname';
end $$;

-- Hapus penyesuaian (admin): stok dikembalikan ke nilai sebelum penyesuaian
-- (prev_qty), selisihnya dihitung dari stok sekarang. Baris ledger 'opname'
-- (ADJ*) ikut dihapus — penyesuaian tidak pernah terjadi.
create or replace function delete_stock_adjustment(p_id bigint)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_adj stock_adjustments%rowtype;
begin
  if not is_admin() then raise exception 'Hanya admin yang dapat menghapus penyesuaian stok'; end if;
  select * into v_adj from stock_adjustments where id = p_id;
  if not found then raise exception 'Penyesuaian tidak ditemukan'; end if;
  update ingredients set stock = stock - v_adj.qty + v_adj.prev_qty where id = v_adj.ingredient_id;
  delete from stock_adjustments where id = p_id;
  delete from stock_movements where ref = 'ADJ' || p_id::text and kind = 'opname';
end $$;
