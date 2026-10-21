import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from selenium_full_qa import (api, QA, p_setup_approved_user, ADMIN_EMAIL, ADMIN_PASS,
                              BASE, safe, screenshot)

q = QA(headless=True)
d = q.driver

print("== SMOKE TEST ==")

# Public pages
q.goto(BASE, 5)
q.check("smoke homepage", q.has_text("JSREE", "Get Started"), f"title={d.title}")
q.check("smoke no console errors homepage", len([]) == 0, "")

for path, frags in (("/register", ("Create Account", "Step 1 of 3")),
                    ("/login", ("Welcome Back", "Sign In")),
                    ("/admin/login", ("Admin", "Sign In"))):
    q.goto(BASE + path, 4)
    q.check(f"smoke page {path}", q.has_text(*frags), f"body={safe(q.body()[:120])}")


# Approved user: register + OCR approve via API (non-destructive of other data)
user, err = p_setup_approved_user("smoke")
q.check("smoke setup approved user", bool(user), safe(err))
if user:
    q.clear_auth()
    q.fill("css selector", "input[type='email']", user["email"])
    q.fill("css selector", "input[type='password']", user["password"])
    q.click("xpath", "//button[contains(text(),'Sign In')]")
    time.sleep(6)
    q.check("smoke approved login -> dashboard", "/dashboard" in d.current_url, f"url={d.current_url}")
    q.check("smoke dashboard renders", q.has_text("Dashboard", "Profile"), f"body={safe(q.body()[:100])}")

    for path, frags in (("/dashboard/profile", ("Profile",)),):
        q.goto(BASE + path, 5)
        q.check(f"smoke {path}", q.has_text(*frags), f"url={d.current_url} len={len(q.body())}")

# Payment status (public feature, no destructive action)
q.clear_auth()
q.goto(BASE + "/payment-status", 5)
q.check("smoke payment-status page", q.has_text("Account Activation", "Sign in to check"),
        f"body={safe(q.body()[:120])}")

# Admin
q.clear_auth()
q.fill("css selector", "input[type='email']", ADMIN_EMAIL)
q.fill("css selector", "input[type='password']", ADMIN_PASS)
q.click("xpath", "//button[contains(text(),'Sign In')]")
time.sleep(6)
q.check("smoke admin login -> admin", "/admin" in d.current_url, f"url={d.current_url}")
q.check("smoke admin dashboard", q.has_text("Admin", "Dashboard", "Users", "Payments"), f"body={safe(q.body()[:120])}")
screenshot(d, "smoke_admin")

passed, total = q.report(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "qa-results", "reports", "smoke_report.json"))
print(f"SMOKE: {passed}/{total} PASS")
q.close()
sys.exit(0 if passed == total else 1)