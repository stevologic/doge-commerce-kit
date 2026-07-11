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

    def test_base_header_contains_rate_limit_indicator(self):
        base_html = (ROOT / "templates" / "commerce" / "base.html").read_text(encoding="utf-8")
        self.assertIn("rateLimitStatus", base_html)
        self.assertIn("rate_limit_core.js", base_html)
        self.assertIn("rate_limit_bootstrap.js", base_html)
        self.assertIn("wallet_core.js", base_html)

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