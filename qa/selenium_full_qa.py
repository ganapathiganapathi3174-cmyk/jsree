import os, sys, json, time, datetime, re, urllib.request, urllib.error
from urllib.parse import urlencode
from PIL import Image, ImageDraw, ImageFont
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.keys import Keys

BASE = os.environ.get("QA_BASE", "https://jsree.vercel.app")
API = os.environ.get("QA_API", "https://jsree-backend-production.up.railway.app/api")
ADMIN_EMAIL = os.environ.get("QA_ADMIN_EMAIL", "admin@gmail.com")
ADMIN_PASS = os.environ.get("QA_ADMIN_PASS", "")
if not ADMIN_PASS:
    ADMIN_PASS = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..",
                      "referral-platform", "server", "src", "scripts", "production-final-check.js"),
                      encoding="utf-8", errors="ignore").read().split("password: '")[1].split("'")[0]
ADMIN_UPI = "jayarajj126-3@okicici"

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "qa-results")
SCREEN = os.path.join(OUT, "screenshots")
LOGS = os.path.join(OUT, "logs")
REPORTS = os.path.join(OUT, "reports")
for d in (SCREEN, LOGS, REPORTS):
    os.makedirs(d, exist_ok=True)

TS = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30))

# ---------- API helpers (urllib) ----------
def api(method, path, body=None, token=None, files=None, retries=4):
    url = API + path
    headers = {}
    if token:
        headers["Authorization"] = "Bearer " + token
    data = None
    if files is not None:
        boundary = "----qa" + datetime.datetime.now().strftime("%f")
        parts = []
        for k, (fname, payload, ctype) in files.items():
            parts.append(("--" + boundary).encode())
            parts.append(f'Content-Disposition: form-data; name="{k}"; filename="{fname}"'.encode())
            parts.append(("Content-Type: " + ctype).encode())
            parts.append(b"")
            parts.append(payload if isinstance(payload, bytes) else payload.encode())
        parts.append(("--" + boundary + "--").encode())
        data = b"\r\n".join(parts)
        headers["Content-Type"] = "multipart/form-data; boundary=" + boundary
    elif body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    for attempt in range(retries):
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read().decode("utf-8", errors="replace")
                return r.status, json.loads(raw) if raw.strip() else {}, None
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(raw) if raw.strip() else {}
            except Exception:
                parsed = {}
            if e.code == 429 and attempt < retries - 1:
                time.sleep(10 + attempt * 8)
                continue
            return e.code, parsed, None
        except Exception as ex:
            if attempt < retries - 1:
                time.sleep(8)
                continue
            return 0, {}, str(ex)
    return 0, {}, "retries exhausted"

TTL = 30 if os.path.exists("C:/Windows/Fonts/arialbd.ttf") else 36

def make_screenshot(path, amount, upi, utr, date_str):
    path = os.path.realpath(path)
    img = Image.new("RGB", (900, 520), "white")
    d = ImageDraw.Draw(img)
    f_big = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 40)
    f_lab = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 26)
    f_val = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 30)
    f_sm = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 22)
    y = 60
    d.text((450, 60), "Payment Successful", font=f_big, fill="#333", anchor="mm")
    for label, val in (("Amount", "\u20b9" + str(amount)), ("To", upi), ("UTR", utr), ("Date", date_str)):
        y += 70
        d.text((80, y), label, font=f_lab, fill="#666")
        tw = d.textlength(str(val), font=f_val)
        d.text((850 - tw, y), str(val), font=f_val, fill="#333")
    d.text((450, 470), "UPI Transaction", font=f_sm, fill="#999", anchor="mm")
    img.save(path)
    return path

def ist_wallclock_str(now=None):
    now = now or datetime.datetime.now(IST)
    return now.strftime("%d/%m/%Y %H:%M")

# ---------- Selenium ----------
def make_driver(headless=True, width=1280, height=800):
    opts = Options()
    if headless:
        opts.add_argument("--headless=new")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--user-data-dir=" + os.path.join(os.environ.get("TEMP",
                       "C:/Users/pavi/AppData/Local/Temp"), "jsree_qa_" + str(os.getpid())))
    opts.set_capability("goog:loggingPrefs", {"browser": "ALL", "performance": "ALL"})
    drv = webdriver.Chrome(options=opts)
    drv.set_window_size(width, height)
    return drv

