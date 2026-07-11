"""Run verification-plan commands and write logs to DOGE2MOON_SCRATCH or ./verify-artifacts."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRATCH = Path(os.environ.get("DOGE2MOON_SCRATCH", ROOT / "verify-artifacts"))


def run(cmd: list[str], log_name: str, cwd: Path = ROOT) -> int:
    SCRATCH.mkdir(parents=True, exist_ok=True)
    log_path = SCRATCH / log_name
    proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    log_path.write_text(proc.stdout + proc.stderr, encoding="utf-8")
    print(f"wrote {log_path} exit={proc.returncode}")
    return proc.returncode


def probe_health() -> tuple[int, str]:
    try:
        with urllib.request.urlopen("http://localhost:42069/health/", timeout=30) as response:
            body = response.read().decode("utf-8")
            return response.status, body
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", errors="ignore")
    except Exception as exc:
        return 0, str(exc)


PAGE_PROBES = {
    "/": ["Make Dogecoin feel normal", "role-path-card"],
    "/wallet/": ["walletManagePanel", "Step 5 — Manage", "lookupWalletBalance"],
    "/pos/": ["Accept Dogecoin for goods priced in dollars", "posConfirmTransaction", "posMarkPaid"],
    "/merchant-kit/": ["toolsMarketplaceHint", "applySavedWalletTools"],
    "/statistics/": ["statsHopiumTitle", "dogeMarketChart"],
}


def probe_pages(base: str = "http://localhost:42069") -> list[str]:
    lines: list[str] = []
    for path, markers in PAGE_PROBES.items():
        url = f"{base}{path}"
        try:
            with urllib.request.urlopen(url, timeout=30) as response:
                html = response.read().decode("utf-8", errors="ignore")
                status = response.status
        except urllib.error.HTTPError as exc:
            html = exc.read().decode("utf-8", errors="ignore")
            status = exc.code
        except Exception as exc:
            lines.append(f"page={path} status=error error={exc}")
            continue
        missing = [marker for marker in markers if marker not in html]
        lines.append(f"page={path} status={status} markers_ok={len(markers) - len(missing)}/{len(markers)}")
        if missing:
            lines.append(f"page={path} missing={','.join(missing)}")
    return lines


def main() -> int:
    failures = 0
    failures |= run([sys.executable, "-m", "pip", "install", "--dry-run", "-r", "requirements.txt"], "pip-requirements.log") != 0

    for index in (1, 2):
        failures |= run(["docker", "compose", "build", "--no-cache"], f"docker-build-{index}.log") != 0

    combined = "\n\n".join(
        f"=== docker-build-{index}.log ===\n{(SCRATCH / f'docker-build-{index}.log').read_text(encoding='utf-8')}"
        for index in (1, 2)
    )
    (SCRATCH / "docker-build.log").write_text(combined, encoding="utf-8")

    local_log = SCRATCH / "local-django-build.log"
    proc = subprocess.run(
        [sys.executable, "manage.py", "check"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    local_output = proc.stdout + proc.stderr
    proc2 = subprocess.run(
        [sys.executable, "manage.py", "collectstatic", "--noinput"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    local_output += proc2.stdout + proc2.stderr
    local_log.write_text(local_output, encoding="utf-8")
    print(f"wrote {local_log} exit={proc.returncode or proc2.returncode}")
    failures |= proc.returncode != 0 or proc2.returncode != 0

    up_lines: list[str] = []
    for run_id in (1, 2):
        up_lines.append(f"=== run={run_id} ===")
        subprocess.run(["docker", "compose", "down"], cwd=ROOT, capture_output=True, text=True)
        up = subprocess.run(["docker", "compose", "up", "-d", "--build"], cwd=ROOT, capture_output=True, text=True)
        up_lines.extend((up.stdout + up.stderr).splitlines())
        time.sleep(8)
        status, body = probe_health()
        up_lines.append(f"health_status={status}")
        up_lines.append(f"health_body={body}")
        up_lines.append("--- page probes ---")
        page_lines = probe_pages()
        up_lines.extend(page_lines)
        if any("missing=" in line for line in page_lines):
            failures |= 1
        if any(line.startswith("page=") and "status=error" in line for line in page_lines):
            failures |= 1
        logs = subprocess.run(["docker", "compose", "logs", "--no-color"], cwd=ROOT, capture_output=True, text=True)
        up_lines.append("--- container logs ---")
        up_lines.extend((logs.stdout + logs.stderr).splitlines())
        down = subprocess.run(["docker", "compose", "down"], cwd=ROOT, capture_output=True, text=True)
        up_lines.extend((down.stdout + down.stderr).splitlines())
        if status != 200 or '"status": "ok"' not in body:
            failures |= 1

    (SCRATCH / "docker-compose-up.log").write_text("\n".join(up_lines) + "\n", encoding="utf-8")
    print(f"wrote {SCRATCH / 'docker-compose-up.log'}")
    return failures


if __name__ == "__main__":
    raise SystemExit(main())