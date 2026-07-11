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
                "Merchant profile and options",
            ],
        )

    def test_pos_page_relays_currency_exchange_flow(self):
        self._assert_contains_all(
            "/pos/",
            [
                "Accept Dogecoin for goods priced in dollars",
                "USD they know",
                "They scan and pay",
                "Verify before fulfillment",
                "posConfirmTransaction",
                "posMarkPaid",
                "posFeeAuto",
                "posAutoVerify",
                "posAutoVerifyYes",
                "dogePosTerminal",
            ],
        )

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