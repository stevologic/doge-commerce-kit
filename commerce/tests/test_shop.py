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
FORBIDDEN_WORD = re.compile(r"\b(?:giveaway|win(?:s|ner|ners|ning)?)\b", re.IGNORECASE)
PIN_WORD = re.compile(r"\bpin\b", re.IGNORECASE)
TWO_DESIGNS = re.compile(r"two designs", re.IGNORECASE)
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
        self.assertIn("100", html)
        self.assertIn("pens total", html)
        self.assertIn("for the first senders", html)
        self.assertIn("PINEAPPLE DOGE", html)
        self.assertNotIn("DOGE PINEAPPLE", html)
        self.assertIsNone(TWO_DESIGNS.search(html))
        self.assertIn("Launching soon", html)
        self.assertIn("$11.99", html)
        self.assertIn("$8.99", html)
        self.assertIn("$18.99", html)
        self.assertIn("$17.99", html)
        self.assertIn("Pens ship by: TBA", html)
        self.assertIn("pineapple-Doge pen", html)
        self.assertIn("get a pen, counted in the order they arrive", html)
        self.assertIn("X Money has the rails. Dogecoin has the currency.", html)
        self.assertIn("@MadeItHappenX", html)
        self.assertIn("https://x.com/MadeItHappenX", html)
        self.assertIn("The first 100 X Money sends of any amount to @MadeItHappenX", html)
        self.assertIn(
            f"or DOGE sends to <code>{DONATION_ADDRESS}</code>, get a pen, counted in the order they arrive.",
            html,
        )
        self.assertRegex(html, r"pineapple-pen-single(?:\.[0-9a-f]+)?\.webp")
        self.assertNotIn("pineapple-pen-variants", html)
        self.assertIn("PINEAPPLE DOGE pineapple-Doge pen", html)
        self.assertIn('width="710"', html)
        self.assertIn('height="934"', html)
        self.assertIn('usd="5.00"', html)
        self.assertIn("Quick $5 DOGE checkout", html)
        self.assertIn(
            "X Money sends to @MadeItHappenX and direct DOGE sends to the address can be any amount. The $5 checkout is just a quick option.",
            html,
        )
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
        self.assertIn("get a pen, counted in the order they arrive", promo)
        self.assertIsNone(PIN_WORD.search(promo))

    def test_banned_word_guard_catches_winner_copy(self):
        self.assertIsNotNone(FORBIDDEN_WORD.search("Every winner is notified."))

    def test_shop_page_has_pay_block_and_no_address_form(self):
        html = self._shop_html()
        self.assertIn("doge-checkout", html)
        self.assertIn("/qr.svg", html)
        self.assertIn('id="pay-with-doge"', html)
        self.assertIn("Quick $5 DOGE checkout", html)
        self.assertIn('usd="5.00"', html)
        self.assertNotIn("<form", html)
        self.assertNotIn('name="address"', html)
        self.assertNotIn('name="mailing"', html)
        self.assertNotIn('name="name"', html)

    def test_any_amount_line_names_x_money_and_doge(self):
        html = self._shop_html()
        line = (
            "X Money sends to @MadeItHappenX and direct DOGE sends to the address "
            "can be any amount. The $5 checkout is just a quick option."
        )
        self.assertIn(line, html)
        self.assertIn("X Money", line)
        self.assertIn("DOGE", line)
        self.assertGreaterEqual(html.count(line), 2)

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
            self.assertIsNone(TWO_DESIGNS.search(text), path)
            self.assertNotIn("DOGE PINEAPPLE", text)
            if path.name == "shop.html":
                for banned in BANNED_IMAGES + BANNED_PIN_ART:
                    self.assertNotIn(banned, text)
                promo = PROMO_SECTION.search(text)
                self.assertIsNotNone(promo)
                self.assertIsNone(PIN_WORD.search(promo.group(0)))
                self.assertNotIn("pineapple-pen-variants", text)
