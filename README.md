# Spend Note

A private, offline-first spending notebook. It runs entirely in the browser, needs no account,
and installs to the home screen (PWA) from Android Chrome or iOS Safari.

- **Private by design** — no server, no analytics. Every record stays in this device's
  `localStorage`, and this repository contains no personal data.
- **3-second entry** — amount → category → save, with quick amount chips (+1,000 / +5,000 / …)
  and the first card preselected. Flip the toggle to 수입 to record income the same way.
- **Card performance** — per-card monthly target progress, with an “exclude from performance”
  flag for taxes, gift cards, or overseas payments whose counting rules vary by card issuer.
- **Calendar & summary** — daily spending on a monthly calendar (tap a day for that day’s list),
  category and card breakdowns, fixed vs variable split, payment-method totals.
- **Fixed costs & weekly income guide** — monthly fixed-cost items drive two numbers:
  left-over money (income − fixed costs − variable spending) and the weekly income needed to
  cover both fixed costs and card targets: **(fixed costs + card targets) ÷ 4.33**.
- **Backup** — export and restore everything as one JSON file.
- **Setup link** — `#setup=<base64url JSON>` seeds categories, fixed-cost items, and cards in
  one tap on a fresh install. The payload is applied locally, wiped from the address bar right
  away, and is never part of this repository.

## Run locally

Any static server works:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Test

```sh
python3 tools/run-tests.py     # core logic in quickjs
# or open tests/test.html in a browser
```

## Deploy

GitHub Pages serves the `main` branch root. No build step, no dependencies. `.nojekyll` keeps
the folder untouched.

## Notes

- Records are per browser profile: clearing site data or uninstalling the app deletes them, so
  keep a JSON backup before switching phones.
- A “month” follows the device clock; the calendar and totals use local dates.
- Fixed costs are a monthly commitment entered in Settings. Don’t also record the same payment
  as a spending entry, or the left-over figure counts it twice.
- The service worker caches the app shell. After changing files, bump the `?v=` numbers in
  `index.html` and `sw.js` (and `CACHE`) so installed phones pick up the new version.
- Icons are generated with `python3 tools/make-icons.py` (Pillow).
