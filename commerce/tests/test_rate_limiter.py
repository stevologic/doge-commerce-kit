import json
from pathlib import Path
from unittest.mock import patch

from django.test import Client, SimpleTestCase
from py_mini_racer import MiniRacer


ROOT = Path(__file__).resolve().parents[1]
from commerce.tests.scratch_path import scratch_dir

SCRATCH = scratch_dir()
CORE_JS = ROOT / "static" / "commerce" / "js" / "rate_limit_core.js"

RATE_TEST_BOOT = r"""
var window = globalThis;
var fetchCalls = [];
var timeouts = [];
var clock = 0;
Date.now = function() { return clock; };
globalThis.fetch = function(input, init) {
  fetchCalls.push(String(input));
  return Promise.resolve({
    ok: true,
    status: 200,
    headers: {
      get: function(name) {
        if (name === "x-ratelimit-remaining") return "9";
        if (name === "x-ratelimit-limit") return "10";
        return null;
      }
    }
  });
};
globalThis.setTimeout = function(fn, ms) {
  timeouts.push(ms);
  clock += ms;
  if (typeof fn === "function") fn();
  return timeouts.length;
};
var limiter = window.createRateLimiter({
  fetch: globalThis.fetch,
  now: function() { return clock; },
  setTimeout: globalThis.setTimeout,
});
window.dogeLimitedFetch = limiter.fetch;
window.dogeRateLimit = limiter;
"""


