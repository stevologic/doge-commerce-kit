from django.test import Client, SimpleTestCase


class HumanCentricPageTests(SimpleTestCase):
    def setUp(self):
        self.client = Client()

    def _assert_contains_all(self, path, markers):
        response = self.client.get(path)
        self.assertEqual(response.status_code, 200, path)
        html = response.content.decode("utf-8")
        for marker in markers:
            self.assertIn(marker, html, f"{path} missing {marker!r}")

    def test_wallet_url_redirects_to_pos(self):
        response = self.client.get("/wallet/")
        self.assertEqual(response.status_code, 301)
        self.assertEqual(response.headers["Location"], "/pos/")

    def test_pos_page_contains_wallet_setup(self):
        self._assert_contains_all(
            "/pos/",
            [
                "posGenerateWallet",
                "posNewWallet",
                "posNewWalletWif",
                "posDownloadWallet",
                # Business name now lives in the wallet setup, next to the address.
                "Business name",
                "posMerchant",
            ],
        )

    def test_pos_page_relays_currency_exchange_flow(self):
        self._assert_contains_all(
            "/pos/",
            [
                "Charge in dollars. Get paid in DOGE.",
                "Set the price",
                "Customer scans",
                "Verify payment",
                "posConfirmTransaction",
                "posMarkPaid",
                # Memo is a primary step-1 field; the auto network fee estimate
                # shows in the step-2 payment details.
                "posMemo",
                "posFeeDogeOut",
                "Network fee",
                "posAutoVerify",
                "posAutoVerifyYes",
                "dogePosTerminal",
            ],
        )

    def test_pos_page_drops_sale_options_collapsible(self):
        response = self.client.get("/pos/")
        html = response.content.decode("utf-8")
        # The Sale options disclosure and its manual fee controls were removed
        # so the flow is price -> QR -> verify with an automatic network fee.
        for marker in ("Sale options", "posFeeAuto", "posProfileDetails", "posSaveMerchant"):
            self.assertNotIn(marker, html)

    def test_pos_page_hides_secondary_tools_behind_disclosures(self):
        response = self.client.get("/pos/")
        html = response.content.decode("utf-8")
        # Advanced tools stay in the page (JS depends on the ids) but live
        # inside collapsed <details> so the core flow is price -> QR -> verify.
        for marker in ("posManualDetails", "pos-history-details", "posUriOut", "posTxId"):
            self.assertIn(marker, html)
        # The old always-visible clutter is gone.
        for marker in ("pos-step-rail", "pos-transaction-toggle-card", "next-steps-strip"):
            self.assertNotIn(marker, html)

    def test_tools_page_relays_snippet_marketplace(self):
        self._assert_contains_all(
            "/merchant-kit/",
            [
                "Snippet marketplace",
                "toolsMarketplaceHint",
                "Browse all",
                "applySavedWalletTools",
            ],
        )

    def test_statistics_page_relays_market_data_and_utility(self):
        self._assert_contains_all(
            "/statistics/",
            [
                "statsUtilityTitle",
                "Low-fee counter sales",
                "dogeMarketChart",
                "Technical analysis",
                "not investment advice",
            ],
        )

    def test_playbook_page_relays_utility_benefits(self):
        self._assert_contains_all(
            "/playbook/",
            [
                "Why humans choose DOGE",
                "No chargebacks",
                "playbookBenefitsTitle",
                "acceptance-flow",
            ],
        )

    def test_home_page_relays_intent_entry_points(self):
        self._assert_contains_all(
            "/",
            [
                "Make Dogecoin feel normal",
                "Browse snippet tools",
                "Take a DOGE payment",
                "role-path-card",
            ],
        )

    def test_faq_and_technical_link_back_to_tools(self):
        faq = self.client.get("/faq/").content.decode("utf-8")
        technical = self.client.get("/technical-details/").content.decode("utf-8")
        self.assertIn("Browse tools", faq)
        self.assertIn("Browse snippets", faq)
        self.assertIn("technicalHumanPathTitle", technical)
        self.assertIn("Snippet marketplace", technical)