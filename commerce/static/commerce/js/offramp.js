(function () {
  const fallbackPrice = 0.10768931;
  const routes = {
    coinbase: {
      label: "Manual exchange: Coinbase account or Coinbase Business",
      steps: [
        "Create or open the Coinbase cash-out destination before the launch window.",
        "Select Receive, choose DOGE or the exact supported asset/network, and copy the fresh deposit address.",
        "Send a small DOGE test transfer first, then send the merchant settlement once credited successfully.",
        "Convert DOGE to the available USD cash balance or supported USD token route after the deposit is available.",
        "Withdraw cash or move the supported USD token through the verified route shown in Coinbase."
      ],
      caution: "Do not rely on legacy Coinbase Commerce for new setup. Confirm current DOGE support, settlement asset, limits, fees, and withdrawal timing inside Coinbase or Coinbase Business before launch."
    },
    robinhood: {
      label: "Manual exchange: Robinhood Crypto",
      steps: [
        "Verify crypto transfers are enabled in Robinhood before promising a cash-out timeline.",
        "Open DOGE, select Receive, and copy the current DOGE deposit address.",
        "Confirm the address starts with D, which Robinhood lists as its supported native DOGE address format.",
        "Send a small DOGE test transfer first and wait for crediting.",
        "Sell credited DOGE in Robinhood and withdraw cash through the linked account route available to the merchant."
      ],
      caution: "Robinhood deposit addresses can change. Use the current Receive address, not an old withdrawal address."
    },
    wallet: {
      label: "Manual exchange: self-custody wallet to exchange",
      steps: [
        "Keep the merchant wallet seed phrase offline and separate from the public checkout device.",
        "Choose an exchange account that supports native DOGE deposits and USD withdrawal in the merchant jurisdiction.",
        "Copy a fresh DOGE deposit address from that exchange and verify the network before sending.",
        "Send a small test transfer, then the settlement batch.",
        "Convert only after the deposit is credited, then withdraw USD or move the supported USD token through the verified route."
      ],
      caution: "Self-custody avoids platform lock-in but puts key security and irreversible transfer checks on the merchant."
    },
    processor: {
      label: "Automatic processor settlement to USD or USD token",
      steps: [
        "Use processor-hosted checkout when the merchant wants lower wallet-operation burden.",
        "Confirm whether the processor accepts DOGE directly, swaps payer assets, or settles only in fiat or a supported USD token.",
        "Set settlement currency, webhook, refund, and accounting settings before launch.",
        "Run a live low-value checkout test and save the invoice, confirmation, fees, and payout timing.",
        "Publish only aggregate volumes and merchant-approved proof."
      ],
      caution: "Processor support changes often. Verify DOGE, settlement asset, token network, fees, refunds, and payout timing inside the current merchant dashboard."
    }
  };

  function $(id) {
    return document.getElementById(id);
  }

  function asNumber(id, fallback) {
    const el = $(id);
    if (!el) return fallback;
    const value = Number.parseFloat(el.value);
    return Number.isFinite(value) ? value : fallback;
  }

  function money(value) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: value >= 100 ? 0 : 2
    }).format(value || 0);
  }

  function buildPlan() {
    const doge = Math.max(asNumber("offrampDoge", 0), 0);
    const price = Math.max(asNumber("offrampPrice", fallbackPrice), 0);
    const feePct = Math.max(asNumber("offrampFee", 0), 0);
    const routeKey = $("offrampRoute")?.value || "coinbase";
    const route = routes[routeKey] || routes.coinbase;
    const gross = doge * price;
    const buffer = gross * (feePct / 100);
    const net = Math.max(gross - buffer, 0);

    if ($("offrampGross")) $("offrampGross").textContent = money(gross);
    if ($("offrampBuffer")) $("offrampBuffer").textContent = money(buffer);
    if ($("offrampNet")) $("offrampNet").textContent = money(net);

    const lines = [
      `DOGE to USD conversion plan - ${route.label}`,
      "",
      `DOGE received: ${doge.toLocaleString("en-US", { maximumFractionDigits: 4 })}`,
      `DOGE/USD reference: ${money(price)}`,
      `Gross USD estimate: ${money(gross)}`,
      `Fee and slippage buffer: ${feePct.toFixed(1)}% (${money(buffer)})`,
      `Net planning estimate: ${money(net)}`,
      "",
      "Steps:",
      ...route.steps.map((step, index) => `${index + 1}. ${step}`),
      "",
      `Caution: ${route.caution}`,
      "This is operational planning, not investment advice or a recommendation to buy, sell, or hold DOGE."
    ];

    if ($("offrampOutput")) $("offrampOutput").value = lines.join("\n");
    window.updateTransactionHandoff?.();
  }

  async function refreshPrice() {
    const button = $("refreshOfframpPrice");
    if (button) button.textContent = "Refreshing";
    try {
      const fetcher = window.dogeLimitedFetch || fetch;
      const response = await fetcher("https://api.exchange.coinbase.com/products/DOGE-USD/ticker", {
        cache: "no-store"
      });
      if (!response.ok) throw new Error("Price request failed");
      const payload = await response.json();
      const price = Number.parseFloat(payload.price);
      if (Number.isFinite(price) && $("offrampPrice")) {
        $("offrampPrice").value = price.toFixed(8);
      }
    } catch (error) {
      if ($("offrampOutput")) {
        $("offrampOutput").value += "\n\nPrice refresh failed; keeping the existing reference price.";
      }
    } finally {
      if (button) button.textContent = "Refresh price";
      buildPlan();
    }
  }

  async function copyPlan() {
    buildPlan();
    const output = $("offrampOutput");
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output.value);
    } catch (error) {
      output.select();
      document.execCommand("copy");
    }
    window.dogeAnnounce?.("Conversion plan copied to clipboard.");
  }

  function init() {
    if (!$("offrampPlanner")) return;
    ["offrampDoge", "offrampPrice", "offrampRoute", "offrampFee"].forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener("input", buildPlan);
      if (el) el.addEventListener("change", buildPlan);
    });
    $("refreshOfframpPrice")?.addEventListener("click", refreshPrice);
    $("copyOfframpPlan")?.addEventListener("click", copyPlan);
    buildPlan();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
