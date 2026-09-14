"""
Sabana Kasir - E2E alur tutup shift (Playwright, mode demo).

Yang diuji (CHECKLIST §4 "Tutup toko" + guard kas & kembalian dari 0010):
 1. Login demo (admin), buka shift dari halaman Shift.
 2. Transaksi tunai uang lebih -> kembalian TIDAK dihitung penjualan
    (regresi 0010: "Penjualan tunai" = total nota, bukan uang diterima).
 3. Modal Tutup Shift:
    a. Kas fisik KURANG tanpa catatan -> ditolak (wajib catatan).
    b. Kas fisik KURANG dengan catatan -> lolos, selisih minus tercatat.
 4. Riwayat shift menampilkan selisih minus.

Jalankan: dev server DEMO dulu (lihat RELEASE_TEST_SERVER di bawah),
lalu: BASE_URL=http://localhost:<port> python test_shift_e2e.py
"""
from playwright.sync_api import sync_playwright
import os, sys, io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

SCREENSHOTS_DIR = "screenshots"
os.makedirs(SCREENSHOTS_DIR, exist_ok=True)

# WAJIB instance demo. Kalau diarahkan ke instance live, script berhenti
# agar tidak menutup shift operasional asli.
RELEASE_TEST_SERVER = "http://localhost:5199"
BASE = os.environ.get("BASE_URL", "")

results = []  # (name, ok, detail)


def record(name, ok, detail):
    results.append((name, ok, detail))
    print(f"  {'PASS' if ok else 'FAIL'} - {name}: {detail}")


def shot(page, name):
    path = os.path.join(SCREENSHOTS_DIR, f"{name}.png")
    page.screenshot(path=path, full_page=True)
    print(f"  Screenshot: {path}")


def rp(n):
    return f"Rp{n:,}".replace(",", ".")


def parse_labeled_amount(page, label):
    """Ambil angka Rp dari <dd> sesudah <dt> berisi label (kartu shift)."""
    dts = page.locator("dt", has_text=label)
    n = dts.count()
    for i in range(n):
        dd = dts.nth(i).locator("xpath=following-sibling::dd[1]")
        if dd.count():
            txt = (dd.first.text_content() or "").replace("Rp", "").replace(".", "").strip()
            if txt.lstrip("-").isdigit():
                return int(txt)
    raise AssertionError(f"label '{label}' tidak ditemukan")


def parse_total(page):
    """Ambil angka total dari baris 'Total' panel keranjang."""
    spans = page.locator("aside span", has_text="Total")
    n = spans.count()
    for i in range(n):
        sib = spans.nth(i).locator("xpath=following-sibling::*[1]")
        if sib.count():
            txt = (sib.first.text_content() or "").replace("Rp", "").replace(".", "").strip()
            if txt.isdigit() and int(txt) > 0:
                return int(txt)
    raise AssertionError("tidak menemukan total di keranjang")


def numpad_set(page, digits):
    """Isi numpad dalam dialog yang sedang terbuka: bersihkan lalu ketik."""
    dialog = page.locator('[role="dialog"]').last
    dialog.locator('button[aria-label="Bersihkan"]').click()
    page.wait_for_timeout(150)
    for d in digits:
        dialog.locator(".grid button", has_text=d).first.click()
        page.wait_for_timeout(60)


def login(page):
    page.goto(BASE, wait_until="networkidle")
    page.fill('input[type="email"]', "admin@sabana.com")
    page.fill('input[type="password"]', "admin123")
    page.click('button[type="submit"]')
    page.wait_for_timeout(2000)


def ensure_open_shift(page):
    """Pastikan ada shift terbuka: buka dari halaman Shift bila perlu.
    Modal awal demo = float kembalian 350rb (di bawah itu ditolak server)."""
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


def test_cash_sale_with_change(page):
    """Nota tunai 15rb dibayar 50rb -> Penjualan tunai harus 15rb (bukan 50rb)."""
    print("\n--- 1. Penjualan tunai dengan kembalian ---")
    page.goto(f"{BASE}/kasir", wait_until="networkidle")
    page.wait_for_timeout(1200)
    for _ in page.locator('button:has-text("Nanti saja")').all():
        _.click()
        page.wait_for_timeout(300)
        break
    page.locator("button", has_text="Nasi Putih").first.click()
    page.locator("button", has_text="Teh Botol Sosro").first.click()
    page.wait_for_timeout(300)

    # total dari baris "Total" di panel keranjang (span kedua = angka)
    total = parse_total(page)
    assert total > 0, "total keranjang nol"

    page.locator("aside button.btn-primary").first.click()
    page.wait_for_timeout(500)
    dialog = page.locator('[role="dialog"]').last
    dialog.locator('button[role="radio"]:has-text("Tunai")').first.click()
    numpad_set(page, "50000")
    shot(page, "shift_e2e_01_cash_entered")
    dialog.locator('button:has-text("Selesai")').first.click()
    page.wait_for_timeout(2000)
    body = page.locator("body").text_content() or ""
    assert "Kembalian" in body, "popup lunas tidak menampilkan kembalian"
    shot(page, "shift_e2e_02_receipt")
    page.locator('button:has-text("Transaksi Baru")').first.click()
    page.wait_for_timeout(500)

    page.goto(f"{BASE}/shift", wait_until="networkidle")
    page.wait_for_timeout(1200)
    cash_sales = parse_labeled_amount(page, "Penjualan tunai")
    record("Kembalian tidak dihitung penjualan (0010)", cash_sales == total,
           f"penjualan tunai={rp(cash_sales)}, total nota={rp(total)}")
    return total


