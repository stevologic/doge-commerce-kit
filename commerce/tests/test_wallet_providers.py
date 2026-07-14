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

    def test_blockchair_unconfirmed_payment_is_available_for_detection(self):
        address = "DTW2M5oEW97WbmYJRM71qD7uE6xfJs1MUK"
        txid = "0" * 64
        address_data = {
            "address": {"transaction_count": 1},
            "transactions": [{
                "hash": txid,
                "balance_change": 125000000,
                "block_id": -1,
                "time": "2026-07-14 18:30:00",
            }],
        }
        with patch("commerce.views.blockchair_address_payload", return_value=(address_data, "https://example.test", {})):
            result = views.blockchair_address_transactions(address, 10)
        self.assertEqual(result["transactions"][0]["status"], "pending")
        self.assertEqual(result["transactions"][0]["confirmations"], 0)

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

    def test_blockcypher_unconfirmed_payment_is_available_for_detection(self):
        incoming_txid = "9" * 64
        outgoing_txid = "8" * 64
        payload = {
            "n_tx": 2,
            "unconfirmed_txrefs": [
                {
                    "tx_hash": incoming_txid,
                    "value": 225000000,
                    "tx_input_n": -1,
                    "confirmations": 0,
                    "received": "2026-07-14T18:30:00Z",
                    "block_height": -1,
                },
                {
                    "tx_hash": outgoing_txid,
                    "value": 225000000,
                    "tx_input_n": 0,
                    "confirmations": 0,
                    "received": "2026-07-14T18:30:00Z",
                    "block_height": -1,
                },
            ],
        }
        with patch("commerce.views.cached_provider_lookup", return_value=payload):
            result = views.blockcypher_address_transactions("DTW2M5oEW97WbmYJRM71qD7uE6xfJs1MUK", 10)
        self.assertEqual(len(result["transactions"]), 1)
        self.assertEqual(result["transactions"][0]["txid"], incoming_txid)
        self.assertEqual(result["transactions"][0]["status"], "pending")
        self.assertEqual(result["transactions"][0]["confirmations"], 0)

    def test_fresh_payment_activity_prefers_mempool_capable_provider(self):
        address = "DTW2M5oEW97WbmYJRM71qD7uE6xfJs1MUK"
        sample = {"address": address, "transactions": [{"txid": "7" * 64, "confirmations": 0}]}
        with patch.object(views, "DOGE_BLOCKBOOK_BASE_URL", ""), patch.object(
            views, "DOGE_ENABLE_BLOCKCYPHER_FALLBACK", True
        ), patch("commerce.views.blockcypher_address_transactions", return_value=sample) as pending_lookup, patch(
            "commerce.views.blockchair_address_transactions"
        ) as blockchair_lookup:
            result = views.latest_transactions(address, 25, cache_ttl=5, prefer_pending=True)
        self.assertEqual(result, sample)
        pending_lookup.assert_called_once_with(address, 25, cache_ttl=5, allow_stale=False)
        blockchair_lookup.assert_not_called()

    def test_fresh_provider_failure_does_not_reuse_stale_activity(self):
        cache_key = ("test-no-stale-payment-activity",)
        views.DOGE_LOOKUP_CACHE[cache_key] = {
            "loaded_at": 0,
            "payload": {"transactions": [{"txid": "6" * 64}]},
        }

        def unavailable():
            raise RuntimeError("provider unavailable")

        try:
            with self.assertRaises(RuntimeError):
                views.cached_provider_lookup(
                    cache_key,
                    unavailable,
                    ttl=0,
                    allow_stale=False,
                )
        finally:
            views.DOGE_LOOKUP_CACHE.pop(cache_key, None)

    def test_missing_blockchair_transaction_is_not_treated_as_valid(self):
        txid = "5" * 64
        with patch("commerce.views.cached_provider_lookup", return_value={"data": {}}), patch(
            "commerce.views.throttle_server_provider"
        ):
            with self.assertRaises(views.DogeLookupError):
                views.blockchair_transaction(txid)

    def test_fresh_payment_activity_falls_back_when_mempool_provider_fails(self):
        address = "DTW2M5oEW97WbmYJRM71qD7uE6xfJs1MUK"
        sample = {"address": address, "transactions": []}
        with patch.object(views, "DOGE_BLOCKBOOK_BASE_URL", ""), patch.object(
            views, "DOGE_ENABLE_BLOCKCYPHER_FALLBACK", True
        ), patch("commerce.views.blockcypher_address_transactions", side_effect=RuntimeError("rate limited")), patch(
            "commerce.views.blockchair_address_transactions", return_value=sample
        ) as blockchair_lookup:
            result = views.latest_transactions(address, 25, cache_ttl=5, prefer_pending=True)
        self.assertEqual(result, sample)
        blockchair_lookup.assert_called_once_with(address, 25, cache_ttl=5, allow_stale=False)

    def test_fresh_transaction_lookup_prefers_mempool_capable_provider(self):
        txid = "4" * 64
        sample = ({"hash": txid, "confirmations": 0, "outputs": [{}]}, "https://example.test", "test")
        with patch.object(views, "DOGE_BLOCKBOOK_BASE_URL", ""), patch.object(
            views, "DOGE_ENABLE_BLOCKCYPHER_FALLBACK", True
        ), patch("commerce.views.blockcypher_transaction", return_value=sample) as pending_lookup, patch(
            "commerce.views.blockchair_transaction"
        ) as blockchair_lookup:
            result = views.latest_transaction(txid, cache_ttl=5, prefer_pending=True)
        self.assertEqual(result, sample)
        pending_lookup.assert_called_once_with(txid, cache_ttl=5, allow_stale=False)
        blockchair_lookup.assert_not_called()

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
            prefer_pending=True,
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
        lookup.assert_called_once_with(
            txid,
            cache_ttl=views.DOGE_PAYMENT_POLL_CACHE_TTL,
            prefer_pending=True,
        )

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
