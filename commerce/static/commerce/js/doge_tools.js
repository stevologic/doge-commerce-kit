(function () {
  const DOGE_FALLBACK = 0.1063;
  const SUPPLY = 169.74e9;
  const PRODUCT = "DOGE-USD";
  const QUOTE_WINDOW_MINUTES = 10;
  const POS_PAGE_SIZES = [10, 25, 50];
  const CONVERSION_USD_AMOUNTS = [1, 5, 10, 25, 50, 100];
  const CONVERSION_DOGE_AMOUNTS = [1, 10, 25, 100, 500, 1000];
  const CANDLE_PRESETS = {
    "1D": { label: "24 hours", days: 1 },
    "7D": { label: "7 days", days: 7 },
    "30D": { label: "30 days", days: 30 },
    "90D": { label: "90 days", days: 90 },
    "1Y": { label: "1 year", days: 365 },
  };
  const COINBASE_CANDLE_LIMIT = 300;
  const MAX_CUSTOM_CANDLE_DAYS = 365;
  const $id = (id) => document.getElementById(id);
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 });
  const moneyCents = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const moneyWhole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });
  const conversionDoge = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });
  let dogeUsd = DOGE_FALLBACK;
  let statsSocket;
  let candles = [];
  let trades = [];
  let tradeWindow = [];
  let cumulativeTradeStats = {
    buyVolume: 0,
    sellVolume: 0,
    count: 0,
    largestTrade: 0,
    firstTimestampMs: 0,
    lastTimestampMs: 0,
  };
  let worldCountries = null;
  let worldAtlasPromise = null;
  let donateModalRenderId = 0;
  let donateBuilderRenderId = 0;
  let walletShareRenderId = 0;
  let walletCardFileCache = null;
  let walletCardRefreshTimer = null;
  let integrationRenderId = 0;
  let integrationSnippetType = "checkout";
  let posOrderPage = 1;
  let pendingPosExportFormat = "";

  let posTransactionsLoaded = false;
  let marketChartPreset = "7D";
  let sentTxWatchTimer = null;
  let posWalletPanelOpen = true;
  const posDeleteArmed = new Set();
  const POS_PAYMENT_POLL_INTERVAL_MS = 10000;
  const POS_AUTO_VERIFY_TOLERANCE_DOGE = 0.00000001;
  const POS_NEAR_MATCH_MARGIN_DOGE = 1;
  const POS_WALLET_BACKUP_MAX_BYTES = 64 * 1024;
  const POS_WALLET_IMPORT_IDLE = "Import a backup created by this POS. Its private key is verified locally and never uploaded or stored.";
  let posPaymentPollTimer = null;
  let posPaymentPollToken = 0;
  const posPaymentPollOrderIds = new Set();
  const posPaymentPollInFlight = new Set();
  let posCustomerDisplayOpener = null;
  let posPaymentStarting = false;
  let posStartingPaymentState = null;
  let posInitialized = false;
  let posClearOrdersArmed = false;
  let posClearOrdersTimer = null;
  let posRestartArmed = false;
  let posRestartTimer = null;
  let posWorkflowScrollTimer = null;
  let posManualReviewVisible = false;
  let posReceiptModalReceipt = null;
  let posReceiptModalReturnFocus = null;
  let posReceiptModalReturnOrderId = "";
  let posReceiptModalReturnControlId = "";
  let posEmailOrdersSnapshot = null;
  let posEmailOrdersReturnFocus = null;
  let posGeneratedWallet = null;
  let pendingPosWalletImport = null;
  let posWalletOperationBusy = false;
  let posWalletOperationToken = 0;

  function logo() {
    return document.body.dataset.dogeLogo || "";
  }

  function donationAddress() {
    return document.body.dataset.donationAddress || "";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function copy(value, message = "Copied.") {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const helper = document.createElement("textarea");
      helper.value = value;
      helper.style.position = "fixed";
      helper.style.left = "-9999px";
      document.body.appendChild(helper);
      helper.select();
      document.execCommand("copy");
      helper.remove();
    }
    if (window.dogeAnnounce) window.dogeAnnounce(message);
  }

  function dogeUri(address, amount, memo) {
    const params = new URLSearchParams();
    if (Number(amount) > 0) params.set("amount", Number(amount).toFixed(8));
    if (memo) params.set("message", memo);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return `dogecoin:${address}${suffix}`;
  }

  function checkoutQuote(minutes = QUOTE_WINDOW_MINUTES) {
    const issued = new Date();
    const expires = new Date(issued.getTime() + minutes * 60 * 1000);
    return {
      issued_at: issued.toISOString(),
      expires_at: expires.toISOString(),
    };
  }

  function quoteLabel(timestamp) {
    return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function quoteMetaText(quote, price = dogeUsd, minutes = QUOTE_WINDOW_MINUTES) {
    if (!quote?.issued_at || !quote?.expires_at) return "Quote timestamp unavailable. Recheck DOGE/USD before fulfillment.";
    return `Quote refreshed ${quoteLabel(quote.issued_at)} at ${money.format(price)} DOGE/USD. Recheck after ${quoteLabel(quote.expires_at)} (${minutes} min window).`;
  }

  function positiveNumber(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function limitDecimalInput(input, places = 2, fixed = false) {
    if (!input) return;
    const raw = String(input.value || "");
    if (!raw) return;
    const cleaned = raw.replace(/[^\d.]/g, "");
    const parts = cleaned.split(".");
    const whole = parts.shift() || "";
    const decimals = parts.join("").slice(0, places);
    const hasDecimal = cleaned.includes(".");
    let next = whole;
    if (hasDecimal) next += `.${decimals}`;
    if (next.startsWith(".")) next = `0${next}`;
    if (fixed && next && next !== "0." && Number.isFinite(Number(next))) {
      next = Number(next).toFixed(places);
    }
    if (next !== raw) input.value = next;
  }

  function formatConversionDoge(value) {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount) || amount <= 0) return "0 DOGE";
    const formatter = amount >= 100 ? compact : conversionDoge;
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

  function renderDogeConversionChart(prefix, currentUsd = 0) {
    const rateOut = $id(`${prefix}ConversionRate`);
    const usdRows = $id(`${prefix}UsdToDogeRows`);
    const dogeRows = $id(`${prefix}DogeToUsdRows`);
    if (!rateOut || !usdRows || !dogeRows) return;
    const rate = Number(dogeUsd);
    if (!Number.isFinite(rate) || rate <= 0) {
      rateOut.textContent = "DOGE/USD unavailable";
      usdRows.innerHTML = `<span class="note">Price unavailable.</span>`;
      dogeRows.innerHTML = `<span class="note">Price unavailable.</span>`;
      return;
    }

    rateOut.textContent = `${money.format(rate)} DOGE/USD`;
    const safeCurrentUsd = positiveNumber(currentUsd);
    const usdInputs = CONVERSION_USD_AMOUNTS.map((usd) => ({ label: money.format(usd), usd, current: false }));
    if (safeCurrentUsd > 0 && !usdInputs.some((row) => Math.abs(row.usd - safeCurrentUsd) < 0.01)) {
      usdInputs.unshift({ label: "Current", usd: safeCurrentUsd, current: true });
    }
    const maxDoge = Math.max(...usdInputs.map((row) => row.usd / rate), 1);
    usdRows.innerHTML = usdInputs.map((row) => {
      const doge = row.usd / rate;
      return conversionRowHtml(row.label, formatConversionDoge(doge), (doge / maxDoge) * 100, row.current);
    }).join("");

    const dogeInputs = CONVERSION_DOGE_AMOUNTS.map((doge) => ({ label: `${formatConversionDoge(doge)}`, doge }));
    const maxUsd = Math.max(...dogeInputs.map((row) => row.doge * rate), 1);
    dogeRows.innerHTML = dogeInputs.map((row) => {
      const usd = row.doge * rate;
      return conversionRowHtml(row.label, money.format(usd), (usd / maxUsd) * 100);
    }).join("");
  }

  function qrUrl(data) {
    return `/qr.svg?data=${encodeURIComponent(data)}`;
  }

  const qrDataCache = new Map();

  async function qrDataUri(data) {
    if (qrDataCache.has(data)) return qrDataCache.get(data);
    try {
      const response = await fetch(qrUrl(data), { cache: "no-store" });
      if (!response.ok) throw new Error("QR unavailable");
      const svg = await response.text();
      const encoded = btoa(unescape(encodeURIComponent(svg)));
      const uri = `data:image/svg+xml;base64,${encoded}`;
      qrDataCache.set(data, uri);
      return uri;
    } catch {
      return qrUrl(data);
    }
  }

  const limitedFetch = (...args) => (window.dogeLimitedFetch || fetch)(...args);

  async function walletChainFetch(input, init = {}) {
    const response = await limitedFetch(input, init);
    const url = typeof input === "string" ? input : input.url;
    if (String(url || "").includes("/api/wallet/") || String(url || "").includes("/api/rate-status/")) {
      await window.dogeRateLimit?.syncServerRates?.().catch(() => {});
    }
    return response;
  }

  async function fetchDogePrice() {
    try {
      const response = await limitedFetch(`https://api.exchange.coinbase.com/products/${PRODUCT}/ticker`, { cache: "no-store" });
      if (!response.ok) throw new Error("price unavailable");
      const payload = await response.json();
      const price = Number(payload.price);
      if (Number.isFinite(price) && price > 0) dogeUsd = price;
    } catch {
      dogeUsd = DOGE_FALLBACK;
    }
    return dogeUsd;
  }

  const WALLET_TX_PAGE_SIZE = 10;
  const WALLET_TX_MAX_FETCH = 100;
  const WALLET_TX_LOOKAHEAD = 15;
  let currentWalletDetails = null;
  let walletTxPage = 1;
  let walletTxRows = [];
  let walletTxTotal = 0;

  function walletAddress() {
    return $id("walletPublicAddress")?.value.trim() || donationAddress();
  }

  function walletReceiveUri(address = walletAddress()) {
    return dogeUri(address, 0, "DOGE receive");
  }

  function walletStatus(message) {
    if ($id("walletBalanceStatus")) $id("walletBalanceStatus").textContent = message;
  }

  function walletTxStatus(message) {
    if ($id("walletTransactionsStatus")) $id("walletTransactionsStatus").textContent = message;
  }

  function walletSendStatus(message) {
    if ($id("walletSendStatus")) $id("walletSendStatus").textContent = message;
  }

  function walletHasSigningKey() {
    return Boolean(currentWalletDetails?.wif || $id("walletWif")?.value.trim());
  }

  function syncWalletSendControls() {
    const enabled = walletHasSigningKey();
    if ($id("walletSendDoge")) $id("walletSendDoge").disabled = !enabled;
    if ($id("walletEstimateSend")) $id("walletEstimateSend").disabled = !enabled;
    if ($id("walletSendPanel")) {
      $id("walletSendPanel").classList.toggle("wallet-send-ready", enabled);
    }
    if (!enabled) walletSendStatus("Load a WIF locally to sign and broadcast from this browser.");
  }

  function hexToBytes(hex) {
    const clean = String(hex || "").replace(/^0x/i, "");
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i += 1) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    return out;
  }

  function hexScriptToBytes(scriptHex) {
    const clean = String(scriptHex || "").replace(/^0x/i, "");
    if (!clean) return null;
    return hexToBytes(clean);
  }

  async function fetchWalletUtxos(address) {
    const response = await walletChainFetch(`/api/wallet/utxos/?address=${encodeURIComponent(address)}&limit=50`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not load spendable outputs.");
    const core = window.dogeWalletCore;
    return (payload.utxos || []).map((utxo) => ({
      txid: utxo.txid,
      vout: Number(utxo.vout || 0),
      value: Number(utxo.value || 0),
      scriptPubKey: hexScriptToBytes(utxo.script_hex) || null,
    })).filter((utxo) => utxo.txid && utxo.value > 0);
  }

  async function estimateWalletSend() {
    const core = window.dogeWalletCore;
    if (!core) throw new Error("Wallet core is unavailable.");
    if (!walletHasSigningKey()) throw new Error("Load a WIF before estimating a send.");
    const amount = Number($id("walletSendAmount")?.value || 0);
    const toAddress = $id("walletSendTo")?.value.trim();
    if (!toAddress) throw new Error("Enter a recipient address.");
    const wallet = await resolveSigningWallet();
    const utxos = await fetchWalletUtxos(wallet.address);
    const feePerByte = Number($id("walletSendFee")?.value || 1000);
    const atoms = core.dogeToAtoms(amount);
    const selection = core.selectUtxos(utxos, atoms, feePerByte);
    if ($id("walletSendFeeOut")) $id("walletSendFeeOut").textContent = `${core.atomsToDoge(selection.fee)} DOGE`;
    const totalIn = selection.selected.reduce((sum, item) => sum + BigInt(item.value), 0n);
    const change = totalIn - atoms - selection.fee;
    if ($id("walletSendChangeOut")) $id("walletSendChangeOut").textContent = `${core.atomsToDoge(change > 0n ? change : 0n)} DOGE`;
    walletSendStatus(`Estimated ${selection.selected.length} input(s) via ${selection.fee} atoms fee.`);
  }

  async function resolveSigningWallet() {
    const core = window.dogeWalletCore;
    if (!core) throw new Error("Wallet core is unavailable.");
    const wif = (currentWalletDetails?.wif || $id("walletWif")?.value || "").trim();
    if (!wif) throw new Error("Load a WIF before sending.");
    const wallet = await core.walletFromWif(wif);
    const fieldAddress = ($id("walletPublicAddress")?.value || "").trim();
    if (fieldAddress && fieldAddress !== wallet.address) {
      throw new Error("Public address and WIF do not match. Reload the wallet or clear the mismatched address.");
    }
    return wallet;
  }

  async function privateKeyHexFromWif(wif, core) {
    const payload = await core.base58CheckDecode(wif);
    const compressed = payload.length === 34 && payload[payload.length - 1] === 0x01;
    const privateKeyBytes = compressed ? payload.slice(1, -1) : payload.slice(1);
    return core.bytesToHex(privateKeyBytes);
  }

  function validatedWalletSendInputs() {
    const core = window.dogeWalletCore;
    if (!core) throw new Error("Wallet core is unavailable.");
    if (!walletHasSigningKey()) throw new Error("Load a WIF before sending.");
    const toAddress = $id("walletSendTo")?.value.trim();
    const amount = Number($id("walletSendAmount")?.value || 0);
    const feePerByte = Number($id("walletSendFee")?.value || 1000);
    if (!toAddress) throw new Error("Enter a recipient address.");
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a positive DOGE amount.");
    return { core, toAddress, amount, feePerByte };
  }

  function hideWalletSendConfirm() {
    if ($id("walletSendConfirm")) $id("walletSendConfirm").hidden = true;
  }

  function requestWalletSend() {
    const { toAddress, amount } = validatedWalletSendInputs();
    if ($id("walletSendConfirmSummary")) {
      $id("walletSendConfirmSummary").textContent = `Send ${amount} DOGE to ${toAddress}. This broadcasts a real, irreversible mainnet transaction.`;
    }
    if ($id("walletSendConfirm")) $id("walletSendConfirm").hidden = false;
    $id("walletConfirmSend")?.focus();
    walletSendStatus("Review the summary, then confirm to broadcast.");
  }

  function setSentTxStatus(state, label, note) {
    const pill = $id("walletSentTxStatus");
    if (pill) {
      pill.dataset.state = state;
      pill.textContent = label;
    }
    if (note && $id("walletSentTxNote")) $id("walletSentTxNote").textContent = note;
  }

  function showSentTransaction({ txid, provider, amount, toAddress }) {
    if ($id("walletSentTx")) $id("walletSentTx").hidden = false;
    if ($id("walletSentTxAmount")) $id("walletSentTxAmount").textContent = `${amount} DOGE`;
    if ($id("walletSentTxTo")) $id("walletSentTxTo").textContent = `${toAddress.slice(0, 10)}…${toAddress.slice(-6)}`;
    if ($id("walletSentTxProvider")) $id("walletSentTxProvider").textContent = provider;
    const link = $id("walletSentTxLink");
    if (link) {
      link.href = explorerUrl(txid);
      link.textContent = txid;
    }
    setSentTxStatus("pending", "Submitted", "Broadcast accepted. Watching the chain for the first confirmation.");
  }

  function watchSentTransaction(txid, toAddress, amount) {
    if (sentTxWatchTimer) clearTimeout(sentTxWatchTimer);
    let attempts = 0;
    const poll = async () => {
      attempts += 1;
      try {
        const response = await fetch("/api/transaction/validate/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ txid, address: toAddress, doge: amount, min_confirmations: 1 }),
        });
        const payload = await response.json().catch(() => ({}));
        if (response.ok) {
          const confirmations = Math.max(0, Number(payload.confirmations || 0));
          if (confirmations >= 1) {
            setSentTxStatus("confirmed", `Confirmed ×${confirmations}`, `The network has confirmed this transaction ${confirmations} time${confirmations === 1 ? "" : "s"}.`);
            if (confirmations >= 3) return;
          } else {
            setSentTxStatus("seen", "Seen on chain", "The transaction is visible in the mempool and waiting for its first confirmation.");
          }
        } else {
          setSentTxStatus("pending", "Propagating", "Broadcast accepted. The transaction has not appeared in chain lookups yet — this usually takes under a minute.");
        }
      } catch {
        /* keep polling on transient network errors */
      }
      if (attempts < 20) sentTxWatchTimer = setTimeout(poll, 30000);
      else setSentTxStatus($id("walletSentTxStatus")?.dataset.state || "pending", $id("walletSentTxStatus")?.textContent || "Submitted", "Automatic tracking stopped. Use the explorer link above for the latest status.");
    };
    sentTxWatchTimer = setTimeout(poll, 6000);
  }

  async function sendWalletDoge() {
    const { core, toAddress, amount, feePerByte } = validatedWalletSendInputs();
    hideWalletSendConfirm();
    walletSendStatus("Preparing spendable outputs...");
    const wallet = await resolveSigningWallet();
    const utxos = await fetchWalletUtxos(wallet.address);
    const enriched = await Promise.all(utxos.map(async (utxo) => ({
      ...utxo,
      scriptPubKey: utxo.scriptPubKey || await core.p2pkhScript(wallet.address),
    })));
    walletSendStatus("Signing transaction locally...");
    const signedTx = await core.buildSignedTransaction({
      utxos: enriched,
      fromAddress: wallet.address,
      toAddress,
      amountDoge: amount,
      privateKeyHex: await privateKeyHexFromWif(wallet.wif, core),
      publicKeyHex: wallet.public_key,
      changeAddress: wallet.address,
      feePerByte,
    });
    walletSendStatus("Broadcasting signed transaction...");
    let payload = null;
    try {
      const blockchairResponse = await limitedFetch("https://api.blockchair.com/dogecoin/push/transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: signedTx.hex }),
      }, { source: "blockchair" });
      if (blockchairResponse.ok) {
        const blockchairPayload = await blockchairResponse.json();
        const txid = blockchairPayload?.data?.transaction_hash;
        if (txid) {
          payload = {
            txid,
            provider_name: "Blockchair",
            explorer_url: explorerUrl(txid),
          };
        }
      }
    } catch {
      /* fall through to server broadcast */
    }
    if (!payload) {
      try {
        const blockcypherResponse = await limitedFetch("https://api.blockcypher.com/v1/doge/main/txs/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tx: signedTx.hex }),
        }, { source: "blockcypher" });
        if (blockcypherResponse.ok) {
          const blockcypherPayload = await blockcypherResponse.json();
          const txid = blockcypherPayload?.tx?.hash;
          if (txid) {
            payload = {
              txid,
              provider_name: "BlockCypher",
              explorer_url: explorerUrl(txid),
            };
          }
        }
      } catch {
        /* fall through to server broadcast */
      }
    }
    if (!payload) {
      const response = await walletChainFetch("/api/wallet/broadcast/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hex: signedTx.hex }),
      });
      payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Broadcast failed.");
    }
    if ($id("walletSendFeeOut")) $id("walletSendFeeOut").textContent = `${signedTx.feeDoge} DOGE`;
    if ($id("walletSendChangeOut")) $id("walletSendChangeOut").textContent = `${signedTx.changeDoge} DOGE`;
    walletSendStatus(`Broadcast accepted by ${payload.provider_name}.`);
    showSentTransaction({ txid: payload.txid, provider: payload.provider_name, amount, toAddress });
    watchSentTransaction(payload.txid, toAddress, amount);
    if (window.dogeAnnounce) window.dogeAnnounce("Transaction broadcast submitted.");
    await lookupWalletBalance();
  }

  async function generateWallet() {
    if (!$id("dogeWalletTool")) return null;
    const core = window.dogeWalletCore;
    if (!core) throw new Error("Wallet core is unavailable.");
    return core.generateWallet();
  }

  async function walletFromWif(wif) {
    const core = window.dogeWalletCore;
    if (!core) throw new Error("Wallet core is unavailable.");
    return core.walletFromWif(wif);
  }

  function walletDetailsPayload(extra = {}) {
    const address = walletAddress();
    return {
      address,
      receive_uri: walletReceiveUri(address),
      mode: currentWalletDetails?.wif ? "local private-key wallet" : "watch-only address",
      wallet: currentWalletDetails,
      ...extra,
      exported_at: new Date().toISOString(),
      note: "Generated/imported private key material is handled client-side in the browser.",
    };
  }

  function setWalletOutput(payload) {
    if ($id("walletOutput")) $id("walletOutput").value = JSON.stringify(payload, null, 2);
  }

  function updateWalletReceive(address = walletAddress()) {
    const uri = walletReceiveUri(address);
    if ($id("walletAddressOut")) $id("walletAddressOut").textContent = address;
    if ($id("walletQr")) $id("walletQr").src = qrUrl(uri);
    if ($id("walletExplorerLink")) $id("walletExplorerLink").href = explorerUrl("", address);
    setWalletOutput(walletDetailsPayload());
  }

  function applyWallet(payload, includeSecret = false, status = "Wallet loaded.") {
    if (!payload?.address) return;
    currentWalletDetails = {
      address: payload.address,
      public_key: payload.public_key || "",
      compressed: payload.compressed ?? true,
      wif: payload.wif || "",
      generated_in: payload.generated_in || "browser",
      loaded_at: new Date().toISOString(),
    };
    if ($id("walletPublicAddress")) $id("walletPublicAddress").value = payload.address;
    if (includeSecret && payload.wif && $id("walletWif")) $id("walletWif").value = payload.wif;
    if ($id("walletAddressTitle")) $id("walletAddressTitle").textContent = includeSecret || payload.wif ? "Local wallet" : "Watch-only wallet";
    if ($id("walletModeOut")) $id("walletModeOut").textContent = payload.wif ? "Private key available in this browser" : "Public receive address";
    updateWalletReceive(payload.address);
    walletStatus(status);
    syncWalletSendControls();
    walletTxPage = 1;
    lookupWalletBalance().catch((error) => {
      walletStatus(error.message || "Balance lookup failed.");
      refreshWalletTransactions().catch(() => {});
    });
  }

  async function inspectWalletWif() {
    const wif = $id("walletWif")?.value.trim();
    const address = $id("walletPublicAddress")?.value.trim();
    try {
      if (wif) {
        applyWallet(await walletFromWif(wif), true, "Loaded WIF locally in this browser.");
      } else if (address) {
        currentWalletDetails = { address, wif: "", public_key: "", compressed: true, loaded_at: new Date().toISOString() };
        if ($id("walletAddressTitle")) $id("walletAddressTitle").textContent = "Watch-only wallet";
        if ($id("walletModeOut")) $id("walletModeOut").textContent = "Public receive address";
        updateWalletReceive(address);
        walletStatus("Loaded public address.");
        walletTxPage = 1;
        await lookupWalletBalance();
      }
    } catch (error) {
      walletStatus(error.message || "Could not load wallet.");
    }
  }

  function resetWalletSummary() {
    if ($id("walletBalanceOut")) $id("walletBalanceOut").textContent = "0 DOGE";
    if ($id("walletUnconfirmedOut")) $id("walletUnconfirmedOut").textContent = "0 DOGE";
    if ($id("walletReceivedOut")) $id("walletReceivedOut").textContent = "0 DOGE";
    if ($id("walletTxOut")) $id("walletTxOut").textContent = "0";
  }

  async function lookupWalletBalance() {
    const address = walletAddress();
    updateWalletReceive(address);
    walletStatus("Checking public blockchain data...");
    const response = await walletChainFetch(`/api/wallet/balance/?address=${encodeURIComponent(address)}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) {
      resetWalletSummary();
      walletStatus(payload.error || "Balance lookup failed.");
      await refreshWalletTransactions();
      return;
    }
    if ($id("walletBalanceOut")) $id("walletBalanceOut").textContent = `${payload.final_balance_doge} DOGE`;
    if ($id("walletUnconfirmedOut")) $id("walletUnconfirmedOut").textContent = `${payload.unconfirmed_balance_doge} DOGE`;
    if ($id("walletReceivedOut")) $id("walletReceivedOut").textContent = `${payload.total_received_doge} DOGE`;
    if ($id("walletTxOut")) $id("walletTxOut").textContent = payload.transactions;
    walletTxTotal = Number(payload.transactions || 0);
    const provider = payload.provider_name || "the Dogecoin blockchain";
    const staleLabel = payload.stale ? " cached" : "";
    walletStatus(`Loaded${staleLabel} public balance from ${provider} at ${new Date(payload.updated_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`);
    setWalletOutput(walletDetailsPayload({ balance: payload }));
    await window.dogeRateLimit?.probeClientProviders?.().catch(() => {});
    await refreshWalletTransactions();
  }

  function formatWalletTxTime(value) {
    if (!value) return "Pending";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function renderWalletTransactions() {
    const body = $id("walletTransactionsBody");
    if (!body) return;
    const start = (walletTxPage - 1) * WALLET_TX_PAGE_SIZE;
    const rows = walletTxRows.slice(start, start + WALLET_TX_PAGE_SIZE);
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="4">No public transactions found for this address.</td></tr>`;
    } else {
      body.innerHTML = rows.map((transaction) => `
        <tr>
          <td data-label="Transaction"><a class="table-button" href="${escapeHtml(transaction.explorer_url)}" target="_blank" rel="noreferrer">${escapeHtml(transaction.short_txid || transaction.txid)}</a></td>
          <td data-label="DOGE"><strong>${escapeHtml(transaction.doge)} DOGE</strong></td>
          <td data-label="Status"><span class="status-pill ${transaction.status === "pending" ? "pending" : "ready"}">${escapeHtml(transaction.status || "confirmed")}</span></td>
          <td data-label="Time">${escapeHtml(formatWalletTxTime(transaction.time))}</td>
        </tr>
      `).join("");
    }
    const availableCount = Math.min(WALLET_TX_MAX_FETCH, Math.max(walletTxTotal, walletTxRows.length));
    const pageCount = Math.max(1, Math.ceil(availableCount / WALLET_TX_PAGE_SIZE));
    if ($id("walletTxPageOut")) $id("walletTxPageOut").textContent = `Page ${walletTxPage} of ${pageCount}`;
    if ($id("walletTxPrev")) $id("walletTxPrev").disabled = walletTxPage <= 1;
    if ($id("walletTxNext")) $id("walletTxNext").disabled = walletTxPage >= pageCount;
  }

  async function refreshWalletTransactions(targetPage = walletTxPage) {
    const address = walletAddress();
    const requestedRows = targetPage * WALLET_TX_PAGE_SIZE + WALLET_TX_LOOKAHEAD;
    const limit = Math.min(WALLET_TX_MAX_FETCH, Math.max(WALLET_TX_PAGE_SIZE, requestedRows));
    walletTxStatus("Loading latest public transactions...");
    try {
      const response = await walletChainFetch(`/api/wallet/transactions/?address=${encodeURIComponent(address)}&limit=${limit}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Transaction lookup failed.");
      walletTxRows = payload.transactions || [];
      walletTxTotal = Number(payload.total_transactions ?? walletTxTotal ?? walletTxRows.length);
      walletTxPage = targetPage;
      const maxPage = Math.max(1, Math.ceil(Math.min(WALLET_TX_MAX_FETCH, Math.max(walletTxTotal, walletTxRows.length)) / WALLET_TX_PAGE_SIZE));
      if (walletTxPage > maxPage) walletTxPage = maxPage;
      renderWalletTransactions();
      const provider = payload.provider_name || "the Dogecoin blockchain";
      const staleLabel = payload.stale ? " cached" : "";
      walletTxStatus(walletTxRows.length ? `Showing latest${staleLabel} public activity from ${provider}.` : "No public transactions found yet.");
    } catch (error) {
      walletTxRows = [];
      renderWalletTransactions();
      walletTxStatus(error.message || "Transaction lookup failed.");
    }
  }

  function initWalletTool() {
    if (!$id("dogeWalletTool")) return;
    const saved = localStorage.getItem("doge-wallet:address");
    const savedWif = localStorage.getItem("doge-wallet:wif");
    if (saved && $id("walletPublicAddress")) $id("walletPublicAddress").value = saved;
    if (savedWif && $id("walletWif")) $id("walletWif").value = savedWif;
    currentWalletDetails = { address: walletAddress(), wif: "", public_key: "", compressed: true, loaded_at: new Date().toISOString() };
    updateWalletReceive();
    $id("dogeWalletTool")?.querySelector(".wallet-control-grid")?.addEventListener("submit", (event) => {
      event.preventDefault();
      inspectWalletWif();
    });
    $id("walletPublicAddress")?.addEventListener("input", () => {
      currentWalletDetails = { address: walletAddress(), wif: "", public_key: "", compressed: true, loaded_at: new Date().toISOString() };
      updateWalletReceive();
    });
    $id("generateWallet")?.addEventListener("click", () => {
      walletStatus("Creating wallet locally...");
      generateWallet()
        .then((payload) => applyWallet(payload, true, "Created wallet locally in this browser. Download the details before receiving funds."))
        .catch((error) => walletStatus(error.message || "Could not generate wallet."));
    });
    $id("loadWalletWif")?.addEventListener("click", inspectWalletWif);
    $id("lookupWalletBalance")?.addEventListener("click", () => lookupWalletBalance().catch((error) => walletStatus(error.message || "Balance lookup failed.")));
    $id("copyWalletAddress")?.addEventListener("click", () => copy(walletAddress(), "Wallet address copied."));
    $id("copyWalletUri")?.addEventListener("click", () => copy(walletReceiveUri(), "Receive URI copied."));
    $id("downloadWalletDetails")?.addEventListener("click", () => {
      const address = walletAddress() || "doge-wallet";
      downloadText(`doge-wallet-${address.slice(0, 8)}.json`, JSON.stringify(walletDetailsPayload(), null, 2), "application/json");
    });
    $id("walletTxPrev")?.addEventListener("click", () => {
      if (walletTxPage > 1) refreshWalletTransactions(walletTxPage - 1);
    });
    $id("walletTxNext")?.addEventListener("click", () => refreshWalletTransactions(walletTxPage + 1));
    $id("toggleWalletSecret")?.addEventListener("click", () => {
      const input = $id("walletWif");
      if (!input) return;
      input.type = input.type === "password" ? "text" : "password";
    });
    $id("saveWalletLocal")?.addEventListener("click", () => {
      localStorage.setItem("doge-wallet:address", walletAddress());
      if ($id("walletWif")?.value.trim()) localStorage.setItem("doge-wallet:wif", $id("walletWif").value.trim());
      else localStorage.removeItem("doge-wallet:wif");
      if (window.dogeAnnounce) window.dogeAnnounce("Wallet saved in this browser.");
    });
    $id("clearWalletLocal")?.addEventListener("click", () => {
      localStorage.removeItem("doge-wallet:address");
      localStorage.removeItem("doge-wallet:wif");
      if ($id("walletPublicAddress")) $id("walletPublicAddress").value = donationAddress();
      if ($id("walletWif")) $id("walletWif").value = "";
      currentWalletDetails = { address: walletAddress(), wif: "", public_key: "", compressed: true, loaded_at: new Date().toISOString() };
      updateWalletReceive();
      walletStatus("Browser wallet cleared.");
      if (window.dogeAnnounce) window.dogeAnnounce("Browser wallet cleared.");
    });
    $id("walletSendForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      try {
        requestWalletSend();
      } catch (error) {
        walletSendStatus(error.message || "Send failed.");
      }
    });
    $id("walletSendDoge")?.addEventListener("click", () => {
      try {
        requestWalletSend();
      } catch (error) {
        walletSendStatus(error.message || "Send failed.");
      }
    });
    $id("walletConfirmSend")?.addEventListener("click", () => {
      sendWalletDoge().catch((error) => {
        hideWalletSendConfirm();
        walletSendStatus(error.message || "Send failed.");
      });
    });
    $id("walletCancelSend")?.addEventListener("click", () => {
      hideWalletSendConfirm();
      walletSendStatus("Send cancelled. Nothing was broadcast.");
    });
    $id("walletSendForm")?.addEventListener("input", hideWalletSendConfirm);
    $id("walletEstimateSend")?.addEventListener("click", () => {
      estimateWalletSend().catch((error) => walletSendStatus(error.message || "Estimate failed."));
    });
    $id("walletWif")?.addEventListener("input", syncWalletSendControls);
    syncWalletSendControls();
    if (savedWif) inspectWalletWif();
    else lookupWalletBalance().catch((error) => walletStatus(error.message || "Balance lookup failed."));
  }

  function clampDonateAmount(value) {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount)) return 0;
    return Math.min(1000, Math.max(0, amount));
  }

  function donateSnippet(address = donationAddress(), amount = 25, memo = "DOGE Commerce Kit donation", options = {}) {
    const uri = dogeUri(address, amount, memo);
    const label = options.label || "Donate DOGE";
    const title = options.title || "Support DOGE Commerce Kit";
    const qrSource = options.qrSource || qrUrl(uri);
    return `<a href="${escapeHtml(uri)}" style="display:inline-grid;grid-template-columns:minmax(0,1fr) 92px;gap:12px;align-items:center;min-width:300px;max-width:360px;min-height:106px;padding:12px 14px;border:2px solid #f4bd2a;border-radius:10px;background:linear-gradient(135deg,#171715,#253c3c 62%,#4b390d);color:#fff;text-decoration:none;font-family:system-ui,sans-serif;box-shadow:0 12px 28px rgba(23,23,21,.18)">
  <span style="display:grid;gap:7px;min-width:0">
    <span style="display:inline-flex;align-items:center;gap:9px;width:max-content;max-width:100%;padding:6px 10px 6px 6px;border:1px solid rgba(244,189,42,.32);border-radius:999px;background:rgba(255,255,255,.08);color:#f4bd2a;font-size:12px;font-weight:900;letter-spacing:.08em;text-transform:uppercase">
      <img src="${escapeHtml(logo())}" alt="" style="width:32px;height:32px;border-radius:50%;background:#f4bd2a">
      ${escapeHtml(label)}
    </span>
    <span style="display:grid;gap:3px;line-height:1.12">
      <strong style="font-size:18px">${escapeHtml(title)}</strong>
      <small style="color:rgba(255,255,255,.78)">${escapeHtml(amount)} DOGE</small>
      <small style="overflow-wrap:anywhere;color:rgba(255,255,255,.62)">${escapeHtml(address)}</small>
    </span>
  </span>
  <img src="${escapeHtml(qrSource)}" alt="Scan to donate DOGE" style="width:92px;height:92px;border-radius:8px;background:#fff;padding:5px">
</a>`;
  }

  function footerDonateButtonSnippet(address = donationAddress(), amount = 25, memo = "DOGE Commerce Kit donation", options = {}) {
    const uri = dogeUri(address, amount, memo);
    const label = options.label || "Donate DOGE";
    return `<a href="${escapeHtml(uri)}" aria-label="${escapeHtml(label)}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:42px;padding:10px 16px;border:1px solid #d8ded3;border-radius:8px;background:#f4bd2a;color:#221900;text-decoration:none;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;font-weight:900;line-height:1;box-shadow:0 8px 18px rgba(23,23,21,.08)">${escapeHtml(label)}</a>`;
  }

  function donatePreviewMarkup({ address, amount, memo, label, title, qrSource }) {
    const uri = dogeUri(address, amount, memo);
    return `
      <div class="donate-preview-main">
        <div class="badge-mark">
          <img src="${escapeHtml(logo())}" alt="">
          <span>${escapeHtml(label)}</span>
        </div>
        <div class="badge-copy">
          <strong>${escapeHtml(title)}</strong>
          <small>${escapeHtml(amount)} DOGE</small>
          <small>${escapeHtml(address)}</small>
        </div>
      </div>
      <img class="donate-preview-qr" src="${escapeHtml(qrSource || qrUrl(uri))}" alt="Donate DOGE QR code">
    `;
  }

  async function updateDonateModal() {
    const address = $id("donateModal")?.dataset.address || donationAddress();
    const memo = $id("donateModal")?.dataset.memo || "DOGE Commerce Kit donation";
    const amount = clampDonateAmount($id("donateAmount")?.value || 0);
    const label = $id("donateModal")?.dataset.label || "Donate DOGE";
    const title = $id("donateModal")?.dataset.title || "Support DOGE Commerce Kit";
    const uri = dogeUri(address, amount, memo);
    const renderId = ++donateModalRenderId;
    if ($id("donateAmountOut")) $id("donateAmountOut").textContent = `${amount} DOGE`;
    if ($id("donateUriOut")) $id("donateUriOut").textContent = uri;
    if ($id("donateQr")) $id("donateQr").src = qrUrl(uri);
    if ($id("donateSnippetOut")) $id("donateSnippetOut").value = "Generating self-contained donate snippet...";
    const qrSource = await qrDataUri(uri);
    if (renderId !== donateModalRenderId) return;
    if ($id("donateSnippetOut")) $id("donateSnippetOut").value = donateSnippet(address, amount, memo, { label, title, qrSource });
  }

  function openDonateModal(button) {
    const modal = $id("donateModal");
    if (!modal) return;
    modal.dataset.address = button.dataset.address || donationAddress();
    modal.dataset.memo = button.dataset.memo || "DOGE Commerce Kit donation";
    modal.dataset.label = button.dataset.label || "Donate DOGE";
    modal.dataset.title = button.dataset.title || "Support DOGE Commerce Kit";
    if ($id("donateAmount")) {
      $id("donateAmount").value = String(clampDonateAmount(button.dataset.amount || 25));
    }
    modal.hidden = false;
    updateDonateModal();
  }

  async function updateDonateSnippetBuilder() {
    if (!$id("donateSnippetBuilder")) return;
    const address = $id("donateSnippetAddress")?.value.trim() || donationAddress();
    const amount = clampDonateAmount($id("donateSnippetAmount")?.value || 0);
    const memo = $id("donateSnippetMemo")?.value.trim() || "DOGE Commerce Kit donation";
    const label = $id("donateSnippetLabel")?.value.trim() || "Donate DOGE";
    const title = $id("donateSnippetTitle")?.value.trim() || "Support DOGE Commerce Kit";
    const uri = dogeUri(address, amount, memo);
    const renderId = ++donateBuilderRenderId;
    if ($id("donateSnippetAmountOut")) $id("donateSnippetAmountOut").textContent = `${amount} DOGE`;
    if ($id("previewDonateSnippet")) {
      $id("previewDonateSnippet").dataset.address = address;
      $id("previewDonateSnippet").dataset.memo = memo;
      $id("previewDonateSnippet").dataset.amount = String(amount);
      $id("previewDonateSnippet").dataset.label = label;
      $id("previewDonateSnippet").dataset.title = title;
    }
    if ($id("donateFooterButtonPreview")) {
      $id("donateFooterButtonPreview").href = uri;
      $id("donateFooterButtonPreview").textContent = label;
      $id("donateFooterButtonPreview").dataset.address = address;
      $id("donateFooterButtonPreview").dataset.memo = memo;
      $id("donateFooterButtonPreview").dataset.amount = String(amount);
      $id("donateFooterButtonPreview").dataset.label = label;
      $id("donateFooterButtonPreview").dataset.title = title;
    }
    if ($id("donateSnippetPreview")) {
      $id("donateSnippetPreview").innerHTML = donatePreviewMarkup({ address, amount, memo, label, title, qrSource: qrUrl(uri) });
    }
    if ($id("donateSnippetInline")) $id("donateSnippetInline").value = "Generating self-contained donate snippet...";
    if ($id("donateFooterSnippet")) {
      $id("donateFooterSnippet").value = footerDonateButtonSnippet(address, amount, memo, { label });
    }
    const qrSource = await qrDataUri(uri);
    if (renderId !== donateBuilderRenderId) return;
    if ($id("donateSnippetPreview")) {
      $id("donateSnippetPreview").innerHTML = donatePreviewMarkup({ address, amount, memo, label, title, qrSource });
    }
    if ($id("donateSnippetInline")) {
      $id("donateSnippetInline").value = donateSnippet(address, amount, memo, { label, title, qrSource });
    }
  }

  function initDonateModal() {
    document.querySelectorAll("[data-doge-donate]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        openDonateModal(button);
      });
    });
    $id("closeDonateModal")?.addEventListener("click", () => {
      $id("donateModal").hidden = true;
    });
    $id("donateModal")?.addEventListener("click", (event) => {
      if (event.target === $id("donateModal")) $id("donateModal").hidden = true;
    });
    $id("donateAmount")?.addEventListener("input", updateDonateModal);
    $id("copyDonateWallet")?.addEventListener("click", () => copy($id("donateModal")?.dataset.address || donationAddress(), "Donation wallet copied."));
    $id("copyDonateUri")?.addEventListener("click", () => copy($id("donateUriOut")?.textContent, "Donation URI copied."));
    $id("copyDonateSnippet")?.addEventListener("click", () => copy($id("donateSnippetOut")?.value, "Donate snippet copied."));
    document.querySelectorAll("#donateSnippetBuilder input").forEach((field) => {
      field.addEventListener("input", () => updateDonateSnippetBuilder());
    });
    updateDonateSnippetBuilder();
    $id("copyDonateSnippetInline")?.addEventListener("click", () => copy($id("donateSnippetInline")?.value, "Donate snippet copied."));
    $id("copyDonateFooterSnippet")?.addEventListener("click", () => copy($id("donateFooterSnippet")?.value, "Footer donate button snippet copied."));
  }

  function savedWalletShareAddress() {
    return (
      (localStorage.getItem("doge-wallet:address") || "").trim() ||
      (localStorage.getItem("doge-pos:wallet") || "").trim() ||
      ""
    );
  }

  function safeCampaignUrl(value) {
    const raw = String(value || "").trim() || "https://commerce.dog";
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      return new URL(withScheme).href;
    } catch (error) {
      return "https://commerce.dog/";
    }
  }

  function campaignHost(value) {
    try {
      return new URL(safeCampaignUrl(value)).host.replace(/^www\./, "");
    } catch (error) {
      return "commerce.dog";
    }
  }

function walletShareValues() {
  const saved = savedWalletShareAddress();
  return {
    name: $id("walletShareName")?.value.trim() || "DOGE Commerce Kit",
    address: $id("walletShareAddress")?.value.trim() || saved || donationAddress(),
    message: $id("walletShareMessage")?.value.trim() || "Scan this DOGE address from my site, shop, or profile.",
    url: safeCampaignUrl($id("walletShareDomain")?.value || "https://commerce.dog"),
    credit: $id("walletShareCredit")?.value.trim() || "Made with <3 by DOGE Commerce Kit",
  };
}

function walletShareCardMarkup(values, qrSource) {
  const uri = dogeUri(values.address, 0, values.message);
  return `
    <div class="wallet-share-top">
      <span class="wallet-share-symbol" aria-hidden="true">&#272;</span>
      <span><strong>${escapeHtml(values.name)}</strong><small>Shareable DOGE wallet QR</small></span>
    </div>
    <div class="wallet-share-card-body">
      <div class="wallet-share-copy-stack">
        <span class="wallet-share-ribbon">DOGE ready</span>
        <strong class="wallet-share-headline">Send DOGE here</strong>
        <span class="wallet-share-message">${escapeHtml(values.message)}</span>
        <span class="wallet-share-address-label">Public address</span>
        <code>${escapeHtml(values.address)}</code>
        <span class="wallet-share-domain">${escapeHtml(campaignHost(values.url))}</span>
      </div>
      <a class="wallet-share-qr-wrap" href="${escapeHtml(uri)}" aria-label="Open Dogecoin wallet QR">
        <img src="${escapeHtml(qrSource || qrUrl(uri))}" alt="Dogecoin wallet QR code">
      </a>
    </div>
    <div class="wallet-share-credit-row">
      <a class="wallet-share-credit" href="${escapeHtml(values.url)}" target="_blank" rel="noopener">${escapeHtml(values.credit)}</a>
    </div>
  `;
}

function walletShareSnippet(values, qrSource) {
  const uri = dogeUri(values.address, 0, values.message);
  const host = campaignHost(values.url);
  const qr = qrSource || qrUrl(uri);
  return `<div aria-label="Branded Dogecoin wallet card" style="box-sizing:border-box;display:block;max-width:560px;min-width:300px;padding:18px;border:2px solid #f4bd2a;border-radius:18px;background-image:linear-gradient(rgba(255,255,255,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.05) 1px,transparent 1px),radial-gradient(circle at 86% 12%,rgba(244,189,42,.32),transparent 140px),linear-gradient(135deg,#10283a 0%,#183545 55%,#49380e 100%);background-size:22px 22px,22px 22px,auto,auto;color:#f7fbff;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 24px 55px rgba(13,36,48,.24);overflow:hidden">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px">
    <span aria-hidden="true" style="display:grid;place-items:center;width:44px;height:44px;flex:0 0 auto;border-radius:50%;background:#f4bd2a;color:#141414;font-size:28px;font-weight:900;box-shadow:inset 0 0 0 3px rgba(255,255,255,.48),0 10px 24px rgba(0,0,0,.2)">&#272;</span>
    <span style="display:grid;gap:3px;min-width:0"><strong style="color:#fff;font-size:18px;line-height:1.1">${escapeHtml(values.name)}</strong><small style="color:#cfe8f7;font-size:12px">Shareable DOGE wallet QR</small></span>
  </div>
  <div style="display:grid;grid-template-columns:minmax(0,1fr) 152px;gap:18px;align-items:end">
    <div style="display:grid;gap:8px;min-width:0">
      <span style="justify-self:start;padding:6px 10px;border:1px solid rgba(244,189,42,.46);border-radius:999px;background:rgba(244,189,42,.16);color:#ffd65c;font-size:11px;font-weight:900;letter-spacing:.08em;text-transform:uppercase">DOGE READY</span>
      <strong style="color:#fff;font-size:32px;line-height:.98;letter-spacing:0">Send DOGE here</strong>
      <span style="color:#d7e9f3;font-size:14px;line-height:1.35">${escapeHtml(values.message)}</span>
      <span style="color:#ffd65c;font-size:10px;font-weight:900;letter-spacing:.08em;text-transform:uppercase">Public address</span>
      <code style="display:block;max-width:100%;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.08);color:#eaf7ff;overflow-wrap:anywhere;font-size:12px;line-height:1.35">${escapeHtml(values.address)}</code>
      <a href="${escapeHtml(values.url)}" target="_blank" rel="noopener" style="justify-self:start;padding:7px 10px;border-radius:999px;background:rgba(244,189,42,.16);color:#f4bd2a;font-size:12px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;text-decoration:none">${escapeHtml(host)}</a>
    </div>
    <a href="${escapeHtml(uri)}" style="position:relative;display:grid;place-items:center;width:152px;height:152px;padding:10px;box-sizing:border-box;border-radius:18px;background:#eaf7ff;box-shadow:0 14px 32px rgba(0,0,0,.2);text-decoration:none" aria-label="Open Dogecoin wallet QR">
      <img src="${escapeHtml(qr)}" alt="Dogecoin wallet QR code" style="display:block;width:100%;height:100%;object-fit:contain">
    </a>
  </div>
  <a href="${escapeHtml(values.url)}" target="_blank" rel="noopener" style="display:inline-block;margin-top:16px;color:#cfe8f7;font-size:13px;font-weight:800;text-decoration:none">${escapeHtml(values.credit)}</a>
</div>`;
}

  async function updateWalletShareBuilder() {
    const preview = $id("walletSharePreview");
    const code = $id("walletShareSnippetCode");
    if (!preview || !code) return;
    const values = walletShareValues();
    const uri = dogeUri(values.address, 0, values.message);
    const fallbackQr = qrUrl(uri);
    const renderId = ++walletShareRenderId;
    preview.innerHTML = walletShareCardMarkup(values, fallbackQr);
    code.value = walletShareSnippet(values, fallbackQr);
    const embeddedQr = await qrDataUri(uri);
    if (renderId !== walletShareRenderId) return;
    preview.innerHTML = walletShareCardMarkup(values, embeddedQr);
    code.value = walletShareSnippet(values, embeddedQr);
    scheduleWalletCardRefresh();
  }

  function walletShareContent() {
    const values = walletShareValues();
    const url = values.url || "https://commerce.dog/";
    const lead = `I accept Dogecoin! 🐕 Send DOGE to my wallet ${values.address}. Make your own free DOGE wallet card:`;
    return { values, url, lead, caption: `${lead} ${url} #Dogecoin #DOGE` };
  }

  async function walletShareQrFile() {
    try {
      const { values } = walletShareContent();
      const uri = dogeUri(values.address, 0, values.message);
      const dataUri = await qrDataUri(uri);
      const blob = await (await fetch(dataUri)).blob();
      return new File([blob], "doge-wallet-qr.png", { type: blob.type || "image/png" });
    } catch {
      return null;
    }
  }

  function loadImage(src, timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const timer = setTimeout(() => reject(new Error("image load timeout")), timeoutMs);
      img.decoding = "async";
      img.onload = () => {
        clearTimeout(timer);
        resolve(img);
      };
      img.onerror = () => {
        clearTimeout(timer);
        reject(new Error("image load error"));
      };
      img.src = src;
    });
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function wrapCanvasText(ctx, text, maxWidth, byChar = false) {
    const tokens = byChar ? String(text).split("") : String(text).split(/\s+/).filter(Boolean);
    const joiner = byChar ? "" : " ";
    const lines = [];
    let line = "";
    for (const token of tokens) {
      const test = line ? line + joiner + token : token;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = token;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function truncateCanvasText(ctx, text, maxWidth) {
    let str = String(text);
    if (ctx.measureText(str).width <= maxWidth) return str;
    while (str.length > 1 && ctx.measureText(`${str}…`).width > maxWidth) str = str.slice(0, -1);
    return `${str}…`;
  }

  // Compose the branded wallet card directly on a canvas. DOM-to-image
  // (foreignObject) rasterization is unreliable across browsers for a card this
  // rich, so the shareable card is painted deterministically instead.
  async function walletCardPngBlob() {
    const values = walletShareValues();
    const uri = dogeUri(values.address, 0, values.message);
    let qrImg = null;
    try {
      qrImg = await loadImage(await qrDataUri(uri));
    } catch {
      qrImg = null;
    }
    const W = 1080;
    const H = 1350;
    const pad = 84;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    const font = (weight, size) => `${weight} ${size}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;

    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, "#10283a");
    bg.addColorStop(0.55, "#183545");
    bg.addColorStop(1, "#49380e");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W * 0.86, H * 0.12, 0, W * 0.86, H * 0.12, 520);
    glow.addColorStop(0, "rgba(244,189,42,0.30)");
    glow.addColorStop(1, "rgba(244,189,42,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // Header: Đ badge + business name
    const badgeR = 52;
    const badgeX = pad + badgeR;
    const badgeY = pad + badgeR;
    ctx.beginPath();
    ctx.arc(badgeX, badgeY, badgeR, 0, Math.PI * 2);
    ctx.fillStyle = "#f4bd2a";
    ctx.fill();
    ctx.fillStyle = "#141414";
    ctx.font = font(900, 60);
    ctx.textAlign = "center";
    ctx.fillText("Đ", badgeX, badgeY + 21);
    ctx.textAlign = "left";
    const nameX = badgeX + badgeR + 26;
    ctx.fillStyle = "#ffffff";
    ctx.font = font(800, 44);
    ctx.fillText(truncateCanvasText(ctx, values.name, W - pad - nameX), nameX, badgeY - 2);
    ctx.fillStyle = "#cfe8f7";
    ctx.font = font(600, 24);
    ctx.fillText("Shareable DOGE wallet QR", nameX, badgeY + 32);

    // DOGE READY pill
    let y = pad + 150;
    ctx.font = font(900, 22);
    const pillText = "DOGE READY";
    const pillW = ctx.measureText(pillText).width + 44;
    roundRectPath(ctx, pad, y, pillW, 48, 24);
    ctx.fillStyle = "rgba(244,189,42,0.18)";
    ctx.fill();
    ctx.fillStyle = "#ffd65c";
    ctx.fillText(pillText, pad + 22, y + 32);

    // Headline
    y += 48 + 66;
    ctx.fillStyle = "#ffffff";
    ctx.font = font(900, 76);
    ctx.fillText("Send DOGE here", pad, y);

    // Message (up to 2 lines)
    ctx.fillStyle = "#d7e9f3";
    ctx.font = font(500, 30);
    const msgLines = wrapCanvasText(ctx, values.message, W - pad * 2).slice(0, 2);
    y += 16;
    for (const line of msgLines) {
      y += 42;
      ctx.fillText(line, pad, y);
    }

    // QR in a light rounded card
    const qrBox = 470;
    const qrX = (W - qrBox) / 2;
    const qrY = y + 44;
    roundRectPath(ctx, qrX, qrY, qrBox, qrBox, 28);
    ctx.fillStyle = "#eaf7ff";
    ctx.fill();
    if (qrImg) {
      const inner = qrBox - 56;
      ctx.drawImage(qrImg, qrX + 28, qrY + 28, inner, inner);
    }

    // Public address
    let ay = qrY + qrBox + 58;
    ctx.fillStyle = "#ffd65c";
    ctx.font = font(900, 22);
    ctx.fillText("PUBLIC ADDRESS", pad, ay);
    ctx.font = "600 27px ui-monospace, 'SFMono-Regular', Consolas, monospace";
    const addrLines = wrapCanvasText(ctx, values.address, W - pad * 2 - 40, true);
    const boxH = 20 + addrLines.length * 34 + 8;
    ay += 16;
    roundRectPath(ctx, pad, ay, W - pad * 2, boxH, 14);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fill();
    ctx.fillStyle = "#eaf7ff";
    let ty = ay + 40;
    for (const line of addrLines) {
      ctx.fillText(line, pad + 20, ty);
      ty += 34;
    }

    // Footer: domain + credit
    ctx.fillStyle = "#cfe8f7";
    ctx.font = font(800, 26);
    ctx.fillText(truncateCanvasText(ctx, campaignHost(values.url), (W - pad * 2) * 0.5), pad, H - pad + 6);
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(207,232,243,0.85)";
    ctx.font = font(700, 22);
    ctx.fillText(truncateCanvasText(ctx, values.credit, (W - pad * 2) * 0.5), W - pad, H - pad + 6);
    ctx.textAlign = "left";

    return await new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
  }

  async function buildWalletCardFile() {
    try {
      const blob = await walletCardPngBlob();
      if (blob && blob.size > 0) return new File([blob], "doge-wallet-card.png", { type: "image/png" });
    } catch {
      /* fall back to the plain QR image below */
    }
    return await walletShareQrFile();
  }

  // The card image is regenerated (debounced) whenever the builder changes, so a
  // later share click can attach it while still inside the user gesture.
  function scheduleWalletCardRefresh() {
    walletCardFileCache = null;
    clearTimeout(walletCardRefreshTimer);
    walletCardRefreshTimer = setTimeout(() => {
      buildWalletCardFile()
        .then((file) => {
          walletCardFileCache = file;
        })
        .catch(() => {});
    }, 450);
  }

  function downloadShareFile(file) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name || "doge-wallet-card.png";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 800);
  }

  const WALLET_SHARE_TARGETS = {
    x: {
      label: "X",
      composer: (content) => `https://twitter.com/intent/tweet?text=${encodeURIComponent(content.lead)}&url=${encodeURIComponent(content.url)}&hashtags=Dogecoin,DOGE`,
    },
    instagram: { label: "Instagram", composer: () => "https://www.instagram.com/" },
    tiktok: { label: "TikTok", composer: () => "https://www.tiktok.com/upload" },
  };

  async function shareWalletCard(platform) {
    const target = WALLET_SHARE_TARGETS[platform];
    if (!target) return;
    const content = walletShareContent();
    const cachedFile = walletCardFileCache;
    // Best path: hand the OS share sheet the image so it attaches to the post.
    // Only attempt with a cached file so we stay inside the click's activation.
    if (cachedFile && navigator.canShare && navigator.canShare({ files: [cachedFile] })) {
      try {
        await navigator.share({ files: [cachedFile], text: content.caption });
        return;
      } catch (error) {
        if (error && error.name === "AbortError") return;
      }
    }
    // Desktop fallback: open the composer inside the gesture, then save the card
    // image and copy the caption so the operator can attach it.
    window.open(target.composer(content), "_blank", "noopener");
    const file = cachedFile || (await buildWalletCardFile());
    walletCardFileCache = file;
    downloadShareFile(file);
    copy(content.caption, `Caption copied and your DOGE card image was saved — attach it to your ${target.label} post.`);
  }

  async function nativeShareWallet() {
    const content = walletShareContent();
    const file = walletCardFileCache || (await buildWalletCardFile());
    walletCardFileCache = file;
    const shareData = { title: "My Dogecoin wallet", text: content.caption };
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      shareData.files = [file];
    } else {
      shareData.url = content.url;
    }
    try {
      await navigator.share(shareData);
    } catch {
      /* user dismissed the share sheet */
    }
  }

  function initWalletShareBuilder() {
    const form = $id("walletShareBuilder");
    if (!form) return;
    const addressInput = $id("walletShareAddress");
    const saved = savedWalletShareAddress();
    if (addressInput && saved && (!addressInput.value.trim() || addressInput.value.trim() === donationAddress())) {
      addressInput.value = saved;
    }
    form.querySelectorAll("input").forEach((field) => field.addEventListener("input", updateWalletShareBuilder));
    $id("copyWalletShareSnippet")?.addEventListener("click", () => {
      copy($id("walletShareSnippetCode")?.value, "Wallet card snippet copied.");
    });
    if (navigator.share && $id("walletShareNative")) {
      $id("walletShareNative").hidden = false;
      $id("walletShareNative").addEventListener("click", () => {
        nativeShareWallet();
      });
    }
    $id("walletShareX")?.addEventListener("click", () => shareWalletCard("x"));
    $id("walletShareInstagram")?.addEventListener("click", () => shareWalletCard("instagram"));
    $id("walletShareTikTok")?.addEventListener("click", () => shareWalletCard("tiktok"));
    updateWalletShareBuilder();
  }

  let counterSignRenderId = 0;

  function counterSignValues() {
    const saved = savedWalletShareAddress();
    return {
      name: $id("signBusinessName")?.value.trim() || "DOGE Merchant",
      address: $id("signAddress")?.value.trim() || saved || donationAddress(),
      tagline: $id("signTagline")?.value.trim() || "Scan with any Dogecoin wallet — fast, low fees, no card needed.",
    };
  }

  function counterSignMarkup(values, qrSource) {
    const uri = dogeUri(values.address, 0, `Pay ${values.name} in DOGE`);
    const step = (number, label) => `<span style="display:grid;justify-items:center;gap:7px;min-width:0"><span style="display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:#f4bd2a;color:#102324;font-size:16px;font-weight:900">${number}</span><span style="font-size:12.5px;font-weight:800;line-height:1.25;color:#33403c">${label}</span></span>`;
    return `<div aria-label="Dogecoin accepted here sign" style="box-sizing:border-box;width:100%;max-width:640px;margin:0 auto;overflow:hidden;border:1px solid #d9c47c;border-radius:20px;background:#fff;color:#171715;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;text-align:center;box-shadow:0 24px 60px rgba(16,35,36,.18);-webkit-print-color-adjust:exact;print-color-adjust:exact">
  <div style="position:relative;padding:36px 30px 78px;background:radial-gradient(circle at 82% 14%,rgba(244,189,42,.3),transparent 44%),linear-gradient(135deg,#102324,#123f48 55%,#14201b);color:#fff">
    <span aria-hidden="true" style="display:grid;place-items:center;width:86px;height:86px;margin:0 auto 16px;border-radius:50%;background:#f4bd2a;color:#171715;font-size:54px;font-weight:900;box-shadow:inset 0 0 0 5px rgba(255,255,255,.5),0 12px 30px rgba(0,0,0,.35)">&#272;</span>
    <div style="font-size:14px;font-weight:900;letter-spacing:.42em;text-transform:uppercase;color:#f4bd2a">We proudly accept</div>
    <div style="margin-top:7px;font-size:48px;line-height:1;font-weight:900;letter-spacing:.02em;text-transform:uppercase">Dogecoin</div>
  </div>
  <div style="position:relative;margin:-54px auto 0;width:max-content;max-width:84%;padding:15px;border-radius:18px;border:3px solid #f4bd2a;background:#fff;box-shadow:0 14px 34px rgba(16,35,36,.16)">
    <img src="${escapeHtml(qrSource || qrUrl(uri))}" alt="Dogecoin payment QR code for ${escapeHtml(values.name)}" style="display:block;width:250px;max-width:100%;height:auto;aspect-ratio:1/1">
  </div>
  <div style="padding:20px 34px 26px">
    <div style="font-size:13px;font-weight:900;letter-spacing:.24em;text-transform:uppercase;color:#96690e">Scan to pay &middot; ${escapeHtml(values.name)}</div>
    <div style="display:flex;justify-content:center;gap:26px;margin:20px auto 18px;max-width:460px">
      ${step(1, "Open your<br>DOGE wallet")}
      ${step(2, "Scan<br>this code")}
      ${step(3, "Show staff the<br>confirmation")}
    </div>
    <div style="max-width:440px;margin:0 auto 16px;font-size:14.5px;line-height:1.45;color:#5d625f">${escapeHtml(values.tagline)}</div>
    <code style="display:inline-block;max-width:100%;padding:8px 14px;border-radius:999px;border:1px solid #e6e0c8;background:#faf8ef;font-family:ui-monospace,Consolas,monospace;font-size:12px;overflow-wrap:anywhere">${escapeHtml(values.address)}</code>
  </div>
  <div style="padding:11px 16px;background:#102324;color:rgba(255,255,255,.78);font-size:11.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase">Powered by DOGE Commerce Kit &middot; commerce.dog</div>
</div>`;
  }

  function openPrintWindow(title, bodyHtml) {
    // Hidden-iframe printing: opens the print dialog directly without a
    // pop-up window, so pop-up blockers can never eat the print action.
    document.getElementById("dogePrintFrame")?.remove();
    const frame = document.createElement("iframe");
    frame.id = "dogePrintFrame";
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    doc.open();
    doc.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>@page{size:letter portrait;margin:12mm}body{margin:0;padding:16px;display:grid;justify-items:center;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}@media print{body{padding:0}}</style></head><body>${bodyHtml}</body></html>`);
    doc.close();
    const win = frame.contentWindow;
    win.addEventListener("afterprint", () => setTimeout(() => frame.remove(), 300));
    const printNow = () => {
      win.focus();
      win.print();
    };
    const image = doc.querySelector("img");
    if (image && !image.complete) image.addEventListener("load", printNow);
    else setTimeout(printNow, 150);
  }

  async function updateCounterSignBuilder() {
    const preview = $id("counterSignPreview");
    const code = $id("counterSignCode");
    if (!preview || !code) return;
    const values = counterSignValues();
    const uri = dogeUri(values.address, 0, `Pay ${values.name} in DOGE`);
    const renderId = ++counterSignRenderId;
    preview.innerHTML = counterSignMarkup(values, qrUrl(uri));
    code.value = counterSignMarkup(values, qrUrl(uri));
    const embeddedQr = await qrDataUri(uri);
    if (renderId !== counterSignRenderId) return;
    code.value = counterSignMarkup(values, embeddedQr);
  }

  function initCounterSignBuilder() {
    const form = $id("counterSignBuilder");
    if (!form) return;
    const addressInput = $id("signAddress");
    const saved = savedWalletShareAddress();
    if (addressInput && saved && (!addressInput.value.trim() || addressInput.value.trim() === donationAddress())) {
      addressInput.value = saved;
    }
    form.querySelectorAll("input").forEach((field) => field.addEventListener("input", updateCounterSignBuilder));
    $id("printCounterSign")?.addEventListener("click", async () => {
      const values = counterSignValues();
      const uri = dogeUri(values.address, 0, `Pay ${values.name} in DOGE`);
      const embeddedQr = await qrDataUri(uri);
      openPrintWindow(`Dogecoin accepted — ${values.name}`, counterSignMarkup(values, embeddedQr));
    });
    $id("copyCounterSign")?.addEventListener("click", () => {
      copy($id("counterSignCode")?.value, "Counter sign HTML copied.");
    });
    updateCounterSignBuilder();
  }

  function cashierCardMarkup(merchant) {
    const step = (number, title, body) => `<li style="display:grid;grid-template-columns:34px minmax(0,1fr);gap:10px;align-items:start"><span style="display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:#f4bd2a;color:#171715;font-weight:900">${number}</span><span style="display:grid;gap:2px"><strong style="font-size:15px">${escapeHtml(title)}</strong><span style="font-size:13px;line-height:1.4;color:#444">${escapeHtml(body)}</span></span></li>`;
    return `<div aria-label="Dogecoin cashier quick card" style="box-sizing:border-box;display:grid;gap:14px;width:100%;max-width:560px;margin:0 auto;padding:26px 28px;border:3px dashed #96690e;border-radius:16px;background:#fffdf5;color:#171715;font-family:system-ui,-apple-system,'Segoe UI',sans-serif">
  <div style="display:flex;align-items:center;gap:10px">
    <span aria-hidden="true" style="display:grid;place-items:center;width:40px;height:40px;border-radius:50%;background:#f4bd2a;font-size:24px;font-weight:900">&#272;</span>
    <span style="display:grid"><strong style="font-size:19px;line-height:1.1">Dogecoin checkout — staff quick card</strong><span style="font-size:13px;color:#5d625f">${escapeHtml(merchant)}</span></span>
  </div>
  <ol style="display:grid;gap:12px;margin:0;padding:0;list-style:none">
    ${step(1, "Quote in dollars", "Enter the USD amount in the POS Terminal. The DOGE amount and QR update automatically.")}
    ${step(2, "Show the QR", "Tap the QR (or Customer display) so the buyer can scan it with any Dogecoin wallet.")}
    ${step(3, "Verify before handoff", "Wait until the payment shows against our address with the required confirmations. A buyer screenshot is not proof.")}
    ${step(4, "Save the order", "Save the sale in the POS order list so the txid, amount, and memo stay with the record.")}
  </ol>
  <div style="display:grid;gap:6px;padding:12px 14px;border:1px solid #dfe4dd;border-radius:10px;background:#f7f8f2;font-size:13px;line-height:1.5">
    <strong>Our rules (fill in before the first sale)</strong>
    <span>Confirmations required: ______ &nbsp;&middot;&nbsp; Quote window: ______ minutes</span>
    <span>Underpaid or overpaid: ______________________________________</span>
    <span>Escalate to: ______________________________________</span>
  </div>
  <span style="font-size:11px;font-weight:700;color:#8a8f8a;text-align:center">Powered by DOGE Commerce Kit &middot; commerce.dog</span>
</div>`;
  }

  function initCashierCard() {
    const button = $id("printCashierCard");
    if (!button) return;
    button.addEventListener("click", () => {
      const merchant = (localStorage.getItem("doge-pos:merchant") || "").trim() || "Any register, any staff member";
      openPrintWindow("Dogecoin cashier quick card", cashierCardMarkup(merchant));
    });
  }

  function dogeAmountText(amount, maximumFractionDigits = 4) {
    const value = Number(amount || 0);
    if (!Number.isFinite(value) || value <= 0) return "0";
    return value.toLocaleString("en-US", {
      minimumFractionDigits: value < 1 ? 4 : 0,
      maximumFractionDigits,
    });
  }

  function integrationState() {
    const siteName = $id("integrationSiteName")?.value.trim() || "DOGE Merchant";
    const address = $id("integrationAddress")?.value.trim() || donationAddress();
    const offer = $id("integrationOffer")?.value.trim() || "DOGE checkout";
    const usd = Number($id("integrationUsd")?.value || 0);
    const memo = $id("integrationMemo")?.value.trim() || "Website DOGE order";
    const buttonText = $id("integrationButtonText")?.value.trim() || "Pay with DOGE";
    const doge = dogeUsd > 0 && usd > 0 ? usd / dogeUsd : 0;
    const uri = dogeUri(address, doge, memo);
    return { siteName, address, offer, usd, memo, buttonText, doge, uri };
  }

  function integrationManifest(state) {
    return {
      "@context": "https://schema.org",
      "@type": "Store",
      name: state.siteName,
      description: `${state.siteName} accepts Dogecoin for ${state.offer}.`,
      paymentAccepted: ["Dogecoin", "DOGE"],
      currenciesAccepted: ["DOGE", "USD"],
      dogecoin: {
        address: state.address,
        payment_uri: state.uri,
        offer: state.offer,
        quoted_usd: Number(state.usd || 0).toFixed(2),
        quoted_doge: Number(state.doge || 0).toFixed(8),
        confirmation_policy: "Verify the receiving address, amount, transaction ID, and required confirmations before fulfillment.",
      },
    };
  }

  function checkoutIntegrationSnippet(state, qrSource) {
    return `<a href="${escapeHtml(state.uri)}" style="display:grid;grid-template-columns:minmax(0,1fr) 96px;gap:14px;align-items:center;width:min(100%,420px);padding:14px 15px;border:2px solid #f4bd2a;border-radius:10px;background:linear-gradient(135deg,#171715,#203c42 60%,#4b390d);color:#fff;text-decoration:none;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 14px 32px rgba(23,23,21,.18)">
  <span style="display:grid;gap:8px;min-width:0">
    <span style="display:inline-flex;align-items:center;gap:9px;width:max-content;max-width:100%;padding:6px 10px 6px 6px;border:1px solid rgba(244,189,42,.36);border-radius:999px;background:rgba(255,255,255,.08);color:#f4bd2a;font-size:12px;font-weight:900;letter-spacing:.08em;text-transform:uppercase">
      <img src="${escapeHtml(logo())}" alt="" style="width:32px;height:32px;border-radius:50%;background:#f4bd2a">
      ${escapeHtml(state.buttonText)}
    </span>
    <strong style="font-size:22px;line-height:1.05">${escapeHtml(state.offer)}</strong>
    <small style="color:rgba(255,255,255,.76)">${escapeHtml(money.format(state.usd || 0))} / ${escapeHtml(dogeAmountText(state.doge, 4))} DOGE</small>
    <small style="overflow-wrap:anywhere;color:rgba(255,255,255,.62)">${escapeHtml(state.address)}</small>
  </span>
  <img src="${escapeHtml(qrSource)}" alt="Scan to pay with Dogecoin" style="width:96px;height:96px;border-radius:8px;background:#fff;padding:5px">
</a>`;
  }

  function statusIntegrationSnippet(state) {
    return `<section data-doge-payment-status style="display:grid;gap:10px;width:min(100%,420px);padding:16px;border:1px solid #d8ded3;border-radius:10px;background:#fffdf3;color:#171715;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <strong style="font-size:20px">DOGE payment status</strong>
  <span style="color:#55615d">${escapeHtml(state.offer)} - ${escapeHtml(money.format(state.usd || 0))} / ${escapeHtml(dogeAmountText(state.doge, 4))} DOGE</span>
  <ol style="display:grid;gap:8px;margin:0;padding-left:20px">
    <li>Buyer sends DOGE to <code style="overflow-wrap:anywhere">${escapeHtml(state.address)}</code>.</li>
    <li>Staff checks the transaction ID, amount, and receiving address.</li>
    <li>Fulfill after the posted confirmation rule is met.</li>
  </ol>
  <a href="${escapeHtml(state.uri)}" style="display:inline-flex;width:max-content;max-width:100%;padding:10px 12px;border-radius:8px;background:#f4bd2a;color:#171715;font-weight:850;text-decoration:none">${escapeHtml(state.buttonText)}</a>
</section>`;
  }

  function manifestIntegrationSnippet(state) {
    return `<script type="application/ld+json">
${JSON.stringify(integrationManifest(state), null, 2)}
</script>`;
  }

  function metaIntegrationSnippet(state) {
    return `<meta name="dogecoin:accepted" content="true">
<meta name="dogecoin:merchant" content="${escapeHtml(state.siteName)}">
<meta name="dogecoin:address" content="${escapeHtml(state.address)}">
<meta name="dogecoin:payment-uri" content="${escapeHtml(state.uri)}">
<meta name="dogecoin:confirmation-policy" content="Verify transaction ID, address, amount, and confirmations before fulfillment.">
<meta property="og:title" content="${escapeHtml(state.siteName)} accepts Dogecoin">
<meta property="og:description" content="${escapeHtml(state.offer)} can be paid with DOGE using a merchant-controlled wallet.">
<link rel="payment" href="${escapeHtml(state.uri)}" title="Pay with Dogecoin">`;
  }

  function integrationSnippet(state, qrSource) {
    if (integrationSnippetType === "status") return statusIntegrationSnippet(state);
    if (integrationSnippetType === "manifest") return manifestIntegrationSnippet(state);
    if (integrationSnippetType === "meta") return metaIntegrationSnippet(state);
    return checkoutIntegrationSnippet(state, qrSource);
  }

  function integrationPreviewMarkup(state, qrSource) {
    if (integrationSnippetType === "status") {
      return `<div class="integration-status-preview">
        <strong>DOGE payment status</strong>
        <span>${escapeHtml(state.offer)} - ${escapeHtml(money.format(state.usd || 0))} / ${escapeHtml(dogeAmountText(state.doge, 4))} DOGE</span>
        <ol>
          <li>Buyer sends DOGE.</li>
          <li>Staff confirms txid, address, amount, and confirmations.</li>
          <li>Fulfill after the rule passes.</li>
        </ol>
      </div>`;
    }
    if (integrationSnippetType === "manifest") {
      return `<div class="integration-data-preview">
        <span>Merchant manifest</span>
        <strong>${escapeHtml(state.siteName)}</strong>
        <code>${escapeHtml(state.address)}</code>
        <small>JSON-LD declares DOGE payments, quote fields, and confirmation policy.</small>
      </div>`;
    }
    if (integrationSnippetType === "meta") {
      return `<div class="integration-data-preview">
        <span>SEO metadata</span>
        <strong>${escapeHtml(state.siteName)} accepts Dogecoin</strong>
        <code>${escapeHtml(state.uri)}</code>
        <small>Meta tags make DOGE acceptance easier for crawlers and AI assistants to identify.</small>
      </div>`;
    }
    return checkoutIntegrationSnippet(state, qrSource);
  }

  async function updateIntegrationHelper() {
    if (!$id("integrationHelperBuilder")) return;
    const state = integrationState();
    const renderId = ++integrationRenderId;
    if ($id("integrationPreview")) $id("integrationPreview").innerHTML = `<div class="integration-data-preview"><span>Building snippet</span><strong>${escapeHtml(state.offer)}</strong><small>Generating a self-contained QR asset...</small></div>`;
    if ($id("integrationSnippetOut")) $id("integrationSnippetOut").value = "Generating website integration snippet...";
    const qrSource = await qrDataUri(state.uri);
    if (renderId !== integrationRenderId) return;
    const snippet = integrationSnippet(state, qrSource);
    if ($id("integrationPreview")) $id("integrationPreview").innerHTML = integrationPreviewMarkup(state, qrSource);
    if ($id("integrationSnippetOut")) $id("integrationSnippetOut").value = snippet;
  }

  function initIntegrationHelper() {
    if (!$id("integrationHelperBuilder")) return;
    document.querySelectorAll("#integrationHelperBuilder input").forEach((field) => {
      field.addEventListener("input", updateIntegrationHelper);
    });
    document.querySelectorAll("[data-integration-snippet]").forEach((button) => {
      button.addEventListener("click", () => {
        integrationSnippetType = button.dataset.integrationSnippet || "checkout";
        document.querySelectorAll("[data-integration-snippet]").forEach((tab) => {
          tab.classList.toggle("is-active", tab === button);
        });
        updateIntegrationHelper();
      });
    });
    $id("copyIntegrationSnippet")?.addEventListener("click", () => copy($id("integrationSnippetOut")?.value, "Website integration snippet copied."));
    $id("copyIntegrationJson")?.addEventListener("click", () => copy(JSON.stringify(integrationManifest(integrationState()), null, 2), "DOGE integration JSON copied."));
    fetchDogePrice().finally(updateIntegrationHelper);
  }

  function posMemoSuggestionValues() {
    const contexts = [
      "Cafe counter",
      "Food truck",
      "Farmers market",
      "Retail pickup",
      "Restaurant table",
      "Bakery preorder",
      "Salon service",
      "Barber appointment",
      "Tattoo deposit",
      "Repair shop",
      "Auto detail",
      "Bike repair",
      "Freelance invoice",
      "Consulting call",
      "Tutor session",
      "Gym drop-in",
      "Yoga class",
      "Workshop seat",
      "Event booth",
      "Club dues",
      "Donation jar",
      "Mutual aid",
      "Community class",
      "Creator merch",
      "Digital download",
      "Music merch",
      "Art print",
      "Pop-up shop",
      "Curbside order",
      "Delivery tip",
      "Subscription refill",
      "Gift card",
      "Loyalty reward",
      "Office lunch",
      "Snack shelf",
      "Campus club",
      "Makerspace access",
      "Local service",
      "Vendor table",
      "Fundraiser pass",
    ];
    const intents = [
      "DOGE sale",
      "pickup order",
      "counter payment",
      "tip payment",
      "deposit",
      "balance due",
      "invoice payment",
      "rush fee",
      "delivery fee",
      "table split",
      "group order",
      "refill credit",
      "membership renewal",
      "class pass",
      "event ticket",
      "raffle entry",
      "booth fee",
      "donation",
      "sponsor gift",
      "prepaid tab",
      "gift card load",
      "upgrade add-on",
      "repair intake",
      "reservation hold",
      "thank-you payment",
    ];
    return contexts.flatMap((context) => intents.map((intent) => `${context} - ${intent}`));
  }

  const POS_MEMO_HISTORY_KEY = "doge-pos:memos";
  const POS_MEMO_HISTORY_LIMIT = 15;

  function savedPosMemos() {
    try {
      const raw = JSON.parse(localStorage.getItem(POS_MEMO_HISTORY_KEY) || "[]");
      if (!Array.isArray(raw)) return [];
      return raw.filter((memo) => typeof memo === "string" && memo.trim());
    } catch {
      return [];
    }
  }

  // Remember a memo the operator actually used so it can be reoffered in the
  // typeahead — no retyping the same note every sale.
  function recordPosMemo(memo) {
    const value = String(memo || "").trim();
    if (!value) return;
    const existing = savedPosMemos().filter((item) => item.toLowerCase() !== value.toLowerCase());
    const next = [value, ...existing].slice(0, POS_MEMO_HISTORY_LIMIT);
    localStorage.setItem(POS_MEMO_HISTORY_KEY, JSON.stringify(next));
    rebuildPosMemoTypeahead();
  }

  function rebuildPosMemoTypeahead() {
    const list = $id("posMemoSuggestions");
    if (!list) return;
    list.innerHTML = "";
    const fragment = document.createDocumentFragment();
    const seen = new Set();
    const add = (memo, label) => {
      const value = String(memo || "").trim();
      if (!value || seen.has(value.toLowerCase())) return;
      seen.add(value.toLowerCase());
      const option = document.createElement("option");
      option.value = value;
      if (label) option.label = label;
      fragment.appendChild(option);
    };
    // Operator's own recent memos first so they surface at the top of the list.
    savedPosMemos().forEach((memo) => add(memo, "Recently used"));
    posMemoSuggestionValues().forEach((memo) => add(memo));
    list.appendChild(fragment);
    list.dataset.loaded = "true";
  }

  function initPosMemoTypeahead() {
    rebuildPosMemoTypeahead();
  }

  function savedWalletAddress() {
    return (localStorage.getItem("doge-wallet:address") || "").trim();
  }

  function savedPosWalletAddress() {
    const value = (localStorage.getItem("doge-pos:wallet") || "").trim();
    if (!savedWalletAddress() && value === donationAddress()) return "";
    return value;
  }

  function browserSavedPosWallet() {
    return savedWalletAddress() || savedPosWalletAddress();
  }

  function browserSavedPosWalletSource() {
    if (savedWalletAddress()) return "saved browser wallet";
    if (savedPosWalletAddress()) return "POS browser storage";
    return "";
  }

  // Auto fee buffer: one typical 1-input/2-output Dogecoin transaction
  // (~226 bytes) at the same 1000 atoms/byte rate the Wallet send form uses,
  // plus a tiny fixed cushion for fee variation.
  const DOGE_ATOMS_PER_DOGE = 1e8;
  const POS_AUTO_FEE_TX_BYTES = 226;
  const POS_AUTO_FEE_ATOMS_PER_BYTE = 1000;
  const POS_AUTO_FEE_SAFETY_ATOMS = 10_000;
  // Customer-facing POS amounts use four decimal places. Freeze the quote on
  // that same boundary so manual entry can never be lower than the QR amount.
  const POS_CUSTOMER_AMOUNT_QUANTUM_ATOMS = 10_000;

  function posAutoFeeAtoms() {
    return (POS_AUTO_FEE_TX_BYTES * POS_AUTO_FEE_ATOMS_PER_BYTE) + POS_AUTO_FEE_SAFETY_ATOMS;
  }

  function posAutoFeeDoge() {
    return posAutoFeeAtoms() / DOGE_ATOMS_PER_DOGE;
  }

  function posDogeAtomsRoundedUp(value) {
    const scaled = positiveNumber(value) * DOGE_ATOMS_PER_DOGE;
    // Remove only multiplication noise near an exact atom; a real fractional
    // atom still rounds upward so the quote never understates the conversion.
    const floatingPointSlack = Math.max(1, Math.abs(scaled)) * Number.EPSILON * 4;
    return Math.max(0, Math.ceil(scaled - floatingPointSlack));
  }

  function posPaymentAmountBreakdown(baseDoge, requestedFeeDoge) {
    const baseAtoms = posDogeAtomsRoundedUp(baseDoge);
    const requestedFeeAtoms = posDogeAtomsRoundedUp(requestedFeeDoge);
    const unalignedTotalAtoms = baseAtoms + requestedFeeAtoms;
    const totalAtoms = Math.ceil(unalignedTotalAtoms / POS_CUSTOMER_AMOUNT_QUANTUM_ATOMS)
      * POS_CUSTOMER_AMOUNT_QUANTUM_ATOMS;
    return {
      base_doge: baseAtoms / DOGE_ATOMS_PER_DOGE,
      // Include the final upward alignment in the recorded fee so every
      // receipt and export reconciles exactly to the frozen payment total.
      fee_doge: (totalAtoms - baseAtoms) / DOGE_ATOMS_PER_DOGE,
      doge: totalAtoms / DOGE_ATOMS_PER_DOGE,
    };
  }

  function posState() {
    limitDecimalInput($id("posUsd"), 2);
    // The manual fee control was removed for simplicity, so the request always
    // includes the auto network-fee estimate. If a legacy fee input is present
    // it is still respected.
    const feeInput = $id("posFeeDoge");
    return {
      merchant: $id("posMerchant")?.value.trim() || "DOGE Merchant",
      wallet: $id("posWallet")?.value.trim() || "",
      usd: positiveNumber($id("posUsd")?.value || 0),
      fee_doge: feeInput ? positiveNumber(feeInput.value || 0) : posAutoFeeDoge(),
      memo: $id("posMemo")?.value.trim() || "DOGE sale",
    };
  }

  function newPosOrderId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `pos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function buildPosPayment(state = posState()) {
    const rawBaseDoge = dogeUsd > 0 ? positiveNumber(state.usd) / dogeUsd : 0;
    const amounts = posPaymentAmountBreakdown(rawBaseDoge, state.fee_doge);
    const quote = checkoutQuote();
    return {
      ...state,
      ...amounts,
      price_reference_usd: dogeUsd,
      quote_issued_at: quote.issued_at,
      quote_expires_at: quote.expires_at,
      uri: state.wallet ? dogeUri(state.wallet, amounts.doge, state.memo) : "",
    };
  }

  function normalizePosOrder(order, index = 0) {
    const usd = Number(order?.usd || 0);
    const doge = Number(order?.doge || 0);
    const matchedDoge = Number(order?.matched_doge || 0);
    const feeDoge = Number(order?.fee_doge || 0);
    const baseDoge = Number(order?.base_doge ?? Math.max(0, doge - feeDoge));
    const wallet = order?.wallet || donationAddress();
    const memo = order?.memo || "DOGE sale";
    return {
      id: order?.id || `pos-${Date.now()}-${index}`,
      merchant: order?.merchant || "DOGE Merchant",
      wallet,
      usd: Number.isFinite(usd) ? usd : 0,
      base_doge: Number.isFinite(baseDoge) ? baseDoge : 0,
      fee_doge: Number.isFinite(feeDoge) ? feeDoge : 0,
      doge: Number.isFinite(doge) ? doge : 0,
      matched_doge: Number.isFinite(matchedDoge) ? matchedDoge : 0,
      memo,
      status: order?.status || "unpaid",
      time: order?.time || new Date().toLocaleString(),
      uri: order?.uri || dogeUri(wallet, doge, memo),
      price_reference_usd: Number(order?.price_reference_usd || 0),
      quote_issued_at: order?.quote_issued_at || "",
      quote_expires_at: order?.quote_expires_at || "",
      txid: order?.txid || "",
      confirmations: Number(order?.confirmations || 0),
      min_confirmations: Math.max(0, Number(order?.min_confirmations ?? 1) || 0),
      confirmed_at: order?.confirmed_at || "",
      paid_at: order?.paid_at || "",
      payment_started_at: order?.payment_started_at || "",
      payment_detected_at: order?.payment_detected_at || "",
      cancelled_at: order?.cancelled_at || "",
      baseline_txids: Array.isArray(order?.baseline_txids) ? order.baseline_txids.filter((txid) => isRealDogeTxid(txid)).slice(0, 25) : [],
      baseline_ready: order?.baseline_ready === true,
      validation: order?.validation || "",
      validation_source: order?.validation_source || "",
      validation_errors: order?.validation_errors || [],
      near_match: order?.near_match === true,
      near_match_difference: Number(order?.near_match_difference || 0),
      near_match_approved: order?.near_match_approved === true,
    };
  }

  function posOrders() {
    try {
      const parsed = JSON.parse(localStorage.getItem("doge-pos:orders") || "[]");
      const normalized = Array.isArray(parsed) ? parsed.map(normalizePosOrder) : [];
      if (JSON.stringify(parsed) !== JSON.stringify(normalized)) savePosOrders(normalized);
      return normalized;
    } catch {
      return [];
    }
  }

  function savePosOrders(orders) {
    localStorage.setItem("doge-pos:orders", JSON.stringify(orders));
  }

  function posOrderPageSize() {
    const selectValue = Number($id("posOrderPageSize")?.value || localStorage.getItem("doge-pos:page-size") || 10);
    return POS_PAGE_SIZES.includes(selectValue) ? selectValue : 10;
  }

  function setPosOrderPageSize(value) {
    const pageSize = POS_PAGE_SIZES.includes(Number(value)) ? Number(value) : 10;
    localStorage.setItem("doge-pos:page-size", String(pageSize));
    if ($id("posOrderPageSize")) $id("posOrderPageSize").value = String(pageSize);
    posOrderPage = 1;
  }

  function posOrderPageCount(orders = posOrders()) {
    return Math.max(1, Math.ceil(orders.length / posOrderPageSize()));
  }

  function clampPosOrderPage(orders = posOrders()) {
    const totalPages = posOrderPageCount(orders);
    posOrderPage = Math.min(Math.max(1, posOrderPage), totalPages);
    return totalPages;
  }

  function posOrderPageOrders(orders = posOrders()) {
    clampPosOrderPage(orders);
    const size = posOrderPageSize();
    return orders.slice((posOrderPage - 1) * size, posOrderPage * size);
  }

  function setPosOrderPageForOrder(orders, orderId) {
    const index = orders.findIndex((order) => order.id === orderId);
    posOrderPage = index >= 0 ? Math.floor(index / posOrderPageSize()) + 1 : 1;
  }

  function selectedPosOrderId() {
    return localStorage.getItem("doge-pos:selected-order") || "";
  }

  function selectedPosOrder() {
    const id = selectedPosOrderId();
    return posOrders().find((order) => order.id === id) || null;
  }

  function isSelectedPosOrder(order) {
    return Boolean(order?.id && selectedPosOrderId() === order.id);
  }

  function explorerUrl(txid, address) {
    if (txid && !["manual-register-check", "sample-local-test"].includes(txid)) {
      return `https://blockchair.com/dogecoin/transaction/${encodeURIComponent(txid)}`;
    }
    if (address) return `https://blockchair.com/dogecoin/address/${encodeURIComponent(address)}`;
    return "https://blockchair.com/dogecoin";
  }

  function isRealDogeTxid(txid) {
    return /^[0-9a-f]{64}$/i.test(String(txid || "").trim());
  }

  function setPosConfirmNote(message) {
    if ($id("posConfirmNote")) $id("posConfirmNote").textContent = message;
    if ($id("posFlowNotice")) {
      $id("posFlowNotice").textContent = message;
      $id("posFlowNotice").hidden = !String(message || "").trim();
    }
    if ($id("posHistoryNotice")) {
      $id("posHistoryNotice").textContent = message;
      $id("posHistoryNotice").hidden = !String(message || "").trim();
    }
  }

  function posMarkPaidReason(order) {
    if (!order) return "Load or save an order before marking it paid.";
    if (order.status === "confirmed") return "Transaction confirmed. Click to mark this order paid.";
    if (order.status === "paid") return "This order is already marked paid.";
    if (order.status === "needs review") {
      const errors = Array.isArray(order.validation_errors) && order.validation_errors.length
        ? ` ${order.validation_errors.join(" ")}`
        : "";
      return `Needs review before marking paid.${errors}`;
    }
    if (order.status === "unpaid") return "Confirm the transaction before marking this order paid.";
    return `Mark paid is unavailable while this order is ${order.status || "not confirmed"}.`;
  }

  function updatePosMarkPaidButton(order) {
    const button = $id("posMarkPaid");
    const hint = $id("posMarkPaidHint");
    if (!button && !hint) return;
    const enabled = Boolean(order && order.status === "confirmed");
    const reason = posMarkPaidReason(order);
    if (button) {
      button.disabled = !enabled;
      button.title = reason;
      button.setAttribute("aria-label", `Mark paid. ${reason}`);
    }
    if (hint) {
      hint.title = reason;
      hint.setAttribute("aria-label", reason);
    }
  }

  function updatePosBlockchainAddressLink(address = posState().wallet) {
    const link = $id("posBlockchainAddressLink");
    if (!link) return;
    const wallet = String(address || "").trim();
    link.href = explorerUrl("", wallet);
    link.textContent = wallet
      ? "Click here to view the Dogecoin blockchain for this wallet"
      : "Click here to view the Dogecoin blockchain";
    link.title = wallet
      ? `View Dogecoin blockchain activity for ${wallet}`
      : "View the Dogecoin blockchain";
  }

  function posStatusState(text) {
    const value = String(text || "").trim().toLowerCase();
    if (value.includes("paid") && !value.includes("unpaid")) return "paid";
    if (value.includes("confirm")) return "confirmed";
    if (value.includes("pending") || value.includes("detected") || value.includes("review")) return "pending";
    return "unpaid";
  }

  function setPosStatusDisplay(text) {
    const state = posStatusState(text);
    const status = $id("posStatus");
    if (status) {
      status.textContent = text;
      status.dataset.state = state;
    }
    const displayStatus = $id("posDisplayStatus");
    if (displayStatus) {
      displayStatus.dataset.state = state;
      displayStatus.textContent = state === "paid"
        ? "Payment received — thank you!"
        : state === "confirmed"
          ? "Payment confirmed"
          : state === "pending"
            ? "Payment detected — verifying"
            : "Awaiting payment";
    }
  }

  function posWorkflowStageForOrder(order) {
    if (!order) return 1;
    if (order.status === "cancelled") return 1;
    if (["paid", "confirmed", "pending", "needs review"].includes(order.status)) return 3;
    if (order.status === "unpaid" && order.payment_started_at) return 2;
    return 1;
  }

  function startedPosOrder(order = selectedPosOrder()) {
    return order?.payment_started_at && order.status !== "cancelled" ? order : null;
  }

  function activePosOrder(order = selectedPosOrder()) {
    return startedPosOrder(order) && order.status !== "paid" ? order : null;
  }

  function posPaymentWasDetected(order = selectedPosOrder()) {
    return Boolean(order && (
      order.payment_detected_at
      || order.status === "confirmed"
      || order.status === "paid"
    ));
  }

  function setPosSaleLocked(locked) {
    ["posUsd", "posMemo", "posMerchant", "posWallet", "posUseWallet", "posGenerateWallet"].forEach((id) => {
      const field = $id(id);
      if (field) field.disabled = Boolean(locked);
    });
    document.querySelectorAll("[data-pos-amount]").forEach((button) => {
      button.disabled = Boolean(locked);
    });
  }

  function resetPosStartButton() {
    const button = $id("posStartPayment");
    if (button) button.textContent = "Start payment";
  }

  function isPosNearMatchApprovalCandidate(order) {
    const difference = Number(order?.near_match_difference || 0);
    const errors = Array.isArray(order?.validation_errors) ? order.validation_errors : [];
    const hasUnsafeError = errors.some((error) => !/amount|expected doge|fewer confirmations/i.test(String(error)));
    return Boolean(
      order?.status === "needs review"
      && order.near_match
      && order.validation === "near amount match requires confirmation"
      && isRealDogeTxid(order.txid)
      && Number(order.matched_doge || 0) > 0
      && difference > POS_AUTO_VERIFY_TOLERANCE_DOGE
      && difference <= POS_NEAR_MATCH_MARGIN_DOGE
      && !hasUnsafeError
    );
  }

  function canApprovePosNearMatch(order) {
    const required = Math.max(0, Number(order?.min_confirmations ?? 1) || 0);
    return isPosNearMatchApprovalCandidate(order) && Number(order?.confirmations || 0) >= required;
  }

  function updatePosReviewDetails(order) {
    const expected = Number(order?.doge || 0);
    const received = Number(order?.matched_doge || 0);
    const difference = Number(order?.near_match_difference || (received > 0 ? Math.abs(received - expected) : 0));
    if ($id("posReviewExpected")) $id("posReviewExpected").textContent = expected > 0 ? `${expected.toFixed(8)} DOGE` : "Not available";
    if ($id("posReviewReceived")) $id("posReviewReceived").textContent = received > 0 ? `${received.toFixed(8)} DOGE` : "Not available";
    if ($id("posReviewDifference")) $id("posReviewDifference").textContent = difference > 0 ? `${difference.toFixed(8)} DOGE` : "Exact or unavailable";
    if ($id("posReviewConfirmations")) {
      const required = Math.max(0, Number(order?.min_confirmations ?? 1) || 0);
      $id("posReviewConfirmations").textContent = `${Math.max(0, Number(order?.confirmations || 0))} seen / ${required} required`;
    }
    const reason = $id("posReviewReason");
    if (reason) {
      const errors = Array.isArray(order?.validation_errors) ? order.validation_errors.filter(Boolean) : [];
      reason.textContent = errors.join(" ") || (order?.near_match ? "The amount is close to this sale but is not an exact match." : "No additional verification issue was reported.");
      reason.hidden = !order || (!errors.length && !order.near_match);
    }
  }

  function syncPosManualReviewDisclosure(order = selectedPosOrder()) {
    const manual = $id("posManualDetails");
    if (!manual) return;
    const visible = Boolean(startedPosOrder(order) && posManualReviewVisible);
    manual.hidden = !visible;
    if (!visible && manual.open) manual.open = false;
    if ($id("posReviewPayment")) $id("posReviewPayment").setAttribute("aria-expanded", String(visible && manual.open));
  }

  function setPosVerificationCopy(order) {
    const title = $id("posVerifyTitle");
    const subtitle = $id("posVerifySubtitle");
    if (!title || !subtitle) return;
    if (order?.status === "paid") {
      title.textContent = "Payment verified";
      subtitle.textContent = "The address, amount, and confirmation requirement passed. The receipt is ready.";
      return;
    }
    if (order?.status === "confirmed") {
      title.textContent = "Manual verification complete";
      subtitle.textContent = "Review the sale, then mark it paid to issue the receipt.";
      return;
    }
    if (order?.status === "needs review") {
      title.textContent = order.near_match ? "Is this the customer's payment?" : "Review this payment";
      subtitle.textContent = order.near_match
        ? "The amount is close to this sale. Approve it or review the payment details."
        : "One or more checks need attention. Review the details before continuing.";
      return;
    }
    if (!activePosOrder(order) || order.status === "unpaid") {
      title.textContent = activePosOrder(order) ? "Waiting for payment" : "Start a payment first";
      subtitle.textContent = activePosOrder(order)
        ? "Automatic detection is running. You can return to the customer QR at any time."
        : "Set the sale amount and start the payment to activate verification.";
      return;
    }
    title.textContent = "Payment detected";
    const confirmations = Number(order?.confirmations || 0);
    subtitle.textContent = confirmations > 0
      ? `Seen with ${confirmations} confirmation${confirmations === 1 ? "" : "s"}. Completing validation now.`
      : "Broadcast detected with 0 confirmations. Validation continues automatically in this step.";
  }

  function syncPosStageControls(order = selectedPosOrder(), viewedStage = Number($id("posWorkflow")?.dataset.posStage || 1)) {
    const startedOrder = startedPosOrder(order);
    const activeOrder = activePosOrder(order);
    const lifecycleStage = posWorkflowStageForOrder(order);
    const paymentDetected = posPaymentWasDetected(order);
    const paid = order?.status === "paid";
    const progressCopy = {
      1: activeOrder ? "Quote locked" : "Set amount",
      2: paid ? "Complete" : paymentDetected ? "Payment detected" : startedOrder ? "Waiting" : "Preview",
      3: paid ? "Paid" : order?.status === "needs review" ? "Needs review" : paymentDetected ? "Checking" : startedOrder ? "Waiting for payment" : "Preview",
    };
    document.querySelectorAll("[data-pos-progress]").forEach((item) => {
      const itemStage = Number(item.dataset.posProgress);
      const button = item.querySelector("[data-pos-go]");
      const small = button?.querySelector("small");
      if (small) small.textContent = progressCopy[itemStage];
      if (button) button.disabled = false;
      const complete = itemStage === 1
        ? Boolean(startedOrder)
        : itemStage === 2
          ? paymentDetected
          : paid;
      item.classList.toggle("is-complete", complete && itemStage !== viewedStage);
    });
    setPosSaleLocked(Boolean(activeOrder) || posPaymentStarting);
    if ($id("posChangeWallet")) {
      $id("posChangeWallet").disabled = false;
      $id("posChangeWallet").textContent = posPaymentStarting ? "Preparing sale" : activeOrder ? "Review locked sale" : "Change";
    }
    if ($id("posSaleLockNote")) $id("posSaleLockNote").hidden = !activeOrder;
    if (startedOrder && $id("posStartPayment")?.textContent !== "Preparing payment...") {
      $id("posStartPayment").textContent = paid ? "Start new payment" : lifecycleStage >= 3 ? "View verification" : "Return to customer scan";
      $id("posStartPayment").disabled = false;
    }
    if ($id("posStep2Empty")) $id("posStep2Empty").hidden = Boolean(startedOrder);
    if ($id("posStep3Empty")) $id("posStep3Empty").hidden = Boolean(startedOrder);
    syncPosManualReviewDisclosure(order);
    if ($id("posWaitingTitle")) $id("posWaitingTitle").textContent = startedOrder ? "Waiting for the payment" : "Payment not started";
    if ($id("posPaymentClosedMessage")) {
      $id("posPaymentClosedMessage").hidden = !paymentDetected;
      const title = $id("posPaymentClosedMessage").querySelector("strong");
      const copy = $id("posPaymentClosedMessage").querySelector("span");
      if (title) title.textContent = paid ? "Payment complete — this QR is closed" : "Payment detected — do not pay again";
      if (copy) copy.textContent = paid ? "The verified receipt is available in Step 3." : "Continue to verification while confirmations are checked.";
    }
    if ($id("posWaitingCard")) $id("posWaitingCard").hidden = paymentDetected || !startedOrder;
    if ($id("posQrButton")) $id("posQrButton").hidden = paymentDetected || !startedOrder;
    if ($id("posDogeOut")) $id("posDogeOut").hidden = !startedOrder;
    if ($id("posPaymentDetails")) $id("posPaymentDetails").hidden = !startedOrder;
    if ($id("openPosCustomerDisplay")) {
      $id("openPosCustomerDisplay").hidden = paymentDetected || !startedOrder;
      $id("openPosCustomerDisplay").disabled = paymentDetected || !startedOrder;
    }
    if ($id("posSaleOptions")) $id("posSaleOptions").hidden = !activeOrder;
    if ($id("posTroubleDetails")) $id("posTroubleDetails").hidden = !activeOrder || paymentDetected;
    if ($id("posCancelPayment")) $id("posCancelPayment").disabled = !activeOrder;
    if ($id("posAbandonPayment")) $id("posAbandonPayment").hidden = !activeOrder;
    const reviewAvailable = ["pending", "needs review", "confirmed"].includes(order?.status);
    const approvalCandidate = isPosNearMatchApprovalCandidate(order);
    const canApprove = canApprovePosNearMatch(order);
    if ($id("posReviewActions")) $id("posReviewActions").hidden = !reviewAvailable;
    if ($id("posApprovePayment")) {
      $id("posApprovePayment").hidden = !approvalCandidate;
      $id("posApprovePayment").disabled = !canApprove;
      $id("posApprovePayment").title = canApprove
        ? "Recheck and approve this near-match payment"
        : "Waiting for the required blockchain confirmation";
    }
    if ($id("posConfirmTransaction")) $id("posConfirmTransaction").textContent = order?.near_match ? "Approve near-match" : "Verify transaction";
    if ($id("posWorkflow")) $id("posWorkflow").dataset.posLifecycleStage = String(lifecycleStage);
    if (Number($id("posWorkflow")?.dataset.posStage || 1) === 3) setPosVerificationCopy(order);
  }

  function setPosWorkflowStage(stage, order = selectedPosOrder(), { focus = false, scroll = true } = {}) {
    const safeStage = Math.min(3, Math.max(1, Number(stage) || 1));
    const workflow = $id("posWorkflow");
    const previousStage = Number(workflow?.dataset.posStage || 1);
    if (workflow) workflow.dataset.posStage = String(safeStage);
    document.querySelectorAll("[data-pos-panel]").forEach((panel) => {
      // Keep all three checkout stages visible. Navigation now highlights and
      // scrolls to a stage instead of removing the other stages from view.
      panel.hidden = false;
      panel.classList.toggle("is-active", Number(panel.dataset.posPanel) === safeStage);
    });
    document.querySelectorAll("[data-pos-progress]").forEach((item) => {
      const itemStage = Number(item.dataset.posProgress);
      item.classList.toggle("is-active", itemStage === safeStage);
      const button = item.querySelector("[data-pos-go]");
      if (button && itemStage === safeStage) button.setAttribute("aria-current", "step");
      else button?.removeAttribute("aria-current");
    });
    syncPosStageControls(order, safeStage);
    if (safeStage === 3) setPosVerificationCopy(order);
    const panel = document.querySelector(`[data-pos-panel="${safeStage}"]`);
    const mobileWorkflow = window.matchMedia?.("(max-width: 700px)").matches;
    if (scroll && mobileWorkflow && panel && previousStage !== safeStage) {
      window.requestAnimationFrame(() => {
        panel.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
      });
    }
    if (focus) {
      const heading = $id(`posStage${safeStage}Title`);
      heading?.focus({ preventScroll: true });
      if (!mobileWorkflow) heading?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function navigatePosStage(stage, { focus = true } = {}) {
    if (posPaymentStarting) {
      setPosConfirmNote("Preparing the frozen quote and customer QR. This only takes a moment.");
      return;
    }
    const order = selectedPosOrder();
    const target = Math.min(3, Math.max(1, Number(stage) || 1));
    if (target === 1 && order?.status === "paid") {
      beginNewPosSale("Paid sale moved to order history. The terminal is ready for the next customer.");
      return;
    }
    closePosCustomerDisplay();
    setPosWorkflowStage(target, order, { focus });
    if (target > 1 && !startedPosOrder(order)) {
      setPosConfirmNote("Previewing this step. Set the amount in Step 1 and start payment when you are ready.");
    }
  }

  function setSelectedPosOrder(order) {
    if (order) {
      localStorage.setItem("doge-pos:selected-order", order.id);
      if ($id("posTxId")) $id("posTxId").value = order.txid || "";
      if ($id("posMinConfirmations")) $id("posMinConfirmations").value = String(Math.max(0, Number(order.min_confirmations ?? 1)));
      setPosStatusDisplay(order.status);
      if ($id("posSelectedOrder")) {
        const feeNote = positiveNumber(order.fee_doge) ? ` including ${Number(order.fee_doge).toFixed(4)} DOGE fee` : "";
        $id("posSelectedOrder").textContent = `${order.time} - ${order.merchant} - ${money.format(order.usd)} / ${Number(order.doge).toFixed(4)} DOGE${feeNote}`;
      }
      updatePosMarkPaidButton(order);
      if ($id("posExplorerLink")) {
        const hasChainTx = isRealDogeTxid(order.txid);
        $id("posExplorerLink").href = explorerUrl(order.txid, order.wallet);
        $id("posExplorerLink").textContent = hasChainTx ? "Open transaction" : "Open address";
      }
      updatePosBlockchainAddressLink(order.wallet);
      updatePosReceiptButton(order);
      updatePosReviewDetails(order);
      syncPosStageControls(order);
      return;
    }
    localStorage.removeItem("doge-pos:selected-order");
    posManualReviewVisible = false;
    if ($id("posTxId")) $id("posTxId").value = "";
    if ($id("posMinConfirmations")) $id("posMinConfirmations").value = "1";
    setPosStatusDisplay("Unpaid");
    if ($id("posSelectedOrder")) $id("posSelectedOrder").textContent = "No local order loaded. Save an order or load one from the table below.";
    updatePosMarkPaidButton(null);
    if ($id("posExplorerLink")) {
      $id("posExplorerLink").href = explorerUrl("", posState().wallet);
      $id("posExplorerLink").textContent = "Open address";
    }
    updatePosBlockchainAddressLink(posState().wallet);
    updatePosReceiptButton(null);
    updatePosReviewDetails(null);
    setPosWorkflowStage(1, null);
  }

  function posOrderDisplayDoge(order) {
    const matchedDoge = positiveNumber(order?.matched_doge);
    return order?.status === "paid" && matchedDoge > 0 ? matchedDoge : positiveNumber(order?.doge);
  }

  function renderPosOrders() {
    const rows = $id("posOrderRows");
    if (!rows) return;
    const orders = posOrders();
    const totalPages = clampPosOrderPage(orders);
    const pageOrders = posOrderPageOrders(orders);
    const selectedId = selectedPosOrderId();
    rows.innerHTML = pageOrders.length
      ? pageOrders.map((order) => {
        const orderId = escapeHtml(order.id);
        const displayDoge = posOrderDisplayDoge(order);
        const isSelected = order.id === selectedId;
        const status = String(order.status || "unpaid");
        const txid = String(order.txid || "");
        const shortTxid = txid.length > 20 ? `${txid.slice(0, 8)}…${txid.slice(-8)}` : txid;
        const receiptActions = order.status === "paid"
          ? `<div class="pos-order-receipt-actions" role="group" aria-label="Receipt actions for order ${orderId}">
              <button class="button small quiet table-button pos-order-receipt-action" type="button" data-pos-receipt-share="${orderId}" aria-haspopup="dialog" aria-controls="posReceiptModal" aria-label="Share rich receipt for order ${orderId}">Share</button>
              <button class="button small quiet table-button pos-order-receipt-action" type="button" data-pos-receipt-print="${orderId}" aria-label="Print or save receipt for order ${orderId}">Print / Save</button>
            </div>`
          : "";
        return `<tr class="pos-order-card ${isSelected ? "order-row-selected" : ""}" data-pos-order-card="${orderId}" data-order-status="${escapeHtml(status)}"${isSelected ? ' aria-current="true"' : ""}>
          <td data-label="Time" headers="posOrderTimeHeader" class="pos-order-time-cell"><span class="pos-order-cell-value">${escapeHtml(order.time)}</span></td>
          <td data-label="Merchant" headers="posOrderMerchantHeader" class="pos-order-merchant-cell"><span class="pos-order-cell-value">${escapeHtml(order.merchant)}</span>${isSelected ? '<span class="pos-order-current-label" aria-hidden="true">Current</span>' : ""}</td>
          <td data-label="USD" headers="posOrderUsdHeader" class="pos-order-amount-cell pos-order-usd-cell"><strong class="pos-order-amount-value">${money.format(order.usd)}</strong></td>
          <td data-label="DOGE" headers="posOrderDogeHeader" class="pos-order-amount-cell pos-order-doge-cell"><strong class="pos-order-amount-value">${displayDoge.toFixed(4)}</strong></td>
          <td data-label="Status" headers="posOrderStatusHeader" class="pos-order-status-cell"><span class="pos-status-pill pos-order-status-pill" data-state="${escapeHtml(status)}">${escapeHtml(status)}</span></td>
          <td data-label="Tx" headers="posOrderTxHeader" class="tx-cell pos-order-tx-cell">${txid ? `<code title="${escapeHtml(txid)}"><span class="pos-order-tx-full">${escapeHtml(txid)}</span><span class="pos-order-tx-short" aria-hidden="true">${escapeHtml(shortTxid)}</span></code>` : '<span class="pos-order-cell-value">Not recorded</span>'}</td>
          <td data-label="Memo" headers="posOrderMemoHeader" class="pos-order-memo-cell"><span class="pos-order-cell-value">${escapeHtml(order.memo)}</span></td>
          <td data-label="Actions" headers="posOrderActionsHeader" class="pos-order-actions-cell">
            <div class="pos-order-actions">
              <div class="pos-order-primary-actions" role="group" aria-label="Order actions for ${orderId}">
                <button class="button small quiet table-button" type="button" data-pos-load="${orderId}" aria-label="Load order ${orderId}">Load</button>
                <button class="button small danger table-button table-delete-button" type="button" data-pos-delete="${orderId}" aria-label="Delete order ${orderId}">Delete</button>
              </div>
              ${receiptActions}
            </div>
          </td>
        </tr>`;
      }).join("")
      : `<tr><td colspan="8">No local POS orders yet.</td></tr>`;
    const start = orders.length ? (posOrderPage - 1) * posOrderPageSize() + 1 : 0;
    const end = Math.min(orders.length, posOrderPage * posOrderPageSize());
    if ($id("posOrderPageStatus")) $id("posOrderPageStatus").textContent = orders.length ? `Showing ${start}-${end} of ${orders.length} local orders.` : "No local POS orders yet.";
    if ($id("posHistoryHint")) $id("posHistoryHint").textContent = orders.length ? `${orders.length} order${orders.length === 1 ? "" : "s"} on this device` : "saved on this device";
    if ($id("posOrderPageInfo")) $id("posOrderPageInfo").textContent = `Page ${posOrderPage} of ${totalPages}`;
    if ($id("posOrderPrev")) $id("posOrderPrev").disabled = posOrderPage <= 1;
    if ($id("posOrderNext")) $id("posOrderNext").disabled = posOrderPage >= totalPages;
  }

  function upsertPosOrder(order, { select = true } = {}) {
    const orders = posOrders();
    const index = orders.findIndex((existing) => existing.id === order.id);
    if (index >= 0) orders[index] = order;
    else orders.unshift(order);
    savePosOrders(orders);
    if (select) {
      setPosOrderPageForOrder(orders, order.id);
      setSelectedPosOrder(order);
    }
    renderPosOrders();
  }

  function createPosOrder() {
    return normalizePosOrder({
      ...buildPosPayment(),
      id: newPosOrderId(),
      status: "unpaid",
      time: new Date().toLocaleString(),
    });
  }

  function loadPosOrder(id) {
    const order = posOrders().find((item) => item.id === id);
    if (!order) return;
    const liveOrder = activePosOrder();
    if (liveOrder && liveOrder.id !== id) {
      setPosConfirmNote("A payment is still being monitored. Finish it or use Edit / restart sale before loading another order.");
      return;
    }
    posManualReviewVisible = false;
    syncPosManualReviewDisclosure(order);
    if ($id("posMerchant")) $id("posMerchant").value = order.merchant;
    if ($id("posWallet")) $id("posWallet").value = order.wallet;
    if ($id("posUsd")) $id("posUsd").value = order.usd.toFixed(2);
    if ($id("posFeeDoge")) $id("posFeeDoge").value = String(positiveNumber(order.fee_doge));
    if ($id("posMemo")) $id("posMemo").value = order.memo;
    setSelectedPosOrder(order);
    if (posWorkflowStageForOrder(order) === 1) resetPosStartButton();
    setPosWorkflowStage(posWorkflowStageForOrder(order), order);
    updatePos();
    renderPosOrders();
    if (order.payment_started_at && !["paid", "cancelled"].includes(order.status)) {
      startPosPaymentPolling(order);
    }
    if (window.dogeAnnounce) window.dogeAnnounce("Local order loaded into sale status.");
  }

  function posDeleteButtonForOrder(orderId) {
    return Array.from(document.querySelectorAll("[data-pos-delete]")).find((button) => button.dataset.posDelete === orderId);
  }

  async function posOrderBlockchainGuard(order) {
    const txid = String(order?.txid || "").trim();
    if (!isRealDogeTxid(txid)) return { exists: false };
    const response = await fetch("/api/transaction/validate/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        txid,
        address: order.wallet,
        doge: 0,
        min_confirmations: 0,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok && payload.txid) return { exists: true, payload };
    const message = payload.error || "";
    if (response.status === 502 && /404|not found/i.test(message)) return { exists: false, payload };
    throw new Error(message || "Could not verify this transaction ID against the blockchain.");
  }

  function armPosDelete(id, note) {
    posDeleteArmed.add(id);
    const button = posDeleteButtonForOrder(id);
    if (button) {
      button.textContent = "Confirm delete";
      button.classList.add("danger-armed");
    }
    setPosConfirmNote(note);
    setTimeout(() => {
      if (!posDeleteArmed.has(id)) return;
      posDeleteArmed.delete(id);
      const staleButton = posDeleteButtonForOrder(id);
      if (staleButton) {
        staleButton.textContent = "Delete";
        staleButton.classList.remove("danger-armed");
      }
    }, 6000);
  }

  async function deletePosOrder(id) {
    const orders = posOrders();
    const order = orders.find((item) => item.id === id);
    if (!order) return;
    if (activePosOrder()?.id === id) {
      setPosConfirmNote("This payment is still being monitored. Finish it or use Edit / restart sale before deleting its local row.");
      return;
    }
    if (posDeleteArmed.has(id)) {
      posDeleteArmed.delete(id);
      const nextOrders = orders.filter((item) => item.id !== id);
      savePosOrders(nextOrders);
      if (selectedPosOrderId() === id) setSelectedPosOrder(null);
      clampPosOrderPage(nextOrders);
      renderPosOrders();
      setPosConfirmNote("Local order deleted.");
      if (window.dogeAnnounce) window.dogeAnnounce("Local POS order deleted.");
      return;
    }
    const txid = String(order.txid || "").trim();
    if (isRealDogeTxid(txid)) {
      const button = posDeleteButtonForOrder(id);
      const originalText = button?.textContent || "Delete";
      if (button) {
        button.disabled = true;
        button.textContent = "Checking";
      }
      try {
        const guard = await posOrderBlockchainGuard(order);
        if (guard.exists) {
          setPosConfirmNote("This order has a Dogecoin transaction ID that exists on-chain, so row delete is blocked. Clear local orders can still wipe the browser order list.");
          if (window.dogeAnnounce) window.dogeAnnounce("On-chain transaction found. Row delete blocked.");
          return;
        }
      } catch (error) {
        setPosConfirmNote(`Delete paused: ${error.message} Clear local orders can still wipe the browser order list.`);
        if (window.dogeAnnounce) window.dogeAnnounce("Could not verify transaction ID. Row delete paused.");
        return;
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = originalText;
        }
      }
      armPosDelete(id, "No on-chain Dogecoin transaction was found for this txid. Click Confirm delete within 6 seconds to remove the local order.");
      return;
    }
    armPosDelete(id, "Click Confirm delete within 6 seconds to remove this local order.");
  }

  function setPosTransactionsStatus(message) {
    if ($id("posTransactionsStatus")) $id("posTransactionsStatus").textContent = message;
  }

  function isPosTransactionPickerOpen() {
    const drawer = $id("posTransactionDrawer");
    return Boolean(drawer && !drawer.hidden);
  }

  function setPosTransactionPickerOpen(open) {
    const drawer = $id("posTransactionDrawer");
    const showButton = $id("posShowTransactions");
    if (drawer) drawer.hidden = !open;
    if (showButton) {
      showButton.setAttribute("aria-expanded", String(open));
      showButton.textContent = open ? "Hide recent activity" : "Show recent activity";
    }
  }

  function resetPosTransactions(message = "Open recent wallet activity to load transactions for this sale.") {
    posTransactionsLoaded = false;
    renderPosTransactions([]);
    setPosTransactionsStatus(message);
  }

  async function openPosTransactionPicker() {
    setPosTransactionPickerOpen(true);
    if (!posTransactionsLoaded) {
      await refreshPosTransactions();
    }
  }

  function closePosTransactionPicker() {
    setPosTransactionPickerOpen(false);
  }

  function formatPosTxTime(value) {
    if (!value) return "time pending";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
  }

  function renderPosTransactions(transactions = []) {
    const list = $id("posTransactionList");
    if (!list) return;
    if (!transactions.length) {
      list.innerHTML = '<p class="note compact-note">No recent incoming wallet transactions found.</p>';
      return;
    }
    list.innerHTML = transactions.map((transaction) => {
      const txid = transaction.txid || "";
      const confirmations = Number(transaction.confirmations || 0);
      const status = transaction.status === "pending" || confirmations <= 0 ? "pending" : "confirmed";
      const pillClass = status === "pending" ? "pending" : "ready";
      const doge = Number(transaction.doge || 0);
      const usd = doge * dogeUsd;
      return `<button class="wallet-activity-item ${status}" type="button"
          data-pos-txid="${escapeHtml(txid)}"
          data-pos-tx-confirmations="${confirmations}"
          title="${escapeHtml(`${compact.format(doge)} DOGE is about ${moneyCents.format(usd)} USD at the current ${money.format(dogeUsd)} DOGE/USD quote.`)}">
          <span>
            <strong>${escapeHtml(transaction.short_txid || `${txid.slice(0, 8)}...${txid.slice(-8)}`)}</strong>
            <small>${escapeHtml(formatPosTxTime(transaction.time))} - ${confirmations} conf</small>
          </span>
          <span class="status-pill ${pillClass}">${status}</span>
          <span class="wallet-activity-amount">
            <b>${compact.format(doge)} DOGE</b>
            <small>${moneyCents.format(usd)} USD</small>
          </span>
        </button>`;
    }).join("");
  }

  async function refreshPosTransactions() {
    const wallet = posState().wallet;
    const button = $id("posRefreshTransactions");
    if (!wallet) {
      setPosTransactionsStatus("Set a merchant Dogecoin wallet on the Wallet page, or paste one here to load wallet activity.");
      renderPosTransactions([]);
      posTransactionsLoaded = true;
      return;
    }
    if (button) button.disabled = true;
    setPosTransactionsStatus("Checking the Dogecoin blockchain for recent incoming payments...");
    try {
      const response = await fetch(`/api/wallet/transactions/?address=${encodeURIComponent(wallet)}&limit=8`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Wallet transaction lookup failed.");
      renderPosTransactions(payload.transactions || []);
      const count = (payload.transactions || []).length;
      const provider = payload.provider_name || "the Dogecoin blockchain";
      const staleLabel = payload.stale ? " cached" : "";
      setPosTransactionsStatus(count ? `${count} recent incoming transaction${count === 1 ? "" : "s"} loaded from${staleLabel} ${provider}.` : "No recent incoming payments found for this address.");
    } catch (error) {
      renderPosTransactions([]);
      setPosTransactionsStatus(error.message || "Wallet transaction lookup failed.");
    } finally {
      posTransactionsLoaded = true;
      if (button) button.disabled = false;
    }
  }

  function loadPosTransaction(txid, confirmations = 0) {
    if (!txid) return;
    const order = selectedPosOrder();
    if (!activePosOrder(order)) {
      setPosConfirmNote("Start a payment before loading a transaction.");
      return;
    }
    if ($id("posTxId")) $id("posTxId").value = txid;
    setPosConfirmNote(`Loaded transaction ${txid.slice(0, 8)}...${txid.slice(-8)}. Validating it against this sale now.`);
    if (window.dogeAnnounce) window.dogeAnnounce("Blockchain transaction loaded into Sale Status.");
    if (isRealDogeTxid(txid)) {
      confirmPosTransaction().catch((error) => setPosConfirmNote(error.message));
    }
    closePosTransactionPicker();
  }

  function csvCell(value) {
    return `"${String(value ?? "").replaceAll('"', '""')}"`;
  }

  function downloadText(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function openPosExportModal(format) {
    const orders = posOrders();
    if (!orders.length) {
      if (window.dogeAnnounce) window.dogeAnnounce("No local orders to export.");
      return;
    }
    pendingPosExportFormat = format;
    const pageOrders = posOrderPageOrders(orders);
    if ($id("posExportPageCount")) $id("posExportPageCount").textContent = `${pageOrders.length} order${pageOrders.length === 1 ? "" : "s"} on page ${posOrderPage}`;
    if ($id("posExportAllCount")) $id("posExportAllCount").textContent = `${orders.length} total order${orders.length === 1 ? "" : "s"}`;
    if ($id("posExportMeta")) $id("posExportMeta").textContent = `Preparing ${format.toUpperCase()} export. Choose current page or all saved pages.`;
    if ($id("posExportModal")) $id("posExportModal").hidden = false;
  }

  function closePosExportModal() {
    if ($id("posExportModal")) $id("posExportModal").hidden = true;
  }

  function posEmailOrderRecord(order) {
    const txid = String(order?.txid || "").trim();
    const realTx = isRealDogeTxid(txid);
    const confirmations = Number(order?.confirmations || 0);
    return Object.freeze({
      id: String(order?.id || ""),
      date: String(order?.paid_at || order?.confirmed_at || order?.time || ""),
      merchant: String(order?.merchant || "DOGE Merchant"),
      memo: String(order?.memo || "DOGE sale"),
      usd: positiveNumber(order?.usd),
      requestedDoge: positiveNumber(order?.doge),
      receivedDoge: realTx ? positiveNumber(order?.matched_doge) : 0,
      status: String(order?.status || "unpaid"),
      confirmations: Number.isFinite(confirmations) ? Math.max(0, confirmations) : 0,
      txid: realTx ? txid : "",
    });
  }

  function setPosEmailOrdersStatus(message = "", state = "") {
    const status = $id("posEmailOrdersStatus");
    if (!status) return;
    status.textContent = message;
    status.hidden = !String(message).trim();
    if (state) status.dataset.state = state;
    else delete status.dataset.state;
  }

  function selectedPosEmailOrdersScope() {
    return document.querySelector('input[name="posEmailOrdersScope"]:checked')?.value === "all" ? "all" : "page";
  }

  function scopedPosEmailOrders() {
    if (!posEmailOrdersSnapshot) return [];
    return selectedPosEmailOrdersScope() === "all" ? posEmailOrdersSnapshot.all : posEmailOrdersSnapshot.page;
  }

  function updatePosEmailOrdersSummary() {
    if (!posEmailOrdersSnapshot) return;
    const scope = selectedPosEmailOrdersScope();
    const count = scopedPosEmailOrders().length;
    if ($id("posEmailOrdersSummary")) {
      $id("posEmailOrdersSummary").textContent = scope === "all"
        ? `${count} saved order${count === 1 ? "" : "s"} will be included.`
        : `${count} order${count === 1 ? "" : "s"} from page ${posEmailOrdersSnapshot.pageNumber} will be included.`;
    }
    setPosEmailOrdersStatus();
  }

  function openPosEmailOrdersModal() {
    const allOrders = posOrders();
    if (!allOrders.length) {
      setPosConfirmNote("There are no local orders to email yet.");
      return;
    }
    const pageOrders = posOrderPageOrders(allOrders);
    const now = new Date();
    posEmailOrdersSnapshot = Object.freeze({
      all: Object.freeze(allOrders.map(posEmailOrderRecord)),
      page: Object.freeze(pageOrders.map(posEmailOrderRecord)),
      pageNumber: posOrderPage,
      generatedAt: now.toLocaleString(),
      dateStamp: now.toISOString().slice(0, 10),
    });
    posEmailOrdersReturnFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : $id("openPosEmailOrders");
    if ($id("posEmailOrdersPageCount")) {
      const count = posEmailOrdersSnapshot.page.length;
      $id("posEmailOrdersPageCount").textContent = `${count} order${count === 1 ? "" : "s"} on page ${posOrderPage}`;
    }
    if ($id("posEmailOrdersAllCount")) {
      const count = posEmailOrdersSnapshot.all.length;
      $id("posEmailOrdersAllCount").textContent = `${count} total order${count === 1 ? "" : "s"}`;
    }
    const pageScope = document.querySelector('input[name="posEmailOrdersScope"][value="page"]');
    if (pageScope) pageScope.checked = true;
    if ($id("posEmailOrdersRecipient")) $id("posEmailOrdersRecipient").value = "";
    updatePosEmailOrdersSummary();
    if ($id("posEmailOrdersModal")) $id("posEmailOrdersModal").hidden = false;
    $id("posEmailOrdersRecipient")?.focus();
  }

  function closePosEmailOrdersModal() {
    const modal = $id("posEmailOrdersModal");
    const wasOpen = Boolean(modal && !modal.hidden);
    const returnFocus = posEmailOrdersReturnFocus?.isConnected
      ? posEmailOrdersReturnFocus
      : $id("openPosEmailOrders");
    if (modal) modal.hidden = true;
    if ($id("posEmailOrdersRecipient")) $id("posEmailOrdersRecipient").value = "";
    posEmailOrdersSnapshot = null;
    posEmailOrdersReturnFocus = null;
    setPosEmailOrdersStatus();
    if (wasOpen && returnFocus?.isConnected) {
      window.requestAnimationFrame(() => returnFocus.focus({ preventScroll: true }));
    }
  }

  function containPosEmailOrdersFocus(event) {
    if (event.key !== "Tab") return;
    const modal = $id("posEmailOrdersModal");
    if (!modal || modal.hidden) return;
    const controls = Array.from(modal.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    )).filter((control) => !control.hidden && control.getClientRects().length > 0);
    if (!controls.length) {
      event.preventDefault();
      return;
    }
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  }

  function posEmailOrdersBundle() {
    if (!posEmailOrdersSnapshot) return null;
    const scope = selectedPosEmailOrdersScope();
    const records = scopedPosEmailOrders();
    if (!records.length) return null;
    const scopeTitle = scope === "all" ? "All saved orders" : `Current page ${posEmailOrdersSnapshot.pageNumber}`;
    const subjectScope = scope === "all" ? "all orders" : `page ${posEmailOrdersSnapshot.pageNumber}`;
    const cleanText = (value) => String(value ?? "").replace(/[\t\r\n]+/g, " ").trim();
    const headerStyle = "box-sizing:border-box;padding:9px 8px;border:1px solid #dfe4dd;background:#f3f5ef;color:#5d625f;font-size:11px;font-weight:800;text-align:left;text-transform:uppercase;vertical-align:top";
    const cellStyle = "box-sizing:border-box;padding:10px 8px;border:1px solid #dfe4dd;color:#171715;font-size:12px;text-align:left;vertical-align:top;overflow-wrap:anywhere;word-break:break-word";
    const rows = records.map((record) => {
      const receivedDiffers = record.receivedDoge > 0
        && Math.abs(record.receivedDoge - record.requestedDoge) > POS_AUTO_VERIFY_TOLERANCE_DOGE;
      const dogeHtml = record.receivedDoge > 0
        ? receivedDiffers
          ? `<span style="display:block;color:#5d625f">Requested ${escapeHtml(record.requestedDoge.toFixed(8))} DOGE</span><strong style="display:block">Received ${escapeHtml(record.receivedDoge.toFixed(8))} DOGE</strong>`
          : `<strong style="display:block">${escapeHtml(record.receivedDoge.toFixed(8))} DOGE</strong>`
        : `<span style="display:block">${escapeHtml(record.requestedDoge.toFixed(8))} DOGE requested</span>`;
      const transactionHtml = record.txid
        ? `<a href="${escapeHtml(explorerUrl(record.txid, ""))}" style="display:block;margin-top:4px;color:#0f8f78;text-decoration:none;overflow-wrap:anywhere" aria-label="Transaction ${escapeHtml(record.txid)}">${escapeHtml(`${record.txid.slice(0, 8)}…${record.txid.slice(-8)}`)}</a>`
        : "";
      return `<tr data-pos-email-order-row>
        <td style="${cellStyle};width:22%"><span style="display:block">${escapeHtml(record.date)}</span><code style="display:block;margin-top:4px;color:#5d625f;font-size:10px;overflow-wrap:anywhere">${escapeHtml(record.id)}</code></td>
        <td style="${cellStyle};width:30%"><strong style="display:block">${escapeHtml(record.merchant)}</strong><span style="display:block;margin-top:4px;color:#5d625f">${escapeHtml(record.memo)}</span></td>
        <td style="${cellStyle};width:24%"><strong style="display:block;font-size:14px">${escapeHtml(moneyCents.format(record.usd))}</strong>${dogeHtml}</td>
        <td style="${cellStyle};width:24%"><strong style="display:block;text-transform:capitalize">${escapeHtml(record.status)}</strong>${record.txid ? `<span style="display:block;margin-top:4px;color:#5d625f">${escapeHtml(String(record.confirmations))} confirmation${record.confirmations === 1 ? "" : "s"}</span>` : ""}${transactionHtml}</td>
      </tr>`;
    }).join("");
    const html = `<div data-pos-order-history-email style="box-sizing:border-box;width:100%;max-width:760px;margin:0 auto;padding:20px;border:1px solid #dfe4dd;border-radius:12px;background:#ffffff;color:#171715;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
      <div style="margin-bottom:14px"><div style="color:#96690e;font-size:11px;font-weight:900;letter-spacing:.10em;text-transform:uppercase">Dogecoin POS</div><div style="font-size:22px;font-weight:900">Order history</div><div style="margin-top:4px;color:#5d625f;font-size:12px">${escapeHtml(scopeTitle)} · ${records.length} order${records.length === 1 ? "" : "s"} · generated ${escapeHtml(posEmailOrdersSnapshot.generatedAt)}</div></div>
      <table data-pos-order-history-table style="box-sizing:border-box;width:100%;max-width:100%;min-width:0;table-layout:fixed;border-collapse:collapse;background:#ffffff">
        <caption style="padding:0;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap">DOGE POS order history</caption>
        <thead><tr><th scope="col" style="${headerStyle};width:22%">Date / Order</th><th scope="col" style="${headerStyle};width:30%">Sale</th><th scope="col" style="${headerStyle};width:24%">Amount</th><th scope="col" style="${headerStyle};width:24%">Status / Transaction</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="margin-top:12px;color:#8a8f88;font-size:11px;text-align:center">Generated locally by commerce.dog</div>
    </div>`;
    const textRows = records.map((record) => [
      cleanText(record.date),
      cleanText(record.id),
      cleanText(record.merchant),
      cleanText(record.memo),
      moneyCents.format(record.usd),
      `${record.requestedDoge.toFixed(8)} DOGE`,
      record.receivedDoge > 0 ? `${record.receivedDoge.toFixed(8)} DOGE` : "",
      cleanText(record.status),
      String(record.confirmations),
      record.txid,
    ].join("\t"));
    const text = [
      "DOGE POS order history",
      `${scopeTitle} | ${records.length} order${records.length === 1 ? "" : "s"} | generated ${posEmailOrdersSnapshot.generatedAt}`,
      "",
      "Date\tOrder ID\tMerchant\tMemo\tUSD\tDOGE requested\tDOGE received\tStatus\tConfirmations\tTransaction",
      ...textRows,
    ].join("\n");
    return Object.freeze({
      html,
      text,
      subject: `DOGE POS orders — ${subjectScope} — ${records.length} order${records.length === 1 ? "" : "s"} — ${posEmailOrdersSnapshot.dateStamp}`,
      count: records.length,
      scope,
    });
  }

  async function copyPosEmailOrdersBundle(bundle) {
    if (!bundle) {
      setPosEmailOrdersStatus("No orders are available for this selection.", "error");
      return false;
    }
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([bundle.html], { type: "text/html" }),
            "text/plain": new Blob([bundle.text], { type: "text/plain" }),
          }),
        ]);
        setPosEmailOrdersStatus("Rich order table copied. Paste it into your email.");
        if (window.dogeAnnounce) window.dogeAnnounce("Rich order table copied.");
        return true;
      }
    } catch {
      /* Fall through to selection-based rich HTML copy. */
    }
    if (legacyCopyPosReceiptRich(bundle.html)) {
      setPosEmailOrdersStatus("Rich order table copied. Paste it into your email.");
      if (window.dogeAnnounce) window.dogeAnnounce("Rich order table copied.");
      return true;
    }
    setPosEmailOrdersStatus("This browser could not copy the formatted table. Use CSV export instead.", "error");
    return false;
  }

  async function openPosEmailOrdersClient() {
    const emailField = $id("posEmailOrdersRecipient");
    const email = (emailField?.value || "").trim();
    if (email && emailField && !emailField.checkValidity()) {
      emailField.reportValidity();
      setPosEmailOrdersStatus("Enter a valid recipient email, or leave it blank.", "error");
      return;
    }
    const bundle = posEmailOrdersBundle();
    const copied = await copyPosEmailOrdersBundle(bundle);
    if (!copied || !bundle) return;
    const link = document.createElement("a");
    link.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(bundle.subject)}`;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setPosEmailOrdersStatus("Table copied. Paste it into the email message, then send.");
    if (window.dogeAnnounce) window.dogeAnnounce("Email app opened. Paste the copied order table into the message.");
  }

  function openPosConversionModal() {
    const modal = $id("posConversionModal");
    if (!modal) return;
    renderDogeConversionChart("pos", posState().usd);
    modal.hidden = false;
  }

  function closePosConversionModal() {
    if ($id("posConversionModal")) $id("posConversionModal").hidden = true;
  }

  function openPosOrdersHelpModal() {
    if ($id("posOrdersHelpModal")) $id("posOrdersHelpModal").hidden = false;
  }

  function closePosOrdersHelpModal() {
    if ($id("posOrdersHelpModal")) $id("posOrdersHelpModal").hidden = true;
  }

  function exportPosOrders(format, scope = "all") {
    const allOrders = posOrders();
    const orders = scope === "page" ? posOrderPageOrders(allOrders) : allOrders;
    if (!orders.length) {
      if (window.dogeAnnounce) window.dogeAnnounce("No local orders to export.");
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const scopeLabel = scope === "page" ? `page-${posOrderPage}` : "all";
    if (format === "json") {
      downloadText(`doge-pos-orders-${scopeLabel}-${stamp}.json`, JSON.stringify(orders, null, 2), "application/json");
      return;
    }
    const fields = ["id", "time", "merchant", "wallet", "usd", "base_doge", "fee_doge", "doge", "matched_doge", "price_reference_usd", "quote_issued_at", "quote_expires_at", "payment_started_at", "payment_detected_at", "status", "memo", "uri", "txid", "confirmations", "min_confirmations", "confirmed_at", "paid_at", "cancelled_at", "validation", "validation_source", "validation_errors"];
    const rows = [
      fields.join(","),
      ...orders.map((order) => fields.map((field) => csvCell(Array.isArray(order[field]) ? order[field].join("; ") : order[field])).join(",")),
    ];
    downloadText(`doge-pos-orders-${scopeLabel}-${stamp}.csv`, rows.join("\n"), "text/csv");
  }

  const POS_AUTO_VERIFY_WINDOW_MS = 60 * 60 * 1000;

  function posTransactionHasPostStartTimestamp(transaction, order) {
    const seenAt = Date.parse(transaction?.time || "");
    const startedAt = Date.parse(order?.payment_started_at || "");
    // With no trusted baseline, only a provider timestamp at or after Start is
    // safe to treat as new. The normal one-minute clock-skew allowance applies
    // only after a real baseline has already excluded older transactions.
    return Number.isFinite(seenAt) && Number.isFinite(startedAt) && seenAt >= startedAt;
  }

  function posTransactionMatchQuality(transaction, order, now = Date.now()) {
    const txid = String(transaction?.txid || "").trim();
    if (!isRealDogeTxid(txid)) return "";
    if ((order?.baseline_txids || []).includes(txid)) return "";
    if (posOrders().some((item) => item.id !== order?.id && item.txid === txid && item.status !== "cancelled")) return "";
    const expected = Number(order?.doge || 0);
    const doge = Number(transaction?.doge || 0);
    if (!(expected > 0) || !Number.isFinite(doge)) return "";
    const difference = Math.abs(doge - expected);
    if (difference > POS_NEAR_MATCH_MARGIN_DOGE) return "";
    const seenAt = Date.parse(transaction?.time || "");
    const startedAt = Date.parse(order?.payment_started_at || "");
    if (Number.isFinite(startedAt) && Number.isFinite(seenAt) && seenAt < startedAt - 60000) return "";
    if (!Number.isFinite(startedAt) && Number.isFinite(seenAt) && now - seenAt > POS_AUTO_VERIFY_WINDOW_MS) return "";
    return difference <= POS_AUTO_VERIFY_TOLERANCE_DOGE ? "exact" : "near";
  }

  function posTransactionMatchesOrder(transaction, order, now = Date.now()) {
    return Boolean(posTransactionMatchQuality(transaction, order, now));
  }

  async function confirmPosTransaction({ automatic = false, orderId = "", expectedToken = posPaymentPollToken, txidOverride = "" } = {}) {
    let order = (orderId ? posOrders().find((item) => item.id === orderId) : null) || selectedPosOrder();
    if (!activePosOrder(order)) {
      setPosConfirmNote("Start a payment before verifying a transaction.");
      return;
    }
    const storedApproval = Boolean(txidOverride);
    const txid = automatic
      ? String(order.txid || "").trim()
      : storedApproval
        ? String(txidOverride).trim()
        : $id("posTxId")?.value.trim() || "";
    const requestedConfirmations = Number(
      automatic || storedApproval
        ? order.min_confirmations
        : $id("posMinConfirmations")?.value || 0,
    );
    const minConfirmations = Number.isFinite(requestedConfirmations) ? Math.max(0, requestedConfirmations) : 0;
    const now = new Date().toLocaleString();
    const selected = () => selectedPosOrderId() === order.id;
    if (!txid || txid === "sample-local-test") {
      stopPosPaymentPolling(order.id);
      order = {
        ...order,
        txid,
        matched_doge: 0,
        confirmations: minConfirmations,
        min_confirmations: minConfirmations,
        status: "confirmed",
        confirmed_at: now,
        validation: txid === "sample-local-test" ? "sample" : "manual",
        validation_source: "",
        validation_errors: [],
        near_match: false,
        near_match_approved: false,
        near_match_difference: 0,
      };
      upsertPosOrder(order);
      if (selected()) setPosConfirmNote(txid === "sample-local-test" ? "Sample transaction check passed for testing." : "Manual register check recorded. Mark paid is now available.");
      return;
    }

    if (!automatic || selected()) setPosConfirmNote("Checking the Dogecoin blockchain for address, amount, and confirmations...");
    try {
      const response = await fetch("/api/transaction/validate/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          txid,
          address: order.wallet,
          doge: order.doge,
          min_confirmations: minConfirmations,
          fresh: true,
        }),
      });
      const payload = await response.json();
      if (automatic && expectedToken !== posPaymentPollToken) return;
      const liveOrder = posOrders().find((item) => item.id === order.id);
      if (!liveOrder || ["paid", "cancelled"].includes(liveOrder.status)) return;
      if (automatic && liveOrder.txid !== txid) return;
      if (automatic && Number(liveOrder.min_confirmations) !== minConfirmations) return;
      if (storedApproval && (!liveOrder.near_match || liveOrder.txid !== txid)) {
        if (selected()) setPosConfirmNote("The detected payment changed. Review it before approving.");
        return;
      }
      if (!automatic && selectedPosOrderId() !== order.id) return;
      order = liveOrder;
      const validationErrors = payload.errors || (payload.error ? [payload.error] : []);
      const confirmationPending = (
        payload.status === "pending"
        || (validationErrors.length > 0
          && validationErrors.every((error) => String(error).toLowerCase().includes("fewer confirmations")))
      );
      if (!response.ok) {
        if (selected()) setPosConfirmNote(`${payload.error || "Transaction lookup failed."} Automatic payment monitoring is still running.`);
        return;
      }
      const matchedDoge = Number(payload.matched_doge || 0);
      const amountDifference = Math.abs(matchedDoge - Number(order.doge || 0));
      const nearMatch = amountDifference > POS_AUTO_VERIFY_TOLERANCE_DOGE && amountDifference <= POS_NEAR_MATCH_MARGIN_DOGE;
      const nonAmountErrors = validationErrors.filter((error) => !/amount|expected doge|expected.*DOGE/i.test(String(error)));
      const nearMatchApproved = nearMatch && !automatic && matchedDoge > 0
        && Number(payload.confirmations || 0) >= minConfirmations
        && nonAmountErrors.length === 0;
      if (nearMatch && !nearMatchApproved) {
        order = {
          ...order,
          txid: payload.txid || txid,
          matched_doge: matchedDoge,
          confirmations: Number(payload.confirmations || 0),
          min_confirmations: minConfirmations,
          status: "needs review",
          near_match: true,
          near_match_difference: amountDifference,
          payment_detected_at: order.payment_detected_at || new Date().toISOString(),
          validation: "near amount match requires confirmation",
          validation_source: payload.source || "",
          validation_errors: validationErrors.length ? validationErrors : [`Transaction amount is ${matchedDoge.toFixed(8)} DOGE; expected ${Number(order.doge).toFixed(8)} DOGE.`],
        };
        upsertPosOrder(order, { select: !automatic || selected() });
        if (selected()) {
          syncPosStageControls(order, 3);
          setPosConfirmNote(`This payment is ${amountDifference.toFixed(8)} DOGE from the sale total. Approve it or review the payment details.`);
        }
        return;
      }
      if (payload.passed && !nearMatch) {
        order = {
          ...order,
          txid: payload.txid || txid,
          matched_doge: matchedDoge,
          confirmations: Number(payload.confirmations || 0),
          min_confirmations: minConfirmations,
          status: "confirmed",
          payment_detected_at: order.payment_detected_at || new Date().toISOString(),
          confirmed_at: now,
          validation: "blockchain",
          validation_source: payload.source || "",
          validation_errors: [],
          near_match: false,
          near_match_difference: 0,
        };
        if (isRealDogeTxid(order.txid)) {
          markPosOrderPaid(order, `Blockchain validation passed and order marked paid: ${payload.matched_doge} DOGE matched with ${payload.confirmations} confirmation(s).`);
          return;
        }
        upsertPosOrder(order, { select: !automatic || selected() });
        setPosConfirmNote(`Blockchain validation passed: ${payload.matched_doge} DOGE matched with ${payload.confirmations} confirmation(s).`);
      } else if (nearMatchApproved) {
        order = {
          ...order,
          txid: payload.txid || txid,
          matched_doge: matchedDoge,
          confirmations: Number(payload.confirmations || 0),
          min_confirmations: minConfirmations,
          status: "confirmed",
          near_match: false,
          near_match_difference: 0,
          payment_detected_at: order.payment_detected_at || new Date().toISOString(),
          confirmed_at: now,
          validation: "blockchain validation accepted within one DOGE by operator",
          validation_source: payload.source || "",
          validation_errors: [],
        };
        markPosOrderPaid(order, `Near-match approved: ${matchedDoge.toFixed(8)} DOGE received versus ${Number(order.doge).toFixed(8)} DOGE expected.`);
        return;
      } else if (confirmationPending) {
        order = {
          ...order,
          txid: payload.txid || txid,
          matched_doge: matchedDoge,
          confirmations: Number(payload.confirmations || 0),
          min_confirmations: minConfirmations,
          status: "pending",
          payment_detected_at: order.payment_detected_at || new Date().toISOString(),
          validation: "blockchain",
          validation_source: payload.source || "",
          validation_errors: validationErrors,
          near_match: false,
          near_match_difference: 0,
        };
        upsertPosOrder(order, { select: !automatic || selected() });
        if (selected()) {
          setPosStatusDisplay("Verification pending");
          setPosVerificationCopy(order);
          setPosConfirmNote(`Payment detected. Waiting for ${minConfirmations || 1} blockchain confirmation${(minConfirmations || 1) === 1 ? "" : "s"}; ${Number(payload.confirmations || 0)} seen so far.`);
        }
      } else {
        order = {
          ...order,
          txid: automatic ? (payload.txid || txid) : order.txid,
          matched_doge: matchedDoge > 0 ? matchedDoge : order.matched_doge,
          confirmations: automatic ? Number(payload.confirmations || 0) : order.confirmations,
          min_confirmations: minConfirmations,
          status: "needs review",
          validation: "blockchain",
          validation_source: payload.source || "",
          validation_errors: validationErrors,
          near_match: false,
          near_match_difference: 0,
        };
        upsertPosOrder(order, { select: !automatic || selected() });
        if (selected()) setPosConfirmNote("This payment did not pass every check. Review the payment details before continuing.");
      }
    } catch (error) {
      if (automatic && expectedToken !== posPaymentPollToken) return;
      if (selected()) setPosConfirmNote(`Transaction lookup failed: ${error.message}. Automatic payment monitoring is still running.`);
    }
  }

  function markPosOrderPaid(order, message = "Order marked paid and ready for fulfillment.") {
    if (!order) return;
    posManualReviewVisible = false;
    const paidOrder = normalizePosOrder({
      ...order,
      status: "paid",
      paid_at: order.paid_at || new Date().toLocaleString(),
    });
    const wasSelected = isSelectedPosOrder(order);
    upsertPosOrder(paidOrder, { select: wasSelected });
    stopPosPaymentPolling(order.id);
    if (!wasSelected) return;
    closePosCustomerDisplay();
    setPosWorkflowStage(3, paidOrder);
    setPosStatusDisplay("paid");
    setPosVerificationCopy(paidOrder);
    setPosConfirmNote(message);
  }

  function markSelectedPosOrderPaid() {
    const order = selectedPosOrder();
    if (!order) {
      setPosConfirmNote("Load or save an order before marking it paid.");
      return;
    }
    if (order.status !== "confirmed") {
      setPosConfirmNote("Confirm the transaction before marking this order paid.");
      return;
    }
    markPosOrderPaid(order);
  }

  // --- Payment receipt (client-side, no backend email) -------------------
  // Once a payment is verified, the operator can hand the customer a receipt:
  // a self-contained rich HTML card they can email (via their own mail app),
  // copy to paste into any email, or print / save as PDF. Nothing is sent
  // through this site and the customer's email is never stored.
  function posReceiptData(order) {
    const usd = positiveNumber(order?.usd);
    const quotedDoge = positiveNumber(order?.doge);
    const txid = String(order?.txid || "").trim();
    const realTx = isRealDogeTxid(txid);
    const matchedDoge = positiveNumber(order?.matched_doge);
    const doge = realTx && matchedDoge > 0 ? matchedDoge : quotedDoge;
    const amountAdjusted = realTx
      && matchedDoge > 0
      && Math.abs(matchedDoge - quotedDoge) > POS_AUTO_VERIFY_TOLERANCE_DOGE;
    const feeDoge = positiveNumber(order?.fee_doge);
    const baseDoge = positiveNumber(order?.base_doge) || Math.max(0, quotedDoge - feeDoge);
    const address = String(order?.wallet || "").trim();
    return {
      orderId: String(order?.id || "").trim(),
      merchant: (order?.merchant || "").trim() || "DOGE Merchant",
      memo: (order?.memo || "").trim() || "DOGE sale",
      usd,
      doge,
      quotedDoge,
      matchedDoge,
      amountAdjusted,
      baseDoge,
      feeDoge,
      txid,
      realTx,
      address,
      paidAt: order?.paid_at || order?.confirmed_at || order?.time || new Date().toLocaleString(),
      status: order?.status === "paid" ? "Paid" : "Confirmed",
      confirmations: Math.max(0, Number(order?.confirmations || 0)),
      explorer: explorerUrl(txid, address),
    };
  }

  function posReceiptRow(label, value, mono = false) {
    const valueStyle = mono
      ? "font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;"
      : "";
    return `<tr data-pos-receipt-row>
      <td data-pos-receipt-label style="box-sizing:border-box;width:38%;padding:7px 8px 7px 0;color:#5d625f;font-size:13px;vertical-align:top;white-space:normal">${escapeHtml(label)}</td>
      <td data-pos-receipt-value style="box-sizing:border-box;width:62%;min-width:0;padding:7px 0 7px 8px;color:#171715;font-size:13px;font-weight:700;text-align:right;overflow-wrap:anywhere;word-break:break-word;${valueStyle}">${value}</td>
    </tr>`;
  }

  function posReceiptHtml(data) {
    const txRow = data.realTx
      ? posReceiptRow("Transaction", `<a href="${escapeHtml(data.explorer)}" aria-label="Transaction ${escapeHtml(data.txid)}" style="color:#0f8f78;text-decoration:none;overflow-wrap:anywhere">${escapeHtml(`${data.txid.slice(0, 10)}…${data.txid.slice(-8)}`)}</a>`)
      : "";
    const feeRow = data.feeDoge > 0 ? posReceiptRow("Network fee", `${escapeHtml(data.feeDoge.toFixed(8))} DOGE`) : "";
    const addrRow = data.address ? posReceiptRow("Receiving address", escapeHtml(data.address), true) : "";
    const orderRow = data.orderId ? posReceiptRow("Order", escapeHtml(data.orderId), true) : "";
    const confirmationRow = data.realTx ? posReceiptRow("Confirmations", escapeHtml(String(data.confirmations))) : "";
    const paymentRows = data.amountAdjusted
      ? `${posReceiptRow("Amount requested", `${escapeHtml(data.quotedDoge.toFixed(8))} DOGE`)}${posReceiptRow("Amount received", `${escapeHtml(data.doge.toFixed(8))} DOGE`)}`
      : posReceiptRow("Total paid", `${escapeHtml(data.doge.toFixed(8))} DOGE`);
    const explorerButton = data.realTx
      ? `<a data-pos-receipt-explorer href="${escapeHtml(data.explorer)}" style="box-sizing:border-box;display:inline-block;max-width:100%;min-height:44px;margin-top:4px;padding:12px 16px;border-radius:8px;background:#f4bd2a;color:#221900;font-weight:800;font-size:13px;line-height:20px;text-align:center;text-decoration:none;white-space:normal;overflow-wrap:anywhere">View on the Dogecoin blockchain</a>`
      : "";
    return `<div data-pos-receipt-card style="box-sizing:border-box;width:100%;max-width:480px;overflow:hidden;margin:0 auto;padding:22px;border:1px solid #dfe4dd;border-radius:14px;background:#ffffff;color:#171715;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;box-shadow:0 14px 34px rgba(23,23,21,.10)">
  <table data-pos-receipt-header role="presentation" style="box-sizing:border-box;width:100%;max-width:100%;min-width:0;table-layout:fixed;border-collapse:collapse;margin-bottom:14px">
    <tr>
      <td style="box-sizing:border-box;width:44px;padding:0 8px 0 0;vertical-align:middle"><span style="display:inline-block;width:36px;height:36px;border-radius:50%;background:#f4bd2a;color:#221900;font-size:23px;font-weight:900;line-height:36px;text-align:center">&#208;</span></td>
      <td data-pos-receipt-merchant style="min-width:0;padding:0 8px 0 0;vertical-align:middle">
        <div style="font-size:11px;font-weight:900;letter-spacing:.10em;text-transform:uppercase;color:#96690e">Dogecoin receipt</div>
        <div style="font-size:19px;font-weight:900;line-height:1.15;overflow-wrap:anywhere">${escapeHtml(data.merchant)}</div>
      </td>
      <td data-pos-receipt-status style="width:78px;padding:0;vertical-align:middle;text-align:right;white-space:nowrap"><span style="display:inline-block;padding:6px 12px;border-radius:999px;background:#e7f7ef;color:#0f8f78;font-size:12px;font-weight:900;letter-spacing:.06em;text-transform:uppercase">${escapeHtml(data.status)}</span></td>
    </tr>
  </table>
  <table data-pos-receipt-summary role="presentation" style="box-sizing:border-box;width:100%;max-width:100%;min-width:0;table-layout:fixed;border-collapse:separate;border-spacing:0;margin-bottom:14px;border:1px solid #e2e6dd;border-radius:12px;background:#fbfcf7">
    <tr><td colspan="2" style="padding:15px 16px 4px;color:#5d625f;font-size:13px">${escapeHtml(data.memo)}</td></tr>
    <tr>
      <td data-pos-receipt-usd style="padding:0 8px 16px 16px;font-size:30px;font-weight:900;line-height:1">${escapeHtml(moneyCents.format(data.usd))}</td>
      <td data-pos-receipt-doge style="width:48%;padding:0 16px 16px 8px;color:#0f8f78;font-size:15px;font-weight:800;text-align:right;vertical-align:bottom;overflow-wrap:anywhere">${escapeHtml(data.doge.toFixed(4))} DOGE</td>
    </tr>
  </table>
  <table data-pos-receipt-details role="presentation" style="box-sizing:border-box;width:100%;max-width:100%;min-width:0;table-layout:fixed;border-collapse:collapse;margin-bottom:14px">
    ${posReceiptRow("Date", escapeHtml(data.paidAt))}
    ${orderRow}
    ${posReceiptRow("Item total", `${escapeHtml(data.baseDoge.toFixed(8))} DOGE`)}
    ${feeRow}
    ${paymentRows}
    ${confirmationRow}
    ${txRow}
    ${addrRow}
  </table>
  ${explorerButton}
  <div style="margin-top:16px;padding-top:12px;border-top:1px solid #eceee7;font-size:12px;color:#8a8f88;text-align:center">
    Paid with Dogecoin · <a href="https://commerce.dog" style="color:#8a8f88;text-decoration:none">commerce.dog</a>
  </div>
