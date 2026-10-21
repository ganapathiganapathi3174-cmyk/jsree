import os, sys, json, time, datetime, re
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.desired_capabilities import DesiredCapabilities

BASE = os.environ.get("QA_BASE", "https://jsree.vercel.app")
API = os.environ.get("QA_API", "https://jsree-backend-production.up.railway.app/api")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "qa-results")
SCREEN = os.path.join(OUT, "screenshots")
LOGS = os.path.join(OUT, "logs")
REPORTS = os.path.join(OUT, "reports")
os.makedirs(SCREEN, exist_ok=True)
os.makedirs(LOGS, exist_ok=True)
os.makedirs(REPORTS, exist_ok=True)

def make_driver(headless=True, width=1280, height=800):
    opts = Options()
    if headless:
        opts.add_argument("--headless=new")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument(f"--window-size={width},{height}")
    opts.set_capability("goog:loggingPrefs", {"browser": "ALL", "performance": "ALL"})
    drv = webdriver.Chrome(options=opts)
    drv.set_window_size(width, height)
    return drv

def console_errors(drv):
    out = []
    try:
        for e in drv.get_log("browser"):
            if e.get("level") in ("SEVERE", "ERROR"):
                out.append(e.get("message", ""))
    except Exception:
        pass
    return out

def screenshot(drv, name):
    p = os.path.join(SCREEN, f"{name}.png")
    try:
        drv.save_screenshot(p)
        return p
    except Exception as ex:
        return f"ERR {ex}"

def wait(sec):
    def w(d):
        time.sleep(sec)
        return True
    return w

def shot_now():
    return datetime.datetime.now().strftime("%Y%m%d_%H%M%S")

class QA:
    def __init__(self, headless=True):
        self.results = []
        self.driver = make_driver(headless=headless)

    def check(self, name, cond, detail=""):
        status = "PASS" if cond else "FAIL"
        self.results.append({"name": name, "status": status, "detail": str(detail)})
        print(f"  [{status}] {name} -- {detail}")

    def close(self):
        try:
            self.driver.quit()
        except Exception:
            pass

    def report(self, path=None):
        path = path or os.path.join(REPORTS, "qa_report.json")
        with open(path, "w") as f:
            json.dump(self.results, f, indent=2)
        passed = sum(1 for r in self.results if r["status"] == "PASS")
        print(f"\n=== QA RESULTS: {passed}/{len(self.results)} PASS ===")
        return passed, len(self.results)

if __name__ == "__main__":
    qa = QA(headless=True)
    d = qa.driver
    try:
        d.set_page_load_timeout(30)
        d.get(BASE)
        time.sleep(6)
        title = d.title
        body = d.find_element(By.TAG_NAME, "body").text
        errs = console_errors(d)
        qa.check("title present", len(title) > 0, f"title={title!r}")
        qa.check("body rendered", len(body.strip()) > 20, f"len={len(body.strip())}")
        qa.check("no console errors", len(errs) == 0, f"errors={errs[:3]}")
        ss = screenshot(d, "01_public_" + shot_now())
        print("screenshot:", ss)
    except Exception as ex:
        qa.check("public load", False, str(ex)[:200])
    qa.report()
    qa.close()