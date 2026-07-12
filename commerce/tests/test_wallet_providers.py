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

    def test_blockchair_payment_activity_excludes_outgoing_transactions(self):
        incoming_txid = "a" * 64
        outgoing_txid = "b" * 64
        address_data = {
            "address": {"transaction_count": 2},
            "transactions": [
                {"hash": incoming_txid, "balance_change": 125000000, "block_id": 1, "time": 1},
                {"hash": outgoing_txid, "balance_change": -50000000, "block_id": 1, "time": 2},
            ],
        }
        with patch(
            "commerce.views.blockchair_address_payload",
            return_value=(address_data, "https://example.test/address", {}),
        ):
            result = views.blockchair_address_transactions("DTW2M5oEW97WbmYJRM71qD7uE6xfJs1MUK", 10)
        self.assertEqual([row["txid"] for row in result["transactions"]], [incoming_txid])
        self.assertEqual(result["transactions"][0]["doge"], 1.25)

    def test_blockchair_direct_schema_preserves_time_and_confirmation_count(self):
        address = "DTW2M5oEW97WbmYJRM71qD7uE6xfJs1MUK"
        txid = "f" * 64
        address_data = {
            "address": {"transaction_count": 1},
            "transactions": [
                {
                    "hash": txid,
                    "balance_change": 125000000,
                    "block_id": 198,
                    "time": "2026-07-12 12:34:56",
                }
            ],
        }
        payload = {"data": {address: address_data}, "context": {"state": 200}}
        with patch("commerce.views.cached_provider_lookup", return_value=payload), patch(
            "commerce.views.throttle_server_provider"
        ):
            parsed_address, _url, parsed_payload = views.blockchair_address_payload(
                address,
                transaction_details="true",
            )
        with patch("commerce.views.blockchair_address_payload", return_value=(parsed_address, "https://example.test", parsed_payload)):
            result = views.blockchair_address_transactions(address, 10)
        self.assertEqual(result["transactions"][0]["confirmations"], 3)
        self.assertEqual(result["transactions"][0]["time"], "2026-07-12T12:34:56Z")

    def test_blockchair_transaction_parses_direct_schema_and_chain_height(self):
        txid = "1" * 64
        address = "DTW2M5oEW97WbmYJRM71qD7uE6xfJs1MUK"
        payload = {
            "data": {
                txid: {
                    "transaction": {"hash": txid, "block_id": 198},
                    "outputs": [{"value": 200000000, "type": "pubkeyhash", "recipient": address}],
                }
            },
            "context": {"state": 200},
        }
        with patch("commerce.views.cached_provider_lookup", return_value=payload), patch(
            "commerce.views.throttle_server_provider"
        ):
            result, _url, _provider = views.blockchair_transaction(txid)
        self.assertEqual(result["confirmations"], 3)
        self.assertEqual(result["outputs"][0]["scriptPubKey"]["addresses"], [address])

    def test_blockcypher_payment_activity_excludes_address_inputs(self):
        incoming_txid = "d" * 64
        outgoing_txid = "e" * 64
        payload = {
            "n_tx": 2,
            "txrefs": [
                {"tx_hash": incoming_txid, "value": 125000000, "tx_input_n": -1, "confirmations": 1},
                {"tx_hash": outgoing_txid, "value": 50000000, "tx_input_n": 0, "confirmations": 1},
            ],
        }
        with patch("commerce.views.cached_provider_lookup", return_value=payload):
            result = views.blockcypher_address_transactions("DTW2M5oEW97WbmYJRM71qD7uE6xfJs1MUK", 10)
        self.assertEqual([row["txid"] for row in result["transactions"]], [incoming_txid])

    def test_fresh_wallet_activity_uses_short_payment_cache(self):
        client = Client()
        sample = {
            "address": "DTW2M5oEW97WbmYJRM71qD7uE6xfJs1MUK",
            "transactions": [],
            "provider_name": "test",
        }
        with patch("commerce.views.latest_transactions", return_value=sample) as lookup:
            response = client.get(
                "/api/wallet/transactions/?address=DTW2M5oEW97WbmYJRM71qD7uE6xfJs1MUK&limit=25&fresh=1"
            )
        self.assertEqual(response.status_code, 200)
        lookup.assert_called_once_with(
            "DTW2M5oEW97WbmYJRM71qD7uE6xfJs1MUK",
            25,
            cache_ttl=views.DOGE_PAYMENT_POLL_CACHE_TTL,
        )

    def test_transaction_validation_reports_confirmation_pending(self):
        client = Client()
        address = "DTW2M5oEW97WbmYJRM71qD7uE6xfJs1MUK"
        txid = "c" * 64
        chain_tx = {
            "hash": txid,
            "confirmations": 0,
            "outputs": [
                {
                    "value": 200000000,
                    "scriptPubKey": {"addresses": [address]},
                }
            ],
        }
        with patch(
            "commerce.views.latest_transaction",
            return_value=(chain_tx, "https://example.test/tx", "test chain"),
        ) as lookup:
            response = client.post(
                "/api/transaction/validate/",
                data=json.dumps(
                    {
                        "txid": txid,
                        "address": address,
                        "doge": 2,
                        "min_confirmations": 1,
                        "fresh": True,
                    }
                ),
                content_type="application/json",
            )
        payload = json.loads(response.content)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(payload["passed"])
        self.assertEqual(payload["status"], "pending")
        lookup.assert_called_once_with(txid, cache_ttl=views.DOGE_PAYMENT_POLL_CACHE_TTL)

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
