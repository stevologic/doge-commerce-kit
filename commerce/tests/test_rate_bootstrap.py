from pathlib import Path

from django.test import SimpleTestCase
from py_mini_racer import MiniRacer


ROOT = Path(__file__).resolve().parents[1]
from commerce.tests.scratch_path import scratch_dir

SCRATCH = scratch_dir()
CORE_JS = ROOT / "static" / "commerce" / "js" / "rate_limit_core.js"
BOOTSTRAP_JS = ROOT / "static" / "commerce" / "js" / "rate_limit_bootstrap.js"

BOOT_TEST_ENV = r"""
var window = globalThis;
var fetchCalls = [];
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
  if (typeof fn === "function") fn();
  return fetchCalls.length;
};
globalThis.clearInterval = function() {};
globalThis.setInterval = function() { return 1; };
globalThis.requestAnimationFrame = function(fn) { fn(); return 1; };
var rateRoot = { innerHTML: "", setAttribute: function() {} };
globalThis.document = {
  getElementById: function(id) {
    if (id === "rateLimitStatus") return rateRoot;
    return null;
  },
  addEventListener: function() {}
};
"""


class RateLimiterBootstrapTests(SimpleTestCase):
    def _runtime(self):
        ctx = MiniRacer()
        ctx.eval(BOOT_TEST_ENV + CORE_JS.read_text(encoding="utf-8") + BOOTSTRAP_JS.read_text(encoding="utf-8"))
        return ctx

    def test_render_indicator_outputs_nonempty_pills(self):
        ctx = self._runtime()
        html = ctx.eval("""
          (async () => {
            await window.dogeLimitedFetch("https://api.exchange.coinbase.com/products/DOGE-USD/ticker");
            window.dogeRateLimit.ingestServerState({
              providers: {
                blockchair: { used: 3, limit: 1440, status: "ready", updated_at: 1 },
                blockcypher: { used: 2, limit: 200, status: "ready", updated_at: 1 }
              }
            });
            window.dogeRateLimit.renderIndicator();
            return rateRoot.innerHTML;
          })()
        """).get(timeout=30)
        SCRATCH.mkdir(parents=True, exist_ok=True)
        (SCRATCH / "rate-limiter-logic.txt").write_text(f"indicator_html={html}\n", encoding="utf-8")
        self.assertIn("rate-pill-state", html)
        self.assertIn("Coinbase", html)
        self.assertIn("Blockchair", html)

    def test_bootstrap_starts_without_duplicate_probe_pollution(self):
        ctx = self._runtime()
        fetch_count = ctx.eval("""
          (async () => {
            const before = fetchCalls.length;
            window.dogeRateLimit.bootstrap();
            await Promise.resolve();
            return JSON.stringify({ before: before, after: fetchCalls.length });
          })()
        """).get(timeout=30)
        payload = __import__("json").loads(fetch_count)
        self.assertEqual(payload["before"], 0)
        self.assertGreater(payload["after"], 0)

    def test_probe_marks_blockchair_channel_client_via_meta(self):
        ctx = self._runtime()
        channel = ctx.eval("""
          (async () => {
            await window.dogeRateLimit.probeClientProviders();
            return window.dogeRateLimit.getState().find((item) => item.key === "blockchair").channel;
          })()
        """).get(timeout=30)
        self.assertEqual(channel, "client")