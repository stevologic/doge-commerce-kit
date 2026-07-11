const FALLBACK_PRICE = 0.1063;
const FALLBACK_SUPPLY_BILLIONS = 169.74;
const TARGET_PRICE = 1;
const DEFAULT_QUOTE_MINUTES = 10;
const CONVERSION_USD_AMOUNTS = [1, 5, 10, 25, 50, 100];
const CONVERSION_DOGE_AMOUNTS = [1, 10, 25, 100, 500, 1000];

const state = {
  price: FALLBACK_PRICE,
  leads: [],
  activePackKits: [],
  activeCommercePack: "",
};

const $ = (id) => document.getElementById(id);

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const moneyPrecise = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 4,
});

const moneyCents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const number = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const dogeNumber = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 4,
});

function compactMoney(value) {
  return `$${compact.format(value)}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalize(value) {
  return String(value || "").toLowerCase().trim();
}

function setSelectValue(id, value) {
  const element = $(id);
  if (!element || !value) return false;
  const requested = normalize(value);
  const option = Array.from(element.options).find(
    (item) => normalize(item.value) === requested || normalize(item.textContent) === requested,
  );
  if (!option) return false;
  element.value = option.value;
  return true;
}

function initMobileNav() {
  const header = document.querySelector(".site-header");
  const toggle = $("navToggle");
  const nav = $("primaryNav");
  if (!header || !toggle || !nav) return;
  const compactMenu = window.matchMedia("(max-width: 980px)");

  const syncHiddenState = () => {
    const hidden = compactMenu.matches && !header.classList.contains("nav-open");
    nav.toggleAttribute("inert", hidden);
    nav.setAttribute("aria-hidden", String(hidden));
  };

  const setOpen = (open) => {
    header.classList.toggle("nav-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    syncHiddenState();
  };

  toggle.addEventListener("click", () => {
    setOpen(toggle.getAttribute("aria-expanded") !== "true");
  });

  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => setOpen(false));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setOpen(false);
  });

  compactMenu.addEventListener("change", (event) => {
    if (!event.matches) setOpen(false);
    syncHiddenState();
  });

  syncHiddenState();
}

const DEFAULT_MERCHANT_NAMES = new Set([
  "",
  "Example Coffee",
  "Example Merchant",
  "Downtown Coffee Window",
]);

const DEFAULT_DOGE_ADDRESSES = new Set([
  "",
  "DExampleReplaceWithMerchantAddress000000",
]);

const DEFAULT_CHECKOUT_LINKS = new Set([
  "",
  "https://example.com/pay-with-doge",
]);

function syncMerchantNameFromFit() {
  const source = $("fitMerchantName")?.value.trim();
  if (!source) return;
  ["checkoutMerchantName", "badgeMerchantName", "outreachName", "leadName"].forEach((id) => {
    const element = $(id);
    if (!element) return;
    if (DEFAULT_MERCHANT_NAMES.has(element.value.trim())) {
      element.value = source;
    }
  });
}

function numericValue(id, fallback = 0) {
  const element = $(id);
  if (!element) return fallback;
  const value = Number(element.value);
  return Number.isFinite(value) ? value : fallback;
}

function checkoutQuote(minutes = DEFAULT_QUOTE_MINUTES) {
  const issued = new Date();
  const expires = new Date(issued.getTime() + minutes * 60 * 1000);
  return {
    issued_at: issued.toISOString(),
    expires_at: expires.toISOString(),
    minutes,
  };
}

function quoteLabel(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function quoteMetaText(quote, price = state.price) {
  if (!quote?.issued_at || !quote?.expires_at) return "Quote timestamp unavailable. Recheck DOGE/USD before fulfillment.";
  return `Quote refreshed ${quoteLabel(quote.issued_at)} at ${moneyPrecise.format(price)} DOGE/USD. Recheck after ${quoteLabel(quote.expires_at)} (${quote.minutes} min window).`;
}

function formatConversionDoge(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return "0 DOGE";
  const formatter = amount >= 100 ? compact : dogeNumber;
  return `${formatter.format(amount)} DOGE`;
}

function conversionRowHtml(label, value, percent, current = false) {
  const width = Math.max(5, Math.min(100, Number(percent) || 0));
  return `<span class="conversion-row${current ? " current" : ""}">
    <span class="conversion-copy">
      <b>${escapeHtml(label)}</b>
      <strong>${escapeHtml(value)}</strong>
    </span>
    <span class="conversion-meter" aria-hidden="true"><i style="width:${width.toFixed(1)}%"></i></span>
  </span>`;
}

function renderCheckoutConversionChart(currentUsd = 0) {
  const rateOut = $("checkoutConversionRate");
  const usdRows = $("checkoutUsdToDogeRows");
  const dogeRows = $("checkoutDogeToUsdRows");
  if (!rateOut || !usdRows || !dogeRows) return;
  const rate = Number(state.price);
  if (!Number.isFinite(rate) || rate <= 0) {
    rateOut.textContent = "DOGE/USD unavailable";
    usdRows.innerHTML = `<span class="note">Price unavailable.</span>`;
    dogeRows.innerHTML = `<span class="note">Price unavailable.</span>`;
    return;
  }

  rateOut.textContent = `${moneyPrecise.format(rate)} DOGE/USD`;
  const safeCurrentUsd = Math.max(0, Number(currentUsd || 0));
  const usdInputs = CONVERSION_USD_AMOUNTS.map((usd) => ({ label: moneyCents.format(usd), usd, current: false }));
  if (safeCurrentUsd > 0 && !usdInputs.some((row) => Math.abs(row.usd - safeCurrentUsd) < 0.01)) {
    usdInputs.unshift({ label: "Current", usd: safeCurrentUsd, current: true });
  }
  const maxDoge = Math.max(...usdInputs.map((row) => row.usd / rate), 1);
  usdRows.innerHTML = usdInputs.map((row) => {
    const doge = row.usd / rate;
    return conversionRowHtml(row.label, formatConversionDoge(doge), (doge / maxDoge) * 100, row.current);
  }).join("");

  const dogeInputs = CONVERSION_DOGE_AMOUNTS.map((doge) => ({ label: formatConversionDoge(doge), doge }));
  const maxUsd = Math.max(...dogeInputs.map((row) => row.doge * rate), 1);
  dogeRows.innerHTML = dogeInputs.map((row) => {
    const usd = row.doge * rate;
    return conversionRowHtml(row.label, moneyCents.format(usd), (usd / maxUsd) * 100);
  }).join("");
}

let toastTimer;

function announce(message) {
  const status = $("toastStatus");
  if (!status || !message) return;
  status.textContent = message;
  status.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    status.classList.remove("visible");
  }, 2600);
}

window.dogeAnnounce = announce;

async function copyText(text, message = "Copied to clipboard.") {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.style.position = "fixed";
    helper.style.left = "-9999px";
    document.body.appendChild(helper);
    helper.focus();
    helper.select();
    document.execCommand("copy");
    helper.remove();
  }
  announce(message);
}

function bodyDonationAddress() {
  return document.body.dataset.donationAddress || "";
}

function savedToolWalletAddress() {
  return (
    (localStorage.getItem("doge-wallet:address") || "").trim() ||
    (localStorage.getItem("doge-pos:wallet") || "").trim() ||
    bodyDonationAddress()
  );
}

function safeSnippetUrl(value, fallback = "https://commerce.dog/") {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).href;
  } catch {
    return fallback;
  }
}

function shouldUseSavedWallet(value) {
  const raw = String(value || "").trim();
  const donation = bodyDonationAddress();
  return !raw || raw === donation || DEFAULT_DOGE_ADDRESSES.has(raw);
}

function hydrateToolWalletFields(force = false) {
  const saved = savedToolWalletAddress();
  if (!saved) return;
  const addressIds = [
    "walletAddress",
    "donateSnippetAddress",
    "walletShareAddress",
    "integrationAddress",
    "validationAddress",
    "receiptAddress",
    "signAddress",
  ];
  addressIds.forEach((id) => {
    const input = $(id);
    if (!input) return;
    if (force || shouldUseSavedWallet(input.value)) input.value = saved;
  });
  const badgeLink = $("badgeLink");
  if (badgeLink) {
    const raw = badgeLink.value.trim();
    const defaultUri = bodyDonationAddress() ? `dogecoin:${bodyDonationAddress()}` : "";
    if (force || !raw || raw === defaultUri || DEFAULT_CHECKOUT_LINKS.has(raw)) {
      badgeLink.value = `dogecoin:${saved}`;
    }
  }
  syncToolSavedWalletLabel();
}

function refreshToolBuilders() {
  updateCheckout();
  updateBadge();
  buildValidationChecklist();
  buildPaymentPolicy();
  updatePriceSnippet();
  updateSparkSnippet();
  updateReceiptSnippet();
  ["donateSnippetAddress", "walletShareAddress", "integrationAddress", "signAddress"].forEach((id) => {
    const input = $(id);
    if (input) input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function syncToolSavedWalletLabel() {
  const output = $("toolsSavedWalletOut");
  if (!output) return;
  const saved = savedToolWalletAddress();
  output.textContent = saved || "No wallet saved yet — set one on the Wallet page";
  const hint = $("toolsMarketplaceHint");
  if (hint && saved) {
    hint.textContent = "Your saved wallet is applied to previews below. Filter by job, preview live, then copy when it looks right.";
  }
}

function applySavedWalletToTools() {
  hydrateToolWalletFields(true);
  refreshToolBuilders();
  announce("Saved wallet applied to visible tools.");
}

function initToolFilters() {
  const bar = document.querySelector(".tool-filter-bar");
  if (!bar) return;
  const buttons = Array.from(bar.querySelectorAll("[data-tool-filter]"));
  const cards = Array.from(document.querySelectorAll("[data-tool-category]"));
  const bands = Array.from(document.querySelectorAll("[data-tool-group]"));
  const applyFilter = (filter) => {
    buttons.forEach((button) => button.classList.toggle("is-active", button.dataset.toolFilter === filter));
    cards.forEach((card) => {
      const categories = String(card.dataset.toolCategory || "").split(/\s+/);
      card.hidden = filter !== "all" && !categories.includes(filter);
    });
    bands.forEach((band) => {
      const visibleCards = Array.from(band.querySelectorAll("[data-tool-category]")).some((card) => !card.hidden);
      band.hidden = !visibleCards;
    });
  };
  buttons.forEach((button) => {
    button.addEventListener("click", () => applyFilter(button.dataset.toolFilter || "all"));
  });
  applyFilter("all");
}

function downloadFile(name, content, type = "application/json") {
  const blob = new Blob([content], { type });
  downloadBlob(name, blob);
}

function downloadBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  announce(`${name} downloaded.`);
}

function formatTemplatePreview(url, text) {
  if (url.endsWith(".json")) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }
  return text;
}

function filenameFromUrl(url) {
  const pathname = new URL(url, window.location.href).pathname;
  return pathname.split("/").filter(Boolean).pop() || "doge-template";
}

function closeFilePreview() {
  const modal = $("filePreviewModal");
  if (modal) modal.hidden = true;
}

async function openFilePreview(button) {
  const modal = $("filePreviewModal");
  const title = $("filePreviewTitle");
  const meta = $("filePreviewMeta");
  const output = $("filePreviewOutput");
  const download = $("downloadFilePreview");
  if (!modal || !title || !meta || !output || !download || !button) return;

  const url = button.dataset.templateUrl || "";
  const name = button.dataset.templateName || button.textContent.trim() || "Reusable file";
  const filename = filenameFromUrl(url);
  title.textContent = name;
  meta.textContent = `${filename} - loading preview...`;
  output.textContent = "Loading file preview...";
  download.href = url;
  download.download = filename;
  download.dataset.templateUrl = url;
  download.dataset.filename = filename;
  modal.hidden = false;

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    output.textContent = formatTemplatePreview(url, text);
    meta.textContent = `${filename} - review before downloading.`;
  } catch {
    output.textContent = "Could not load this preview. You can still try downloading the file.";
    meta.textContent = `${filename} - preview unavailable.`;
  }
}

async function downloadFilePreview(event) {
  const download = $("downloadFilePreview");
  const url = download?.dataset.templateUrl || download?.getAttribute("href") || "";
  const filename = download?.dataset.filename || filenameFromUrl(url);
  if (!download || !url || url === "#") return;

  event.preventDefault();
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const blob = await response.blob();
    downloadBlob(filename, blob.type ? blob : new Blob([await blob.arrayBuffer()], { type: contentType }));
  } catch {
    window.location.href = url;
    announce(`Opening ${filename}.`);
  }
}

function initFilePreviews() {
  const modal = $("filePreviewModal");
  if (!modal) return;

  document.querySelectorAll("[data-template-preview]").forEach((button) => {
    button.addEventListener("click", () => openFilePreview(button));
  });
  $("closeFilePreview")?.addEventListener("click", closeFilePreview);
  $("copyFilePreview")?.addEventListener("click", () => copyText($("filePreviewOutput")?.textContent || "", "Template preview copied."));
  $("downloadFilePreview")?.addEventListener("click", downloadFilePreview);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeFilePreview();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) closeFilePreview();
  });
}

function updateStatus(message) {
  const status = $("marketStatus");
  if (status) status.textContent = message;
}

async function refreshMarket() {
  const hasMarketConsumer = ["currentPrice", "demandModel", "checkoutQr", "badgePreview", "marketStatus", "priceSnippetPreview", "sparkSnippetPreview"].some((id) => $(id));
  if (!hasMarketConsumer) return;
  updateStatus("Syncing...");
  try {
    const fetcher = window.dogeLimitedFetch || fetch;
    const response = await fetcher("https://api.exchange.coinbase.com/products/DOGE-USD/ticker", {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Market request failed");
    const payload = await response.json();
    const price = Number(payload.price);
    if (!Number.isFinite(price) || price <= 0) throw new Error("Invalid price");
    state.price = price;
    updateStatus("Live Coinbase DOGE-USD");
  } catch {
    state.price = FALLBACK_PRICE;
    updateStatus("Fallback baseline");
  }

  if ($("currentPrice")) $("currentPrice").textContent = moneyPrecise.format(state.price);
  updateDemandModel();
  updateCheckout();
  updatePriceSnippet();
  updateSparkSnippet();
  updateReceiptSnippet();
}

function updateDemandModel() {
  if (!$("modelMerchants")) return;
  const merchants = numericValue("modelMerchants", 500);
  const tx = numericValue("modelTransactions", 80);
  const ticket = numericValue("modelTicket", 32);
  const supply = numericValue("modelSupply", FALLBACK_SUPPLY_BILLIONS);
  const monthlyUsd = merchants * tx * ticket;
  const dogeNeeded = monthlyUsd / state.price;
  const targetCap = supply * 1_000_000_000 * TARGET_PRICE;
  const gap = TARGET_PRICE / state.price;

  $("modelUsd").textContent = money.format(monthlyUsd);
  $("modelDoge").textContent = `${compact.format(dogeNeeded)} DOGE`;
  $("modelTargetCap").textContent = compactMoney(targetCap);
  $("modelGap").textContent = `${gap.toFixed(1)}x`;
  if ($("targetGapMetric")) $("targetGapMetric").textContent = `${gap.toFixed(1)}x`;
  if ($("targetValueMetric")) $("targetValueMetric").textContent = compactMoney(targetCap);
}

function initDemandModel() {
  if (!$("demandModel")) return;
  ["modelMerchants", "modelTransactions", "modelTicket", "modelSupply"].forEach((id) => {
    $(id).addEventListener("input", updateDemandModel);
  });
  updateDemandModel();
}

function updateMerchantFit() {
  if (!$("merchantFit")) return;
  const name = $("fitMerchantName").value.trim() || "Merchant";
  const revenue = numericValue("monthlyRevenue", 0);
  const aov = Math.max(1, numericValue("averageOrder", 1));
  const overlap = numericValue("audienceOverlap", 0);
  const tech = numericValue("techReadiness", 0);
  const promo = numericValue("promoWillingness", 0);
  const rail = $("paymentRail").value;
  const vertical = $("fitVertical").value;
  const revenueScore = clamp(revenue / 1000, 0, 100);
  const railBonus = rail === "hosted" ? 8 : rail === "wallet" ? 4 : 6;
  const segmentBonus = ["creator merch", "gaming communities", "food trucks and quick service"].includes(vertical) ? 6 : 2;
  const score = Math.round(clamp(overlap * 0.34 + tech * 0.2 + promo * 0.25 + revenueScore * 0.11 + railBonus + segmentBonus, 0, 100));
  const monthlyOrders = Math.round(revenue / aov);
  const dogeGmv = revenue * clamp(score / 100, 0.05, 0.45) * 0.15;
  const weekOneBuyers = Math.max(1, Math.round(monthlyOrders * clamp(score / 100, 0.05, 0.2) * 0.15));

  $("fitTitle").textContent = `${name}: ${score} adoption score`;
  $("fitMeter").style.width = `${score}%`;
  $("ordersOut").textContent = number.format(monthlyOrders);
  $("dogeGmvOut").textContent = money.format(dogeGmv);
  $("weeklyAskOut").textContent = number.format(weekOneBuyers);
  $("fitAdvice").textContent =
    score >= 80
      ? "High-fit lead. Ask for one public launch offer and proof-report permission."
      : score >= 60
        ? "Good pilot candidate. Reduce setup friction with a hosted route or one-product test."
        : "Keep warm, but spend first outreach energy on merchants with stronger audience overlap.";
}

function initMerchantFit() {
  if (!$("merchantFit")) return;
  document.querySelectorAll("#merchantFit input, #merchantFit select").forEach((field) => {
    field.addEventListener("input", updateMerchantFit);
    field.addEventListener("change", updateMerchantFit);
  });
  updateMerchantFit();
}

function buildPaymentUri() {
  const address = $("walletAddress")?.value.trim() || "DExampleReplaceWithMerchantAddress000000";
  const usd = numericValue("usdAmount", 0);
  const doge = usd / state.price;
  const memo = $("invoiceMemo")?.value.trim() || "DOGE Commerce Kit sale";
  const params = new URLSearchParams({
    amount: doge.toFixed(8),
    message: memo,
  });
  return {
    address,
    doge,
    uri: `dogecoin:${address}?${params.toString()}`,
  };
}

function paymentRouteReference() {
  const rail = $("paymentRail")?.value || "hosted";
  const hostedUrl = $("hostedCheckoutUrl")?.value.trim() || "";
  const { uri } = buildPaymentUri();
  const hostedReady = /^https?:\/\//i.test(hostedUrl) && !DEFAULT_CHECKOUT_LINKS.has(hostedUrl);

  if (rail === "hosted") {
    return {
      label: hostedReady ? "Hosted checkout link" : "Hosted checkout pending",
      reference: hostedReady ? hostedUrl : "Create the hosted invoice or checkout link before launch.",
      qrPayload: hostedReady ? hostedUrl : uri,
      type: hostedReady ? "hosted_checkout" : "hosted_pending",
    };
  }

  if (rail === "native") {
    return {
      label: "DOGE-native payment route",
      reference: uri,
      qrPayload: uri,
      type: "doge_native",
    };
  }

  return {
    label: "Dogecoin URI",
    reference: uri,
    qrPayload: uri,
    type: "merchant_wallet",
  };
}

function updateRouteDecisionHint(routeReference) {
  if (!$("routeDecisionTitle") || !$("routeDecisionBody")) return;
  const rail = $("paymentRail")?.value || "wallet";
  const copy = {
    hosted: {
      title: routeReference?.type === "hosted_checkout" ? "Hosted checkout link ready" : "Hosted checkout needs a live link",
      body: routeReference?.type === "hosted_checkout"
        ? "The QR and badge can point to the hosted invoice or payment link. Confirm provider support, fees, settlement asset, and refunds in the dashboard before launch."
        : "Create the invoice or payment link in the provider dashboard, paste it here, then run one low-value test before sending buyers to it.",
    },
    wallet: {
      title: "Merchant wallet QR",
      body: "Use this when the merchant controls the receiving address and staff can confirm the DOGE transaction before fulfillment.",
    },
    native: {
      title: "DOGE-native backend",
      body: "Use this only when the product already has backend support for DOGE invoices, confirmations, accounting fields, and support handling.",
    },
  };
  const hint = copy[rail] || copy.wallet;
  $("routeDecisionTitle").textContent = hint.title;
  $("routeDecisionBody").textContent = hint.body;
}

function updateCheckout() {
  if (!$("checkoutBuilder")) return;
  const merchant = $("checkoutMerchantName").value.trim() || "Unnamed merchant";
  const rail = $("paymentRail")?.value || "hosted";
  const hostedUrl = $("hostedCheckoutUrl")?.value.trim() || "";
  const { address, doge, uri } = buildPaymentUri();
  const routeReference = paymentRouteReference();
  const quote = checkoutQuote();
  updateRouteDecisionHint(routeReference);
  const qr = $("qrImage");
  $("dogeAmountOut").textContent = `${doge.toFixed(2)} DOGE`;
  $("paymentUriOut").textContent = routeReference.reference;
  if ($("checkoutQuoteMeta")) $("checkoutQuoteMeta").textContent = quoteMetaText(quote);
  renderCheckoutConversionChart(numericValue("usdAmount", 0));
  if ($("checkoutReferenceLabel")) $("checkoutReferenceLabel").textContent = routeReference.label;
  if ($("validationAddress") && DEFAULT_DOGE_ADDRESSES.has($("validationAddress").value.trim())) {
    $("validationAddress").value = address;
  }
  if ($("validationDoge")) {
    $("validationDoge").value = doge.toFixed(8);
  }
  if ($("badgeLink") && DEFAULT_CHECKOUT_LINKS.has($("badgeLink").value.trim()) && /^https?:\/\//i.test(hostedUrl) && !DEFAULT_CHECKOUT_LINKS.has(hostedUrl)) {
    $("badgeLink").value = hostedUrl;
  }
  if (qr) {
    qr.src = `/qr.svg?data=${encodeURIComponent(routeReference.qrPayload)}`;
  }
  updateBadge();
  const manifest = {
    merchant,
    dogecoin_address: address,
    payment_uri: uri,
    hosted_checkout_url: /^https?:\/\//i.test(hostedUrl) && !DEFAULT_CHECKOUT_LINKS.has(hostedUrl) ? hostedUrl : "",
    payment_reference: routeReference.reference,
    qr_payload: routeReference.qrPayload,
    usd_amount: numericValue("usdAmount", 0),
    doge_amount: Number(doge.toFixed(8)),
    price_reference_usd: Number(state.price.toFixed(8)),
    quote_issued_at: quote.issued_at,
    quote_expires_at: quote.expires_at,
    quote_window_minutes: quote.minutes,
    setup_path: rail,
    route_type: routeReference.type,
    checklist: [
      "confirm merchant-owned payment route",
      "recheck DOGE amount after quote expiry",
      "publish volatility and refund language",
      "test one small purchase",
      "record proof with privacy review",
    ],
  };
  $("manifestOutput").value = JSON.stringify(manifest, null, 2);
  updateTransactionHandoff();
  buildValidationChecklist();
  buildPaymentPolicy();
}

function initCheckout() {
  if (!$("checkoutBuilder")) return;
  document.querySelectorAll("#checkoutBuilder input, #checkoutBuilder select").forEach((field) => {
    field.addEventListener("input", updateCheckout);
    field.addEventListener("change", updateCheckout);
  });
  $("copyUri").addEventListener("click", () => copyText($("paymentUriOut").textContent));
  $("copyManifest").addEventListener("click", () => copyText($("manifestOutput").value));
  updateCheckout();
}

function updateBadge() {
  if (!$("badgeBuilder")) return;
  const name = $("badgeMerchantName").value.trim() || "Merchant";
  const offer = $("badgeOffer").value.trim() || "DOGE accepted here";
  const link = $("badgeLink").value.trim() || "#";
  const logo = $("badgePreview")?.dataset.logo || document.body.dataset.dogeLogo || "";
  $("badgePreview").innerHTML = `
    <div class="badge-mark">
      <img src="${escapeHtml(logo)}" alt="">
      <span>Dogecoin Accepted</span>
    </div>
    <div class="badge-copy">
      <strong>${escapeHtml(name)}</strong>
      <small>${escapeHtml(offer)}</small>
    </div>
  `;
  $("badgeCode").value = `<a href="${escapeHtml(link)}" style="display:inline-grid;grid-template-columns:46px minmax(0,1fr);align-items:center;gap:14px;min-width:300px;max-width:360px;min-height:106px;padding:12px 14px;border:2px solid #f4bd2a;border-radius:10px;background:linear-gradient(135deg,#171715,#2b240e);color:#fff;text-decoration:none;font-family:system-ui,sans-serif;box-shadow:0 12px 28px rgba(23,23,21,.18)">
  <img src="${escapeHtml(logo)}" alt="" style="width:46px;height:46px;border-radius:50%;background:#f4bd2a;box-shadow:0 0 0 3px rgba(244,189,42,.22)">
  <span style="display:grid;gap:3px">
    <span style="color:#f4bd2a;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.08em">Dogecoin Accepted</span>
    <strong style="font-size:18px;line-height:1.12">${escapeHtml(name)}</strong>
    <small style="color:rgba(255,255,255,.78);font-size:13px">${escapeHtml(offer)}</small>
  </span>
</a>`;
}

function initBadge() {
  if (!$("badgeBuilder")) return;
  document.querySelectorAll("#badgeBuilder input").forEach((field) => {
    field.addEventListener("input", updateBadge);
  });
  $("copyBadge").addEventListener("click", () => copyText($("badgeCode").value));
  updateBadge();
}

function dogePriceSnippetMarkup(label, link, price = state.price) {
  const safeLabel = label || "DOGE/USD";
  const safeLink = safeSnippetUrl(link, "https://commerce.dog/statistics/");
  const fallbackPrice = Number.isFinite(Number(price)) ? Number(price) : FALLBACK_PRICE;
  return `<a data-doge-price-badge href="${escapeHtml(safeLink)}" style="display:inline-grid;grid-template-columns:auto 1fr;gap:10px;align-items:center;min-width:220px;padding:12px 14px;border:1px solid #dfe4dd;border-radius:10px;background:#fff;color:#171715;text-decoration:none;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 12px 28px rgba(23,23,21,.08)">
  <span aria-hidden="true" style="display:grid;place-items:center;width:36px;height:36px;border-radius:50%;background:#f4bd2a;color:#171715;font-weight:900">DOGE</span>
  <span style="display:grid;gap:2px"><small style="color:#5d625f;font-size:11px;font-weight:900;letter-spacing:.08em;text-transform:uppercase">${escapeHtml(safeLabel)}</small><strong data-doge-price-value style="font-size:24px;line-height:1">${escapeHtml(moneyPrecise.format(fallbackPrice))}</strong><small style="color:#5d625f;font-size:12px">Live price reference</small></span>
</a>
<script>
(() => {
  const fallback = ${JSON.stringify(Number(fallbackPrice.toFixed(8)))};
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 });
  const fetcher = (function () {
    if (typeof window.dogeLimitedFetch === "function") return window.dogeLimitedFetch;
    let lastAt = 0;
    return function coinbaseLimitedFetch(url, opts) {
      const wait = Math.max(0, 110 - (Date.now() - lastAt));
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          lastAt = Date.now();
          fetch(url, opts).then(resolve).catch(reject);
        }, wait);
      });
    };
  })();
  async function refresh() {
    let price = fallback;
    try {
      const response = await fetcher("https://api.exchange.coinbase.com/products/DOGE-USD/ticker", { cache: "no-store" });
      const payload = await response.json();
      const next = Number(payload.price);
      if (Number.isFinite(next) && next > 0) price = next;
    } catch {}
    document.querySelectorAll("[data-doge-price-badge] [data-doge-price-value]").forEach((node) => {
      node.textContent = money.format(price);
    });
  }
  refresh();
  setInterval(refresh, 60000);
})();
</script>`;
}

function updatePriceSnippet() {
  if (!$("priceSnippetBuilder")) return;
  const label = $("priceSnippetLabel")?.value.trim() || "DOGE/USD";
  const link = $("priceSnippetLink")?.value.trim() || "https://commerce.dog/statistics/";
  const snippet = dogePriceSnippetMarkup(label, link);
  if ($("priceSnippetPreview")) $("priceSnippetPreview").innerHTML = snippet.split("<script>")[0];
  if ($("priceSnippetCode")) $("priceSnippetCode").value = snippet;
}

function initPriceSnippetBuilder() {
  if (!$("priceSnippetBuilder")) return;
  document.querySelectorAll("#priceSnippetBuilder input").forEach((field) => field.addEventListener("input", updatePriceSnippet));
  $("copyPriceSnippet")?.addEventListener("click", () => copyText($("priceSnippetCode")?.value || "", "Price snippet copied."));
  updatePriceSnippet();
}

function defaultSparkPrices() {
  const base = Number.isFinite(Number(state.price)) && Number(state.price) > 0 ? Number(state.price) : FALLBACK_PRICE;
  return [0.94, 0.98, 0.96, 1.03, 1.01, 1.08, 1.05, 1.11, 1.07, 1.14].map((factor) => Number((base * factor).toFixed(6)));
}

function sparkPolyline(points, width = 260, height = 68) {
  const values = points.map(Number).filter((value) => Number.isFinite(value) && value > 0);
  const safe = values.length > 1 ? values : defaultSparkPrices();
  const min = Math.min(...safe);
  const max = Math.max(...safe);
  const range = Math.max(max - min, 0.000001);
  return safe.map((value, index) => {
    const x = (index / Math.max(safe.length - 1, 1)) * width;
    const y = height - ((value - min) / range) * (height - 8) - 4;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function sparkSnippetMarkup(title, link) {
  const safeTitle = title || "DOGE 7-day spark";
  const safeLink = safeSnippetUrl(link, "https://commerce.dog/statistics/");
  const points = defaultSparkPrices();
  const polyline = sparkPolyline(points);
  const price = Number.isFinite(Number(state.price)) ? Number(state.price) : FALLBACK_PRICE;
  return `<a data-doge-spark href="${escapeHtml(safeLink)}" style="display:grid;gap:9px;width:min(100%,360px);padding:14px;border:1px solid #dfe4dd;border-radius:10px;background:linear-gradient(135deg,#fff,#fff9df);color:#171715;text-decoration:none;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 12px 28px rgba(23,23,21,.08)">
  <span style="display:flex;align-items:center;justify-content:space-between;gap:12px"><strong style="font-size:16px">${escapeHtml(safeTitle)}</strong><small data-doge-spark-price style="color:#0f8f78;font-weight:900">${escapeHtml(moneyPrecise.format(price))}</small></span>
  <svg viewBox="0 0 260 68" role="img" aria-label="${escapeHtml(safeTitle)}" style="width:100%;height:68px;overflow:visible">
    <polyline data-doge-spark-line fill="none" stroke="#0f8f78" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" points="${escapeHtml(polyline)}"></polyline>
    <line x1="0" y1="62" x2="260" y2="62" stroke="#dfe4dd" stroke-width="1"></line>
  </svg>
  <small style="color:#5d625f">Coinbase DOGE-USD candles with local fallback.</small>
