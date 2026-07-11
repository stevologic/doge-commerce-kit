"""Stateful browser flows for wallet handoffs and POS verify-then-record."""
import json
from pathlib import Path

from django.contrib.staticfiles.testing import StaticLiveServerTestCase
from django.test import override_settings, tag

from commerce.tests.scratch_path import scratch_dir

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sync_playwright = None

SCRATCH = scratch_dir()


@tag("browser")
@override_settings(
    STORAGES={
        "staticfiles": {
            "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage",
        }
    }
)
class HumanInteractionFlowTests(StaticLiveServerTestCase):
    @classmethod
    def setUpClass(cls):
        if sync_playwright is None:
            raise cls.skipTest("playwright is not installed")
        super().setUpClass()

    def _write_flow_log(self, name: str, lines: list[str]) -> None:
        SCRATCH.mkdir(parents=True, exist_ok=True)
        (SCRATCH / name).write_text("\n".join(lines) + "\n", encoding="utf-8")

    def test_saved_wallet_handoffs_to_pos_and_tools(self):
        log_lines = []
        base = self.live_server_url
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            page = browser.new_page()
            page.goto(f"{base}/wallet/", wait_until="domcontentloaded", timeout=45000)
            page.wait_for_selector("#generateWallet", timeout=20000)
            page.click("#generateWallet")
            page.wait_for_function(
                "() => window.dogeWalletToolApi?.getCurrentWalletDetails()?.address?.startsWith('D')",
                timeout=20000,
            )
            wallet_address = page.evaluate(
                "() => window.dogeWalletToolApi.getCurrentWalletDetails().address"
            )
            page.click("#saveWalletLocal")
            page.goto(f"{base}/pos/", wait_until="domcontentloaded", timeout=45000)
            page.wait_for_selector("#posWallet", timeout=20000)
            pos_wallet = page.input_value("#posWallet")
            log_lines.append(f"wallet_address={wallet_address}")
            log_lines.append(f"pos_wallet={pos_wallet}")
            self.assertEqual(pos_wallet, wallet_address)

            page.goto(f"{base}/merchant-kit/", wait_until="domcontentloaded", timeout=45000)
            page.wait_for_selector("#toolsSavedWalletOut", timeout=20000)
            tools_wallet = page.locator("#toolsSavedWalletOut").inner_text().strip()
            log_lines.append(f"tools_wallet={tools_wallet}")
            self.assertEqual(tools_wallet, wallet_address)

            donate_value = page.input_value("#donateSnippetAddress")
            log_lines.append(f"donate_snippet_address={donate_value}")
            self.assertEqual(donate_value, wallet_address)
            browser.close()

        log_lines.append("handoff_wallet_to_pos=ok")
        log_lines.append("handoff_wallet_to_tools=ok")
        self._write_flow_log("ux-handoff-flow.log", log_lines)

    def test_pos_verify_then_record_requires_human_clicks(self):
        log_lines = []
        base = self.live_server_url
        sample_tx = "sample-local-test"
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            page = browser.new_page()
            page.goto(f"{base}/wallet/", wait_until="domcontentloaded", timeout=45000)
            page.wait_for_selector("#generateWallet", timeout=20000)
            page.click("#generateWallet")
            page.wait_for_function(
                "() => window.dogeWalletToolApi?.getCurrentWalletDetails()?.address?.startsWith('D')",
                timeout=20000,
            )
            page.click("#saveWalletLocal")
            page.goto(f"{base}/pos/", wait_until="domcontentloaded", timeout=45000)
            page.wait_for_selector("#posSaveOrder", timeout=20000)
            page.wait_for_function(
                """
                  () => {
                    const price = document.getElementById('posPriceOut')?.textContent?.trim() || '';
                    return price && price !== 'Loading';
                  }
                """,
                timeout=45000,
            )
            page.fill("#posUsd", "5.00")
            page.wait_for_function(
                "() => !document.getElementById('posSaveOrder').disabled",
                timeout=20000,
            )
            page.click("#posSaveOrder")
            page.wait_for_function(
                "() => document.getElementById('posSelectedOrder')?.textContent?.includes('DOGE')",
                timeout=20000,
            )
            page.fill("#posTxId", sample_tx)
            page.wait_for_timeout(800)
            status_before = page.locator("#posStatus").inner_text().strip().lower()
            mark_paid_disabled = page.is_disabled("#posMarkPaid")
            log_lines.append(f"status_after_paste={status_before}")
            log_lines.append(f"mark_paid_disabled_after_paste={mark_paid_disabled}")
            self.assertEqual(status_before, "unpaid")
            self.assertTrue(mark_paid_disabled)

            page.click("#posConfirmTransaction")
            page.wait_for_function(
                "() => document.getElementById('posStatus')?.textContent?.trim().toLowerCase() === 'confirmed'",
                timeout=20000,
            )
            page.wait_for_function(
                "() => !document.getElementById('posMarkPaid').disabled",
                timeout=20000,
            )
            page.click("#posMarkPaid")
            page.wait_for_function(
                "() => document.getElementById('posStatus')?.textContent?.trim().toLowerCase() === 'paid'",
                timeout=20000,
            )
            final_status = page.locator("#posStatus").inner_text().strip().lower()
            log_lines.append(f"final_status={final_status}")
            self.assertEqual(final_status, "paid")
            browser.close()

        log_lines.append("pos_sequential_verify_then_mark_paid=ok")
        self._write_flow_log("ux-pos-flow.log", log_lines)