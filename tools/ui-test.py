#!/usr/bin/env python3
"""Browser (Chromium) test for the Spend Note UI.

Starts a local static server for the repository, opens the app in Chromium
through Playwright, applies a #setup= link, and walks the real screens:
entry, transfer, assets, notification paste, #add= link and persistence.

    pip install playwright && playwright install chromium
    python3 tools/ui-test.py [--shots DIR]

The fixture uses invented names only; the test proves the wiring, not any
particular person's settings.
"""
import argparse
import base64
import functools
import http.server
import json
import os
import socketserver
import sys
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SETUP = {
    "c": [["식비", "🍚"], ["카페", "☕"], ["생활", "🧺"], ["고정비", "📅"], ["기타", "📌"]],
    "ic": [["온라인 수입", "💻"], ["기타 수입", "📌"]],
    "f": [["월세", 200000], ["통신비", 50000]],
    "cards": [["한빛카드", 300000, "credit"], ["누리카드", 0, "check", "빛은행"]],
    "a": [["빛은행", 1000000], ["별페이", 100000, "pay"]],
    "s": [["새싹적금", 2000000, 200000]],
    "eg": 10000000,
}

BATCH = {"e": [
    {"t": "expense", "a": 3300, "cat": "식비", "m": "한빛카드", "memo": "링크 지출"},
    {"t": "income", "a": 50000, "cat": "온라인 수입", "m": "별페이", "memo": "링크 수입"},
]}