</a>
<script>
(() => {
  const fallback = ${JSON.stringify(points)};
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 });
  function line(values) {
    const safe = values.length > 1 ? values : fallback;
    const min = Math.min(...safe);
    const max = Math.max(...safe);
    const range = Math.max(max - min, 0.000001);
    return safe.map((value, index) => {
      const x = (index / Math.max(safe.length - 1, 1)) * 260;
      const y = 68 - ((value - min) / range) * 60 - 4;
      return x.toFixed(1) + "," + y.toFixed(1);
    }).join(" ");
  }
  async function refresh() {
    let values = fallback;
    try {
      const end = new Date();
      const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
      const url = "https://api.exchange.coinbase.com/products/DOGE-USD/candles?granularity=86400&start=" + encodeURIComponent(start.toISOString()) + "&end=" + encodeURIComponent(end.toISOString());
      const fetcher = window.dogeLimitedFetch || fetch;
      const response = await fetcher(url, { cache: "no-store" });
      const rows = await response.json();
      if (Array.isArray(rows) && rows.length) values = rows.map((row) => Number(row[4])).filter(Boolean).reverse();
    } catch {}
    document.querySelectorAll("[data-doge-spark]").forEach((root) => {
      const latest = values[values.length - 1] || fallback[fallback.length - 1];
      const lineNode = root.querySelector("[data-doge-spark-line]");
      const priceNode = root.querySelector("[data-doge-spark-price]");
      if (lineNode) lineNode.setAttribute("points", line(values));
      if (priceNode) priceNode.textContent = money.format(latest);
    });
  }
  refresh();
  setInterval(refresh, 90000);
})();
</script>`;
}

function updateSparkSnippet() {
  if (!$("sparkSnippetBuilder")) return;
  const title = $("sparkSnippetTitle")?.value.trim() || "DOGE 7-day spark";
  const link = $("sparkSnippetLink")?.value.trim() || "https://commerce.dog/statistics/";
  const snippet = sparkSnippetMarkup(title, link);
  if ($("sparkSnippetPreview")) $("sparkSnippetPreview").innerHTML = snippet.split("<script>")[0];
  if ($("sparkSnippetCode")) $("sparkSnippetCode").value = snippet;
}

function initSparkSnippetBuilder() {
  if (!$("sparkSnippetBuilder")) return;
  document.querySelectorAll("#sparkSnippetBuilder input").forEach((field) => field.addEventListener("input", updateSparkSnippet));
  $("copySparkSnippet")?.addEventListener("click", () => copyText($("sparkSnippetCode")?.value || "", "Spark chart snippet copied."));
  updateSparkSnippet();
}

function receiptState() {
  const txid = $("receiptTxId")?.value.trim() || "sample-local-test";
  const address = $("receiptAddress")?.value.trim() || savedToolWalletAddress();
  const doge = Math.max(0, numericValue("receiptDoge", 0));
  const usd = Math.max(0, numericValue("receiptUsd", 0));
  return {
    merchant: $("receiptMerchantName")?.value.trim() || "DOGE Merchant",
    txid,
    address,
    doge,
    usd,
    memo: $("receiptMemo")?.value.trim() || "DOGE sale",
    explorer: txid && txid !== "sample-local-test"
      ? `https://blockchair.com/dogecoin/transaction/${encodeURIComponent(txid)}`
      : "https://blockchair.com/dogecoin",
    issued_at: new Date().toISOString(),
  };
}

