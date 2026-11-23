#!/usr/bin/env python3
"""Turn a JSON payload file into a Spend Note link.

    python3 tools/make-link.py payload.json                  # -> #setup=...
    python3 tools/make-link.py entries.json --kind add       # -> #add=...
    python3 tools/make-link.py entries.json --kind batch --base http://localhost:8000/

The payload is only read and encoded here; this script writes nothing and the
repository never holds the data itself.
"""
import argparse
import base64
import json
import sys

DEFAULT_BASE = "https://kibit89.github.io/Spend-note/"


def b64url(payload):
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("payload", help="JSON file with a setup object or an entry object/array")
    ap.add_argument("--kind", choices=["setup", "add", "batch"], default="setup")
    ap.add_argument("--base", default=DEFAULT_BASE, help="site root (default: the GitHub Pages site)")
    args = ap.parse_args()

    with open(args.payload, encoding="utf-8") as f:
        data = json.load(f)

    if args.kind in ("add", "batch") and isinstance(data, list):
        data = {"e": data}

    base = args.base.rstrip("/") + "/"
    print(base + "#" + args.kind + "=" + b64url(data))


if __name__ == "__main__":
    sys.exit(main())
