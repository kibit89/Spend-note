# Spend Note

A private, offline-first money notebook. It runs entirely in the browser, needs no account,
and installs to the home screen (PWA) from Android Chrome or iOS Safari. The screen is Korean.

- **Private by design** — no server, no analytics. Every record stays in this device's
  `localStorage`, and this repository contains no personal data.
- **3-second entry** — amount → category → save, with quick amount chips (+1,000 / +5,000 / …).
  Flip the toggle to 수입 for income, or to 이체 to move money between your own accounts.
- **내 돈 (assets)** — checking/pay accounts and savings are registered separately with a
  balance. The summary shows the total, an emergency-fund (비상금) goal gauge, and the money
  you can actually spend right now: cash balances minus this month's remaining fixed costs,
  the card bill so far, and what is still to be put into savings.
- **Accounts and cards** — an entry can be paid from a card or an account. A credit card only
  counts toward its monthly performance target; a check card is linked to an account and
  debits it immediately. Transfers between your own accounts are neither spending nor income,
  do not count toward card performance, and only move the two balances.
- **Notification parser** — paste a bank/card/pay push or SMS into the 📋 붙여넣기 sheet and it
  fills the amount, type (지출/수입/이체), card or account, category guess, and memo. Several
  lines can be pasted at once and saved together.
- **Card performance** — per-card monthly target progress, with an “exclude from performance”
  flag for taxes, gift cards, or overseas payments whose counting rules vary by card issuer.
- **Calendar & summary** — daily spending on a monthly calendar (tap a day for that day’s list,
  including transfers), category and card breakdowns, fixed vs variable split, payment-method
  totals.
- **Fixed costs & weekly income guide** — monthly fixed-cost items drive two numbers:
  left-over money (income − fixed costs − variable spending) and the weekly income needed to
  cover both fixed costs and card targets: **(fixed costs + card targets) ÷ 4.33**.
- **Backup** — export and restore everything (accounts, cards, records, settings) as one JSON file.
- **Links** — `#setup=` seeds the whole configuration, `#add=` / `#batch=` add one record or a
  batch. Both are applied on this device, wiped from the address bar immediately, and never
  part of this repository.

## Run locally

Any static server works:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Test

```sh
python3 tools/run-tests.py       # core logic (quickjs): accounts, transfers, assets, parser, links
python3 tools/ui-test.py         # real Chromium through Playwright: screens, forms, #setup/#add
```

`ui-test.py` needs `pip install playwright && playwright install chromium`; it starts its own
static server and uses invented names only.

## Deploy

GitHub Pages serves the `main` branch root. No build step, no dependencies. `.nojekyll` keeps
the folder untouched.

## Setup link

`#setup=<base64url JSON>` — compact keys:

```json
{
  "c":  [["식비", "🍚"], ["카페", "☕"]],
  "ic": [["온라인 수입", "💻"]],
  "f":  [["월세"], ["통신비", 50000]],
  "cards": [["카드이름", 300000, "credit"], ["체크카드이름", 0, "check", "계좌이름"]],
  "a":  [["계좌이름", 500000], ["페이이름", 0, "pay"]],
  "s":  [["적금이름", 2000000, 200000]],
  "eg": 10000000,
  "em": ["비상금에 포함할 계좌 이름"]
}
```

`f` items are a name or `[name, amount]`. `cards` items are `[name, goal, "credit"|"check", linked account name]`.
`a` items are `[name, balance, "checking"|"pay"]`; `s` items are `[name, balance, monthly saving amount]`.
`eg` is the emergency-fund goal. Applying the same link twice never duplicates anything, and
existing records are never touched.

`#add=` / `#batch=<base64url JSON>` adds records to today:

```json
{"e": [
  {"t": "expense", "a": 12000, "cat": "식비", "m": "카드이름", "memo": "점심"},
  {"t": "income",  "a": 50000, "cat": "온라인 수입", "m": "계좌이름"},
  {"t": "transfer", "a": 200000, "from": "계좌이름", "to": "적금이름"}
]}
```

Optional keys: `d` (date, default today), `x` (exclude from card performance). Re-using the same
link skips records that are already there.

Build a link from a JSON file:

```sh
python3 tools/make-link.py payload.json --kind setup
```

## Notes

- Records are per browser profile: clearing site data or uninstalling the app deletes them, so
  keep a JSON backup before switching phones.
- A “month” follows the device clock; the calendar and totals use local dates.
- Fixed costs are a monthly commitment entered in Settings. Recording the payment as spending
  in the 고정비 category reduces “remaining fixed costs” in the asset card instead of
  double-counting it there; the left-over figure on the summary still uses the full commitment.
- Account balances are a starting balance plus every record after the account's baseline date.
  Editing an account's “now balance” re-bases it at today, so later edits to old records do not
  silently change it.
- The service worker caches the app shell. After changing files, bump the `?v=` numbers in
  `index.html` and `sw.js` (and `CACHE`) so installed phones pick up the new version.
- Icons are generated with `python3 tools/make-icons.py` (Pillow).
