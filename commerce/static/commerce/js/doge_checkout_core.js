(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DogeCheckoutCore = api;
  root.dogeCheckoutCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DOGE_ATOMS = 100_000_000n;
  const AUTO_FEE_ATOMS = 236_000n;
  const CUSTOMER_AMOUNT_QUANTUM_ATOMS = 10_000n;
  const EXACT_TOLERANCE_ATOMS = 1n;
  const NEAR_MATCH_MARGIN_ATOMS = DOGE_ATOMS;
  const MAX_USD_CENTS = 100_000_000n;
  const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{26,35}$/;
  const TXID = /^[0-9a-fA-F]{64}$/;

  function cleanText(value, fallback, maxLength) {
    const text = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    return (text || fallback).slice(0, maxLength);
  }

  function plainDecimal(value, maximumPlaces) {
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new Error("Enter a valid decimal amount.");
      value = value.toFixed(maximumPlaces).replace(/0+$/, "").replace(/\.$/, "");
    }
    const text = String(value ?? "").trim();
    if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error("Enter a valid decimal amount.");
    const [whole, fraction = ""] = text.split(".");
    if (fraction.length > maximumPlaces) throw new Error(`Use no more than ${maximumPlaces} decimal places.`);
    return { whole: whole.replace(/^0+(?=\d)/, "") || "0", fraction };
  }

  function parseUsdCents(value) {
    const decimal = plainDecimal(value, 2);
    const cents = (BigInt(decimal.whole) * 100n) + BigInt((decimal.fraction + "00").slice(0, 2));
    if (cents < 1n || cents > MAX_USD_CENTS) throw new Error("USD amount must be between $0.01 and $1,000,000.00.");
    return cents;
  }

  function decimalFraction(value, maximumPlaces) {
    const decimal = plainDecimal(value, maximumPlaces);
    const scale = 10n ** BigInt(decimal.fraction.length);
    const numerator = (BigInt(decimal.whole) * scale) + BigInt(decimal.fraction || "0");
    if (numerator <= 0n) throw new Error("The live DOGE/USD quote is unavailable.");
    return { numerator, scale };
  }

  function divideRoundUp(numerator, denominator) {
    if (denominator <= 0n) throw new Error("The live DOGE/USD quote is unavailable.");
    return (numerator + denominator - 1n) / denominator;
  }

  function atomsToDoge(atoms) {
    const value = BigInt(atoms);
    const whole = value / DOGE_ATOMS;
    const fraction = (value % DOGE_ATOMS).toString().padStart(8, "0");
    return `${whole}.${fraction}`;
  }

  function dogeToAtoms(value) {
    const decimal = plainDecimal(value, 8);
    return (BigInt(decimal.whole) * DOGE_ATOMS) + BigInt((decimal.fraction + "00000000").slice(0, 8));
  }

  function quotePayment({ usd, rateUsd }) {
    const usdCents = parseUsdCents(usd);
    const rate = decimalFraction(rateUsd, 12);
    const baseAtoms = divideRoundUp(usdCents * rate.scale * DOGE_ATOMS, 100n * rate.numerator);
    const unalignedTotal = baseAtoms + AUTO_FEE_ATOMS;
    const totalAtoms = divideRoundUp(unalignedTotal, CUSTOMER_AMOUNT_QUANTUM_ATOMS) * CUSTOMER_AMOUNT_QUANTUM_ATOMS;
    const feeAtoms = totalAtoms - baseAtoms;
    return Object.freeze({
      usdCents: usdCents.toString(),
      rateUsd: String(rateUsd),
      baseAtoms: baseAtoms.toString(),
      feeAtoms: feeAtoms.toString(),
      totalAtoms: totalAtoms.toString(),
      baseDoge: atomsToDoge(baseAtoms),
      feeDoge: atomsToDoge(feeAtoms),
      doge: atomsToDoge(totalAtoms),
    });
  }

  function validAddressShape(value) {
    const address = String(value || "").trim();
    return BASE58_ADDRESS.test(address) && ["D", "A", "9"].includes(address[0]);
  }

  function normalizeReturnUrl(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    try {
      const url = new URL(text);
      return url.protocol === "https:" ? url.href.slice(0, 500) : "";
    } catch {
      return "";
    }
  }

  function normalizeConfig(raw = {}) {
    const merchantObject = raw.merchant && typeof raw.merchant === "object" ? raw.merchant : {};
    const orderObject = raw.order && typeof raw.order === "object" ? raw.order : {};
    const paymentObject = raw.payment && typeof raw.payment === "object" ? raw.payment : {};
    const appearanceObject = raw.appearance && typeof raw.appearance === "object" ? raw.appearance : {};
    const behaviorObject = raw.behavior && typeof raw.behavior === "object" ? raw.behavior : {};
    const address = String(
      merchantObject.address || raw.address || raw.wallet || "",
    ).trim();
    if (!validAddressShape(address)) throw new Error("Enter a valid Dogecoin mainnet receiving address.");
    const usdCents = parseUsdCents(orderObject.usd ?? raw.usd ?? raw.amount);
    const confirmationValue = paymentObject.minConfirmations ?? raw.minConfirmations ?? raw.confirmations ?? 1;
    const parsedConfirmations = Number.parseInt(confirmationValue, 10);
    const minConfirmations = Number.isFinite(parsedConfirmations)
      ? Math.min(12, Math.max(0, parsedConfirmations))
      : 1;
    const quoteValue = paymentObject.quoteMinutes ?? raw.quoteMinutes ?? 10;
    const parsedQuoteMinutes = Number.parseInt(quoteValue, 10);
    const quoteMinutes = Number.isFinite(parsedQuoteMinutes)
      ? Math.min(30, Math.max(1, parsedQuoteMinutes))
      : 10;
    const accentCandidate = String(appearanceObject.accent || raw.accent || "#f4bd2a").trim();
    const accent = /^#[0-9a-fA-F]{6}$/.test(accentCandidate) ? accentCandidate : "#f4bd2a";
    const centsText = usdCents.toString().padStart(3, "0");
    const usd = `${centsText.slice(0, -2)}.${centsText.slice(-2)}`;
    return Object.freeze({
      version: 1,
      merchant: cleanText(merchantObject.name || (typeof raw.merchant === "string" ? raw.merchant : "") || raw.siteName || raw.site_name, "DOGE Merchant", 80),
      address,
      offer: cleanText(orderObject.description || raw.offer || raw.item, "DOGE order", 80),
      usd,
      memo: cleanText(orderObject.memo || raw.memo, "Website DOGE order", 80),
      orderId: cleanText(orderObject.id || raw.orderId || raw.order_id, "", 100),
      minConfirmations,
      quoteMinutes,
      buttonText: cleanText(raw.buttonText || raw.button, "Continue with DOGE", 40),
      returnUrl: normalizeReturnUrl(behaviorObject.returnUrl || raw.returnUrl || raw.return_url),
      accent,
    });
  }

  function dogeUri(address, amount, memo) {
    if (!validAddressShape(address)) throw new Error("Enter a valid Dogecoin mainnet receiving address.");
    const atoms = dogeToAtoms(amount);
    const params = new URLSearchParams();
    if (atoms > 0n) params.set("amount", atomsToDoge(atoms));
    const safeMemo = cleanText(memo, "", 80);
    if (safeMemo) params.set("message", safeMemo);
    return `dogecoin:${address}${params.toString() ? `?${params.toString()}` : ""}`;
  }

  function transactionAfterStart(transaction, order) {
    const seenAt = Date.parse(transaction?.time || "");
    const startedAt = Date.parse(order?.payment_started_at || order?.paymentStartedAt || "");
    if (!Number.isFinite(startedAt)) return false;
    const baselineReady = order?.baseline_ready === true
      || order?.baselineReady === true
      || Array.isArray(order?.baseline_txids)
      || Array.isArray(order?.baselineTxids);
    // A trusted pre-payment baseline makes a newly appearing txid safe even
    // when a provider omits its mempool timestamp. Without that baseline,
    // fail closed unless a post-start timestamp proves the transaction is new.
    if (!Number.isFinite(seenAt)) return baselineReady;
    return seenAt >= startedAt - (baselineReady ? 60_000 : 0);
  }

  function transactionWithinExpiry(transaction, order, now = Date.now()) {
    const expiresAt = Date.parse(order?.quote_expires_at || order?.quoteExpiresAt || "");
    if (!Number.isFinite(expiresAt)) return true;
    const configuredGrace = Number(order?.expiry_grace_ms ?? order?.expiryGraceMs ?? 0);
    const grace = Number.isFinite(configuredGrace) ? Math.min(5 * 60_000, Math.max(0, configuredGrace)) : 0;
    const cutoff = expiresAt + grace;
    const seenAt = Date.parse(transaction?.time || "");
    return Number.isFinite(seenAt) ? seenAt <= cutoff : now <= cutoff;
  }

  function matchTransaction(transaction, order) {
    const txid = String(transaction?.txid || "").trim();
    if (!TXID.test(txid)) return "";
    const baseline = order?.baseline_txids || order?.baselineTxids || [];
    const ignored = order?.ignored_txids || order?.ignoredTxids || [];
    if (baseline.includes(txid) || ignored.includes(txid)) return "";
    if (!transactionAfterStart(transaction, order)) return "";
    if (!transactionWithinExpiry(transaction, order)) return "";
    let expectedAtoms;
    let receivedAtoms;
    try {
      expectedAtoms = order?.expectedAtoms != null
        ? BigInt(order.expectedAtoms)
        : dogeToAtoms(order?.doge || order?.expectedDoge || "0");
      receivedAtoms = dogeToAtoms(transaction?.doge || "0");
    } catch {
      return "";
    }
    if (expectedAtoms <= 0n || receivedAtoms <= 0n) return "";
    const difference = expectedAtoms >= receivedAtoms
      ? expectedAtoms - receivedAtoms
      : receivedAtoms - expectedAtoms;
    if (difference <= EXACT_TOLERANCE_ATOMS) return "exact";
    if (difference <= NEAR_MATCH_MARGIN_ATOMS) return "near";
    return "";
  }

  return Object.freeze({
    AUTO_FEE_ATOMS: AUTO_FEE_ATOMS.toString(),
    CUSTOMER_AMOUNT_QUANTUM_ATOMS: CUSTOMER_AMOUNT_QUANTUM_ATOMS.toString(),
    NEAR_MATCH_MARGIN_ATOMS: NEAR_MATCH_MARGIN_ATOMS.toString(),
    normalizeConfig,
    quotePayment,
    dogeUri,
    dogeToAtoms: (value) => dogeToAtoms(value).toString(),
    atomsToDoge,
    validAddressShape,
    transactionAfterStart,
    transactionWithinExpiry,
    matchTransaction,
  });
});
