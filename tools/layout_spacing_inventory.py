#!/usr/bin/env python3
r"""layout_spacing_inventory.py

Pure script (no Django) to audit responsive spacing rules per the goal plan.
Run from git root (C:/Users/steph) so 'Desktop/DOGE2MOON/...' paths resolve.

SCOPE is ONLY CSS files (per strategist restructure).
For each CSS, requires:
  - @media (max-width ~700) block mentioning plan primitive selector
  - @media (max-width ~900) block mentioning plan primitive
  - @media (min-width ~1400) or equivalent clamp/container tightening mentioning plan primitive

Primitives: .site-header, main, .panel, .hero, .section-grid, .wallet-workspace-grid, .pos-operator-grid, .tool-card-grid, .playbook-*, .finder-grid, .kit-layout etc.

Prints PASS/FAIL <prefixed-relpath> <reason>
Writes full to $DOGE2MOON_SCRATCH/layout-inventory.log
Exits non-zero on FAIL.

Native prefixed paths only. No HTML, no post-processing, no special cases.
"""

import os
import re
import sys
from pathlib import Path

SCRATCH = Path(os.environ.get("DOGE2MOON_SCRATCH", Path.cwd() / "verify-artifacts"))
SCRATCH.mkdir(parents=True, exist_ok=True)

# Native paths as git sees them (from C:/Users/steph git root).
# SCOPE = CSS files only (no HTML, per strategist).
SCOPE = [
    "Desktop/DOGE2MOON/commerce/static/commerce/css/site.css",
    "Desktop/DOGE2MOON/commerce/static/commerce/css/offramp.css",
    "Desktop/DOGE2MOON/styles.css",
    "Desktop/DOGE2MOON/doge-adoption-launchpad/site/styles.css",
    "Desktop/DOGE2MOON/doge-merchant-accelerator/styles.css",
]

# Selectors we must see inside the matching @media blocks (plan primitives). Include offramp-specific .goal-panel.
PRIMS = r'(?:\.site-header|main|\.panel|\.hero|\.section-grid|\.wallet-workspace-grid|\.pos-operator-grid|\.tool-card-grid|\.playbook-path-grid|\.playbook-guide-grid|\.finder-grid|\.kit-layout|\.goal-panel)'

MOBILE_RE = re.compile(r'@media\s*\([^)]*max-width\s*:\s*(700|460|640|600|480)[^)]*\)[^{]*\{[^}]*' + PRIMS, re.I | re.S)
SMALL_RE  = re.compile(r'@media\s*\([^)]*max-width\s*:\s*(900|980|860|1024)[^)]*\)[^{]*\{[^}]*' + PRIMS, re.I | re.S)
LARGE_RE  = re.compile(r'@media\s*\([^)]*min-width\s*:\s*1400[^)]*\)[^{]*\{[^}]*' + PRIMS + r'|(?:clamp|min-width|width:\s*min\()[^}]*' + PRIMS, re.I | re.S)

def file_content(git_rel: str) -> str:
    # When run from git root C:/Users/steph, prefixed paths resolve.
    fs_path = Path(git_rel)
    if not fs_path.exists():
        alt = Path(r'C:\Users\steph') / git_rel
        fs_path = alt if alt.exists() else fs_path
    if not fs_path.exists():
        return ""
    try:
        return fs_path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""

def check_one(git_rel: str):
    c = file_content(git_rel)
    if not c:
        return True, "N/A (no such file on disk)"
    has_m = bool(MOBILE_RE.search(c))
    has_s = bool(SMALL_RE.search(c))
    has_l = bool(LARGE_RE.search(c))
    missing = []
    if not has_m: missing.append("mobile @media (max-w ~700) containing primitive")
    if not has_s: missing.append("small @media (max-w ~900) containing primitive")
    if not has_l: missing.append("large @media (min-w ~1400) or clamp on primitive")
    if missing:
        return False, "missing " + "; ".join(missing)
    return True, "ok"

def main():
    results = []
    fails = 0
    for rel in SCOPE:
        ok, reason = check_one(rel)
        status = "PASS" if ok else "FAIL"
        line = f"{status} {rel} {reason}"
        results.append(line)
        if not ok:
            fails += 1
        print(line)

    out = "\n".join(results) + "\n"
    (SCRATCH / "layout-inventory.log").write_text(out, encoding="utf-8")
    print(f"\nWrote full log to {SCRATCH / 'layout-inventory.log'}")
    if fails:
        print(f"{fails} FAIL(s)")
        sys.exit(1)
    print("ALL PASS")
    sys.exit(0)

if __name__ == "__main__":
    main()