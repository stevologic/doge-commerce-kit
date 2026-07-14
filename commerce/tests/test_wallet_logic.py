import json
from pathlib import Path

from django.test import SimpleTestCase
from py_mini_racer import MiniRacer

from commerce.tests.crypto_polyfill import CRYPTO_POLYFILL


ROOT = Path(__file__).resolve().parents[1]
from commerce.tests.scratch_path import scratch_dir

SCRATCH = scratch_dir()
CORE_JS = ROOT / "static" / "commerce" / "js" / "wallet_core.js"


class WalletLogicTests(SimpleTestCase):
    def test_generate_import_and_sign_paths(self):
        ctx = MiniRacer()
        ctx.eval(CRYPTO_POLYFILL + CORE_JS.read_text(encoding="utf-8"))
        promise = ctx.eval("""
          (async () => {
            const wallet = await window.dogeWalletCore.generateWallet();
            const imported = await window.dogeWalletCore.walletFromWif(wallet.wif);
            const atoms = window.dogeWalletCore.dogeToAtoms("1.5");
            const wifPayload = await window.dogeWalletCore.base58CheckDecode(wallet.wif);
            const privateKeyBytes = wifPayload.length === 34 ? wifPayload.slice(1, -1) : wifPayload.slice(1);
            const privateKeyHex = window.dogeWalletCore.bytesToHex(privateKeyBytes);
            const utxos = [{
              txid: "a".repeat(64),
              vout: 0,
              value: Number(atoms) + 200000000,
              scriptPubKey: await window.dogeWalletCore.p2pkhScript(wallet.address),
            }];
            const signed = await window.dogeWalletCore.buildSignedTransaction({
              utxos,
              fromAddress: wallet.address,
              toAddress: wallet.address,
              amountDoge: 1.5,
              privateKeyHex,
              publicKeyHex: wallet.public_key,
              changeAddress: wallet.address,
              feePerByte: 1000,
            });
            return JSON.stringify({
              address: wallet.address,
              importedMatch: imported.address === wallet.address,
              atoms: String(atoms),
              hexLength: signed.hex.length,
              feeDoge: signed.feeDoge,
            });
          })()
        """)
        generated = json.loads(promise.get(timeout=30))
        self.assertTrue(generated["address"].startswith("D"))
        self.assertTrue(generated["importedMatch"])
        self.assertGreater(generated["hexLength"], 120)

        SCRATCH.mkdir(parents=True, exist_ok=True)
        lines = [
            f"generateWallet.address={generated['address']}",
            f"walletFromWif.matches={generated['importedMatch']}",
            f"dogeToAtoms.1.5={generated['atoms']}",
            f"buildSignedTransaction.hex.length={generated['hexLength']}",
            f"buildSignedTransaction.feeDoge={generated['feeDoge']}",
        ]
        (SCRATCH / "wallet-logic.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")

    def test_wallet_backup_json_is_verified_and_sanitized(self):
        ctx = MiniRacer()
        ctx.eval(CRYPTO_POLYFILL + CORE_JS.read_text(encoding="utf-8"))
        promise = ctx.eval("""
          (async () => {
            const wallet = await window.dogeWalletCore.generateWallet();
            const other = await window.dogeWalletCore.walletFromPrivateKey(new Uint8Array(32).fill(2), true);
            const valid = await window.dogeWalletCore.parseWalletBackupJson(JSON.stringify({
              schema: "doge-commerce-wallet-backup",
              version: 1,
              network: "dogecoin-mainnet",
              address: wallet.address,
              wif: wallet.wif,
              public_key: wallet.public_key,
              compressed: wallet.compressed,
            }));
            const legacy = await window.dogeWalletCore.parseWalletBackupJson(JSON.stringify({
              address: wallet.address,
              wallet: {
                address: wallet.address,
                wif: wallet.wif,
                public_key: wallet.public_key,
                compressed: wallet.compressed,
              },
            }));
            async function rejection(raw) {
              try {
                await window.dogeWalletCore.parseWalletBackupJson(raw);
                return "accepted";
              } catch (error) {
                return String(error.message || error);
              }
            }
            const errors = {
              malformed: await rejection("{bad json"),
              array: await rejection("[]"),
              missingWif: await rejection(JSON.stringify({ address: wallet.address })),
              mismatch: await rejection(JSON.stringify({ address: wallet.address, wif: other.wif })),
              publicKey: await rejection(JSON.stringify({ address: wallet.address, wif: wallet.wif, public_key: other.public_key })),
              compressed: await rejection(JSON.stringify({ address: wallet.address, wif: wallet.wif, compressed: !wallet.compressed })),
              network: await rejection(JSON.stringify({ address: wallet.address, wif: wallet.wif, network: "dogecoin-testnet" })),
              conflict: await rejection(JSON.stringify({
                address: wallet.address,
                wif: wallet.wif,
                wallet: { address: other.address, wif: other.wif },
              })),
              oversized: await rejection(" ".repeat(65537)),
            };
            return JSON.stringify({
              address: wallet.address,
              publicKey: wallet.public_key,
              valid,
              legacy,
              errors,
              leakedSecret: JSON.stringify({ valid, legacy, errors }).includes(wallet.wif)
                || JSON.stringify(errors).includes(other.wif),
            });
          })()
        """)
        result = json.loads(promise.get(timeout=30))
        self.assertEqual(result["valid"]["address"], result["address"])
        self.assertEqual(result["legacy"]["address"], result["address"])
        self.assertEqual(result["valid"]["public_key"], result["publicKey"])
        self.assertTrue(result["valid"]["has_private_key"])
        self.assertNotIn("wif", result["valid"])
        self.assertNotIn("wif", result["legacy"])
        self.assertFalse(result["leakedSecret"])
        for name, message in result["errors"].items():
            self.assertNotEqual(message, "accepted", name)