</div>`;
  }

  function posReceiptText(data) {
    const lines = [
      `Receipt from ${data.merchant}`,
      `Status: ${data.status}`,
      `Date: ${data.paidAt}`,
      ...(data.orderId ? [`Order: ${data.orderId}`] : []),
      "",
      `Item: ${data.memo}`,
      `Amount: ${moneyCents.format(data.usd)}`,
    ];
    if (data.feeDoge > 0) lines.push(`Includes network fee: ${data.feeDoge.toFixed(8)} DOGE`);
    if (data.amountAdjusted) {
      lines.push(`Amount requested: ${data.quotedDoge.toFixed(8)} DOGE`);
      lines.push(`Amount received: ${data.doge.toFixed(8)} DOGE`);
    } else {
      lines.push(`Total paid: ${data.doge.toFixed(8)} DOGE`);
    }
    if (data.realTx) lines.push("", `Confirmations: ${data.confirmations}`, `Transaction: ${data.txid}`, `View: ${data.explorer}`);
    if (data.address) lines.push("", `Receiving address: ${data.address}`);
    lines.push("", "Paid with Dogecoin · https://commerce.dog");
    return lines.join("\n");
  }

  function posReceiptSubject(data) {
    return `Receipt from ${data.merchant} — ${moneyCents.format(data.usd)} paid in DOGE`;
  }

  function posReceiptForOrder(order) {
    if (!order || order.status !== "paid") return null;
    const data = posReceiptData(order);
    return { data, html: posReceiptHtml(data), text: posReceiptText(data), subject: posReceiptSubject(data) };
  }

  function paidPosReceiptById(orderId) {
    const order = posOrders().find((item) => item.id === String(orderId || ""));
    return posReceiptForOrder(order);
  }

  function currentPosReceipt() {
    return posReceiptForOrder(selectedPosOrder());
  }

  function updatePosReceiptButton(order) {
    const actions = $id("posReceiptActions");
    const paidReceipt = $id("posPaidReceipt");
    const isPaid = Boolean(order && order.status === "paid");
    if (actions) actions.hidden = !isPaid;
    if (paidReceipt) {
      paidReceipt.hidden = !isPaid;
      paidReceipt.innerHTML = isPaid ? posReceiptHtml(posReceiptData(order)) : "";
    }
  }

  function openPosReceiptModal(receipt = currentPosReceipt()) {
    if (!receipt) {
      setPosConfirmNote("Verify a payment before sending a receipt.");
      return;
    }
    posReceiptModalReceipt = {
      data: { ...receipt.data },
      html: String(receipt.html || ""),
      text: String(receipt.text || ""),
      subject: String(receipt.subject || ""),
    };
    posReceiptModalReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    posReceiptModalReturnOrderId = posReceiptModalReturnFocus?.dataset.posReceiptShare || "";
    posReceiptModalReturnControlId = posReceiptModalReturnFocus?.id || "";
    if ($id("posReceiptPreview")) $id("posReceiptPreview").innerHTML = posReceiptModalReceipt.html;
    if ($id("posReceiptModalContext")) {
      $id("posReceiptModalContext").textContent = `${receipt.data.merchant} · ${moneyCents.format(receipt.data.usd)} · ${receipt.data.paidAt}`;
    }
    if ($id("posReceiptEmail")) $id("posReceiptEmail").value = "";
    if ($id("posReceiptModal")) $id("posReceiptModal").hidden = false;
    $id("posReceiptEmail")?.focus();
  }

  function closePosReceiptModal() {
    const modal = $id("posReceiptModal");
    const wasOpen = Boolean(modal && !modal.hidden);
    let returnFocus = posReceiptModalReturnFocus?.isConnected ? posReceiptModalReturnFocus : null;
    if (!returnFocus && posReceiptModalReturnOrderId) {
      returnFocus = Array.from(document.querySelectorAll("[data-pos-receipt-share]")).find(
        (button) => button.dataset.posReceiptShare === posReceiptModalReturnOrderId,
      ) || null;
    }
    if (!returnFocus && posReceiptModalReturnControlId) returnFocus = $id(posReceiptModalReturnControlId);
    if (!returnFocus) returnFocus = document.querySelector(".pos-history-details > summary");
    if (modal) modal.hidden = true;
    if ($id("posReceiptPreview")) $id("posReceiptPreview").innerHTML = "";
    if ($id("posReceiptModalContext")) {
      $id("posReceiptModalContext").textContent = "The receipt below is real formatted HTML. Copy it, then paste it into an email or message without losing the design.";
    }
    posReceiptModalReceipt = null;
    posReceiptModalReturnFocus = null;
    posReceiptModalReturnOrderId = "";
    posReceiptModalReturnControlId = "";
    if (wasOpen && returnFocus?.isConnected) {
      window.requestAnimationFrame(() => returnFocus.focus({ preventScroll: true }));
    }
  }

  async function openPosReceiptEmail() {
    const receipt = posReceiptModalReceipt;
    if (!receipt) {
      setPosConfirmNote("Verify a payment before sending a receipt.");
      return;
    }
    const emailField = $id("posReceiptEmail");
    const email = (emailField?.value || "").trim();
    if (email && emailField && !emailField.checkValidity()) {
      emailField.reportValidity();
      setPosConfirmNote("Enter a valid customer email address, or leave it blank to choose the recipient in your email app.");
      return;
    }
    const copied = await copyPosReceiptRich(receipt);
    if (!copied) return;
    window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(receipt.subject)}`;
    if (window.dogeAnnounce) window.dogeAnnounce("Rich receipt copied. Paste it into the email message body.");
  }

  function legacyCopyPosReceiptRich(html) {
    const helper = document.createElement("div");
    helper.contentEditable = "true";
    helper.setAttribute("aria-hidden", "true");
    helper.style.position = "fixed";
    helper.style.left = "-9999px";
    helper.innerHTML = html;
    document.body.appendChild(helper);
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(helper);
    selection?.removeAllRanges();
    selection?.addRange(range);
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    selection?.removeAllRanges();
    helper.remove();
    return copied;
  }

  async function copyPosReceiptRich(receipt = posReceiptModalReceipt) {
    if (!receipt) {
      setPosConfirmNote("Open a paid receipt before copying it.");
      return false;
    }
    const message = "Receipt copied — paste it into your email.";
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([receipt.html], { type: "text/html" }),
            "text/plain": new Blob([receipt.text], { type: "text/plain" }),
          }),
        ]);
        if (window.dogeAnnounce) window.dogeAnnounce(message);
        return true;
      }
    } catch {
      /* Fall through to the selection-based rich HTML copy. */
    }
    if (legacyCopyPosReceiptRich(receipt.html)) {
      if (window.dogeAnnounce) window.dogeAnnounce(message);
      return true;
    }
    setPosConfirmNote("This browser could not copy formatted HTML. Use Download HTML or Print / Save PDF to keep the receipt design.");
    if (window.dogeAnnounce) window.dogeAnnounce("Formatted receipt copy is unavailable in this browser.");
    return false;
  }

  function posReceiptDocument(receipt) {
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light"><title>DOGE receipt — ${escapeHtml(receipt.data.merchant)}</title><style>@page{margin:16mm}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body style="margin:0;padding:24px;background:#eef0ea">${receipt.html}</body></html>`;
  }

  function downloadPosReceiptHtml(receipt = posReceiptModalReceipt) {
    if (!receipt) {
      setPosConfirmNote("Open a paid receipt before downloading it.");
      return;
    }
    const safeId = String(receipt.data.orderId || "receipt").replace(/[^a-z0-9-]/gi, "-").slice(0, 32) || "receipt";
    downloadText(`doge-receipt-${safeId}.html`, posReceiptDocument(receipt), "text/html;charset=utf-8");
  }

  function printBuiltPosReceipt(receipt) {
    if (!receipt) {
      setPosConfirmNote("Verify a payment before printing a receipt.");
      return;
    }
    const win = window.open("", "_blank", "width=480,height=760");
    if (!win) {
      setPosConfirmNote("Allow pop-ups to print the receipt, or use Copy rich receipt instead.");
      return;
    }
    win.document.write(posReceiptDocument(receipt));
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 350);
  }

  function printPosReceipt() {
    printBuiltPosReceipt(currentPosReceipt());
  }

  function setPosWalletOperationBusy(busy) {
    posWalletOperationBusy = Boolean(busy);
    ["posUseWallet", "posGenerateWallet", "posImportWallet", "posImportWalletFile", "posWallet"].forEach((id) => {
      const control = $id(id);
      if (control) control.disabled = posWalletOperationBusy;
    });
    if ($id("posWalletSetupBody")) $id("posWalletSetupBody").setAttribute("aria-busy", String(posWalletOperationBusy));
  }

  function beginPosWalletOperation() {
    posWalletOperationToken += 1;
    setPosWalletOperationBusy(true);
    return posWalletOperationToken;
  }

  function finishPosWalletOperation(token) {
    if (token !== posWalletOperationToken) return false;
    setPosWalletOperationBusy(false);
    return true;
  }

  function setPosWalletImportStatus(message = POS_WALLET_IMPORT_IDLE, state = "") {
    const status = $id("posImportWalletStatus");
    if (!status) return;
    status.textContent = message;
    if (state) status.dataset.state = state;
    else delete status.dataset.state;
  }

  function clearPosWalletImportReview({ focus = false, resetStatus = false } = {}) {
    pendingPosWalletImport = null;
    if ($id("posWalletImportReview")) $id("posWalletImportReview").hidden = true;
    if ($id("posWalletImportAddress")) $id("posWalletImportAddress").textContent = "";
    if ($id("posWalletImportReviewCopy")) $id("posWalletImportReviewCopy").textContent = "Confirm the receiving address before replacing this device's wallet.";
    if ($id("posWalletImportLegacyWarning")) $id("posWalletImportLegacyWarning").hidden = true;
    if ($id("posConfirmWalletImport")) $id("posConfirmWalletImport").setAttribute("aria-describedby", "posWalletImportReviewCopy posWalletImportAddress");
    if ($id("posImportWalletFile")) $id("posImportWalletFile").value = "";
    if (resetStatus) setPosWalletImportStatus();
    if (focus) $id("posImportWallet")?.focus();
  }

  function posWalletImportLockMessage() {
    if (posGeneratedWallet && !$id("posNewWallet")?.hidden) {
      return "Back up or dismiss the newly generated wallet before replacing it.";
    }
    if (posPaymentStarting) return "The sale is being prepared. Change wallets after it finishes or restart the sale.";
    if (activePosOrder()) return "The wallet is locked to this payment request. Finish it or use Edit / restart sale before changing it.";
    return "";
  }

  async function preparePosWalletImport(file) {
    const locked = posWalletImportLockMessage();
    if (locked) throw new Error(locked);
    if (!file || Number(file.size || 0) > POS_WALLET_BACKUP_MAX_BYTES) {
      throw new Error("Choose a wallet backup JSON file smaller than 64 KB.");
    }
    const core = window.dogeWalletCore;
    if (!core?.parseWalletBackupJson) throw new Error("Wallet import tools are unavailable in this browser.");
    const verified = await core.parseWalletBackupJson(await file.text());
    const postValidationLock = posWalletImportLockMessage();
    if (postValidationLock) throw new Error(postValidationLock);
    const savedLegacyWif = (localStorage.getItem("doge-wallet:wif") || "").trim();
    let clearLegacyWif = false;
    if (savedLegacyWif) {
      if (savedLegacyWif.length > 128) {
        clearLegacyWif = true;
      } else {
        try {
          clearLegacyWif = (await core.walletFromWif(savedLegacyWif)).address !== verified.address;
        } catch {
          clearLegacyWif = true;
        }
      }
    }
    pendingPosWalletImport = Object.freeze({
      address: verified.address,
      clearLegacyWif,
    });
    const currentAddress = ($id("posWallet")?.value || "").trim();
    if ($id("posWalletImportReviewCopy")) {
      $id("posWalletImportReviewCopy").textContent = currentAddress === verified.address
        ? "This backup matches this device's current receiving address."
        : currentAddress
          ? "Confirm to replace this device's current receiving wallet."
          : "Confirm to use this as this device's receiving wallet.";
    }
    if ($id("posWalletImportAddress")) $id("posWalletImportAddress").textContent = verified.address;
    if ($id("posWalletImportLegacyWarning")) $id("posWalletImportLegacyWarning").hidden = !clearLegacyWif;
    if ($id("posConfirmWalletImport")) {
      $id("posConfirmWalletImport").setAttribute(
        "aria-describedby",
        `posWalletImportReviewCopy posWalletImportAddress${clearLegacyWif ? " posWalletImportLegacyWarning" : ""}`,
      );
    }
    if ($id("posWalletImportReview")) $id("posWalletImportReview").hidden = false;
    setPosWalletImportStatus("Backup verified locally. Confirm the receiving address below.", "success");
    $id("posConfirmWalletImport")?.focus();
  }

  async function processPosWalletImportFile(input, importer = preparePosWalletImport) {
    const file = input?.files?.[0] || null;
    try {
      if (!file) return false;
      await importer(file);
      return true;
    } finally {
      if (input) input.value = "";
    }
  }

  function persistPosImportedWallet(imported, merchant, storage = localStorage) {
    const address = String(imported?.address || "").trim();
    if (!address) throw new Error("A verified Dogecoin address is required.");
    if (imported.clearLegacyWif) storage.removeItem("doge-wallet:wif");
    storage.setItem("doge-wallet:address", address);
    storage.setItem("doge-pos:wallet", address);
    storage.setItem("doge-pos:merchant", String(merchant || "DOGE Merchant"));
    return address;
  }

  function applyPendingPosWalletImport() {
    if (!pendingPosWalletImport) return;
    const locked = posWalletImportLockMessage();
    if (locked) {
      setPosWalletImportStatus(locked, "error");
      return;
    }
    const { address, clearLegacyWif } = pendingPosWalletImport;
    const merchant = ($id("posMerchant")?.value || "").trim() || "DOGE Merchant";
    persistPosImportedWallet({ address, clearLegacyWif }, merchant);
    if ($id("posWallet")) $id("posWallet").value = address;
    posGeneratedWallet = null;
    if ($id("posNewWalletWif")) $id("posNewWalletWif").textContent = "••• hidden •••";
    if ($id("posNewWallet")) $id("posNewWallet").hidden = true;
    clearPosWalletImportReview();
    resetPosTransactions("Wallet imported. Open recent wallet activity to load transactions for this address.");
    if (isPosTransactionPickerOpen()) refreshPosTransactions().catch((error) => setPosTransactionsStatus(error.message));
    posWalletPanelOpen = false;
    updatePos();
    const success = "Wallet imported and saved for this browser. No private-key data from the file was stored.";
    setPosWalletImportStatus(success, "success");
    if ($id("posProfileStatus")) $id("posProfileStatus").textContent = success;
    resetMobilePosViewport();
    window.requestAnimationFrame(() => $id("posChangeWallet")?.focus({ preventScroll: true }));
    if (window.dogeAnnounce) window.dogeAnnounce(success);
  }

  function updatePosProfileStatus(state = posState()) {
    const status = $id("posProfileStatus");
    const source = browserSavedPosWalletSource();
    if (!status) return;
    if (source && state.wallet) {
      status.textContent = "Payments land at this Dogecoin address. It is saved in this browser only.";
    } else if (state.wallet) {
      status.textContent = "Address entered — click Use this address so it loads automatically on every session.";
    } else {
      status.textContent = "Paste a Dogecoin address or generate a new wallet. Keys stay in this browser.";
    }
  }

  function syncPosWalletSetup() {
    const wallet = ($id("posWallet")?.value || "").trim();
    const merchant = ($id("posMerchant")?.value || "").trim();
    const collapsed = !posWalletPanelOpen && Boolean(wallet);
    if ($id("posWalletActive")) $id("posWalletActive").hidden = !collapsed;
    if ($id("posWalletActiveMerchant")) {
      $id("posWalletActiveMerchant").textContent = merchant || "DOGE Merchant";
    }
    if ($id("posWalletActiveOut")) {
      $id("posWalletActiveOut").textContent = wallet ? `${wallet.slice(0, 10)}…${wallet.slice(-6)}` : "—";
    }
    if ($id("posWalletSetupBody")) $id("posWalletSetupBody").hidden = collapsed;
    const setup = $id("posWalletSetup");
    if (setup) setup.classList.toggle("is-collapsed", collapsed);
  }

  function resetMobilePosViewport() {
    if (!window.matchMedia?.("(max-width: 700px)").matches) return;
    window.requestAnimationFrame(() => {
      const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: 0, left: 0, behavior: reducedMotion ? "auto" : "smooth" });
    });
  }


  function activePosPaymentState() {
    const order = selectedPosOrder();
    return activePosOrder(order) || posStartingPaymentState || buildPosPayment();
  }

  function updatePosCustomerDisplay(state = activePosPaymentState()) {
    if (!$id("posCustomerDisplayModal")) return;
    if ($id("posDisplayMerchant")) $id("posDisplayMerchant").textContent = state.merchant;
    if ($id("posDisplayUsd")) $id("posDisplayUsd").textContent = moneyCents.format(positiveNumber(state.usd));
    if ($id("posDisplayDoge")) $id("posDisplayDoge").textContent = state.wallet && dogeUsd > 0 ? `${state.doge.toFixed(4)} DOGE` : "Set a wallet to show the amount";
    const displayQr = $id("posDisplayQr");
    if (displayQr) {
      displayQr.hidden = !state.wallet;
      if (state.wallet) displayQr.src = qrUrl(state.uri);
      else displayQr.removeAttribute("src");
    }
  }

  function openPosCustomerDisplay() {
    const order = selectedPosOrder();
    if (!activePosOrder(order)) {
      setPosConfirmNote("Start the payment before opening the customer display.");
      return;
    }
    if (posWorkflowStageForOrder(order) >= 3) {
      setPosConfirmNote("This payment has already been detected. The customer QR is closed.");
      navigatePosStage(3);
      return;
    }
    posCustomerDisplayOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    updatePosCustomerDisplay();
    if ($id("posCustomerDisplayModal")) $id("posCustomerDisplayModal").hidden = false;
    $id("closePosCustomerDisplay")?.focus();
  }

  function closePosCustomerDisplay(options = {}) {
    const restoreFocus = options?.restoreFocus !== false;
    if ($id("posCustomerDisplayModal")) $id("posCustomerDisplayModal").hidden = true;
    if (restoreFocus && posCustomerDisplayOpener?.isConnected && !posCustomerDisplayOpener.disabled) {
      posCustomerDisplayOpener.focus();
    }
    posCustomerDisplayOpener = null;
  }

  function stopPosPaymentPolling(orderId = "") {
    if (orderId) {
      posPaymentPollOrderIds.delete(orderId);
      return;
    }
    posPaymentPollToken += 1;
    posPaymentPollOrderIds.clear();
    if (posPaymentPollTimer) window.clearTimeout(posPaymentPollTimer);
    posPaymentPollTimer = null;
  }

  async function fetchPosBaselineTxids(wallet) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 6000);
    try {
      const response = await walletChainFetch(`/api/wallet/transactions/?address=${encodeURIComponent(wallet)}&limit=25&fresh=1`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not prepare payment monitoring.");
      return {
        txids: (payload.transactions || []).map((transaction) => transaction.txid).filter(isRealDogeTxid).slice(0, 25),
        warning: "",
        ready: true,
      };
    } catch (error) {
      return {
        txids: [],
        warning: "Automatic detection is reconnecting. The QR is ready; use Enter txid if the customer pays before monitoring comes online.",
        ready: false,
      };
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function startPosPayment() {
    const state = buildPosPayment();
    if (!state.wallet) {
      setPosConfirmNote("Set your business wallet before starting a payment.");
      posWalletPanelOpen = true;
      syncPosWalletSetup();
      $id("posWallet")?.focus();
      return;
    }
    if (!(state.usd > 0)) {
      setPosConfirmNote("Enter a USD amount greater than zero.");
      $id("posUsd")?.focus();
      return;
    }
    if (!(state.doge > 0)) {
      setPosConfirmNote("The DOGE quote is not ready yet. Try again in a moment.");
      return;
    }
    const startToken = posPaymentPollToken;
    posPaymentStarting = true;
    posStartingPaymentState = state;
    setPosSaleLocked(true);
    syncPosStageControls();
    setPosConfirmNote("Preparing the frozen quote and customer QR. Payment monitoring will start automatically.");
    const button = $id("posStartPayment");
    if (button) {
      button.disabled = true;
      button.textContent = "Preparing payment...";
    }
    try {
      if (!window.dogeWalletCore?.base58CheckDecode) throw new Error("Wallet validation unavailable");
      const payload = await window.dogeWalletCore.base58CheckDecode(state.wallet);
      if (payload.length !== 21 || ![0x1e, 0x16].includes(payload[0])) throw new Error("Invalid Dogecoin address");
    } catch {
      if (startToken !== posPaymentPollToken) {
        posPaymentStarting = false;
        posStartingPaymentState = null;
        syncPosStageControls();
        return;
      }
      setPosConfirmNote("Enter a valid Dogecoin mainnet receiving address before starting the payment.");
      posWalletPanelOpen = true;
      syncPosWalletSetup();
      posPaymentStarting = false;
      posStartingPaymentState = null;
      setPosSaleLocked(false);
      syncPosStageControls();
      if (button) {
        button.disabled = false;
        button.textContent = "Start payment";
      }
      $id("posWallet")?.focus();
      return;
    }
    if (startToken !== posPaymentPollToken) {
      posPaymentStarting = false;
      posStartingPaymentState = null;
      syncPosStageControls();
      return;
    }
    const baseline = await fetchPosBaselineTxids(state.wallet);
    if (startToken !== posPaymentPollToken) {
      posPaymentStarting = false;
      posStartingPaymentState = null;
      syncPosStageControls();
      return;
    }
    const order = normalizePosOrder({
      ...state,
      id: newPosOrderId(),
      status: "unpaid",
      time: new Date().toLocaleString(),
      payment_started_at: new Date().toISOString(),
      baseline_txids: baseline.txids,
      baseline_ready: baseline.ready,
    });
    posPaymentStarting = false;
    posStartingPaymentState = null;
    upsertPosOrder(order);
    updatePos();
    recordPosMemo(order.memo);
    if (button) button.textContent = "Return to customer scan";
    setPosWorkflowStage(2, order);
    setPosStatusDisplay("Unpaid");
    setPosConfirmNote("Payment started. Monitoring the Dogecoin network automatically.");
    if ($id("posWaitingNote")) {
      $id("posWaitingNote").textContent = baseline.warning || "Watching for this payment to be broadcast. Confirmation and validation happen in Step 3.";
    }
    updatePosCustomerDisplay(order);
    openPosCustomerDisplay();
    startPosPaymentPolling(order);
    if (window.dogeAnnounce) window.dogeAnnounce("Payment started. Customer QR is ready and automatic detection is active.");
  }

  function detectedPosOrder(order, transaction, quality = "exact") {
    const expected = Number(order?.doge || 0);
    const received = Number(transaction?.doge || 0);
    const difference = Math.abs(received - expected);
    const near = quality === "near";
    return normalizePosOrder({
      ...order,
      txid: transaction.txid,
      matched_doge: received,
      confirmations: Number(transaction.confirmations || 0),
      status: near ? "needs review" : "pending",
      payment_detected_at: order.payment_detected_at || new Date().toISOString(),
      validation: near ? "automatic near amount match requires confirmation" : "automatic payment detection",
      validation_source: transaction.source || "",
      validation_errors: near ? [`Received ${received.toFixed(8)} DOGE; expected ${expected.toFixed(8)} DOGE.`] : [],
      near_match: near,
      near_match_difference: near ? difference : 0,
    });
  }

  async function checkPosPayment(orderId, expectedToken = posPaymentPollToken) {
    if (posPaymentPollInFlight.has(orderId)) return;
    let order = posOrders().find((item) => item.id === orderId);
    if (!order || ["paid", "cancelled"].includes(order.status)) return;
    posPaymentPollInFlight.add(orderId);
    try {
      if (isRealDogeTxid(order.txid)) {
        if (order.near_match && !order.near_match_approved && canApprovePosNearMatch(order)) return;
        await confirmPosTransaction({ automatic: true, orderId: order.id, expectedToken });
        return;
      }
      const response = await walletChainFetch(`/api/wallet/transactions/?address=${encodeURIComponent(order.wallet)}&limit=25&fresh=1`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not check for the payment.");
      if (expectedToken !== posPaymentPollToken) return;
      order = posOrders().find((item) => item.id === orderId);
      if (!order || ["paid", "cancelled"].includes(order.status)) return;
      if (isRealDogeTxid(order.txid)) {
        if (order.near_match && !order.near_match_approved && canApprovePosNearMatch(order)) return;
        await confirmPosTransaction({ automatic: true, orderId: order.id, expectedToken });
        return;
      }
      const transactions = Array.isArray(payload.transactions) ? payload.transactions : [];
      if (!order.baseline_ready) {
        const selected = isSelectedPosOrder(order);
        const keepManualStage = selected && $id("posWorkflow")?.dataset.posStage === "3";
        const postStartTransactions = transactions.filter((transaction) => posTransactionHasPostStartTimestamp(transaction, order));
        const postStartTxids = new Set(postStartTransactions.map((transaction) => transaction.txid).filter(isRealDogeTxid));
        order = normalizePosOrder({
          ...order,
          baseline_txids: transactions
            .map((transaction) => transaction.txid)
            .filter((txid) => isRealDogeTxid(txid) && !postStartTxids.has(txid))
            .slice(0, 25),
          baseline_ready: true,
        });
        upsertPosOrder(order, { select: selected });
        if (keepManualStage) setPosWorkflowStage(3, order);
        if (selected) {
          if ($id("posWaitingNote")) $id("posWaitingNote").textContent = postStartTransactions.length
            ? "Monitoring reconnected and found new blockchain activity. Checking whether it belongs to this sale."
            : "Automatic detection is online. Watching for the next matching blockchain broadcast.";
          setPosConfirmNote("Automatic payment detection is online.");
        }
        if (!postStartTransactions.length) return;
      }
      const candidates = transactions
        .map((transaction) => ({ transaction, quality: posTransactionMatchQuality(transaction, order) }))
        .filter((item) => item.quality)
        .sort((a, b) => (a.quality === "exact" ? -1 : 1) - (b.quality === "exact" ? -1 : 1));
      if (!candidates.length) {
        const checkedAt = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
        if (isSelectedPosOrder(order) && $id("posWaitingNote")) $id("posWaitingNote").textContent = `No matching payment yet. Last checked ${checkedAt}; checking again automatically.`;
        return;
      }
      const candidate = candidates[0];
      order = detectedPosOrder(order, candidate.transaction, candidate.quality);
      const selected = isSelectedPosOrder(order);
      upsertPosOrder(order, { select: selected });
      if (selected) {
        setPosStatusDisplay("Verification pending");
        setPosVerificationCopy(order);
        setPosConfirmNote("Blockchain broadcast detected. Verifying its address, amount, and confirmations in Step 3.");
        updatePosCustomerDisplay(order);
      }
      const customerDisplayWasOpen = selected && !$id("posCustomerDisplayModal")?.hidden;
      const focusedPanel = document.activeElement instanceof Element
        ? document.activeElement.closest("[data-pos-panel]")
        : null;
      const focusVerification = customerDisplayWasOpen || Boolean(focusedPanel && focusedPanel.dataset.posPanel !== "3");
      if (selected) {
        if ($id("posTroubleDetails")) $id("posTroubleDetails").open = false;
        if ($id("posManualDetails")) $id("posManualDetails").open = false;
        closePosCustomerDisplay({ restoreFocus: false });
        setPosWorkflowStage(3, order, { focus: focusVerification });
        if (window.dogeAnnounce) window.dogeAnnounce("Blockchain broadcast detected. Verification is pending in Step 3.");
      }
      await confirmPosTransaction({ automatic: true, orderId: order.id, expectedToken });
    } catch (error) {
      const message = error.message || "Automatic payment check failed.";
      if (isSelectedPosOrder(order) && posWorkflowStageForOrder(order) === 2 && $id("posWaitingNote")) {
        $id("posWaitingNote").textContent = `${message} Retrying automatically; manual verification remains available.`;
      } else if (isSelectedPosOrder(order)) {
        setPosConfirmNote(`${message} Retrying automatically; manual verification remains available.`);
      }
    } finally {
      posPaymentPollInFlight.delete(orderId);
    }
  }

  function schedulePosPaymentPoll(token) {
    if (token !== posPaymentPollToken) return;
    const liveIds = Array.from(posPaymentPollOrderIds).filter((orderId) => {
      const order = posOrders().find((item) => item.id === orderId);
      return order && !["paid", "cancelled"].includes(order.status);
    });
    posPaymentPollOrderIds.forEach((orderId) => {
      if (!liveIds.includes(orderId)) posPaymentPollOrderIds.delete(orderId);
    });
    if (!liveIds.length) return;
    posPaymentPollTimer = window.setTimeout(async () => {
      await Promise.all(liveIds.map((orderId) => checkPosPayment(orderId, token)));
      posPaymentPollTimer = null;
      schedulePosPaymentPoll(token);
    }, POS_PAYMENT_POLL_INTERVAL_MS);
  }

  function startPosPaymentPolling(order) {
    if (!order?.id) return;
    posPaymentPollOrderIds.add(order.id);
    const token = posPaymentPollToken;
    checkPosPayment(order.id, token).finally(() => {
      if (!posPaymentPollTimer) schedulePosPaymentPoll(token);
    });
  }

  async function checkSelectedPosPaymentNow() {
    const order = selectedPosOrder();
    if (!order) {
      setPosConfirmNote("Start a payment before checking the blockchain.");
      return;
    }
    const button = $id("posAutoVerify");
    const originalText = button?.textContent || "Check now";
    if (button) {
      button.disabled = true;
      button.textContent = "Checking...";
    }
    if (order.near_match) await confirmPosTransaction({ automatic: true, orderId: order.id });
    else await checkPosPayment(order.id);
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  function cancelPosPayment() {
    abandonPosPayment("Sale cancelled. Enter an amount when you are ready for the next customer.");
  }

  function resetPosRestartArm() {
    posRestartArmed = false;
    if (posRestartTimer) window.clearTimeout(posRestartTimer);
    posRestartTimer = null;
    if ($id("posEditSale")) $id("posEditSale").textContent = "Edit / restart sale";
    if ($id("posCancelPayment")) $id("posCancelPayment").textContent = "Abandon and start over";
    if ($id("posAbandonPayment")) $id("posAbandonPayment").textContent = "Abandon and start over";
  }

  function armPosDetectedRestart() {
    posRestartArmed = true;
    ["posCancelPayment", "posAbandonPayment"].forEach((id) => {
      if ($id(id)) $id(id).textContent = "Confirm abandon payment";
    });
    setPosConfirmNote("A payment was detected for this request. Click Confirm abandon payment within 6 seconds only if you intend to stop monitoring and start over.");
    if (posRestartTimer) window.clearTimeout(posRestartTimer);
    posRestartTimer = window.setTimeout(resetPosRestartArm, 6000);
  }

  function restartPosSaleForEditing(message = "Previous payment request is still being monitored in the background. Edit the amount, memo, business, or wallet and start again.") {
    beginNewPosSale(message);
  }

  function abandonPosPayment(message = "Sale cancelled. Enter an amount when you are ready for the next customer.") {
    const order = activePosOrder();
    if (order && posPaymentWasDetected(order) && !posRestartArmed) {
      armPosDetectedRestart();
      return;
    }
    resetPosRestartArm();
    if (order) {
      upsertPosOrder(normalizePosOrder({ ...order, status: "cancelled", cancelled_at: new Date().toISOString() }));
      stopPosPaymentPolling(order.id);
    }
    beginNewPosSale(message);
  }

  function beginNewPosSale(message = "Ready for a new sale.") {
    resetPosRestartArm();
    posPaymentStarting = false;
    posStartingPaymentState = null;
    closePosCustomerDisplay();
    if ($id("posTroubleDetails")) $id("posTroubleDetails").open = false;
    if ($id("posSaleOptions")) $id("posSaleOptions").open = false;
    posManualReviewVisible = false;
    syncPosManualReviewDisclosure(null);
    closePosTransactionPicker();
    setSelectedPosOrder(null);
    setPosStatusDisplay("Unpaid");
    setPosConfirmNote(message);
    resetPosStartButton();
    updatePos();
    $id("posUsd")?.focus();
  }

  function openPosManualVerification() {
    const order = selectedPosOrder();
    if (!activePosOrder(order)) {
      setPosConfirmNote("Start a payment before using manual verification.");
      navigatePosStage(1);
      return;
    }
    setPosWorkflowStage(3, order, { focus: true });
    closePosCustomerDisplay();
    const manual = $id("posManualDetails");
    posManualReviewVisible = true;
    if (manual) {
      manual.hidden = false;
      manual.open = true;
    }
    if ($id("posReviewPayment")) $id("posReviewPayment").setAttribute("aria-expanded", "true");
    setPosConfirmNote("Paste the buyer's transaction ID and confirm it, or record a manual register check.");
    $id("posTxId")?.focus();
  }

  function openPosPaymentReview() {
    const order = selectedPosOrder();
    if (!activePosOrder(order)) {
      setPosConfirmNote("Start a payment before reviewing it.");
      navigatePosStage(1);
      return;
    }
    setPosWorkflowStage(3, order, { focus: false });
    closePosCustomerDisplay();
    posManualReviewVisible = true;
    const manual = $id("posManualDetails");
    if (manual) {
      manual.hidden = false;
      manual.open = true;
      manual.querySelector("summary")?.focus({ preventScroll: true });
    }
    if ($id("posReviewPayment")) $id("posReviewPayment").setAttribute("aria-expanded", "true");
  }

  async function approvePosNearMatch() {
    const order = selectedPosOrder();
    if (!canApprovePosNearMatch(order)) {
      setPosConfirmNote("Review this payment before continuing; it cannot be approved from the quick action.");
      openPosPaymentReview();
      return;
    }
    const button = $id("posApprovePayment");
    if (button) {
      button.disabled = true;
      button.querySelector("span:last-child").textContent = "Approving...";
    }
    try {
      await confirmPosTransaction({ orderId: order.id, txidOverride: order.txid });
    } finally {
      const current = selectedPosOrder();
      if (button) {
        button.querySelector("span:last-child").textContent = "Approve";
        button.disabled = !canApprovePosNearMatch(current);
      }
    }
  }

  function updatePos() {
    if (!$id("dogePosTerminal")) return;
    const order = selectedPosOrder();
    const startedOrder = startedPosOrder(order);
    const activeOrder = activePosOrder(order);
    const state = activePosPaymentState();
    localStorage.setItem("doge-pos:merchant", state.merchant);
    if (state.wallet) localStorage.setItem("doge-pos:wallet", state.wallet);
    else localStorage.removeItem("doge-pos:wallet");
    updatePosProfileStatus(state);
    const preview = document.querySelector(".pos-preview");
    if (preview) preview.classList.toggle("missing-wallet", !state.wallet);
    if ($id("posDogeOut")) $id("posDogeOut").textContent = state.wallet ? `${state.doge.toFixed(4)} DOGE` : "Set wallet first";
    if ($id("posBaseDogeOut")) $id("posBaseDogeOut").textContent = `${state.base_doge.toFixed(8)} DOGE`;
    if ($id("posFeeDogeOut")) $id("posFeeDogeOut").textContent = `${state.fee_doge.toFixed(8)} DOGE`;
    if ($id("posTotalDogeOut")) $id("posTotalDogeOut").textContent = `${state.doge.toFixed(8)} DOGE`;
    if ($id("posUriOut")) $id("posUriOut").textContent = state.wallet ? state.uri : "Save a Dogecoin address on the Wallet page to generate a payment URI.";
    const qr = $id("posQr");
    if (qr) {
      qr.hidden = !state.wallet;
      if (state.wallet) qr.src = qrUrl(state.uri);
      else qr.removeAttribute("src");
    }
    if ($id("posCopyUri")) $id("posCopyUri").disabled = !activeOrder || posWorkflowStageForOrder(order) >= 3;
    if ($id("posStartDoge")) {
      $id("posStartDoge").textContent = state.wallet && state.doge > 0
        ? `${state.doge.toFixed(8)} DOGE for ${moneyCents.format(state.usd)}`
        : state.wallet ? "Enter an amount to create the quote" : "Save a wallet to begin";
    }
    if ($id("posStartHint")) {
      $id("posStartHint").textContent = activeOrder
        ? "This quote is frozen. Reviewing steps does not interrupt automatic payment monitoring."
        : order?.status === "paid"
          ? "This sale is complete. Adjust the fields if needed, then start a new payment."
        : state.wallet
          ? "Starting freezes this quote, opens the customer QR, and begins automatic payment detection."
          : "Save your business and wallet above before starting a payment.";
    }
    if ($id("posStartPayment") && $id("posStartPayment").textContent !== "Preparing payment...") {
      $id("posStartPayment").textContent = activeOrder
        ? posWorkflowStageForOrder(order) >= 3 ? "View verification" : "Return to customer scan"
        : startedOrder ? "Start new payment" : "Start payment";
      $id("posStartPayment").disabled = !posInitialized || posPaymentStarting;
    }
    if ($id("posPriceOut")) $id("posPriceOut").textContent = money.format(dogeUsd);
    renderDogeConversionChart("pos", state.usd);
    if ($id("posQuoteMeta")) {
      const feeMeta = state.fee_doge > 0 ? ` Includes a ${state.fee_doge.toFixed(8)} DOGE buffered network-fee estimate. The customer total is rounded up, never down, to the four-decimal amount shown.` : " No extra DOGE fee included.";
      $id("posQuoteMeta").textContent = state.wallet ? `${quoteMetaText({ issued_at: state.quote_issued_at, expires_at: state.quote_expires_at }, state.price_reference_usd)}${feeMeta}` : "Set a wallet before creating a Dogecoin payment request.";
    }
    if (!selectedPosOrderId()) {
      if ($id("posExplorerLink")) $id("posExplorerLink").href = explorerUrl("", state.wallet);
      updatePosBlockchainAddressLink(state.wallet);
    }
    updatePosQuickAmountSelection(state.usd);
    syncPosWalletSetup();
    if (!$id("posCustomerDisplayModal")?.hidden) updatePosCustomerDisplay(state);
    syncPosStageControls(order);
  }

  function updatePosQuickAmountSelection(usd = posState().usd) {
    document.querySelectorAll("[data-pos-amount]").forEach((button) => {
      button.classList.toggle("is-active", positiveNumber(button.dataset.posAmount) === positiveNumber(usd));
    });
  }

  async function initPos() {
    if (!$id("dogePosTerminal")) return;
    if ($id("posMerchant")) $id("posMerchant").value = localStorage.getItem("doge-pos:merchant") || $id("posMerchant").value;
    if ($id("posWallet")) $id("posWallet").value = browserSavedPosWallet();
    posWalletPanelOpen = !browserSavedPosWallet();
    // Wallet setup wires up before any network awaits so it works even when
    // the price fetch is slow or offline.
    $id("posUseWallet")?.addEventListener("click", () => {
      if (posWalletOperationBusy) return;
      if (posGeneratedWallet && !$id("posNewWallet")?.hidden) {
        setPosConfirmNote("Back up the new wallet key, then click I saved it before closing wallet setup.");
        $id("posDismissNewWallet")?.focus();
        return;
      }
      if (pendingPosWalletImport) clearPosWalletImportReview({ resetStatus: true });
      const wallet = ($id("posWallet")?.value || "").trim();
      const merchant = ($id("posMerchant")?.value || "").trim() || "DOGE Merchant";
      if (!wallet) {
        updatePosProfileStatus();
        $id("posWallet")?.focus();
        return;
      }
      localStorage.setItem("doge-pos:merchant", merchant);
      localStorage.setItem("doge-pos:wallet", wallet);
      localStorage.setItem("doge-wallet:address", wallet);
      posWalletPanelOpen = false;
      updatePos();
      resetMobilePosViewport();
      if (window.dogeAnnounce) window.dogeAnnounce("Business name and receiving wallet saved for this browser.");
    });
    $id("posChangeWallet")?.addEventListener("click", () => {
      if (posPaymentStarting) {
        setPosConfirmNote("The sale is being prepared. You can change the wallet after it finishes, or restart the sale.");
        return;
      }
      if (activePosOrder()) {
        navigatePosStage(1);
        setPosConfirmNote("The wallet is locked to this payment request. Use Edit / restart sale to change it safely.");
        $id("posEditSale")?.focus();
        return;
      }
      posWalletPanelOpen = true;
      syncPosWalletSetup();
      $id("posWallet")?.focus();
    });
    $id("posGenerateWallet")?.addEventListener("click", async () => {
      if (posWalletOperationBusy) return;
      const locked = posWalletImportLockMessage();
      if (locked) {
        setPosConfirmNote(locked);
        return;
      }
      const token = beginPosWalletOperation();
      const button = $id("posGenerateWallet");
      let failed = false;
      let generatedSuccessfully = false;
      if (button) button.textContent = "Generating...";
      try {
        clearPosWalletImportReview({ resetStatus: true });
        const core = window.dogeWalletCore;
        if (!core) throw new Error("Wallet tools are unavailable in this browser.");
        const generatedWallet = await core.generateWallet();
        if (token !== posWalletOperationToken) return;
        if (posPaymentStarting || activePosOrder()) throw new Error("A payment started before wallet creation finished. The new wallet was not applied.");
        posGeneratedWallet = generatedWallet;
        if ($id("posWallet")) $id("posWallet").value = posGeneratedWallet.address;
        localStorage.setItem("doge-wallet:address", posGeneratedWallet.address);
        localStorage.setItem("doge-pos:wallet", posGeneratedWallet.address);
        if ($id("posNewWalletAddress")) $id("posNewWalletAddress").textContent = posGeneratedWallet.address;
        if ($id("posNewWalletWif")) $id("posNewWalletWif").textContent = posGeneratedWallet.wif;
        if ($id("posNewWallet")) $id("posNewWallet").hidden = false;
        updatePos();
        generatedSuccessfully = true;
        if (window.dogeAnnounce) window.dogeAnnounce("New wallet created. Back up the private key before taking real payments.");
      } catch (error) {
        if (token === posWalletOperationToken) {
          failed = true;
          setPosConfirmNote(error.message || "Could not generate a wallet.");
        }
      } finally {
        if (finishPosWalletOperation(token)) {
          if (button) button.textContent = "Generate new wallet";
          if (failed) window.requestAnimationFrame(() => button?.focus());
          else if (generatedSuccessfully) window.requestAnimationFrame(() => $id("posDownloadWallet")?.focus());
        }
      }
    });
    $id("posDownloadWallet")?.addEventListener("click", () => {
      if (!posGeneratedWallet) return;
      downloadText(
        `doge-wallet-${posGeneratedWallet.address.slice(0, 8)}.json`,
        JSON.stringify({
          schema: "doge-commerce-wallet-backup",
          version: 1,
          network: "dogecoin-mainnet",
          address: posGeneratedWallet.address,
          wif: posGeneratedWallet.wif,
          public_key: posGeneratedWallet.public_key,
          compressed: posGeneratedWallet.compressed ?? true,
          created_at: new Date().toISOString(),
          warning: "Anyone with this WIF can spend the funds. Store offline and never share it.",
        }, null, 2),
        "application/json",
      );
    });
    $id("posCopyWalletWif")?.addEventListener("click", () => {
      if (posGeneratedWallet) copy(posGeneratedWallet.wif, "WIF copied — store it somewhere safe.");
    });
    $id("posDismissNewWallet")?.addEventListener("click", () => {
      posGeneratedWallet = null;
      if ($id("posNewWalletWif")) $id("posNewWalletWif").textContent = "••• hidden •••";
      if ($id("posNewWallet")) $id("posNewWallet").hidden = true;
      posWalletPanelOpen = false;
      syncPosWalletSetup();
      resetMobilePosViewport();
    });
    $id("posImportWallet")?.addEventListener("click", () => {
      if (posWalletOperationBusy) return;
      const locked = posWalletImportLockMessage();
      if (locked) {
        setPosWalletImportStatus(locked, "error");
        return;
      }
      clearPosWalletImportReview({ resetStatus: true });
      $id("posImportWalletFile")?.click();
    });
    $id("posImportWalletFile")?.addEventListener("change", async (event) => {
      const input = event.currentTarget;
      const file = input?.files?.[0] || null;
      const button = $id("posImportWallet");
      if (posWalletOperationBusy) {
        if (input) input.value = "";
        return;
      }
      if (!file) {
        if (input) input.value = "";
        return;
      }
      const token = beginPosWalletOperation();
      let failed = false;
      if (button) button.textContent = "Checking backup...";
      try {
        await processPosWalletImportFile(input);
      } catch (error) {
        if (token === posWalletOperationToken) {
          failed = true;
          clearPosWalletImportReview();
          setPosWalletImportStatus(`${error.message || "Could not import this wallet backup."} Nothing was imported.`, "error");
        }
      } finally {
        if (finishPosWalletOperation(token)) {
          if (button) button.textContent = "Import wallet JSON";
          if (failed) window.requestAnimationFrame(() => button?.focus());
        }
      }
    });
    $id("posConfirmWalletImport")?.addEventListener("click", applyPendingPosWalletImport);
    $id("posCancelWalletImport")?.addEventListener("click", () => clearPosWalletImportReview({ focus: true, resetStatus: true }));
    initPosMemoTypeahead();
    const posPricePromise = fetchDogePrice();
    $id("posUsd")?.addEventListener("input", () => limitDecimalInput($id("posUsd"), 2));
    $id("posUsd")?.addEventListener("blur", () => {
      limitDecimalInput($id("posUsd"), 2, true);
      updatePos();
    });
    document.querySelectorAll('#dogePosTerminal input, #posWalletSetup input:not([type="file"])').forEach((input) => input.addEventListener("input", updatePos));
    $id("posWallet")?.addEventListener("input", () => {
      if (pendingPosWalletImport) clearPosWalletImportReview({ resetStatus: true });
    });
    $id("posWallet")?.addEventListener("change", () => {
      resetPosTransactions("Wallet changed. Open recent wallet activity to load transactions for this address.");
      if (isPosTransactionPickerOpen()) refreshPosTransactions().catch((error) => setPosTransactionsStatus(error.message));
    });
    $id("posCopyUri")?.addEventListener("click", () => copy($id("posUriOut")?.textContent, "POS URI copied."));
    document.querySelectorAll("[data-pos-amount]").forEach((button) => {
      button.addEventListener("click", () => {
        if ($id("posUsd")) $id("posUsd").value = positiveNumber(button.dataset.posAmount).toFixed(2);
        updatePos();
      });
    });
    $id("openPosCustomerDisplay")?.addEventListener("click", openPosCustomerDisplay);
    $id("posQrButton")?.addEventListener("click", () => {
      if (posState().wallet) openPosCustomerDisplay();
    });
    $id("closePosCustomerDisplay")?.addEventListener("click", closePosCustomerDisplay);
    $id("posCustomerDisplayModal")?.addEventListener("click", (event) => {
      if (event.target === $id("posCustomerDisplayModal")) closePosCustomerDisplay();
    });
    const handleStartOrContinue = () => {
      if (posWalletOperationBusy) {
        setPosConfirmNote("Wait for the wallet check to finish before starting a payment.");
        return;
      }
      if (posGeneratedWallet && !$id("posNewWallet")?.hidden) {
        setPosConfirmNote("Back up the new wallet key, then click I saved it before starting a customer payment.");
        $id("posDismissNewWallet")?.focus();
        return;
      }
      const order = selectedPosOrder();
      if (activePosOrder(order)) {
        navigatePosStage(posWorkflowStageForOrder(order) >= 3 ? 3 : 2);
        return;
      }
      startPosPayment().catch((error) => {
        posPaymentStarting = false;
        posStartingPaymentState = null;
        setPosConfirmNote(error.message || "Could not start the payment.");
        if ($id("posStartPayment")) {
          $id("posStartPayment").disabled = false;
          $id("posStartPayment").textContent = "Start payment";
        }
        setPosSaleLocked(false);
        syncPosStageControls();
      });
    };
    $id("posStartPayment")?.addEventListener("click", (event) => {
      event.preventDefault();
      handleStartOrContinue();
    });
    $id("posSaleForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      handleStartOrContinue();
    });
    $id("posManualForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!activePosOrder()) return;
      confirmPosTransaction().catch((error) => setPosConfirmNote(error.message));
    });
    document.querySelectorAll("[data-pos-go]").forEach((button) => {
      button.addEventListener("click", () => navigatePosStage(Number(button.dataset.posGo)));
    });
    $id("posProgress")?.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const buttons = Array.from(document.querySelectorAll("[data-pos-go]:not(:disabled)"));
      if (!buttons.length) return;
      const current = buttons.indexOf(document.activeElement);
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : event.key === "ArrowLeft"
            ? Math.max(0, current - 1)
            : Math.min(buttons.length - 1, current + 1);
      event.preventDefault();
      buttons[nextIndex]?.focus();
    });
    $id("posWorkflow")?.addEventListener("scroll", () => {
      if (!window.matchMedia?.("(max-width: 700px)").matches) return;
      if (posWorkflowScrollTimer) window.clearTimeout(posWorkflowScrollTimer);
      posWorkflowScrollTimer = window.setTimeout(() => {
        const workflow = $id("posWorkflow");
        if (!workflow) return;
        const workflowLeft = workflow.getBoundingClientRect().left;
        const panels = Array.from(workflow.querySelectorAll("[data-pos-panel]"));
        const nearest = panels.reduce((best, panel) => {
          const distance = Math.abs(panel.getBoundingClientRect().left - workflowLeft);
          return !best || distance < best.distance ? { panel, distance } : best;
        }, null);
        const stage = Number(nearest?.panel?.dataset.posPanel || 0);
        if (stage && stage !== Number(workflow.dataset.posStage || 1)) {
          setPosWorkflowStage(stage, selectedPosOrder(), { focus: false, scroll: false });
        }
      }, 90);
    }, { passive: true });
    const showPosSaleSetup = () => {
      navigatePosStage(1);
      if (!activePosOrder()) $id("posUsd")?.focus();
    };
    $id("posStep2StartSale")?.addEventListener("click", showPosSaleSetup);
    $id("posStep3StartSale")?.addEventListener("click", showPosSaleSetup);
    $id("posEditSale")?.addEventListener("click", restartPosSaleForEditing);
    $id("posBackToAmount")?.addEventListener("click", () => navigatePosStage(1));
    $id("posGoToVerify")?.addEventListener("click", () => navigatePosStage(3));
    $id("posBackToScan")?.addEventListener("click", () => navigatePosStage(2));
    $id("posCancelPayment")?.addEventListener("click", cancelPosPayment);
    $id("posAbandonPayment")?.addEventListener("click", abandonPosPayment);
    $id("posNewSale")?.addEventListener("click", () => beginNewPosSale());
    $id("posConfirmTransaction")?.addEventListener("click", () => {
      confirmPosTransaction().catch((error) => setPosConfirmNote(error.message));
    });
    $id("posAutoVerify")?.addEventListener("click", () => {
      checkSelectedPosPaymentNow().catch((error) => setPosConfirmNote(error.message));
    });
    $id("posStep2ManualVerify")?.addEventListener("click", openPosManualVerification);
    $id("posReviewPayment")?.addEventListener("click", openPosPaymentReview);
    $id("posApprovePayment")?.addEventListener("click", () => {
      approvePosNearMatch().catch((error) => setPosConfirmNote(error.message));
    });
    $id("posManualDetails")?.addEventListener("toggle", () => {
      const manual = $id("posManualDetails");
      if ($id("posReviewPayment")) $id("posReviewPayment").setAttribute("aria-expanded", String(Boolean(manual?.open)));
      if (manual && !manual.open && posManualReviewVisible) {
        posManualReviewVisible = false;
        manual.hidden = true;
        if ($id("posWorkflow")?.dataset.posStage === "3" && !$id("posReviewActions")?.hidden) {
          $id("posReviewPayment")?.focus({ preventScroll: true });
        } else if ($id("posWorkflow")?.dataset.posStage === "3") {
          $id("posStage3Title")?.focus({ preventScroll: true });
        }
      }
    });
    $id("posMarkPaid")?.addEventListener("click", markSelectedPosOrderPaid);
    $id("posEmailReceipt")?.addEventListener("click", () => openPosReceiptModal(currentPosReceipt()));
    $id("posPrintReceipt")?.addEventListener("click", () => printPosReceipt());
    $id("posReceiptOpenEmail")?.addEventListener("click", openPosReceiptEmail);
    $id("posReceiptCopyHtml")?.addEventListener("click", () => copyPosReceiptRich(posReceiptModalReceipt));
    $id("posReceiptPrint")?.addEventListener("click", () => printBuiltPosReceipt(posReceiptModalReceipt));
    $id("posReceiptDownloadHtml")?.addEventListener("click", () => downloadPosReceiptHtml(posReceiptModalReceipt));
    $id("closePosReceiptModal")?.addEventListener("click", closePosReceiptModal);
    $id("posReceiptModal")?.addEventListener("click", (event) => {
      if (event.target === $id("posReceiptModal")) closePosReceiptModal();
    });
    $id("posTxId")?.addEventListener("input", () => {
      const order = selectedPosOrder();
      const txid = $id("posTxId").value.trim();
      if ($id("posExplorerLink")) $id("posExplorerLink").href = explorerUrl(txid, order?.wallet || posState().wallet);
      if (txid && isRealDogeTxid(txid)) {
        setPosConfirmNote("Transaction ID entered. Click Confirm tx to validate, then Mark paid when you are ready to hand off goods.");
      } else if (!txid) {
        setPosConfirmNote("");
      }
    });
    $id("posOrderRows")?.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : event.target.parentElement;
      const shareReceiptButton = target?.closest("[data-pos-receipt-share]");
      if (shareReceiptButton) {
        const receipt = paidPosReceiptById(shareReceiptButton.dataset.posReceiptShare);
        if (!receipt) {
          setPosConfirmNote("A rich receipt is available after this order is paid.");
          return;
        }
        openPosReceiptModal(receipt);
        return;
      }
      const printReceiptButton = target?.closest("[data-pos-receipt-print]");
      if (printReceiptButton) {
        const receipt = paidPosReceiptById(printReceiptButton.dataset.posReceiptPrint);
        if (!receipt) {
          setPosConfirmNote("A printable receipt is available after this order is paid.");
          return;
        }
        printBuiltPosReceipt(receipt);
        return;
      }
      const loadButton = target?.closest("[data-pos-load]");
      if (loadButton) {
        loadPosOrder(loadButton.dataset.posLoad);
        return;
      }
      const deleteButton = target?.closest("[data-pos-delete]");
      if (deleteButton) {
        deletePosOrder(deleteButton.dataset.posDelete).catch((error) => setPosConfirmNote(error.message));
      }
    });
    $id("posShowTransactions")?.addEventListener("click", () => {
      if (isPosTransactionPickerOpen()) {
        closePosTransactionPicker();
        return;
      }
      openPosTransactionPicker().catch((error) => setPosTransactionsStatus(error.message));
    });
    $id("posHideTransactions")?.addEventListener("click", closePosTransactionPicker);
    $id("posRefreshTransactions")?.addEventListener("click", () => {
      refreshPosTransactions().catch((error) => setPosTransactionsStatus(error.message));
    });
    $id("posTransactionList")?.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : event.target.parentElement;
      const button = target?.closest("[data-pos-txid]");
      if (button) loadPosTransaction(button.dataset.posTxid, Number(button.dataset.posTxConfirmations || 0));
    });
    $id("posOrderPageSize")?.addEventListener("change", () => {
      setPosOrderPageSize($id("posOrderPageSize").value);
      renderPosOrders();
    });
    $id("posOrderPrev")?.addEventListener("click", () => {
      posOrderPage -= 1;
      renderPosOrders();
    });
    $id("posOrderNext")?.addEventListener("click", () => {
      posOrderPage += 1;
      renderPosOrders();
    });
    $id("openPosEmailOrders")?.addEventListener("click", openPosEmailOrdersModal);
    $id("closePosEmailOrders")?.addEventListener("click", closePosEmailOrdersModal);
    $id("posEmailOrdersModal")?.addEventListener("click", (event) => {
      if (event.target === $id("posEmailOrdersModal")) closePosEmailOrdersModal();
    });
    $id("posEmailOrdersModal")?.addEventListener("keydown", containPosEmailOrdersFocus);
    document.querySelectorAll('input[name="posEmailOrdersScope"]').forEach((input) => {
      input.addEventListener("change", updatePosEmailOrdersSummary);
    });
    $id("posEmailOrdersCopy")?.addEventListener("click", () => {
      const bundle = posEmailOrdersBundle();
      copyPosEmailOrdersBundle(bundle).catch((error) => setPosEmailOrdersStatus(error.message, "error"));
    });
    $id("posEmailOrdersForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      openPosEmailOrdersClient().catch((error) => setPosEmailOrdersStatus(error.message, "error"));
    });
    $id("posExportCsv")?.addEventListener("click", () => openPosExportModal("csv"));
    $id("posExportJson")?.addEventListener("click", () => openPosExportModal("json"));
    $id("closePosExportModal")?.addEventListener("click", closePosExportModal);
    $id("posExportModal")?.addEventListener("click", (event) => {
      if (event.target === $id("posExportModal")) closePosExportModal();
    });
    $id("openPosConversionModal")?.addEventListener("click", openPosConversionModal);
    $id("closePosConversionModal")?.addEventListener("click", closePosConversionModal);
    $id("posConversionModal")?.addEventListener("click", (event) => {
      if (event.target === $id("posConversionModal")) closePosConversionModal();
    });
    $id("openPosOrdersHelp")?.addEventListener("click", openPosOrdersHelpModal);
    $id("closePosOrdersHelp")?.addEventListener("click", closePosOrdersHelpModal);
    $id("posOrdersHelpModal")?.addEventListener("click", (event) => {
      if (event.target === $id("posOrdersHelpModal")) closePosOrdersHelpModal();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      closePosExportModal();
      closePosConversionModal();
      closePosOrdersHelpModal();
      closePosCustomerDisplay();
      closePosReceiptModal();
      closePosEmailOrdersModal();
    });
    document.querySelectorAll("[data-pos-export-scope]").forEach((button) => {
      button.addEventListener("click", () => {
        exportPosOrders(pendingPosExportFormat, button.dataset.posExportScope || "all");
        closePosExportModal();
      });
    });
    $id("posClearOrders")?.addEventListener("click", () => {
      const button = $id("posClearOrders");
      if (posOrders().some((order) => activePosOrder(order))) {
        setPosConfirmNote("A payment is still being monitored in the background. Finish it, abandon it, or wait for verification before clearing order history.");
        return;
      }
      if (!posOrders().length) {
        setPosConfirmNote("There are no local orders to clear.");
        return;
      }
      if (!posClearOrdersArmed) {
        posClearOrdersArmed = true;
        if (button) button.textContent = "Confirm clear all";
        setPosConfirmNote("Click Confirm clear all within 6 seconds to erase every local order from this browser.");
        if (posClearOrdersTimer) window.clearTimeout(posClearOrdersTimer);
        posClearOrdersTimer = window.setTimeout(() => {
          posClearOrdersArmed = false;
          if (button) button.textContent = "Clear local orders";
        }, 6000);
        return;
      }
      posClearOrdersArmed = false;
      if (posClearOrdersTimer) window.clearTimeout(posClearOrdersTimer);
      posClearOrdersTimer = null;
      if (button) button.textContent = "Clear local orders";
      stopPosPaymentPolling();
      savePosOrders([]);
      posOrderPage = 1;
      setSelectedPosOrder(null);
      resetPosStartButton();
      updatePos();
      renderPosOrders();
      setPosConfirmNote("Local order history cleared.");
    });
    posInitialized = true;
    setPosOrderPageSize(localStorage.getItem("doge-pos:page-size") || 10);
    updatePos();
    setPosTransactionPickerOpen(false);
    resetPosTransactions();
    const orders = posOrders();
    const initialOrder = orders.find((order) => order.id === selectedPosOrderId()) || null;
    if (initialOrder) {
      setPosOrderPageForOrder(orders, initialOrder.id);
      loadPosOrder(initialOrder.id);
    } else {
      setSelectedPosOrder(null);
      renderPosOrders();
    }
    // Every unfinished payment request remains live across refreshes, not just
    // the order the cashier currently has open on screen.
    orders
      .filter((order) => activePosOrder(order) && !posPaymentPollOrderIds.has(order.id))
      .forEach((order) => startPosPaymentPolling(order));
    window.addEventListener("beforeunload", () => stopPosPaymentPolling(), { once: true });
    posPricePromise.then(() => updatePos());
  }

  function initValidationSample() {
    $id("runSampleValidation")?.addEventListener("click", () => {
      if ($id("validationTxId")) $id("validationTxId").value = "sample-local-test";
      if ($id("validationAddress")) $id("validationAddress").value = donationAddress();
      if ($id("validationDoge")) $id("validationDoge").value = "25";
      if ($id("validationConfirmations")) $id("validationConfirmations").value = "1";
      if ($id("validationStatusTitle")) $id("validationStatusTitle").textContent = "Sample validation passed";
      if ($id("validationOutput")) {
        $id("validationOutput").value = [
          "Sample validation result",
          "",
          "Status: pass",
          `Expected address: ${donationAddress()}`,
          "Expected amount: 25 DOGE",
          "Confirmations: 1",
          "",
          "This is local sample data. For a real sale, open the explorer and verify the transaction ID, address, amount, and confirmations before fulfillment.",
        ].join("\n");
      }
    });
  }

  function mean(values) {
    return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
  }

  function stdDev(values) {
    const avg = mean(values);
    return Math.sqrt(mean(values.map((value) => (value - avg) ** 2)));
  }

  function emaSeries(values, period) {
    if (!values.length) return [];
    const k = 2 / (period + 1);
    const out = [values[0]];
    for (let i = 1; i < values.length; i += 1) out.push(values[i] * k + out[i - 1] * (1 - k));
    return out;
  }

  function computeRsi(closes, period = 14) {
    if (closes.length < period + 1) return null;
    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= period; i += 1) {
      const change = closes[i] - closes[i - 1];
      if (change >= 0) gains += change;
      else losses -= change;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    for (let i = period + 1; i < closes.length; i += 1) {
      const change = closes[i] - closes[i - 1];
      avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
    }
    if (avgLoss === 0) return 100;
    return 100 - 100 / (1 + avgGain / avgLoss);
  }

  function computeMacd(closes) {
    if (closes.length < 35) return null;
    const fast = emaSeries(closes, 12);
    const slow = emaSeries(closes, 26);
    const macdLine = fast.map((value, index) => value - slow[index]);
    const signalLine = emaSeries(macdLine, 9);
    const histogram = macdLine.map((value, index) => value - signalLine[index]);
    return {
      macd: macdLine.at(-1),
      signal: signalLine.at(-1),
      histogram: histogram.at(-1),
      histogramPrev: histogram.at(-2) ?? 0,
    };
  }

  function computeBollinger(closes, period = 20, mult = 2) {
    if (closes.length < period) return null;
    const window = closes.slice(-period);
    const middle = mean(window);
    const sd = stdDev(window);
    const upper = middle + mult * sd;
    const lower = middle - mult * sd;
    const price = closes.at(-1);
    const width = upper - lower;
    return {
      upper,
      lower,
      middle,
      percentB: width > 0 ? (price - lower) / width : 0.5,
      bandwidthPct: middle > 0 ? (width / middle) * 100 : 0,
    };
  }

  function swingLevels(rows, lookaround = 3) {
    const price = rows.at(-1)?.close || 0;
    const window = rows.slice(-120);
    const swingLows = [];
    const swingHighs = [];
    for (let i = lookaround; i < window.length - lookaround; i += 1) {
      const around = window.slice(i - lookaround, i + lookaround + 1);
      if (window[i].low <= Math.min(...around.map((row) => row.low))) swingLows.push(window[i].low);
      if (window[i].high >= Math.max(...around.map((row) => row.high))) swingHighs.push(window[i].high);
    }
    const supports = swingLows.filter((level) => level < price);
    const resistances = swingHighs.filter((level) => level > price);
    return {
      support: supports.length ? Math.max(...supports) : Math.min(...window.map((row) => row.low)),
      resistance: resistances.length ? Math.min(...resistances) : Math.max(...window.map((row) => row.high)),
    };
  }

  function setTaTile(tileId, outId, readId, value, read, tone = "neutral") {
    if ($id(tileId)) $id(tileId).dataset.taTone = tone;
    if ($id(outId)) $id(outId).textContent = value;
    if ($id(readId) && read) $id(readId).textContent = read;
  }

  function renderTechnicalAnalysis() {
    if (!$id("taSummary")) return;
    const closes = candles.map((candle) => candle.close);
    if (closes.length < 30) {
      $id("taSummary").textContent = "Not enough candles loaded yet to build a reliable read. Try a longer timeframe.";
      return;
    }
    const price = closes.at(-1);
    const summaryPoints = [];
    let score = 0;

    const ma20 = mean(closes.slice(-20));
    const ma50 = mean(closes.slice(-50));
    const trendUp = ma20 > ma50;
    const trendGapPct = ma50 > 0 ? ((ma20 - ma50) / ma50) * 100 : 0;
    score += trendUp ? 1 : -1;
    setTaTile(
      "taTrendTile",
      "taTrendOut",
      "taTrendRead",
      trendUp ? "Uptrend bias" : "Downtrend bias",
      trendUp
        ? `MA 20 is ${trendGapPct.toFixed(2)}% above MA 50 — short-term buyers are in control of this timeframe.`
        : `MA 20 is ${Math.abs(trendGapPct).toFixed(2)}% below MA 50 — sellers still control this timeframe.`,
      trendUp ? "bullish" : "bearish",
    );
    summaryPoints.push(trendUp ? "the short-term average sits above the long-term average (uptrend)" : "the short-term average sits below the long-term average (downtrend)");

    const rsi = computeRsi(closes);
    if (rsi !== null) {
      const rsiTone = rsi >= 70 ? "bearish" : rsi <= 30 ? "bullish" : "neutral";
      if (rsi >= 70) score -= 1;
      if (rsi <= 30) score += 1;
      const rsiRead = rsi >= 70
        ? "Overbought — rallies here historically cool off; chasing is the risk."
        : rsi <= 30
          ? "Oversold — selling pressure is stretched; bounces often start near this zone."
          : rsi >= 55
            ? "Constructive momentum with room before the overbought zone at 70."
            : rsi <= 45
              ? "Soft momentum, though not yet stretched enough to call oversold."
              : "Balanced momentum — neither buyers nor sellers are stretched.";
      setTaTile("taRsiTile", "taRsiOut", "taRsiRead", rsi.toFixed(1), rsiRead, rsiTone);
      if ($id("taRsiBar")) $id("taRsiBar").style.width = `${boundedPercent(rsi)}%`;
      summaryPoints.push(`RSI at ${rsi.toFixed(0)} is ${rsi >= 70 ? "overbought" : rsi <= 30 ? "oversold" : "in neutral territory"}`);
    }

    const macd = computeMacd(closes);
    if (macd) {
      const bullish = macd.histogram > 0;
      const strengthening = Math.abs(macd.histogram) > Math.abs(macd.histogramPrev);
      score += bullish ? 1 : -1;
      setTaTile(
        "taMacdTile",
        "taMacdOut",
        "taMacdRead",
        `${bullish ? "Bullish" : "Bearish"} ${strengthening ? "and building" : "but fading"}`,
        `MACD is ${bullish ? "above" : "below"} its signal line and the gap is ${strengthening ? "widening — momentum is accelerating" : "narrowing — momentum is losing steam"}.`,
        bullish ? "bullish" : "bearish",
      );
      summaryPoints.push(`MACD momentum is ${bullish ? "positive" : "negative"} and ${strengthening ? "building" : "fading"}`);
    }

    const bollinger = computeBollinger(closes);
    if (bollinger) {
      const pct = boundedPercent(bollinger.percentB * 100);
      const bollTone = bollinger.percentB >= 0.95 ? "bearish" : bollinger.percentB <= 0.05 ? "bullish" : "neutral";
      setTaTile(
        "taBollingerTile",
        "taBollingerOut",
        "taBollingerRead",
        `${pct.toFixed(0)}% of band`,
        bollinger.percentB >= 0.95
          ? `Pressing the upper band (${money.format(bollinger.upper)}) — extended moves here often pause or revert.`
          : bollinger.percentB <= 0.05
            ? `Hugging the lower band (${money.format(bollinger.lower)}) — statistically stretched to the downside.`
            : `Inside the band between ${money.format(bollinger.lower)} and ${money.format(bollinger.upper)} — no statistical extreme.`,
        bollTone,
      );
      if ($id("taBollingerBar")) $id("taBollingerBar").style.width = `${pct}%`;
    }

    const levels = swingLevels(candles);
    const supportDrop = price > 0 ? ((price - levels.support) / price) * 100 : 0;
    const resistanceGain = price > 0 ? ((levels.resistance - price) / price) * 100 : 0;
    setTaTile(
      "taLevelsTile",
      "taLevelsOut",
      "taLevelsRead",
      `${money.format(levels.support)} / ${money.format(levels.resistance)}`,
      `Nearest support is ${supportDrop.toFixed(1)}% below price; nearest resistance is ${resistanceGain.toFixed(1)}% above. Breaks of either level often set the next leg.`,
      "neutral",
    );

    const sd = stdDev(closes.slice(-50));
    const volPct = price > 0 ? (sd / price) * 100 : 0;
    const volLabel = volPct >= 5 ? "High" : volPct >= 2 ? "Moderate" : "Calm";
    setTaTile(
      "taVolatilityTile",
      "taVolatilityOut",
      "taVolatilityRead",
      `${volLabel} — ±${volPct.toFixed(1)}%`,
      volPct >= 5
        ? "Wide candle-to-candle swings. Merchants quoting DOGE should keep quote windows short."
        : volPct >= 2
          ? "Normal crypto volatility. The standard 10-minute quote window comfortably covers it."
          : "Unusually quiet price action. Tight ranges often precede the next expansion.",
      "neutral",
    );

    const first = closes[0];
    const changePct = first > 0 ? ((price - first) / first) * 100 : 0;
    setTaTile(
      "taChangeTile",
      "taChangeOut",
      "taChangeRead",
      `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`,
      `Price moved from ${money.format(first)} to ${money.format(price)} across the loaded candles.`,
      changePct >= 0 ? "bullish" : "bearish",
    );

    const volumes = candles.map((candle) => candle.volume).filter((value) => Number.isFinite(value));
    if (volumes.length >= 10) {
      const recentVol = mean(volumes.slice(-10));
      const baseVol = mean(volumes);
      const volRatio = baseVol > 0 ? recentVol / baseVol : 1;
      const rising = volRatio >= 1.15;
      const falling = volRatio <= 0.85;
      setTaTile(
        "taVolumeTrendTile",
        "taVolumeTrendOut",
        "taVolumeTrendRead",
        rising ? `Rising — ${(volRatio * 100 - 100).toFixed(0)}% above average` : falling ? `Fading — ${(100 - volRatio * 100).toFixed(0)}% below average` : "Steady",
        rising
          ? "More DOGE changing hands than the timeframe average — moves carry more conviction."
          : falling
            ? "Lighter participation than average — price moves are easier to fade."
            : "Participation is tracking its average for this timeframe.",
        "neutral",
      );
    }

    const tone = score > 0 ? "bullish" : score < 0 ? "bearish" : "neutral";
    const toneLabel = score > 0 ? "Bullish bias" : score < 0  ? "Bearish bias" : "Mixed picture";
    if ($id("taSummary")) {
      $id("taSummary").dataset.taTone = tone;
      $id("taSummary").textContent = `${toneLabel} at ${money.format(price)}: ${summaryPoints.join("; ")}. Nearest support ≈ ${money.format(levels.support)}, resistance ≈ ${money.format(levels.resistance)}.`;
    }
  }

  function formatDogeAmount(value) {
    const sign = value < 0 ? "-" : "";
    return `${sign}${compact.format(Math.abs(value || 0))} DOGE`;
  }

  function formatUsdBillions(value) {
    const billions = Number(value || 0) / 1e9;
    const digits = billions >= 100 ? 2 : 1;
    return `$${billions.toFixed(digits)} billion`;
  }

  function boundedPercent(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, value));
  }

  function updateHeroBar(key, percent, label) {
    const bar = document.querySelector(`[data-hero-bar="${key}"]`);
    if (bar) bar.style.setProperty("--bar", `${boundedPercent(percent)}%`);
    const output = $id({
      price: "statsHeroPriceProgress",
      cap: "statsHeroCurrentCap",
      volume: "statsHeroVolumeShare",
      rate: "statsHeroTradeRate",
    }[key]);
    if (output && label) output.textContent = label;
  }

  function updateStatsVolume(volume) {
    const safeVolume = Number(volume || 0);
    if (!Number.isFinite(safeVolume) || safeVolume <= 0) return;
    if ($id("statsVolume")) $id("statsVolume").textContent = `${compact.format(safeVolume)} DOGE`;
    const supplyShare = (safeVolume / SUPPLY) * 100;
    updateHeroBar("volume", supplyShare, `${compact.format(safeVolume)} DOGE (${supplyShare.toFixed(2)}% supply)`);
  }

  function formatDogeRate(value) {
    return `${formatDogeAmount(value)}/min`;
  }

  function pruneTradeWindow(now = Date.now()) {
    tradeWindow = tradeWindow.filter((trade) => now - Number(trade.timestampMs || 0) <= 60000);
    return tradeWindow;
  }

  function largeTradeThreshold() {
    const sizes = trades
      .map((trade) => Number(trade.size || 0))
      .filter((size) => Number.isFinite(size) && size > 0)
      .sort((a, b) => a - b);
    if (!sizes.length) return Infinity;
    const percentile = sizes[Math.max(0, Math.floor(sizes.length * 0.78) - 1)] || sizes.at(-1);
    return Math.max(1000, percentile);
  }

  function tradeRowClass(trade, threshold) {
    const side = trade.side === "buy" ? "buy" : "sell";
    const size = Number(trade.size || 0);
    const classes = [`trade-row`, `trade-${side}`];
    if (size >= threshold) classes.push("large-print");
    if (size >= Math.max(threshold * 2.5, 10000)) classes.push("mega-print");
    return classes.join(" ");
  }

  function updateStatsPriceDisplays(price) {
    if (!Number.isFinite(price) || price <= 0) return;
    const currentCap = price * SUPPLY;
    if ($id("statsPrice")) $id("statsPrice").textContent = money.format(price);
    if ($id("statsHeroPrice")) $id("statsHeroPrice").textContent = money.format(price);
    if ($id("statsCurrentCap")) $id("statsCurrentCap").textContent = formatUsdBillions(currentCap);
  }

  function marketDateValue(date) {
    return new Date(date).toISOString().slice(0, 10);
  }

  function marketDateStart(value) {
    return new Date(`${value}T00:00:00Z`);
  }

  function marketDateEnd(value) {
    return new Date(`${value}T23:59:59Z`);
  }

  function setMarketChartStatus(message, isError = false) {
    const output = $id("marketChartTimeframeStatus");
    if (!output) return;
    output.textContent = message;
    output.classList.toggle("error-note", isError);
  }

  function candleRangeLabel(start, end, granularity) {
    const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000));
    const bucket =
      granularity >= 86400 ? "daily" :
        granularity >= 21600 ? "6-hour" :
          granularity >= 3600 ? "hourly" :
            granularity >= 900 ? "15-minute" :
              granularity >= 300 ? "5-minute" :
                "minute";
    return `${days}D ${bucket}`;
  }

  function chooseCandleGranularity(start, end) {
    const hours = Math.max(1, (end.getTime() - start.getTime()) / 3600000);
    if (hours <= 30) return 300;
    if (hours <= 24 * 14) return 3600;
    if (hours <= 24 * 120) return 21600;
    return 86400;
  }

  function setMarketDateInputs(start, end) {
    if ($id("marketChartStart")) $id("marketChartStart").value = marketDateValue(start);
    if ($id("marketChartEnd")) $id("marketChartEnd").value = marketDateValue(end);
  }

  function presetCandleRange(key = marketChartPreset) {
    const preset = CANDLE_PRESETS[key] || CANDLE_PRESETS["7D"];
    const end = new Date();
    const start = new Date(end.getTime() - preset.days * 86400000);
    return { key, label: preset.label, start, end };
  }

  function selectedCandleRange() {
    const selected = $id("marketChartTimeframe")?.value || marketChartPreset;
    if (selected !== "custom") {
      const range = presetCandleRange(selected);
      setMarketDateInputs(range.start, range.end);
      return range;
    }
    const endFallback = new Date();
    const startFallback = new Date(endFallback.getTime() - CANDLE_PRESETS["7D"].days * 86400000);
    let start = $id("marketChartStart")?.value ? marketDateStart($id("marketChartStart").value) : startFallback;
    let end = $id("marketChartEnd")?.value ? marketDateEnd($id("marketChartEnd").value) : endFallback;
    if (Number.isNaN(start.getTime())) start = startFallback;
    if (Number.isNaN(end.getTime())) end = endFallback;
    if (start >= end) start = new Date(end.getTime() - 86400000);
    const maxRangeMs = MAX_CUSTOM_CANDLE_DAYS * 86400000;
    if (end.getTime() - start.getTime() > maxRangeMs) {
      start = new Date(end.getTime() - maxRangeMs);
    }
    setMarketDateInputs(start, end);
    return { key: "custom", label: "Custom dates", start, end };
  }

  function formatChartTick(seconds, rangeMs) {
    const date = new Date(seconds * 1000);
    if (rangeMs <= 2 * 86400000) {
      return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }
    if (rangeMs <= 370 * 86400000) {
      return date.toLocaleDateString([], { month: "short", day: "numeric" });
    }
    return date.toLocaleDateString([], { month: "short", year: "2-digit" });
  }

  function drawLineChart(canvasId = "dogeMarketChart") {
    const canvas = $id(canvasId);
    if (!canvas || candles.length < 2) return;
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const padLeft = 58;
    const padRight = 26;
    const padTop = 28;
    const padBottom = 66;
    const chartHeight = height - padTop - padBottom;
    const chartWidth = width - padLeft - padRight;
    const volumeHeight = 42;
    const closes = candles.map((candle) => candle.close);
    const ma20 = closes.map((_, index) => mean(closes.slice(Math.max(0, index - 19), index + 1)));
    const ma50 = closes.map((_, index) => mean(closes.slice(Math.max(0, index - 49), index + 1)));
    const bandSd = stdDev(closes.slice(-50));
    const bandTop = ma20.map((value) => value + bandSd);
    const bandBottom = ma20.map((value) => Math.max(0, value - bandSd));
    const highs = candles.map((candle) => candle.high);
    const lows = candles.map((candle) => candle.low);
    const min = Math.min(...lows, ...bandBottom);
    const max = Math.max(...highs, ...bandTop);
    const spread = max - min || 1;
    ctx.clearRect(0, 0, width, height);
    const background = ctx.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, "#ffffff");
    background.addColorStop(1, "#f4f8ef");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "#dfe4dd";
    ctx.lineWidth = 1;

    function xAt(index) {
      return padLeft + (chartWidth * index) / (closes.length - 1);
    }

    function yAt(value) {
      return padTop + chartHeight - ((value - min) / spread) * chartHeight;
    }

    for (let i = 0; i < 5; i += 1) {
      const y = padTop + (chartHeight * i) / 4;
      const value = max - (spread * i) / 4;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();
      ctx.fillStyle = "#65716c";
      ctx.font = "12px system-ui";
      ctx.fillText(money.format(value), 8, y + 4);
    }

    const rangeMs = Math.max(0, (candles.at(-1).time - candles[0].time) * 1000);
    const tickCount = canvasId === "dogeMarketChartExpanded" ? 6 : 4;
    ctx.fillStyle = "#65716c";
    ctx.font = canvasId === "dogeMarketChartExpanded" ? "13px system-ui" : "11px system-ui";
    ctx.textAlign = "center";
    for (let i = 0; i < tickCount; i += 1) {
      const index = Math.round((i * (candles.length - 1)) / Math.max(1, tickCount - 1));
      const x = xAt(index);
      const label = formatChartTick(candles[index].time, rangeMs);
      ctx.fillText(label, x, height - 5);
    }
    ctx.textAlign = "left";

    ctx.beginPath();
    bandTop.forEach((value, index) => {
      const x = xAt(index);
      const y = yAt(value);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    bandBottom.slice().reverse().forEach((value, reverseIndex) => {
      const index = bandBottom.length - 1 - reverseIndex;
      ctx.lineTo(xAt(index), yAt(value));
    });
    ctx.closePath();
    ctx.fillStyle = "rgba(99, 84, 201, 0.1)";
    ctx.fill();

    const maxVolume = Math.max(...candles.map((candle) => candle.volume), 1);
    candles.forEach((candle, index) => {
      const x = xAt(index);
      const barHeight = Math.max(2, (candle.volume / maxVolume) * volumeHeight);
      ctx.fillStyle = candle.close >= candle.open ? "rgba(15, 143, 120, 0.18)" : "rgba(198, 71, 99, 0.16)";
      ctx.fillRect(x - 1.5, height - 18 - barHeight, 3, barHeight);
    });

    candles.forEach((candle, index) => {
      if (index % 2 !== 0) return;
      const x = xAt(index);
      const highY = yAt(candle.high);
      const lowY = yAt(candle.low);
      const openY = yAt(candle.open);
      const closeY = yAt(candle.close);
      const up = candle.close >= candle.open;
      ctx.strokeStyle = up ? "rgba(15, 143, 120, 0.42)" : "rgba(198, 71, 99, 0.36)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, highY);
      ctx.lineTo(x, lowY);
      ctx.stroke();
      ctx.fillStyle = up ? "rgba(15, 143, 120, 0.5)" : "rgba(198, 71, 99, 0.44)";
      ctx.fillRect(x - 2, Math.min(openY, closeY), 4, Math.max(2, Math.abs(closeY - openY)));
    });

    function plot(values, color, lineWidth = 2, fill = false) {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      values.forEach((value, index) => {
        const x = xAt(index);
        const y = yAt(value);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      if (fill) {
        ctx.lineTo(width - padRight, height - padBottom);
        ctx.lineTo(padLeft, height - padBottom);
        ctx.closePath();
        const area = ctx.createLinearGradient(0, padTop, 0, height - padBottom);
        area.addColorStop(0, "rgba(15, 143, 120, 0.18)");
        area.addColorStop(1, "rgba(15, 143, 120, 0)");
        ctx.fillStyle = area;
        ctx.fill();
        ctx.beginPath();
        values.forEach((value, index) => {
          const x = xAt(index);
          const y = yAt(value);
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
      }
      ctx.stroke();
    }
    plot(closes, "#0f8f78", 3, true);
    plot(ma20, "#f4bd2a", 2);
    plot(ma50, "#6354c9", 2);

    const lastX = xAt(closes.length - 1);
    const lastY = yAt(closes.at(-1));
    ctx.fillStyle = "#0f8f78";
    ctx.beginPath();
    ctx.arc(lastX, lastY, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#171715";
    ctx.font = "bold 13px system-ui";
    ctx.fillText(money.format(closes.at(-1)), Math.min(lastX - 78, width - 116), Math.max(18, lastY - 12));
  }

  function openMarketChartModal() {
    const modal = $id("marketChartModal");
    if (!modal) return;
    modal.hidden = false;
    $id("expandMarketChart")?.setAttribute("aria-expanded", "true");
    document.body.style.overflow = "hidden";
    drawLineChart("dogeMarketChartExpanded");
    $id("closeMarketChart")?.focus();
  }

  function closeMarketChartModal({ restoreFocus = true } = {}) {
    const modal = $id("marketChartModal");
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    $id("expandMarketChart")?.setAttribute("aria-expanded", "false");
    document.body.style.overflow = "";
    if (restoreFocus) $id("expandMarketChart")?.focus();
  }

  function initMarketChartExpansion() {
    syncMarketChartControls(presetCandleRange(marketChartPreset));
    $id("expandMarketChart")?.addEventListener("click", openMarketChartModal);
    $id("closeMarketChart")?.addEventListener("click", () => closeMarketChartModal());
    $id("marketChartTimeframe")?.addEventListener("change", () => {
      const value = $id("marketChartTimeframe").value;
      if (value === "custom") {
        setMarketChartStatus("Custom date range selected.");
        return;
      }
      loadCandles(presetCandleRange(value)).catch(() => {});
    });
    ["marketChartStart", "marketChartEnd"].forEach((id) => {
      $id(id)?.addEventListener("change", () => {
        if ($id("marketChartTimeframe")) $id("marketChartTimeframe").value = "custom";
        setMarketChartStatus("Custom date range selected.");
      });
    });
    $id("applyMarketChartTimeframe")?.addEventListener("click", () => {
      loadCandles(selectedCandleRange()).catch(() => {});
    });
    $id("marketChartModal")?.addEventListener("click", (event) => {
      if (event.target === $id("marketChartModal")) closeMarketChartModal();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !$id("marketChartModal")?.hidden) closeMarketChartModal();
    });
  }

  function renderStatsOutputs() {
    const closes = candles.map((candle) => candle.close);
    const latest = closes.at(-1) || dogeUsd;
    dogeUsd = latest;
    updateStatsPriceDisplays(latest);
    const ma20 = mean(closes.slice(-20));
    const ma50 = mean(closes.slice(-50));
    const sd = stdDev(closes.slice(-50));
    if ($id("ma20Out")) $id("ma20Out").textContent = money.format(ma20);
    if ($id("ma50Out")) $id("ma50Out").textContent = money.format(ma50);
    if ($id("stdDevOut")) $id("stdDevOut").textContent = money.format(sd);
    const last = candles.at(-1);
    if (last) {
      if ($id("candleOpen")) $id("candleOpen").textContent = money.format(last.open);
      if ($id("candleHigh")) $id("candleHigh").textContent = money.format(last.high);
      if ($id("candleLow")) $id("candleLow").textContent = money.format(last.low);
      if ($id("candleClose")) $id("candleClose").textContent = money.format(last.close);
      updateStatsVolume(last.volume);
    }
    drawLineChart();
    drawLineChart("dogeMarketChartExpanded");
    drawTradeWorldMap();
    renderTechnicalAnalysis();
    document.dispatchEvent(new CustomEvent("doge:candles", {
      detail: { points: candles.map((candle) => ({ time: candle.time, close: candle.close })) },
    }));
  }

  function setMarketChartLoading(isLoading) {
    if ($id("applyMarketChartTimeframe")) $id("applyMarketChartTimeframe").disabled = isLoading;
    if ($id("marketChartTimeframe")) $id("marketChartTimeframe").disabled = isLoading;
    if ($id("marketChartStart")) $id("marketChartStart").disabled = isLoading;
    if ($id("marketChartEnd")) $id("marketChartEnd").disabled = isLoading;
  }

  function syncMarketChartControls(range) {
    if ($id("marketChartTimeframe")) $id("marketChartTimeframe").value = range.key;
    setMarketDateInputs(range.start, range.end);
  }

  async function fetchCoinbaseCandleRows(start, end, granularity) {
    const rowsByTime = new Map();
    const maxChunkMs = granularity * COINBASE_CANDLE_LIMIT * 1000;
    let cursor = new Date(start);
    while (cursor < end) {
      const chunkEnd = new Date(Math.min(end.getTime(), cursor.getTime() + maxChunkMs));
      const url = new URL(`https://api.exchange.coinbase.com/products/${PRODUCT}/candles`);
      url.searchParams.set("granularity", String(granularity));
      url.searchParams.set("start", cursor.toISOString());
      url.searchParams.set("end", chunkEnd.toISOString());
      const response = await limitedFetch(url.toString(), { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !Array.isArray(payload)) {
        throw new Error(payload?.message || "Coinbase candle fetch failed.");
      }
      payload.forEach((row) => {
        if (!Array.isArray(row) || row.length < 6) return;
        rowsByTime.set(Number(row[0]), {
          time: Number(row[0]),
          low: Number(row[1]),
          high: Number(row[2]),
          open: Number(row[3]),
          close: Number(row[4]),
          volume: Number(row[5]),
        });
      });
      if (chunkEnd.getTime() <= cursor.getTime()) break;
      cursor = chunkEnd;
    }
    return Array.from(rowsByTime.values())
      .filter((row) => Number.isFinite(row.time) && Number.isFinite(row.close))
      .sort((a, b) => a.time - b.time);
  }

  async function loadCandles(range = selectedCandleRange()) {
    if (!$id("dogeMarketChart")) return;
    marketChartPreset = range.key;
    syncMarketChartControls(range);
    const granularity = chooseCandleGranularity(range.start, range.end);
    const label = candleRangeLabel(range.start, range.end, granularity);
    setMarketChartLoading(true);
    setMarketChartStatus(`Loading ${label} candles...`);
    try {
      const rows = await fetchCoinbaseCandleRows(range.start, range.end, granularity);
      if (rows.length < 2) throw new Error("Not enough candles returned for that timeframe.");
      candles = rows;
      renderStatsOutputs();
      setMarketChartStatus(`${label} candles loaded: ${rows.length} data points.`);
    } catch (error) {
      setMarketChartStatus(error.message || "Could not load that timeframe.", true);
      throw error;
    } finally {
      setMarketChartLoading(false);
    }
  }

  function setTradeMetric(outputId, text, flowPercent) {
    const output = $id(outputId);
    if (!output) return;
    output.textContent = text;
    const card = output.closest(".trade-summary-card");
    if (card) card.style.setProperty("--flow", `${boundedPercent(flowPercent)}%`);
  }

  function updateTradePressure(buyVolume, sellVolume) {
    const total = buyVolume + sellVolume;
    const buyShare = total > 0 ? (buyVolume / total) * 100 : 50;
    const pressure = $id("tradePressure");
    if (pressure) {
      pressure.style.setProperty("--buy-share", `${boundedPercent(buyShare)}%`);
      pressure.dataset.pressure = buyShare > 55 ? "buy" : buyShare < 45 ? "sell" : "balanced";
    }
    if ($id("tradePressureOut")) $id("tradePressureOut").textContent = total > 0 ? `${buyShare.toFixed(0)}% buy` : "0% buy";
    if ($id("tradePressureLabel")) {
      const label = total <= 0 ? "Waiting for market flow" : buyShare > 55 ? "Buy pressure" : buyShare < 45 ? "Sell pressure" : "Balanced tape";
      $id("tradePressureLabel").textContent = label;
    }
  }

  function recordCumulativeTrade(trade) {
    const size = Math.max(0, Number(trade.size || 0));
    if (!Number.isFinite(size) || size <= 0) return;
    const timestampMs = Number(trade.timestampMs || Date.now());
    if (!cumulativeTradeStats.firstTimestampMs) cumulativeTradeStats.firstTimestampMs = timestampMs;
    cumulativeTradeStats.lastTimestampMs = Math.max(cumulativeTradeStats.lastTimestampMs || 0, timestampMs);
    cumulativeTradeStats.count += 1;
    cumulativeTradeStats.largestTrade = Math.max(cumulativeTradeStats.largestTrade, size);
    if (trade.side === "buy") cumulativeTradeStats.buyVolume += size;
    else cumulativeTradeStats.sellVolume += size;
  }

  function cumulativeTradeSnapshot(now = Date.now()) {
    const buyVolume = cumulativeTradeStats.buyVolume;
    const sellVolume = cumulativeTradeStats.sellVolume;
    const totalVolume = buyVolume + sellVolume;
    const elapsedMs = cumulativeTradeStats.firstTimestampMs ? Math.max(now - cumulativeTradeStats.firstTimestampMs, 1000) : 0;
    const elapsedMinutes = elapsedMs > 0 ? elapsedMs / 60000 : 0;
    return {
      buyVolume,
      sellVolume,
      totalVolume,
      netVolume: buyVolume - sellVolume,
      count: cumulativeTradeStats.count,
      largestTrade: cumulativeTradeStats.largestTrade,
      tradesPerMinute: elapsedMinutes > 0 ? cumulativeTradeStats.count / elapsedMinutes : 0,
      dogePerMinute: elapsedMinutes > 0 ? totalVolume / elapsedMinutes : 0,
    };
  }

  function renderTrades() {
    const rows = $id("tradeRows");
    if (!rows) return;
    const liveTrades = pruneTradeWindow();
    const session = cumulativeTradeSnapshot();
    const buyVolume = session.buyVolume;
    const sellVolume = session.sellVolume;
    const totalVolume = buyVolume + sellVolume;
    const buyShare = totalVolume > 0 ? (buyVolume / totalVolume) * 100 : 0;
    const sellShare = totalVolume > 0 ? (sellVolume / totalVolume) * 100 : 0;
    const dogePerMinute = session.dogePerMinute;
    const largestTrade = session.largestTrade;
    const netVolume = buyVolume - sellVolume;
    const threshold = largeTradeThreshold();
    updateTradePressure(buyVolume, sellVolume);
    setTradeMetric("tradeBuyOut", formatDogeAmount(buyVolume), buyShare);
    setTradeMetric("tradeSellOut", formatDogeAmount(sellVolume), sellShare);
    setTradeMetric("tradeFlowOut", session.count ? formatDogeAmount(netVolume) : "Waiting", totalVolume ? (Math.abs(netVolume) / totalVolume) * 100 : 0);
    $id("tradeFlowOut")?.closest(".trade-summary-card")?.classList.toggle("positive-flow", netVolume >= 0);
    $id("tradeFlowOut")?.closest(".trade-summary-card")?.classList.toggle("negative-flow", netVolume < 0);
    if ($id("statsTradeRate")) $id("statsTradeRate").textContent = `${liveTrades.length}/min`;
    setTradeMetric("tradeRateOut", `${session.tradesPerMinute.toFixed(session.tradesPerMinute >= 10 ? 0 : 1)}/min`, Math.min(100, session.tradesPerMinute * 4));
    setTradeMetric("tradeDogeRateOut", formatDogeRate(dogePerMinute), Math.min(100, dogePerMinute / Math.max(largestTrade, 1) * 100));
    setTradeMetric("tradeLargestOut", formatDogeAmount(largestTrade), totalVolume ? (largestTrade / totalVolume) * 100 : 0);
    updateHeroBar("rate", Math.min(100, liveTrades.length * 4), `${liveTrades.length}/min`);
    rows.innerHTML = trades.length
      ? trades.map((trade) => {
        const size = Number(trade.size || 0);
        const isLarge = size >= threshold;
        return `<tr class="${tradeRowClass(trade, threshold)}">
          <td>${escapeHtml(trade.time)}</td>
          <td><span class="trade-side ${escapeHtml(trade.side)}">${escapeHtml(trade.side)}</span></td>
          <td>${money.format(Number(trade.price))}</td>
          <td><span class="trade-size">${size.toFixed(2)}</span>${isLarge ? '<span class="trade-alert">big</span>' : ""}</td>
        </tr>`;
      }).join("")
      : `<tr><td colspan="4">Waiting for live trades.</td></tr>`;
    drawTradeWorldMap();
  }

  function connectStatsSocket() {
    if (!$id("dogeMarketChart")) return;
    if (statsSocket) statsSocket.close();
    if ($id("statsFeedStatus")) $id("statsFeedStatus").textContent = "Connecting";
    statsSocket = new WebSocket("wss://ws-feed.exchange.coinbase.com");
    statsSocket.addEventListener("open", () => {
      statsSocket.send(JSON.stringify({ type: "subscribe", product_ids: [PRODUCT], channels: ["ticker", "matches"] }));
      if ($id("statsFeedStatus")) $id("statsFeedStatus").textContent = "Live Coinbase";
    });
    statsSocket.addEventListener("message", (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "ticker" && data.price) {
        dogeUsd = Number(data.price);
        updateStatsPriceDisplays(dogeUsd);
        if (data.volume_24h) updateStatsVolume(Number(data.volume_24h));
        document.dispatchEvent(new CustomEvent("doge:price", { detail: { price: dogeUsd } }));
      }
      if (data.type === "match") {
        document.dispatchEvent(new CustomEvent("doge:trade", { detail: { side: data.side, size: Number(data.size || 0), price: Number(data.price || 0) } }));
        const timestampMs = Date.parse(data.time) || Date.now();
        const trade = {
          time: new Date(timestampMs).toLocaleTimeString(),
          side: data.side,
          price: data.price,
          size: data.size,
          timestampMs,
        };
        recordCumulativeTrade(trade);
        trades.unshift({
          ...trade,
        });
        tradeWindow.unshift(trade);
        pruneTradeWindow();
        trades = trades.slice(0, 8);
        renderTrades();
      }
    });
    statsSocket.addEventListener("close", () => {
      if ($id("statsFeedStatus")) $id("statsFeedStatus").textContent = "Disconnected";
    });
  }

  function tradeSession(timestampMs) {
    const hour = new Date(Number(timestampMs) || Date.now()).getUTCHours();
    if (hour >= 0 && hour < 8) return "Asia-Pacific";
    if (hour >= 8 && hour < 16) return "Europe/Africa";
    return "Americas";
  }

  function sessionCapitalAllocation() {
    const sessions = {
      Americas: { key: "americas", label: "Americas", lon: -94, lat: 24, baseline: 0.36, buy: 0, sell: 0, gross: 0, net: 0 },
      "Europe/Africa": { key: "europeAfrica", label: "Europe/Africa", lon: 18, lat: 17, baseline: 0.28, buy: 0, sell: 0, gross: 0, net: 0 },
      "Asia-Pacific": { key: "asiaPacific", label: "Asia-Pacific", lon: 122, lat: 10, baseline: 0.36, buy: 0, sell: 0, gross: 0, net: 0 },
    };
    const windowTrades = pruneTradeWindow();
    const sourceTrades = windowTrades.length ? windowTrades : trades;
    sourceTrades.forEach((trade) => {
      const session = sessions[tradeSession(trade.timestampMs)];
      if (!session) return;
      const side = trade.side === "buy" ? "buy" : "sell";
      const size = Math.max(0, Number(trade.size || 0));
      session[side] += size;
      session.gross += size;
      session.net += side === "buy" ? size : -size;
    });
    const currentCap = Math.max(dogeUsd || DOGE_FALLBACK, DOGE_FALLBACK) * SUPPLY;
    const grossTotal = Object.values(sessions).reduce((sum, session) => sum + session.gross, 0);
    let totalShare = 0;
    Object.values(sessions).forEach((session) => {
      const liveShare = grossTotal > 0 ? session.gross / grossTotal : session.baseline;
      session.share = grossTotal > 0 ? session.baseline * 0.62 + liveShare * 0.38 : session.baseline;
      totalShare += session.share;
    });
    Object.values(sessions).forEach((session) => {
      session.share = totalShare > 0 ? session.share / totalShare : session.baseline;
      session.capital = currentCap * session.share;
      session.doge = SUPPLY * session.share;
      session.netUsd = session.net * Math.max(dogeUsd || DOGE_FALLBACK, DOGE_FALLBACK);
    });
    return { sessions, currentCap, isLive: grossTotal > 0 };
  }

  async function loadWorldAtlas() {
    const map = $id("tradeWorldMap");
    if (!map || worldCountries) return worldCountries;
    if (!window.d3 || !window.topojson) throw new Error("D3 map libraries are not loaded.");
    if (!worldAtlasPromise) {
      worldAtlasPromise = fetch(map.dataset.worldAtlas, { cache: "force-cache" })
        .then((response) => {
          if (!response.ok) throw new Error("World map data failed to load.");
          return response.json();
        })
        .then((topology) => {
          worldCountries = window.topojson.feature(topology, topology.objects.countries);
          return worldCountries;
        });
    }
    return worldAtlasPromise;
  }

  function renderWorldMapPlaceholder(message = "Loading world map and DOGE capital allocation.") {
    const map = $id("tradeWorldMap");
    if (!map) return;
    map.innerHTML = `<div class="world-map-placeholder"><strong>World map loading</strong><span>${escapeHtml(message)}</span></div>`;
  }

  function setCapitalMetric(id, value) {
    const output = $id(id);
    if (output) output.textContent = value;
  }

  function updateCapitalAllocationStats(sessions, currentCap) {
    setCapitalMetric("capitalAmericas", formatUsdBillions(sessions.Americas.capital));
    setCapitalMetric("capitalEuropeAfrica", formatUsdBillions(sessions["Europe/Africa"].capital));
    setCapitalMetric("capitalAsiaPacific", formatUsdBillions(sessions["Asia-Pacific"].capital));
    setCapitalMetric("capitalTotal", formatUsdBillions(currentCap));
  }

  function regionForLongitude(lon) {
    if (lon < -35) return "Americas";
    if (lon < 70) return "Europe/Africa";
    return "Asia-Pacific";
  }

  function appendAllocationTower(svg, x, baseY, height, session) {
    const barWidth = 24;
    const depth = 11;
    const safeHeight = Math.max(0, height);
    const topY = baseY - safeHeight;
    const group = svg.append("g").attr("class", `allocation-tower allocation-${session.key}`);
    group.append("title").text(`${session.label}: ${formatUsdBillions(session.capital)} allocated, ${(session.share * 100).toFixed(1)}% of modeled DOGE market cap.`);
    group.append("rect")
      .attr("class", "flow-bar-front")
      .attr("x", x)
      .attr("y", topY)
      .attr("width", barWidth)
      .attr("height", safeHeight);
    group.append("polygon")
      .attr("class", "flow-bar-top")
      .attr("points", `${x},${topY} ${x + depth},${topY - depth} ${x + barWidth + depth},${topY - depth} ${x + barWidth},${topY}`);
    group.append("polygon")
      .attr("class", "flow-bar-side")
      .attr("points", `${x + barWidth},${topY} ${x + barWidth + depth},${topY - depth} ${x + barWidth + depth},${baseY - depth} ${x + barWidth},${baseY}`);
    return group;
  }

  function drawTradeWorldMap() {
    const map = $id("tradeWorldMap");
    if (!map) return;
    if (!window.d3 || !window.topojson || !worldCountries) {
      renderWorldMapPlaceholder(!window.d3 || !window.topojson ? "D3 map library is loading." : "World atlas data is loading.");
      return;
    }
    const d3 = window.d3;
    const width = 900;
    const height = 520;
    const { sessions, currentCap, isLive } = sessionCapitalAllocation();
    const maxCapital = Math.max(...Object.values(sessions).map((session) => session.capital), 1);
    updateCapitalAllocationStats(sessions, currentCap);
    map.innerHTML = "";
    const svg = d3.select(map).append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("aria-hidden", "true")
      .attr("focusable", "false");
    const defs = svg.append("defs");
    const ocean = defs.append("linearGradient").attr("id", "worldFlowOcean").attr("x1", "0").attr("x2", "1").attr("y1", "0").attr("y2", "1");
    ocean.append("stop").attr("offset", "0%").attr("stop-color", "#fbfcf7");
    ocean.append("stop").attr("offset", "100%").attr("stop-color", "#f7f1da");
    const projection = d3.geoNaturalEarth1().fitExtent([[24, 42], [876, 362]], { type: "Sphere" });
    const path = d3.geoPath(projection);
    svg.append("path").datum({ type: "Sphere" }).attr("class", "world-sphere").attr("d", path);
    svg.append("path").datum(d3.geoGraticule10()).attr("class", "world-graticule").attr("d", path);
    svg.append("g")
      .attr("class", "world-countries")
      .selectAll("path")
      .data(worldCountries.features)
      .join("path")
      .attr("class", "world-country allocation-country")
      .style("fill", (feature) => {
        const centroid = d3.geoCentroid(feature);
        const session = sessions[regionForLongitude(centroid[0])];
        const opacity = 0.13 + session.share * 0.35;
        if (session.key === "americas") return `rgba(15, 143, 120, ${opacity})`;
        if (session.key === "europeAfrica") return `rgba(244, 189, 42, ${opacity})`;
        return `rgba(99, 84, 201, ${opacity})`;
      })
      .attr("d", path);
    svg.append("text")
      .attr("class", "world-map-caption")
      .attr("x", 28)
      .attr("y", 32)
      .text(isLive ? "Current DOGE market cap allocated by regional UTC session weights." : "Baseline allocation shown until live Coinbase activity arrives.");

    Object.values(sessions).forEach((session) => {
      const point = projection([session.lon, session.lat]) || [width / 2, height / 2];
      const baseY = Math.min(432, point[1] + 110);
      const towerHeight = Math.max(24, (session.capital / maxCapital) * 148);
      const haloRadius = 30 + session.share * 95;
      const marker = svg.append("g").attr("class", "flow-session");
      marker.append("circle")
        .attr("class", `allocation-halo allocation-${session.key}`)
        .attr("cx", point[0])
        .attr("cy", point[1])
        .attr("r", haloRadius);
      marker.append("line")
        .attr("class", "flow-session-pin")
        .attr("x1", point[0])
        .attr("y1", point[1] + 6)
        .attr("x2", point[0])
        .attr("y2", baseY);
      marker.append("circle").attr("class", "flow-session-dot").attr("cx", point[0]).attr("cy", point[1]).attr("r", 5);
      appendAllocationTower(marker, point[0] - 12, baseY, towerHeight, session);
      marker.append("text").attr("class", "flow-session-label").attr("x", point[0] + 4).attr("y", baseY + 34).text(session.label);
      marker.append("text").attr("class", "flow-session-capital").attr("x", point[0] + 4).attr("y", baseY + 55).text(formatUsdBillions(session.capital));
      marker.append("text").attr("class", "flow-session-share").attr("x", point[0] + 4).attr("y", baseY + 73).text(`${(session.share * 100).toFixed(1)}% cap`);
    });
  }

  function drawDistribution(payload) {
    const canvas = $id("distributionChart");
    if (!canvas) return;
    const buckets = payload.buckets || [];
    const ctx = canvas.getContext("2d");
    const colors = ["#0f8f78", "#f4bd2a", "#6354c9", "#c64763", "#0e5b63"];
    const percentText = (value) => {
      const number = Number(value);
      if (!Number.isFinite(number)) return "n/a";
      return `${number.toFixed(2).replace(/\.?0+$/, "")}%`;
    };
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const background = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    background.addColorStop(0, "#ffffff");
    background.addColorStop(1, "#f7f2df");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const total = buckets.reduce((sum, item) => sum + item.percent, 0) || 100;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2 + 4;
    const radius = Math.min(canvas.width, canvas.height) * 0.32;
    const thickness = Math.max(24, radius * 0.36);
    let start = -Math.PI / 2;
    buckets.forEach((item, index) => {
      const slice = (item.percent / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, start, start + slice);
      ctx.lineWidth = thickness;
      ctx.strokeStyle = colors[index % colors.length];
      ctx.lineCap = "butt";
      ctx.stroke();
      start += slice;
    });
    ctx.fillStyle = "#171715";
    ctx.font = "900 27px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("DOGE", centerX, centerY - 2);
    ctx.font = "12px system-ui";
    ctx.fillStyle = "#65716c";
    ctx.fillText("holder share", centerX, centerY + 18);
    const top25Percent = buckets
      .filter((item) => !/outside/i.test(item.label || ""))
      .reduce((sum, item) => sum + Number(item.percent || 0), 0);
    const outsideBucket = buckets.find((item) => /outside/i.test(item.label || ""));
    if ($id("distributionSummary")) {
      $id("distributionSummary").innerHTML = `
        <div><span>Top 25 addresses</span><strong>${percentText(top25Percent)}</strong></div>
        <div><span>Outside top 25</span><strong>${percentText(outsideBucket?.percent)}</strong></div>
      `;
    }
    if ($id("distributionLegend")) {
      $id("distributionLegend").innerHTML = buckets
        .map(
          (item, index) => `
            <span class="distribution-bucket" style="--bucket-color:${colors[index % colors.length]}">
              <i></i>
              <span class="distribution-copy">
                <span><b>${escapeHtml(item.label)}</b><strong>${escapeHtml(percentText(item.percent))}</strong></span>
                <small>${escapeHtml(item.range || "Range unavailable")}</small>
              </span>
            </span>
          `,
        )
        .join("");
    }
  }

  async function loadDistribution() {
    if (!$id("distributionChart")) return;
    try {
      const response = await fetch("/api/doge-distribution/", { cache: "no-store" });
      const payload = await response.json();
      if ($id("distributionStatus")) {
        $id("distributionStatus").textContent =
          payload.status === "live"
            ? `Updated ${new Date(payload.updated_at).toLocaleString()} from ${payload.provider_name || "Blockchair"}.`
            : "Baseline holder distribution shown until Blockchair stats refresh.";
      }
      drawDistribution(payload);
    } catch {
      if ($id("distributionStatus")) $id("distributionStatus").textContent = "Could not load rich-list distribution.";
    }
  }

  function initStats() {
    if (!$id("dogeMarketChart")) return;
    initMarketChartExpansion();
    loadCandles().catch(() => {
      if ($id("statsFeedStatus")) $id("statsFeedStatus").textContent = "Candle fetch failed";
    });
    loadDistribution();
    loadWorldAtlas().then(drawTradeWorldMap).catch((error) => renderWorldMapPlaceholder(error.message));
    connectStatsSocket();
    $id("statsReconnect")?.addEventListener("click", connectStatsSocket);
    renderTrades();
  }

  window.dogeWalletToolApi = {
    walletFromWif,
    resolveSigningWallet,
    inspectWalletWif,
    sendWalletDoge,
    lookupWalletBalance,
    walletChainFetch,
    getCurrentWalletDetails: () => (currentWalletDetails ? { ...currentWalletDetails } : null),
  };

  document.addEventListener("DOMContentLoaded", () => {
    initDonateModal();
    initWalletShareBuilder();
    initCounterSignBuilder();
    initCashierCard();
    initIntegrationHelper();
    initWalletTool();
    initPos();
    initValidationSample();
    initStats();
  });
})();
