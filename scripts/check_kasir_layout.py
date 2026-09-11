"""Cek layout kasir di beberapa lebar layar setelah perbaikan.

Jalankan: dev server jalan, lalu `python scripts/check_kasir_layout.py`.
Menyimpan screenshot ke screenshots/layout_*.png dan mencetak metrik grid.
"""
from playwright.sync_api import sync_playwright
import os, sys, io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = os.environ.get("BASE_URL", "http://localhost:5199")
os.makedirs("screenshots", exist_ok=True)

VIEWPORTS = [
    ("desktop_1440", 1440, 900),
    ("laptop_1180", 1180, 820),
    ("tablet_1024", 1024, 768),
    ("tablet_977", 977, 576),
    ("mobile_390", 390, 844),
]

with sync_playwright() as p:
    browser = p.chromium.launch()
    ok = True
    for name, w, h in VIEWPORTS:
        page = browser.new_page(viewport={"width": w, "height": h})
        page.goto(f"{BASE}/kasir", wait_until="networkidle")
        page.wait_for_timeout(800)
        # login demo bila belum punya sesi di browser ini
        if page.locator('input[type="email"]').count():
            page.fill('input[type="email"]', "admin@sabana.com")
            page.fill('input[type="password"]', "admin123")
            page.click('button[type="submit"]')
            page.wait_for_timeout(1500)
        page.wait_for_timeout(1000)
        # tutup popup shift bila muncul
        for label in ("Nanti saja", "Lanjut Jualan"):
            btn = page.locator('[role="dialog"] button', has_text=label)
            if btn.count():
                btn.first.click()
                page.wait_for_timeout(300)
        m = page.evaluate(
            """() => {
              const sec = document.querySelector('main section');
              const aside = document.querySelector('main aside');
              const grid = sec?.querySelector('div.grid');
              const card = grid?.querySelector('button');
              return {
                secH: sec?.offsetHeight ?? 0,
                gridH: grid?.offsetHeight ?? 0,
                cols: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
                cardH: card?.offsetHeight ?? 0,
                asideH: aside?.offsetHeight ?? 0,
                pageScrollX: document.documentElement.scrollWidth > window.innerWidth
              };
            }"""
        )
        path = os.path.join("screenshots", f"layout_{name}.png")
        page.screenshot(path=path, full_page=True)
        status = "PASS" if (m["gridH"] >= 100 and m["cardH"] >= 80 and not m["pageScrollX"]) else "FAIL"
        if status == "FAIL":
            ok = False
        print(
            f"  {status} {name} ({w}x{h}): katalog={m['secH']}px grid={m['gridH']}px "
            f"kolom={m['cols']} kartu={m['cardH']}px keranjang={m['asideH']}px "
            f"scrollX={m['pageScrollX']} -> {path}"
        )
        page.close()
    browser.close()

print("\nHASIL:", "SEMUA PASS" if ok else "ADA YANG GAGAL")
sys.exit(0 if ok else 1)