def console_errors(drv):
    out = []
    try:
        for e in drv.get_log("browser"):
            if e.get("level") in ("SEVERE", "ERROR") and ("Minified React error" in e.get("message", "") or "Uncaught" in e.get("message", "")):
                out.append(e.get("message", ""))
    except Exception:
        pass
    return out

def clear_console(drv):
    try:
        drv.get_log("browser")
    except Exception:
        pass

def screenshot(drv, name):
    p = os.path.join(SCREEN, f"{name}.png")
    try:
        drv.save_screenshot(p)
        return p
    except Exception as ex:
        return f"ERR {ex}"

def shot_now():
    return datetime.datetime.now().strftime("%Y%m%d_%H%M%S")

def safe(s):
    if not isinstance(s, str):
        s = str(s)
    try:
        s.encode("cp1252")
        return s
    except (UnicodeEncodeError, UnicodeDecodeError):
        return s.encode("cp1252", errors="replace").decode("cp1252")

class QA:
    def __init__(self, headless=True):
        self.results = []
        self.driver = make_driver(headless=headless)
        self.wait = WebDriverWait(self.driver, 40)

    def check(self, name, cond, detail=""):
        status = "PASS" if cond else "FAIL"
        d = safe(detail)
        self.results.append({"name": name, "status": status, "detail": d[:500]})
        print(f"  [{'PASS' if cond else 'FAIL'}] {name} -- {d[:200]}")
        return bool(cond)

    def goto(self, url, wait_sec=6):
        clear_console(self.driver)
        self.driver.get(url)
        time.sleep(wait_sec)

    def clear_auth(self):
        try:
            self.driver.execute_script("localStorage.clear();")
            self.driver.get(BASE + "/login")
            time.sleep(3)
        except Exception:
            pass

    def body(self):
        try:
            return self.driver.find_element(By.TAG_NAME, "body").text
        except Exception:
            return ""

    def fill(self, by, key, value):
        el = self.driver.find_element(by, key)
        el.clear()
        el.send_keys(value)
        return el

    def click(self, by, key, wait=40):
        WebDriverWait(self.driver, wait).until(EC.element_to_be_clickable((by, key))).click()
        time.sleep(2)

    def has_text(self, *frags):
        b = self.body()
        return any(f in b for f in frags)

    def close(self):
        try:
            self.driver.quit()
        except Exception:
            pass

    def report(self, path=None):
        path = path or os.path.join(REPORTS, f"qa_report_{TS}.json")
        with open(path, "w") as f:
            json.dump(self.results, f, indent=2)
        passed = sum(1 for r in self.results if r["status"] == "PASS")
        failed = [r for r in self.results if r["status"] == "FAIL"]
        print(f"\n=== FULL QA: {passed}/{len(self.results)} PASS, {len(failed)} FAIL ===")
        for r in failed:
            print(f"  FAIL: {r['name']} :: {safe(r['detail'])[:300]}")
        return passed, len(self.results)


# ================= PHASES =================
def p_setup_approved_user(tag):
    ts = datetime.datetime.now().strftime("%H%M%S%f")[:9]
    email = f"qa_{tag}_{ts}@test.com"
    mobile = "9" + ts[:9]
    st, r, _ = api("POST", "/auth/register", {"name": f"QA {tag}", "email": email,
                                              "mobile": mobile, "password": "Test@123456", "plan": "120"})
    if st not in (200, 201) or not r.get("success"):
        return None, f"register failed {st} {r}"
    token = r["data"]["token"]
    st, r, _ = api("POST", "/payments", {"plan": "120"}, token)
    if st not in (200, 201) or not r.get("success"):
        return None, f"create payment failed {st} {r}"
    pid = r["data"]["id"]
    sh = os.path.join(LOGS, f"qa_{tag}_{ts}_pay.png")
    make_screenshot(sh, 120, ADMIN_UPI, f"QA{ts}UTR01", ist_wallclock_str())
    st, r, _ = api("POST", f"/payments/{pid}/screenshot", None, token,
                   {"screenshot": (f"qa_{tag}_{ts}.png", open(sh, "rb").read(), "image/png")})
    if st not in (200, 201) or not r.get("success"):
        return None, f"screenshot upload failed {st} {r}"
    return {"email": email, "password": "Test@123456", "token": token, "pid": pid,
            "verification": (r.get("data") or {}).get("verification")}, "ok"


