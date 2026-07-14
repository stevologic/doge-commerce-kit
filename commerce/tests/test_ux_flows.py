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
            page.goto(f"{base}/pos/", wait_until="domcontentloaded", timeout=45000)
            page.wait_for_selector("#posGenerateWallet", timeout=20000)
            page.click("#posGenerateWallet")
            page.wait_for_function(
                "() => document.getElementById('posWallet')?.value?.startsWith('D')",
                timeout=20000,
            )
            wallet_address = page.input_value("#posWallet")
            backup_shown = page.evaluate("() => !document.getElementById('posNewWallet').hidden")
            wif_shown = page.evaluate("() => document.getElementById('posNewWalletWif').textContent")
            log_lines.append(f"wallet_address={wallet_address}")
            log_lines.append(f"backup_panel_shown={backup_shown}")
            self.assertTrue(backup_shown)
            self.assertTrue(wif_shown.startswith("Q") or len(wif_shown) > 40)

            page.goto(f"{base}/pos/", wait_until="domcontentloaded", timeout=45000)
            # The profile disclosure collapses once a wallet is saved, so wait
            # for attachment rather than visibility.
            page.wait_for_selector("#posWallet", state="attached", timeout=20000)
            pos_wallet = page.input_value("#posWallet")
            log_lines.append(f"pos_wallet_after_reload={pos_wallet}")
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

    def test_pos_mobile_checkout_is_a_compact_swipeable_counter_flow(self):
        base = self.live_server_url
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 390, "height": 844})
            page.route(
                "**/products/DOGE-USD/ticker",
                lambda route: route.fulfill(
                    status=200,
                    content_type="application/json",
                    body=json.dumps({"price": "0.125"}),
                ),
            )
            page.route(
                "**/api/wallet/transactions/**",
                lambda route: route.fulfill(
                    status=200,
                    content_type="application/json",
                    body=json.dumps({"transactions": [], "provider_name": "test chain"}),
                ),
            )
            page.goto(f"{base}/pos/", wait_until="domcontentloaded", timeout=45000)
            page.click("#posGenerateWallet")
            page.wait_for_function(
                "() => document.getElementById('posWallet')?.value?.startsWith('D')",
                timeout=20000,
            )
            page.click("#posDismissNewWallet")
            page.wait_for_selector("#posWalletSetup.is-collapsed", timeout=20000)
            page.wait_for_function("() => window.scrollY < 5", timeout=5000)

            layout = page.evaluate(
                """() => {
                  const workflow = document.getElementById('posWorkflow');
                  const panels = [...workflow.querySelectorAll('[data-pos-panel]')];
                  const style = getComputedStyle(workflow);
                  return {
                    display: style.display,
                    scrollSnapType: style.scrollSnapType,
                    workflowWidth: workflow.getBoundingClientRect().width,
                    workflowHeight: workflow.getBoundingClientRect().height,
                    workflowBottom: workflow.getBoundingClientRect().bottom,
                    panelWidths: panels.map((panel) => panel.getBoundingClientRect().width),
                    panelsMounted: panels.every((panel) => !panel.hidden),
                    progressPosition: getComputedStyle(document.getElementById('posProgress')).position,
                    heroDisplay: getComputedStyle(document.querySelector('.pos-hero-slim')).display,
                    walletHeight: document.getElementById('posWalletSetup').getBoundingClientRect().height,
                    documentWidth: document.documentElement.scrollWidth,
                    viewportWidth: window.innerWidth,
                    viewportHeight: window.innerHeight,
                  };
                }"""
            )
            self.assertEqual(layout["display"], "flex")
            self.assertIn("x mandatory", layout["scrollSnapType"])
            self.assertEqual(layout["progressPosition"], "sticky")
            self.assertEqual(layout["heroDisplay"], "none")
            self.assertTrue(layout["panelsMounted"])
            self.assertLess(layout["walletHeight"], 60)
            self.assertGreater(layout["workflowHeight"], 400)
            self.assertLessEqual(layout["workflowBottom"], layout["viewportHeight"] + 1)
            self.assertLessEqual(layout["documentWidth"], layout["viewportWidth"] + 1)
            for panel_width in layout["panelWidths"]:
                self.assertAlmostEqual(panel_width, layout["workflowWidth"], delta=2)

            page.click('[data-pos-amount="5"]')
            self.assertEqual(page.input_value("#posUsd"), "5.00")
            page.click('[data-pos-go="2"]')
            page.wait_for_function(
                "() => document.getElementById('posWorkflow').scrollLeft > 250",
                timeout=5000,
            )
            self.assertEqual(page.locator("#posWorkflow").get_attribute("data-pos-stage"), "2")
            page.click('[data-pos-go="3"]')
            page.wait_for_function(
                "() => document.getElementById('posWorkflow').scrollLeft > 500",
                timeout=5000,
            )
            self.assertEqual(page.locator("#posWorkflow").get_attribute("data-pos-stage"), "3")
            page.click('[data-pos-go="1"]')
            page.wait_for_function(
                "() => document.getElementById('posWorkflow').scrollLeft < 10",
                timeout=5000,
            )

            page.wait_for_function(
                "() => !document.getElementById('posStartPayment').disabled",
                timeout=20000,
            )
            page.click("#posStartPayment")
            page.wait_for_function(
                "() => document.getElementById('posWorkflow')?.dataset.posStage === '2'",
                timeout=20000,
            )
            customer_display = page.evaluate(
                """() => {
                  const modal = document.querySelector('.customer-display');
                  const rect = modal.getBoundingClientRect();
                  return { width: rect.width, height: rect.height, viewportHeight: innerHeight };
                }"""
            )
            self.assertAlmostEqual(customer_display["width"], 390, delta=1)
            self.assertAlmostEqual(customer_display["height"], customer_display["viewportHeight"], delta=1)
            browser.close()

    def test_pos_reload_resumes_every_unfinished_payment(self):
        base = self.live_server_url
        wallet_calls = {"count": 0}
        wallet = "DTW2M5oEW97WbmYJRM71qD7uE6xfJs1MUK"
        started_at = "2099-01-01T00:00:00Z"
        orders = [
            {
                "id": "selected-sale",
                "merchant": "DOGE Merchant",
                "wallet": wallet,
                "usd": 5,
                "doge": 40,
                "memo": "Selected sale",
                "status": "unpaid",
                "payment_started_at": started_at,
                "baseline_ready": True,
            },
            {
                "id": "background-sale",
                "merchant": "DOGE Merchant",
                "wallet": wallet,
                "usd": 7,
                "doge": 56,
                "memo": "Background sale",
                "status": "unpaid",
                "payment_started_at": started_at,
                "baseline_ready": True,
            },
        ]

        def wallet_transactions(route):
            wallet_calls["count"] += 1
            route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps({"transactions": [], "provider_name": "test chain"}),
            )

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            page = browser.new_page()
            page.add_init_script(
                f"""
                  localStorage.setItem('doge-pos:orders', JSON.stringify({json.dumps(orders)}));
                  localStorage.setItem('doge-pos:selected-order', 'selected-sale');
                """
            )
            page.route("**/api/wallet/transactions/**", wallet_transactions)
            page.goto(f"{base}/pos/", wait_until="domcontentloaded", timeout=45000)
            for _ in range(20):
                if wallet_calls["count"] >= 2:
                    break
                page.wait_for_timeout(100)
            self.assertGreaterEqual(wallet_calls["count"], 2)
            self.assertEqual(
                page.evaluate("localStorage.getItem('doge-pos:selected-order')"),
                "selected-sale",
            )
            browser.close()

    def test_pos_initiate_then_manual_verify_requires_human_confirmation(self):
        log_lines = []
        base = self.live_server_url
        sample_tx = "sample-local-test"
        mismatch_tx = "f" * 64
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            page = browser.new_page()
            page.route(
                "**/api/wallet/transactions/**",
                lambda route: route.fulfill(
                    status=200,
                    content_type="application/json",
                    body=json.dumps({"transactions": [], "provider_name": "test chain"}),
                ),
            )
            page.route(
                "**/api/transaction/validate/",
                lambda route: route.fulfill(
                    status=200,
                    content_type="application/json",
                    body=json.dumps({
                        "passed": False,
                        "txid": mismatch_tx,
                        "confirmations": 8,
                        "errors": ["Transaction amount did not match this sale."],
                    }),
                ),
            )
            page.goto(f"{base}/pos/", wait_until="domcontentloaded", timeout=45000)
            page.wait_for_selector("#posGenerateWallet", timeout=20000)
            page.click("#posGenerateWallet")
            page.wait_for_function(
                "() => document.getElementById('posWallet')?.value?.startsWith('D')",
                timeout=20000,
            )
            page.wait_for_function(
                "() => !document.getElementById('posStartPayment').disabled",
                timeout=20000,
            )
            page.click("#posStartPayment")
            self.assertEqual(page.locator("#posWorkflow").get_attribute("data-pos-stage"), "1")
            self.assertIn("Back up the new wallet key", page.locator("#posFlowNotice").inner_text())
            page.click("#posDismissNewWallet")
            page.wait_for_selector("#posStartPayment", state="visible", timeout=20000)
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
                "() => !document.getElementById('posStartPayment').disabled",
                timeout=20000,
            )
            self.assertFalse(page.is_disabled('[data-pos-go="2"]'))
            self.assertFalse(page.is_disabled('[data-pos-go="3"]'))
            page.click('[data-pos-go="2"]')
            self.assertTrue(page.is_visible("#posStep2Empty"))
            self.assertTrue(page.is_hidden("#posPaymentDetails"))
            page.click('[data-pos-go="3"]')
            self.assertTrue(page.is_visible("#posStep3Empty"))
            self.assertTrue(page.is_hidden("#posManualDetails"))
            page.click("#posStep3StartSale")
            self.assertEqual(page.locator("#posWorkflow").get_attribute("data-pos-stage"), "1")
            page.click("#posStartPayment")
            page.wait_for_function(
                "() => document.getElementById('posWorkflow')?.dataset.posStage === '2'",
                timeout=20000,
            )
            page.click("#closePosCustomerDisplay")
            page.click('[data-pos-go="1"]')
            for selector in ("#posUsd", "#posMemo", "#posMerchant", "#posWallet", "#posUseWallet", "#posGenerateWallet"):
                self.assertTrue(page.is_disabled(selector), selector)
            self.assertFalse(page.is_disabled("#posChangeWallet"))
            page.click("#posChangeWallet")
            self.assertIn("locked to this payment request", page.locator("#posFlowNotice").inner_text())
            background_order_id = page.evaluate("localStorage.getItem('doge-pos:selected-order')")
            page.click("#posEditSale")
            for selector in ("#posUsd", "#posMemo", "#posMerchant", "#posWallet", "#posUseWallet", "#posGenerateWallet"):
                self.assertFalse(page.is_disabled(selector), selector)
            page.press("#posUsd", "Enter")
            page.wait_for_function(
                "() => document.getElementById('posWorkflow')?.dataset.posStage === '2'",
                timeout=20000,
            )
            page.click("#closePosCustomerDisplay")
            page.click('[data-pos-go="1"]')
            self.assertEqual(page.locator("#posWorkflow").get_attribute("data-pos-stage"), "1")
            self.assertTrue(page.is_disabled("#posUsd"))
            active_order_id = page.evaluate("localStorage.getItem('doge-pos:selected-order')")
            page.click(".pos-history-details > summary")
            background_load = page.locator(f'[data-pos-load="{background_order_id}"]')
            self.assertEqual(background_load.count(), 1)
            background_load.click()
            self.assertEqual(page.evaluate("localStorage.getItem('doge-pos:selected-order')"), active_order_id)
            self.assertIn("still being monitored", page.locator("#posHistoryNotice").inner_text())
            background_status = page.evaluate(
                """(id) => (JSON.parse(localStorage.getItem('doge-pos:orders') || '[]').find((order) => order.id === id) || {}).status""",
                background_order_id,
            )
            self.assertEqual(background_status, "unpaid")
            page.click('[data-pos-go="3"]')
            self.assertEqual(page.locator("#posWorkflow").get_attribute("data-pos-stage"), "3")
            self.assertFalse(page.locator("#posManualDetails").get_attribute("open") is not None)
            page.click("#posBackToScan")
            self.assertEqual(page.locator("#posWorkflow").get_attribute("data-pos-stage"), "2")
            page.click("#posTroubleDetails summary")
            page.click("#posStep2ManualVerify")
            page.fill("#posTxId", mismatch_tx)
            page.click("#posConfirmTransaction")
            page.wait_for_function(
                "() => document.getElementById('posStatus')?.textContent?.trim().toLowerCase() === 'needs review'",
                timeout=20000,
            )
            selected_after_mismatch = page.evaluate(
                """() => {
                  const id = localStorage.getItem('doge-pos:selected-order');
                  const orders = JSON.parse(localStorage.getItem('doge-pos:orders') || '[]');
                  return orders.find((order) => order.id === id) || null;
                }"""
            )
            self.assertEqual(selected_after_mismatch.get("txid"), "")
            self.assertFalse(page.locator("#posSaleOptions").get_attribute("hidden") is not None)
            self.assertTrue(page.is_visible("#posAbandonPayment"))
            page.fill("#posTxId", sample_tx)
            page.wait_for_timeout(800)
            status_before = page.locator("#posStatus").inner_text().strip().lower()
            mark_paid_disabled = page.is_disabled("#posMarkPaid")
            log_lines.append(f"status_after_paste={status_before}")
            log_lines.append(f"mark_paid_disabled_after_paste={mark_paid_disabled}")
            self.assertEqual(status_before, "needs review")
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
            rich_receipt_visible = page.locator("#posPaidReceipt [data-pos-receipt-card]").is_visible()
            log_lines.append(f"final_status={final_status}")
            log_lines.append(f"rich_receipt_visible={rich_receipt_visible}")
            self.assertEqual(final_status, "paid")
            self.assertTrue(rich_receipt_visible)
            page.click('[data-pos-go="1"]')
            self.assertFalse(page.is_disabled("#posUsd"))
            self.assertFalse(page.is_disabled("#posMemo"))
            self.assertEqual(page.locator("#posStartPayment").inner_text(), "Start payment")
            self.assertEqual(page.locator("#posWorkflow").get_attribute("data-pos-stage"), "1")
            self.assertIsNone(page.locator("#posManualDetails").get_attribute("open"))
            browser.close()

        log_lines.append("pos_sequential_verify_then_mark_paid=ok")
        self._write_flow_log("ux-pos-flow.log", log_lines)

    def test_pos_automatic_detection_closes_qr_and_finishes_receipt(self):
        base = self.live_server_url
        txid = "a" * 64
        wallet_calls = {"count": 0}
        expected = {"doge": 0.0}

        def wallet_transactions(route):
            wallet_calls["count"] += 1
            transactions = []
            if wallet_calls["count"] >= 2:
                transactions = [{
                    "txid": txid,
                    "doge": expected["doge"],
                    "time": "2099-01-01T00:00:00Z",
                    "confirmations": 1,
                    "status": "confirmed",
                    "source": "browser test",
                }]
            route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps({"transactions": transactions, "provider_name": "test chain"}),
            )

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            page = browser.new_page()
            page.route("**/api/wallet/transactions/**", wallet_transactions)
            page.route(
                "**/api/transaction/validate/",
                lambda route: route.fulfill(
                    status=200,
                    content_type="application/json",
                    body=json.dumps({
                        "passed": True,
                        "txid": txid,
                        "matched_doge": expected["doge"],
                        "confirmations": 1,
                        "errors": [],
                        "source": "browser test",
                    }),
                ),
            )
            page.goto(f"{base}/pos/", wait_until="domcontentloaded", timeout=45000)
            page.click("#posGenerateWallet")
            page.wait_for_function(
                "() => document.getElementById('posWallet')?.value?.startsWith('D')",
                timeout=20000,
            )
            page.click("#posDismissNewWallet")
            page.fill("#posUsd", "2.00")
            page.wait_for_function(
                "() => Number.parseFloat(document.getElementById('posTotalDogeOut')?.textContent || '0') > 0",
                timeout=20000,
            )
            expected["doge"] = page.evaluate(
                "Number.parseFloat(document.getElementById('posTotalDogeOut').textContent)"
            )
            page.click("#posStartPayment")
            page.wait_for_function(
                "() => document.getElementById('posStatus')?.textContent?.trim().toLowerCase() === 'paid'",
                timeout=20000,
            )
            self.assertEqual(page.locator("#posWorkflow").get_attribute("data-pos-stage"), "3")
            self.assertTrue(page.is_hidden("#posQrButton"))
            self.assertIsNone(page.locator("#posPaymentClosedMessage").get_attribute("hidden"))
            self.assertTrue(page.locator("#posPaidReceipt [data-pos-receipt-card]").is_visible())
            page.click('[data-pos-go="1"]')
            self.assertFalse(page.is_disabled("#posUsd"))
            self.assertEqual(page.locator("#posStartPayment").inner_text(), "Start payment")
            browser.close()

    def test_pos_detected_payment_requires_confirmed_abandon(self):
        base = self.live_server_url
        txid = "b" * 64
        wallet_calls = {"count": 0}
        expected = {"doge": 0.0}

        def wallet_transactions(route):
            wallet_calls["count"] += 1
            transactions = [] if wallet_calls["count"] < 2 else [{
                "txid": txid,
                "doge": expected["doge"],
                "time": "2099-01-01T00:00:00Z",
                "confirmations": 0,
                "status": "pending",
                "source": "browser test",
            }]
            route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps({"transactions": transactions, "provider_name": "test chain"}),
            )

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            page = browser.new_page()
            page.route("**/api/wallet/transactions/**", wallet_transactions)
            page.route(
                "**/api/transaction/validate/",
                lambda route: route.fulfill(
                    status=200,
                    content_type="application/json",
                    body=json.dumps({
                        "passed": False,
                        "status": "pending",
                        "txid": txid,
                        "confirmations": 0,
                        "errors": ["Fewer confirmations than required."],
                        "source": "browser test",
                    }),
                ),
            )
            page.goto(f"{base}/pos/", wait_until="domcontentloaded", timeout=45000)
            page.click("#posGenerateWallet")
            page.wait_for_function(
                "() => document.getElementById('posWallet')?.value?.startsWith('D')",
                timeout=20000,
            )
            page.click("#posDismissNewWallet")
            page.fill("#posUsd", "3.00")
            page.wait_for_function(
                "() => Number.parseFloat(document.getElementById('posTotalDogeOut')?.textContent || '0') > 0",
                timeout=20000,
            )
            expected["doge"] = page.evaluate(
                "Number.parseFloat(document.getElementById('posTotalDogeOut').textContent)"
            )
            page.click("#posStartPayment")
            page.wait_for_function(
                "() => document.getElementById('posStatus')?.textContent?.trim().toLowerCase().includes('pending')",
                timeout=20000,
            )
            page.click("#posManualDetails summary")
            page.click("#posAbandonPayment")
            self.assertIn("pending", page.locator("#posStatus").inner_text().strip().lower())
            self.assertTrue(page.is_disabled("#posUsd"))
            self.assertEqual(page.locator("#posAbandonPayment").inner_text(), "Confirm abandon payment")
            page.click("#posAbandonPayment")
            self.assertEqual(page.locator("#posWorkflow").get_attribute("data-pos-stage"), "1")
            self.assertFalse(page.is_disabled("#posUsd"))
            self.assertEqual(page.locator("#posStartPayment").inner_text(), "Start payment")
            browser.close()