function receiptSnippetMarkup(receipt) {
  return `<section data-doge-receipt style="display:grid;gap:10px;width:min(100%,430px);padding:16px;border:1px solid #dfe4dd;border-radius:10px;background:#fff;color:#171715;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 12px 28px rgba(23,23,21,.08)">
  <span style="color:#96690e;font-size:12px;font-weight:900;letter-spacing:.08em;text-transform:uppercase">Dogecoin receipt</span>
  <strong style="font-size:22px;line-height:1.05">${escapeHtml(receipt.merchant)}</strong>
  <span style="color:#5d625f">${escapeHtml(receipt.memo)}</span>
  <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">
    <span style="padding:10px;border:1px solid #dfe4dd;border-radius:8px;background:#fbfcf7"><small style="display:block;color:#5d625f;font-weight:900;text-transform:uppercase">DOGE</small><b>${escapeHtml(receipt.doge.toFixed(8))}</b></span>
    <span style="padding:10px;border:1px solid #dfe4dd;border-radius:8px;background:#fbfcf7"><small style="display:block;color:#5d625f;font-weight:900;text-transform:uppercase">USD</small><b>${escapeHtml(moneyCents.format(receipt.usd))}</b></span>
  </div>
  <code style="display:block;overflow-wrap:anywhere;padding:10px;border-radius:8px;background:#151515;color:#fff">${escapeHtml(receipt.txid)}</code>
  <small style="display:block;overflow-wrap:anywhere;color:#5d625f">Receiver: ${escapeHtml(receipt.address)}</small>
  <a href="${escapeHtml(receipt.explorer)}" target="_blank" rel="noreferrer" style="display:inline-flex;width:max-content;max-width:100%;padding:10px 12px;border-radius:8px;background:#f4bd2a;color:#171715;font-weight:900;text-decoration:none">Open transaction</a>
</section>`;
}

