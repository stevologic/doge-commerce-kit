"""Capture human-centric page excerpts for UX verification."""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

import django
from django.test import Client, override_settings


ROOT = Path(__file__).resolve().parents[1]
SCRATCH = Path(os.environ.get("DOGE2MOON_SCRATCH", ROOT / "verify-artifacts"))

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


PAGES = {
    "home": "/",
    "wallet": "/wallet/",
    "pos_terminal": "/pos/",
    "merchant_kit": "/merchant-kit/",
    "statistics": "/statistics/",
    "playbook": "/playbook/",
    "faq": "/faq/",
    "technical_details": "/technical-details/",
}

SECTION_MARKERS = {
    "wallet": [
        "walletHandoffNote",
        "Step 5 — Manage",
        "walletManagePanel",
        "saveWalletLocal",
        "downloadWalletDetails",
    ],
    "pos_terminal": [
        "Accept Dogecoin for goods priced in dollars",
        "Verify before fulfillment",
        "posConfirmTransaction",
        "posMarkPaid",
        "posSaveOrder",
    ],
    "merchant_kit": [
        "toolsMarketplaceHint",
        "toolsSavedWalletOut",
        "applySavedWalletTools",
        "Browse all",
    ],
    "statistics": [
        "statsHopiumTitle",
        "dogeMarketChart",
    ],
    "playbook": [
        "playbookBenefitsTitle",
        "Why humans choose DOGE",
    ],
    "faq": [
        "Open wallet",
        "Browse snippets",
    ],
    "technical_details": [
        "technicalHumanPathTitle",
        "Snippet marketplace",
    ],
    "home": [
        "role-path-card",
        "Make Dogecoin feel normal",
    ],
}


def _extract_headings(html: str, limit: int = 6) -> list[str]:
    headings = re.findall(r"<h[12][^>]*>(.*?)</h[12]>", html, flags=re.I | re.S)
    cleaned = [re.sub(r"<[^>]+>", "", item).strip() for item in headings]
    return [item for item in cleaned if item][:limit]


def _extract_ctas(html: str, limit: int = 8) -> list[str]:
    buttons = re.findall(
        r'<(?:button|a)[^>]*class="[^"]*button[^"]*"[^>]*>(.*?)</(?:button|a)>',
        html,
        flags=re.I | re.S,
    )
    cleaned = [re.sub(r"<[^>]+>", "", item).strip() for item in buttons]
    return [item for item in cleaned if item][:limit]


def _extract_notes(html: str, limit: int = 4) -> list[str]:
    notes = re.findall(
        r'<p[^>]*class="[^"]*note[^"]*"[^>]*>(.*?)</p>',
        html,
        flags=re.I | re.S,
    )
    cleaned = [re.sub(r"<[^>]+>", "", item).strip() for item in notes]
    return [item for item in cleaned if item][:limit]


def capture_pages() -> int:
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "doge2moon.settings")
    django.setup()
    SCRATCH.mkdir(parents=True, exist_ok=True)
    lines: list[str] = []
    failures = 0
    with override_settings(ALLOWED_HOSTS=["testserver", "localhost", "127.0.0.1"]):
        client = Client()
        for name, path in PAGES.items():
            response = client.get(path)
            html = response.content.decode("utf-8", errors="ignore")
            title_start = html.find("<h1")
            title_end = html.find("</h1>", title_start)
            title = html[title_start:title_end + 5] if title_start >= 0 else "(no h1)"
            lines.append(f"=== {name} status={response.status_code} path={path} ===")
            lines.append(f"h1: {re.sub(r'<[^>]+>', '', title).strip()}")
            lines.append("headings:")
            for heading in _extract_headings(html):
                lines.append(f"  - {heading}")
            lines.append("notes:")
            for note in _extract_notes(html):
                lines.append(f"  - {note[:180]}")
            lines.append("ctas:")
            for cta in _extract_ctas(html):
                lines.append(f"  - {cta}")
            markers = SECTION_MARKERS.get(name, [])
            missing = [marker for marker in markers if marker not in html]
            lines.append(f"markers_present={len(markers) - len(missing)}/{len(markers)}")
            if missing:
                lines.append(f"markers_missing={','.join(missing)}")
                failures |= 1
            if response.status_code != 200:
                failures |= 1
            lines.append("")
    (SCRATCH / "ux-pages.log").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {SCRATCH / 'ux-pages.log'} failures={failures}")
    return failures


def capture_unit_tests() -> int:
    SCRATCH.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        [
            sys.executable,
            "manage.py",
            "test",
            "commerce.tests.test_ux_pages",
            "commerce.tests.test_wallet_templates",
            "commerce.tests.test_wallet_logic",
            "commerce.tests.test_send_wallet",
            "-v",
            "2",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        env={**os.environ, "DOGE2MOON_SCRATCH": str(SCRATCH)},
    )
    output = proc.stdout + proc.stderr
    (SCRATCH / "ux-unit-tests.log").write_text(output, encoding="utf-8")
    print(f"wrote {SCRATCH / 'ux-unit-tests.log'} exit={proc.returncode}")
    return proc.returncode


def capture_launch_tests() -> int:
    SCRATCH.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        [
            sys.executable,
            "manage.py",
            "test",
            "commerce.tests.test_browser_launch",
            "commerce.tests.test_ux_flows",
            "-v",
            "2",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        env={**os.environ, "DOGE2MOON_SCRATCH": str(SCRATCH)},
    )
    output = proc.stdout + proc.stderr
    (SCRATCH / "ux-launch.log").write_text(output, encoding="utf-8")
    launch_extras: list[str] = []
    for pattern in ("launch-1.log", "launch-2.log", "ux-handoff-flow.log", "ux-pos-flow.log"):
        path = SCRATCH / pattern
        if path.exists():
            launch_extras.append(f"--- {pattern} ---")
            launch_extras.append(path.read_text(encoding="utf-8").strip())
    if launch_extras:
        (SCRATCH / "ux-launch.log").write_text(
            output + "\n\n" + "\n".join(launch_extras) + "\n",
            encoding="utf-8",
        )
    print(f"wrote {SCRATCH / 'ux-launch.log'} exit={proc.returncode}")
    return proc.returncode


def main() -> int:
    failures = 0
    failures |= capture_pages()
    failures |= capture_unit_tests()
    failures |= capture_launch_tests()
    return failures


if __name__ == "__main__":
    raise SystemExit(main())