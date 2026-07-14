import json
import re
from pathlib import Path
from unittest.mock import patch

from django.test import Client, SimpleTestCase

from commerce import views


ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = ROOT / "templates" / "commerce"
STATIC = ROOT / "static" / "commerce"
MERCHANT_ADDRESS = "DTW2M5oEW97WbmYJRM71qD7uE6xfJs1MUK"
EMBED_CONFIG = {
    "merchant": "Example Coffee",
    "site_name": "Example Coffee",
    "address": MERCHANT_ADDRESS,
    "wallet": MERCHANT_ADDRESS,
    "offer": "Cold brew",
    "item": "Cold brew",
    "usd": "5.00",
    "amount": "5.00",
    "memo": "Web order 1001",
    "button": "Pay with DOGE",
}


class CheckoutEmbedRouteTests(SimpleTestCase):
    def setUp(self):
        self.client = Client()

    def test_embed_route_is_renderable_and_is_the_only_frame_exempt_page(self):
        response = self.client.get("/checkout/embed/", EMBED_CONFIG)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("X-Frame-Options", response.headers)
        self.assertIn("frame-ancestors *", response.headers.get("Content-Security-Policy", ""))
        self.assertEqual(response.headers.get("Referrer-Policy"), "no-referrer")

        for path in (
            "/",
            "/pos/",
            "/merchant-kit/",
            "/statistics/",
            "/playbook/",
            "/faq/",
            "/technical-details/",
        ):
            with self.subTest(path=path):
                normal_response = self.client.get(path)
                self.assertEqual(normal_response.status_code, 200)
                self.assertEqual(normal_response.headers.get("X-Frame-Options"), "DENY")

    def test_embed_uses_its_small_standalone_shell_and_assets(self):
        response = self.client.get("/checkout/embed/", EMBED_CONFIG)
        self.assertEqual(response.status_code, 200)
        html = response.content.decode("utf-8")

        self.assertIn('<meta name="viewport"', html)
        for asset in (
            "doge_checkout_embed.css",
            "doge_checkout_core.js",
            "doge_checkout_embed.js",
        ):
            stem, suffix = asset.rsplit(".", 1)
            self.assertRegex(html, rf"{re.escape(stem)}(?:\.[0-9a-f]+)?\.{suffix}")

        self.assertRegex(
            html,
            re.compile(r'<(?:main|section|div)[^>]+(?:id|data-[^=\s]*checkout)', re.IGNORECASE),
        )
        for full_site_asset_or_shell in (
            "commerce/css/site.css",
            "doge_tools.js",
            "wallet_core.js",
            'class="site-header"',
            'class="site-footer"',
        ):
            self.assertNotIn(full_site_asset_or_shell, html)

        template_source = (TEMPLATES / "checkout_embed.html").read_text(encoding="utf-8")
        self.assertNotIn('{% extends "commerce/base.html" %}', template_source)

    def test_embed_does_not_render_private_key_or_wallet_import_controls(self):
        response = self.client.get("/checkout/embed/", EMBED_CONFIG)
        self.assertEqual(response.status_code, 200)
        html = response.content.decode("utf-8")

        for pos_secret_control in (
            "posGenerateWallet",
            "posImportWallet",
            "posImportWalletFile",
            "posNewWalletWif",
            "posCopyWalletWif",
        ):
            self.assertNotIn(pos_secret_control, html)
        self.assertNotRegex(
            html,
            re.compile(
                r'<(?:input|textarea|button)\b[^>]*(?:id|name)=["\'][^"\']*'
                r'(?:private[-_ ]?key|seed|mnemonic|wif)[^"\']*["\']',
                re.IGNORECASE,
            ),
        )


class CheckoutEmbedAssetTests(SimpleTestCase):
    def test_embed_assets_are_present_and_cover_the_live_checkout_contract(self):
        paths = {
            "loader": STATIC / "js" / "doge_checkout.js",
            "core": STATIC / "js" / "doge_checkout_core.js",
            "runtime": STATIC / "js" / "doge_checkout_embed.js",
            "styles": STATIC / "css" / "doge_checkout_embed.css",
            "host_styles": STATIC / "css" / "doge_checkout_host.css",
        }
        for label, path in paths.items():
            with self.subTest(asset=label):
                self.assertTrue(path.is_file(), f"Missing checkout {label}: {path}")
                self.assertGreater(path.stat().st_size, 200, f"Checkout {label} is unexpectedly empty")

        loader = paths["loader"].read_text(encoding="utf-8")
        core = paths["core"].read_text(encoding="utf-8")
        runtime = paths["runtime"].read_text(encoding="utf-8")
        styles = paths["styles"].read_text(encoding="utf-8")

        self.assertIn("/checkout/embed/", loader)
        self.assertRegex(loader, re.compile(r"iframe|createElement\([\"']iframe", re.IGNORECASE))
        self.assertRegex(loader, re.compile(r"data-doge-checkout|doge-checkout", re.IGNORECASE))
        self.assertRegex(loader, re.compile(r"postMessage|addEventListener\([\"']message", re.IGNORECASE))
        self.assertIn("doge_checkout_host.css", loader)

        self.assertIn("dogecoin:", core)
        self.assertRegex(core, r"10_?000")

        for endpoint in (
            "/api/doge-price/",
            "/api/wallet/transactions/",
            "/api/transaction/validate/",
        ):
            self.assertIn(endpoint, runtime)
        self.assertIn("postMessage", runtime)
        self.assertIn("quoteOperationToken", runtime)
        self.assertIn("operationToken !== quoteOperationToken", runtime)
        self.assertIn('if (state.status === "starting") return;', runtime)
        self.assertIn('code: "final_check_failed"', runtime)
        self.assertRegex(
            runtime,
            re.compile(r'code:\s*"final_check_failed"[\s\S]{0,180}retrying:\s*true'),
        )

        self.assertIn("box-sizing", styles)
        self.assertRegex(styles, re.compile(r"@media|width\s*:\s*(?:min\(|100%)", re.IGNORECASE))


