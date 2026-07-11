CRYPTO_POLYFILL = r"""
async function __sha256__(bytes) {
  const K = [
    1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,
    3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,
    3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,
    2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,
    666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,
    2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,
    430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,
    1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298
  ];
  const l = bytes.length * 8;
  const withOne = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  withOne.set(bytes);
  withOne[bytes.length] = 0x80;
  const view = new DataView(withOne.buffer);
  view.setUint32(withOne.length - 4, l >>> 0, false);
  view.setUint32(withOne.length - 8, Math.floor(l / 0x100000000), false);
  let h0=1779033703,h1=3144134277,h2=1013904242,h3=2773480762,h4=1359893119,h5=2600822924,h6=528734635,h7=1541459225;
  for (let offset = 0; offset < withOne.length; offset += 64) {
    const w = new Array(64);
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rightRotate(w[i-15],7)^rightRotate(w[i-15],18)^(w[i-15]>>>3);
      const s1 = rightRotate(w[i-2],17)^rightRotate(w[i-2],19)^(w[i-2]>>>10);
      w[i] = (w[i-16]+s0+w[i-7]+s1)>>>0;
    }
    let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rightRotate(e,6)^rightRotate(e,11)^rightRotate(e,25);
      const ch = (e&f)^((~e)&g);
      const t1 = (h+S1+ch+K[i]+w[i])>>>0;
      const S0 = rightRotate(a,2)^rightRotate(a,13)^rightRotate(a,22);
      const maj = (a&b)^(a&c)^(b&c);
      const t2 = (S0+maj)>>>0;
      h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
    }
    h0=(h0+a)>>>0; h1=(h1+b)>>>0; h2=(h2+c)>>>0; h3=(h3+d)>>>0;
    h4=(h4+e)>>>0; h5=(h5+f)>>>0; h6=(h6+g)>>>0; h7=(h7+h)>>>0;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  [h0,h1,h2,h3,h4,h5,h6,h7].forEach((v,i)=>outView.setUint32(i*4,v,false));
  return out;
  function rightRotate(value, amount) { return ((value>>>amount)|(value<<(32-amount)))>>>0; }
}
var window = globalThis;
var crypto = {
  subtle: {
    digest: async function(_algo, buf) {
      const hash = await __sha256__(new Uint8Array(buf));
      const copy = new Uint8Array(hash.length);
      copy.set(hash);
      return copy.buffer;
    }
  },
  getRandomValues: function(arr) {
    for (let i = 0; i < arr.length; i++) arr[i] = (i * 53 + 17) % 256;
    return arr;
  }
};
"""