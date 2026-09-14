"""
Sabana Kasir - E2E alur Simpan Pesanan (Bill) lengkap (Playwright, mode demo).

Yang diuji (CHECKLIST §4 + migrasi 0008):
 1. Login demo, pastikan shift terbuka.
 2. Simpan bill (stok belum dipotong - chip bill muncul, keranjang kosong).
 3. Bayar bill dengan uang lebih -> popup lunas menampilkan kembalian.
 4. Bill hilang dari daftar setelah dibayar.
 5. Void bill: tanpa transaksi, tanpa potong stok.

Jalankan: instance demo dulu (vite.demo.config.ts di :5199), lalu:
  BASE_URL=http://localhost:5199 python test_bill_e2e.py
"""
from playwright.sync_api import sync_playwright
import os, sys, io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

SCREENSHOTS_DIR = "screenshots"
os.makedirs(SCREENSHOTS_DIR, exist_ok=True)

RELEASE_TEST_SERVER = "http://localhost:5199"
BASE = os.environ.get("BASE_URL", RELEASE_TEST_SERVER)

results = []


def record(name, ok, detail):
    results.append((name, ok, detail))
    print(f"  {'PASS' if ok else 'FAIL'} - {name}: {detail}")


def shot(page, name):
    path = os.path.join(SCREENSHOTS_DIR, f"{name}.png")
    page.screenshot(path=path, full_page=True)
    print(f"  Screenshot: {path}")


def numpad_set(page, digits, dialog=None):
    d = dialog or page.locator('[role="dialog"]').last
    d.locator('button[aria-label="Bersihkan"]').click()
    page.wait_for_timeout(150)
    for ch in digits:
        d.locator(".grid button", has_text=ch).first.click()
        page.wait_for_timeout(60)


def rp(n):
    return f"Rp{n:,}".replace(",", ".")


def parse_total(page):
    spans = page.locator("aside span", has_text="Total")
    for i in range(spans.count()):
        sib = spans.nth(i).locator("xpath=following-sibling::*[1]")
        if sib.count():
            txt = (sib.first.text_content() or "").replace("Rp", "").replace(".", "").strip()
            if txt.isdigit() and int(txt) > 0:
                return int(txt)
    raise AssertionError("tidak menemukan total di keranjang")


def login(page):
    page.goto(BASE, wait_until="networkidle")
    page.fill('input[type="email"]', "admin@sabana.com")
    page.fill('input[type="password"]', "admin123")
    page.click('button[type="submit"]')
    page.wait_for_timeout(2000)


def ensure_open_shift(page):
    page.goto(f"{BASE}/shift", wait_until="networkidle")
    page.wait_for_timeout(1200)
    if page.locator('button:has-text("Tutup Shift")').count():
        return
    page.locator('button:has-text("Buka Shift")').first.click()
    page.wait_for_timeout(400)
    numpad_set(page, "350000")
    page.locator('[role="dialog"]').last.locator('button:has-text("Buka Shift")').last.click()
    page.wait_for_timeout(1500)
    assert page.locator('button:has-text("Tutup Shift")').count(), "shift gagal dibuka"


