"""Smoke test portal customer /order (mode demo).

Jalankan: dev server jalan, lalu `python scripts/check_portal.py`.
Cek: halaman muat, katalog tampil, tanpa error console.
"""
from playwright.sync_api import sync_playwright
import os, sys, io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = os.environ.get("BASE_URL", "http://localhost:5199")

results = []


def record(name, ok, detail):
    results.append((name, ok, detail))
    print(f"  {'PASS' if ok else 'FAIL'} - {name}: {detail}")


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 390, "height": 844})
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto(f"{BASE}/order", wait_until="networkidle")
    page.wait_for_timeout(1800)

    # Portal login demo: daftar akun baru (data localStorage, aman diulang).
    body = page.inner_text("body").lower()
    record("portal_termuat", ("sabana" in body or "masuk" in body or "pin" in body), f"halaman: {body[:80]!r}")

    inputs = page.locator("input")
    if inputs.count() >= 2:
        page.fill("#pw", "081299900011")
        page.fill("#pp", "123456")
        # mode 'masuk' akan gagal utk nomor baru -> pindah ke mode 'daftar' bila ada
        daftar_link = page.locator("button", has_text="Daftar di sini")
        if daftar_link.count():
            daftar_link.first.click()
            page.wait_for_timeout(400)
            page.fill("#pw", "081299900011")
            page.fill("#pp", "123456")
            page.fill("#pn", "Tester")
        page.locator("button", has_text="Daftar & Mulai Pesan").first.click()
        page.wait_for_timeout(1800)
        body = page.inner_text("body").lower()

    has_menu = any(x in body for x in ("ayam", "nasi", "menu", "keranjang"))
    record("katalog_tampil", has_menu, f"tombol/teks menu ditemukan: {has_menu}")

    page.screenshot(path=os.path.join("screenshots", "portal_order.png"), full_page=True)
    record("console_bersih", len(errors) == 0, f"{len(errors)} error: {errors[:3]}")
    browser.close()

total = len(results)
passed = sum(1 for _, ok, _ in results if ok)
print(f"\nTOTAL: {passed}/{total} PASS")
sys.exit(0 if passed == total else 1)
