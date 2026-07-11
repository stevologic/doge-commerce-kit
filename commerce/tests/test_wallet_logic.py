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