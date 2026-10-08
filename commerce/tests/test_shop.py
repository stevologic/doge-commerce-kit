import re
from pathlib import Path
from unittest.mock import patch

from django.test import Client, SimpleTestCase

from commerce import shop as shop_catalog
from commerce.views import DONATION_ADDRESS


ROOT = Path(__file__).resolve().parents[1]
SHOP_SOURCES = [
    ROOT / "shop.py",
    ROOT / "templates" / "commerce" / "shop.html",
]
FORBIDDEN_WORD = re.compile(r"\b(?:giveaway|win)\b", re.IGNORECASE)
PIN_WORD = re.compile(r"\bpin\b", re.IGNORECASE)
BANNED_IMAGES = ("classic-doge.jpg", "cheems-doge.jpg")
BANNED_PIN_ART = (
    "pin-doge-pineapple",
    "pin-pineapple-doge",
    "pineapple-pin-photo",
    "pineapple-pin-variants",
)
PROMO_SECTION = re.compile(
    r'<section\b[^>]*\bid="pen-promo"[^>]*>.*?</section>',
    re.IGNORECASE | re.DOTALL,
)


class ShopPageTests(SimpleTestCase):
    def setUp(self):
        self.client = Client()

    def _shop_html(self):
        response = self.client.get("/shop/")
        self.assertEqual(response.status_code, 200)
        return response.content.decode("utf-8")

    def test_shop_page_returns_200_with_campaign_facts(self):
        html = self._shop_html()
        self.assertIn(DONATION_ADDRESS, html)
        self.assertIn("120", html)
        self.assertGreaterEqual(html.count("60"), 2)
        self.assertIn("DOGE PINEAPPLE", html)
        self.assertIn("PINEAPPLE DOGE", html)
        self.assertIn("Launching soon", html)
        self.assertIn("$11.99", html)
        self.assertIn("$8.99", html)
        self.assertIn("$18.99", html)
        self.assertIn("$17.99", html)
        self.assertIn("Pens ship by: TBA", html)
        self.assertIn("pineapple-Doge pen", html)
        self.assertIn("get a pen mailed", html)
        self.assertIn("X Money has the rails. Dogecoin has the currency.", html)
        self.assertRegex(html, r"pineapple-pen-variants(?:\.[0-9a-f]+)?\.webp")
        self.assertIn("Two pineapple-Doge pens: DOGE PINEAPPLE and PINEAPPLE DOGE", html)
        self.assertIn('width="1400"', html)
        self.assertIn('height="1024"', html)
        self.assertNotIn("PLACEHOLDER", html)
        self.assertNotIn("Swap this file", html)
        self.assertNotIn("placeholder", html.lower())
        self.assertIsNone(FORBIDDEN_WORD.search(html))
        for banned in BANNED_IMAGES + BANNED_PIN_ART:
            self.assertNotIn(banned, html)

    def test_promo_section_uses_pen_and_not_pin(self):
        html = self._shop_html()
        match = PROMO_SECTION.search(html)
        self.assertIsNotNone(match)
        promo = match.group(0)
        self.assertIn("pen", promo.lower())
        self.assertIn("get a pen mailed", promo)
        self.assertIsNone(PIN_WORD.search(promo))

    def test_shop_page_has_pay_block_and_no_address_form(self):
        html = self._shop_html()
        self.assertIn("doge-checkout", html)
        self.assertIn("/qr.svg", html)
        self.assertIn('id="pay-with-doge"', html)
        self.assertNotIn("<form", html)
        self.assertNotIn('name="address"', html)
        self.assertNotIn('name="mailing"', html)
        self.assertNotIn('name="name"', html)

    def test_shop_is_in_nav_and_sitemap(self):
        home = self.client.get("/").content.decode("utf-8")
        self.assertIn('href="/shop/"', home)
        self.assertGreaterEqual(home.count(">Shop<"), 2)
        sitemap = self.client.get("/sitemap.xml")
        self.assertEqual(sitemap.status_code, 200)
        self.assertIn("/shop/", sitemap.content.decode("utf-8"))

    def test_launching_soon_is_a_single_flag(self):
        self.assertFalse(shop_catalog.PRINTFUL_CATALOG_LIVE)
        with patch("commerce.shop.PRINTFUL_CATALOG_LIVE", True):
            html = self._shop_html()
        self.assertNotIn("Launching soon", html)
        self.assertIn("Pay with DOGE", html)

    def test_shop_sources_avoid_forbidden_words_and_banned_photos(self):
        for path in SHOP_SOURCES:
            text = path.read_text(encoding="utf-8")
            match = FORBIDDEN_WORD.search(text)
            self.assertIsNone(match, f"{path} contains {match.group(0)!r}" if match else path)
            if path.name == "shop.html":
                for banned in BANNED_IMAGES + BANNED_PIN_ART:
                    self.assertNotIn(banned, text)
                promo = PROMO_SECTION.search(text)
                self.assertIsNotNone(promo)
                self.assertIsNone(PIN_WORD.search(promo.group(0)))