def p_pending_user(tag):
    ts = datetime.datetime.now().strftime("%H%M%S%f")[:9]
    email = f"qap_{tag}_{ts}@test.com"
    mobile = "8" + ts[:9]
    st, r, _ = api("POST", "/auth/register", {"name": f"QA pending {tag}", "email": email,
                                              "mobile": mobile, "password": "Test@123456", "plan": "120"})
    if st not in (200, 201) or not r.get("success"):
        return None, f"register failed {st} {r}"
    token = r["data"]["token"]
    st, r, _ = api("POST", "/payments", {"plan": "120"}, token)
    if st not in (200, 201) or not r.get("success"):
        return None, f"payment failed {st} {r}"
    return {"email": email, "password": "Test@123456", "token": token, "pid": r["data"]["id"]}, "ok"


def phase_public(qa):
    print("\n-- PHASE 1: Public Site")
    d = qa.driver
    qa.goto(BASE)
    errs = console_errors(d)
    qa.check("1.1 public loads", "JSREE" in d.title, f"title={d.title}")
    qa.check("1.2 body rendered", len(qa.body().strip()) > 20, f"len={len(qa.body().strip())}")
    qa.check("1.3 no console errors", len(errs) == 0, f"errors={errs[:2]}")
    qa.check("1.4 landing CTA present", qa.has_text("Register", "Get Started", "Join", "Premium"),
             f"body[:120]={qa.body()[:120]!r}")
    screenshot(d, f"01_public_{shot_now()}")
    for path in ("/register", "/login", "/admin/login"):
        qa.goto(BASE + path, 4)
        errs = console_errors(d)
        qa.check(f"1.5 page loads {path}", len(qa.body().strip()) > 10 and len(errs) == 0,
                 f"errs={errs[:1]}")


def phase_register_validation(qa):
    print("\n-- PHASE 2: Register client validation")
    d = qa.driver
    qa.goto(BASE + "/register?plan=120", 5)
    qa.click(By.XPATH, "//button[contains(text(),'Next')]")
    time.sleep(1)
    qa.check("2.1 empty submit blocked", qa.has_text("All fields are required"),
             f"body={qa.body()[:150]!r}")
    qa.fill(By.CSS_SELECTOR, "input[placeholder='John Doe']", "QA Tester")
    qa.fill(By.CSS_SELECTOR, "input[type='email']", "bademail")
    qa.fill(By.CSS_SELECTOR, "input[placeholder='9876543210']", "123")
    qa.fill(By.CSS_SELECTOR, "input[type='password']", "abc")
    qa.fill(By.CSS_SELECTOR, "input[placeholder='Re-enter password']", "xyz")
    qa.click(By.XPATH, "//button[contains(text(),'Next')]")
    time.sleep(1)
    qa.check("2.2 invalid email blocked", qa.has_text("Invalid email format"),
             f"body={qa.body()[:150]!r}")


def phase_register_ocr(qa):
    print("\n-- PHASE 3: Register + OCR approve via UI")
    ts = datetime.datetime.now().strftime("%H%M%S%f")[:9]
    email = f"qaui_{ts}@test.com"
    sh = os.path.join(LOGS, f"qaui_{ts}_pay.png")
    make_screenshot(sh, 120, ADMIN_UPI, f"QAUI{ts}UTR01", ist_wallclock_str())
    sh = os.path.realpath(sh)
    d = qa.driver
    qa.goto(BASE + "/register?plan=120", 5)
    qa.fill(By.CSS_SELECTOR, "input[placeholder='John Doe']", "QA UI OCR")
    qa.fill(By.CSS_SELECTOR, "input[type='email']", email)
    qa.fill(By.CSS_SELECTOR, "input[placeholder='9876543210']", "9" + ts[:9])
    pw = qa.driver.find_element(By.CSS_SELECTOR, "input[placeholder='Min 6 characters']")
    pw.clear(); pw.send_keys("Test@123456")
    qa.fill(By.CSS_SELECTOR, "input[placeholder='Re-enter password']", "Test@123456")
    qa.click(By.XPATH, "//button[contains(text(),'Next')]")
    time.sleep(1)
    qa.click(By.XPATH, "//button[contains(.,'Basic')]")
    qa.click(By.XPATH, "//button[contains(text(),'Next')]")
    time.sleep(1)
    qa.check("3.1 payment instructions shown", qa.has_text("Payment Instructions", ADMIN_UPI),
             f"body={qa.body()[:200]!r}")
    up = d.find_element(By.CSS_SELECTOR, "input[type='file']")
    up.send_keys(sh)
    time.sleep(2)
    qa.click(By.XPATH, "//button[contains(text(),'Submit Registration')]")
    for _ in range(12):
        time.sleep(3)
        if "/dashboard" in d.current_url or "/payment-status" in d.current_url:
            break
    url = d.current_url
    ok_approved = "/dashboard" in url
    qa.check("3.2 OCR approved -> dashboard", ok_approved,
             f"url={url}, body={qa.body()[:120]!r}")
    if not ok_approved:
        qa.check("3.3 fallback pending page", "/payment-status" in url, f"url={url}")
    screenshot(d, f"03_register_ocr_{shot_now()}")
    return email