def test_close_shift(page, expected_sales):
    """Dua guard tutup shift (0010) + alur lolos dengan catatan:
    a. kas fisik di bawah float wajib -> ditolak keras (tanpa catatan pun).
    b. kas kurang tapi masih >= float, tanpa catatan -> wajib isi catatan.
    c. dengan catatan -> lolos, selisih minus tercatat di riwayat."""
    print("\n--- 2. Tutup shift: guard kas kurang ---")
    page.goto(f"{BASE}/shift", wait_until="networkidle")
    page.wait_for_timeout(1200)
    expected = parse_labeled_amount(page, "Seharusnya di drawer")
    record("Seharusnya di drawer = modal + penjualan", expected == 350000 + expected_sales,
           f"expected={rp(expected)}")

    def attempt(amount, note=None):
        # modal tetap terbuka setelah penolakan -> pakai yg ada, jangan klik lagi
        if not page.locator('[role="dialog"][aria-label="Tutup Shift"]').count():
            page.locator('button:has-text("Tutup Shift")').first.click()
            page.wait_for_timeout(500)
        dialog = page.locator('[role="dialog"][aria-label="Tutup Shift"]').last
        assert dialog.locator('[role="status"]').count(), "selisih kas tidak tampil di modal"
        numpad_set(page, str(amount))
        shot(page, "shift_e2e_short")
        if note:
            dialog.locator("#cnote").fill(note)
        dialog.locator('button:has-text("Tutup Shift & Kirim Laporan")').first.click()
        page.wait_for_timeout(1000)
        dlg = page.locator('[role="dialog"]')
        modal_txt = dlg.last.text_content(timeout=1000) if dlg.count() else ""
        return (modal_txt or "") + " " + (page.locator("body").text_content() or "")

    # a. di bawah float wajib -> ditolak keras
    body = attempt(expected - 20000)
    still_open = page.locator('button:has-text("Tutup Shift")').count() > 0
    record("Kas di bawah float wajib -> ditolak", still_open and "float wajib" in body.lower(),
           f"shift masih terbuka={still_open}")

    # b. kurang tapi >= float, tanpa catatan -> wajib catatan
    body = attempt(expected - 5000)
    still_open = page.locator('button:has-text("Tutup Shift")').count() > 0
    record("Kas kurang tanpa catatan -> ditolak", still_open and "wajib isi catatan" in body.lower(),
           f"shift masih terbuka={still_open}")

    # c. dengan catatan -> lolos
    body = attempt(expected - 5000, note="uji e2e: kembalian salah kasus")
    page.wait_for_timeout(1500)
    shot(page, "shift_e2e_04_closed")
    closed_card = page.locator("text=Belum ada shift terbuka").count() > 0
    row = page.locator("table tbody tr").first.text_content() or ""
    ok_row = rp(-5000) in row or "-5.000" in row
    record("Tutup shift dengan catatan -> lolos, selisih minus tercatat",
           closed_card and ok_row, f"baris riwayat: {row.strip()[:80]}")


def main():
    global BASE
    BASE = os.environ.get("BASE_URL", RELEASE_TEST_SERVER)
    if "5173" in BASE or "5177" in BASE or "5199" not in BASE and "vercel" not in BASE and not BASE.endswith("/demo"):
        # pengingat keras: hanya port demo 5199 yang aman utk tutup shift
        if "5199" not in BASE:
            print(f"PERINGATAN: BASE_URL={BASE} bukan instance demo ({RELEASE_TEST_SERVER}).")
            print("Test ini MENUTUP SHIFT. Arahkan ke instance demo: BASE_URL=http://localhost:5199")
            sys.exit(2)
    print("=" * 60)
    print("Sabana Kasir - E2E Tutup Shift (demo)")
    print(f"BASE: {BASE}")
    print("=" * 60)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 800}, locale="id-ID")
        page = context.new_page()
        try:
            login(page)
            ensure_open_shift(page)
            total = test_cash_sale_with_change(page)
            test_close_shift(page, total)
        except Exception as e:
            print(f"\nFATAL: {e}")
            shot(page, "shift_e2e_fatal")
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