function updateReceiptSnippet() {
  if (!$("receiptSnippetBuilder")) return;
  const receipt = receiptState();
  const snippet = receiptSnippetMarkup(receipt);
  if ($("receiptSnippetPreview")) $("receiptSnippetPreview").innerHTML = snippet;
  if ($("receiptSnippetCode")) $("receiptSnippetCode").value = snippet;
}

function initReceiptSnippetBuilder() {
  if (!$("receiptSnippetBuilder")) return;
  document.querySelectorAll("#receiptSnippetBuilder input").forEach((field) => field.addEventListener("input", updateReceiptSnippet));
  $("copyReceiptSnippet")?.addEventListener("click", () => copyText($("receiptSnippetCode")?.value || "", "Receipt snippet copied."));
  $("copyReceiptJson")?.addEventListener("click", () => copyText(JSON.stringify(receiptState(), null, 2), "Receipt JSON copied."));
  updateReceiptSnippet();
}

function buildValidationChecklist() {
  if (!$("validationBuilder")) return;
  const txId = $("validationTxId").value.trim();
  const cleanTxId = txId && !normalize(txId).includes("paste transaction") ? txId : "";
  const explorerUrl = cleanTxId
    ? `https://blockchair.com/dogecoin/transaction/${encodeURIComponent(cleanTxId)}`
    : "https://blockchair.com/dogecoin";
  const address = $("validationAddress").value.trim();
  const expectedDoge = numericValue("validationDoge", 0);
  const confirmations = numericValue("validationConfirmations", 1);
  const verifyLink = $("verifyTransactionLink");

  if (verifyLink) {
    verifyLink.href = explorerUrl;
  }

  $("validationOutput").value = [
    "Dogecoin transaction validation checklist",
    "",
    `Transaction ID: ${cleanTxId || "pending"}`,
    `Explorer: ${explorerUrl}`,
    `Expected receiving address: ${address || "pending"}`,
    `Expected amount: ${expectedDoge.toFixed(8)} DOGE`,
    `Required confirmations: ${number.format(confirmations)}`,
    "",
    "Before fulfilling the order:",
    "1. Open a trusted Dogecoin blockchain explorer or wallet transaction view.",
    "2. Search the transaction ID and confirm it is a native Dogecoin transaction.",
    "3. Confirm the receiving address matches the merchant-owned route above.",
    "4. Confirm the DOGE amount is equal to or greater than the quoted amount.",
    "5. Wait for the merchant's required confirmation count.",
    "6. Save the transaction ID, route, amount, confirmation count, fee, and timestamp in the merchant's records.",
    "",
    "Do not publish buyer private data. Public proof should show only merchant-approved, privacy-safe facts.",
  ].join("\n");
}

function initValidationBuilder() {
  if (!$("validationBuilder")) return;
  ["validationTxId", "validationAddress", "validationDoge", "validationConfirmations"].forEach((id) => {
    const element = $(id);
    if (!element) return;
    element.addEventListener("input", buildValidationChecklist);
    element.addEventListener("change", buildValidationChecklist);
  });
  $("buildValidation")?.addEventListener("click", buildValidationChecklist);
  $("copyValidation")?.addEventListener("click", () => copyText($("validationOutput").value));
  buildValidationChecklist();
}

