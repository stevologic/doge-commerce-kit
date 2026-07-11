(function (global) {
  const DOGE_ADDRESS_PREFIX = 0x1e;
  const DOGE_WIF_PREFIX = 0x9e;
  const DOGE_ATOMS = 100000000n;
  const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const SECP256K1_P = BigInt("0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f");
  const SECP256K1_N = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
  const SECP256K1_G = {
    x: BigInt("0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"),
    y: BigInt("0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8"),
  };
  const SIGHASH_ALL = 1;
  const TX_VERSION = 1;
  const DEFAULT_FEE_PER_BYTE = 1000;

  function bytesToHex(bytes) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function hexToBytes(hex) {
    const clean = String(hex || "").replace(/^0x/i, "");
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i += 1) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    return out;
  }

  function concatBytes(...arrays) {
    const length = arrays.reduce((sum, array) => sum + array.length, 0);
    const out = new Uint8Array(length);
    let offset = 0;
    arrays.forEach((array) => {
      out.set(array, offset);
      offset += array.length;
    });
    return out;
  }

  function bytesToBigInt(bytes) {
    return BigInt(`0x${bytesToHex(bytes) || "0"}`);
  }

  function bigIntTo32Bytes(value) {
    return hexToBytes(value.toString(16).padStart(64, "0"));
  }

  function bigIntTo8BytesLE(value) {
    const out = new Uint8Array(8);
    let current = value;
    for (let i = 0; i < 8; i += 1) {
      out[i] = Number(current & 0xffn);
      current >>= 8n;
    }
    return out;
  }

  function uint32LE(value) {
    const out = new Uint8Array(4);
    const view = new DataView(out.buffer);
    view.setUint32(0, value >>> 0, true);
    return out;
  }

  function mod(value, prime = SECP256K1_P) {
    const result = value % prime;
    return result >= 0n ? result : result + prime;
  }

  function modN(value) {
    return mod(value, SECP256K1_N);
  }

  function modInverse(value, prime = SECP256K1_P) {
    let a = mod(value, prime);
    let b = prime;
    let x = 0n;
    let y = 1n;
    let u = 1n;
    let v = 0n;
    while (a !== 0n) {
      const q = b / a;
      [x, u] = [u, x - u * q];
      [y, v] = [v, y - v * q];
      [b, a] = [a, b - a * q];
    }
    if (b !== 1n) throw new Error("Invalid modular inverse");
    return mod(x, prime);
  }

  function secpPointAdd(pointA, pointB) {
    if (!pointA) return pointB;
    if (!pointB) return pointA;
    if (pointA.x === pointB.x && mod(pointA.y + pointB.y) === 0n) return null;
    const slope = pointA.x === pointB.x && pointA.y === pointB.y
      ? mod((3n * pointA.x * pointA.x) * modInverse(2n * pointA.y))
      : mod((pointB.y - pointA.y) * modInverse(pointB.x - pointA.x));
    const x = mod(slope * slope - pointA.x - pointB.x);
    const y = mod(slope * (pointA.x - x) - pointA.y);
    return { x, y };
  }

  function secpScalarMultiply(scalar, point = SECP256K1_G) {
    let n = scalar;
    let result = null;
    let addend = point;
    while (n > 0n) {
      if (n & 1n) result = secpPointAdd(result, addend);
      addend = secpPointAdd(addend, addend);
      n >>= 1n;
    }
    if (!result) throw new Error("Invalid private key");
    return result;
  }

  async function sha256(bytes) {
    return new Uint8Array(await global.crypto.subtle.digest("SHA-256", bytes));
  }

  async function doubleSha256(bytes) {
    return sha256(await sha256(bytes));
  }

  function ripemd160(bytes) {
    const r1 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 7, 4, 13, 1, 10, 6, 15, 3, 12, 0, 9, 5, 2, 14, 11, 8, 3, 10, 14, 4, 9, 15, 8, 1, 2, 7, 0, 6, 13, 11, 5, 12, 1, 9, 11, 10, 0, 8, 12, 4, 13, 3, 7, 15, 14, 5, 6, 2, 4, 0, 5, 9, 7, 12, 2, 10, 14, 1, 3, 8, 11, 6, 15, 13];
    const r2 = [5, 14, 7, 0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12, 6, 11, 3, 7, 0, 13, 5, 10, 14, 15, 8, 12, 4, 9, 1, 2, 15, 5, 1, 3, 7, 14, 6, 9, 11, 8, 12, 2, 10, 0, 4, 13, 8, 6, 4, 1, 3, 11, 15, 0, 5, 12, 2, 13, 9, 7, 10, 14, 12, 15, 10, 4, 1, 5, 8, 7, 6, 2, 13, 14, 0, 3, 9, 11];
    const s1 = [11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8, 7, 6, 8, 13, 11, 9, 7, 15, 7, 12, 15, 9, 11, 7, 13, 12, 11, 13, 6, 7, 14, 9, 13, 15, 14, 8, 13, 6, 5, 12, 7, 5, 11, 12, 14, 15, 14, 15, 9, 8, 9, 14, 5, 6, 8, 6, 5, 12, 9, 15, 5, 11, 6, 8, 13, 12, 5, 12, 13, 14, 11, 8, 5, 6];
    const s2 = [8, 9, 9, 11, 13, 15, 15, 5, 7, 7, 8, 11, 14, 14, 12, 6, 9, 13, 15, 7, 12, 8, 9, 11, 7, 7, 12, 7, 6, 15, 13, 11, 9, 7, 15, 11, 8, 6, 6, 14, 12, 13, 5, 14, 13, 13, 7, 5, 15, 5, 8, 11, 14, 14, 6, 14, 6, 9, 12, 9, 12, 5, 15, 8, 8, 5, 12, 9, 12, 5, 14, 6, 8, 13, 6, 5, 15, 13, 11, 11];
    const kl = [0x00000000, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xa953fd4e];
    const kr = [0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x7a6d76e9, 0x00000000];
    const rotl = (value, bits) => ((value << bits) | (value >>> (32 - bits))) >>> 0;
    const f = (round, x, y, z) => {
      if (round < 16) return (x ^ y ^ z) >>> 0;
      if (round < 32) return ((x & y) | (~x & z)) >>> 0;
      if (round < 48) return ((x | ~y) ^ z) >>> 0;
      if (round < 64) return ((x & z) | (y & ~z)) >>> 0;
      return (x ^ (y | ~z)) >>> 0;
    };
    const bitLength = bytes.length * 8;
    const paddedLength = (((bytes.length + 8) >> 6) + 1) << 6;
    const padded = new Uint8Array(paddedLength);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    for (let i = 0; i < 8; i += 1) padded[padded.length - 8 + i] = Math.floor(bitLength / (2 ** (8 * i))) & 0xff;
    let h0 = 0x67452301;
    let h1 = 0xefcdab89;
    let h2 = 0x98badcfe;
    let h3 = 0x10325476;
    let h4 = 0xc3d2e1f0;
    for (let offset = 0; offset < padded.length; offset += 64) {
      const x = new Array(16);
      for (let i = 0; i < 16; i += 1) {
        x[i] = (padded[offset + i * 4] | (padded[offset + i * 4 + 1] << 8) | (padded[offset + i * 4 + 2] << 16) | (padded[offset + i * 4 + 3] << 24)) >>> 0;
      }
      let al = h0; let bl = h1; let cl = h2; let dl = h3; let el = h4;
      let ar = h0; let br = h1; let cr = h2; let dr = h3; let er = h4;
      for (let j = 0; j < 80; j += 1) {
        const tl = (rotl((al + f(j, bl, cl, dl) + x[r1[j]] + kl[Math.floor(j / 16)]) >>> 0, s1[j]) + el) >>> 0;
        al = el; el = dl; dl = rotl(cl, 10); cl = bl; bl = tl;
        const tr = (rotl((ar + f(79 - j, br, cr, dr) + x[r2[j]] + kr[Math.floor(j / 16)]) >>> 0, s2[j]) + er) >>> 0;
        ar = er; er = dr; dr = rotl(cr, 10); cr = br; br = tr;
      }
      const t = (h1 + cl + dr) >>> 0;
      h1 = (h2 + dl + er) >>> 0;
      h2 = (h3 + el + ar) >>> 0;
      h3 = (h4 + al + br) >>> 0;
      h4 = (h0 + bl + cr) >>> 0;
      h0 = t;
    }
    const out = new Uint8Array(20);
    [h0, h1, h2, h3, h4].forEach((word, index) => {
      out[index * 4] = word & 0xff;
      out[index * 4 + 1] = (word >>> 8) & 0xff;
      out[index * 4 + 2] = (word >>> 16) & 0xff;
      out[index * 4 + 3] = (word >>> 24) & 0xff;
    });
    return out;
  }

  async function hash160(bytes) {
    return ripemd160(await sha256(bytes));
  }

  function base58Encode(bytes) {
    let value = bytesToBigInt(bytes);
    let encoded = "";
    while (value > 0n) {
      const modValue = value % 58n;
      encoded = BASE58_ALPHABET[Number(modValue)] + encoded;
      value /= 58n;
    }
    for (const byte of bytes) {
      if (byte === 0) encoded = "1" + encoded;
      else break;
    }
    return encoded || "1";
  }

  function base58Decode(value) {
    let number = 0n;
    for (const char of String(value || "").trim()) {
      const index = BASE58_ALPHABET.indexOf(char);
      if (index < 0) throw new Error("Invalid Base58 character");
      number = number * 58n + BigInt(index);
    }
    let hex = number.toString(16);
    if (hex.length % 2) hex = `0${hex}`;
    let bytes = hex === "00" && number === 0n ? new Uint8Array() : hexToBytes(hex);
    let leading = 0;
    for (const char of String(value || "").trim()) {
      if (char === "1") leading += 1;
      else break;
    }
    if (leading) bytes = concatBytes(new Uint8Array(leading), bytes);
    return bytes;
  }

  async function base58CheckEncode(payload) {
    const checksum = (await sha256(await sha256(payload))).slice(0, 4);
    return base58Encode(concatBytes(payload, checksum));
  }

  async function base58CheckDecode(value) {
    const decoded = base58Decode(value);
    if (decoded.length < 5) throw new Error("Invalid Base58Check payload");
    const payload = decoded.slice(0, -4);
    const checksum = decoded.slice(-4);
    const expected = (await sha256(await sha256(payload))).slice(0, 4);
    if (!checksum.every((byte, index) => byte === expected[index])) throw new Error("Invalid checksum");
    return payload;
  }

  function encodeVarInt(value) {
    if (value < 0xfd) return new Uint8Array([value]);
    if (value <= 0xffff) return concatBytes(new Uint8Array([0xfd]), uint16LE(value));
    if (value <= 0xffffffff) return concatBytes(new Uint8Array([0xfe]), uint32LE(value));
    return concatBytes(new Uint8Array([0xff]), bigIntTo8BytesLE(BigInt(value)));
  }

  function uint16LE(value) {
    const out = new Uint8Array(2);
    out[0] = value & 0xff;
    out[1] = (value >>> 8) & 0xff;
    return out;
  }

  function reverseBytes(bytes) {
    return new Uint8Array([...bytes].reverse());
  }

  function dogeToAtoms(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a positive DOGE amount.");
    const atoms = BigInt(Math.round(amount * Number(DOGE_ATOMS)));
    if (atoms <= 0n) throw new Error("Amount is too small.");
    return atoms;
  }

  function atomsToDoge(atoms) {
    const value = Number(atoms) / Number(DOGE_ATOMS);
    return value.toFixed(8).replace(/\.?0+$/, "") || "0";
  }

  async function addressToHash160(address) {
    const payload = await base58CheckDecode(address);
    if (payload[0] !== DOGE_ADDRESS_PREFIX || payload.length !== 21) {
      throw new Error("Invalid Dogecoin address.");
    }
    return payload.slice(1);
  }

  async function p2pkhScript(address) {
    const hash = await addressToHash160(address);
    return concatBytes(new Uint8Array([0x76, 0xa9, 0x14]), hash, new Uint8Array([0x88, 0xac]));
  }

  async function walletFromPrivateKey(privateKeyBytes, compressed = true) {
    const scalar = bytesToBigInt(privateKeyBytes);
    if (scalar <= 0n || scalar >= SECP256K1_N) throw new Error("Invalid private key");
    const point = secpScalarMultiply(scalar);
    const x = bigIntTo32Bytes(point.x);
    const y = bigIntTo32Bytes(point.y);
    const publicKey = compressed
      ? concatBytes(new Uint8Array([(point.y & 1n) === 1n ? 0x03 : 0x02]), x)
      : concatBytes(new Uint8Array([0x04]), x, y);
    const address = await base58CheckEncode(concatBytes(new Uint8Array([DOGE_ADDRESS_PREFIX]), await hash160(publicKey)));
    const wif = await base58CheckEncode(concatBytes(new Uint8Array([DOGE_WIF_PREFIX]), privateKeyBytes, compressed ? new Uint8Array([0x01]) : new Uint8Array()));
    return { address, wif, public_key: bytesToHex(publicKey), compressed, generated_in: "browser" };
  }

  async function generateWallet() {
    if (!global.crypto?.getRandomValues || !global.crypto?.subtle) throw new Error("Browser crypto is unavailable.");
    let privateKey;
    let scalar = 0n;
    do {
      privateKey = global.crypto.getRandomValues(new Uint8Array(32));
      scalar = bytesToBigInt(privateKey);
    } while (scalar <= 0n || scalar >= SECP256K1_N);
    return walletFromPrivateKey(privateKey, true);
  }

  async function walletFromWif(wif) {
    const payload = await base58CheckDecode(wif);
    if (payload[0] !== DOGE_WIF_PREFIX) throw new Error("This is not a Dogecoin mainnet WIF private key");
    const compressed = payload.length === 34 && payload[payload.length - 1] === 0x01;
    const privateKey = compressed ? payload.slice(1, -1) : payload.slice(1);
    if (privateKey.length !== 32) throw new Error("Invalid private key length");
    return walletFromPrivateKey(privateKey, compressed);
  }

  function derEncodeSignature(r, s) {
    function encodeInteger(value) {
      let bytes = bigIntTo32Bytes(value);
      while (bytes.length > 1 && bytes[0] === 0 && (bytes[1] & 0x80) === 0) bytes = bytes.slice(1);
      if (bytes[0] & 0x80) bytes = concatBytes(new Uint8Array([0x00]), bytes);
      return concatBytes(new Uint8Array([0x02, bytes.length]), bytes);
    }
    const body = concatBytes(encodeInteger(r), encodeInteger(s));
    return concatBytes(new Uint8Array([0x30, body.length]), body);
  }

  async function ecdsaSignDigest(digest32, privateKeyBytes) {
    const d = bytesToBigInt(privateKeyBytes);
    const z = bytesToBigInt(digest32);
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const nonce = global.crypto.getRandomValues(new Uint8Array(32));
      const k = bytesToBigInt(nonce);
      if (k <= 0n || k >= SECP256K1_N) continue;
      const point = secpScalarMultiply(k);
      const r = modN(point.x);
      if (r === 0n) continue;
      const s = modN(modInverse(k, SECP256K1_N) * (z + r * d));
      if (s === 0n) continue;
      return derEncodeSignature(r, s);
    }
    throw new Error("Could not sign transaction.");
  }

  async function serializeTx(tx, includeWitness = false) {
    const parts = [uint32LE(tx.version)];
    parts.push(encodeVarInt(tx.inputs.length));
    tx.inputs.forEach((input) => {
      parts.push(reverseBytes(hexToBytes(input.txid)));
      parts.push(uint32LE(input.vout));
      parts.push(encodeVarInt(input.scriptSig.length));
      parts.push(input.scriptSig);
      parts.push(uint32LE(input.sequence));
    });
    parts.push(encodeVarInt(tx.outputs.length));
    tx.outputs.forEach((output) => {
      parts.push(bigIntTo8BytesLE(output.value));
      parts.push(encodeVarInt(output.script.length));
      parts.push(output.script);
    });
    parts.push(uint32LE(tx.locktime));
    if (includeWitness) throw new Error("Witness transactions are not supported.");
    return concatBytes(...parts);
  }

  async function legacySignatureHash(tx, inputIndex, scriptCode) {
    const clone = {
      version: tx.version,
      locktime: tx.locktime,
      inputs: tx.inputs.map((input, index) => ({
        txid: input.txid,
        vout: input.vout,
        sequence: input.sequence,
        scriptSig: index === inputIndex ? scriptCode : new Uint8Array(),
      })),
      outputs: tx.outputs.map((output) => ({ value: output.value, script: output.script })),
    };
    const base = await serializeTx(clone);
    const withHashType = concatBytes(base, uint32LE(SIGHASH_ALL));
    return doubleSha256(withHashType);
  }

  function estimateTxSize(inputCount, outputCount) {
    return 10 + inputCount * 148 + outputCount * 34;
  }

  function selectUtxos(utxos, targetAtoms, feePerByte = DEFAULT_FEE_PER_BYTE) {
    const sorted = [...utxos].sort((a, b) => Number(b.value - a.value));
    const selected = [];
    let total = 0n;
    for (const utxo of sorted) {
      selected.push(utxo);
      total += BigInt(utxo.value);
      const fee = BigInt(estimateTxSize(selected.length, 2) * feePerByte);
      if (total >= targetAtoms + fee) return { selected, fee };
    }
    throw new Error("Insufficient spendable balance for amount plus network fee.");
  }

  async function buildSignedTransaction({ utxos, fromAddress, toAddress, amountDoge, privateKeyHex, publicKeyHex, changeAddress, feePerByte = DEFAULT_FEE_PER_BYTE }) {
    const amountAtoms = dogeToAtoms(amountDoge);
    const { selected, fee } = selectUtxos(utxos, amountAtoms, feePerByte);
    const totalIn = selected.reduce((sum, utxo) => sum + BigInt(utxo.value), 0n);
    const change = totalIn - amountAtoms - fee;
    if (change < 0n) throw new Error("Insufficient balance.");
    const outputs = [{ value: amountAtoms, script: await p2pkhScript(toAddress) }];
    if (change > 0n) outputs.push({ value: change, script: await p2pkhScript(changeAddress || fromAddress) });
    const tx = {
      version: TX_VERSION,
      locktime: 0,
      inputs: selected.map((utxo) => ({
        txid: utxo.txid,
        vout: utxo.vout,
        sequence: 0xffffffff,
        scriptSig: new Uint8Array(),
        scriptPubKey: utxo.scriptPubKey,
      })),
      outputs,
    };
    const privateKeyBytes = hexToBytes(privateKeyHex);
    const publicKeyBytes = hexToBytes(publicKeyHex);
    for (let index = 0; index < tx.inputs.length; index += 1) {
      const scriptCode = tx.inputs[index].scriptPubKey || await p2pkhScript(fromAddress);
      const digest = await legacySignatureHash(tx, index, scriptCode);
      const signature = await ecdsaSignDigest(digest, privateKeyBytes);
      const sigWithHashType = concatBytes(signature, new Uint8Array([SIGHASH_ALL]));
      const scriptSig = concatBytes(
        new Uint8Array([sigWithHashType.length]),
        sigWithHashType,
        new Uint8Array([publicKeyBytes.length]),
        publicKeyBytes,
      );
      tx.inputs[index].scriptSig = scriptSig;
    }
    const raw = await serializeTx(tx);
    return {
      hex: bytesToHex(raw),
      feeDoge: atomsToDoge(fee),
      changeDoge: change > 0n ? atomsToDoge(change) : "0",
      inputCount: selected.length,
      outputCount: outputs.length,
    };
  }

  global.dogeWalletCore = {
    generateWallet,
    walletFromWif,
    walletFromPrivateKey,
    buildSignedTransaction,
    dogeToAtoms,
    atomsToDoge,
    addressToHash160,
    p2pkhScript,
    base58CheckDecode,
    base58CheckEncode,
    bytesToHex,
    hexToBytes,
    estimateTxSize,
    selectUtxos,
    DOGE_ATOMS,
  };
  global.dogeWalletLogic = global.dogeWalletCore;
})(typeof window !== "undefined" ? window : globalThis);