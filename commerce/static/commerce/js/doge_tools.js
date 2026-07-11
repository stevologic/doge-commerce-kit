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
  let integrationRenderId = 0;
  let integrationSnippetType = "checkout";
  let posOrderPage = 1;
  let pendingPosExportFormat = "";

  let posTransactionsLoaded = false;
  let marketChartPreset = "7D";
  let sentTxWatchTimer = null;
  let posWalletPanelOpen = true;
  const posDeleteArmed = new Set();

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
    return `<div aria-label="Dogecoin accepted here sign" style="box-sizing:border-box;display:grid;justify-items:center;gap:14px;width:100%;max-width:640px;margin:0 auto;padding:34px 30px;border:4px solid #f4bd2a;border-radius:22px;background:#fffdf5;color:#171715;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;text-align:center">
  <span aria-hidden="true" style="display:grid;place-items:center;width:64px;height:64px;border-radius:50%;background:#f4bd2a;color:#171715;font-size:40px;font-weight:900;box-shadow:inset 0 0 0 4px rgba(255,255,255,.5)">&#272;</span>
  <strong style="font-size:34px;line-height:1.05;letter-spacing:.01em;text-transform:uppercase">Dogecoin accepted here</strong>
  <span style="font-size:20px;font-weight:800;color:#96690e">${escapeHtml(values.name)}</span>
  <img src="${escapeHtml(qrSource || qrUrl(uri))}" alt="Dogecoin payment QR code for ${escapeHtml(values.name)}" style="display:block;width:270px;max-width:100%;height:auto;aspect-ratio:1/1;padding:12px;box-sizing:content-box;border:1px solid #dfe4dd;border-radius:16px;background:#fff">
  <span style="font-size:15px;line-height:1.4;color:#5d625f;max-width:440px">${escapeHtml(values.tagline)}</span>
  <code style="display:block;max-width:100%;padding:8px 12px;border-radius:10px;background:#f2f3ec;font-family:ui-monospace,Consolas,monospace;font-size:13px;overflow-wrap:anywhere">${escapeHtml(values.address)}</code>
  <span style="font-size:12px;font-weight:700;color:#8a8f8a">Powered by DOGE Commerce Kit &middot; commerce.dog</span>
</div>`;
  }

  function openPrintWindow(title, bodyHtml) {
    const win = window.open("", "_blank", "width=880,height=1040");
    if (!win) {
      if (window.dogeAnnounce) window.dogeAnnounce("Allow pop-ups for this site to print.");
      return;
    }
    win.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{margin:0;padding:28px;display:grid;place-items:center;background:#fff}@media print{body{padding:0}}</style></head><body>${bodyHtml}</body></html>`);
    win.document.close();
    win.focus();
    const image = win.document.querySelector("img");
    const printNow = () => win.print();
    if (image && !image.complete) image.addEventListener("load", printNow);
    else win.setTimeout(printNow, 200);
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

  function initPosMemoTypeahead() {
    const list = $id("posMemoSuggestions");
    if (!list || list.dataset.loaded === "true") return;
    const fragment = document.createDocumentFragment();
    posMemoSuggestionValues().forEach((memo) => {
      const option = document.createElement("option");
      option.value = memo;
      fragment.appendChild(option);
    });
    list.appendChild(fragment);
    list.dataset.loaded = "true";
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
  // (~226 bytes) at the same 1000 atoms/byte rate the Wallet send form uses.
  const POS_AUTO_FEE_TX_BYTES = 226;
  const POS_AUTO_FEE_ATOMS_PER_BYTE = 1000;

  function posAutoFeeDoge() {
    return (POS_AUTO_FEE_TX_BYTES * POS_AUTO_FEE_ATOMS_PER_BYTE) / 1e8;
  }

  function posFeeAutoEnabled() {
    return localStorage.getItem("doge-pos:fee-auto") !== "false";
  }

  function applyPosFeeMode() {
    const checkbox = $id("posFeeAuto");
    const feeInput = $id("posFeeDoge");
    if (!checkbox || !feeInput) return;
    const auto = checkbox.checked;
    localStorage.setItem("doge-pos:fee-auto", String(auto));
    feeInput.readOnly = auto;
    feeInput.classList.toggle("is-auto", auto);
    if (auto) feeInput.value = posAutoFeeDoge().toFixed(8);
  }

  function posState() {
    limitDecimalInput($id("posUsd"), 2);
    return {
      merchant: $id("posMerchant")?.value.trim() || "DOGE Merchant",
      wallet: $id("posWallet")?.value.trim() || "",
      usd: positiveNumber($id("posUsd")?.value || 0),
      fee_doge: positiveNumber($id("posFeeDoge")?.value || 0),
      memo: $id("posMemo")?.value.trim() || "DOGE sale",
    };
  }

  function newPosOrderId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `pos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function buildPosPayment(state = posState()) {
    const baseDoge = dogeUsd > 0 ? positiveNumber(state.usd) / dogeUsd : 0;
    const feeDoge = positiveNumber(state.fee_doge);
    const amount = positiveNumber(baseDoge) + feeDoge;
    const quote = checkoutQuote();
    return {
      ...state,
      base_doge: baseDoge,
      fee_doge: feeDoge,
      doge: amount,
      price_reference_usd: dogeUsd,
      quote_issued_at: quote.issued_at,
      quote_expires_at: quote.expires_at,
      uri: state.wallet ? dogeUri(state.wallet, amount, state.memo) : "",
    };
  }

  function normalizePosOrder(order, index = 0) {
    const usd = Number(order?.usd || 0);
    const doge = Number(order?.doge || 0);
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
      memo,
      status: order?.status || "unpaid",
      time: order?.time || new Date().toLocaleString(),
      uri: order?.uri || dogeUri(wallet, doge, memo),
      price_reference_usd: Number(order?.price_reference_usd || 0),
      quote_issued_at: order?.quote_issued_at || "",
      quote_expires_at: order?.quote_expires_at || "",
      txid: order?.txid || "",
      confirmations: Number(order?.confirmations || 0),
      confirmed_at: order?.confirmed_at || "",
      paid_at: order?.paid_at || "",
      validation: order?.validation || "",
      validation_source: order?.validation_source || "",
      validation_errors: order?.validation_errors || [],
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
      displayStatus.textContent = state === "paid" ? "Payment received — thank you!" : state === "confirmed" ? "Payment confirmed" : "Awaiting payment";
    }
  }

  function setSelectedPosOrder(order) {
    if (order) {
      localStorage.setItem("doge-pos:selected-order", order.id);
      if ($id("posTxId")) $id("posTxId").value = order.txid || "";
      if ($id("posMinConfirmations")) $id("posMinConfirmations").value = String(Math.max(0, Number(order.confirmations || 1)));
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
      return;
    }
    localStorage.removeItem("doge-pos:selected-order");
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
  }

  function renderPosOrders() {
    const rows = $id("posOrderRows");
    if (!rows) return;
    const orders = posOrders();
    const totalPages = clampPosOrderPage(orders);
    const pageOrders = posOrderPageOrders(orders);
    const selectedId = selectedPosOrderId();
    rows.innerHTML = pageOrders.length
      ? pageOrders.map((order) => `<tr class="${order.id === selectedId ? "order-row-selected" : ""}">
          <td data-label="Time">${escapeHtml(order.time)}</td>
          <td data-label="Merchant">${escapeHtml(order.merchant)}</td>
          <td data-label="USD">${money.format(order.usd)}</td>
          <td data-label="DOGE">${Number(order.doge).toFixed(4)}</td>
          <td data-label="Status">${escapeHtml(order.status)}</td>
          <td data-label="Tx" class="tx-cell">${order.txid ? `<code>${escapeHtml(order.txid)}</code>` : "-"}</td>
          <td data-label="Memo">${escapeHtml(order.memo)}</td>
          <td data-label="Actions">
            <div class="pos-order-actions">
              <button class="button small quiet table-button" type="button" data-pos-load="${escapeHtml(order.id)}">Load</button>
              <button class="button small danger table-button table-delete-button" type="button" data-pos-delete="${escapeHtml(order.id)}">Delete</button>
            </div>
          </td>
        </tr>`).join("")
      : `<tr><td colspan="8">No local POS orders yet.</td></tr>`;
    const start = orders.length ? (posOrderPage - 1) * posOrderPageSize() + 1 : 0;
    const end = Math.min(orders.length, posOrderPage * posOrderPageSize());
    if ($id("posOrderPageStatus")) $id("posOrderPageStatus").textContent = orders.length ? `Showing ${start}-${end} of ${orders.length} local orders.` : "No local POS orders yet.";
    if ($id("posOrderPageInfo")) $id("posOrderPageInfo").textContent = `Page ${posOrderPage} of ${totalPages}`;
    if ($id("posOrderPrev")) $id("posOrderPrev").disabled = posOrderPage <= 1;
    if ($id("posOrderNext")) $id("posOrderNext").disabled = posOrderPage >= totalPages;
  }

  function upsertPosOrder(order) {
    const orders = posOrders();
    const index = orders.findIndex((existing) => existing.id === order.id);
    if (index >= 0) orders[index] = order;
    else orders.unshift(order);
    savePosOrders(orders);
    setPosOrderPageForOrder(orders, order.id);
    setSelectedPosOrder(order);
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
    if ($id("posMerchant")) $id("posMerchant").value = order.merchant;
    if ($id("posWallet")) $id("posWallet").value = order.wallet;
    if ($id("posUsd")) $id("posUsd").value = order.usd.toFixed(2);
    if ($id("posFeeDoge")) $id("posFeeDoge").value = String(positiveNumber(order.fee_doge));
    if ($id("posMemo")) $id("posMemo").value = order.memo;
    updatePos();
    setSelectedPosOrder(order);
    renderPosOrders();
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
    let order = selectedPosOrder() || createPosOrder();
    order = normalizePosOrder({
      ...order,
      txid,
      confirmations: Number(confirmations || 0),
      status: "needs review",
      validation: "blockchain candidate",
    });
    upsertPosOrder(order);
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
    const fields = ["id", "time", "merchant", "wallet", "usd", "base_doge", "fee_doge", "doge", "price_reference_usd", "quote_issued_at", "quote_expires_at", "status", "memo", "uri", "txid", "confirmations", "confirmed_at", "paid_at", "validation", "validation_source", "validation_errors"];
    const rows = [
      fields.join(","),
      ...orders.map((order) => fields.map((field) => csvCell(Array.isArray(order[field]) ? order[field].join("; ") : order[field])).join(",")),
    ];
    downloadText(`doge-pos-orders-${scopeLabel}-${stamp}.csv`, rows.join("\n"), "text/csv");
  }

  const POS_AUTO_VERIFY_WINDOW_MS = 60 * 60 * 1000;
  const POS_AUTO_VERIFY_TOLERANCE_DOGE = 10;
  let posAutoVerifyCandidates = [];
  let posAutoVerifyIndex = 0;
  let posAutoVerifyExpected = 0;

  function hidePosAutoVerify() {
    posAutoVerifyCandidates = [];
    posAutoVerifyIndex = 0;
    if ($id("posAutoVerifyCard")) $id("posAutoVerifyCard").hidden = true;
  }

  function showPosAutoVerifyCandidate() {
    const candidate = posAutoVerifyCandidates[posAutoVerifyIndex];
    if (!candidate) {
      hidePosAutoVerify();
      return;
    }
    const doge = Number(candidate.doge || 0);
    const diff = doge - posAutoVerifyExpected;
    const diffText = Math.abs(diff) < 0.00000001 ? "exact match" : `${diff > 0 ? "+" : ""}${diff.toFixed(4)} vs sale`;
    if ($id("posAutoVerifyTitle")) {
      $id("posAutoVerifyTitle").textContent = posAutoVerifyCandidates.length > 1
        ? `Is this the buyer's payment? (match ${posAutoVerifyIndex + 1} of ${posAutoVerifyCandidates.length})`
        : "Is this the buyer's payment?";
    }
    if ($id("posAutoVerifyAmount")) $id("posAutoVerifyAmount").textContent = `${doge.toFixed(4)} DOGE (${diffText})`;
    if ($id("posAutoVerifyTime")) $id("posAutoVerifyTime").textContent = candidate.time ? formatPosTxTime(candidate.time) : "in mempool";
    if ($id("posAutoVerifyConf")) {
      const confirmations = Number(candidate.confirmations || 0);
      $id("posAutoVerifyConf").textContent = confirmations > 0 ? `confirmed ×${confirmations}` : "pending (0 conf)";
    }
    if ($id("posAutoVerifyTxid")) $id("posAutoVerifyTxid").textContent = candidate.txid;
    if ($id("posAutoVerifyCard")) $id("posAutoVerifyCard").hidden = false;
  }

  async function runPosAutoVerify() {
    const order = selectedPosOrder();
    const state = buildPosPayment();
    const wallet = order?.wallet || state.wallet;
    posAutoVerifyExpected = Number(order?.doge || state.doge || 0);
    if (!wallet) {
      setPosConfirmNote("Set a receiving wallet in Step 0 before using auto verify.");
      return;
    }
    if (!(posAutoVerifyExpected > 0)) {
      setPosConfirmNote("Enter the sale amount (or load an order) so auto verify knows what to look for.");
      return;
    }
    const button = $id("posAutoVerify");
    const originalText = button?.textContent || "Auto verify";
    if (button) {
      button.disabled = true;
      button.textContent = "Searching chain…";
    }
    hidePosAutoVerify();
    try {
      const response = await walletChainFetch(`/api/wallet/transactions/?address=${encodeURIComponent(wallet)}&limit=25`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not load recent blockchain activity.");
      const now = Date.now();
      posAutoVerifyCandidates = (payload.transactions || [])
        .filter((tx) => {
          const doge = Number(tx.doge || 0);
          if (Math.abs(doge - posAutoVerifyExpected) > POS_AUTO_VERIFY_TOLERANCE_DOGE) return false;
          const seenAt = Date.parse(tx.time || "");
          // Unconfirmed mempool entries may not carry a timestamp yet — treat them as fresh.
          return Number.isFinite(seenAt) ? now - seenAt <= POS_AUTO_VERIFY_WINDOW_MS : true;
        })
        .sort((a, b) => Math.abs(Number(a.doge || 0) - posAutoVerifyExpected) - Math.abs(Number(b.doge || 0) - posAutoVerifyExpected));
      posAutoVerifyIndex = 0;
      if (!posAutoVerifyCandidates.length) {
        setPosConfirmNote(`No incoming payment within ${POS_AUTO_VERIFY_TOLERANCE_DOGE} DOGE of ${posAutoVerifyExpected.toFixed(4)} DOGE found in the last hour. Paste the transaction ID from the buyer's wallet manually.`);
        $id("posTxId")?.focus();
        return;
      }
      showPosAutoVerifyCandidate();
      setPosConfirmNote("Blockchain match found. Confirm it belongs to this sale before fulfilling.");
    } catch (error) {
      setPosConfirmNote(error.message || "Auto verify failed. Paste the transaction ID manually.");
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  }

  async function confirmPosTransaction() {
    const txid = $id("posTxId")?.value.trim() || "";
    const requestedConfirmations = Number($id("posMinConfirmations")?.value || 0);
    const minConfirmations = Number.isFinite(requestedConfirmations) ? Math.max(0, requestedConfirmations) : 0;
    let order = selectedPosOrder() || createPosOrder();
    const now = new Date().toLocaleString();
    if (!txid || txid === "sample-local-test") {
      order = {
        ...order,
        txid,
        confirmations: minConfirmations,
        status: "confirmed",
        confirmed_at: now,
        validation: txid === "sample-local-test" ? "sample" : "manual",
        validation_errors: [],
      };
      upsertPosOrder(order);
      setPosConfirmNote(txid === "sample-local-test" ? "Sample transaction check passed for testing." : "Manual register check recorded. Mark paid is now available.");
      return;
    }

    setPosConfirmNote("Checking the Dogecoin blockchain for address, amount, and confirmations...");
    try {
      const response = await fetch("/api/transaction/validate/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          txid,
          address: order.wallet,
          doge: order.doge,
          min_confirmations: minConfirmations,
        }),
      });
      const payload = await response.json();
      order = {
        ...order,
        txid: payload.txid || txid,
        confirmations: Number(payload.confirmations || 0),
        status: payload.passed ? "confirmed" : "needs review",
        confirmed_at: payload.passed ? now : order.confirmed_at,
        validation: "blockchain",
        validation_source: payload.source || "",
        validation_errors: payload.errors || (payload.error ? [payload.error] : []),
      };
      if (!response.ok) {
        upsertPosOrder(order);
        setPosConfirmNote(payload.error || "Transaction lookup failed.");
        return;
      }
      if (payload.passed) {
        if (isRealDogeTxid(payload.txid || txid)) {
          markPosOrderPaid(order, `Blockchain validation passed and order marked paid: ${payload.matched_doge} DOGE matched with ${payload.confirmations} confirmation(s).`);
          return;
        }
        upsertPosOrder(order);
        setPosConfirmNote(`Blockchain validation passed: ${payload.matched_doge} DOGE matched with ${payload.confirmations} confirmation(s).`);
      } else {
        upsertPosOrder(order);
        setPosConfirmNote(`Needs review: ${(payload.errors || ["transaction did not match the order"]).join(" ")}`);
      }
    } catch (error) {
      setPosConfirmNote(`Transaction lookup failed: ${error.message}`);
    }
  }

  function markPosOrderPaid(order, message = "Order marked paid and ready for fulfillment.") {
    if (!order) return;
    const paidOrder = normalizePosOrder({
      ...order,
      status: "paid",
      paid_at: order.paid_at || new Date().toLocaleString(),
    });
    upsertPosOrder(paidOrder);
    setPosStatusDisplay("paid");
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
    const collapsed = !posWalletPanelOpen && Boolean(wallet);
    if ($id("posWalletActive")) $id("posWalletActive").hidden = !collapsed;
    if ($id("posWalletActiveOut")) {
      $id("posWalletActiveOut").textContent = wallet ? `${wallet.slice(0, 10)}…${wallet.slice(-6)}` : "—";
    }
    if ($id("posWalletSetupBody")) $id("posWalletSetupBody").hidden = collapsed;
    const setup = $id("posWalletSetup");
    if (setup) setup.classList.toggle("is-collapsed", collapsed);
  }

  function savePosMerchant() {
    const state = posState();
    localStorage.setItem("doge-pos:merchant", state.merchant);
    if (state.wallet) localStorage.setItem("doge-pos:wallet", state.wallet);
    updatePosProfileStatus(state);
    if (window.dogeAnnounce) window.dogeAnnounce("Merchant profile saved in this browser.");
  }

  function updatePosCustomerDisplay(state = buildPosPayment()) {
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
    updatePosCustomerDisplay();
    if ($id("posCustomerDisplayModal")) $id("posCustomerDisplayModal").hidden = false;
    $id("closePosCustomerDisplay")?.focus();
  }

  function closePosCustomerDisplay() {
    if ($id("posCustomerDisplayModal")) $id("posCustomerDisplayModal").hidden = true;
  }

  function updatePos() {
    if (!$id("dogePosTerminal")) return;
    const state = buildPosPayment();
    localStorage.setItem("doge-pos:merchant", state.merchant);
    if (state.wallet) localStorage.setItem("doge-pos:wallet", state.wallet);
    else localStorage.removeItem("doge-pos:wallet");
    updatePosProfileStatus(state);
    const preview = document.querySelector(".pos-preview");
    if (preview) preview.classList.toggle("missing-wallet", !state.wallet);
    if ($id("posDogeOut")) $id("posDogeOut").textContent = state.wallet ? `${state.doge.toFixed(8)} DOGE` : "Set wallet first";
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
    if ($id("posCopyUri")) $id("posCopyUri").disabled = !state.wallet;
    if ($id("posSaveOrder")) $id("posSaveOrder").disabled = !state.wallet;
    if ($id("posPriceOut")) $id("posPriceOut").textContent = money.format(dogeUsd);
    renderDogeConversionChart("pos", state.usd);
    if ($id("posQuoteMeta")) {
      const feeMeta = state.fee_doge > 0 ? ` Additional fee included in QR amount: ${state.fee_doge.toFixed(8)} DOGE.` : " No extra DOGE fee included.";
      $id("posQuoteMeta").textContent = state.wallet ? `${quoteMetaText({ issued_at: state.quote_issued_at, expires_at: state.quote_expires_at }, state.price_reference_usd)}${feeMeta}` : "Set a wallet before creating a Dogecoin payment request.";
    }
    if (!selectedPosOrderId()) {
      if ($id("posExplorerLink")) $id("posExplorerLink").href = explorerUrl("", state.wallet);
      updatePosBlockchainAddressLink(state.wallet);
    }
    updatePosQuickAmountSelection(state.usd);
    syncPosWalletSetup();
    if (!$id("posCustomerDisplayModal")?.hidden) updatePosCustomerDisplay(state);
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
      const wallet = ($id("posWallet")?.value || "").trim();
      if (!wallet) {
        updatePosProfileStatus();
        $id("posWallet")?.focus();
        return;
      }
      localStorage.setItem("doge-pos:wallet", wallet);
      localStorage.setItem("doge-wallet:address", wallet);
      posWalletPanelOpen = false;
      updatePos();
      if (window.dogeAnnounce) window.dogeAnnounce("Receiving wallet saved for this browser.");
    });
    $id("posChangeWallet")?.addEventListener("click", () => {
      posWalletPanelOpen = true;
      syncPosWalletSetup();
      $id("posWallet")?.focus();
    });
    let posGeneratedWallet = null;
    $id("posGenerateWallet")?.addEventListener("click", async () => {
      try {
        const core = window.dogeWalletCore;
        if (!core) throw new Error("Wallet tools are unavailable in this browser.");
        posGeneratedWallet = await core.generateWallet();
        if ($id("posWallet")) $id("posWallet").value = posGeneratedWallet.address;
        localStorage.setItem("doge-wallet:address", posGeneratedWallet.address);
        localStorage.setItem("doge-pos:wallet", posGeneratedWallet.address);
        if ($id("posNewWalletAddress")) $id("posNewWalletAddress").textContent = posGeneratedWallet.address;
        if ($id("posNewWalletWif")) $id("posNewWalletWif").textContent = posGeneratedWallet.wif;
        if ($id("posNewWallet")) $id("posNewWallet").hidden = false;
        updatePos();
        if (window.dogeAnnounce) window.dogeAnnounce("New wallet created. Back up the private key before taking real payments.");
      } catch (error) {
        setPosConfirmNote(error.message || "Could not generate a wallet.");
      }
    });
    $id("posDownloadWallet")?.addEventListener("click", () => {
      if (!posGeneratedWallet) return;
      downloadText(
        `doge-wallet-${posGeneratedWallet.address.slice(0, 8)}.json`,
        JSON.stringify({
          address: posGeneratedWallet.address,
          wif: posGeneratedWallet.wif,
          public_key: posGeneratedWallet.public_key,
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
    });
    if ($id("posFeeAuto")) {
      $id("posFeeAuto").checked = posFeeAutoEnabled();
      applyPosFeeMode();
      $id("posFeeAuto").addEventListener("change", () => {
        applyPosFeeMode();
        updatePos();
      });
    }
    initPosMemoTypeahead();
    await fetchDogePrice();
    $id("posUsd")?.addEventListener("input", () => limitDecimalInput($id("posUsd"), 2));
    $id("posUsd")?.addEventListener("blur", () => {
      limitDecimalInput($id("posUsd"), 2, true);
      updatePos();
    });
    document.querySelectorAll("#dogePosTerminal input, #posWalletSetup input").forEach((input) => input.addEventListener("input", updatePos));
    $id("posWallet")?.addEventListener("change", () => {
      resetPosTransactions("Wallet changed. Open recent wallet activity to load transactions for this address.");
      if (isPosTransactionPickerOpen()) refreshPosTransactions().catch((error) => setPosTransactionsStatus(error.message));
    });
    $id("posCopyUri")?.addEventListener("click", () => copy($id("posUriOut")?.textContent, "POS URI copied."));
    $id("posSaveMerchant")?.addEventListener("click", savePosMerchant);
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
    $id("posSaveOrder")?.addEventListener("click", () => {
      if (!posState().wallet) {
        setPosConfirmNote("Set a merchant Dogecoin wallet on the Wallet page before saving an order.");
        if (window.dogeAnnounce) window.dogeAnnounce("Set a merchant wallet before saving a POS order.");
        return;
      }
      const order = createPosOrder();
      upsertPosOrder(order);
      setPosConfirmNote("Order saved locally. Paste a txid or run a manual confirmation before marking paid.");
      if (window.dogeAnnounce) window.dogeAnnounce("POS order saved locally.");
    });
    $id("posConfirmTransaction")?.addEventListener("click", () => {
      confirmPosTransaction().catch((error) => setPosConfirmNote(error.message));
    });
    $id("posAutoVerify")?.addEventListener("click", () => {
      runPosAutoVerify().catch((error) => setPosConfirmNote(error.message));
    });
    $id("posAutoVerifyYes")?.addEventListener("click", () => {
      const candidate = posAutoVerifyCandidates[posAutoVerifyIndex];
      if (!candidate) {
        hidePosAutoVerify();
        return;
      }
      hidePosAutoVerify();
      loadPosTransaction(candidate.txid, Number(candidate.confirmations || 0));
      confirmPosTransaction().catch((error) => setPosConfirmNote(error.message));
    });
    $id("posAutoVerifyNo")?.addEventListener("click", () => {
      posAutoVerifyIndex += 1;
      if (posAutoVerifyIndex < posAutoVerifyCandidates.length) {
        showPosAutoVerifyCandidate();
        return;
      }
      hidePosAutoVerify();
      setPosConfirmNote("No other recent matches on chain. Paste the transaction ID from the buyer's wallet manually.");
      $id("posTxId")?.focus();
    });
    $id("posMarkPaid")?.addEventListener("click", markSelectedPosOrderPaid);
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
    });
    document.querySelectorAll("[data-pos-export-scope]").forEach((button) => {
      button.addEventListener("click", () => {
        exportPosOrders(pendingPosExportFormat, button.dataset.posExportScope || "all");
        closePosExportModal();
      });
    });
    $id("posClearOrders")?.addEventListener("click", () => {
      savePosOrders([]);
      posOrderPage = 1;
      setSelectedPosOrder(null);
      renderPosOrders();
    });
    setPosOrderPageSize(localStorage.getItem("doge-pos:page-size") || 10);
    updatePos();
    setPosTransactionPickerOpen(false);
    resetPosTransactions();
    const orders = posOrders();
    const initialOrder = orders.find((order) => order.id === selectedPosOrderId()) || orders[0] || null;
    if (initialOrder) setPosOrderPageForOrder(orders, initialOrder.id);
    setSelectedPosOrder(initialOrder);
    renderPosOrders();
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
