const FALLBACK_PRICE = 0.10898879;
const FALLBACK_QUOTE_VOLUME = 123195114;
const TARGET_PRICE = 1;

const state = {
  price: FALLBACK_PRICE,
  quoteVolume: FALLBACK_QUOTE_VOLUME,
  klines: [],
  merchants: JSON.parse(localStorage.getItem("doge-commerce-kit:merchants") || "[]"),
  checklist: JSON.parse(localStorage.getItem("doge-commerce-kit:checklist") || "{}"),
  activeTemplate: "merchant",
};

const checklistItems = [
  {
    id: "merchant-packaging",
    title: "Merchant package finalized",
    body: "Wallet flow, QR signage, receipt rules, and support script are ready for use.",
  },
  {
    id: "merchant-leads",
    title: "First 25 leads loaded",
    body: "Focus on one city cluster or one online niche before spreading wider.",
  },
  {
    id: "merchant-live",
    title: "First 10 merchants committed",
    body: "At least ten merchants have agreed to pilot the setup and share basic counts.",
  },
  {
    id: "creator-partners",
    title: "Creator partners briefed",
    body: "Creators know how to demo real payments without making investment claims.",
  },
  {
    id: "proof-template",
    title: "Proof report ready",
    body: "A recurring public report can show merchant count, live count, and transaction proof.",
  },
  {
    id: "launch-date",
    title: "Launch date set",
    body: "A concrete release date exists for the site, outreach, and first proof update.",
  },
];

const playbooks = {
  coffee: {
    title: "Quick-service launch playbook",
    body: "Start at the counter with a printed QR, one staff champion per shift, and a low-ticket menu item used for the first five DOGE transactions.",
    stack: "QR checkout + manual confirmation",
    time: "45 minutes",
    risk: "manageable",
    confirmations: 1,
  },
  creator: {
    title: "Creator storefront playbook",
    body: "Launch on digital goods or tips first so there is no in-person training burden. Add recurring offers only after the first month of receipts.",
    stack: "Hosted checkout link + wallet deep link",
    time: "30 minutes",
    risk: "low",
    confirmations: 1,
  },
  event: {
    title: "Event booth playbook",
    body: "Use one device per queue, pre-price common items, and give staff a fallback card option so DOGE can be additive instead of fragile.",
    stack: "Tablet QR checkout + event wallet",
    time: "60 minutes",
    risk: "elevated",
    confirmations: 0,
  },
  gaming: {
    title: "Gaming community playbook",
    body: "Begin with merch, tournament fees, or donations. Pair checkout with community proof posts and a public accepted-here page.",
    stack: "Checkout link + webhook notifications",
    time: "50 minutes",
    risk: "manageable",
    confirmations: 1,
  },
  services: {
    title: "Local services playbook",
    body: "Quote in USD, bill in DOGE at time of payment, and send the invoice link by text or email to reduce front-desk friction.",
    stack: "Invoice link + optional manual ledger",
    time: "35 minutes",
    risk: "low",
    confirmations: 1,
  },
};

const settlementProfiles = {
  hold: {
    label: "Merchant-controlled wallet",
    fiatMix: "0% fiat conversion",
  },
  partial: {
    label: "Split treasury policy",
    fiatMix: "50% DOGE retained, 50% converted",
  },
  convert: {
    label: "Rapid conversion policy",
    fiatMix: "Convert most receipts quickly",
  },
};

const templates = {
  merchant: `Subject: Pilot DOGE checkout for {{merchant}}

Hi {{merchant}},

We are building DOGE Commerce Kit, a lightweight merchant setup for businesses that want to accept Dogecoin without changing custody or rebuilding their stack.

What the pilot includes:
- wallet-owned QR checkout
- staff quickstart
- accepted-here badge
- basic reporting template
- public proof based on real usage, not price language

The pilot is intentionally small. We usually start with one product line, one trained staff champion, and a single month of transaction reporting.

If this sounds useful, we can package your setup in under an hour and help test the first checkout flow.
`,

  operator: `DOGE Commerce Kit operator brief

Primary objective:
Launch real DOGE acceptance with low-friction merchants and publish proof that usage happened.

Priorities:
1. Cluster merchants instead of scattering logos.
2. Choose segments with short training cycles.
3. Keep pricing in USD and settlement rules simple.
4. Publish counts, screenshots, and merchant stories.
5. Avoid speculative messaging entirely.

What success looks like:
- live merchants, not just leads
- repeated DOGE checkouts
- visible public reporting
- enough process consistency to support plugins later
`,

  press: `DOGE Commerce Kit launches as a merchant-first Dogecoin onboarding project

DOGE Commerce Kit is a lightweight adoption project built to help small businesses, creators, and local communities accept Dogecoin through simple checkout flows. The project focuses on public proof of real usage, fast merchant onboarding, and non-custodial payment paths.

The release does not make price claims or investment promises. Its aim is narrower and more practical: reduce acceptance friction and make DOGE usable in real transactions.
`,

  badge: `<a href="https://dogecoin.com/" style="display:inline-flex;align-items:center;gap:8px;border:1px solid #c68a17;padding:10px 12px;border-radius:8px;color:#1a2420;background:#fffdf7;font-weight:800;text-decoration:none;">
  <img src="assets/doge-logo-64.png" alt="" width="24" height="24" style="display:block;width:24px;height:24px;border-radius:50%;object-fit:contain;">
  Dogecoin Accepted Here
</a>`,
};

