-- ============================================================
-- 0010 — Koreksi kas drawer: kembalian tunai dipertanggungkan
-- Audit satu hari operasional menemukan: payments menyimpan UANG
-- DITERIMA (nota 27rb dibayar 50rb), tetapi close_shift menjumlahkan
-- payments mentah → expected_cash tergelembung sebesar kembalian
-- (drawer dilapor lebih Rp23.000 per kasus bayar besar).
-- Perbaikan: penjualan tunai dihitung least(uang_diterima, total) per
-- payment. Untuk nota normal = porsi kas masuk; untuk nota refund
-- (payment negatif) tetap utuh mengurangi kas.
-- Sama persis sudah dipakai di demo (txCashNet) & laporan harian.
-- ============================================================

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

  -- Kas masuk per nota = least(uang diterima, total nota): kembalian tidak
  -- dihitung sebagai penjualan. Refund (payment negatif) tetap utuh.
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
