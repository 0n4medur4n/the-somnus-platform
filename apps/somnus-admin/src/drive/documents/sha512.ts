/**
 * SHA-512 without awaiting, for one job: the 100 000 rounds Office's password
 * format asks for, which take seconds as separate WebCrypto calls and a tenth
 * of that here. Tests check it against WebCrypto. Use WebCrypto for anything else.
 */

function root(value: bigint, degree: 2n | 3n): bigint {
  // Integer Newton's method: the largest r with r^degree <= value.
  let r = 1n << (BigInt(value.toString(2).length) / degree + 1n);
  for (;;) {
    const next = ((degree - 1n) * r + value / r ** (degree - 1n)) / degree;
    if (next >= r) return r;
    r = next;
  }
}

function primes(count: number): bigint[] {
  const out: bigint[] = [];
  for (let n = 2; out.length < count; n++) {
    if (out.every((p) => BigInt(n) % p !== 0n)) out.push(BigInt(n));
  }
  return out;
}

/** The first 64 bits of the fractional part of each prime's square or cube root. */
function words(count: number, degree: 2n | 3n): Int32Array {
  const out = new Int32Array(count * 2);
  primes(count).forEach((p, i) => {
    const fraction = root(p << (64n * degree), degree) & 0xffffffffffffffffn;
    out[i * 2] = Number(fraction >> 32n) | 0;
    out[i * 2 + 1] = Number(fraction & 0xffffffffn) | 0;
  });
  return out;
}

const K = words(80, 3n);
const IV = words(8, 2n);

export function sha512Sync(message: Uint8Array): Uint8Array {
  const length = message.length;
  const total = Math.ceil((length + 17) / 128) * 128;
  const buffer = new Uint8Array(total);
  buffer.set(message);
  buffer[length] = 0x80;
  const view = new DataView(buffer.buffer);
  view.setUint32(total - 8, Math.floor(length / 0x20000000));
  view.setUint32(total - 4, (length * 8) >>> 0);

  const H = Int32Array.from(IV);
  const W = new Int32Array(160);
  for (let offset = 0; offset < total; offset += 128) {
    for (let t = 0; t < 32; t++) W[t] = view.getInt32(offset + t * 4);
    for (let t = 16; t < 80; t++) {
      // σ0 = rotr1 ^ rotr8 ^ shr7, σ1 = rotr19 ^ rotr61 ^ shr6
      const xh = W[(t - 15) * 2] as number;
      const xl = W[(t - 15) * 2 + 1] as number;
      const s0h = ((xh >>> 1) | (xl << 31)) ^ ((xh >>> 8) | (xl << 24)) ^ (xh >>> 7);
      const s0l = ((xl >>> 1) | (xh << 31)) ^ ((xl >>> 8) | (xh << 24)) ^ ((xl >>> 7) | (xh << 25));
      const yh = W[(t - 2) * 2] as number;
      const yl = W[(t - 2) * 2 + 1] as number;
      const s1h = ((yh >>> 19) | (yl << 13)) ^ ((yl >>> 29) | (yh << 3)) ^ (yh >>> 6);
      const s1l =
        ((yl >>> 19) | (yh << 13)) ^ ((yh >>> 29) | (yl << 3)) ^ ((yl >>> 6) | (yh << 26));
      // Several 32-bit halves add exactly as doubles; what overflows is the carry.
      const lo =
        ((W[(t - 16) * 2 + 1] as number) >>> 0) +
        (s0l >>> 0) +
        ((W[(t - 7) * 2 + 1] as number) >>> 0) +
        (s1l >>> 0);
      W[t * 2] =
        ((W[(t - 16) * 2] as number) +
          s0h +
          (W[(t - 7) * 2] as number) +
          s1h +
          Math.floor(lo / 0x100000000)) |
        0;
      W[t * 2 + 1] = lo | 0;
    }

    let ah = H[0] as number;
    let al = H[1] as number;
    let bh = H[2] as number;
    let bl = H[3] as number;
    let ch = H[4] as number;
    let cl = H[5] as number;
    let dh = H[6] as number;
    let dl = H[7] as number;
    let eh = H[8] as number;
    let el = H[9] as number;
    let fh = H[10] as number;
    let fl = H[11] as number;
    let gh = H[12] as number;
    let gl = H[13] as number;
    let hh = H[14] as number;
    let hl = H[15] as number;
    for (let t = 0; t < 80; t++) {
      // Σ1(e) = rotr14 ^ rotr18 ^ rotr41
      const S1h =
        ((eh >>> 14) | (el << 18)) ^ ((eh >>> 18) | (el << 14)) ^ ((el >>> 9) | (eh << 23));
      const S1l =
        ((el >>> 14) | (eh << 18)) ^ ((el >>> 18) | (eh << 14)) ^ ((eh >>> 9) | (el << 23));
      const chh = (eh & fh) ^ (~eh & gh);
      const chl = (el & fl) ^ (~el & gl);
      // temp1 = h + Σ1 + ch + K[t] + W[t]
      const t1sum =
        (hl >>> 0) +
        (S1l >>> 0) +
        (chl >>> 0) +
        ((K[t * 2 + 1] as number) >>> 0) +
        ((W[t * 2 + 1] as number) >>> 0);
      const t1h =
        (hh +
          S1h +
          chh +
          (K[t * 2] as number) +
          (W[t * 2] as number) +
          Math.floor(t1sum / 0x100000000)) |
        0;
      const t1l = t1sum >>> 0;
      // Σ0(a) = rotr28 ^ rotr34 ^ rotr39
      const S0h = ((ah >>> 28) | (al << 4)) ^ ((al >>> 2) | (ah << 30)) ^ ((al >>> 7) | (ah << 25));
      const S0l = ((al >>> 28) | (ah << 4)) ^ ((ah >>> 2) | (al << 30)) ^ ((ah >>> 7) | (al << 25));
      const majh = (ah & bh) ^ (ah & ch) ^ (bh & ch);
      const majl = (al & bl) ^ (al & cl) ^ (bl & cl);
      const t2sum = (S0l >>> 0) + (majl >>> 0);
      const t2h = (S0h + majh + (t2sum > 0xffffffff ? 1 : 0)) | 0;
      const t2l = t2sum >>> 0;

      hh = gh;
      hl = gl;
      gh = fh;
      gl = fl;
      fh = eh;
      fl = el;
      const esum = (dl >>> 0) + t1l;
      eh = (dh + t1h + (esum > 0xffffffff ? 1 : 0)) | 0;
      el = esum | 0;
      dh = ch;
      dl = cl;
      ch = bh;
      cl = bl;
      bh = ah;
      bl = al;
      const asum = t1l + t2l;
      ah = (t1h + t2h + (asum > 0xffffffff ? 1 : 0)) | 0;
      al = asum | 0;
    }

    const state = [ah, al, bh, bl, ch, cl, dh, dl, eh, el, fh, fl, gh, gl, hh, hl] as number[];
    for (let i = 0; i < 16; i += 2) {
      const sum = ((H[i + 1] as number) >>> 0) + ((state[i + 1] as number) >>> 0);
      H[i] = ((H[i] as number) + (state[i] as number) + (sum > 0xffffffff ? 1 : 0)) | 0;
      H[i + 1] = sum | 0;
    }
  }

  const out = new Uint8Array(64);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 16; i++) outView.setInt32(i * 4, H[i] as number);
  return out;
}