const $ = (id) => document.getElementById(id);

const formatUsd = (value, digits = 2) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
  }).format(Number.isFinite(value) ? value : 0);

const formatCompactUsd = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number.isFinite(value) ? value : 0);

const formatNumber = (value, digits = 0) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(
    Number.isFinite(value) ? value : 0,
  );

function setStatus(message, mode = "ok") {
  const status = $("marketStatus");
  status.textContent = message;
  status.style.background =
    mode === "warn" ? "rgba(178, 79, 66, 0.12)" : "rgba(31, 123, 92, 0.12)";
  status.style.color = mode === "warn" ? "var(--red)" : "var(--green)";
}

async function refreshMarket() {
  setStatus("Market sync running");
  try {
    const [avgRes, klineRes] = await Promise.all([
      fetch("https://api.binance.com/api/v3/avgPrice?symbol=DOGEUSDT"),
      fetch("https://api.binance.com/api/v3/klines?symbol=DOGEUSDT&interval=1d&limit=31"),
    ]);

    if (!avgRes.ok || !klineRes.ok) {
      throw new Error("Market API unavailable");
    }

    const avg = await avgRes.json();
    const klines = await klineRes.json();
    state.price = Number(avg.price) || FALLBACK_PRICE;
    state.klines = Array.isArray(klines) ? klines : [];
    const last = state.klines[state.klines.length - 1];
    state.quoteVolume = last ? Number(last[7]) : FALLBACK_QUOTE_VOLUME;
    $("priceSource").textContent = "Binance DOGEUSDT live";
    setStatus("Market synced");
  } catch (error) {
    state.price = FALLBACK_PRICE;
    state.quoteVolume = FALLBACK_QUOTE_VOLUME;
    $("priceSource").textContent = "Binance DOGEUSDT fallback";
    setStatus("Using fallback market data", "warn");
  }

  updateAll();
}

function getModelInputs() {
  return {
    supply: Number($("supplyInput").value) || 151,
    merchants: Number($("merchantCount").value) || 0,
    txPerMerchant: Number($("txPerMerchant").value) || 0,
    avgTicket: Number($("avgTicket").value) || 0,
  };
}