function policyRuleText(type, value) {
  const rules = {
    underpay: {
      remainder: "Do not fulfill until the buyer sends the remaining DOGE or the order is converted to a lower-value item.",
      refund: "Cancel the order and refund according to the merchant refund process after staff review.",
      manual: "Pause fulfillment and escalate to the manager or owner before sending goods, services, or refunds.",
    },
    overpay: {
      credit: "Record the excess as store credit or refund the excess only after staff review.",
      refund: "Refund the excess to a verified return route after support confirms the customer and order.",
      manual: "Pause the exception and escalate to the manager or owner before issuing credit or refund.",
    },
  };
  return rules[type]?.[value] || rules[type]?.manual || "Escalate to manager review.";
}

function syncPolicyFromCheckout(options = {}) {
  if (!$("policyBuilder")) return;
  const merchant = $("checkoutMerchantName")?.value.trim() || $("fitMerchantName")?.value.trim();
  if (merchant && $("policyMerchantName")) $("policyMerchantName").value = merchant;
  if ($("validationConfirmations") && $("policyConfirmations")) {
    $("policyConfirmations").value = String(Math.max(0, numericValue("validationConfirmations", 1)));
  }
  buildPaymentPolicy();
  if (!options.silent) announce("Policy synced from the current checkout.");
}

function buildPaymentPolicy() {
  if (!$("policyBuilder")) return;
  const merchant = $("policyMerchantName")?.value.trim() || $("checkoutMerchantName")?.value.trim() || "Merchant";
  const contact = $("policyContact")?.value.trim() || "merchant support";
  const quoteMinutes = Math.max(1, numericValue("policyQuoteMinutes", DEFAULT_QUOTE_MINUTES));
  const confirmations = Math.max(0, numericValue("policyConfirmations", 1));
  const usd = numericValue("usdAmount", 0);
  const { doge } = buildPaymentUri();
  const routeReference = paymentRouteReference();
  const underpay = policyRuleText("underpay", $("policyUnderpay")?.value || "manual");
  const overpay = policyRuleText("overpay", $("policyOverpay")?.value || "manual");
  const output = [
    `Dogecoin checkout policy - ${merchant}`,
    "",
    `Quote window: The DOGE amount is calculated from the displayed DOGE/USD reference and is valid for ${quoteMinutes} minute(s). If the buyer pays after the window, staff should refresh the quote before marking the order paid.`,
    `Current checkout reference: ${moneyCents.format(usd)} / ${Number.isFinite(doge) ? doge.toFixed(8) : "0.00000000"} DOGE via ${routeReference.label}.`,
    `Payment reference: ${routeReference.reference}`,
    "",
    `Paid rule: mark the order paid only when at least the expected DOGE reaches the merchant-approved route with ${confirmations} confirmation(s), or the hosted checkout provider marks the invoice paid. Do not fulfill from screenshots alone.`,
    `Underpayment: ${underpay}`,
    `Overpayment: ${overpay}`,
    "",
    `Refunds: refunds require merchant approval, the original order record, and a support trail through ${contact}. For direct wallet payments, confirm the return route before sending DOGE out.`,
    "Records to keep: order ID, time, USD price, DOGE amount, receiving route, transaction ID, confirmation count, quote timestamp, refund state, and private-data redaction status.",
  ].join("\n");
  if ($("policyOutput")) $("policyOutput").value = output;
}

function initPaymentPolicy() {
  if (!$("policyBuilder")) return;
  document.querySelectorAll("#policyBuilder input, #policyBuilder select").forEach((field) => {
    field.addEventListener("input", buildPaymentPolicy);
    field.addEventListener("change", buildPaymentPolicy);
  });
  [
    "checkoutMerchantName",
    "walletAddress",
    "usdAmount",
    "invoiceMemo",
    "hostedCheckoutUrl",
    "paymentRail",
    "validationConfirmations",
  ].forEach((id) => {
    const element = $(id);
    if (!element) return;
    element.addEventListener("input", buildPaymentPolicy);
    element.addEventListener("change", buildPaymentPolicy);
  });
  $("copyPolicy")?.addEventListener("click", () => copyText($("policyOutput")?.value || "", "Payment policy copied."));
  $("syncPolicy")?.addEventListener("click", syncPolicyFromCheckout);
  syncPolicyFromCheckout({ silent: true });
}

function buildOutreach() {
  if (!$("outreachBuilder")) return;
  const name = $("outreachName").value.trim() || "there";
  const city = $("outreachCity").value.trim() || "your community";
  const type = $("outreachType").value;
  const tone = $("outreachTone").value;
  const opener =
    tone === "warm"
      ? `Hi ${name},\n\nYour audience looks like a strong fit for a small DOGE commerce pilot in ${city}.`
      : tone === "proof"
        ? `Hi ${name},\n\nWe are collecting merchant-approved proof that DOGE can be used for normal purchases in ${city}.`
        : `Hi ${name},\n\nI am organizing a legal Dogecoin adoption sprint focused on real checkout usage in ${city}.`;

  const bodies = {
    merchant: "The ask is simple: enable one DOGE payment path, run one narrow offer, and share merchant-approved results after the test. The customer message is that DOGE can be spent on a real product at your store.",
    creator: "The strongest format is a real product, tip goal, commission slot, or member perk payable in DOGE. Show the checkout path, disclose sponsorships, and avoid investment or price claims.",
    nonprofit: "Dogecoin has a long community-giving culture. A one-month donation pilot can use a QR link, public impact reporting, and plain sponsor disclosure without investment language.",
    processor: "We are building proof around real DOGE checkouts and merchant retention. The partner ask is a short setup sprint, clear route labels, and a public results report after the pilot.",
  };

  const close = "This campaign does not coordinate buys, promise returns, fake volume, or hide paid promotion. It exists to make Dogecoin easier to use.\n\nWould you be open to a short setup call this week?";
  $("outreachOutput").value = `${opener}\n\n${bodies[type]}\n\n${close}`;
}

function initOutreach() {
  if (!$("outreachBuilder")) return;
  document.querySelectorAll("#outreachBuilder input, #outreachBuilder select").forEach((field) => {
    field.addEventListener("input", buildOutreach);
    field.addEventListener("change", buildOutreach);
  });
  $("buildOutreach").addEventListener("click", buildOutreach);
  $("copyOutreach").addEventListener("click", () => copyText($("outreachOutput").value));
  buildOutreach();
}

function activeQuickKit() {
  return document.querySelector(".commerce-kit-card:not([hidden])");
}

function quickKitText(card) {
  if (!card) return "";
  const data = card.dataset;
  return [
    `DOGE quick commerce kit - ${data.name}`,
    "",
    "Buyer moment:",
    `Offer: ${data.offer}`,
    `Buyer prompt: ${data.buyer}`,
    `Visible placement: ${data.placement}`,
    "",
    "Merchant install:",
    `Payment route: ${data.route}`,
    `Starter setup: ${data.setup}`,
    `Staff script: ${data.staff}`,
    "",
    "Proof and adoption:",
    data.proofRoute ? `Proof route label: ${data.proofRoute}` : "Proof route label: selected payment route",
    `Recordkeeping note: ${data.proof}`,
    `Repeat hook: ${data.repeat}`,
    `Adoption channel: ${data.channel}`,
    `Next merchant ask: ${data.next}`,
    "",
    "First 30 minutes:",
    "1. Confirm the merchant-owned route and write the USD price next to the DOGE instruction.",
    "2. Put the QR, payment link, or invoice in the exact buyer moment listed above.",
    "3. Run one live low-value test and write down confirmation time, fee, and cash-out route.",
    "4. Tell staff what screen or receipt counts as paid.",
    "5. Assign one person to capture proof and redact private details.",
    "",
    "Public copy rule: talk about what was bought, where DOGE was accepted, and what was verified. Do not make price, return, or trading claims.",
  ].join("\n");
}

function buyerSignText(card) {
  if (!card) return "";
  const data = card.dataset;
  return [
    `DOGE accepted here: ${data.offer}`,
    "",
    data.buyer,
    `How to pay: ${data.route}.`,
    `Staff will confirm: ${data.staff}`,
    "",
    "Receipts and screenshots are optional. Public proof is shared only after privacy review and permission.",
  ].join("\n");
}

function promoterPitchText(card) {
  if (!card) return "";
  const data = card.dataset;
  return [
    `DOGE adoption pitch - ${data.name}`,
    "",
    `Best fit: ${data.best}`,
    `Starter offer: ${data.offer}`,
    `Payment route: ${data.route}`,
    `Launch speed: ${data.time}`,
    "",
    "Why this works:",
    `${data.buyer} The goal is not to create a new habit from scratch; it is to add DOGE to a buying moment that already happens.`,
    "",
    "Merchant ask:",
    "Run one narrow DOGE-ready offer, post one visible QR or payment link, let staff follow one confirmation rule, and approve a privacy-safe recap after the test.",
    "",
    "Adoption spread:",
    `Use the recap to reach ${data.channel}.`,
    `Next ask: ${data.next}`,
    "",
    "Guardrail:",
    "Talk about the checkout, the item, the merchant, and the verified result. Do not make price, return, or trading claims.",
  ].join("\n");
}

function adoptionRelayText(card) {
  if (!card) return "";
  const data = card.dataset;
  return [
    `DOGE adoption relay - ${data.name}`,
    "",
    `Use the first proof to recruit: ${data.channel}.`,
    `Repeatable buyer reason: ${data.repeat}`,
    `Next merchant ask: ${data.next}`,
    "",
    "Proof metric to show:",
    data.proof,
    "",
    "Relay script:",
    `We ran ${data.offer} through ${data.route}. The useful part was the checkout path, staff confirmation rule, and merchant-approved proof. Would you run the same ${data.name} kit for one narrow buying moment this week?`,
    "",
    "Keep public posts factual: route, item, merchant permission, completed count, failed attempts, and limitations.",
  ].join("\n");
}

function activeCommercePackOption() {
  return document.querySelector(".commerce-pack-option.active");
}

