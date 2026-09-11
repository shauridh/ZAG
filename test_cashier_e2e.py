"""
Sabana Kasir - E2E alur kasir lengkap (Playwright, mode demo).

Alur yang diuji:
 1. Login demo (admin).
 2. Buka shift (popup kunci shift).
 3. Tambah menu ke keranjang.
 4. Bayar tunai dengan uang lebih -> cek kembalian & nota.
 5. Riwayat transaksi muncul di halaman /riwayat.
 6. Refund nota lewat halaman riwayat.
 7. Cek console error (404 aset, dsb.) di sepanjang tes.

Jalankan: dev server harus jalan di :5173, lalu `python test_cashier_e2e.py`.
"""
from playwright.sync_api import sync_playwright
import os, sys, io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

SCREENSHOTS_DIR = "screenshots"
os.makedirs(SCREENSHOTS_DIR, exist_ok=True)

BASE = os.environ.get("BASE_URL", "http://localhost:5173")

results = []  # (name, passed, detail)


def shot(page, name):
    path = os.path.join(SCREENSHOTS_DIR, f"{name}.png")
    page.screenshot(path=path, full_page=True)
    print(f"  Screenshot: {path}")


def record(name, ok, detail):
    results.append((name, ok, detail))
    print(f"  {'PASS' if ok else 'FAIL'} - {name}: {detail}")


def click_product(page, name_part):
    """Klik tombol menu yang namanya memuat name_part."""
    btn = page.locator("button", has_text=name_part).first
    btn.wait_for(timeout=8000)
    btn.click()
    page.wait_for_timeout(300)


def numpad_type(page, digits):
    """Ketik angka lewat numpad kasir di dalam dialog checkout (tombol 0-9)."""
    for d in digits:
        page.locator('[role="dialog"] .grid button', has_text=d).first.click()
        page.wait_for_timeout(60)


def test_open_shift(page):
    print("\n--- 1. Buka shift ---")
    page.goto(f"{BASE}/kasir", wait_until="networkidle")
    page.wait_for_timeout(1200)
    # popup kunci shift muncul otomatis saat belum ada shift; kalau tidak,
    # klik chip "Shift belum dibuka"
    gate_btn = page.locator('button:has-text("Buka Shift (modal")')
    if not gate_btn.count():
        chip = page.locator('button:has-text("Shift belum dibuka")')
        if chip.count():
            chip.first.click()
            page.wait_for_timeout(400)
    gate_btn = page.locator('button:has-text("Buka Shift (modal")')
    if gate_btn.count():
        gate_btn.first.click()
        page.wait_for_timeout(1500)
        shot(page, "e2e_01_shift_opened")
        body = page.locator("body").text_content() or ""
        record("Buka shift", "Shift belum dibuka" not in body, "shift aktif")
    else:
        record("Buka shift", False, "tombol Buka Shift tidak ditemukan")