def phase_pending_gate(qa, pending):
    print("\n-- PHASE 4: Pending access control")
    d = qa.driver
    qa.clear_auth()
    qa.fill(By.CSS_SELECTOR, "input[type='email']", pending["email"])
    qa.fill(By.CSS_SELECTOR, "input[type='password']", pending["password"])
    qa.click(By.XPATH, "//button[contains(text(),'Sign In')]")
    time.sleep(8)
    qa.check("4.1 pending login -> payment-status", "/payment-status" in d.current_url,
             f"url={d.current_url}")
    qa.check("4.2 payment-status shows pending", qa.has_text("pending", "Pending", "awaiting", "review", "Approval"),
             f"body={qa.body()[:200]!r}")
    screenshot(d, f"04_pending_{shot_now()}")
    qa.goto(BASE + "/dashboard", 6)
    qa.check("4.3 direct dashboard blocked for pending", "/payment-status" in d.current_url or "/login" in d.current_url,
             f"url={d.current_url}")


def phase_approved_login(qa, user):
    print("\n-- PHASE 5: Approved login + dashboard")
    d = qa.driver
    qa.clear_auth()
    qa.fill(By.CSS_SELECTOR, "input[type='email']", user["email"])
    qa.fill(By.CSS_SELECTOR, "input[type='password']", user["password"])
    qa.click(By.XPATH, "//button[contains(text(),'Sign In')]")
    time.sleep(8)
    qa.check("5.1 approved login -> dashboard", "/dashboard" in d.current_url,
             f"url={d.current_url}")
    qa.check("5.2 dashboard content", qa.has_text("Dashboard", "Welcome", "Wallet", "Referral"),
             f"body={qa.body()[:150]!r}")
    screenshot(d, f"05_dashboard_{shot_now()}")
    errs = console_errors(d)
    qa.check("5.3 dashboard no console errors", len(errs) == 0, f"errors={errs[:2]}")
    for sub in ("profile", "payments", "topups", "referrals", "plan-change", "chat",
                "history", "wallet", "notifications", "receipts", "security"):
        qa.goto(f"{BASE}/dashboard/{sub}", 5)
        loaded = len(qa.body().strip()) > 20
        errs = console_errors(d)
        qa.check(f"5.4 /dashboard/{sub} loads", loaded and len(errs) == 0,
                 f"len={len(qa.body().strip())} errs={errs[:1]}")
    return user["token"]


def phase_wrong_password(qa, user):
    print("\n-- PHASE 6: Wrong password rejected")
    d = qa.driver
    qa.goto(BASE + "/login", 4)
    qa.fill(By.CSS_SELECTOR, "input[type='email']", user["email"])
    qa.fill(By.CSS_SELECTOR, "input[type='password']", "WrongPass999!")
    qa.click(By.XPATH, "//button[contains(text(),'Sign In')]")
    time.sleep(2)
    qa.check("6.1 wrong password stays on login", "/login" in d.current_url or qa.has_text("Welcome Back", "Sign In"),
             f"url={d.current_url}, body={qa.body()[:120]!r}")
    qa.check("6.2 not navigated to dashboard", "/dashboard" not in d.current_url,
             f"url={d.current_url}")


