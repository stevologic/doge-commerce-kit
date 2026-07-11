import json
from pathlib import Path

from django.contrib.staticfiles.testing import StaticLiveServerTestCase
from django.test import SimpleTestCase, override_settings, tag
from py_mini_racer import MiniRacer

from commerce.tests.crypto_polyfill import CRYPTO_POLYFILL
from commerce.tests.test_browser_launch import (
    _install_limited_fetch_logger,
    _setup_blockchain_routes,
    _setup_send_routes,
)

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sync_playwright = None


ROOT = Path(__file__).resolve().parents[1]
from commerce.tests.scratch_path import scratch_dir

SCRATCH = scratch_dir()
CORE_JS = ROOT / "static" / "commerce" / "js" / "wallet_core.js"


class SendWalletCoreTests(SimpleTestCase):
    def _core_runtime(self):
        ctx = MiniRacer()
        ctx.eval(CRYPTO_POLYFILL + CORE_JS.read_text(encoding="utf-8"))
        return ctx

    def test_load_and_send_paths_derive_same_address(self):
        ctx = self._core_runtime()
        result = json.loads(
            ctx.eval("""
              (async () => {
                const generated = await window.dogeWalletCore.generateWallet();
                const loaded = await window.dogeWalletCore.walletFromWif(generated.wif);
                const sendPath = await window.dogeWalletCore.walletFromWif(generated.wif);
                return JSON.stringify({
                  generated: generated.address,
                  loaded: loaded.address,
                  sendPath: sendPath.address,
                  publicKeyMatch: loaded.public_key === sendPath.public_key,
                });
              })()
            """).get(timeout=30)
        )
        self.assertEqual(result["generated"], result["loaded"])
        self.assertEqual(result["loaded"], result["sendPath"])
        self.assertTrue(result["publicKeyMatch"])


@tag("browser")
@override_settings(
    STORAGES={
        "staticfiles": {
            "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage",
        }
    }
)
class SendWalletBrowserTests(StaticLiveServerTestCase):
    @classmethod
    def setUpClass(cls):
        if sync_playwright is None:
            raise cls.skipTest("playwright is not installed")
        super().setUpClass()

    def test_real_page_load_inspect_resolve_and_send_wallet_doge(self):
        SCRATCH.mkdir(parents=True, exist_ok=True)
        evidence = {}

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            page = browser.new_page()
            _setup_blockchain_routes(page)
            page.goto(f"{self.live_server_url}/wallet/", wait_until="domcontentloaded", timeout=45000)
            page.wait_for_selector("#dogeWalletTool", timeout=20000)
            page.wait_for_function(
                "() => typeof window.dogeWalletToolApi?.inspectWalletWif === 'function'",
                timeout=20000,
            )

            page.click("#generateWallet")
            page.wait_for_function(
                "() => window.dogeWalletToolApi.getCurrentWalletDetails()?.wif",
                timeout=20000,
            )

            generated = page.evaluate("""
              () => {
                const wif = document.getElementById('walletWif').value;
                const address = document.getElementById('walletPublicAddress').value;
                return { wif, address };
              }
            """)
            self.assertTrue(generated["wif"])
            self.assertTrue(generated["address"].startswith("D"))

            page.click("#loadWalletWif")
            inspect_details = page.evaluate("window.dogeWalletToolApi.getCurrentWalletDetails()")
            self.assertEqual(inspect_details["address"], generated["address"])
            self.assertTrue(inspect_details.get("wif"))

            page.evaluate("document.getElementById('walletWif').value = ''")
            resolve_address = page.evaluate("""
              async () => {
                const wallet = await window.dogeWalletToolApi.resolveSigningWallet();
                return wallet.address;
              }
            """)
            self.assertEqual(resolve_address, generated["address"])

            wallet_info = page.evaluate("""
              async () => {
                const details = window.dogeWalletToolApi.getCurrentWalletDetails();
                const script = await window.dogeWalletCore.p2pkhScript(details.address);
                const scriptHex = Array.from(script).map((byte) => byte.toString(16).padStart(2, "0")).join("");
                return { address: details.address, scriptHex };
              }
            """)
            _install_limited_fetch_logger(page)
            _setup_send_routes(page, wallet_info["scriptHex"])
            page.evaluate("window.confirm = () => true")
            page.fill("#walletSendTo", wallet_info["address"])
            page.fill("#walletSendAmount", "0.01")
            page.evaluate("() => window.dogeWalletToolApi.sendWalletDoge()")
            page.wait_for_function(
                """
                  () => {
                    const text = document.getElementById('walletSendStatus')?.textContent || '';
                    return text.includes('Broadcast accepted');
                  }
                """,
                timeout=30000,
            )

            limited_log = page.evaluate("window.__limitedFetchLog || []")
            send_status = page.locator("#walletSendStatus").inner_text()
            browser.close()

        evidence = {
            "generated_address": generated["address"],
            "inspect_address": inspect_details["address"],
            "resolve_address": resolve_address,
            "limited_fetch_log": limited_log,
            "send_status": send_status,
            "utxos_called": any("/api/wallet/utxos/" in url for url in limited_log),
            "broadcast_used_limited_fetch": any("blockcypher.com" in url for url in limited_log),
        }
        lines = [f"{key}={value}" for key, value in evidence.items()]
        (SCRATCH / "wallet-send-flow.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")

        self.assertIn("Broadcast accepted", send_status)
        self.assertTrue(any("blockcypher.com" in url for url in limited_log))
        self.assertTrue(evidence["utxos_called"])
        self.assertEqual(inspect_details["address"], generated["address"])