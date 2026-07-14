import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from django.test import SimpleTestCase


ROOT = Path(__file__).resolve().parents[1]


class WalletTemplateStructureTests(SimpleTestCase):
    def test_pos_page_contains_wallet_setup_controls(self):
        pos_html = (ROOT / "templates" / "commerce" / "pos_terminal.html").read_text(encoding="utf-8")
        for marker in (
            "posWallet",
            "posGenerateWallet",
            "posImportWallet",
            "posImportWalletFile",
            "posWalletImportReview",
            "posNewWalletAddress",
            "posNewWalletWif",
            "posDownloadWallet",
            "posDismissNewWallet",
        ):
            self.assertIn(marker, pos_html)

    def test_pos_wallet_json_import_is_local_validated_and_confirmation_gated(self):
        pos_html = (ROOT / "templates" / "commerce" / "pos_terminal.html").read_text(encoding="utf-8")
        doge_tools = (ROOT / "static" / "commerce" / "js" / "doge_tools.js").read_text(encoding="utf-8")
        wallet_core = (ROOT / "static" / "commerce" / "js" / "wallet_core.js").read_text(encoding="utf-8")
        site_css = (ROOT / "static" / "commerce" / "css" / "site.css").read_text(encoding="utf-8")
        import_block = doge_tools.split("function setPosWalletImportStatus", 1)[1].split(
            "function updatePosProfileStatus", 1
        )[0]
        self.assertIn('id="posImportWallet"', pos_html)
        self.assertIn('id="posImportWalletFile" type="file" accept=".json,application/json"', pos_html)
        self.assertIn('id="posConfirmWalletImport"', pos_html)
        self.assertIn('id="posCancelWalletImport"', pos_html)
        self.assertIn('aria-describedby="posWalletImportReviewCopy posWalletImportAddress"', pos_html)
        self.assertIn("POS_WALLET_BACKUP_MAX_BYTES", doge_tools)
        self.assertIn('schema: "doge-commerce-wallet-backup"', doge_tools)
        self.assertIn('network: "dogecoin-mainnet"', doge_tools)
        self.assertIn("parseWalletBackupJson", import_block)
        self.assertIn("pendingPosWalletImport = Object.freeze", import_block)
        self.assertIn("function processPosWalletImportFile", import_block)
        self.assertIn("function persistPosImportedWallet", import_block)
        self.assertIn('storage.setItem("doge-wallet:address", address)', import_block)
        self.assertNotIn('storage.setItem("doge-wallet:wif"', import_block)
        self.assertNotIn("fetch(", import_block)
        self.assertIn('input:not([type="file"])', doge_tools)
        self.assertIn('if (input) input.value = ""', import_block)
        self.assertIn("function beginPosWalletOperation", doge_tools)
        self.assertIn("window.requestAnimationFrame(() => $id(\"posChangeWallet\")?.focus", import_block)
        self.assertNotIn("window.dogePosWalletImportApi", doge_tools)
        self.assertIn("function validateWalletBackup", wallet_core)
        self.assertIn("Wallet backup address does not match its private key", wallet_core)
        self.assertIn("has_private_key: true", wallet_core)
        self.assertIn(".pos-wallet-import-review[hidden]", site_css)
        self.assertIn(".pos-wallet-setup-actions #posUseWallet", site_css)

    def test_wallet_backup_node_runtime(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("Node.js is not available")
        with tempfile.TemporaryDirectory() as scratch:
            result = subprocess.run(
                [node, str(ROOT / "tests" / "run_wallet_logic_test.mjs")],
                cwd=ROOT.parent,
                env={**os.environ, "DOGE2MOON_SCRATCH": scratch},
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for marker in (
            "walletBackup.matches=true",
            "walletBackup.secretReturned=false",
            "walletBackup.mismatchRejected=true",
            "walletBackup.fileInputReset=true",
            "walletBackup.publicOnlyPersistence=true",
            "walletBackup.networkCalls=0",
        ):
            self.assertIn(marker, result.stdout)

    def test_base_loads_rate_limit_scripts_without_header_indicator(self):
        base_html = (ROOT / "templates" / "commerce" / "base.html").read_text(encoding="utf-8")
        # Scripts load site-wide, but the visual indicator no longer lives in the header.
        self.assertIn("rate_limit_core.js", base_html)
        self.assertIn("rate_limit_bootstrap.js", base_html)
        self.assertIn("wallet_core.js", base_html)
        self.assertNotIn("rateLimitStatus", base_html)

    def test_rate_limit_indicator_stays_off_the_pos_checkout(self):
        for template in ("statistics.html", "merchant_kit.html"):
            html = (ROOT / "templates" / "commerce" / template).read_text(encoding="utf-8")
            self.assertIn("rateLimitStatus", html, template)
            self.assertIn("data-source-status", html, template)
        pos_html = (ROOT / "templates" / "commerce" / "pos_terminal.html").read_text(encoding="utf-8")
        self.assertNotIn("rateLimitStatus", pos_html)
        self.assertNotIn("data-source-status", pos_html)

    def test_js_declares_known_provider_urls(self):
        doge_tools = (ROOT / "static" / "commerce" / "js" / "doge_tools.js").read_text(encoding="utf-8")
        site_js = (ROOT / "static" / "commerce" / "js" / "site.js").read_text(encoding="utf-8")
        rate_core = (ROOT / "static" / "commerce" / "js" / "rate_limit_core.js").read_text(encoding="utf-8")
        rate_bootstrap = (ROOT / "static" / "commerce" / "js" / "rate_limit_bootstrap.js").read_text(encoding="utf-8")
        combined = "\n".join([doge_tools, site_js, rate_core, rate_bootstrap])
        self.assertIn("api.exchange.coinbase.com", combined)
        self.assertIn("blockchair.com", combined)
        self.assertNotIn("api.binance.com", combined)
        self.assertIn("dogeLimitedFetch", site_js)

    def test_price_snippet_uses_limited_fetch_path(self):
        site_js = (ROOT / "static" / "commerce" / "js" / "site.js").read_text(encoding="utf-8")
        self.assertIn("dogeLimitedFetch", site_js)
        self.assertNotIn('await fetch("https://api.exchange.coinbase.com/products/DOGE-USD/ticker"', site_js)

    def test_site_bootstraps_rate_limiter_explicitly(self):
        site_js = (ROOT / "static" / "commerce" / "js" / "site.js").read_text(encoding="utf-8")
        self.assertIn("dogeRateLimit?.bootstrap", site_js)

    def test_pos_uses_staged_payment_monitoring(self):
        doge_tools = (ROOT / "static" / "commerce" / "js" / "doge_tools.js").read_text(encoding="utf-8")
        for marker in (
            "startPosPaymentPolling",
            "payment_started_at",
            "baseline_txids",
            "baseline_ready",
            "fresh=1",
            "Verification pending",
            "activePosPaymentState()",
            "min_confirmations",
        ):
            self.assertIn(marker, doge_tools)

    def test_pos_steps_are_navigable_without_unlocking_active_sale(self):
        pos_html = (ROOT / "templates" / "commerce" / "pos_terminal.html").read_text(encoding="utf-8")
        doge_tools = (ROOT / "static" / "commerce" / "js" / "doge_tools.js").read_text(encoding="utf-8")
        for stage in (1, 2, 3):
            self.assertIn(f'data-pos-go="{stage}"', pos_html)
        for panel_id in ("dogePosTerminal", "posStage2", "posStage3"):
            self.assertIn(f'id="{panel_id}"', pos_html)
        self.assertNotIn('id="posStage2" data-pos-panel="2" role="region" aria-labelledby="posStage2Title" hidden', pos_html)
        self.assertNotIn('id="posStage3" data-pos-panel="3" role="region" aria-labelledby="posStage3Title" hidden', pos_html)
        self.assertIn('id="posStartPayment" type="submit" form="posSaleForm"', pos_html)
        self.assertIn("navigatePosStage", doge_tools)
        self.assertIn("panel.hidden = false", doge_tools)
        self.assertIn('panel.classList.toggle("is-active"', doge_tools)
        self.assertIn("setPosSaleLocked(Boolean(activeOrder) || posPaymentStarting)", doge_tools)
        self.assertIn("if (posPaymentStarting)", doge_tools)
        self.assertNotIn("setPosSaleLocked(safeStage !== 1)", doge_tools)
        self.assertNotIn('data-pos-go="2" aria-controls="posStage2" disabled', pos_html)
        self.assertNotIn('data-pos-go="3" aria-controls="posStage3" disabled', pos_html)
        for marker in ("posFlowNotice", "posEditSale", "posStep2StartSale", "posStep3StartSale", "posAbandonPayment"):
            self.assertIn(marker, pos_html)
        self.assertIn("startedPosOrder", doge_tools)
        self.assertIn("posPaymentWasDetected", doge_tools)
        self.assertNotIn('|| order.txid) return 3', doge_tools)
        self.assertNotIn('if (!automatic) stopPosPaymentPolling()', doge_tools)
        self.assertIn("posPaymentPollOrderIds", doge_tools)
        self.assertIn("Previous payment request is still being monitored in the background", doge_tools)
        self.assertIn("function abandonPosPayment", doge_tools)
        self.assertIn("const posPricePromise = fetchDogePrice()", doge_tools)
        self.assertNotIn("await fetchDogePrice();", doge_tools)
        self.assertIn("Payment details &amp; manual verification", pos_html)

    def test_pos_recent_activity_has_narrow_screen_layout_rules(self):
        site_css = (ROOT / "static" / "commerce" / "css" / "site.css").read_text(encoding="utf-8")
        self.assertIn("pos-transaction-picker .wallet-activity-item", site_css)
        self.assertIn("grid-template-columns: minmax(0, 1fr) minmax(86px, auto)", site_css)
        self.assertIn("text-overflow: ellipsis", site_css)

    def test_pos_waiting_state_has_motion_and_reduced_motion_fallback(self):
        site_css = (ROOT / "static" / "commerce" / "css" / "site.css").read_text(encoding="utf-8")
        self.assertIn("animation: pos-waiting-sheen", site_css)
        self.assertIn("@keyframes pos-waiting-sheen", site_css)
        self.assertIn(".pos-live-dot,\n  .pos-waiting-card", site_css)

    def test_pos_receipt_wraps_long_values_inside_step_three(self):
        doge_tools = (ROOT / "static" / "commerce" / "js" / "doge_tools.js").read_text(encoding="utf-8")
        site_css = (ROOT / "static" / "commerce" / "css" / "site.css").read_text(encoding="utf-8")
        self.assertIn("table-layout:fixed", doge_tools)
        self.assertIn("overflow-wrap:anywhere;word-break:break-word", doge_tools)
        self.assertIn("data-pos-receipt-details", doge_tools)
        receipt_row_function = doge_tools.split("function posReceiptRow", 1)[1].split(
            "function posReceiptHtml", 1
        )[0]
        self.assertNotIn("max-width:0", receipt_row_function)
        self.assertIn("[data-pos-receipt-card] table", site_css)
        receipt_table_rule = site_css.split(
            ".pos-paid-receipt [data-pos-receipt-card] table,", 1
        )[1].split("}", 1)[0]
        self.assertIn("min-width: 0 !important", receipt_table_rule)
        self.assertIn("max-width: 480px", site_css)

    def test_pos_validation_has_one_doge_near_match_confirmation_path(self):
        pos_html = (ROOT / "templates" / "commerce" / "pos_terminal.html").read_text(encoding="utf-8")
        doge_tools = (ROOT / "static" / "commerce" / "js" / "doge_tools.js").read_text(encoding="utf-8")
        self.assertIn("POS_NEAR_MATCH_MARGIN_DOGE = 1", doge_tools)
        self.assertIn("near amount match requires confirmation", doge_tools)
        self.assertIn('id="posApprovePayment"', pos_html)
        self.assertIn('id="posReviewPayment"', pos_html)
        self.assertIn("approvePosNearMatch", doge_tools)
        self.assertIn("txidOverride: order.txid", doge_tools)
        self.assertIn("canApprovePosNearMatch", doge_tools)
        self.assertIn('order.validation === "near amount match requires confirmation"', doge_tools)
        self.assertIn('Number(order?.confirmations || 0) >= required', doge_tools)
        self.assertIn("nearMatchApproved", doge_tools)

    def test_pos_review_details_are_hidden_until_requested(self):
        pos_html = (ROOT / "templates" / "commerce" / "pos_terminal.html").read_text(encoding="utf-8")
        doge_tools = (ROOT / "static" / "commerce" / "js" / "doge_tools.js").read_text(encoding="utf-8")
        self.assertIn('id="posReviewActions"', pos_html)
        self.assertIn('id="posManualDetails" hidden', pos_html)
        self.assertIn("posReviewExpected", pos_html)
        self.assertIn("posReviewReceived", pos_html)
        self.assertIn("openPosPaymentReview", doge_tools)
        self.assertIn("posManualReviewVisible", doge_tools)
        self.assertIn('["pending", "needs review", "confirmed"]', doge_tools)
        self.assertIn('setPosVerificationCopy(order)', doge_tools)

    def test_footer_tracks_body_content_width(self):
        site_css = (ROOT / "static" / "commerce" / "css" / "site.css").read_text(encoding="utf-8")
        self.assertIn("width: min(1280px, calc(100% - clamp(24px, 3vw, 64px)))", site_css)
        self.assertIn("body[data-page=\"pos_terminal\"] .site-footer", site_css)
        self.assertIn("width: min(1360px, calc(100% - 80px))", site_css)

    def test_footer_community_actions_live_at_the_right_of_bottom_nav(self):
        base_html = (ROOT / "templates" / "commerce" / "base.html").read_text(encoding="utf-8")
        site_css = (ROOT / "static" / "commerce" / "css" / "site.css").read_text(encoding="utf-8")
        footer = base_html.split('<footer class="site-footer">', 1)[1].split("</footer>", 1)[0]
        footer_top, footer_nav = footer.split('<nav class="footer-nav"', 1)
        self.assertNotIn('class="footer-actions"', footer_top)
        self.assertIn('class="footer-actions"', footer_nav)
        self.assertGreater(footer_nav.index('class="footer-actions"'), footer_nav.index("Technical"))
        self.assertIn('class="footer-actions" role="group" aria-label="Community links"', footer_nav)
        self.assertIn(".footer-nav > .footer-actions", site_css)
        self.assertIn("margin-left: auto", site_css)

    def test_pos_has_mobile_counter_carousel_layout(self):
        pos_html = (ROOT / "templates" / "commerce" / "pos_terminal.html").read_text(encoding="utf-8")
        doge_tools = (ROOT / "static" / "commerce" / "js" / "doge_tools.js").read_text(encoding="utf-8")
        site_css = (ROOT / "static" / "commerce" / "css" / "site.css").read_text(encoding="utf-8")
        self.assertIn('aria-label="POS checkout steps"', pos_html)
        self.assertIn("scroll-snap-type: x mandatory", site_css)
        self.assertIn("height: calc(100dvh - 188px)", site_css)
        self.assertIn("grid-template-columns: repeat(6, minmax(0, 1fr))", site_css)
        self.assertIn("posWorkflowScrollTimer", doge_tools)
        self.assertIn("scroll: false", doge_tools)
        self.assertIn("function upsertPosOrder(order, { select = true } = {})", doge_tools)
        self.assertIn("upsertPosOrder(paidOrder, { select: wasSelected })", doge_tools)

    def test_pos_receipt_keeps_html_as_the_primary_format(self):
        doge_tools = (ROOT / "static" / "commerce" / "js" / "doge_tools.js").read_text(encoding="utf-8")
        self.assertIn("data-pos-receipt-card", doge_tools)
        self.assertIn('"text/html": new Blob([receipt.html]', doge_tools)
        self.assertIn("posReceiptDocument(receipt)", doge_tools)
        self.assertIn("!emailField.checkValidity()", doge_tools)
        self.assertIn("mailto:${encodeURIComponent(email)}", doge_tools)
        self.assertNotIn("subject=${encodeURIComponent(receipt.subject)}&body=", doge_tools)

    def test_paid_order_history_has_state_safe_receipt_actions(self):
        pos_html = (ROOT / "templates" / "commerce" / "pos_terminal.html").read_text(encoding="utf-8")
        doge_tools = (ROOT / "static" / "commerce" / "js" / "doge_tools.js").read_text(encoding="utf-8")
        site_css = (ROOT / "static" / "commerce" / "css" / "site.css").read_text(encoding="utf-8")
        self.assertIn('data-pos-receipt-share="${orderId}"', doge_tools)
        self.assertIn('data-pos-receipt-print="${orderId}"', doge_tools)
        self.assertIn('order.status === "paid"', doge_tools)
        self.assertIn("function posReceiptForOrder", doge_tools)
        self.assertIn("function paidPosReceiptById", doge_tools)
        self.assertIn("posReceiptModalReceipt", doge_tools)
        self.assertIn("printBuiltPosReceipt(receipt)", doge_tools)
        self.assertLess(
            doge_tools.index('target?.closest("[data-pos-receipt-share]")'),
            doge_tools.index('target?.closest("[data-pos-load]")'),
        )
        self.assertIn('id="posReceiptModalContext"', pos_html)
        self.assertIn(".pos-order-receipt-actions", site_css)
        self.assertIn(".pos-order-actions-cell", site_css)

    def test_order_history_email_uses_a_local_rich_table_snapshot(self):
        pos_html = (ROOT / "templates" / "commerce" / "pos_terminal.html").read_text(encoding="utf-8")
        doge_tools = (ROOT / "static" / "commerce" / "js" / "doge_tools.js").read_text(encoding="utf-8")
        site_css = (ROOT / "static" / "commerce" / "css" / "site.css").read_text(encoding="utf-8")
        email_block = doge_tools.split("function posEmailOrderRecord", 1)[1].split(
            "function openPosConversionModal", 1
        )[0]
        self.assertIn('id="openPosEmailOrders"', pos_html)
        self.assertIn('id="posEmailOrdersModal"', pos_html)
        self.assertIn('name="posEmailOrdersScope" value="page" checked', pos_html)
        self.assertIn('name="posEmailOrdersScope" value="all"', pos_html)
        self.assertIn('id="posEmailOrdersRecipient" type="email"', pos_html)
        self.assertIn("function posEmailOrdersBundle", doge_tools)
        self.assertIn("function containPosEmailOrdersFocus", doge_tools)
        self.assertIn("posEmailOrdersSnapshot = Object.freeze", email_block)
        self.assertIn("data-pos-order-history-table", email_block)
        self.assertIn('"text/html": new Blob([bundle.html]', email_block)
        self.assertIn('"text/plain": new Blob([bundle.text]', email_block)
        self.assertIn("!emailField.checkValidity()", email_block)
        self.assertIn("mailto:${encodeURIComponent(email)}?subject=", email_block)
        self.assertNotIn("body=", email_block)
        self.assertNotIn("baseline_txids", email_block)
        self.assertNotIn("validation_errors", email_block)
        self.assertIn(".pos-history-toolbar-actions", site_css)
        self.assertIn(".pos-email-orders-scope-grid", site_css)