function kitKeysFromPack(button) {
  return (button?.dataset.kitKeys || "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}

function commercePackText(button) {
  if (!button) return "Choose an adoption pack to create a rollout plan.";
  const data = button.dataset;
  return [
    `DOGE commerce adoption pack - ${data.name}`,
    "",
    `Program: ${data.program}`,
    `Best for: ${data.best}`,
    `Launch window: ${data.launchWindow}`,
    "",
    "Kit sequence:",
    data.kitNames,
    "",
    "Start here:",
    data.firstStep,
    "",
    "How it spreads:",
    data.relay,
    "",
    "Proof metric:",
    data.proofMetric,
    "",
    "Operator rule:",
    "Keep every public update tied to merchant-approved facts: route, item, completed count, failed attempts, retention signal, and privacy status.",
  ].join("\n");
}

function updateCommercePackOutput(button = activeCommercePackOption()) {
  if ($("activePackName")) {
    $("activePackName").textContent = button ? button.dataset.name : "No pack selected";
  }
  if ($("activePackWindow")) {
    $("activePackWindow").textContent = button
      ? button.dataset.launchWindow
      : "Choose a pack to group related DOGE checkout moments.";
  }
  if ($("activePackMetric")) {
    $("activePackMetric").textContent = button
      ? button.dataset.proofMetric
      : "Proof metrics appear after a pack is selected.";
  }
  if ($("commercePackOutput")) {
    $("commercePackOutput").value = commercePackText(button);
  }
}

function setActiveCommercePack(button) {
  document.querySelectorAll(".commerce-pack-option").forEach((option) => {
    const selected = option === button;
    option.classList.toggle("active", selected);
    option.setAttribute("aria-pressed", selected ? "true" : "false");
  });
  state.activeCommercePack = button?.dataset.pack || "";
  updateCommercePackOutput(button);
}

function clearCommercePackSelection() {
  state.activePackKits = [];
  state.activeCommercePack = "";
  document.querySelectorAll(".commerce-pack-option").forEach((option) => {
    option.classList.remove("active");
    option.setAttribute("aria-pressed", "false");
  });
  updateCommercePackOutput(null);
}

function findCommercePackButton(key) {
  return Array.from(document.querySelectorAll(".commerce-pack-option")).find((button) => button.dataset.pack === key);
}

function applyCommercePack(button = activeCommercePackOption(), options = {}) {
  button = button || document.querySelector(".commerce-pack-option");
  if (!button) return false;
  setActiveCommercePack(button);
  clearSetupShortcutSelection();
  clearKitPresetSelection();
  state.activePackKits = kitKeysFromPack(button);
  if ($("kitAudienceFilter")) $("kitAudienceFilter").value = "all";
  if ($("kitVerticalFilter")) $("kitVerticalFilter").value = "all";
  if ($("kitRailFilter")) $("kitRailFilter").value = "all";
  if ($("kitSpeedFilter")) $("kitSpeedFilter").value = "all";
  if ($("kitSearchFilter")) $("kitSearchFilter").value = "";
  filterQuickKits();

  const firstKit = button.dataset.firstKit;
  const firstButton = firstKit ? findKitButton(firstKit) : null;
  if (firstButton && !firstButton.hidden) {
    selectQuickKit(firstKit);
  }

  if (!options.silent) {
    announce(`${button.dataset.name} opened. Use the first kit, then copy the pack plan for the next venue.`);
  }
  return true;
}

function applyCommercePackByKey(key, options = {}) {
  const button = findCommercePackButton(key);
  return applyCommercePack(button, options);
}

function selectedOptionText(id, fallback = "") {
  const element = $(id);
  if (!element || !element.options || element.selectedIndex < 0) return fallback;
  return element.options[element.selectedIndex].textContent.trim() || fallback;
}

function buildTransactionHandoffText() {
  const card = activeQuickKit();
  const data = card?.dataset || {};
  const merchant = $("checkoutMerchantName")?.value.trim() || $("fitMerchantName")?.value.trim() || "Merchant";
  const usd = numericValue("usdAmount", 0);
  const memo = $("invoiceMemo")?.value.trim() || data.offer || "DOGE payment";
  const { doge, uri } = buildPaymentUri();
  const routeReference = paymentRouteReference();
  const cashOutRoute = selectedOptionText("offrampRoute", "merchant-selected cash-out route");
  const route = data.route || selectedOptionText("paymentRail", "selected payment route");
  const offer = data.offer || memo;

  return [
    `DOGE transaction handoff - ${merchant}`,
    "",
    "Buyer-facing instruction:",
    `${data.buyer || "Scan or click the merchant payment route and send the quoted DOGE amount."}`,
    `Offer: ${offer}`,
    `USD reference: ${moneyCents.format(usd)}`,
    `DOGE amount at current reference: ${Number.isFinite(doge) ? doge.toFixed(8) : "0.00000000"} DOGE`,
    `Payment route: ${route}`,
    `Payment reference: ${routeReference.reference}`,
    `Dogecoin URI fallback: ${uri}`,
    "",
    "Staff closeout:",
    `${data.staff || "Confirm the amount and route before marking the order paid."}`,
    "1. Confirm the buyer used the route above.",
    "2. Confirm the displayed amount matches the sale.",
    "3. Mark the order paid only after the agreed confirmation signal.",
    "4. Record fee, timing, refund note, and settlement choice.",
    "",
    "Settlement note:",
    `Cash-out planning route: ${cashOutRoute}. Run one small test transfer before merchant-scale settlement.`,
    "",
    "Record handoff:",
    `${data.proof || "Capture the route, DOGE amount, USD value, redacted receipt, and merchant approval."}`,
    "Keep the redacted record in the merchant's own support notes before public posting.",
    "",
    "Public copy rule: publish what happened and what was verified. Do not make price, return, or trading claims.",
  ].join("\n");
}

function firstSaleRunbookText() {
  const card = activeQuickKit();
  const data = card?.dataset || {};
  const merchant = $("checkoutMerchantName")?.value.trim() || $("fitMerchantName")?.value.trim() || "Merchant";
  const usd = numericValue("usdAmount", 0);
  const { doge } = buildPaymentUri();
  const routeReference = paymentRouteReference();
  const offer = data.offer || $("invoiceMemo")?.value.trim() || "DOGE payment";

  return [
    `First DOGE sale runbook - ${merchant}`,
    "",
    `Kit: ${data.name || "selected DOGE payment kit"}`,
    `Offer: ${offer}`,
    `USD reference: ${moneyCents.format(usd)}`,
    `DOGE estimate: ${Number.isFinite(doge) ? doge.toFixed(8) : "0.00000000"} DOGE`,
    `Payment reference: ${routeReference.reference}`,
    "",
    "1. Buyer sees",
    data.buyer || "Scan or click the merchant payment route and send the quoted DOGE amount.",
    "",
    "2. Buyer pays",
    `Use ${routeReference.label}: ${routeReference.reference}`,
    "",
    "3. Staff checks",
    data.staff || "Confirm route, amount, transaction ID, and the merchant's confirmation rule before fulfillment.",
    "",
    "4. Proof owner saves",
    data.proof || "Capture route, DOGE amount, USD value, redacted receipt, and merchant approval.",
    "",
    "5. Adoption follow-up",
    data.next || "Use the proof recap to ask one similar merchant to run the same narrow buying moment.",
  ].join("\n");
}

function updateTransactionHandoff() {
  const output = $("transactionHandoffOutput");
  if (!output) return;
  const card = activeQuickKit();
  const data = card?.dataset || {};
  const routeReference = paymentRouteReference();
  $("handoffOffer").textContent = data.offer || $("invoiceMemo")?.value.trim() || "DOGE payment";
  $("handoffRoute").textContent = data.route || selectedOptionText("paymentRail", "selected payment route");
  $("handoffProof").textContent =
    data.proof || "Capture route, amount, receipt, confirmation, and approval.";
  if ($("firstScanSummary")) {
    const kitName = data.name || "Selected kit";
    const offer = data.offer || $("invoiceMemo")?.value.trim() || "DOGE payment";
    $("firstScanSummary").textContent = `${kitName}: ${offer}. Use ${routeReference.label.toLowerCase()} and save proof before publishing anything.`;
  }
  if ($("firstScanBuyer")) {
    $("firstScanBuyer").textContent = data.buyer || "Scan or click the merchant payment route and send the quoted DOGE amount.";
  }
  if ($("firstScanPayment")) {
    $("firstScanPayment").textContent = routeReference.reference;
  }
  if ($("firstScanValidation")) {
    $("firstScanValidation").textContent =
      data.staff || "Confirm route, amount, transaction ID, and the merchant's confirmation rule before fulfillment.";
  }
  if ($("firstScanProof")) {
    $("firstScanProof").textContent =
      data.proof || "Capture route, DOGE amount, USD value, redacted receipt, and merchant approval.";
  }
  if ($("handoffRelayTarget")) {
    $("handoffRelayTarget").textContent = data.channel || "Choose a kit to restore the next merchant target.";
  }
  if ($("handoffRelayReason")) {
    $("handoffRelayReason").textContent = data.repeat || "Choose a kit to restore the repeatable buyer reason.";
  }
  if ($("handoffRelayNext")) {
    $("handoffRelayNext").textContent = data.next || "Choose a kit before asking the next venue to reuse it.";
  }
  output.value = buildTransactionHandoffText();
}

window.updateTransactionHandoff = updateTransactionHandoff;

function initTransactionHandoff() {
  if (!$("transactionHandoffOutput")) return;
  [
    "checkoutMerchantName",
    "walletAddress",
    "usdAmount",
    "invoiceMemo",
    "hostedCheckoutUrl",
    "badgeLink",
    "paymentRail",
    "offrampRoute",
    "offrampPrice",
    "offrampFee",
  ].forEach((id) => {
    const element = $(id);
    if (!element) return;
    element.addEventListener("input", updateTransactionHandoff);
    element.addEventListener("change", updateTransactionHandoff);
  });
  $("copyTransactionHandoff")?.addEventListener("click", () => copyText($("transactionHandoffOutput").value));
  $("copyTransactionHandoffSummary")?.addEventListener("click", () => copyText($("transactionHandoffOutput").value));
  $("copyFirstSaleRunbook")?.addEventListener("click", () => copyText(firstSaleRunbookText(), "First-sale runbook copied."));
  updateTransactionHandoff();
}

function updateQuickKitOutput() {
  const output = $("quickKitOutput");
  if (!output) return;
  const card = activeQuickKit();
  const data = card?.dataset || {};
  output.value = card
    ? quickKitText(card)
    : "No quick commerce kit matches the current filters. Clear one filter or search for a broader buyer moment.";
  if ($("selectedBuyerMoment")) {
    $("selectedBuyerMoment").textContent = card
      ? data.buyer
      : "No buyer moment matches the current filters.";
  }
  if ($("selectedStaffMoment")) {
    $("selectedStaffMoment").textContent = card
      ? data.staff
      : "Clear one filter to restore a runnable staff script.";
  }
  if ($("selectedSpreadMoment")) {
    $("selectedSpreadMoment").textContent = card
      ? `${data.repeat} ${data.next}`
      : "Broaden the search to find the next adoption move.";
  }
  if ($("relayTarget")) {
    $("relayTarget").textContent = card ? data.channel : "No next target selected.";
  }
  if ($("relayBuyerReason")) {
    $("relayBuyerReason").textContent = card ? data.repeat : "Choose a kit to restore a repeatable buyer reason.";
  }
  if ($("relayMetric")) {
    $("relayMetric").textContent = card ? data.proof : "Choose a kit to restore the proof metric.";
  }
  if ($("kitPathSummary")) {
    $("kitPathSummary").textContent = card
      ? `${data.name}: ${data.time} launch, ${data.route}, ${data.offer}.`
      : "No kit selected. Clear one filter to restore the guided setup path.";
  }
  if ($("setupSummaryKit")) {
    $("setupSummaryKit").textContent = card ? `${data.name} (${data.time})` : "No kit selected";
  }
  if ($("setupSummaryRoute")) {
    $("setupSummaryRoute").textContent = card ? data.route : "Clear one filter to restore a payment route.";
  }
  if ($("setupSummaryBuyer")) {
    $("setupSummaryBuyer").textContent = card ? data.buyer : "Choose a kit before writing buyer-facing payment copy.";
  }
  if ($("setupSummaryProof")) {
    $("setupSummaryProof").textContent = card ? data.proof : "Choose a kit before assigning proof collection.";
  }
  updateTransactionHandoff();
}

function selectQuickKit(key) {
  document.querySelectorAll(".kit-option").forEach((button) => {
    const selected = button.dataset.kit === key;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });
  document.querySelectorAll(".commerce-kit-card").forEach((card) => {
    card.hidden = card.id !== `kit-${key}`;
  });
  updateQuickKitOutput();
}

function filterQuickKits() {
  const buttons = Array.from(document.querySelectorAll(".kit-option"));
  if (!buttons.length) return;

  const audience = $("kitAudienceFilter")?.value || "all";
  const vertical = $("kitVerticalFilter")?.value || "all";
  const rail = $("kitRailFilter")?.value || "all";
  const speed = $("kitSpeedFilter")?.value || "all";
  const query = normalize($("kitSearchFilter")?.value);
  const queryTerms = query.split(/\s+/).filter(Boolean);
  const packKeys = state.activePackKits;
  const matches = [];

  buttons.forEach((button) => {
    const packOk = !packKeys.length || packKeys.includes(button.dataset.kit);
    const audienceOk = audience === "all" || button.dataset.audience === audience;
    const verticalOk = vertical === "all" || button.dataset.vertical === vertical;
    const railOk = rail === "all" || button.dataset.rail === rail;
    const speedOk = speed === "all" || normalize(button.dataset.speed) === speed;
    const searchText = normalize(button.dataset.search);
    const queryOk = !queryTerms.length || queryTerms.every((term) => searchText.includes(term));
    const visible = packOk && audienceOk && verticalOk && railOk && speedOk && queryOk;
    button.hidden = !visible;
    if (visible) matches.push(button);
  });

  if ($("kitMatchCount")) {
    const label = matches.length === 1 ? "kit available" : "kits available";
    const scope = state.activeCommercePack ? " in pack" : "";
    $("kitMatchCount").textContent = `${matches.length} of ${buttons.length} ${label}${scope}`;
  }

  const activeButton = document.querySelector(".kit-option.active");
  if (matches.length && (!activeButton || activeButton.hidden)) {
    selectQuickKit(matches[0].dataset.kit);
    return;
  }

  if (!matches.length) {
    buttons.forEach((button) => {
      button.classList.remove("active");
      button.setAttribute("aria-pressed", "false");
    });
    document.querySelectorAll(".commerce-kit-card").forEach((card) => {
      card.hidden = true;
    });
  }

  updateQuickKitOutput();
}

function clearQuickKitFilters() {
  clearSetupShortcutSelection();
  clearKitPresetSelection();
  clearCommercePackSelection();
  if ($("kitAudienceFilter")) $("kitAudienceFilter").value = "all";
  if ($("kitVerticalFilter")) $("kitVerticalFilter").value = "all";
  if ($("kitRailFilter")) $("kitRailFilter").value = "all";
  if ($("kitSpeedFilter")) $("kitSpeedFilter").value = "all";
  if ($("kitSearchFilter")) $("kitSearchFilter").value = "";
  filterQuickKits();
}

function applyQuickKitQueryParams() {
  if (!$("kitAudienceFilter")) return { kit: "", pack: "" };
  const params = new URLSearchParams(window.location.search);
  if (!params.toString()) return { kit: "", pack: "" };

  setSelectValue("kitAudienceFilter", params.get("audience"));
  setSelectValue("kitVerticalFilter", params.get("vertical"));
  setSelectValue("kitRailFilter", params.get("rail"));
  setSelectValue("kitSpeedFilter", params.get("speed"));

  const query = params.get("q") || params.get("search");
  if (query && $("kitSearchFilter")) {
    $("kitSearchFilter").value = query;
  }

  return {
    kit: params.get("kit") || "",
    pack: params.get("pack") || "",
  };
}

function findKitButton(key) {
  return Array.from(document.querySelectorAll(".kit-option")).find((button) => button.dataset.kit === key);
}

function setActiveSetupShortcut(activeButton) {
  document.querySelectorAll(".setup-shortcut").forEach((button) => {
    const selected = button === activeButton;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });
}

function clearSetupShortcutSelection() {
  setActiveSetupShortcut(null);
}

function setActiveKitPreset(activeButton) {
  document.querySelectorAll(".kit-preset").forEach((button) => {
    const selected = button === activeButton;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });
}

function clearKitPresetSelection() {
  setActiveKitPreset(null);
}

function applyQuickKitPreset(button) {
  if (!button) return;
  clearSetupShortcutSelection();
  setActiveKitPreset(button);
  state.activePackKits = [];
  state.activeCommercePack = "";
  document.querySelectorAll(".commerce-pack-option").forEach((option) => {
    option.classList.remove("active");
    option.setAttribute("aria-pressed", "false");
  });
  updateCommercePackOutput(null);
  setSelectValue("kitAudienceFilter", button.dataset.audience);
  setSelectValue("kitVerticalFilter", button.dataset.vertical);
  setSelectValue("kitRailFilter", button.dataset.rail);
  setSelectValue("kitSpeedFilter", button.dataset.speed);
  if ($("kitSearchFilter")) $("kitSearchFilter").value = button.dataset.query || "";

  filterQuickKits();

  const requestedButton = findKitButton(button.dataset.kit);
  if (requestedButton?.hidden && $("kitSearchFilter")) {
    $("kitSearchFilter").value = "";
    filterQuickKits();
  }
  if (requestedButton && !requestedButton.hidden) {
    selectQuickKit(button.dataset.kit);
  }

  const label = button.querySelector("span")?.textContent || "Commerce";
  announce(`${label} preset selected. Apply the kit when the setup fields match.`);
}

function applySetupShortcut(button) {
  if (!button) return;
  setActiveSetupShortcut(button);
  clearKitPresetSelection();
  clearCommercePackSelection();

  setSelectValue("kitAudienceFilter", button.dataset.audience);
  setSelectValue("kitVerticalFilter", button.dataset.vertical);
  setSelectValue("kitRailFilter", button.dataset.rail);
  setSelectValue("kitSpeedFilter", button.dataset.speed);
  if ($("kitSearchFilter")) $("kitSearchFilter").value = button.dataset.query || "";

  filterQuickKits();

  const requestedButton = findKitButton(button.dataset.kit);
  if (requestedButton?.hidden && $("kitSearchFilter")) {
    $("kitSearchFilter").value = "";
    filterQuickKits();
  }
  if (requestedButton && !requestedButton.hidden) {
    selectQuickKit(button.dataset.kit);
  }

  applyQuickKit({ silent: true });
  if ($("paymentRail") && button.dataset.rail) $("paymentRail").value = button.dataset.rail;
  if ($("usdAmount") && button.dataset.amount) $("usdAmount").value = button.dataset.amount;
  if ($("invoiceMemo") && button.dataset.memo) $("invoiceMemo").value = button.dataset.memo;
  updateCheckout();
  buildValidationChecklist();
  updateMerchantFit();
  updateTransactionHandoff();

  const label = button.querySelector("span")?.textContent || "Setup";
  announce(`${label} shortcut applied. Review the merchant address before taking payment.`);
}

function matchQuickKitsToMerchantFit() {
  if (!$("kitVerticalFilter")) return;
  const vertical = $("fitVertical")?.value || "all";
  const rail = $("paymentRail")?.value || "all";

  clearSetupShortcutSelection();
  clearCommercePackSelection();
  if ($("kitAudienceFilter")) $("kitAudienceFilter").value = "all";
  if ($("kitSearchFilter")) $("kitSearchFilter").value = "";
  setSelectValue("kitVerticalFilter", vertical);
  if (rail === "native") {
    $("kitRailFilter").value = "all";
  } else {
    setSelectValue("kitRailFilter", rail);
  }

  filterQuickKits();
  document.querySelector("#quick-commerce-kits")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function applyQuickKit(options = {}) {
  const card = activeQuickKit();
  if (!card) return;
  const data = card.dataset;
  const proofRoute =
    data.proofRoute ||
    (data.rail === "wallet" ? "direct DOGE" : data.rail === "hosted" ? "Hosted checkout link" : "GigaWallet or self-hosted");

  syncMerchantNameFromFit();
  if ($("badgeOffer")) $("badgeOffer").value = data.offer || "";
  if ($("leadOffer")) $("leadOffer").value = data.offer || "";
  if ($("leadCheckout") && !$("leadCheckout").value.trim()) $("leadCheckout").value = data.route || "";
  if ($("invoiceMemo")) $("invoiceMemo").value = (data.offer || "DOGE payment").slice(0, 80);
  if ($("proofOffer")) $("proofOffer").value = data.offer || "";
  if ($("proofRoute")) $("proofRoute").value = proofRoute;

  if ($("outreachType") && data.audience) $("outreachType").value = data.audience;
  if ($("paymentRail") && data.rail) $("paymentRail").value = data.rail;
  if ($("fitVertical") && data.vertical) $("fitVertical").value = data.vertical;

  updateBadge();
  buildOutreach();
  updateCheckout();
  updateMerchantFit();
  updateQuickKitOutput();
  updateTransactionHandoff();
  if (!options.silent) {
    announce(`${data.name} applied to payment, badge, and proof fields.`);
  }
}

function initQuickKits() {
  if (!$("quickKitOutput")) return;
  $("toggleKitList")?.addEventListener("click", () => {
    const picker = $("kitPicker");
    const button = $("toggleKitList");
    if (!picker || !button) return;
    const expanded = picker.classList.toggle("expanded");
    picker.classList.toggle("collapsed", !expanded);
    button.setAttribute("aria-expanded", expanded ? "true" : "false");
    button.textContent = expanded ? "Collapse list" : "Expand list";
  });
  document.querySelectorAll(".kit-option").forEach((button) => {
    button.addEventListener("click", () => {
      clearSetupShortcutSelection();
      clearKitPresetSelection();
      selectQuickKit(button.dataset.kit);
    });
  });
  document.querySelectorAll(".setup-shortcut").forEach((button) => {
    button.addEventListener("click", () => applySetupShortcut(button));
  });
  document.querySelectorAll(".kit-preset").forEach((button) => {
    button.addEventListener("click", () => applyQuickKitPreset(button));
  });
  document.querySelectorAll(".commerce-pack-option").forEach((button) => {
    button.addEventListener("click", () => applyCommercePack(button));
  });
  ["kitAudienceFilter", "kitVerticalFilter", "kitRailFilter", "kitSpeedFilter", "kitSearchFilter"].forEach((id) => {
    const element = $(id);
    if (!element) return;
    element.addEventListener("input", () => {
      clearSetupShortcutSelection();
      clearKitPresetSelection();
      clearCommercePackSelection();
      filterQuickKits();
    });
    element.addEventListener("change", () => {
      clearSetupShortcutSelection();
      clearKitPresetSelection();
      clearCommercePackSelection();
      filterQuickKits();
    });
  });
  $("clearKitFilters")?.addEventListener("click", clearQuickKitFilters);
  $("applyCommercePack")?.addEventListener("click", () => applyCommercePack(activeCommercePackOption()));
  $("copyCommercePack")?.addEventListener("click", () => copyText($("commercePackOutput")?.value || commercePackText(activeCommercePackOption())));
  $("matchFitKits")?.addEventListener("click", matchQuickKitsToMerchantFit);
  $("matchFitKitsTop")?.addEventListener("click", matchQuickKitsToMerchantFit);
  $("applyQuickKit")?.addEventListener("click", applyQuickKit);
  $("applyQuickKitTop")?.addEventListener("click", applyQuickKit);
  $("applyQuickKitSummary")?.addEventListener("click", applyQuickKit);
  $("copyQuickKit")?.addEventListener("click", () => copyText($("quickKitOutput").value));
  $("copyBuyerSign")?.addEventListener("click", () => copyText(buyerSignText(activeQuickKit())));
  $("copyPromoterPitch")?.addEventListener("click", () => copyText(promoterPitchText(activeQuickKit())));
  $("copyAdoptionRelay")?.addEventListener("click", () => copyText(adoptionRelayText(activeQuickKit())));
  $("copyAdoptionRelayBottom")?.addEventListener("click", () => copyText(adoptionRelayText(activeQuickKit())));
  updateCommercePackOutput();
  const requested = applyQuickKitQueryParams();
  if (requested.pack && applyCommercePackByKey(requested.pack, { silent: true })) {
    return;
  }
  filterQuickKits();
  const requestedButton = requested.kit ? findKitButton(requested.kit) : null;
  if (requestedButton && !requestedButton.hidden) {
    selectQuickKit(requested.kit);
  }
}

function saveLeads() {
  localStorage.setItem("doge2moon:merchantLeads", JSON.stringify(state.leads));
}

function renderCheckoutReference(value) {
  const reference = String(value || "").trim();
  if (!reference) return "Not set";
  if (/^https?:\/\//i.test(reference)) {
    return `<a class="text-link" href="${escapeHtml(reference)}" target="_blank" rel="noreferrer">Open link</a>`;
  }
  return escapeHtml(reference);
}

function renderLeads() {
  if (!$("leadRows")) return;
  $("leadRows").innerHTML = state.leads.length
    ? state.leads.map((lead) => `
      <tr>
        <td>${escapeHtml(lead.name)}</td>
        <td>${escapeHtml(lead.city)}</td>
        <td>${escapeHtml(lead.offer)}</td>
        <td>${renderCheckoutReference(lead.checkout)}</td>
        <td>${escapeHtml(lead.stage)}</td>
        <td>${number.format(lead.goal)}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="6">No merchants in this local pipeline yet.</td></tr>`;
  const live = state.leads.filter((lead) => lead.stage === "live").length;
  $("leadTotals").textContent = `${state.leads.length} merchants, ${live} live`;
}

function exportLeads() {
  const header = ["merchant", "city_or_niche", "offer", "checkout_reference", "stage", "week_one_order_goal"];
  const rows = state.leads.map((lead) => [lead.name, lead.city, lead.offer, lead.checkout || "", lead.stage, lead.goal]
    .map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","));
  downloadFile("doge-merchant-pipeline.csv", [header.join(","), ...rows].join("\n"), "text/csv");
}

function initLeads() {
  if (!$("leadForm")) return;
  state.leads = JSON.parse(localStorage.getItem("doge2moon:merchantLeads") || "[]");
  $("leadForm").addEventListener("submit", (event) => {
    event.preventDefault();
    state.leads.push({
      name: $("leadName").value.trim(),
      city: $("leadCity").value.trim(),
      offer: $("leadOffer").value.trim(),
      checkout: $("leadCheckout").value.trim(),
      stage: $("leadStage").value,
      goal: numericValue("leadGoal", 0),
    });
    event.currentTarget.reset();
    $("leadGoal").value = 50;
    saveLeads();
    renderLeads();
  });
  $("exportLeads").addEventListener("click", exportLeads);
  $("clearLeads").addEventListener("click", () => {
    state.leads = [];
    saveLeads();
    renderLeads();
  });
  renderLeads();
}

function updateKitReadiness() {
  if (!$("kitChecklist")) return;
  const checks = Array.from(document.querySelectorAll(".kit-check"));
  const complete = checks.filter((check) => check.checked).length;
  const percent = checks.length ? Math.round((complete / checks.length) * 100) : 0;
  $("kitReadiness").textContent = `${percent}%`;
  const next = $("kitReadinessNext");
  if (next) {
    const missing = checks.find((check) => !check.checked);
    const label = missing?.closest("label")?.querySelector("span")?.textContent || "";
    next.textContent = missing ? `Next: ${label}` : "Ready: run one low-value live test, then save the transaction record.";
  }
  localStorage.setItem("doge2moon:kitChecklist", JSON.stringify(checks.map((check) => check.checked)));
}

function initKitChecklist() {
  if (!$("kitChecklist")) return;
  const checks = Array.from(document.querySelectorAll(".kit-check"));
  const saved = JSON.parse(localStorage.getItem("doge2moon:kitChecklist") || "[]");
  checks.forEach((check, index) => {
    check.checked = Boolean(saved[index]);
    check.addEventListener("change", updateKitReadiness);
  });
  updateKitReadiness();
}

function initCodeCopyButtons() {
  document.querySelectorAll("pre.copy-output").forEach((pre) => {
    if (pre.closest(".file-preview-modal")) return;
    const text = pre.innerText.trim();
    if (!text) return;
    pre.classList.add("has-copy-button");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "code-copy-button";
    button.textContent = "Copy";
    button.setAttribute("aria-label", "Copy this code block");
    button.addEventListener("click", () => copyText(text, "Code copied."));
    pre.appendChild(button);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  window.dogeRateLimit?.bootstrap?.();
  initMobileNav();
  initCodeCopyButtons();
  $("refreshMarket")?.addEventListener("click", refreshMarket);
  hydrateToolWalletFields();
  syncToolSavedWalletLabel();
  if (savedToolWalletAddress()) {
    refreshToolBuilders();
    announce("Using your saved wallet across visible snippet tools.");
  }
  $("applySavedWalletTools")?.addEventListener("click", applySavedWalletToTools);
  initToolFilters();
  initDemandModel();
  initMerchantFit();
  initCheckout();
  initBadge();
  initPriceSnippetBuilder();
  initSparkSnippetBuilder();
  initValidationBuilder();
  initReceiptSnippetBuilder();
  initPaymentPolicy();
  initOutreach();
  initQuickKits();
  initTransactionHandoff();
  initLeads();
  initKitChecklist();
  initFilePreviews();
  refreshMarket();
});