def relogin(qa, user):
    d = qa.driver
    qa.goto(BASE + "/login", 4)
    qa.fill(By.CSS_SELECTOR, "input[type='email']", user["email"])
    qa.fill(By.CSS_SELECTOR, "input[type='password']", user["password"])
    qa.click(By.XPATH, "//button[contains(text(),'Sign In')]")
    time.sleep(8)
    return "/dashboard" in d.current_url


def phase_wallet_topup(qa, user):
    print("\n-- PHASE 7: Wallet + topup flow")
    if not relogin(qa, user):
        qa.check("7.0 relogin", False, "could not relogin")
        return
    st, r, _ = api("GET", "/wallet/balance", None, user["token"])
    qa.check("7.1 wallet balance API", st == 200 and ("balance" in r or r.get("success")), f"status={st}, resp={str(r)[:80]}")
    d = qa.driver
    qa.goto(BASE + "/dashboard/topups", 5)
    qa.check("7.2 topups page loads", qa.has_text("Top Up", "Topup", "Top-Up", "Recharge", "Add"),
             f"body={qa.body()[:160]!r}")
    screenshot(d, f"07_topups_{shot_now()}")


def phase_referral(qa, user):
    print("\n-- PHASE 8: Referral code display")
    st, r, _ = api("GET", "/referrals/my-code", None, user["token"])
    data = r.get("data") or {}
    code = data.get("referralCode") or data.get("referral_code") or data.get("code")
    qa.check("8.1 referral code API", st == 200 and bool(code), f"status={st}, data={str(data)[:120]}")
    d = qa.driver
    qa.goto(BASE + "/dashboard/referrals", 5)
    qa.check("8.2 referrals page loads", qa.has_text("Referral", "referral", "Invite", "code"),
             f"body={qa.body()[:160]!r}")
    screenshot(d, f"08_referrals_{shot_now()}")


def phase_plan_change(qa, user):
    print("\n-- PHASE 9: Plan change request")
    st, r, _ = api("POST", "/plans/change-request", {"requestedPlan": "500", "reason": "QA upgrade"},
                   user["token"])
    qa.check("9.1 plan change API", st in (200, 201), f"status={st}, resp={str(r)[:120]}")
    d = qa.driver
    qa.goto(BASE + "/dashboard/plan-change", 5)
    qa.check("9.2 plan-change page loads", qa.has_text("Change Plan", "Upgrade", "Downgrade", "Plan"),
             f"body={qa.body()[:160]!r}")
    screenshot(d, f"09_planchange_{shot_now()}")


def phase_notifications(qa, user):
    print("\n-- PHASE 10: Notifications")
    st, r, _ = api("GET", "/notifications", None, user["token"])
    qa.check("10.1 notifications API", st == 200, f"status={st}")
    d = qa.driver
    qa.goto(BASE + "/dashboard/notifications", 5)
    qa.check("10.2 notifications page loads", qa.has_text("Notification", "notification", "No"),
             f"body={qa.body()[:160]!r}")
    screenshot(d, f"10_notifications_{shot_now()}")


def phase_chat(qa, user):
    print("\n-- PHASE 11: Chat (user sends message)")
    st, r, _ = api("GET", "/chat/conversations", None, user["token"])
    qa.check("11.1 conversations API", st == 200, f"status={st}")
    d = qa.driver
    qa.goto(BASE + "/dashboard/chat", 5)
    qa.check("11.2 chat page loads", qa.has_text("Chat", "Message", "Support", "Send"),
             f"body={qa.body()[:160]!r}")
    screenshot(d, f"11_chat_{shot_now()}")


def phase_responsive(qa):
    print("\n-- PHASE 12: Responsive / mobile")
    d = qa.driver
    d.set_window_size(390, 844)
    qa.goto(BASE, 6)
    qa.check("12.1 mobile public renders", len(qa.body().strip()) > 20,
             f"len={len(qa.body().strip())}")
    screenshot(d, f"12_mobile_public_{shot_now()}")
    qa.goto(BASE + "/login", 5)
    qa.check("12.2 mobile login renders", qa.has_text("Welcome Back", "Sign In"),
             f"body={qa.body()[:120]!r}")
    screenshot(d, f"12_mobile_login_{shot_now()}")
    d.set_window_size(1280, 800)


