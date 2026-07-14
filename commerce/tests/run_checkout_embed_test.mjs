import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const corePath = path.resolve(__dirname, "../static/commerce/js/doge_checkout_core.js");

// The browser build exposes a global, while Node may receive CommonJS exports.
// Supporting both here keeps the regression test aligned with the public embed
// and with a direct Node invocation.
globalThis.window = globalThis;
const imported = await import(pathToFileURL(corePath).href);
const core = imported.default
  || imported.DogeCheckoutCore
  || globalThis.DogeCheckoutCore
  || globalThis.dogeCheckoutCore;

assert.ok(core, "doge_checkout_core.js did not expose DogeCheckoutCore");
for (const name of [
  "normalizeConfig",
  "quotePayment",
  "dogeUri",
  "matchTransaction",
  "transactionAfterStart",
]) {
  assert.equal(typeof core[name], "function", `${name} must be exported by DogeCheckoutCore`);
}

function log(marker) {
  console.log(`checkoutEmbed.${marker}=true`);
}

async function expectRejectedConfig(input, description) {
  let rejected = false;
  try {
    const result = await core.normalizeConfig(input);
    rejected = Boolean(result && (result.valid === false || result.ok === false || result.error));
  } catch {
    rejected = true;
  }
  assert.equal(rejected, true, description);
}

const ADDRESS = "DTW2M5oEW97WbmYJRM71qD7uE6xfJs1MUK";
const normalized = await core.normalizeConfig({
  merchant: "  Acme\u0000 Coffee  ",
  address: `  ${ADDRESS}  `,
  usd: "5.00",
  memo: "  Coffee\u0007 & bagel  ",
  minConfirmations: "2",
  confirmations: "2",
});
assert.equal(normalized.address, ADDRESS);
assert.equal(Number(normalized.usd), 5);
assert.equal(Number(normalized.minConfirmations ?? normalized.confirmations), 2);
assert.equal(String(normalized.merchant).trim(), normalized.merchant);
assert.equal(String(normalized.memo).trim(), normalized.memo);
assert.equal(/[\u0000-\u001f\u007f]/.test(`${normalized.merchant}${normalized.memo}`), false);
const safeDefaults = await core.normalizeConfig({
  merchant: "Acme",
  address: ADDRESS,
  usd: "5.00",
  confirmations: "not-a-number",
  quoteMinutes: "not-a-number",
  returnUrl: "javascript:alert(1)",
});
assert.equal(safeDefaults.minConfirmations, 1);
assert.equal(safeDefaults.quoteMinutes, 10);
assert.equal(safeDefaults.returnUrl, "");
const nestedConfig = await core.normalizeConfig({
  merchant: { name: "Nested Merchant", address: ADDRESS },
  order: { description: "Nested order", usd: "12.34", memo: "Nested memo", id: "order-nested" },
  payment: { minConfirmations: 99, quoteMinutes: 99 },
  behavior: { returnUrl: "https://example.com/paid" },
  buttonText: "X".repeat(80),
});
assert.equal(nestedConfig.merchant, "Nested Merchant");
assert.equal(nestedConfig.offer, "Nested order");
assert.equal(nestedConfig.usd, "12.34");
assert.equal(nestedConfig.orderId, "order-nested");
assert.equal(nestedConfig.minConfirmations, 12);
assert.equal(nestedConfig.quoteMinutes, 30);
assert.equal(nestedConfig.returnUrl, "https://example.com/paid");
assert.equal(nestedConfig.buttonText.length, 40);
const lowerBounds = await core.normalizeConfig({
  address: ADDRESS,
  usd: "1.00",
  confirmations: -5,
  quoteMinutes: 0,
});
assert.equal(lowerBounds.minConfirmations, 0);
assert.equal(lowerBounds.quoteMinutes, 1);
await expectRejectedConfig(
  { merchant: "Acme", address: "not-a-dogecoin-address", usd: 5, memo: "Sale" },
  "normalizeConfig must reject an invalid receiving address",
);
await expectRejectedConfig(
  { merchant: "Acme", address: ADDRESS, usd: 0, memo: "Sale" },
  "normalizeConfig must reject a non-positive USD amount",
);
log("configValidation");

