import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { webcrypto } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scratch = process.env.DOGE2MOON_SCRATCH || process.env.SCRATCH_DIR || "C:\\Users\\steph\\AppData\\Local\\Temp\\grok-goal-159df59e34f0\\implementer";
fs.mkdirSync(scratch, { recursive: true });

globalThis.window = globalThis;
globalThis.crypto = webcrypto;

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