class DogePriceEndpointTests(SimpleTestCase):
    def setUp(self):
        self.client = Client()
        self._clear_price_cache()

    def tearDown(self):
        self._clear_price_cache()

    @staticmethod
    def _clear_price_cache():
        cache = getattr(views, "DOGE_LOOKUP_CACHE", {})
        for key in tuple(cache):
            key_text = " ".join(map(str, key)) if isinstance(key, tuple) else str(key)
            if "price" in key_text.lower() or "coinbase" in key_text.lower() or "doge-usd" in key_text.lower():
                cache.pop(key, None)

    def test_doge_price_endpoint_returns_a_live_numeric_quote(self):
        with patch("commerce.views.fetch_json", return_value={"price": "0.12345678"}) as lookup:
            response = self.client.get("/api/doge-price/")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.headers.get("Content-Type", "").startswith("application/json"))
        payload = json.loads(response.content)
        quoted_price = payload.get("price_usd", payload.get("price", payload.get("doge_usd")))
        self.assertIsNotNone(quoted_price)
        self.assertAlmostEqual(float(quoted_price), 0.12345678, places=8)
        self.assertTrue(lookup.called)
        self.assertIn("DOGE-USD", str(lookup.call_args).upper())

    def test_doge_price_endpoint_fails_closed_when_the_live_quote_is_unavailable(self):
        with patch(
            "commerce.views.fetch_json",
            side_effect=views.DogeLookupError("Live DOGE price is unavailable."),
        ):
            response = self.client.get("/api/doge-price/")

        self.assertEqual(response.status_code, 503)
        self.assertTrue(response.headers.get("Content-Type", "").startswith("application/json"))
        payload = json.loads(response.content)
        self.assertTrue(payload.get("error"))

    def test_doge_price_endpoint_reuses_its_short_live_quote_cache(self):
        with patch("commerce.views.fetch_json", return_value={"price": "0.12345678"}) as lookup:
            first = self.client.get("/api/doge-price/")
            second = self.client.get("/api/doge-price/")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(lookup.call_count, 1)

    def test_doge_price_endpoint_rejects_non_positive_or_non_finite_quotes(self):
        for invalid_price in ("0", "-0.1", "NaN"):
            with self.subTest(price=invalid_price):
                self._clear_price_cache()
                with patch("commerce.views.fetch_json", return_value={"price": invalid_price}):
                    response = self.client.get("/api/doge-price/")
                self.assertEqual(response.status_code, 503)


class MerchantKitCheckoutEmbedTests(SimpleTestCase):
    def test_merchant_kit_configures_and_generates_the_live_checkout(self):
        response = Client().get("/merchant-kit/")
        self.assertEqual(response.status_code, 200)
        html = response.content.decode("utf-8")
        doge_tools = (STATIC / "js" / "doge_tools.js").read_text(encoding="utf-8")

        control_alternatives = {
            "merchant": ("integrationSiteName", "checkoutEmbedMerchant", "dogeCheckoutMerchant"),
            "address": ("integrationAddress", "checkoutEmbedAddress", "dogeCheckoutAddress"),
            "offer": ("integrationOffer", "checkoutEmbedOffer", "dogeCheckoutOffer"),
            "usd": ("integrationUsd", "checkoutEmbedUsd", "dogeCheckoutUsd"),
            "memo": ("integrationMemo", "checkoutEmbedMemo", "dogeCheckoutMemo"),
            "button": ("integrationButtonText", "checkoutEmbedButtonText", "dogeCheckoutButtonText"),
            "preview": ("integrationPreview", "checkoutEmbedPreview", "dogeCheckoutPreview"),
            "output": ("integrationSnippetOut", "checkoutEmbedSnippet", "dogeCheckoutSnippet"),
        }
        for label, alternatives in control_alternatives.items():
            with self.subTest(control=label):
                self.assertTrue(
                    any(f'id="{control_id}"' in html for control_id in alternatives),
                    f"Missing live checkout {label} control; expected one of {alternatives}",
                )

        generator_source = f"{html}\n{doge_tools}"
        self.assertIn("doge_checkout.js", generator_source)
        self.assertRegex(generator_source, re.compile(r"data-doge-checkout|doge-checkout", re.IGNORECASE))
        self.assertRegex(
            html,
            re.compile(
                r"(?:live|embed(?:ded)?|portable)\s+(?:DOGE\s+)?checkout|"
                r"(?:DOGE\s+)?checkout.{0,40}(?:live|embed(?:ded)?|portable)",
                re.IGNORECASE | re.DOTALL,
            ),
        )
