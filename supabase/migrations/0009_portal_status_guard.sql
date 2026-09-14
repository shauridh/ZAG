-- ============================================================
-- 0009 — Penjaga alur status pesanan portal
-- Audit stok: stok portal dipotong SAAT verify_order_payment
-- (menunggu_verifikasi → diproses, lewat create_transaction).
-- Pembatalan pelanggan (portal_cancel_order) hanya diizinkan pada
-- 'menunggu'/'qris_dikirim' — SEBELUM stok dipotong — jadi tidak ada
-- stok yang perlu dilepas saat batal. Yang perlu dikunci:
--   1) set_order_status tak boleh lagi memundurkan status / melompat
--      ke 'batal' (dulu bebas → bisa jadi stok hilang tanpa transaksi),
--   2) kasir bisa menolak pesanan 'menunggu_verifikasi' (stok habis
--      saat pelanggan sudah transfer) — status ini belum potong stok,
--      jadi tolak di sini aman tanpa pelepasan stok.
-- Demo (db-demo.ts) meniru aturan yang sama & diuji unit test.
-- ============================================================

-- ============ Transisi status yang sah oleh kasir ============
create or replace function set_order_status(p_order_id bigint, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_current text;
begin
  if auth.uid() is null then raise exception 'Login dulu'; end if;
  select status into v_current from orders where id = p_order_id;
  if v_current is null then raise exception 'Pesanan tidak ditemukan'; end if;

  if not (v_current, p_status) in (
    ('diproses','dikirim'),
    ('dikirim','selesai')
  ) then
    raise exception 'Transisi tidak sah: % → %', v_current, p_status;
  end if;

  update orders set status = p_status where id = p_order_id;
end $$;

-- ============ Kasir menolak pesanan, termasuk yang sudah bayar ============
-- 'menunggu_verifikasi' BELUM potong stok (potong terjadi di verify_order_payment),
-- jadi menolak di sini tidak butuh pelepasan stok.
create or replace function reject_order(p_order_id bigint, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Login dulu'; end if;
  update orders set status = 'ditolak', reject_reason = p_reason
  where id = p_order_id and status in ('menunggu', 'menunggu_verifikasi');
  if not found then raise exception 'Pesanan tidak bisa ditolak pada status ini'; end if;
end $$;
