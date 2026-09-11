"""
Sabana Kasir – End-to-end smoke test (Playwright).
Tests every route in the app in demo mode.
"""
from playwright.sync_api import sync_playwright
import os, sys, io

# Force UTF-8 output on Windows
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

SCREENSHOTS_DIR = "screenshots"
os.makedirs(SCREENSHOTS_DIR, exist_ok=True)

BASE = os.environ.get("BASE_URL", "http://localhost:5173")

results = []  # (name, passed, detail)

def screenshot(page, name):
    path = os.path.join(SCREENSHOTS_DIR, f"{name}.png")
    page.screenshot(path=path, full_page=True)
    print(f"  Screenshot: {path}")

def test_login(page):
    print("\n--- Testing Login ---")
    page.goto(BASE)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1000)

    # Fill login form (demo mode)
    try:
        email_input = page.locator('input[type="email"]').first
        email_input.wait_for(timeout=8000)
        email_input.fill("admin@sabana.com")
        password_input = page.locator('input[type="password"]').first
        password_input.fill("admin123")
        login_btn = page.locator('button[type="submit"]').first
        login_btn.click()
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(2000)
        screenshot(page, "01_after_login")
        content = page.content()
        assert "Sabana" in content or "Dashboard" in content or "Kasir" in content, "Login failed"
        results.append(("Login", True, "Logged in as admin"))
        print("  PASS - Login successful")
    except Exception as e:
        results.append(("Login", False, str(e)))
        screenshot(page, "01_login_error")
        print(f"  FAIL - {e}")

def goto(page, route, name, timeout=1500):
    """Navigate to a route, screenshot, check no crash."""
    print(f"\n--- Testing {name} ({route}) ---")
    try:
        page.goto(f"{BASE}{route}", wait_until="networkidle")
        page.wait_for_timeout(timeout)
        screenshot(page, name)
        # Check page didn't crash to a blank/error screen
        body = page.locator("body")
        text = (body.text_content() or "").strip()
        assert len(text) > 10, f"Page seems empty or crashed"
        results.append((name, True, f"OK ({len(text)} chars)"))
        print(f"  PASS - {name} loaded")
    except Exception as e:
        results.append((name, False, str(e)))
        screenshot(page, f"{name}_error")
        print(f"  FAIL - {e}")

def test_cashier_interaction(page):
    print("\n--- Testing Cashier Interaction ---")
    try:
        page.goto(f"{BASE}/kasir", wait_until="networkidle")
        page.wait_for_timeout(1500)

        # Tutup popup shift (fresh profile belum buka shift) supaya klik tembus
        later = page.locator('button:has-text("Nanti saja")')
        if later.count():
            later.first.click()
            page.wait_for_timeout(500)

        # Click first product-looking button
        buttons = page.locator("button").all()
        clicked_name = None
        for btn in buttons:
            txt = (btn.text_content() or "").strip()
            if any(kw in txt for kw in ["Ayam", "Nasi", "Kentang", "Teh", "Kulit", "Sambal", "Chicken", "Roll"]):
                btn.click()
                page.wait_for_timeout(800)
                clicked_name = txt[:40]
                break

        if clicked_name:
            screenshot(page, "02_cashier_item_added")
            results.append(("Cashier Interaction", True, f"Clicked: {clicked_name}"))
            print(f"  PASS - Clicked product: {clicked_name}")
        else:
            results.append(("Cashier Interaction", True, "No matching product button (page loaded)"))
            print("  WARN - No product buttons found, but page loaded")
    except Exception as e:
        results.append(("Cashier Interaction", False, str(e)))
        screenshot(page, "02_cashier_error")
        print(f"  FAIL - {e}")

def test_console_errors(page):
    print("\n--- Checking Console Errors ---")
    errors = []

    def handle_error(msg):
        if msg.type == "error":
            errors.append(msg.text)

    page.on("console", handle_error)

    routes = ["/", "/kasir", "/pesanan", "/produksi", "/bahan", "/menu", "/stok", "/keuangan", "/laporan", "/shift", "/pengaturan"]
    for route in routes:
        page.goto(f"{BASE}{route}", wait_until="networkidle")
        page.wait_for_timeout(600)

    page.remove_listener("console", handle_error)

    if errors:
        print(f"  Found {len(errors)} console errors:")
        for e in errors[:10]:
            print(f"    - {e[:150]}")
    else:
        print("  No console errors found")

    return errors

def main():
    print("=" * 60)
    print("Sabana Kasir - Full App E2E Test")
    print("=" * 60)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 1280, "height": 800},
            locale="id-ID"
        )
        page = context.new_page()

        try:
            test_login(page)

            # All routes
            goto(page, "/",          "03_dashboard")
            goto(page, "/kasir",     "04_cashier")
            goto(page, "/pesanan",   "05_orders")
            goto(page, "/produksi",  "06_production")
            goto(page, "/bahan",     "07_ingredients")
            goto(page, "/menu",      "08_products")
            goto(page, "/stok",      "09_stock")
            goto(page, "/keuangan",  "10_finance")
            goto(page, "/laporan",   "11_reports")
            goto(page, "/shift",     "12_shift")
            goto(page, "/pengaturan","13_settings")

            # Interaction
            test_cashier_interaction(page)

            # Console errors
            console_errors = test_console_errors(page)

            # Summary
            passed = sum(1 for _, ok, _ in results if ok)
            failed = sum(1 for _, ok, _ in results if not ok)
            print("\n" + "=" * 60)
            print("TEST RESULTS SUMMARY")
            print("=" * 60)
            for name, ok, detail in results:
                status = "PASS" if ok else "FAIL"
                print(f"  [{status}] {name}: {detail}")
            print("-" * 60)
            print(f"  Total: {len(results)} | Passed: {passed} | Failed: {failed}")
            if console_errors:
                print(f"  Console errors: {len(console_errors)}")
            print(f"  Screenshots: {os.path.abspath(SCREENSHOTS_DIR)}")
            print("=" * 60)

            if failed > 0:
                sys.exit(1)

        except Exception as e:
            print(f"\nFATAL ERROR: {e}")
            screenshot(page, "fatal_error")
            raise
        finally:
            browser.close()

if __name__ == "__main__":
    main()