function updateMarketCards() {
  const { supply } = getModelInputs();
  const targetMarketCap = supply * 1_000_000_000 * TARGET_PRICE;
  const multiple = TARGET_PRICE / state.price;

  $("currentPrice").textContent = formatUsd(state.price, 5);
  $("targetMultiple").textContent = `${multiple.toFixed(2)}x`;
  $("targetMarketCap").textContent = formatCompactUsd(targetMarketCap);

  if (state.klines.length >= 30) {
    const firstClose = Number(state.klines[0][4]);
    const lastClose = Number(state.klines[state.klines.length - 1][4]);
    const change = ((lastClose - firstClose) / firstClose) * 100;
    $("trendValue").textContent = `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;
    $("trendValue").style.color = change >= 0 ? "var(--green)" : "var(--red)";
    $("trendRange").textContent = "Last 30 daily closes";
  } else {
    $("trendValue").textContent = "Offline";
    $("trendValue").style.color = "var(--muted)";
    $("trendRange").textContent = "Live trend unavailable";
  }
}

function updateDemandModel() {
  const { merchants, txPerMerchant, avgTicket } = getModelInputs();
  const dailyUsd = merchants * txPerMerchant * avgTicket;
  const monthlyUsd = dailyUsd * 30;
  const dailyDoge = dailyUsd / state.price;
  const volumeShare = state.quoteVolume ? (dailyUsd / state.quoteVolume) * 100 : 0;
  const meterWidth = Math.min(100, Math.max(2, volumeShare * 18));

  $("dailyDemandUsd").textContent = formatUsd(dailyUsd, 0);
  $("dailyDoge").textContent = `${formatNumber(dailyDoge, 0)} DOGE/day`;
  $("volumeShare").textContent = `${volumeShare.toFixed(2)}% of latest DOGEUSDT quote volume`;
  $("demandMeter").style.width = `${meterWidth}%`;
  $("monthlyPilotVolume").textContent = formatUsd(monthlyUsd, 0);
  $("pilotPattern").textContent =
    merchants >= 500 ? "5 dense districts" : merchants >= 150 ? "3 city clusters" : "1 pilot neighborhood";
}

function getPlaybook() {
  return playbooks[$("segmentSelect").value] || playbooks.coffee;
}

function updateRecommendations() {
  const playbook = getPlaybook();
  const settlement = settlementProfiles[$("settlementSelect").value];
  const weeklyOrders = Number($("weeklyOrders").value) || 0;
  const staffComfort = $("staffSelect").value;
  let confirmationCount = playbook.confirmations;

  if (weeklyOrders > 500 || staffComfort === "low") {
    confirmationCount = Math.max(1, playbook.confirmations);
  }

  $("playbookTitle").textContent = playbook.title;
  $("playbookBody").textContent = playbook.body;
  $("confirmationRule").textContent = `Suggested confirmations: ${confirmationCount}`;
  $("pilotRisk").textContent =
    staffComfort === "low" || weeklyOrders > 1000 ? "Risk: elevated training need" : `Risk: ${playbook.risk}`;

  $("stackChoice").textContent = playbook.stack;
  $("timeEstimate").textContent = playbook.time;
  $("settlementPlan").textContent = `${settlement.label} (${settlement.fiatMix})`;
}

function buildPaymentUri() {
  const address = $("walletAddress").value.trim();
  const usd = Number($("usdAmount").value) || 0;
  const doge = usd / state.price;
  const memo = $("invoiceMemo").value.trim();
  const params = new URLSearchParams();

  if (Number.isFinite(doge) && doge > 0) {
    params.set("amount", doge.toFixed(8));
  }
  if (memo) {
    params.set("message", memo);
  }

  const query = params.toString();
  return {
    doge,
    uri: `dogecoin:${encodeURIComponent(address)}${query ? `?${query}` : ""}`,
  };
}

function updateInvoice() {
  const { doge, uri } = buildPaymentUri();
  $("dogeAmount").textContent = `${formatNumber(doge, 2)} DOGE`;
  $("paymentUri").textContent = uri;
  $("qrImage").src =
    "https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=" +
    encodeURIComponent(uri);
}

function updateManifest() {
  const merchantName = $("merchantName").value.trim() || "Unnamed Merchant";
  const segment = $("segmentSelect").value;
  const settlementKey = $("settlementSelect").value;
  const staffComfort = $("staffSelect").value;
  const weeklyOrders = Number($("weeklyOrders").value) || 0;
  const settlement = settlementProfiles[settlementKey];
  const playbook = getPlaybook();
  const { doge, uri } = buildPaymentUri();
  const merchantCount = state.merchants.length;

  const manifest = {
    project: "DOGE Commerce Kit",
    generatedAt: new Date().toISOString(),
    merchant: {
      name: merchantName,
      segment,
      walletAddress: $("walletAddress").value.trim(),
      settlementPolicy: settlement.label,
      staffComfort,
      expectedWeeklyOrders: weeklyOrders,
    },
    checkout: {
      stack: playbook.stack,
      usdReferenceAmount: Number($("usdAmount").value) || 0,
      currentDogeAmount: Number(doge.toFixed(8)),
      paymentUri: uri,
      confirmationRule: $("confirmationRule").textContent.replace("Suggested confirmations: ", ""),
    },
    operations: {
      onboardingTime: playbook.time,
      riskLevel: $("pilotRisk").textContent.replace("Risk: ", ""),
      reportingCadence: "weekly",
      nonCustodial: true,
    },
    rollout: {
      currentPipelineCount: merchantCount,
      nextAction:
        merchantCount < 10
          ? "Concentrate on first 10 committed merchants"
          : "Promote cluster density and repeat usage",
      publicProofFields: ["merchant_count", "live_locations", "transaction_count", "doge_volume"],
    },
  };

  $("manifestOutput").value = JSON.stringify(manifest, null, 2);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    setStatus("Copied");
  } catch (error) {
    setStatus("Copy blocked by browser", "warn");
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function saveMerchants() {
  localStorage.setItem("doge-commerce-kit:merchants", JSON.stringify(state.merchants));
}

function renderMerchants() {
  const rows = $("pledgeRows");
  rows.innerHTML = "";

  if (!state.merchants.length) {
    rows.innerHTML = '<tr class="empty-row"><td colspan="4">No merchants added yet.</td></tr>';
  } else {
    for (const merchant of state.merchants) {
      const row = document.createElement("tr");
      row.innerHTML = `<td><strong>${escapeHtml(merchant.name)}</strong><br><small>${escapeHtml(
        merchant.segment,
      )}</small></td><td>${escapeHtml(merchant.city)}</td><td>${escapeHtml(
        merchant.stage,
      )}</td><td>${formatNumber(merchant.goal, 0)} DOGE</td>`;
      rows.appendChild(row);
    }
  }

  const totalGoal = state.merchants.reduce((sum, merchant) => sum + Number(merchant.goal || 0), 0);
  const liveCount = state.merchants.filter((merchant) => merchant.stage === "live").length;

  $("pledgeTotals").textContent = `${state.merchants.length} merchants, ${formatNumber(
    totalGoal,
    0,
  )} DOGE/month`;
  $("liveTotals").textContent = `${liveCount} live`;
}

function exportCsv() {
  const header = ["merchant", "city", "segment", "stage", "website", "monthly_doge_goal"];
  const lines = state.merchants.map((merchant) =>
    [merchant.name, merchant.city, merchant.segment, merchant.stage, merchant.site, merchant.goal]
      .map((value) => `"${String(value || "").replaceAll('"', '""')}"`)
      .join(","),
  );

  const blob = new Blob([[header.join(","), ...lines].join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "doge-commerce-kit-merchants.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function saveChecklist() {
  localStorage.setItem("doge-commerce-kit:checklist", JSON.stringify(state.checklist));
}

function renderChecklist() {
  const list = $("sprintList");
  list.innerHTML = "";

  checklistItems.forEach((item) => {
    const row = document.createElement("label");
    row.className = "sprint-item";
    row.innerHTML = `<input type="checkbox" data-check="${item.id}" ${
      state.checklist[item.id] ? "checked" : ""
    } /><span><strong>${item.title}</strong>${item.body}</span>`;
    list.appendChild(row);
  });
}

function updateReadiness() {
  const completed = checklistItems.filter((item) => state.checklist[item.id]).length;
  const percent = Math.round((completed / checklistItems.length) * 100);
  const liveCount = state.merchants.filter((merchant) => merchant.stage === "live").length;

  $("launchReadiness").textContent = `${percent}%`;
  $("launchReadinessNote").textContent =
    liveCount > 0 ? `${liveCount} live merchants in tracker` : "No live merchants in tracker yet";
}

function renderAsset() {
  $("assetOutput").value = templates[state.activeTemplate];
  document.querySelectorAll(".asset-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.template === state.activeTemplate);
  });
}

function updateAll() {
  updateMarketCards();
  updateDemandModel();
  updateRecommendations();
  updateInvoice();
  updateManifest();
  updateReadiness();
}

function bindEvents() {
  ["supplyInput", "merchantCount", "txPerMerchant", "avgTicket"].forEach((id) => {
    $(id).addEventListener("input", updateAll);
  });

  ["segmentSelect", "settlementSelect", "staffSelect", "weeklyOrders"].forEach((id) => {
    $(id).addEventListener("input", updateAll);
    $(id).addEventListener("change", updateAll);
  });

  ["merchantName", "walletAddress", "usdAmount", "invoiceMemo"].forEach((id) => {
    $(id).addEventListener("input", updateAll);
  });

  $("refreshMarket").addEventListener("click", refreshMarket);
  $("copyUri").addEventListener("click", () => copyText(buildPaymentUri().uri));
  $("copyManifest").addEventListener("click", () => copyText($("manifestOutput").value));
  $("copyAsset").addEventListener("click", () => copyText($("assetOutput").value));
  $("exportCsv").addEventListener("click", exportCsv);

  $("pledgeForm").addEventListener("submit", (event) => {
    event.preventDefault();
    state.merchants.unshift({
      name: $("pledgeName").value.trim(),
      city: $("pledgeCity").value.trim(),
      segment: $("pledgeSegment").value.trim(),
      stage: $("pledgeStage").value,
      goal: Number($("pledgeGoal").value) || 0,
      site: $("pledgeSite").value.trim(),
      createdAt: new Date().toISOString(),
    });
    saveMerchants();
    renderMerchants();
    updateManifest();
    updateReadiness();
    event.currentTarget.reset();
    $("pledgeStage").value = "lead";
    $("pledgeGoal").value = 5000;
  });

  $("sprintList").addEventListener("change", (event) => {
    const id = event.target.dataset.check;
    if (!id) {
      return;
    }
    state.checklist[id] = event.target.checked;
    saveChecklist();
    updateReadiness();
  });

  $("resetChecklist").addEventListener("click", () => {
    state.checklist = {};
    saveChecklist();
    renderChecklist();
    updateReadiness();
  });

  document.querySelectorAll(".asset-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTemplate = button.dataset.template;
      renderAsset();
    });
  });
}

bindEvents();
renderMerchants();
renderChecklist();
renderAsset();
updateAll();
refreshMarket();