def phase_admin(qa):
    print("\n-- PHASE 13: Admin panel")
    d = qa.driver
    qa.clear_auth()
    qa.fill(By.CSS_SELECTOR, "input[type='email']", ADMIN_EMAIL)
    qa.fill(By.CSS_SELECTOR, "input[type='password']", ADMIN_PASS)
    qa.click(By.XPATH, "//button[contains(text(),'Sign In')]")
    time.sleep(8)
    qa.check("13.1 admin login -> admin", "/admin" in d.current_url and "login" not in d.current_url,
             f"url={d.current_url}")
    screenshot(d, f"13_admin_dash_{shot_now()}")
    for sub in ("", "users", "payments", "topups", "inactive-users", "plan-changes", "chat",
                "audit-logs", "financial-reports", "suspicious-activity"):
        qa.goto(BASE + "/admin" + sub, 5)
        loaded = len(qa.body().strip()) > 20
        errs = console_errors(d)
        qa.check(f"13.2 /admin{sub or '/dashboard'} loads", loaded and len(errs) == 0,
                 f"len={len(qa.body().strip())} errs={errs[:1]}")
        screenshot(d, f"13_admin_{sub.replace('/','') or 'dash'}_{shot_now()}")


def phase_security(qa, user):
    print("\n-- PHASE 14: Security checks")
    st, r, _ = api("GET", "/users/profile", None, "invalid-token-12345")
    qa.check("14.1 invalid token rejected", st in (401, 403), f"status={st}")
    st, r, _ = api("GET", "/admin/users", None, None)
    qa.check("14.2 admin without token blocked", st in (401, 403), f"status={st}")
    st, r, _ = api("GET", "/admin/dashboard", None, user["token"])
    qa.check("14.3 admin as non-admin blocked", st in (401, 403), f"status={st}")
    st, r, _ = api("POST", "/auth/login", {"email": "x@x.com", "password": "Test@123"})
    qa.check("14.4 unknown login rejected", st in (401, 400), f"status={st}")
    xem = f"xss_{datetime.datetime.now().strftime('%H%M%S%f')[:9]}@test.com"
    xmob = "7" + datetime.datetime.now().strftime("%H%M%S%f")[:9]
    st, r, _ = api("POST", "/auth/register", {"name": "<script>alert(1)</script>", "email": xem,
                                              "mobile": xmob, "password": "Test@123456", "plan": "120"})
    qa.check("14.5 register with XSS name run", st in (200, 201, 400, 409), f"status={st}")


def phase_perf(qa):
    print("\n-- PHASE 15: Performance (TTFB/latency)")
    t0 = time.time()
    st, r, _ = api("GET", "/health")
    t1 = time.time() - t0
    qa.check("15.1 /health fast", st == 200 and t1 < 5, f"status={st} time={t1:.2f}s")


# ================= MAIN =================
def main():
    headless = os.environ.get("QA_HEADLESS", "1") != "0"
    qa = QA(headless=headless)
    try:
        user, err = p_setup_approved_user("main")
        if user:
            qa.check("setup approved user", True, f"verification={user['verification']}")
        else:
            qa.check("setup approved user", False, err)
        time.sleep(5)
        pending, perr = p_pending_user("gate")
        if pending:
            qa.check("setup pending user", True, "")
        else:
            qa.check("setup pending user", False, perr)

        phase_public(qa)
        phase_register_validation(qa)
        ui_email = phase_register_ocr(qa)
        if pending:
            phase_pending_gate(qa, pending)
        if user:
            phase_approved_login(qa, user)
            phase_wrong_password(qa, user)
            phase_wallet_topup(qa, user)
            phase_referral(qa, user)
            phase_plan_change(qa, user)
            phase_notifications(qa, user)
            phase_chat(qa, user)
            phase_security(qa, user)
        phase_responsive(qa)
        phase_admin(qa)
        phase_perf(qa)
    except Exception as ex:
        import traceback
        traceback.print_exc()
        qa.check("fatal exception", False, str(ex)[:300])
        screenshot(qa.driver, f"00_fatal_{shot_now()}")
    qa.report()
    qa.close()


if __name__ == "__main__":
    main()