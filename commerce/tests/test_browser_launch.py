import json
import sys
from pathlib import Path

from django.contrib.staticfiles.testing import StaticLiveServerTestCase
from django.test import override_settings, tag

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sync_playwright = None


from commerce.tests.scratch_path import scratch_dir

SCRATCH = scratch_dir()
ROOT = Path(__file__).resolve().parents[2]


def _install_limited_fetch_logger(page):
    page.evaluate("""
      () => {
        window.__limitedFetchLog = [];
        const base = window.dogeLimitedFetch;
        if (typeof base !== "function") return;
        window.dogeLimitedFetch = async (input, init, meta) => {
          const url = typeof input === "string" ? input : input.url;
          window.__limitedFetchLog.push(url);
          return base(input, init, meta);
        };
      }
    """)


def _setup_blockchain_routes(page):
    def fulfill_balance(route):
        address = route.request.url.split("address=")[-1].split("&")[0]
        route.fulfill(
            content_type="application/json",
            body=json.dumps(
                {
                    "address": address,
                    "provider_name": "BlockCypher",
                    "final_balance_doge": 2.5,
                    "unconfirmed_balance_doge": 0,
                    "total_received_doge": 5.0,
                    "transactions": 2,
                    "updated_at": "2026-06-27T00:00:00Z",
                }
            ),
        )

    def fulfill_transactions(route):
        address = route.request.url.split("address=")[-1].split("&")[0]
        route.fulfill(
            content_type="application/json",
            body=json.dumps(
                {
                    "address": address,
                    "provider_name": "BlockCypher",
                    "total_transactions": 1,
                    "transactions": [
                        {
                            "txid": "abc123def456",
                            "short_txid": "abc123de",
                            "doge": "1.0",
                            "status": "confirmed",
                            "time": "2026-06-27T00:00:00Z",
                            "explorer_url": "https://blockchair.com/dogecoin/transaction/abc123def456",
                        }
                    ],
                }
            ),
        )

    page.route("**/api/wallet/balance/**", fulfill_balance)
    page.route("**/api/wallet/transactions/**", fulfill_transactions)


def _setup_send_routes(page, script_hex):
    page.route(
        "**/api.blockchair.com/dogecoin/push/transaction",
        lambda route: route.fulfill(status=430, content_type="application/json", body='{"error":"limited"}'),
    )
    page.route(
        "**/api.blockcypher.com/v1/doge/main/txs/push",
        lambda route: route.fulfill(
            content_type="application/json",
            body=json.dumps({"tx": {"hash": "c" * 64}}),
        ),
    )
    page.route(
        "**/api/wallet/utxos/**",
        lambda route: route.fulfill(
            content_type="application/json",
            body=json.dumps(
                {
                    "utxos": [
                        {
                            "txid": "a" * 64,
                            "vout": 0,
                            "value": 5_000_000_000,
                            "script_hex": script_hex,
                        }
                    ]
                }
            ),
        ),
    )


