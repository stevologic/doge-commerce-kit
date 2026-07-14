import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { webcrypto } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scratch = process.env.DOGE2MOON_SCRATCH || process.env.SCRATCH_DIR || "C:\\Users\\steph\\AppData\\Local\\Temp\\grok-goal-159df59e34f0\\implementer";
fs.mkdirSync(scratch, { recursive: true });

globalThis.window = globalThis;
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
}

const corePath = path.resolve(__dirname, "../static/commerce/js/wallet_core.js");
await import(pathToFileURL(corePath).href);

const core = globalThis.dogeWalletCore;
const lines = [];

function log(line) {
  lines.push(line);
  console.log(line);
}

const generated = await core.generateWallet();
log(`generateWallet.address=${generated.address}`);
log(`generateWallet.wif.prefix=${generated.wif[0]}`);
log(`generateWallet.public_key.length=${generated.public_key.length}`);

const imported = await core.walletFromWif(generated.wif);
log(`walletFromWif.matches=${imported.address === generated.address}`);

const backup = await core.parseWalletBackupJson(JSON.stringify({
  schema: "doge-commerce-wallet-backup",
  version: 1,
  network: "dogecoin-mainnet",
  address: generated.address,
  wif: generated.wif,
  public_key: generated.public_key,
  compressed: generated.compressed,
}));
assert.equal(backup.address, generated.address);
assert.equal(backup.public_key, generated.public_key);
assert.equal(Object.hasOwn(backup, "wif"), false);
log(`walletBackup.matches=${backup.address === generated.address}`);
log(`walletBackup.secretReturned=${Object.hasOwn(backup, "wif")}`);

const secondWallet = await core.walletFromPrivateKey(new Uint8Array(32).fill(2), true);
await assert.rejects(
  core.parseWalletBackupJson(JSON.stringify({ address: generated.address, wif: secondWallet.wif })),
  /does not match/,
);
log("walletBackup.mismatchRejected=true");

let networkCalls = 0;
globalThis.fetch = async () => {
  networkCalls += 1;
  throw new Error("Wallet import must not use the network");
};
const dogeToolsPath = path.resolve(__dirname, "../static/commerce/js/doge_tools.js");
const dogeToolsSource = fs.readFileSync(dogeToolsPath, "utf8");
const postStartTimestampSource = dogeToolsSource.slice(
  dogeToolsSource.indexOf("  function posTransactionHasPostStartTimestamp"),
  dogeToolsSource.indexOf("  function posTransactionMatchQuality"),
).trim();
const hasPostStartTimestamp = (0, eval)(`(${postStartTimestampSource})`);
const paymentStart = { payment_started_at: "2026-07-14T18:30:00Z" };
assert.equal(hasPostStartTimestamp({ time: "2026-07-14T18:30:01Z" }, paymentStart), true);
assert.equal(hasPostStartTimestamp({ time: "2026-07-14T18:29:30Z" }, paymentStart), false);
assert.equal(hasPostStartTimestamp({ time: "2026-07-14T18:28:00Z" }, paymentStart), false);
assert.equal(hasPostStartTimestamp({ time: "" }, paymentStart), false);
log("posPayment.postStartBroadcast=true");
const importSection = dogeToolsSource.slice(
  dogeToolsSource.indexOf("  function setPosWalletImportStatus"),
  dogeToolsSource.indexOf("  function updatePosProfileStatus"),
);
const importControllerSection = dogeToolsSource.slice(
  dogeToolsSource.indexOf('    $id("posImportWallet")?.addEventListener'),
  dogeToolsSource.indexOf("    initPosMemoTypeahead();"),
);
for (const section of [importSection, importControllerSection]) {
  assert.equal(section.includes("fetch("), false);
  assert.equal(section.includes("XMLHttpRequest"), false);
  assert.equal(section.includes("sendBeacon"), false);
  assert.equal(section.includes('setItem("doge-wallet:wif"'), false);
}
const processSource = dogeToolsSource.slice(
  dogeToolsSource.indexOf("  async function processPosWalletImportFile"),
  dogeToolsSource.indexOf("  function persistPosImportedWallet"),
).trim();
const persistSource = dogeToolsSource.slice(
  dogeToolsSource.indexOf("  function persistPosImportedWallet"),
  dogeToolsSource.indexOf("  function applyPendingPosWalletImport"),
).trim();
const processFileInput = (0, eval)(`(${processSource})`);
const persistImportedWallet = (0, eval)(`(${persistSource})`);

const storageData = new Map([
  ["doge-wallet:address", generated.address],
  ["doge-pos:wallet", generated.address],
  ["doge-wallet:wif", "legacy-secret"],
]);
const storage = {
  getItem(key) { return storageData.get(key) || null; },
  setItem(key, value) { storageData.set(key, String(value)); },
  removeItem(key) { storageData.delete(key); },
};

const selectedFile = { name: "wallet.json", size: 128 };
const successInput = { files: [selectedFile], value: "selected" };
let preparedFile = null;
assert.equal(await processFileInput(successInput, async (file) => { preparedFile = file; }), true);
assert.equal(preparedFile, selectedFile);
assert.equal(successInput.value, "");

const failedInput = { files: [selectedFile], value: "selected" };
await assert.rejects(
  processFileInput(failedInput, async () => core.parseWalletBackupJson(JSON.stringify({
    address: generated.address,
    wif: secondWallet.wif,
  }))),
  /does not match/,
);
assert.equal(failedInput.value, "");
assert.equal(storageData.get("doge-wallet:address"), generated.address);
assert.equal(storageData.get("doge-pos:wallet"), generated.address);
persistImportedWallet({ address: generated.address, clearLegacyWif: true }, "Test Merchant", storage);
assert.equal(storageData.get("doge-wallet:address"), generated.address);
assert.equal(storageData.get("doge-pos:wallet"), generated.address);
assert.equal(storageData.get("doge-pos:merchant"), "Test Merchant");
assert.equal(storageData.has("doge-wallet:wif"), false);
assert.equal([...storageData.values()].some((value) => value.includes(generated.wif)), false);
assert.equal(networkCalls, 0);
log("walletBackup.fileInputReset=true");
log("walletBackup.publicOnlyPersistence=true");
log("walletBackup.networkCalls=0");

const hash = await core.addressToHash160(generated.address);
log(`addressToHash160.length=${hash.length}`);

const atoms = core.dogeToAtoms("1.5");
log(`dogeToAtoms.1.5=${atoms.toString()}`);

const wifPayload = await core.base58CheckDecode(generated.wif);
const privateKeyBytes = wifPayload.length === 34 ? wifPayload.slice(1, -1) : wifPayload.slice(1);
const utxos = [{
  txid: "a".repeat(64),
  vout: 0,
  value: Number(atoms) + 200000000,
  scriptPubKey: await core.p2pkhScript(generated.address),
}];
const tx = await core.buildSignedTransaction({
  utxos,
  fromAddress: generated.address,
  toAddress: generated.address,
  amountDoge: 1.5,
  privateKeyHex: core.bytesToHex(privateKeyBytes),
  publicKeyHex: generated.public_key,
  changeAddress: generated.address,
  feePerByte: 1000,
});
log(`buildSignedTransaction.hex.length=${tx.hex.length}`);
log(`buildSignedTransaction.feeDoge=${tx.feeDoge}`);

const outPath = path.join(scratch, "wallet-logic.txt");
fs.writeFileSync(outPath, `${lines.join("\n")}\n`);
log(`saved=${outPath}`);
