from pathlib import Path

from django.test import SimpleTestCase


ROOT = Path(__file__).resolve().parents[1]


class WalletTemplateStructureTests(SimpleTestCase):
    def test_pos_page_contains_wallet_setup_controls(self):
        pos_html = (ROOT / "templates" / "commerce" / "pos_terminal.html").read_text(encoding="utf-8")
        for marker in (
            "posWallet",
            "posGenerateWallet",
            "posNewWalletAddress",
            "posNewWalletWif",
            "posDownloadWallet",
            "posDismissNewWallet",
        ):
            self.assertIn(marker, pos_html)

    def test_base_loads_rate_limit_scripts_without_header_indicator(self):
        base_html = (ROOT / "templates" / "commerce" / "base.html").read_text(encoding="utf-8")
        # Scripts load site-wide, but the visual indicator no longer lives in the header.
        self.assertIn("rate_limit_core.js", base_html)
        self.assertIn("rate_limit_bootstrap.js", base_html)
        self.assertIn("wallet_core.js", base_html)
        self.assertNotIn("rateLimitStatus", base_html)

    def test_rate_limit_indicator_renders_on_data_pages(self):
        for template in ("statistics.html", "pos_terminal.html", "merchant_kit.html"):
            html = (ROOT / "templates" / "commerce" / template).read_text(encoding="utf-8")
            self.assertIn("rateLimitStatus", html, template)
            self.assertIn("data-source-status", html, template)

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
        self.assertIn("const posPricePromise = fetchDogePrice()", doge_tools)
        self.assertNotIn("await fetchDogePrice();", doge_tools)
        self.assertIn("Verification options", pos_html)

    def test_pos_recent_activity_has_narrow_screen_layout_rules(self):
        site_css = (ROOT / "static" / "commerce" / "css" / "site.css").read_text(encoding="utf-8")
        self.assertIn("pos-transaction-picker .wallet-activity-item", site_css)
        self.assertIn("grid-template-columns: minmax(0, 1fr) minmax(86px, auto)", site_css)
        self.assertIn("text-overflow: ellipsis", site_css)

    def test_pos_receipt_keeps_html_as_the_primary_format(self):
        doge_tools = (ROOT / "static" / "commerce" / "js" / "doge_tools.js").read_text(encoding="utf-8")
        self.assertIn("data-pos-receipt-card", doge_tools)
        self.assertIn('"text/html": new Blob([receipt.html]', doge_tools)
        self.assertIn("posReceiptDocument(receipt)", doge_tools)
        self.assertIn("!emailField.checkValidity()", doge_tools)
        self.assertIn("mailto:${encodeURIComponent(email)}", doge_tools)
        self.assertNotIn("subject=${encodeURIComponent(receipt.subject)}&body=", doge_tools)