const quote = core.quotePayment({ usd: 5, rateUsd: 0.125 });
for (const key of ["baseAtoms", "feeAtoms", "totalAtoms"]) {
  assert.match(quote[key], /^\d+$/, `${key} must be a JSON-safe decimal atom string`);
}
for (const key of ["baseDoge", "feeDoge", "doge"]) {
  assert.match(quote[key], /^\d+\.\d{8}$/, `${key} must be a fixed-8 DOGE string`);
}

const baseAtoms = BigInt(quote.baseAtoms);
const feeAtoms = BigInt(quote.feeAtoms);
const totalAtoms = BigInt(quote.totalAtoms);
const rawFeeAtoms = 236_000n;
const customerQuantumAtoms = 10_000n;
const rawTotalAtoms = baseAtoms + rawFeeAtoms;
const expectedTotalAtoms = (
  (rawTotalAtoms + customerQuantumAtoms - 1n) / customerQuantumAtoms
) * customerQuantumAtoms;

assert.equal(baseAtoms, 4_000_000_000n);
assert.equal(totalAtoms, expectedTotalAtoms);
assert.equal(totalAtoms % customerQuantumAtoms, 0n);
assert.equal(feeAtoms, totalAtoms - baseAtoms);
assert.equal(feeAtoms, 240_000n);
assert.equal(quote.baseDoge, "40.00000000");
assert.equal(quote.feeDoge, "0.00240000");
assert.equal(quote.doge, "40.00240000");
log("integerFeeAndQuantum");

const memo = "Coffee & bagel #7";
const uri = core.dogeUri(ADDRESS, quote.doge, memo);
const [uriTarget, uriQuery = ""] = uri.split("?", 2);
const uriParams = new URLSearchParams(uriQuery);
assert.equal(uriTarget, `dogecoin:${ADDRESS}`);
assert.equal(uriParams.get("amount"), "40.00240000");
assert.equal(uriParams.get("message"), memo);
log("uriAmountAndMemo");

const startedAt = "2026-07-14T18:30:00.000Z";
const baselineTxid = "a".repeat(64);
const exactTxid = "b".repeat(64);
const order = {
  doge: quote.doge,
  expectedDoge: quote.doge,
  payment_started_at: startedAt,
  paymentStartedAt: startedAt,
  baseline_txids: [baselineTxid],
  baselineTxids: [baselineTxid],
  baseline_ready: true,
  quote_expires_at: "2099-07-14T18:40:00.000Z",
  expiry_grace_ms: 120000,
};
const transaction = (overrides = {}) => ({
  txid: exactTxid,
  doge: quote.doge,
  time: "2026-07-14T18:30:01.000Z",
  confirmations: 0,
  ...overrides,
});

assert.equal(core.transactionAfterStart(transaction(), order), true);
assert.equal(
  core.transactionAfterStart(transaction({ time: "2026-07-14T18:27:00.000Z" }), order),
  false,
);
assert.equal(core.matchTransaction(transaction({ txid: baselineTxid }), order), "");
assert.equal(core.matchTransaction(transaction({ time: "" }), order), "exact");
assert.equal(
  core.matchTransaction(transaction({ time: "2026-07-14T18:27:00.000Z" }), order),
  "",
);
log("baselineAndOldTransactionRejection");

assert.equal(core.matchTransaction(transaction(), order), "exact");
assert.equal(core.matchTransaction(transaction({ doge: "40.00239999" }), order), "exact");
assert.equal(core.matchTransaction(transaction({ doge: "39.50240000" }), order), "near");
assert.equal(core.matchTransaction(transaction({ doge: "39.00240000" }), order), "near");
assert.equal(core.matchTransaction(transaction({ doge: "39.00239999" }), order), "");
assert.equal(
  core.matchTransaction(
    transaction({ time: "2026-07-14T18:42:01.000Z" }),
    { ...order, quote_expires_at: "2026-07-14T18:40:00.000Z" },
  ),
  "",
);
log("exactAndNearMatching");

console.log("checkoutEmbed.all=true");