class RateLimiterCoreTests(SimpleTestCase):
    def _runtime(self):
        ctx = MiniRacer()
        ctx.eval(CORE_JS.read_text(encoding="utf-8") + RATE_TEST_BOOT)
        return ctx

    def test_limited_fetch_queues_and_throttles_coinbase(self):
        ctx = self._runtime()
        result = json.loads(
            ctx.eval("""
              (async () => {
                const first = window.dogeLimitedFetch("https://api.exchange.coinbase.com/products/DOGE-USD/ticker");
                const second = window.dogeLimitedFetch("https://api.exchange.coinbase.com/products/DOGE-USD/ticker");
                await Promise.all([first, second]);
                const state = window.dogeRateLimit.getState().find((item) => item.key === "coinbase");
                return JSON.stringify({
                  fetchCalls: fetchCalls.length,
                  timeouts: timeouts,
                  clock: clock,
                  status: state.status,
                  remaining: state.remaining,
                  queueDepth: state.queueDepth,
                });
              })()
            """).get(timeout=30)
        )
        self.assertEqual(result["fetchCalls"], 2)
        self.assertGreaterEqual(result["clock"], 110)
        self.assertIn(110, result["timeouts"])
        self.assertEqual(result["remaining"], 9)
        self.assertEqual(result["queueDepth"], 0)

    def test_parse_headers_and_ingest_server_state(self):
        ctx = self._runtime()
        result = json.loads(
            ctx.eval("""
              (async () => {
                const response = {
                  ok: true,
                  status: 200,
                  headers: { get: function() { return null; } }
                };
                response.headers.get = function(name) {
                  if (name === "x-bc-request-count") return "12";
                  if (name === "x-bc-request-limit") return "1440";
                  return null;
                };
                window.dogeRateLimit.parseHeaders("blockchair", response);
                window.dogeRateLimit.ingestServerState({
                  providers: {
                    blockcypher: { used: 4, limit: 200, status: "ready", updated_at: 1710000000 }
                  }
                });
                const blockchair = window.dogeRateLimit.getState().find((item) => item.key === "blockchair");
                const blockcypher = window.dogeRateLimit.getState().find((item) => item.key === "blockcypher");
                return JSON.stringify({
                  blockchairUsed: blockchair.used,
                  blockchairRemaining: blockchair.remaining,
                  blockcypherStatus: blockcypher.status,
                  blockcypherRemaining: blockcypher.remaining,
                });
              })()
            """).get(timeout=30)
        )
        self.assertEqual(result["blockchairUsed"], 12)
        self.assertEqual(result["blockchairRemaining"], 1428)
        self.assertEqual(result["blockcypherStatus"], "ready")
        self.assertEqual(result["blockcypherRemaining"], 196)

    def test_rate_status_endpoint(self):
        client = Client()
        with patch("commerce.views.SERVER_RATE_STATE", {
            "blockchair": {"used": 2, "limit": 1440, "status": "error", "last_error": "limited", "updated_at": 1},
            "blockcypher": {"used": 5, "limit": 200, "status": "ready", "last_error": "", "updated_at": 2},
        }):
            response = client.get("/api/rate-status/")
        self.assertEqual(response.status_code, 200)
        payload = json.loads(response.content)
        self.assertEqual(payload["providers"]["blockcypher"]["status"], "ready")
        self.assertEqual(payload["providers"]["blockchair"]["status"], "error")

    def test_concurrent_fetch_respects_min_interval(self):
        ctx = self._runtime()
        result = json.loads(
            ctx.eval("""
              (async () => {
                const first = window.dogeLimitedFetch("https://api.exchange.coinbase.com/products/DOGE-USD/ticker");
                const second = window.dogeLimitedFetch("https://api.exchange.coinbase.com/products/DOGE-USD/ticker");
                const third = window.dogeLimitedFetch("https://api.exchange.coinbase.com/products/DOGE-USD/ticker");
                await Promise.all([first, second, third]);
                return JSON.stringify({
                  fetchCalls: fetchCalls.length,
                  timeouts: timeouts,
                  clock: clock,
                });
              })()
            """).get(timeout=30)
        )
        SCRATCH.mkdir(parents=True, exist_ok=True)
        (SCRATCH / "rate-limiter-concurrent.txt").write_text(
            "\n".join(
                [
                    f"fetchCalls={result['fetchCalls']}",
                    f"timeouts={result['timeouts']}",
                    f"clock={result['clock']}",
                ]
            )
            + "\n",
            encoding="utf-8",
        )
        self.assertEqual(result["fetchCalls"], 3)
        self.assertGreaterEqual(result["clock"], 220)
        self.assertGreaterEqual(result["timeouts"].count(110), 2)

    def test_set_channel_updates_state(self):
        ctx = self._runtime()
        channel = ctx.eval("""
          (async () => {
            window.dogeRateLimit.setChannel("blockchair", "client");
            return window.dogeRateLimit.getState().find((item) => item.key === "blockchair").channel;
          })()
        """).get(timeout=30)
        self.assertEqual(channel, "client")

    def test_capture_rate_limiter_runtime_log(self):
        ctx = self._runtime()
        payload = json.loads(
            ctx.eval("""
              (async () => {
                const first = window.dogeLimitedFetch("https://api.exchange.coinbase.com/products/DOGE-USD/ticker");
                const second = window.dogeLimitedFetch("https://api.exchange.coinbase.com/products/DOGE-USD/ticker");
                await Promise.all([first, second]);
                window.dogeRateLimit.ingestServerState({ providers: { blockcypher: { used: 1, limit: 200, status: "ready", updated_at: 1 } } });
                return JSON.stringify({
                  fetchCalls: fetchCalls.length,
                  timeouts: timeouts,
                  clock: clock,
                  state: window.dogeRateLimit.getState().map((item) => item.key + ":" + item.status).join(","),
                });
              })()
            """).get(timeout=30)
        )
        SCRATCH.mkdir(parents=True, exist_ok=True)
        lines = [
            f"fetchCalls={payload['fetchCalls']}",
            f"timeouts={payload['timeouts']}",
            f"clock={payload['clock']}",
            f"state={payload['state']}",
        ]
        (SCRATCH / "rate-limiter-logic.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
        self.assertEqual(payload["fetchCalls"], 2)
        self.assertIn(110, payload["timeouts"])
        self.assertIn("coinbase:", payload["state"])
        self.assertIn("blockcypher:", payload["state"])