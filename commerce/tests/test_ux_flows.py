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
            self.assertTrue(page.is_hidden("#posApprovePayment"))
            self.assertTrue(page.is_visible("#posReviewPayment"))
            self.assertEqual(page.locator("#posVerifyTitle").inner_text(), "Review this payment")
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

    def test_pos_paid_receipt_shows_every_value_inside_mobile_card(self):
        base = self.live_server_url
        txid = "0123456789abcdef" * 4
        wallet = "DTW2M5oEW97WbmYJRM71qD7uE6xfJs1MUK"
        paid_order = {
            "id": "mobile-receipt-order-12345",
            "merchant": "Mobile Merchant",
            "wallet": wallet,
            "usd": 5,
            "base_doge": 69.4,
            "fee_doge": 0.1,
            "doge": 69.5,
            "matched_doge": 69.5,
            "memo": "Mobile receipt test",
            "status": "paid",
            "txid": txid,
            "confirmations": 2,
            "min_confirmations": 1,
            "paid_at": "7/14/2026, 1:15:00 PM",
        }

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": 390, "height": 844})
            page = context.new_page()
            page.add_init_script(
                f"""
                  localStorage.setItem('doge-pos:orders', JSON.stringify([{json.dumps(paid_order)}]));
                  localStorage.setItem('doge-pos:selected-order', 'mobile-receipt-order-12345');
                """
            )
            page.goto(f"{base}/pos/", wait_until="domcontentloaded", timeout=45000)
            receipt = page.locator("#posPaidReceipt [data-pos-receipt-card]")
            receipt.wait_for(state="visible", timeout=20000)

            receipt_text = receipt.inner_text()
            for expected_text in (
                "Mobile Merchant",
                "Mobile receipt test",
                "$5.00",
                "69.5000 DOGE",
            ):
                self.assertIn(expected_text, receipt_text)
            self.assertEqual(receipt.locator("[data-pos-receipt-status]").inner_text().strip(), "Paid")

            rows = receipt.locator("[data-pos-receipt-row]").evaluate_all(
                """(items) => Object.fromEntries(items.map((row) => {
                  const label = row.querySelector('[data-pos-receipt-label]')?.textContent?.trim() || '';
                  const value = row.querySelector('[data-pos-receipt-value]')?.textContent?.trim() || '';
                  return [label, value];
                }))"""
            )
            self.assertEqual(rows["Date"], "7/14/2026, 1:15:00 PM")
            self.assertEqual(rows["Order"], "mobile-receipt-order-12345")
            self.assertEqual(rows["Item total"], "69.40000000 DOGE")
            self.assertEqual(rows["Network fee"], "0.10000000 DOGE")
            self.assertEqual(rows["Total paid"], "69.50000000 DOGE")
            self.assertEqual(rows["Confirmations"], "2")
            self.assertEqual(rows["Transaction"], f"{txid[:10]}…{txid[-8:]}")
            self.assertEqual(rows["Receiving address"], wallet)

            geometry = receipt.evaluate(
                """(card) => {
                  const cardBox = card.getBoundingClientRect();
                  const tables = Array.from(card.querySelectorAll('table'));
                  const values = Array.from(card.querySelectorAll(
                    '[data-pos-receipt-status], [data-pos-receipt-doge], [data-pos-receipt-value]'
                  ));
                  return {
                    tablesFit: tables.every((table) => {
                      const box = table.getBoundingClientRect();
                      return box.width > 0
                        && box.left >= cardBox.left - 1
                        && box.right <= cardBox.right + 1
                        && table.scrollWidth <= table.clientWidth + 1;
                    }),
                    valuesFit: values.every((value) => {
                      const box = value.getBoundingClientRect();
                      return box.width > 0
                        && box.left >= cardBox.left - 1
                        && box.right <= cardBox.right + 1
                        && value.scrollWidth <= value.clientWidth + 1;
                    }),
                  };
                }"""
            )
            self.assertTrue(geometry["tablesFit"])
            self.assertTrue(geometry["valuesFit"])
            self.assertIn(txid, page.locator("[data-pos-receipt-explorer]").get_attribute("href") or "")
            context.close()
            browser.close()

    def test_pos_order_history_receipts_do_not_replace_the_active_sale(self):
        base = self.live_server_url
        current_order = {
            "id": "current-active-sale",
            "merchant": "Current Sale Merchant",
            "wallet": "DTW2M5oEW97WbmYJRM71qD7uE6xfJs1MUK",
            "usd": 2,
            "doge": 27.5,
            "memo": "Current customer",
            "status": "unpaid",
            "time": "7/14/2026, 2:00:00 PM",
            "payment_started_at": "2099-01-01T00:00:00Z",
            "baseline_ready": True,
            "baseline_txids": [],
        }
        paid_txid = "1234567890abcdef" * 4
        paid_order = {
            "id": "history-paid-order",
            "merchant": "Historical Paid Merchant",
            "wallet": "D9RLnzJ7YwHjF7XG9M6q5AqBX1M8Y4Qw6P",
            "usd": 5,
            "base_doge": 69.4,
            "fee_doge": 0.1,
            "doge": 69.5,
            "matched_doge": 69.5,
            "memo": "Completed history sale",
            "status": "paid",
            "time": "7/14/2026, 1:00:00 PM",
            "paid_at": "7/14/2026, 1:05:00 PM",
            "txid": paid_txid,
            "confirmations": 3,
        }

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            page = browser.new_page()
            page.add_init_script(
                """
                  window.__posPrintCalls = [];
                  window.open = () => {
                    const capture = { html: '', printed: false };
                    window.__posPrintCalls.push(capture);
                    return {
                      document: {
                        write: (html) => { capture.html = html; },
                        close: () => {},
                      },
                      focus: () => {},
                      print: () => { capture.printed = true; },
                    };
                  };
                """
            )
            page.add_init_script(
                f"""
                  localStorage.setItem('doge-pos:orders', JSON.stringify({json.dumps([current_order, paid_order])}));
                  localStorage.setItem('doge-pos:selected-order', 'current-active-sale');
                """
            )
            page.route(
                "**/api/wallet/transactions/**",
                lambda route: route.fulfill(
                    status=200,
                    content_type="application/json",
                    body=json.dumps({"transactions": [], "provider_name": "browser test"}),
                ),
            )
            page.goto(f"{base}/pos/", wait_until="domcontentloaded", timeout=45000)
            page.click(".pos-history-details > summary")

            self.assertEqual(page.locator('[data-pos-receipt-share="history-paid-order"]').count(), 1)
            self.assertEqual(page.locator('[data-pos-receipt-print="history-paid-order"]').count(), 1)
            self.assertEqual(page.locator('[data-pos-receipt-share="current-active-sale"]').count(), 0)
            self.assertEqual(page.locator('[data-pos-receipt-print="current-active-sale"]').count(), 0)

            state_before = page.evaluate(
                """() => ({
                  selected: localStorage.getItem('doge-pos:selected-order'),
                  merchant: document.getElementById('posMerchant')?.value,
                  usd: document.getElementById('posUsd')?.value,
                  memo: document.getElementById('posMemo')?.value,
                  stage: document.getElementById('posWorkflow')?.dataset.posStage,
                  status: document.getElementById('posStatus')?.textContent?.trim(),
                  receiptHidden: document.getElementById('posPaidReceipt')?.hidden,
                })"""
            )

            page.click('[data-pos-receipt-share="history-paid-order"]')
            preview = page.locator("#posReceiptPreview [data-pos-receipt-card]")
            preview.wait_for(state="visible", timeout=20000)
            preview_text = preview.inner_text()
            self.assertIn("Historical Paid Merchant", preview_text)
            self.assertIn("history-paid-order", preview_text)
            self.assertNotIn("Current Sale Merchant", preview_text)
            self.assertIn("Historical Paid Merchant", page.locator("#posReceiptModalContext").inner_text())

            page.click("#posReceiptPrint")
            page.wait_for_function(
                "() => window.__posPrintCalls.length === 1 && window.__posPrintCalls[0].printed",
                timeout=5000,
            )
            modal_print_html = page.evaluate("window.__posPrintCalls[0].html")
            self.assertIn("Historical Paid Merchant", modal_print_html)
            self.assertNotIn("Current Sale Merchant", modal_print_html)
            page.evaluate(
                """() => {
                  const select = document.getElementById('posOrderPageSize');
                  select.value = '25';
                  select.dispatchEvent(new Event('change', { bubbles: true }));
                }"""
            )
            page.click("#closePosReceiptModal")
            page.wait_for_function(
                "() => document.activeElement?.dataset?.posReceiptShare === 'history-paid-order'",
                timeout=5000,
            )

            page.click('[data-pos-receipt-print="history-paid-order"]')
            page.wait_for_function(
                "() => window.__posPrintCalls.length === 2 && window.__posPrintCalls[1].printed",
                timeout=5000,
            )
            row_print_html = page.evaluate("window.__posPrintCalls[1].html")
            self.assertIn("Historical Paid Merchant", row_print_html)
            self.assertNotIn("Current Sale Merchant", row_print_html)

            state_after = page.evaluate(
                """() => ({
                  selected: localStorage.getItem('doge-pos:selected-order'),
                  merchant: document.getElementById('posMerchant')?.value,
                  usd: document.getElementById('posUsd')?.value,
                  memo: document.getElementById('posMemo')?.value,
                  stage: document.getElementById('posWorkflow')?.dataset.posStage,
                  status: document.getElementById('posStatus')?.textContent?.trim(),
                  receiptHidden: document.getElementById('posPaidReceipt')?.hidden,
                })"""
            )
            self.assertEqual(state_after, state_before)
            browser.close()

    def test_pos_order_history_email_copies_scoped_safe_table_without_mutating_sale(self):
        base = self.live_server_url
        wallet = "DTW2M5oEW97WbmYJRM71qD7uE6xfJs1MUK"
        orders = []
        for number in range(1, 12):
            paid = number % 2 == 0 or number == 11
            order = {
                "id": f"email-order-{number:02d}",
                "merchant": f"Merchant {number:02d}",
                "wallet": wallet,
                "usd": number,
                "doge": number * 10.0,
                "memo": f"Order memo {number:02d}",
                "status": "paid" if paid else "cancelled",
                "time": f"7/14/2026, {number}:00:00 AM",
                "confirmations": number if paid else 0,
            }
            if paid:
                order.update({
                    "matched_doge": number * 10.0,
                    "paid_at": f"7/14/2026, {number}:05:00 AM",
                    "txid": f"{number:064x}",
                })
            orders.append(order)
        orders[0].update({
            "merchant": "Current Active Merchant",
            "memo": "Current active customer",
            "status": "unpaid",
            "payment_started_at": "2099-01-01T00:00:00Z",
            "baseline_ready": True,
            "baseline_txids": [],
        })
        orders[-1].update({
            "merchant": '<img src=x onerror="alert(1)"> & Co',
            "memo": "<script>alert('unsafe')</script>",
        })

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            page = browser.new_page()
            page.add_init_script(
                """
                  window.__orderEmailCopies = [];
                  window.__orderMailtos = [];
                  window.ClipboardItem = class {
                    constructor(items) { this.items = items; }
                  };
                  Object.defineProperty(navigator, 'clipboard', {
                    configurable: true,
                    value: {
                      write: async (items) => {
                        const item = items[0];
                        window.__orderEmailCopies.push({
                          html: await item.items['text/html'].text(),
                          text: await item.items['text/plain'].text(),
                        });
                      },
                    },
                  });
                  const nativeAnchorClick = HTMLAnchorElement.prototype.click;
                  HTMLAnchorElement.prototype.click = function () {
                    const href = this.getAttribute('href') || '';
                    if (href.startsWith('mailto:')) {
                      window.__orderMailtos.push(href);
                      return;
                    }
                    return nativeAnchorClick.call(this);
                  };
                """
            )
            page.add_init_script(
                f"""
                  localStorage.setItem('doge-pos:orders', JSON.stringify({json.dumps(orders)}));
                  localStorage.setItem('doge-pos:selected-order', 'email-order-01');
                  localStorage.setItem('doge-pos:page-size', '10');
                """
            )
            page.route(
                "**/api/wallet/transactions/**",
                lambda route: route.fulfill(
                    status=200,
                    content_type="application/json",
                    body=json.dumps({"transactions": [], "provider_name": "browser test"}),
                ),
            )
            page.goto(f"{base}/pos/", wait_until="domcontentloaded", timeout=45000)
            page.click(".pos-history-details > summary")
            page.click("#posOrderNext")
            self.assertEqual(page.locator("#posOrderPageInfo").inner_text(), "Page 2 of 2")

            state_before = page.evaluate(
                """() => ({
                  orders: localStorage.getItem('doge-pos:orders'),
                  selected: localStorage.getItem('doge-pos:selected-order'),
                  merchant: document.getElementById('posMerchant')?.value,
                  usd: document.getElementById('posUsd')?.value,
                  memo: document.getElementById('posMemo')?.value,
                  stage: document.getElementById('posWorkflow')?.dataset.posStage,
                  status: document.getElementById('posStatus')?.textContent?.trim(),
                  page: document.getElementById('posOrderPageInfo')?.textContent?.trim(),
                  pageSize: document.getElementById('posOrderPageSize')?.value,
                })"""
            )

            page.click("#openPosEmailOrders")
            self.assertIn("1 order on page 2", page.locator("#posEmailOrdersPageCount").inner_text())
            self.assertIn("11 total orders", page.locator("#posEmailOrdersAllCount").inner_text())
            page.click("#posEmailOrdersCopy")
            page.wait_for_function("() => window.__orderEmailCopies.length === 1", timeout=5000)
            current_page_copy = page.evaluate(
                """() => {
                  const copy = window.__orderEmailCopies[0];
                  const doc = new DOMParser().parseFromString(copy.html, 'text/html');
                  return {
                    rows: doc.querySelectorAll('[data-pos-email-order-row]').length,
                    textContent: doc.body.textContent,
                    scripts: doc.querySelectorAll('script').length,
                    images: doc.querySelectorAll('img').length,
                    hasHead: Boolean(doc.querySelector('table thead')),
                    hasBody: Boolean(doc.querySelector('table tbody')),
                    plain: copy.text,
                  };
                }"""
            )
            self.assertEqual(current_page_copy["rows"], 1)
            self.assertIn("email-order-11", current_page_copy["textContent"])
            self.assertIn("<img src=x", current_page_copy["textContent"])
            self.assertIn("<script>", current_page_copy["textContent"])
            self.assertNotIn("Merchant 02", current_page_copy["textContent"])
            self.assertEqual(current_page_copy["scripts"], 0)
            self.assertEqual(current_page_copy["images"], 0)
            self.assertTrue(current_page_copy["hasHead"])
            self.assertTrue(current_page_copy["hasBody"])
            self.assertIn("email-order-11", current_page_copy["plain"])
            page.click("#closePosEmailOrders")

            page.click("#openPosEmailOrders")
            page.check('input[name="posEmailOrdersScope"][value="all"]')
            page.fill("#posEmailOrdersRecipient", "not-an-email")
            page.click("#posEmailOrdersOpen")
            self.assertEqual(page.evaluate("window.__orderEmailCopies.length"), 1)
            self.assertTrue(page.is_visible("#posEmailOrdersModal"))

            page.fill("#posEmailOrdersRecipient", "qa+orders@example.com")
            page.click("#posEmailOrdersOpen")
            page.wait_for_function(
                "() => window.__orderEmailCopies.length === 2 && window.__orderMailtos.length === 1",
                timeout=5000,
            )
            all_copy = page.evaluate(
                """() => {
                  const doc = new DOMParser().parseFromString(window.__orderEmailCopies[1].html, 'text/html');
                  return {
                    rows: doc.querySelectorAll('[data-pos-email-order-row]').length,
                    textContent: doc.body.textContent,
                  };
                }"""
            )
            self.assertEqual(all_copy["rows"], 11)
            self.assertIn("email-order-01", all_copy["textContent"])
            self.assertIn("email-order-11", all_copy["textContent"])
            mailto = page.evaluate("window.__orderMailtos[0]")
            decoded_mailto = page.evaluate("decodeURIComponent(window.__orderMailtos[0])")
            self.assertTrue(mailto.startswith("mailto:"))
            self.assertNotIn("body=", mailto.lower())
            self.assertIn("qa+orders@example.com", decoded_mailto)
            self.assertIn("DOGE POS orders", decoded_mailto)
            page.click("#closePosEmailOrders")

            state_after = page.evaluate(
                """() => ({
                  orders: localStorage.getItem('doge-pos:orders'),
                  selected: localStorage.getItem('doge-pos:selected-order'),
                  merchant: document.getElementById('posMerchant')?.value,
                  usd: document.getElementById('posUsd')?.value,
                  memo: document.getElementById('posMemo')?.value,
                  stage: document.getElementById('posWorkflow')?.dataset.posStage,
                  status: document.getElementById('posStatus')?.textContent?.trim(),
                  page: document.getElementById('posOrderPageInfo')?.textContent?.trim(),
                  pageSize: document.getElementById('posOrderPageSize')?.value,
                })"""
            )
            self.assertEqual(state_after, state_before)
            browser.close()

    def test_pos_near_match_quick_approve_revalidates_the_detected_transaction(self):
        base = self.live_server_url
        detected_txid = "c" * 64
        edited_txid = "d" * 64
        expected_doge = 70.0
        received_doge = 69.5
        base_order = {
            "id": "near-match-sale",
            "merchant": "DOGE Merchant",
            "wallet": "DTW2M5oEW97WbmYJRM71qD7uE6xfJs1MUK",
            "usd": 5,
            "doge": expected_doge,
            "matched_doge": received_doge,
            "memo": "Near match",
            "status": "needs review",
            "payment_started_at": "2099-01-01T00:00:00Z",
            "payment_detected_at": "2099-01-01T00:00:01Z",
            "baseline_ready": True,
            "txid": detected_txid,
            "confirmations": 1,
            "min_confirmations": 1,
            "near_match": True,
            "near_match_difference": 0.5,
            "validation": "near amount match requires confirmation",
            "validation_errors": [
                "Matched output is below the expected DOGE amount.",
            ],
        }

        def prepare_page(browser, validation_errors):
            captured_requests = []
            context = browser.new_context()
            page = context.new_page()
            page.add_init_script(
                f"""
                  localStorage.setItem('doge-pos:orders', JSON.stringify([{json.dumps(base_order)}]));
                  localStorage.setItem('doge-pos:selected-order', 'near-match-sale');
                """
            )

            def validate_transaction(route):
                captured_requests.append(route.request.post_data_json)
                route.fulfill(
                    status=200,
                    content_type="application/json",
                    body=json.dumps({
                        "passed": False,
                        "txid": detected_txid,
                        "matched_doge": received_doge,
                        "confirmations": 1,
                        "errors": validation_errors,
                        "source": "browser test",
                    }),
                )

            page.route("**/api/transaction/validate/", validate_transaction)
            page.goto(f"{base}/pos/", wait_until="domcontentloaded", timeout=45000)
            page.wait_for_selector("#posApprovePayment", state="visible", timeout=20000)
            self.assertFalse(page.is_disabled("#posApprovePayment"))
            page.evaluate("(txid) => { document.getElementById('posTxId').value = txid; }", edited_txid)
            return context, page, captured_requests

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)

            accepted_context, accepted_page, accepted_requests = prepare_page(
                browser,
                ["Matched output is below the expected DOGE amount."],
            )
            accepted_page.click("#posApprovePayment")
            accepted_page.wait_for_function(
                "() => document.getElementById('posStatus')?.textContent?.trim().toLowerCase() === 'paid'",
                timeout=20000,
            )
            self.assertEqual(accepted_requests[-1]["txid"], detected_txid)
            accepted_receipt = accepted_page.locator("#posPaidReceipt [data-pos-receipt-card]")
            self.assertTrue(accepted_receipt.is_visible())
            accepted_rows = accepted_receipt.locator("[data-pos-receipt-row]").evaluate_all(
                """(items) => Object.fromEntries(items.map((row) => [
                  row.querySelector('[data-pos-receipt-label]')?.textContent?.trim() || '',
                  row.querySelector('[data-pos-receipt-value]')?.textContent?.trim() || '',
                ]))"""
            )
            self.assertEqual(accepted_rows["Amount requested"], "70.00000000 DOGE")
            self.assertEqual(accepted_rows["Amount received"], "69.50000000 DOGE")
            accepted_context.close()

            rejected_context, rejected_page, rejected_requests = prepare_page(
                browser,
                [
                    "Matched output is below the expected DOGE amount.",
                    "No output pays the loaded merchant address.",
                ],
            )
            rejected_page.click("#posApprovePayment")
            rejected_page.wait_for_function(
                "() => document.getElementById('posStatus')?.textContent?.trim().toLowerCase() === 'needs review'",
                timeout=20000,
            )
            self.assertEqual(rejected_requests[-1]["txid"], detected_txid)
            self.assertTrue(rejected_page.is_hidden("#posApprovePayment"))
            self.assertTrue(rejected_page.is_visible("#posReviewPayment"))
            self.assertTrue(rejected_page.is_hidden("#posPaidReceipt"))
            rejected_context.close()
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
            page.click('[data-pos-go="2"]')
            page.click("#posSaleOptions summary")
            page.click("#posCancelPayment")
            self.assertIn("pending", page.locator("#posStatus").inner_text().strip().lower())
            self.assertTrue(page.is_disabled("#posUsd"))
            self.assertEqual(page.locator("#posCancelPayment").inner_text(), "Confirm abandon payment")
            page.click("#posCancelPayment")
            self.assertEqual(page.locator("#posWorkflow").get_attribute("data-pos-stage"), "1")
            self.assertFalse(page.is_disabled("#posUsd"))
            self.assertEqual(page.locator("#posStartPayment").inner_text(), "Start payment")
            browser.close()
