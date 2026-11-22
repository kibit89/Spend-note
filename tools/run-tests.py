#!/usr/bin/env python3
"""Runs tests/core.test.js against core.js in quickjs (no browser needed)."""
import json
import os
import sys

import quickjs

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

with open(os.path.join(ROOT, "core.js"), encoding="utf-8") as f:
    core_js = f.read()
with open(os.path.join(ROOT, "tests", "core.test.js"), encoding="utf-8") as f:
    test_js = f.read()

ctx = quickjs.Context()
ctx.eval(core_js)
ctx.eval(test_js)
report = json.loads(ctx.eval("JSON.stringify(runSpendNoteTests())"))

print("%d assertions, %d failures" % (report["count"], len(report["failures"])))
for failure in report["failures"]:
    print("  FAIL " + failure)

sys.exit(1 if report["failures"] else 0)