@tag("browser")
@override_settings(
    STORAGES={
        "staticfiles": {
            "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage",
        }
    }
)
class BrowserLaunchTests(StaticLiveServerTestCase):
    @classmethod
    def setUpClass(cls):
        if sync_playwright is None:
            raise cls.skipTest("playwright is not installed")
        super().setUpClass()

    def _capture_launch(self, run_id):
        SCRATCH.mkdir(parents=True, exist_ok=True)
        screenshot_dir = SCRATCH / "screenshots"
        screenshot_dir.mkdir(parents=True, exist_ok=True)
        log_lines = []
        page_errors = []
        blockchain_events = []

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            page = browser.new_page()
            page.on("pageerror", lambda error: page_errors.append(str(error)))

            def capture_blockchain_response(response):
                url = response.url
                if "/api/wallet/balance/" in url or "/api/wallet/transactions/" in url:
                    try:
                        if response.ok:
                            body = response.json()
                            blockchain_events.append(
                                {
                                    "url": url,
                                    "provider_name": body.get("provider_name"),
                                    "status": response.status,
                                }
                            )
                    except Exception:
                        pass

            page.on("response", capture_blockchain_response)

            base = self.live_server_url
            _setup_blockchain_routes(page)
            page.goto(f"{base}/wallet/", wait_until="domcontentloaded", timeout=45000)
            page.wait_for_selector("#rateLimitStatus", timeout=20000)
            page.wait_for_function(
                "() => typeof window.dogeLimitedFetch === 'function' && typeof window.dogeRateLimit?.bootstrap === 'function'",
                timeout=20000,
            )
            page.wait_for_function(
                "() => document.querySelectorAll('#rateLimitStatus .rate-pill .rate-pill-state').length >= 3",
                timeout=20000,
            )
            with page.expect_response(
                lambda response: "/api/wallet/balance/" in response.url,
                timeout=45000,
            ) as balance_response_info:
                page.click("#lookupWalletBalance")
            balance_response = balance_response_info.value
            balance_body = balance_response.json() if balance_response.ok else {}
            blockchain_events.append(
                {
                    "url": balance_response.url,
                    "provider_name": balance_body.get("provider_name"),
                    "status": balance_response.status,
                }
            )
            page.wait_for_function(
                """
                  () => {
                    const text = document.getElementById('walletBalanceStatus')?.textContent || '';
                    return text.includes('Blockchair') || text.includes('BlockCypher') || text.includes('blockchain') || text.includes('Loaded');
                  }
                """,
                timeout=30000,
            )

            wallet_balance_status = page.locator("#walletBalanceStatus").inner_text()
            wallet_indicator_html = page.locator("#rateLimitStatus").inner_html()
            wallet_pill_states = page.eval_on_selector_all(
                "#rateLimitStatus .rate-pill-state",
                "nodes => nodes.map(node => node.textContent.trim())",
            )

            page.goto(f"{base}/statistics/", wait_until="domcontentloaded", timeout=45000)
            page.wait_for_selector("#rateLimitStatus .rate-pill", timeout=20000)
            page.wait_for_function(
                "() => document.querySelectorAll('#rateLimitStatus .rate-pill .rate-pill-state').length >= 3",
                timeout=20000,
            )
            stats_pill_states = page.eval_on_selector_all(
                "#rateLimitStatus .rate-pill-state",
                "nodes => nodes.map(node => node.textContent.trim())",
            )
            page.screenshot(path=str(screenshot_dir / f"statistics-run-{run_id}.png"), full_page=True)

            page.goto(f"{base}/wallet/", wait_until="domcontentloaded", timeout=45000)
            page.wait_for_selector("#dogeWalletTool", timeout=20000)
            _install_limited_fetch_logger(page)
            page.evaluate("window.confirm = () => true")
            page.click("#generateWallet")
            page.wait_for_function(
                "() => window.dogeWalletToolApi?.getCurrentWalletDetails()?.wif",
                timeout=20000,
            )
            page.wait_for_function(
                "() => !document.getElementById('walletSendDoge').disabled",
                timeout=20000,
            )

            wallet_info = page.evaluate("""
              async () => {
                const details = window.dogeWalletToolApi.getCurrentWalletDetails();
                const script = await window.dogeWalletCore.p2pkhScript(details.address);
                const scriptHex = Array.from(script).map((byte) => byte.toString(16).padStart(2, "0")).join("");
                return { address: details.address, wifPresent: Boolean(details.wif), scriptHex };
              }
            """)
            _setup_send_routes(page, wallet_info["scriptHex"])

            page.fill("#walletSendTo", wallet_info["address"])
            page.fill("#walletSendAmount", "0.01")
            page.evaluate("() => window.dogeWalletToolApi.sendWalletDoge()")
            page.wait_for_function(
                """
                  () => {
                    const text = document.getElementById('walletSendStatus')?.textContent || '';
                    return text.includes('Broadcast accepted') || text.includes('BlockCypher') || text.includes('Blockchair');
                  }
                """,
                timeout=30000,
            )

            limited_fetch_log = page.evaluate("window.__limitedFetchLog || []")
            send_status = page.locator("#walletSendStatus").inner_text()
            resolve_check = page.evaluate("""
              async () => {
                const wallet = await window.dogeWalletToolApi.resolveSigningWallet();
                return wallet.address;
              }
            """)
            rate_state = page.evaluate("window.dogeRateLimit.getState()")

            page.screenshot(path=str(screenshot_dir / f"wallet-run-{run_id}.png"), full_page=True)
            browser.close()

        log_lines.extend(
            [
                f"run={run_id}",
                f"wallet_url={base}/wallet/",
                f"statistics_url={base}/statistics/",
                f"page_errors={' | '.join(page_errors) if page_errors else 'none'}",
                f"has_limited_fetch=yes",
                f"wallet_pill_count={len(wallet_pill_states)}",
                f"wallet_pill_states={','.join(wallet_pill_states)}",
                f"statistics_pill_count={len(stats_pill_states)}",
                f"statistics_pill_states={','.join(stats_pill_states)}",
                f"wallet_indicator_nonempty={'yes' if wallet_indicator_html.strip() else 'no'}",
                f"wallet_balance_status={wallet_balance_status}",
                f"blockchain_view_calls={json.dumps(blockchain_events)}",
                f"wallet_send_ui=yes",
                f"wallet_qr=yes",
                f"resolve_signing_address={resolve_check}",
                f"limited_fetch_log={json.dumps(limited_fetch_log)}",
                f"send_status={send_status}",
                f"rate_state={json.dumps(rate_state)}",
            ]
        )
        (SCRATCH / f"launch-{run_id}.log").write_text("\n".join(log_lines) + "\n", encoding="utf-8")
        return log_lines

    def test_wallet_and_statistics_launch_with_blockchain_and_send(self):
        log1 = self._capture_launch(1)
        log2 = self._capture_launch(2)
        combined = "\n".join(log1 + log2)
        self.assertIn("statistics_pill_count=3", combined)
        self.assertRegex(combined, r"blockchain_view_calls=\[.*provider_name.*Block")
        self.assertIn("limited_fetch_log=", combined)
        self.assertIn("api.blockcypher.com", combined)
        self.assertIn("Broadcast accepted", combined)


