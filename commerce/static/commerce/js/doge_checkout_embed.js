(function () {
  "use strict";

  const CHANNEL = "doge-checkout";
  const VERSION = 1;
  const POLL_MS = 10_000;
  const MAX_BACKOFF_MS = 60_000;
  const PAYMENT_EXPIRY_GRACE_MS = 2 * 60_000;
  const DEFAULT_PRICE_URL = "/api/doge-price/";
  const DEFAULT_TRANSACTIONS_URL = "/api/wallet/transactions/";
  const DEFAULT_VALIDATION_URL = "/api/transaction/validate/";
  const DEFAULT_QR_URL = "/qr.svg";
  const root = document.getElementById("dogeCheckoutRoot");
  const core = window.DogeCheckoutCore;
  const fragment = new URLSearchParams(location.hash.slice(1));
  const instanceId = fragment.get("instance") || `direct-${Date.now().toString(36)}`;
  const urls = {
    price: document.body.dataset.priceUrl || DEFAULT_PRICE_URL,
    transactions: document.body.dataset.transactionsUrl || DEFAULT_TRANSACTIONS_URL,
    validation: document.body.dataset.validationUrl || DEFAULT_VALIDATION_URL,
    qr: document.body.dataset.qrUrl || DEFAULT_QR_URL,
  };

  let config;
  let pollTimer = null;
  let expiryTimer = null;
  let pollInFlightToken = 0;
  let destroyed = false;
  let retryDelay = POLL_MS;
  let lastPendingConfirmations = null;
  let verifiedEmitted = false;
  let sessionGeneration = 1;
  let quoteOperationToken = 0;
  let lastMonitoringError = "";

  const state = {
    stage: 1,
    status: "loading",
    quote: null,
    orderId: "",
    paymentStartedAt: "",
    quoteExpiresAt: "",
    baselineTxids: [],
    ignoredTxids: [],
    txid: "",
    matchQuality: "",
    matchedDoge: "",
    confirmations: 0,
    provider: "",
    error: "",
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function makeOrderId() {
    if (globalThis.crypto?.randomUUID) return `web-${globalThis.crypto.randomUUID()}`;
    return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function money(value) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(value || 0));
  }

  function compactTxid(txid) {
    const value = String(txid || "");
    return value.length === 64 ? `${value.slice(0, 10)}…${value.slice(-10)}` : value;
  }

  function publicState() {
    return {
      stage: state.stage,
      status: state.status,
      orderId: state.orderId || config?.orderId || "",
      merchant: config?.merchant || "",
      address: config?.address || "",
      usd: config?.usd || "",
      expectedDoge: state.quote?.doge || "",
      feeDoge: state.quote?.feeDoge || "",
      txid: state.txid,
      matchedDoge: state.matchedDoge,
      confirmations: state.confirmations,
      minConfirmations: config?.minConfirmations ?? 0,
      paymentStartedAt: state.paymentStartedAt,
      quoteExpiresAt: state.quoteExpiresAt,
    };
  }

  function configFingerprint() {
    return JSON.stringify([
      config?.address || "",
      config?.usd || "",
      config?.memo || "",
      config?.orderId || "",
      config?.offer || "",
      config?.minConfirmations ?? 0,
    ]);
  }

  function activeSessionStorageKey() {
    return `doge-checkout:v1:${instanceId}`;
  }

  function persistActiveSession() {
    if (!state.quote || state.stage < 2) return;
    try {
      sessionStorage.setItem(activeSessionStorageKey(), JSON.stringify({
        version: 1,
        fingerprint: configFingerprint(),
        savedAt: new Date().toISOString(),
        state: {
          stage: state.stage,
          status: state.status,
          quote: state.quote,
          orderId: state.orderId,
          paymentStartedAt: state.paymentStartedAt,
          quoteExpiresAt: state.quoteExpiresAt,
          baselineTxids: state.baselineTxids.slice(0, 25),
          ignoredTxids: state.ignoredTxids.slice(0, 25),
          txid: state.txid,
          matchQuality: state.matchQuality,
          matchedDoge: state.matchedDoge,
          confirmations: state.confirmations,
          provider: state.provider,
        },
      }));
    } catch {
      // Storage may be partitioned or disabled in third-party frames. The live
      // in-memory checkout remains fully functional without persistence.
    }
  }

  function clearPersistedSession() {
    try {
      sessionStorage.removeItem(activeSessionStorageKey());
    } catch {
      // Ignore unavailable third-party storage.
    }
  }

  function restoreActiveSession() {
    let saved;
    try {
      saved = JSON.parse(sessionStorage.getItem(activeSessionStorageKey()) || "null");
    } catch {
      return false;
    }
    const restored = saved?.state;
    if (saved?.version !== 1 || saved?.fingerprint !== configFingerprint() || !restored?.quote) return false;
    if (!/^\d+\.\d{8}$/.test(String(restored.quote.doge || ""))) return false;
    if (!/^\d+$/.test(String(restored.quote.totalAtoms || ""))) return false;
    if (!restored.paymentStartedAt || !restored.quoteExpiresAt || !restored.orderId) return false;
    Object.assign(state, {
      stage: [2, 3].includes(Number(restored.stage)) ? Number(restored.stage) : 2,
      status: String(restored.status || "waiting"),
      quote: restored.quote,
      orderId: String(restored.orderId),
      paymentStartedAt: String(restored.paymentStartedAt),
      quoteExpiresAt: String(restored.quoteExpiresAt),
      baselineTxids: (Array.isArray(restored.baselineTxids) ? restored.baselineTxids : []).filter((txid) => /^[0-9a-fA-F]{64}$/.test(txid)).slice(0, 25),
      ignoredTxids: (Array.isArray(restored.ignoredTxids) ? restored.ignoredTxids : []).filter((txid) => /^[0-9a-fA-F]{64}$/.test(txid)).slice(0, 25),
      txid: /^[0-9a-fA-F]{64}$/.test(String(restored.txid || "")) ? String(restored.txid) : "",
      matchQuality: ["exact", "near"].includes(restored.matchQuality) ? restored.matchQuality : "",
      matchedDoge: String(restored.matchedDoge || ""),
      confirmations: Math.max(0, Number(restored.confirmations || 0)),
      provider: String(restored.provider || ""),
      error: "",
    });
    if (state.txid) {
      state.stage = 3;
      // Never trust a cached verified flag. Revalidate the public transaction
      // after reload before rendering a paid receipt again.
      if (state.status !== "review") state.status = "pending";
    } else if (Date.now() > expiryCutoff()) {
      state.stage = 2;
      state.status = "closed";
    } else if (isExpired()) {
      state.stage = 2;
      state.status = "expired";
    } else {
      state.stage = 2;
      state.status = "waiting";
    }
    return true;
  }

  function post(type, name, payload = {}) {
    if (window.parent === window) return;
    window.parent.postMessage({
      channel: CHANNEL,
      version: VERSION,
      instanceId,
      type,
      name,
      payload,
    }, "*");
  }

  function emit(name, payload = {}) {
    post("event", name, { orderId: state.orderId || config?.orderId || "", ...payload });
    if (name !== "state") post("event", "state", { state: publicState() });
  }

  function announce(message, alert = false) {
    const output = document.getElementById("checkoutLiveStatus");
    if (!output) return;
    output.textContent = message;
    output.setAttribute("role", alert ? "alert" : "status");
  }

  async function requestJson(url, options = {}, timeoutMs = 10_000) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { cache: "no-store", ...options, signal: controller.signal });
      let payload = {};
      try {
        payload = await response.json();
      } catch {
        payload = {};
      }
      if (!response.ok) {
        const error = new Error(payload.error || "The Dogecoin network check is temporarily unavailable.");
        error.retryAfter = Number(response.headers.get("Retry-After") || 0);
        error.status = response.status;
        throw error;
      }
      return payload;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function fetchQuote() {
    const payload = await requestJson(urls.price);
    const price = String(payload.price_usd || payload.price || "");
    const quote = core.quotePayment({ usd: config.usd, rateUsd: price });
    return { ...quote, provider: payload.provider_name || "live DOGE/USD market", updatedAt: payload.updated_at || new Date().toISOString() };
  }

  function paymentUri() {
    return state.quote ? core.dogeUri(config.address, state.quote.doge, config.memo) : "";
  }

  function qrSource() {
    return `${urls.qr}?data=${encodeURIComponent(paymentUri())}`;
  }

  function explorerUrl(txid) {
    const template = document.body.dataset.explorerTxUrl || "https://blockchair.com/dogecoin/transaction/{txid}";
    try {
      const url = new URL(template.replace("{txid}", encodeURIComponent(txid)));
      return url.protocol === "https:" ? url.href : "";
    } catch {
      return "";
    }
  }

  function progressMarkup() {
    const items = ["Review", "Pay", "Verify"];
    return `<ol class="checkout-progress" aria-label="Checkout progress">
      ${items.map((label, index) => {
        const step = index + 1;
        const current = state.stage === step ? ' aria-current="step"' : "";
        const completed = state.stage > step || state.status === "verified";
        return `<li class="${completed ? "is-complete" : ""}${state.stage === step ? " is-current" : ""}"${current}>
          <span aria-hidden="true">${completed ? "✓" : step}</span><b>${label}</b>
        </li>`;
      }).join("")}
    </ol>`;
  }

  function headerMarkup() {
    return `<header class="checkout-header">
      <span class="doge-mark" aria-hidden="true">&#272;</span>
      <span><small>Dogecoin checkout</small><strong>${escapeHtml(config.merchant)}</strong></span>
    </header>
    ${progressMarkup()}`;
  }

  function brandingMarkup() {
    const siteUrl = document.body.dataset.siteUrl || "https://commerce.dog";
    return `<footer class="checkout-branding">
      <span>Powered by</span> <a href="${escapeHtml(siteUrl)}" target="_blank" rel="noopener noreferrer">DOGE Commerce Kit</a>
    </footer>`;
  }

  function loadingStageMarkup() {
    return `<section class="checkout-stage stage-review" aria-labelledby="checkoutStageTitle">
      <p class="stage-kicker">Your order</p>
      <h1 id="checkoutStageTitle" tabindex="-1">${escapeHtml(config.offer)}</h1>
      <div class="order-total"><span>Total</span><strong>${escapeHtml(money(config.usd))}</strong></div>
      <div class="quote-loading"><i aria-hidden="true"></i><span>Getting a fresh DOGE quote&hellip;</span></div>
      <button class="checkout-button primary" type="button" disabled>${escapeHtml(config.buttonText)}</button>
    </section>`;
  }

  function reviewStageMarkup() {
    const unavailable = state.status === "quote-error";
    const hasError = Boolean(state.error);
    return `<section class="checkout-stage stage-review" aria-labelledby="checkoutStageTitle">
      <p class="stage-kicker">Your order</p>
      <h1 id="checkoutStageTitle" tabindex="-1">${escapeHtml(config.offer)}</h1>
      <div class="order-total"><span>Total</span><strong>${escapeHtml(money(config.usd))}</strong></div>
      ${state.quote ? `<div class="doge-estimate">
        <span>Live estimate</span>
        <strong>${escapeHtml(state.quote.doge)} DOGE</strong>
        <small>Includes a small fee buffer and is rounded up so the payment is not a fraction short.</small>
      </div>` : ""}
      ${hasError ? `<div class="checkout-message error"><strong>${escapeHtml(unavailable ? "Live quote unavailable" : "Checkout could not start")}</strong><span>${escapeHtml(state.error || "Try again shortly.")}</span></div>` : ""}
      <button class="checkout-button primary" id="startDogeCheckout" type="button" ${state.quote || unavailable ? "" : "disabled"}>${escapeHtml(hasError ? "Try again" : config.buttonText)}</button>
      <p class="fine-print">The exact amount freezes when you continue. Payment is verified on the Dogecoin network.</p>
    </section>`;
  }

  function waitingStatusMarkup() {
    const expired = state.status === "expired";
    const closed = state.status === "closed";
    if (closed) {
      return `<div class="checkout-message warning"><strong>Payment request closed</strong><span>No matching payment was detected. Restart for a fresh DOGE amount.</span></div>
        <button class="checkout-button primary" id="restartDogeCheckout" type="button">Refresh checkout</button>`;
    }
    if (expired) {
      return `<div class="checkout-message warning"><strong>Quote window passed</strong><span>The QR is closed. Monitoring continues briefly for a payment already sent.</span></div>
        <div class="waiting-status"><span class="waiting-pulse" aria-hidden="true"><i></i><i></i><i></i></span><span><strong>Final network check</strong><small>Do not send a new payment from this screen.</small></span></div>
        <button class="checkout-button primary" id="restartDogeCheckout" type="button">Refresh checkout</button>`;
    }
    return `<div class="waiting-status" id="checkoutWaitingStatus">
      <span class="waiting-pulse" aria-hidden="true"><i></i><i></i><i></i></span>
      <span><strong>Waiting for payment</strong><small id="checkoutWaitingCopy">Watching the Dogecoin network automatically.</small></span>
    </div>`;
  }

  function monitoringErrorMarkup() {
    if (!state.error || state.stage < 2) return "";
    return `<div class="checkout-message warning" id="monitorRetryMessage"><strong>Network check paused</strong><span>${escapeHtml(state.error)} Retrying automatically.</span></div>`;
  }

  function payStageMarkup() {
    const uri = paymentUri();
    if (["expired", "closed"].includes(state.status)) {
      return `<section class="checkout-stage stage-pay" aria-labelledby="checkoutStageTitle">
        <p class="stage-kicker">Payment window</p>
        <h1 id="checkoutStageTitle" tabindex="-1">${escapeHtml(state.status === "closed" ? "Refresh to continue" : "Payment request paused")}</h1>
        <div class="payment-amount"><span>Previous frozen amount</span><strong>${escapeHtml(state.quote.doge)} DOGE</strong></div>
        ${monitoringErrorMarkup()}
        ${waitingStatusMarkup()}
      </section>`;
    }
    return `<section class="checkout-stage stage-pay" aria-labelledby="checkoutStageTitle">
      <p class="stage-kicker">Scan with a Dogecoin wallet</p>
      <h1 id="checkoutStageTitle" tabindex="-1">Pay ${escapeHtml(state.quote.doge)} DOGE</h1>
      <a class="qr-link" href="${escapeHtml(uri)}" aria-label="Open wallet to pay ${escapeHtml(state.quote.doge)} DOGE to ${escapeHtml(config.merchant)}">
        <img src="${escapeHtml(qrSource())}" alt="Payment QR for ${escapeHtml(state.quote.doge)} DOGE to ${escapeHtml(config.merchant)}">
      </a>
      <div class="payment-amount"><span>Exact amount</span><strong>${escapeHtml(state.quote.doge)} DOGE</strong></div>
      <code class="payment-address">${escapeHtml(config.address)}</code>
      <div class="pay-actions">
        <a class="checkout-button primary" href="${escapeHtml(uri)}">Open wallet</a>
        <button class="checkout-button secondary" id="copyDogePayment" type="button">Copy details</button>
      </div>
      ${monitoringErrorMarkup()}
      ${waitingStatusMarkup()}
      <details class="checkout-help"><summary>Payment not appearing?</summary><p>Keep this page open. Detection and verification retry automatically. If you have not paid, you can restart for a fresh quote.</p><button class="text-button" id="restartDogeCheckout" type="button">Restart checkout</button></details>
    </section>`;
  }

  function pendingStageMarkup() {
    const link = explorerUrl(state.txid);
    const pending = state.status !== "review";
    const required = config.minConfirmations;
    return `<section class="checkout-stage stage-verify" aria-labelledby="checkoutStageTitle">
      <div class="verify-icon ${pending ? "is-checking" : "is-review"}" aria-hidden="true">${pending ? "&#272;" : "!"}</div>
      <p class="stage-kicker">${pending ? "Payment detected" : "Merchant review needed"}</p>
      <h1 id="checkoutStageTitle" tabindex="-1">${pending ? "Verifying payment" : "This payment needs a closer look"}</h1>
      <p class="verify-copy">${pending
        ? (required > 0
          ? `The payment is on the network. Waiting for ${required} confirmation${required === 1 ? "" : "s"}.`
          : "Checking the receiving address and exact amount.")
        : "The detected amount is close, but not an exact match. The merchant must review it; this checkout cannot approve itself."}</p>
      <div class="transaction-summary">
        <span><small>Transaction</small><code title="${escapeHtml(state.txid)}">${escapeHtml(compactTxid(state.txid))}</code></span>
        <span><small>Confirmations</small><strong>${escapeHtml(String(state.confirmations))} / ${escapeHtml(String(required))}</strong></span>
        ${state.matchedDoge ? `<span><small>Detected</small><strong>${escapeHtml(state.matchedDoge)} DOGE</strong></span>` : ""}
      </div>
      ${link ? `<a class="text-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">View transaction</a>` : ""}
      ${monitoringErrorMarkup()}
      <div class="waiting-status compact"><span class="waiting-pulse" aria-hidden="true"><i></i><i></i><i></i></span><span><strong>${pending ? "Still checking" : "Still watching"}</strong><small>${pending ? "This updates automatically." : "An exact payment can still be detected."}</small></span></div>
    </section>`;
  }

  function receiptRow(label, value, code = false) {
    return `<div><span>${escapeHtml(label)}</span><${code ? "code" : "strong"}>${escapeHtml(value)}</${code ? "code" : "strong"}></div>`;
  }

  function verifiedStageMarkup() {
    const link = explorerUrl(state.txid);
    const paidAt = new Date().toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
    return `<section class="checkout-stage stage-verified" aria-labelledby="checkoutStageTitle">
      <div class="verified-mark" aria-hidden="true">✓</div>
      <p class="stage-kicker">Payment verified</p>
      <h1 id="checkoutStageTitle" tabindex="-1">You paid with DOGE</h1>
      <p class="verify-copy">The receiving address, amount, and confirmation requirement passed.</p>
      <article class="checkout-receipt" aria-label="Dogecoin payment receipt">
        <header><span class="receipt-doge" aria-hidden="true">&#272;</span><span><small>Dogecoin receipt</small><strong>${escapeHtml(config.merchant)}</strong></span><b>Paid</b></header>
        <div class="receipt-total"><span>${escapeHtml(config.offer)}</span><strong>${escapeHtml(money(config.usd))}</strong><b>${escapeHtml(state.quote.doge)} DOGE</b></div>
        <div class="receipt-rows">
          ${receiptRow("Date", paidAt)}
          ${receiptRow("Order", state.orderId, true)}
          ${receiptRow("Confirmations", String(state.confirmations))}
          ${receiptRow("Transaction", compactTxid(state.txid), true)}
        </div>
        ${link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">View on the Dogecoin blockchain</a>` : ""}
      </article>
      <div class="verified-actions">
        ${config.returnUrl ? `<a class="checkout-button primary" href="${escapeHtml(config.returnUrl)}" target="_top">Return to store</a>` : ""}
        <button class="checkout-button ${config.returnUrl ? "secondary" : "primary"}" id="restartDogeCheckout" type="button">New payment</button>
      </div>
    </section>`;
  }

  function render({ focus = false } = {}) {
    if (!root || !config) return;
    let body = loadingStageMarkup();
    if (state.stage === 1 && state.status !== "loading") body = reviewStageMarkup();
    if (state.stage === 2) body = payStageMarkup();
    if (state.stage === 3 && state.status === "verified") body = verifiedStageMarkup();
    if (state.stage === 3 && state.status !== "verified") body = pendingStageMarkup();
    root.innerHTML = `<section class="checkout-card" aria-label="Dogecoin checkout">
      ${headerMarkup()}
      <div id="checkoutLiveStatus" class="sr-status" role="status" aria-live="polite" aria-atomic="true"></div>
      ${body}
      ${brandingMarkup()}
    </section>`;
    root.setAttribute("aria-busy", state.status === "loading" || state.status === "starting" ? "true" : "false");
    bindActions();
    postResize();
    if (focus) document.getElementById("checkoutStageTitle")?.focus({ preventScroll: true });
  }

  function bindActions() {
    document.getElementById("startDogeCheckout")?.addEventListener("click", startPayment);
    document.getElementById("copyDogePayment")?.addEventListener("click", copyPayment);
    document.querySelectorAll("#restartDogeCheckout").forEach((button) => button.addEventListener("click", restart));
  }

  function postResize() {
    window.requestAnimationFrame(() => {
      const height = Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
      post("resize", "resize", { height });
    });
  }

  function currentSession(token) {
    return !destroyed && token === sessionGeneration;
  }

  async function loadInitialQuote(token = sessionGeneration) {
    const operationToken = ++quoteOperationToken;
    state.stage = 1;
    state.status = "loading";
    state.error = "";
    render();
    try {
      const quote = await fetchQuote();
      if (!currentSession(token) || operationToken !== quoteOperationToken) return;
      state.quote = quote;
      state.status = "quoted";
      render();
      emit("quote", { frozen: false, usd: config.usd, doge: state.quote.doge, rateUsd: state.quote.rateUsd });
    } catch (error) {
      if (!currentSession(token) || operationToken !== quoteOperationToken) return;
      state.quote = null;
      state.status = "quote-error";
      state.error = error.message || "A fresh quote is temporarily unavailable.";
      render();
      announce(state.error, true);
      emit("error", { code: "quote_unavailable", message: state.error });
    }
  }

  async function baselineTransactions() {
    const url = `${urls.transactions}?address=${encodeURIComponent(config.address)}&limit=25&fresh=1`;
    const payload = await requestJson(url, {}, 12_000);
    return (Array.isArray(payload.transactions) ? payload.transactions : [])
      .map((transaction) => String(transaction?.txid || ""))
      .filter((txid) => /^[0-9a-fA-F]{64}$/.test(txid))
      .slice(0, 25);
  }

  async function startPayment() {
    if (state.status === "starting") return;
    const token = sessionGeneration;
    const operationToken = ++quoteOperationToken;
    state.status = "starting";
    state.error = "";
    render();
    announce("Preparing a fresh quote and secure payment monitor.");
    try {
      const [quote, baselineTxids] = await Promise.all([fetchQuote(), baselineTransactions()]);
      if (!currentSession(token) || operationToken !== quoteOperationToken) return;
      const started = new Date();
      state.quote = quote;
      state.orderId = config.orderId || makeOrderId();
      state.paymentStartedAt = started.toISOString();
      state.quoteExpiresAt = new Date(started.getTime() + (config.quoteMinutes * 60_000)).toISOString();
      state.baselineTxids = baselineTxids;
      state.ignoredTxids = [];
      state.txid = "";
      state.matchQuality = "";
      state.matchedDoge = "";
      state.confirmations = 0;
      state.stage = 2;
      state.status = "waiting";
      retryDelay = POLL_MS;
      verifiedEmitted = false;
      render({ focus: true });
      announce("Customer payment QR is ready. Watching the Dogecoin network automatically.");
      emit("quote", {
        frozen: true,
        usd: config.usd,
        doge: quote.doge,
        baseDoge: quote.baseDoge,
        feeDoge: quote.feeDoge,
        rateUsd: quote.rateUsd,
        issuedAt: state.paymentStartedAt,
        expiresAt: state.quoteExpiresAt,
      });
      emit("stagechange", { stage: 2, status: state.status });
      persistActiveSession();
      scheduleExpiry(token);
      schedulePoll(1200, token);
    } catch (error) {
      if (!currentSession(token) || operationToken !== quoteOperationToken) return;
      state.stage = 1;
      state.status = state.quote ? "quoted" : "quote-error";
      state.error = error.message || "Could not start payment monitoring.";
      render();
      announce(`${state.error} Try again.`, true);
      emit("error", { code: "start_failed", message: state.error });
    }
  }

  function isExpired() {
    const expires = Date.parse(state.quoteExpiresAt || "");
    return Number.isFinite(expires) && Date.now() >= expires;
  }

  function expiryCutoff() {
    const expires = Date.parse(state.quoteExpiresAt || "");
    return Number.isFinite(expires) ? expires + PAYMENT_EXPIRY_GRACE_MS : 0;
  }

  function scheduleExpiry(token = sessionGeneration) {
    if (expiryTimer) window.clearTimeout(expiryTimer);
    const delay = Math.max(0, Date.parse(state.quoteExpiresAt) - Date.now());
    expiryTimer = window.setTimeout(() => expireCheckout(token), Math.min(delay + 50, 2_147_000_000));
  }

  function expireCheckout(token = sessionGeneration) {
    if (!currentSession(token)) return;
    if (!["waiting", "checking"].includes(state.status) || state.txid) return;
    state.stage = 2;
    state.status = "expired";
    persistActiveSession();
    render();
    announce("The quote window passed. The payment controls are closed while monitoring briefly continues for a payment already sent.");
    emit("expired", { expiresAt: state.quoteExpiresAt });
    const graceRemaining = Math.max(0, expiryCutoff() - Date.now());
    if (expiryTimer) window.clearTimeout(expiryTimer);
    expiryTimer = window.setTimeout(() => closeExpiredCheckout(token), Math.min(graceRemaining + 50, 2_147_000_000));
    schedulePoll(100, token);
  }

  async function closeExpiredCheckout(token = sessionGeneration) {
    if (!currentSession(token) || state.txid || state.stage !== 2) return;
    if (pollInFlightToken === token) {
      expiryTimer = window.setTimeout(() => closeExpiredCheckout(token), 750);
      return;
    }
    pollInFlightToken = token;
    try {
      await discoverPayment(token);
    } catch (error) {
      if (currentSession(token)) {
        retryDelay = Math.min(MAX_BACKOFF_MS, Math.max(POLL_MS, retryDelay * 1.7));
        const message = error?.message || "The final network check was unavailable.";
        state.error = message;
        lastMonitoringError = message;
        if (!state.txid) {
          state.stage = 2;
          state.status = "expired";
        } else if (state.status === "checking") {
          state.stage = 3;
          state.status = "pending";
        }
        persistActiveSession();
        render();
        announce(`${message} Verification is still unresolved; retrying automatically.`, true);
        emit("error", {
          code: "final_check_failed",
          message,
          retrying: true,
          retryInMs: retryDelay,
        });
        schedulePoll(retryDelay, token);
      }
      return;
    } finally {
      if (pollInFlightToken === token) pollInFlightToken = 0;
    }
    if (!currentSession(token) || state.txid || state.stage !== 2) return;
    stopPolling();
    state.status = "closed";
    state.error = "";
    lastMonitoringError = "";
    persistActiveSession();
    render();
    announce("No payment was detected in the quote window. Restart for a fresh amount.");
  }

  function schedulePoll(delay = retryDelay, token = sessionGeneration) {
    if (pollTimer) window.clearTimeout(pollTimer);
    if (!currentSession(token) || ["verified", "closed"].includes(state.status)) return;
    pollTimer = window.setTimeout(() => poll(token), delay);
  }

  function stopPolling() {
    if (pollTimer) window.clearTimeout(pollTimer);
    if (expiryTimer) window.clearTimeout(expiryTimer);
    pollTimer = null;
    expiryTimer = null;
  }

  function retryFrom(error) {
    if (error?.retryAfter > 0) retryDelay = Math.min(MAX_BACKOFF_MS, error.retryAfter * 1000);
    else retryDelay = Math.min(MAX_BACKOFF_MS, Math.max(POLL_MS, retryDelay * 1.7));
    const message = error?.message || "Network check paused briefly.";
    state.error = message;
    persistActiveSession();
    if (lastMonitoringError !== message) {
      lastMonitoringError = message;
      render();
      emit("error", { code: "monitor_retry", message, retrying: true, retryInMs: retryDelay });
    }
    announce(`${message} Retrying automatically.`);
    const waitingCopy = document.getElementById("checkoutWaitingCopy");
    if (waitingCopy) waitingCopy.textContent = "Network check paused briefly. Retrying automatically.";
  }

  function clearMonitoringError() {
    if (!lastMonitoringError && !state.error) return;
    lastMonitoringError = "";
    state.error = "";
    persistActiveSession();
    document.getElementById("monitorRetryMessage")?.remove();
    postResize();
  }

  async function poll(token = sessionGeneration) {
    if (!currentSession(token)) return;
    if (pollInFlightToken === token || document.hidden) {
      schedulePoll(POLL_MS, token);
      return;
    }
    if (isExpired() && !state.txid && state.status !== "expired") {
      expireCheckout(token);
      return;
    }
    if (state.status === "expired" && Date.now() > expiryCutoff()) {
      await closeExpiredCheckout(token);
      return;
    }
    pollInFlightToken = token;
    try {
      if (state.txid && ["detected", "pending", "checking"].includes(state.status)) {
        await validateDetected(state.matchQuality, token);
      } else {
        await discoverPayment(token);
      }
      if (!currentSession(token)) return;
      retryDelay = POLL_MS;
      clearMonitoringError();
    } catch (error) {
      if (currentSession(token)) retryFrom(error);
    } finally {
      if (pollInFlightToken === token) pollInFlightToken = 0;
      if (currentSession(token)) schedulePoll(retryDelay, token);
    }
  }

  async function discoverPayment(token = sessionGeneration) {
    const url = `${urls.transactions}?address=${encodeURIComponent(config.address)}&limit=25&fresh=1`;
    const payload = await requestJson(url, {}, 12_000);
    if (!currentSession(token)) return;
    state.provider = payload.provider_name || state.provider;
    const order = {
      doge: state.quote.doge,
      expectedAtoms: state.quote.totalAtoms,
      payment_started_at: state.paymentStartedAt,
      baseline_txids: state.baselineTxids,
      ignored_txids: state.ignoredTxids,
      baseline_ready: true,
      quote_expires_at: state.quoteExpiresAt,
      expiry_grace_ms: PAYMENT_EXPIRY_GRACE_MS,
    };
    const candidates = (Array.isArray(payload.transactions) ? payload.transactions : [])
      .map((transaction) => ({ transaction, quality: core.matchTransaction(transaction, order) }))
      .filter((candidate) => candidate.quality)
      .sort((left, right) => (left.quality === "exact" ? -1 : 1) - (right.quality === "exact" ? -1 : 1));
    if (!candidates.length) {
      const checked = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
      const copy = document.getElementById("checkoutWaitingCopy");
      if (copy) copy.textContent = `Last checked ${checked}. Checking again automatically.`;
      return;
    }
    const candidate = candidates[0];
    state.txid = String(candidate.transaction.txid);
    state.matchQuality = candidate.quality;
    state.matchedDoge = Number(candidate.transaction.doge || 0).toFixed(8);
    state.confirmations = Number(candidate.transaction.confirmations || 0);
    state.stage = 3;
    state.status = "detected";
    persistActiveSession();
    render();
    announce("Blockchain payment detected. Verification is now in progress.");
    emit("paymentdetected", {
      txid: state.txid,
      matchedDoge: state.matchedDoge,
      matchQuality: candidate.quality,
      confirmations: state.confirmations,
    });
    emit("stagechange", { stage: 3, status: state.status });
    await validateDetected(candidate.quality, token);
  }

  async function validateDetected(quality, token = sessionGeneration) {
    if (!currentSession(token)) return;
    state.status = "checking";
    const payload = await requestJson(urls.validation, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        txid: state.txid,
        address: config.address,
        doge: state.quote.doge,
        min_confirmations: config.minConfirmations,
        fresh: true,
      }),
    }, 12_000);
    if (!currentSession(token)) return;
    state.confirmations = Number(payload.confirmations || 0);
    state.matchedDoge = String(payload.matched_doge || state.matchedDoge || "");
    state.provider = payload.provider_name || state.provider;
    if (quality === "near") {
      state.status = "review";
      if (!state.ignoredTxids.includes(state.txid)) state.ignoredTxids.push(state.txid);
      persistActiveSession();
      render();
      announce("A near amount was detected. The merchant must review this payment.", true);
      emit("reviewrequired", {
        txid: state.txid,
        expectedDoge: state.quote.doge,
        matchedDoge: state.matchedDoge,
        confirmations: state.confirmations,
        errors: Array.isArray(payload.errors) ? payload.errors : [],
      });
      return;
    }
    if (payload.passed === true) {
      stopPolling();
      state.status = "verified";
      state.stage = 3;
      persistActiveSession();
      render();
      announce("Payment verified. Receipt ready.");
      if (!verifiedEmitted) {
        verifiedEmitted = true;
        emit("verified", {
          txid: state.txid,
          expectedDoge: state.quote.doge,
          matchedDoge: state.matchedDoge,
          confirmations: state.confirmations,
          verifiedAt: new Date().toISOString(),
        });
      }
      return;
    }
    if (payload.status === "pending") {
      state.status = "pending";
      persistActiveSession();
      if (lastPendingConfirmations !== state.confirmations) {
        lastPendingConfirmations = state.confirmations;
        render();
        announce(`Payment detected with ${state.confirmations} confirmation${state.confirmations === 1 ? "" : "s"}. Verification continues automatically.`);
        emit("verificationpending", {
          txid: state.txid,
          confirmations: state.confirmations,
          minConfirmations: config.minConfirmations,
        });
      }
      return;
    }
    state.status = "review";
    if (!state.ignoredTxids.includes(state.txid)) state.ignoredTxids.push(state.txid);
    persistActiveSession();
    render();
    announce("This transaction could not be verified automatically. The merchant must review it.", true);
    emit("reviewrequired", {
      txid: state.txid,
      expectedDoge: state.quote.doge,
      matchedDoge: state.matchedDoge,
      confirmations: state.confirmations,
      errors: Array.isArray(payload.errors) ? payload.errors : [],
    });
  }

  async function copyPayment() {
    const text = `${state.quote.doge} DOGE\n${config.address}\n${paymentUri()}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const helper = document.createElement("textarea");
      helper.value = text;
      helper.className = "clipboard-helper";
      document.body.appendChild(helper);
      helper.select();
      document.execCommand("copy");
      helper.remove();
    }
    announce("Payment amount and address copied.");
    const button = document.getElementById("copyDogePayment");
    if (button) {
      button.textContent = "Copied";
      window.setTimeout(() => { if (button.isConnected) button.textContent = "Copy details"; }, 1600);
    }
  }

  function restart() {
    sessionGeneration += 1;
    const token = sessionGeneration;
    stopPolling();
    clearPersistedSession();
    state.stage = 1;
    state.status = "loading";
    state.quote = null;
    state.orderId = "";
    state.paymentStartedAt = "";
    state.quoteExpiresAt = "";
    state.baselineTxids = [];
    state.ignoredTxids = [];
    state.txid = "";
    state.matchQuality = "";
    state.matchedDoge = "";
    state.confirmations = 0;
    state.error = "";
    lastPendingConfirmations = null;
    lastMonitoringError = "";
    verifiedEmitted = false;
    emit("stagechange", { stage: 1, status: "loading" });
    loadInitialQuote(token);
  }

  function handleCommand(event) {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (!message || message.channel !== CHANNEL || message.version !== VERSION || message.instanceId !== instanceId || message.type !== "command") return;
    if (message.name === "restart") restart();
    if (message.name === "refresh") {
      if (state.status === "starting") return;
      if (state.stage === 1) loadInitialQuote();
      else poll(sessionGeneration);
    }
    if (message.name === "state") emit("state", { state: publicState() });
  }

  function fatal(message) {
    if (!root) return;
    root.setAttribute("aria-busy", "false");
    root.innerHTML = `<section class="checkout-card checkout-fatal" role="alert" aria-label="Dogecoin checkout unavailable">
      <div class="fatal-mark" aria-hidden="true">!</div>
      <h1>Checkout needs attention</h1>
      <p>${escapeHtml(message)}</p>
      <p class="fine-print">No payment request was created.</p>
      ${brandingMarkup()}
    </section>`;
    postResize();
    emit("error", { code: "invalid_config", message });
  }

  function initResizeObserver() {
    if ("ResizeObserver" in window) {
      const observer = new ResizeObserver(postResize);
      observer.observe(document.body);
    } else {
      window.addEventListener("resize", postResize);
    }
  }

  function init() {
    if (!root || !core) {
      if (root) root.textContent = "Dogecoin checkout could not load.";
      return;
    }
    try {
      const raw = JSON.parse(fragment.get("config") || "{}");
      config = core.normalizeConfig(raw);
    } catch (error) {
      config = {
        merchant: "DOGE Merchant",
        orderId: "",
      };
      fatal(error.message || "The merchant checkout configuration is invalid.");
      return;
    }
    initResizeObserver();
    window.addEventListener("message", handleCommand);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && state.stage > 1 && !["verified", "closed"].includes(state.status)) schedulePoll(100, sessionGeneration);
    });
    window.addEventListener("pagehide", () => {
      destroyed = true;
      stopPolling();
    }, { once: true });
    emit("ready", { config: { merchant: config.merchant, offer: config.offer, usd: config.usd, minConfirmations: config.minConfirmations } });
    if (restoreActiveSession()) {
      render();
      announce("Resuming the active Dogecoin payment check.");
      emit("stagechange", { stage: state.stage, status: state.status, resumed: true });
      if (state.status === "closed") return;
      if (state.status === "expired") {
        const graceRemaining = Math.max(0, expiryCutoff() - Date.now());
        expiryTimer = window.setTimeout(() => closeExpiredCheckout(sessionGeneration), Math.min(graceRemaining + 50, 2_147_000_000));
      } else if (!state.txid) {
        scheduleExpiry(sessionGeneration);
      }
      schedulePoll(100, sessionGeneration);
      return;
    }
    loadInitialQuote(sessionGeneration);
  }

  init();
})();