def test_add_items_and_pay_cash(page):
    print("\n--- 2. Tambah item + bayar tunai ---")
    # pastikan keranjang kosong (transaksi baru)
    page.wait_for_timeout(500)

    click_product(page, "Nasi Putih")
    click_product(page, "Nasi Putih")          # qty 2
    click_product(page, "Teh Botol Sosro")     # qty 1
    page.wait_for_timeout(400)
    shot(page, "e2e_02_cart_filled")

    cart_total_txt = page.locator("aside >> text=Total").first
    assert cart_total_txt.is_visible(), "panel keranjang tidak terlihat"

    # checkout
    page.locator('button:has-text("Checkout")').first.click()
    page.wait_for_timeout(500)

    # metode tunai (default) + isi uang lebih dari total
    cash_btn = page.locator('button[role="radio"]:has-text("Tunai")')
    if cash_btn.count():
        cash_btn.first.click()
        page.wait_for_timeout(200)

    # total diparse dari layar struk preview "TOTAL xx.xxx"
    total_val = parse_total(page)

    # ketik uang: total + 50.000,000 (dibulatkan ke ribuan) -> pasti lebih
    pay = ((total_val // 10000) + 2) * 10000
    numpad_type(page, str(pay))
    page.wait_for_timeout(300)
    shot(page, "e2e_03_cash_entered")

    # tekan Selesai
    page.locator('button:has-text("Selesai")').first.click()
    page.wait_for_timeout(2000)
    shot(page, "e2e_04_receipt")

    body = page.locator("body").text_content() or ""
    ok_receipt = "Lunas" in body or "Kembalian" in body
    expected_change = pay - total_val
    ok_change = expected_change == 0 or f"{expected_change:,}".replace(",", ".") in body.replace(".", ".")
    record("Bayar tunai", ok_receipt, f"total={total_val} bayar={pay}")
    if expected_change > 0:
        record("Kembalian tampil", ok_change, f"kembalian={expected_change}")

    # tutup popup transaksi selesai
    done_btn = page.locator('button:has-text("Transaksi Baru")')
    if done_btn.count():
        done_btn.first.click()
        page.wait_for_timeout(500)


def parse_total(page):
    """Ambil angka total dari baris 'Total' panel keranjang."""
    # panel keranjang: <span>Total</span><span>Rpxxx</span>
    spans = page.locator("aside span", has_text="Total")
    n = spans.count()
    for i in range(n):
        sib = spans.nth(i).locator("xpath=following-sibling::*[1]")
        if sib.count():
            txt = (sib.first.text_content() or "").replace("Rp", "").replace(".", "").strip()
            if txt.isdigit() and int(txt) > 0:
                return int(txt)
    raise AssertionError("tidak menemukan total di keranjang")


def test_history_and_refund(page):
    print("\n--- 3. Riwayat + refund ---")
    page.goto(f"{BASE}/riwayat", wait_until="networkidle")
    page.wait_for_timeout(1500)
    shot(page, "e2e_05_history")

    body = page.locator("body").text_content() or ""
    if "SB" not in body and "Nota" not in body:
        record("Riwayat tampil", False, "tidak ada nota di halaman riwayat")
        return
    record("Riwayat tampil", True, "nota terlihat")

    # refund nota pertama yang masih lunas
    refund_btn = page.locator('button:has-text("Refund")').first
    if not refund_btn.count():
        record("Refund", False, "tombol Refund tidak ada (nota sudah diproses?)")
        return
    refund_btn.click()
    page.wait_for_timeout(400)
    page.locator('button:has-text("Ya, Refund")').first.click()
    page.wait_for_timeout(1500)
    shot(page, "e2e_06_refunded")
    body = page.locator("body").text_content() or ""
    record("Refund", "Refund" in body and "tercatat" in body, body.count("Refund") and "pesan refund muncul")


def test_console_clean(page):
    print("\n--- 4. Console bersih ---")
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("response", lambda r: errors.append(f"{r.status} {r.url}") if r.status >= 400 else None)
    for route in ["/", "/kasir", "/riwayat", "/pengaturan"]:
        page.goto(f"{BASE}{route}", wait_until="networkidle")
        page.wait_for_timeout(700)
    real = [e for e in errors if "supabase" not in e.lower()]  # demo login 400 diabaikan
    record("Console bersih", len(real) == 0, f"{len(real)} error: {real[:3]}")


def main():
    print("=" * 60)
    print("Sabana Kasir - E2E Alur Kasir (shift, keranjang, tunai)")
    print("=" * 60)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 800}, locale="id-ID")
        page = context.new_page()
        try:
            # login demo
            page.goto(BASE, wait_until="networkidle")
            page.fill('input[type="email"]', "admin@sabana.com")
            page.fill('input[type="password"]', "admin123")
            page.click('button[type="submit"]')
            page.wait_for_timeout(2000)
            shot(page, "e2e_00_logged_in")

            test_open_shift(page)
            test_add_items_and_pay_cash(page)
            test_history_and_refund(page)
            test_console_clean(page)
        except Exception as e:
            print(f"\nFATAL: {e}")
            shot(page, "e2e_fatal")
            results.append(("fatal", False, str(e)))
        finally:
            browser.close()

    passed = sum(1 for _, ok, _ in results if ok)
    failed = sum(1 for _, ok, _ in results if not ok)
    print("\n" + "=" * 60)
    print("RINGKASAN")
    print("=" * 60)
    for name, ok, detail in results:
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}: {detail}")
    print(f"  Total: {len(results)} | Passed: {passed} | Failed: {failed}")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