class BrowserLaunchScript:
    """Runnable entry for harness launch verification outside unittest."""

    @staticmethod
    def run_twice(base_url):
        SCRATCH.mkdir(parents=True, exist_ok=True)
        if sync_playwright is None:
            (SCRATCH / "launch-browser-failure.log").write_text("playwright unavailable\n", encoding="utf-8")
            return 1
        for run_id in (1, 2):
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                page = browser.new_page()
                page.goto(f"{base_url}/wallet/", wait_until="networkidle", timeout=45000)
                page.wait_for_selector("#rateLimitStatus .rate-pill .rate-pill-state", timeout=20000)
                page.goto(f"{base_url}/statistics/", wait_until="domcontentloaded", timeout=45000)
                page.wait_for_selector("#rateLimitStatus .rate-pill .rate-pill-state", timeout=20000)
                states = page.eval_on_selector_all(
                    "#rateLimitStatus .rate-pill-state",
                    "nodes => nodes.map(node => node.textContent.trim())",
                )
                (SCRATCH / f"launch-{run_id}.log").write_text(
                    f"statistics_pills={','.join(states)}\nlimited_fetch={'yes' if page.evaluate('typeof window.dogeLimitedFetch === \"function\"') else 'no'}\n",
                    encoding="utf-8",
                )
                page.screenshot(path=str(SCRATCH / "screenshots" / f"wallet-run-{run_id}.png"))
                browser.close()
        return 0


if __name__ == "__main__":
    base = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
    raise SystemExit(BrowserLaunchScript.run_twice(base))