def b64url(payload):
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    httpd.allow_reuse_address = True
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, port


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shots", default="")
    args = ap.parse_args()

    from playwright.sync_api import sync_playwright

    httpd, port = serve()
    base = "http://127.0.0.1:%d/" % port
    failures = []
    checks = [0]

    def check(cond, label, detail=""):
        checks[0] += 1
        if not cond:
            failures.append(label + (" → " + str(detail) if detail else ""))

    def shot(page, name):
        if not args.shots:
            return
        os.makedirs(args.shots, exist_ok=True)
        page.screenshot(path=os.path.join(args.shots, name + ".png"), full_page=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        page = browser.new_context(viewport={"width": 412, "height": 900}).new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

        def text(sel):
            return page.inner_text(sel)

        # ---- 1. setup link ----
        page.goto(base + "#setup=" + b64url(SETUP))
        page.wait_for_timeout(400)
        check(page.evaluate("location.hash") == "", "setup: hash removed from address bar")
        check("한빛카드" in text("#cardList"), "setup: card list rendered", text("#cardList"))
        check("빛은행" in text("#accountList"), "setup: account list rendered", text("#accountList"))
        check("새싹적금" in text("#accountList"), "setup: savings rendered", text("#accountList"))
        check("10,000,000" in text("#goalNow"), "setup: emergency goal", text("#goalNow"))
        check(len(page.query_selector_all("#catList .item-row")) == 5, "setup: five categories")
        check(len(page.query_selector_all("#fixedList .item-row")) == 2, "setup: two fixed costs")
        shot(page, "01-settings")

        # ---- 2. plain card expense ----
        page.click('.tab[data-view="add"]')
        page.fill("#amountInput", "12000")
        page.click('#catGrid .cat-btn:has-text("식비")')
        page.click('#methodChips .method-chip:has-text("한빛카드")')
        page.click("#saveMain")
        page.wait_for_timeout(200)
        check("12,000" in text("#todayList"), "entry: card expense in today list", text("#todayList"))
        check("12,000" in text("#gaugeCard"), "entry: card gauge picked up the amount", text("#gaugeCard"))
        check("지출 12,000원" in text("#todayTotal"), "entry: today total", text("#todayTotal"))
        shot(page, "02-entry")

        # ---- 3. internal transfer ----
        page.click('.type-btn[data-type="transfer"][data-act="pick-type"]')
        page.fill("#amountInput", "200000")
        page.click('#fromChips .method-chip:has-text("빛은행")')
        page.click('#toChips .method-chip:has-text("새싹적금")')
        check(page.inner_text("#saveMain") == "이체 저장", "transfer: save label")
        page.click("#saveMain")
        page.wait_for_timeout(200)
        check("이체" in text("#todayList"), "transfer: row in today list", text("#todayList"))
        check("지출 12,000원" in text("#todayTotal"), "transfer: not added to today spending", text("#todayTotal"))

        # ---- 4. assets ----
        page.click('.tab[data-view="summary"]')
        page.wait_for_timeout(200)
        asset_text = text("#sumAssets")
        check("3,100,000" in asset_text, "assets: total balance", asset_text)
        check("800,000" in asset_text, "assets: bank balance after transfer", asset_text)
        check("2,200,000" in asset_text, "assets: savings balance after transfer", asset_text)
        check("2,200,000" in asset_text and "10,000,000" in asset_text, "assets: emergency gauge values", asset_text)
        check("22%" in asset_text, "assets: emergency percent", asset_text)
        check("638,000" in asset_text, "assets: spendable money", asset_text)
        check("12,000" in text("#sumTotals"), "summary: spending excludes transfer", text("#sumTotals"))
        shot(page, "03-summary")

        # ---- 5. notification paste ----
        page.click('.tab[data-view="add"]')
        page.click('[data-act="open-parser"]')
        page.fill("#parseText", "한빛카드 승인 4,500원 11/23 12:34 스타벅스")
        page.click('[data-act="parse-run"]')
        page.wait_for_timeout(200)
        check(page.evaluate("document.querySelector('#parseDialog').open") is False, "parse: dialog closes for one line")
        check(page.evaluate("document.querySelector('#amountInput').value") == "4,500", "parse: amount filled",
              page.evaluate("document.querySelector('#amountInput').value"))
        check(page.evaluate("document.querySelector('#catGrid .cat-btn.is-on .cat-name').textContent") == "카페",
              "parse: category guessed", page.evaluate("document.querySelector('#catGrid .cat-btn.is-on .cat-name') && document.querySelector('#catGrid .cat-btn.is-on .cat-name').textContent"))
        check("한빛카드" in page.evaluate("document.querySelector('#methodChips .method-chip.is-on').textContent"),
              "parse: card method selected")
        check(page.evaluate("document.querySelector('#memoInput').value") == "스타벅스", "parse: memo filled",
              page.evaluate("document.querySelector('#memoInput').value"))
        shot(page, "04-parsed")
        page.click("#saveMain")
        page.wait_for_timeout(200)
        check("4,500" in text("#todayList"), "parse: saved through the normal form")

        # ---- 6. multi-line paste ----
        page.click('[data-act="open-parser"]')
        page.fill("#parseText", "빛은행 출금 30,000원 잔액 800,000원\n누리카드 8,000원 결제 김밥천국")
        page.click('[data-act="parse-run"]')
        page.wait_for_timeout(200)
        check("2건 인식" in text("#parsePreview"), "parse: multi-line preview", text("#parsePreview"))
        page.click('[data-act="parse-save-all"]')
        page.wait_for_timeout(300)
        check("30,000" in text("#todayList") and "8,000" in text("#todayList"), "parse: both lines saved", text("#todayList"))
        shot(page, "05-multi")

        # ---- 7. balances follow spending ----
        page.click('.tab[data-view="summary"]')
        page.wait_for_timeout(200)
        asset_text = text("#sumAssets")
        check("762,000" in asset_text, "assets: account spending and check card both debited the bank", asset_text)
        check("3,062,000" in asset_text, "assets: total reflects the two new payments", asset_text)

        # ---- 8. #add= link ----
        page.goto(base + "#add=" + b64url(BATCH))
        page.wait_for_timeout(400)
        check(page.evaluate("location.hash") == "", "add link: hash removed")
        check("링크 지출" in text("#todayList"), "add link: expense added", text("#todayList"))
        check("링크 수입" in text("#todayList"), "add link: income added", text("#todayList"))
        page.goto(base + "#add=" + b64url(BATCH))
        page.wait_for_timeout(400)
        check(text("#todayList").count("링크 지출") == 1, "add link: same link does not duplicate")

        # ---- 9. persistence ----
        page.reload()
        page.wait_for_timeout(400)
        check("링크 지출" in text("#todayList"), "persistence: records survive reload")
        check("빛은행" in page.evaluate("localStorage.getItem('spend-note:v2') || ''"), "persistence: accounts stored locally")

        # ---- 10. v2 data migration ----
        page.evaluate("""() => {
          const d = new Date().toISOString().slice(0, 10);
          localStorage.setItem('spend-note:v2', JSON.stringify({
            version: 2,
            cards: [{ id: 'c1', name: '옛카드', goal: 300000 }],
            categories: [{ id: 'food', name: '식비' }, { id: 'etc', name: '기타' }],
            incomeCategories: [{ id: 'inc_etc', name: '기타 수입' }],
            fixedCosts: [{ id: 'f1', name: '월세', amount: 200000 }],
            entries: [{ id: 'old1', type: 'expense', date: d, amount: 7000, categoryId: 'food',
                        methodType: 'card', cardId: 'c1', memo: '옛 기록', excludePerf: false,
                        createdAt: new Date().toISOString() }],
            settings: {}
          }));
        }""")
        page.reload()
        page.wait_for_timeout(400)
        check("옛 기록" in text("#todayList"), "migration: v2 record still listed", text("#todayList"))
        check("옛카드" in text("#cardList"), "migration: v2 card kept", text("#cardList"))
        check("계좌 등록하기" in text("#sumAssets"), "migration: assets asks for accounts on old data",
              text("#sumAssets")[:80])

        # ---- 11. console errors ----
        page.click('.tab[data-view="settings"]')
        page.wait_for_timeout(200)
        check(not errors, "no console or page errors", errors[:3])
        shot(page, "06-settings-after")

        browser.close()

    httpd.shutdown()
    print("%d checks, %d failures" % (checks[0], len(failures)))
    for f in failures:
        print("  FAIL " + f)
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
