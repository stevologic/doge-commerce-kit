import json
from pathlib import Path
from unittest.mock import patch

from django.test import Client, SimpleTestCase

from commerce import views


from commerce.tests.scratch_path import scratch_dir

SCRATCH = scratch_dir()


class BlockchairProviderTests(SimpleTestCase):
    def test_blockchair_balance_parses_dashboard_payload(self):
        payload = {
            "data": {
                "addresses": {
                    "DTW2M5oEW97WbmYJRM71qD7uE6xfJs1MUK": {
                        "address": {
                            "balance": 250000000,
                            "received": 500000000,
                            "spent": 250000000,
                            "transaction_count": 4,
                        }
                    }
                }
            }
        }
        address_data = payload["data"]["addresses"]["DTW2M5oEW97WbmYJRM71qD7uE6xfJs1MUK"]
        with patch(
            "commerce.views.blockchair_address_payload",
            return_value=(address_data, "https://api.blockchair.com/dogecoin/dashboards/address/DTW2M5oEW97WbmYJRM71qD7uE6xfJs1MUK", payload),
        ):
            result = views.blockchair_balance("DTW2M5oEW97WbmYJRM71qD7uE6xfJs1MUK")
        self.assertEqual(result["provider_name"], "Blockchair")
        self.assertEqual(result["final_balance_doge"], 2.5)
        self.assertEqual(result["transactions"], 4)

    def test_wallet_balance_endpoint_reports_blockchair_provider(self):
        client = Client()
        sample = {
            "address": "DTW2M5oEW97WbmYJRM71qD7uE6xfJs1MUK",
            "provider_name": "Blockchair",
            "final_balance_doge": 1.25,
            "unconfirmed_balance_doge": 0,
            "total_received_doge": 2.5,
            "transactions": 2,
            "updated_at": "2026-06-27T00:00:00Z",
        }
        with patch("commerce.views.latest_balance", return_value=sample):
            response = client.get("/api/wallet/balance/?address=DTW2M5oEW97WbmYJRM71qD7uE6xfJs1MUK")
        self.assertEqual(response.status_code, 200)
        body = json.loads(response.content)
        self.assertEqual(body["provider_name"], "Blockchair")

    def test_known_provider_urls_are_declared(self):
        source = open(views.__file__, encoding="utf-8").read()
        self.assertIn("https://api.blockchair.com/dogecoin", source)
        self.assertIn("https://api.blockcypher.com/v1/doge/main", source)

    def test_capture_api_responses_to_scratch(self):
        client = Client()
        address = "DTW2M5oEW97WbmYJRM71qD7uE6xfJs1MUK"
        balance_sample = {
            "address": address,
            "provider_name": "BlockCypher",
            "final_balance_doge": 1.25,
            "unconfirmed_balance_doge": 0,
            "total_received_doge": 2.5,
            "transactions": 2,
            "updated_at": "2026-06-27T00:00:00Z",
        }
        tx_sample = {
            "address": address,
            "provider_name": "BlockCypher",
            "total_transactions": 2,
            "transactions": [
                {
                    "txid": "abc123",
                    "short_txid": "abc123",
                    "doge": "1.0",
                    "status": "confirmed",
                    "time": "2026-06-27T00:00:00Z",
                    "explorer_url": "https://blockchair.com/dogecoin/transaction/abc123",
                }
            ],
        }
        with patch("commerce.views.latest_balance", return_value=balance_sample), patch(
            "commerce.views.latest_transactions", return_value=tx_sample
        ):
            balance_response = client.get(f"/api/wallet/balance/?address={address}")
            tx_response = client.get(f"/api/wallet/transactions/?address={address}&limit=5")
            rate_response = client.get("/api/rate-status/")
        payload = {
            "balance": json.loads(balance_response.content),
            "transactions": json.loads(tx_response.content),
            "rate_status": json.loads(rate_response.content),
        }
        SCRATCH.mkdir(parents=True, exist_ok=True)
        (SCRATCH / "api-responses.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
        self.assertEqual(payload["balance"]["provider_name"], "BlockCypher")
        self.assertIn("providers", payload["rate_status"])