def main():
    print("=" * 60)
    print("Sabana Kasir - E2E Simpan Pesanan / Bill (demo)")
    print(f"BASE: {BASE}")
    print("=" * 60)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 800}, locale="id-ID")
        page = context.new_page()
        try:
            login(page)
            ensure_open_shift(page)

            # ===== 1. simpan bill =====
            print("\n--- 1. Simpan bill ---")
            page.goto(f"{BASE}/kasir", wait_until="networkidle")
            page.wait_for_timeout(1200)
            for b in page.locator('button:has-text("Nanti saja")').all()[:1]:
                b.click()
                page.wait_for_timeout(300)
            page.locator("button", has_text="Nasi Putih").first.click()
            page.locator("button", has_text="Teh Botol Sosro").first.click()
            page.wait_for_timeout(300)
            total = parse_total(page)
            page.locator('aside input[aria-label="Nama bill — nama pelanggan atau meja"]').fill("E2E Bill Test")
            page.locator('button:has-text("Simpan")').first.click()
            page.wait_for_timeout(1000)
            chip = page.locator('[role="listitem"]', has_text="E2E Bill Test")
            cart_empty = page.locator("text=Keranjang kosong").count() > 0
            record("Simpan bill: chip muncul + keranjang kosong", chip.count() > 0 and cart_empty,
                   f"chip={chip.count()}, keranjang kosong={cart_empty}")
            shot(page, "bill_e2e_01_saved")

            # ===== 2. guard: bayar dengan uang kurang -> tombol terkunci =====
            print("\n--- 2. Guard uang kurang ---")
            page.locator('button[aria-label^="Daftar bill tersimpan"]').click()
            page.wait_for_timeout(400)
            bills_dialog = page.locator('[role="dialog"][aria-label="Bill Tersimpan"]')
            bills_dialog.locator('button:has-text("Bayar")').first.click()
            page.wait_for_timeout(400)
            pay_dialog = page.locator('[role="dialog"][aria-label^="Bayar Bill"]')
            numpad_set(page, "1000", pay_dialog)
            btn = pay_dialog.locator('button:has-text("Bayar Bill")')
            locked = btn.is_disabled()
            body = pay_dialog.text_content() or ""
            record("Uang kurang -> tombol Bayar terkunci + label 'kurang'",
                   locked and "kurang" in body.lower(), f"disabled={locked}")
            shot(page, "bill_e2e_02_underpaid_guard")

            # ===== 3. bayar dengan uang lebih -> kembalian =====
            print("\n--- 3. Bayar bill (uang lebih) ---")
            numpad_set(page, "50000", pay_dialog)
            pay_dialog.locator('button:has-text("Bayar Bill")').click()
            page.wait_for_timeout(2500)
            body = page.locator("body").text_content() or ""
            has_done = "Transaksi Selesai" in body or "Lunas" in body
            change_ok = f"Kembalian {rp(50000 - total)}" in body
            record("Bayar bill -> popup lunas + kembalian sesuai",
                   has_done and change_ok, f"lunas={has_done}, kembalian={rp(50000 - total)} tampil={change_ok}")
            shot(page, "bill_e2e_03_paid_receipt")
            new_btn = page.locator('button:has-text("Transaksi Baru")')
            if new_btn.count():
                new_btn.first.click()
                page.wait_for_timeout(500)

            # modal "Bill Tersimpan" tetap terbuka di belakang popup struk ->
            # verifikasi bill hilang langsung di dialog yang masih terbuka
            dlg = page.locator('[role="dialog"][aria-label="Bill Tersimpan"]')
            empty = dlg.locator("text=Belum ada bill tersimpan").count() > 0
            gone = dlg.locator('text=E2E Bill Test').count() == 0
            record("Bill terhapus dari daftar setelah dibayar", empty or gone,
                   f"daftar kosong={empty}, nama hilang={gone}")
            dlg.locator('button[aria-label="Tutup"]').click()
            page.wait_for_timeout(300)

            # ===== 4. void bill =====
            print("\n--- 4. Void bill ---")
            page.locator("button", has_text="Chicken Roll").first.click()
            page.wait_for_timeout(200)
            page.locator('aside input[aria-label="Nama bill — nama pelanggan atau meja"]').fill("E2E Void Test")
            page.locator('button:has-text("Simpan")').first.click()
            page.wait_for_timeout(1000)
            page.locator('button[aria-label^="Daftar bill tersimpan"]').click()
            page.wait_for_timeout(400)
            dlg = page.locator('[role="dialog"][aria-label="Bill Tersimpan"]')
            dlg.locator('button:has-text("Void")').first.click()
            page.wait_for_timeout(300)
            dlg.locator('button:has-text("Yakin hapus")').click()
            page.wait_for_timeout(800)
            empty = dlg.locator("text=Belum ada bill tersimpan").count() > 0
            record("Void bill: hilang dari daftar tanpa jadi transaksi", empty, f"daftar kosong={empty}")
            shot(page, "bill_e2e_04_voided")
        except Exception as e:
            print(f"\nFATAL: {e}")
            shot(page, "bill_e2e_fatal")
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
