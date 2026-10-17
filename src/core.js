/* ---- Farm Decal Swapper core: DDS decode/encode, i3d + shapes reading, mod analysis ---- */
const Core = (() => {
'use strict';

/* ================= DDS ================= */
const FOURCC = s => s.charCodeAt(0) | (s.charCodeAt(1) << 8) | (s.charCodeAt(2) << 16) | (s.charCodeAt(3) << 24);

function ddsInfo(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.length < 128 || dv.getUint32(0, true) !== 0x20534444) return { error: 'not a DDS file' };
  const height = dv.getUint32(12, true), width = dv.getUint32(16, true);
  const mips = Math.max(1, dv.getUint32(28, true));
  const pfFlags = dv.getUint32(80, true), fourCC = dv.getUint32(84, true);
  const bitCount = dv.getUint32(88, true);
  const masks = [92, 96, 100, 104].map(o => dv.getUint32(o, true));
  let fmt = null, dataOff = 128;
  if (pfFlags & 4) {
    if (fourCC === FOURCC('DXT1')) fmt = 'BC1';
    else if (fourCC === FOURCC('DXT3') || fourCC === FOURCC('DXT2')) fmt = 'BC2';
    else if (fourCC === FOURCC('DXT5') || fourCC === FOURCC('DXT4')) fmt = 'BC3';
    else if (fourCC === FOURCC('ATI1') || fourCC === FOURCC('BC4U')) fmt = 'BC4';
    else if (fourCC === FOURCC('ATI2') || fourCC === FOURCC('BC5U')) fmt = 'BC5';
    else if (fourCC === FOURCC('DX10')) {
      const dx = dv.getUint32(128, true); dataOff = 148;
      fmt = ({ 71: 'BC1', 72: 'BC1', 74: 'BC2', 75: 'BC2', 77: 'BC3', 78: 'BC3', 80: 'BC4', 83: 'BC5', 98: 'BC7', 99: 'BC7',
               28: 'RGBA8', 29: 'RGBA8', 87: 'BGRA8', 91: 'BGRA8', 88: 'BGRX8' })[dx] || ('DXGI ' + dx);
    } else fmt = 'FourCC ' + String.fromCharCode(fourCC & 255, (fourCC >> 8) & 255, (fourCC >> 16) & 255, (fourCC >> 24) & 255);
  } else if (pfFlags & 0x40) {
    fmt = { kind: 'masked', bitCount, masks, hasAlpha: !!(pfFlags & 1) };
  }
  return { width, height, mips, fmt, dataOff };
}

function bc1Colors(u8, o, out, forceFour) {
  const c0 = u8[o] | (u8[o + 1] << 8), c1 = u8[o + 2] | (u8[o + 3] << 8);
  const ex = c => [((c >> 11) & 31) * 255 / 31 + .5 | 0, ((c >> 5) & 63) * 255 / 63 + .5 | 0, (c & 31) * 255 / 31 + .5 | 0];
  const a = ex(c0), b = ex(c1);
  out[0] = [a[0], a[1], a[2], 255]; out[1] = [b[0], b[1], b[2], 255];
  if (c0 > c1 || forceFour) {
    out[2] = [(2 * a[0] + b[0]) / 3 | 0, (2 * a[1] + b[1]) / 3 | 0, (2 * a[2] + b[2]) / 3 | 0, 255];
    out[3] = [(a[0] + 2 * b[0]) / 3 | 0, (a[1] + 2 * b[1]) / 3 | 0, (a[2] + 2 * b[2]) / 3 | 0, 255];
  } else {
    out[2] = [(a[0] + b[0]) >> 1, (a[1] + b[1]) >> 1, (a[2] + b[2]) >> 1, 255];
    out[3] = [0, 0, 0, 0];
  }
}

const W2 = [0, 21, 43, 64], W3 = [0, 9, 18, 27, 37, 46, 55, 64], W4 = [0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64];
const BC7_RGB_BITS = [4, 6, 5, 7, 5, 7, 7, 5], BC7_A_BITS = [0, 0, 0, 0, 6, 8, 7, 5], BC7_PB = 0b11001011;
function bc7Block(u8, o, px) { // px: 64-byte Uint8Array output, row-major 4x4 RGBA
  let pos = 0;
  const bit = () => { const v = (u8[o + (pos >> 3)] >> (pos & 7)) & 1; pos++; return v; };
  const bits = n => { let v = 0; for (let k = 0; k < n; k++) v |= bit() << k; return v; };
  let mode = 0; while (mode < 8 && bit() === 0) mode++;
  if (mode >= 8) { px.fill(0); return; }
  let partition = 0, nP = 1, rotation = 0, isb = 0;
  if (mode === 0 || mode === 1 || mode === 2 || mode === 3 || mode === 7) { nP = (mode === 0 || mode === 2) ? 3 : 2; partition = bits(mode === 0 ? 4 : 6); }
  const nE = nP * 2, ep = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  if (mode === 4 || mode === 5) { rotation = bits(2); if (mode === 4) isb = bit(); }
  for (let c = 0; c < 3; c++) for (let e = 0; e < nE; e++) ep[e][c] = bits(BC7_RGB_BITS[mode]);
  if (BC7_A_BITS[mode]) for (let e = 0; e < nE; e++) ep[e][3] = bits(BC7_A_BITS[mode]);
  if (BC7_PB & (1 << mode)) {
    for (let e = 0; e < nE; e++) for (let c = 0; c < 4; c++) ep[e][c] <<= 1;
    if (mode === 1) { const p0 = bit(), p1 = bit(); for (let c = 0; c < 3; c++) { ep[0][c] |= p0; ep[1][c] |= p0; ep[2][c] |= p1; ep[3][c] |= p1; } }
    else for (let e = 0; e < nE; e++) { const p = bit(); for (let c = 0; c < 4; c++) ep[e][c] |= p; }
  }
  const pb = (BC7_PB >> mode) & 1;
  for (let e = 0; e < nE; e++) {
    let j = BC7_RGB_BITS[mode] + pb;
    for (let c = 0; c < 3; c++) { ep[e][c] = (ep[e][c] << (8 - j)) & 255; ep[e][c] |= ep[e][c] >> j; }
    j = BC7_A_BITS[mode] + pb;
    ep[e][3] = (ep[e][3] << (8 - j)) & 255; ep[e][3] |= ep[e][3] >> j;
  }
  if (!BC7_A_BITS[mode]) for (let e = 0; e < nE; e++) ep[e][3] = 255;
  const ib = (mode === 0 || mode === 1) ? 3 : (mode === 6 ? 4 : 2);
  const ib2 = mode === 4 ? 3 : (mode === 5 ? 2 : 0);
  const w1 = ib === 2 ? W2 : ib === 3 ? W3 : W4, w2 = ib2 === 2 ? W2 : W3;
  const table = nP === 2 ? BC7P2 : BC7P3;
  const idx = new Array(16);
  for (let p = 0; p < 16; p++) {
    const ps = nP === 1 ? (p ? 0 : 128) : table[partition * 16 + p];
    idx[p] = bits(ps & 0x80 ? ib - 1 : ib);
  }
  const ip = (a, b, w, i) => ((64 - w[i]) * a + w[i] * b + 32) >> 6;
  for (let p = 0; p < 16; p++) {
    const s = (nP === 1 ? 0 : table[partition * 16 + p]) & 3, e0 = ep[s * 2], e1 = ep[s * 2 + 1];
    let r, g, b, a; const i = idx[p];
    if (!ib2) { r = ip(e0[0], e1[0], w1, i); g = ip(e0[1], e1[1], w1, i); b = ip(e0[2], e1[2], w1, i); a = ip(e0[3], e1[3], w1, i); }
    else {
      const i2 = bits(p ? ib2 : ib2 - 1);
      if (!isb) { r = ip(e0[0], e1[0], w1, i); g = ip(e0[1], e1[1], w1, i); b = ip(e0[2], e1[2], w1, i); a = ip(e0[3], e1[3], w2, i2); }
      else { r = ip(e0[0], e1[0], w2, i2); g = ip(e0[1], e1[1], w2, i2); b = ip(e0[2], e1[2], w2, i2); a = ip(e0[3], e1[3], w1, i); }
    }
    if (rotation === 1) [a, r] = [r, a]; else if (rotation === 2) [a, g] = [g, a]; else if (rotation === 3) [a, b] = [b, a];
    px[p * 4] = r; px[p * 4 + 1] = g; px[p * 4 + 2] = b; px[p * 4 + 3] = a;
  }
}

function bc3Alpha(u8, o, out) { // fills out[16] alpha values
  const a0 = u8[o], a1 = u8[o + 1], pal = [a0, a1];
  if (a0 > a1) for (let k = 1; k < 7; k++) pal.push(((7 - k) * a0 + k * a1) / 7 | 0);
  else { for (let k = 1; k < 5; k++) pal.push(((5 - k) * a0 + k * a1) / 5 | 0); pal.push(0, 255); }
  let lo = u8[o + 2] | (u8[o + 3] << 8) | (u8[o + 4] << 16), hi = u8[o + 5] | (u8[o + 6] << 8) | (u8[o + 7] << 16);
  for (let p = 0; p < 16; p++) { const v = p < 8 ? (lo >> (3 * p)) & 7 : (hi >> (3 * (p - 8))) & 7; out[p] = pal[v]; }
}

/** Decode the top mip of a DDS to RGBA. Returns {width,height,format,rgba} or {error}. */
function decodeDDS(u8, opts) {
  const info = ddsInfo(u8);
  if (info.error) return info;
  let { width: W, height: H, dataOff } = info; const fmt = info.fmt;
  if (opts && opts.maxSize && typeof fmt === 'string' && /^BC[1-7]$/.test(fmt)) { // skip to the first mip that fits
    const bs = fmt === 'BC1' || fmt === 'BC4' ? 8 : 16;
    for (let m = 0; m < info.mips - 1 && Math.max(W, H) > opts.maxSize; m++) { dataOff += Math.max(1, (W + 3) >> 2) * Math.max(1, (H + 3) >> 2) * bs; W = Math.max(1, W >> 1); H = Math.max(1, H >> 1); }
  }
  const rgba = new Uint8ClampedArray(W * H * 4);
  const fmtName = typeof fmt === 'string' ? fmt : (fmt ? 'RGB' + (fmt.hasAlpha ? 'A' : '') + fmt.bitCount : 'unknown');
  const bw = Math.max(1, (W + 3) >> 2), bh = Math.max(1, (H + 3) >> 2);
  const put = (bx, by, px) => {
    for (let y = 0; y < 4; y++) { const yy = by * 4 + y; if (yy >= H) break;
      for (let x = 0; x < 4; x++) { const xx = bx * 4 + x; if (xx >= W) break;
        const d = (yy * W + xx) * 4, s = (y * 4 + x) * 4; rgba[d] = px[s]; rgba[d + 1] = px[s + 1]; rgba[d + 2] = px[s + 2]; rgba[d + 3] = px[s + 3]; } }
  };
  const px = new Uint8Array(64), pal = [], al = new Array(16);
  let o = dataOff;
  if (fmt === 'BC1' || fmt === 'BC2' || fmt === 'BC3') {
    const bs = fmt === 'BC1' ? 8 : 16;
    if (o + bw * bh * bs > u8.length) return { error: 'file is truncated' };
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++, o += bs) {
      const co = fmt === 'BC1' ? o : o + 8;
      bc1Colors(u8, co, pal, fmt !== 'BC1');
      const bitsv = u8[co + 4] | (u8[co + 5] << 8) | (u8[co + 6] << 16) | (u8[co + 7] << 24);
      if (fmt === 'BC3') bc3Alpha(u8, o, al);
      for (let p = 0; p < 16; p++) {
        const c = pal[(bitsv >>> (2 * p)) & 3];
        px[p * 4] = c[0]; px[p * 4 + 1] = c[1]; px[p * 4 + 2] = c[2];
        px[p * 4 + 3] = fmt === 'BC1' ? c[3] : fmt === 'BC3' ? al[p] : ((u8[o + (p >> 1)] >> ((p & 1) * 4)) & 15) * 17;
      }
      put(bx, by, px);
    }
  } else if (fmt === 'BC7') {
    if (o + bw * bh * 16 > u8.length) return { error: 'file is truncated' };
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++, o += 16) { bc7Block(u8, o, px); put(bx, by, px); }
  } else if (fmt === 'RGBA8' || fmt === 'BGRA8' || fmt === 'BGRX8') {
    for (let i = 0; i < W * H; i++, o += 4) {
      const sw = fmt !== 'RGBA8';
      rgba[i * 4] = u8[o + (sw ? 2 : 0)]; rgba[i * 4 + 1] = u8[o + 1]; rgba[i * 4 + 2] = u8[o + (sw ? 0 : 2)];
      rgba[i * 4 + 3] = fmt === 'BGRX8' ? 255 : u8[o + 3];
    }
  } else if (fmt && fmt.kind === 'masked' && (fmt.bitCount === 32 || fmt.bitCount === 24)) {
    const bpp = fmt.bitCount / 8, sh = m => { if (!m) return [0, 0]; let s = 0; while (!((m >>> s) & 1)) s++; let n = 0; while ((m >>> (s + n)) & 1) n++; return [s, n]; };
    const S = fmt.masks.map(sh);
    for (let i = 0; i < W * H; i++, o += bpp) {
      const v = (u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (bpp === 4 ? (u8[o + 3] << 24) : 0)) >>> 0;
      for (let c = 0; c < 4; c++) {
        const [s, n] = S[c];
        rgba[i * 4 + c] = n ? ((v >>> s) & ((1 << n) - 1)) * 255 / ((1 << n) - 1) : (c === 3 ? 255 : 0);
      }
      if (!fmt.hasAlpha) rgba[i * 4 + 3] = 255;
    }
  } else return { width: W, height: H, format: fmtName, error: 'can’t preview ' + fmtName + ' textures (usually normal or mask maps)' };
  return { width: W, height: H, format: fmtName, rgba };
}

/* ---- DXT5 (BC3) encoder with mipmaps ---- */
function encodeBC3Block(px, out, oo) { // px: 64 bytes RGBA, writes 16 bytes
  // alpha
  let amin = 255, amax = 0;
  for (let p = 0; p < 16; p++) { const a = px[p * 4 + 3]; if (a < amin) amin = a; if (a > amax) amax = a; }
  out[oo] = amax; out[oo + 1] = amin;
  const apal = [amax, amin]; for (let k = 1; k < 7; k++) apal.push(((7 - k) * amax + k * amin) / 7 | 0);
  let lo = 0, hi = 0;
  for (let p = 0; p < 16; p++) {
    let best = 0, bd = 1e9; const a = px[p * 4 + 3];
    if (amax !== amin) for (let k = 0; k < 8; k++) { const d = Math.abs(apal[k] - a); if (d < bd) { bd = d; best = k; } }
    if (p < 8) lo |= best << (3 * p); else hi |= best << (3 * (p - 8));
  }
  out[oo + 2] = lo & 255; out[oo + 3] = (lo >> 8) & 255; out[oo + 4] = (lo >> 16) & 255;
  out[oo + 5] = hi & 255; out[oo + 6] = (hi >> 8) & 255; out[oo + 7] = (hi >> 16) & 255;
  // colour: endpoints from pixels that are visible (alpha > 8), else all
  let use = []; for (let p = 0; p < 16; p++) if (px[p * 4 + 3] > 8) use.push(p);
  if (!use.length) use = [...Array(16).keys()];
  const mn = [255, 255, 255], mx = [0, 0, 0], mean = [0, 0, 0];
  for (const p of use) for (let c = 0; c < 3; c++) { const v = px[p * 4 + c]; if (v < mn[c]) mn[c] = v; if (v > mx[c]) mx[c] = v; mean[c] += v; }
  for (let c = 0; c < 3; c++) mean[c] /= use.length;
  // orient bbox diagonal along the main axis of variation
  let main = 0; for (let c = 1; c < 3; c++) if (mx[c] - mn[c] > mx[main] - mn[main]) main = c;
  for (let c = 0; c < 3; c++) if (c !== main) {
    let cov = 0; for (const p of use) cov += (px[p * 4 + main] - mean[main]) * (px[p * 4 + c] - mean[c]);
    if (cov < 0) { const t = mn[c]; mn[c] = mx[c]; mx[c] = t; }
  }
  const inset = c => (mx[c] - mn[c]) / 16;
  const e0 = [0, 1, 2].map(c => Math.min(255, Math.max(0, mx[c] - inset(c)))), e1 = [0, 1, 2].map(c => Math.min(255, Math.max(0, mn[c] + inset(c))));
  const q = e => ((Math.round(e[0] * 31 / 255) << 11) | (Math.round(e[1] * 63 / 255) << 5) | Math.round(e[2] * 31 / 255));
  const tmp = new Uint8Array(4), pal = [];
  const assign = (c0, c1) => { // returns {bits, err}
    tmp[0] = c0 & 255; tmp[1] = c0 >> 8; tmp[2] = c1 & 255; tmp[3] = c1 >> 8; bc1Colors(tmp, 0, pal, true);
    let bitsv = 0, err = 0; const ix = new Array(16).fill(0);
    for (let p = 0; p < 16; p++) {
      let best = 0, bd = 1e9;
      if (c0 !== c1) for (let k = 0; k < 4; k++) { const dr = pal[k][0] - px[p * 4], dg = pal[k][1] - px[p * 4 + 1], db = pal[k][2] - px[p * 4 + 2]; const d = dr * dr * 2 + dg * dg * 4 + db * db; if (d < bd) { bd = d; best = k; } }
      else { const dr = pal[0][0] - px[p * 4], dg = pal[0][1] - px[p * 4 + 1], db = pal[0][2] - px[p * 4 + 2]; bd = dr * dr * 2 + dg * dg * 4 + db * db; }
      bitsv |= best << (2 * p); ix[p] = best; if (px[p * 4 + 3] > 8 || use.length === 16) err += bd;
    }
    return { bits: bitsv >>> 0, err, ix };
  };
  let c0 = q(e0), c1 = q(e1); if (c0 < c1) { const t = c0; c0 = c1; c1 = t; }
  let best = { c0, c1, ...assign(c0, c1) };
  // least-squares refinement of the endpoints from the chosen indices
  const WT = [1, 0, 2 / 3, 1 / 3];
  for (let it = 0; it < 2 && best.c0 !== best.c1; it++) {
    let aa = 0, ab = 0, bb = 0; const ax = [0, 0, 0], bx = [0, 0, 0];
    for (const p of use) { const w = WT[best.ix[p]], a = w, b = 1 - w; aa += a * a; ab += a * b; bb += b * b; for (let c = 0; c < 3; c++) { ax[c] += a * px[p * 4 + c]; bx[c] += b * px[p * 4 + c]; } }
    const det = aa * bb - ab * ab; if (Math.abs(det) < 1e-6) break;
    const n0 = [0, 1, 2].map(c => Math.min(255, Math.max(0, (ax[c] * bb - bx[c] * ab) / det))), n1 = [0, 1, 2].map(c => Math.min(255, Math.max(0, (bx[c] * aa - ax[c] * ab) / det)));
    let k0 = q(n0), k1 = q(n1); if (k0 < k1) { const t = k0; k0 = k1; k1 = t; }
    const cand = { c0: k0, c1: k1, ...assign(k0, k1) };
    if (cand.err < best.err) best = cand; else break;
  }
  out[oo + 8] = best.c0 & 255; out[oo + 9] = best.c0 >> 8; out[oo + 10] = best.c1 & 255; out[oo + 11] = best.c1 >> 8;
  const bitsv = best.bits;
  out[oo + 12] = bitsv & 255; out[oo + 13] = (bitsv >>> 8) & 255; out[oo + 14] = (bitsv >>> 16) & 255; out[oo + 15] = (bitsv >>> 24) & 255;
}

function downsample(rgba, w, h) { // alpha-weighted 2x2 box filter
  const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1), out = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const sx = Math.min(w - 1, x * 2 + dx), sy = Math.min(h - 1, y * 2 + dy), i = (sy * w + sx) * 4, al = rgba[i + 3];
      r += rgba[i] * al; g += rgba[i + 1] * al; b += rgba[i + 2] * al; a += al; n++;
    }
    const o = (y * nw + x) * 4;
    if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
    else { const i = ((Math.min(h - 1, y * 2)) * w + Math.min(w - 1, x * 2)) * 4; out[o] = rgba[i]; out[o + 1] = rgba[i + 1]; out[o + 2] = rgba[i + 2]; }
    out[o + 3] = a / n;
  }
  return { rgba: out, w: nw, h: nh };
}

/** Uncompressed 32-bit DDS (8.8.8.8 ARGB) with a full mip chain: no quality loss. */
function encodeLossless(rgba, W, H) {
  const levels = [{ rgba, w: W, h: H }];
  while (levels[levels.length - 1].w > 1 || levels[levels.length - 1].h > 1) { const l = levels[levels.length - 1]; levels.push(downsample(l.rgba, l.w, l.h)); }
  const total = levels.reduce((a, l) => a + l.w * l.h * 4, 0), out = new Uint8Array(128 + total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x20534444, true); dv.setUint32(4, 124, true); dv.setUint32(8, 0x1 | 0x2 | 0x4 | 0x8 | 0x1000 | 0x20000, true);
  dv.setUint32(12, H, true); dv.setUint32(16, W, true); dv.setUint32(20, W * 4, true); dv.setUint32(28, levels.length, true);
  dv.setUint32(76, 32, true); dv.setUint32(80, 0x41, true); dv.setUint32(88, 32, true);
  dv.setUint32(92, 0x00FF0000, true); dv.setUint32(96, 0x0000FF00, true); dv.setUint32(100, 0x000000FF, true); dv.setUint32(104, 0xFF000000, true);
  dv.setUint32(108, 0x1000 | 0x400000 | 0x8, true);
  let o = 128;
  for (const l of levels) for (let i = 0; i < l.w * l.h * 4; i += 4, o += 4) { out[o] = l.rgba[i + 2]; out[o + 1] = l.rgba[i + 1]; out[o + 2] = l.rgba[i]; out[o + 3] = l.rgba[i + 3]; }
  return out;
}

/** Encode RGBA to a DDS with a full mip chain: mode 'lossless' (default) or 'dxt5'. */
function encodeDDS(rgba, W, H, mode) {
  if (mode !== 'dxt5') return encodeLossless(rgba, W, H);
  const levels = [{ rgba, w: W, h: H }];
  while (levels[levels.length - 1].w > 1 || levels[levels.length - 1].h > 1) { const l = levels[levels.length - 1]; levels.push(downsample(l.rgba, l.w, l.h)); }
  const sizes = levels.map(l => Math.max(1, (l.w + 3) >> 2) * Math.max(1, (l.h + 3) >> 2) * 16);
  const out = new Uint8Array(128 + sizes.reduce((a, b) => a + b, 0)), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x20534444, true); dv.setUint32(4, 124, true); dv.setUint32(8, 0x1 | 0x2 | 0x4 | 0x1000 | 0x20000 | 0x80000, true);
  dv.setUint32(12, H, true); dv.setUint32(16, W, true); dv.setUint32(20, sizes[0], true); dv.setUint32(28, levels.length, true);
  dv.setUint32(76, 32, true); dv.setUint32(80, 4, true); dv.setUint32(84, FOURCC('DXT5'), true);
  dv.setUint32(108, 0x1000 | 0x400000 | 0x8, true);
  let o = 128; const px = new Uint8Array(64);
  for (const l of levels) {
    const bw = Math.max(1, (l.w + 3) >> 2), bh = Math.max(1, (l.h + 3) >> 2);
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++, o += 16) {
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        const sx = Math.min(l.w - 1, bx * 4 + x), sy = Math.min(l.h - 1, by * 4 + y), i = (sy * l.w + sx) * 4, p = (y * 4 + x) * 4;
        px[p] = l.rgba[i]; px[p + 1] = l.rgba[i + 1]; px[p + 2] = l.rgba[i + 2]; px[p + 3] = l.rgba[i + 3];
      }
      encodeBC3Block(px, out, o);
    }
  }
  return out;
}

/* ================= tiny XML reader (i3d / vehicle xml) ================= */
function parseXML(text) {
  const root = { tag: '#root', attrs: {}, children: [], parent: null };
  let cur = root; const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!(?!--)[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[1]) { cur.closeStart = m.index; cur.closeEnd = re.lastIndex; if (cur.parent) cur = cur.parent; continue; }
    if (!m[2]) continue;
    const attrs = {}; const ar = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g; let a;
    while ((a = ar.exec(m[3] || ''))) attrs[a[1]] = a[2] !== undefined ? a[2] : a[3];
    const el = { tag: m[2], attrs, children: [], parent: cur, start: m.index, end: re.lastIndex };
    cur.children.push(el);
    if (!m[4]) cur = el;
  }
  return root;
}
const kids = (el, tag) => el.children.filter(c => !tag || c.tag === tag);
function find(el, tag) { for (const c of el.children) { if (c.tag === tag) return c; const r = find(c, tag); if (r) return r; } return null; }
function findAll(el, pred, out = []) { for (const c of el.children) { if (pred(c)) out.push(c); findAll(c, pred, out); } return out; }

/* ================= paths ================= */
function normPath(p) { const out = []; for (const s of p.replace(/\\/g, '/').split('/')) { if (!s || s === '.') continue; if (s === '..') out.pop(); else out.push(s); } return out.join('/'); }
const dirOf = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '';
function resolveRef(fromFile, ref) { // returns mod-relative path or null for $data refs
  if (!ref || ref.startsWith('$')) return null;
  return normPath(dirOf(fromFile) + ref);
}
const toDDS = p => p.replace(/\.(png|tga|jpg|jpeg)$/i, '.dds');

/* ================= i3d.shapes ================= */
function makeKeystream(seed) {
  const base = I3DKEY.slice(seed * 16, seed * 16 + 16), k = new Uint32Array(16), t = new Uint32Array(16);
  const rol = (v, b) => ((v << b) | (v >>> (32 - b))) >>> 0, ror = (v, b) => ((v >>> b) | (v << (32 - b))) >>> 0;
  const s1 = (a, b, c, d) => { t[c] ^= rol((t[b] + t[a]) >>> 0, 7); t[d] ^= rol((t[c] + t[a]) >>> 0, 9); t[b] ^= rol((t[c] + t[d]) >>> 0, 13); t[a] ^= ror((t[b] + t[d]) >>> 0, 14); };
  const s2 = (a, b, c, d) => { t[c] ^= rol((t[b] + t[a]) >>> 0, 7); t[d] ^= rol((t[b] + t[c]) >>> 0, 9); t[a] ^= rol((t[c] + t[d]) >>> 0, 13); t[b] ^= ror((t[d] + t[a]) >>> 0, 14); };
  return function block(counter, out) { // out: Uint32Array(16)
    k.set(base); k[8] = counter >>> 0; k[9] = Math.floor(counter / 4294967296) >>> 0; t.set(k);
    for (let j = 0; j < 10; j++) { s1(0, 12, 4, 8); s1(5, 1, 9, 13); s1(10, 6, 14, 2); s1(15, 11, 3, 7); s2(3, 0, 1, 2); s2(4, 5, 6, 7); s1(10, 9, 11, 8); s2(14, 15, 12, 13); }
    for (let j = 0; j < 16; j++) out[j] = (k[j] + t[j]) >>> 0;
  };
}

/** Decrypt `n` bytes at file offset `pos` using keystream blocks starting at `blk`. */
function decryptRange(u8, pos, n, blk, ks) {
  const out = new Uint8Array(n), w = new Uint32Array(16), wb = new Uint8Array(w.buffer);
  for (let i = 0; i < n; i += 64) {
    ks(blk + i / 64, w);
    const m = Math.min(64, n - i);
    for (let j = 0; j < m; j++) out[i + j] = u8[pos + i + j] ^ wb[j];
  }
  return out;
}

/** Index the shapes file: [{shapeId, name, pos, blk, size}] (only decrypts entity headers). */
function indexShapes(u8) {
  const b1 = u8[0], b4 = u8[3];
  let seed, version;
  if (b1 >= 4) { version = b1; seed = u8[2]; } else if (b4 === 2 || b4 === 3) { version = b4; seed = u8[1]; } else throw new Error('unknown shapes version');
  if (version < 4) throw new Error('old big-endian shapes format');
  const ks = makeKeystream(seed);
  let pos = 4, blk = 0;
  const rd = n => { const d = decryptRange(u8, pos, n, blk, ks); pos += n; blk += Math.ceil(n / 64); return d; };
  const i32 = d => (d[0] | (d[1] << 8) | (d[2] << 16) | (d[3] << 24));
  const count = i32(rd(4));
  if (count < 0 || count > 1e6) throw new Error('could not decrypt shapes file');
  const list = [];
  for (let e = 0; e < count && pos < u8.length; e++) {
    const type = i32(rd(4)), size = i32(rd(4));
    if (size < 0 || pos + size > u8.length) break;
    const head = decryptRange(u8, pos, Math.min(size, 256), blk, ks);
    const nl = i32(head), off = (4 + nl + 3) & ~3;
    let name = '', shapeId = -1;
    if (nl >= 0 && off + 4 <= head.length) { name = String.fromCharCode(...head.subarray(4, 4 + nl)); shapeId = i32(head.subarray(off)); }
    list.push({ type, shapeId, name, pos, blk, size });
    pos += size; blk += Math.ceil(size / 64);
  }
  return { version, seed, ks, list };
}

/** Parse one shape's geometry. Returns {nv, pos, uv, tris, subsets} or null. */
function readShape(u8, idx, ent) {
  if (ent.type !== 1) return null;
  const b = decryptRange(u8, ent.pos, ent.size, ent.blk, idx.ks);
  const dv = new DataView(b.buffer);
  const nl = dv.getInt32(0, true), off = (4 + nl + 3) & ~3, I = i => dv.getInt32(off + 4 * i, true), F = i => dv.getFloat32(off + 4 * i, true);
  const nidx = I(5), nsub = I(6), nv = I(7), flags = I(8);
  if (nv <= 0 || nidx <= 0 || nsub <= 0 || nsub > 256) return null;
  const isz = nv <= 65535 ? 2 : 4, nuv = [2, 4, 8, 16].filter(f => flags & f).length, rec = 4 + nuv; // subset record: fv, nv, fi, ni + one uv density per uv set
  const cx = F(1), cy = F(2), cz = F(3), rad = Math.abs(F(4)) * 1.02 + 1e-3, r0 = idx.version >= 10 ? 10 : 9;
  // subsets
  let subsets = [], sum = 0;
  for (let i = 0; i < nsub; i++) { const fi = I(r0 + i * rec + 2), ni = I(r0 + i * rec + 3); if (fi < 0 || ni < 0 || fi + ni > nidx) { subsets = null; break; } subsets.push({ fi, ni }); sum += ni; }
  if (subsets && sum !== nidx) subsets = null;
  // indices start after the subset records plus a variable block; find it: valid indices AND positions inside the stored bounding sphere
  const base = off + 4 * (r0 + nsub * rec);
  // candidates: indices all in range, points inside the bounding sphere; best = every point used and no collapsed triangles
  let found = null, fallback = null, bestDeg = Infinity;
  const used = new Uint8Array(nv);
  for (let s = base; s <= base + 4 * 96 && bestDeg > 0; s += 4) {
    if (s + nidx * isz > b.length) break;
    let ok = true, degen = 0; used.fill(0);
    const at = i => isz === 2 ? dv.getUint16(s + 2 * i, true) : dv.getUint32(s + 4 * i, true);
    for (let i = 0; i < nidx; i += 3) {
      const a = at(i), c = at(i + 1), d = at(i + 2);
      if (a >= nv || c >= nv || d >= nv) { ok = false; break; }
      used[a] = used[c] = used[d] = 1; if (a === c || c === d || a === d) degen++;
    }
    if (!ok) continue;
    const p = s + ((nidx * isz + 3) & ~3); if (p + nv * 12 > b.length) continue;
    const step = Math.max(1, Math.floor(nv / 400));
    for (let i = 0; i < nv && ok; i += step) { const x = dv.getFloat32(p + 12 * i, true) - cx, y = dv.getFloat32(p + 12 * i + 4, true) - cy, z = dv.getFloat32(p + 12 * i + 8, true) - cz; if (!(Math.hypot(x, y, z) <= rad)) ok = false; }
    if (!ok) continue;
    let cover = 0; for (let i = 0; i < nv; i++) cover += used[i];
    // a start that is a few slots early still passes the other checks but adds collapsed (0,0,0) triangles: keep the cleanest
    if (cover >= nv * 0.995 && degen <= nidx / 3 * 0.01) { if (degen < bestDeg) { bestDeg = degen; found = { s, p }; } }
    else if (!fallback) fallback = { s, p };
  }
  found = found || fallback;
  if (!found) return null;
  const tris = new Uint32Array(nidx);
  for (let i = 0; i < nidx; i++) tris[i] = isz === 2 ? dv.getUint16(found.s + 2 * i, true) : dv.getUint32(found.s + 4 * i, true);
  const pos = new Float32Array(b.buffer.slice(found.p, found.p + nv * 12));
  const uvOff = found.p + nv * 12 + ((flags & 1) ? nv * 12 : 0) + ((flags & 128) ? nv * 16 : 0);
  if (!(flags & 2) || uvOff + nv * 8 > b.length) return { nv, pos, tris, uv: null, subsets, name: ent.name };
  const uv = new Float32Array(b.buffer.slice(uvOff, uvOff + nv * 8));
  if (!subsets && nsub === 1) subsets = [{ fi: 0, ni: nidx }];
  return { nv, pos, uv, tris, subsets, name: ent.name };
}

/* ---- 3D helpers ---- */
const D2R = Math.PI / 180;
function mat(t, r, s) { // column-major 4x4 from translation, i3d rotation (degrees), scale
  const [x, y, z] = r.map(v => v * D2R), cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  // i3d rotations are XYZ Euler angles: R = Rz * Ry * Rx (columns listed below)
  const R = [cz * cy, sz * cy, -sy,
             -sz * cx + cz * sy * sx, cz * cx + sz * sy * sx, cy * sx,
             sz * sx + cz * sy * cx, -cz * sx + sz * sy * cx, cy * cx];
  return [R[0] * s[0], R[1] * s[0], R[2] * s[0], 0, R[3] * s[1], R[4] * s[1], R[5] * s[1], 0, R[6] * s[2], R[7] * s[2], R[8] * s[2], 0, t[0], t[1], t[2], 1];
}
function mmul(a, b) { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; }
const vec = s => (s || '').trim().split(/\s+/).map(Number);

/** Find decal "spots" on the model for each texture. */
function analyzeI3D(i3dPath, text, shapesU8, log) {
  const doc = parseXML(text), i3d = find(doc, 'i3D') || doc;
  const files = {};
  for (const f of findAll(i3d, e => e.tag === 'File')) files[f.attrs.fileId] = f.attrs.filename;
  const mats = {};
  for (const m of findAll(i3d, e => e.tag === 'Material')) {
    const t = kids(m, 'Texture')[0], ref = t ? files[t.attrs.fileId] : null;
    mats[m.attrs.materialId] = { name: m.attrs.name || '', alpha: m.attrs.alphaBlending === 'true' || /decal|alpha/i.test(m.attrs.customShaderVariation || ''), ref, path: ref ? toDDS(resolveRef(i3dPath, ref) || '') : null, external: ref ? ref.startsWith('$') : false };
  }
  // shape instances with world matrices
  const scene = find(i3d, 'Scene'); const inst = [];
  const walk = (el, M) => {
    for (const c of el.children) {
      if (!['Shape', 'TransformGroup', 'Light', 'Camera', 'Dynamic'].includes(c.tag)) continue;
      const t = c.attrs.translation ? vec(c.attrs.translation) : [0, 0, 0], r = c.attrs.rotation ? vec(c.attrs.rotation) : [0, 0, 0], s = c.attrs.scale ? vec(c.attrs.scale) : [1, 1, 1];
      const W = mmul(M, mat(t, r, s));
      if (c.tag === 'Shape' && c.attrs.shapeId) inst.push({ shapeId: +c.attrs.shapeId, materialIds: (c.attrs.materialIds || '').split(',').map(v => v.trim()).filter(Boolean), M: W, node: c.attrs.name || '' });
      walk(c, W);
    }
  };
  if (scene) walk(scene, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  // which shapes do we need? those whose materials carry a diffuse texture
  const needed = new Set(inst.filter(i => i.materialIds.some(m => mats[m] && mats[m].ref)).map(i => i.shapeId));
  const spots = {}; // texKey -> [{u0,v0,u1,v1, wM, hM, count, nodes:Set, material}]
  if (!shapesU8) return { mats, spots, files };
  let idx; try { idx = indexShapes(shapesU8); } catch (e) { log && log(i3dPath + ': ' + e.message); return { mats, spots, files }; }
  const geoCache = new Map();
  const getGeo = sid => {
    if (geoCache.has(sid)) return geoCache.get(sid);
    const ent = idx.list.find(e => e.shapeId === sid); let g = null;
    if (ent && ent.size < 40e6) { try { g = readShape(shapesU8, idx, ent); } catch (e) { g = null; } }
    geoCache.set(sid, g); return g;
  };
  for (const it of inst) {
    if (!needed.has(it.shapeId)) continue;
    // limit to plausible decal materials to keep it fast: anything with alpha-ish names or small shapes
    const g = getGeo(it.shapeId); if (!g || !g.uv) continue;
    it.materialIds.forEach((mid, si) => {
      const m = mats[mid]; if (!m || !m.ref) return;
      let sub = null;
      if (g.subsets && g.subsets.length === it.materialIds.length) sub = g.subsets[si];
      else if (it.materialIds.length === 1) sub = { fi: 0, ni: g.tris.length };
      if (!sub || !sub.ni) return;
      if (sub.ni > 60000) return; // big body meshes are not decal spots
      const key = m.external ? 'ext:' + m.ref : m.path;
      const comps = islands(g, sub, it.M);
      for (const c of comps) {
        const list = spots[key] || (spots[key] = []);
        const same = list.find(s => Math.abs(s.u0 - c.u0) < .01 && Math.abs(s.v0 - c.v0) < .01 && Math.abs(s.u1 - c.u1) < .01 && Math.abs(s.v1 - c.v1) < .01);
        if (same) { same.count++; same.nodes.add(it.node); same.aspects.push(c.aspect); }
        else list.push({ ...c, count: 1, nodes: new Set([it.node]), aspects: [c.aspect], material: m.name });
      }
    });
  }
  for (const k in spots) for (const s of spots[k]) { s.aspects.sort((a, b) => a - b); s.aspect = s.aspects[s.aspects.length >> 1]; s.nodes = [...s.nodes]; }
  return { mats, spots, files };
}

function islands(g, sub, M) {
  const { pos, uv, tris } = g;
  const parent = new Map(); const f = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const add = x => { if (!parent.has(x)) parent.set(x, x); };
  const uni = (a, b) => { a = f(a); b = f(b); if (a !== b) parent.set(a, b); };
  const tp = v => { const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2]; return [M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]]; };
  for (let i = sub.fi; i < sub.fi + sub.ni; i += 3) { const a = tris[i], b = tris[i + 1], c = tris[i + 2]; add(a); add(b); add(c); uni(a, b); uni(b, c); }
  // merge vertices that share the same uv (split normals) so islands aren't over-split
  const byUV = new Map();
  for (const v of parent.keys()) { const k = Math.round(uv[v * 2] * 2048) + ',' + Math.round(uv[v * 2 + 1] * 2048); if (byUV.has(k)) uni(v, byUV.get(k)); else byUV.set(k, v); }
  const groups = new Map();
  for (let i = sub.fi; i < sub.fi + sub.ni; i += 3) { const r = f(tris[i]); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); }
  const out = [];
  for (const list of groups.values()) {
    let u0 = 1e9, v0 = 1e9, u1 = -1e9, v1 = -1e9; const samples = [];
    for (const i of list) {
      const ids = [tris[i], tris[i + 1], tris[i + 2]], P = ids.map(tp), U = ids.map(v => [uv[v * 2], uv[v * 2 + 1]]);
      for (const q of U) { u0 = Math.min(u0, q[0]); u1 = Math.max(u1, q[0]); v0 = Math.min(v0, q[1]); v1 = Math.max(v1, q[1]); }
      const e1 = P[1].map((x, k) => x - P[0][k]), e2 = P[2].map((x, k) => x - P[0][k]);
      const d1 = [U[1][0] - U[0][0], U[1][1] - U[0][1]], d2 = [U[2][0] - U[0][0], U[2][1] - U[0][1]];
      const det = d1[0] * d2[1] - d1[1] * d2[0]; if (Math.abs(det) < 1e-10) continue;
      const dPdu = e1.map((x, k) => (x * d2[1] - e2[k] * d1[1]) / det), dPdv = e2.map((x, k) => (x * d1[0] - e1[k] * d2[0]) / det);
      const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      samples.push({ mu: Math.hypot(...dPdu), mv: Math.hypot(...dPdv), area: Math.hypot(...cr) / 2 });
    }
    if (!samples.length) continue;
    // the visible face dominates: take the area-weighted median
    const wmed = key => { const s = samples.slice().sort((a, b) => a[key] - b[key]), tot = s.reduce((t, x) => t + x.area, 0); let acc = 0; for (const x of s) { acc += x.area; if (acc >= tot / 2) return x[key]; } return s[s.length - 1][key]; };
    const mu = wmed('mu'), mv = wmed('mv');
    u0 = Math.max(0, u0); v0 = Math.max(0, v0); u1 = Math.min(1, u1); v1 = Math.min(1, v1);
    if (u1 - u0 < .02 || v1 - v0 < .02) continue;
    const wM = (u1 - u0) * mu, hM = (v1 - v0) * mv;
    out.push({ u0, v0, u1, v1, wM, hM, aspect: wM / hM });
  }
  return out;
}

/* ================= mod analysis ================= */
const SKIP_NAME = /(_normal|_nrm|_norm|_n|_vmask|_specular|_spec|_s|_gloss|_height|_ao|_mask|_emissive|_emiss|_dirt|_wear|dirt|wear|normal)\.dds$/i;
const LOGO_NAME = /logo|brand|decal|sign|emblem|badge|sticker|farm|company|haze|label|advert|banner|screen|poster/i;
const LOGO_MAT = /logo|brand|decal|sign|sticker|adstrip|emblem|badge|label|screen|poster|banner/i;

/**
 * files: Map(path -> Uint8Array) of the mod (paths relative to the mod root).
 * Returns { textures: [...], groups: [...] }
 */
function analyzeMod(files, log = () => {}) {
  const text = p => new TextDecoder('utf-8').decode(files.get(p)).replace(/^﻿/, '');
  const paths = [...files.keys()];
  const lower = new Map(paths.map(p => [p.toLowerCase(), p]));
  const tex = new Map(); // path -> record
  const T = p => { if (!tex.has(p)) tex.set(p, { path: p, score: 0, reasons: new Set(), spots: [], materials: new Set(), configRefs: 0 }); return tex.get(p); };
  for (const p of paths) if (/\.dds$/i.test(p)) { const r = T(p); if (LOGO_NAME.test(p.split('/').pop())) { r.score += 5; r.reasons.add('name'); } }
  const brandSpots = {}; // i3dPath -> spots on materials using $data/store/brands or config textures
  // i3d files
  for (const p of paths.filter(p => /\.i3d$/i.test(p))) {
    const sh = files.get(p + '.shapes') || (lower.get((p + '.shapes').toLowerCase()) && files.get(lower.get((p + '.shapes').toLowerCase())));
    let res;
    try { res = analyzeI3D(p, text(p), sh, log); } catch (e) { log(p + ': ' + e.message); continue; }
    for (const id in res.mats) {
      const m = res.mats[id]; if (!m.path) continue;
      const real = lower.get(m.path.toLowerCase()); if (!real) continue;
      const r = T(real); r.materials.add(m.name); if (m.alpha) r.alphaMat = true;
      if (LOGO_MAT.test(m.name) && !r.reasons.has('material')) { r.score += 4; r.reasons.add('material'); }
    }
    for (const key in res.spots) {
      if (key.startsWith('ext:')) { (brandSpots[p] || (brandSpots[p] = [])).push(...res.spots[key].map(s => ({ ...s, ref: key.slice(4) }))); continue; }
      const real = lower.get(key.toLowerCase()); if (!real) continue;
      const r = T(real);
      for (const s of res.spots[key]) r.spots.push({ ...s, i3d: p });
    }
  }
  // configuration groups with material texture swaps
  const groups = [];
  for (const p of paths.filter(p => /\.xml$/i.test(p) && !/moddesc\.xml$/i.test(p))) {
    let src; try { src = text(p); } catch (e) { continue; }
    if (!/materialSlotName|<textures\s/.test(src)) {
      // still count plain texture references
    }
    const doc = parseXML(src);
    const i3dRef = (find(doc, 'base') && find(find(doc, 'base'), 'filename')) ? null : null;
    const baseEl = find(doc, 'base'); let vehicleI3d = null;
    if (baseEl) { const fn = kids(baseEl, 'filename')[0]; if (fn) { const raw = src.slice(fn.end, src.indexOf('</filename>', fn.end)).trim(); vehicleI3d = normPath(raw); } }
    const sets = findAll(doc, e => /Configurations$/.test(e.tag));
    for (const set of sets) {
      const itemTag = set.tag.slice(0, -1);
      const items = kids(set, itemTag);
      const slots = new Map();
      for (const it of items) for (const mt of findAll(it, e => e.tag === 'material' && e.attrs.materialSlotName)) {
        const tx = kids(mt, 'textures')[0]; if (!tx || !tx.attrs.diffuse) continue;
        const slot = mt.attrs.materialSlotName;
        if (!slots.has(slot)) slots.set(slot, []);
        slots.get(slot).push(tx.attrs.diffuse);
        const local = tx.attrs.diffuse.startsWith('$') ? null : lower.get(normPath(tx.attrs.diffuse).toLowerCase());
        if (local) { const r = T(local); r.configRefs++; if (!r.reasons.has('option')) { r.score += 3; r.reasons.add('option'); } }
      }
      for (const [slot, refs] of slots) {
        const brandish = refs.some(r => /\/store\/brands\//i.test(r)) || /decal|logo|brand|sticker|sign|mark|emblem/i.test(slot + ' ' + (set.attrs.title || ''));
        if (!brandish) continue;
        // estimate the decal's proportions from model spots that use brand textures
        let aspect = null;
        const cand = vehicleI3d && brandSpots[lower.get(vehicleI3d.toLowerCase())] || [];
        const list = cand.filter(s => refs.includes(s.ref) || /\/store\/brands\//.test(s.ref));
        if (list.length) { const as = list.map(s => s.aspect).sort((a, b) => a - b); aspect = as[as.length >> 1]; }
        const vm = src.match(/<storeData>[\s\S]*?<name>\s*(?:<en>)?\s*([^<]+?)\s*</);
        groups.push({ vehicle: vm && !vm[1].startsWith('$') ? vm[1] : null, xml: p, tag: set.tag, itemTag, title: set.attrs.title || set.tag, slot, options: items.length, refs, aspect, closeIdx: closingIndex(src, set) });
      }
    }
  }
  const textures = [...tex.values()].map(r => ({ ...r, reasons: [...r.reasons], materials: [...r.materials], size: files.get(r.path).length, skip: SKIP_NAME.test(r.path) }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return { textures, groups };
}
function closingIndex(src, el) { // index of "</tag>" for element
  const close = '</' + el.tag; let i = src.indexOf(close, el.end); return i;
}

/* ================= patch helpers ================= */
function slug(s) { return (s || 'myfarm').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'myfarm'; }
function escAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

/** Insert a new configuration option before the set's closing tag. */
function addConfigOption(src, group, name, texPath, makeDefault) {
  const nl = src.includes('\r\n') ? '\r\n' : '\n';
  const close = '</' + group.tag;
  // find the right closing tag occurrence: the first one after the group's slot usage
  let at = group.closeIdx;
  if (at < 0 || src.slice(at, at + close.length) !== close) at = src.indexOf(close, Math.max(0, at)); // earlier inserts in this set pushed the tag further down
  if (at < 0) at = src.indexOf(close);
  // match indentation of the closing tag
  const lineStart = src.lastIndexOf('\n', at) + 1, indent = src.slice(lineStart, at).match(/^\s*/)[0];
  const i1 = indent + '    ', i2 = i1 + '    ', i3 = i2 + '    ';
  const block = `${i1}<${group.itemTag} name="${escAttr(name)}" price="0"${makeDefault ? ' isDefault="true"' : ''}>${nl}` +
    `${i2}<material materialSlotName="${escAttr(group.slot)}">${nl}${i3}<textures diffuse="${escAttr(texPath)}"/>${nl}${i2}</material>${nl}` +
    `${i1}</${group.itemTag}>${nl}`;
  return src.slice(0, lineStart) + block + src.slice(lineStart);
}

/* ================= names shown in the shop ================= */
const unesc = s => String(s).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const escText = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** English texts a mod defines in modDesc.xml (<l10n><text name="key"><en>…</en>). */
function modTexts(modDescSrc) {
  const out = new Map(); if (!modDescSrc) return out;
  const re = /<text\s+name="([^"]+)"\s*>([\s\S]*?)<\/text>/g; let m;
  while ((m = re.exec(modDescSrc))) { const en = m[2].match(/<en>([\s\S]*?)<\/en>/); out.set(m[1], unesc((en ? en[1] : m[2]).trim())); }
  return out;
}
/** Choices in one configuration set: [{ index, name (raw attribute), diffuse: [texture paths] }]. */
function configItems(src, tag) {
  const doc = parseXML(src), set = findAll(doc, e => e.tag === tag)[0]; if (!set) return [];
  return kids(set, tag.slice(0, -1)).map((it, index) => ({ index, name: unesc(it.attrs.name || ''),
    diffuse: findAll(it, e => e.tag === 'textures' && e.attrs.diffuse).map(e => e.attrs.diffuse) }));
}
/** Rename choices in a configuration set. renames: Map(index -> new name). Only the name attribute changes. */
function renameConfigItems(src, tag, renames) {
  const doc = parseXML(src), set = findAll(doc, e => e.tag === tag)[0]; if (!set) return src;
  const items = kids(set, tag.slice(0, -1)), edits = [];
  for (const [index, name] of renames) {
    const it = items[index]; if (!it) continue;
    const head = src.slice(it.start, src.indexOf('>', it.start) + 1), m = head.match(/(\sname\s*=\s*)("[^"]*"|'[^']*')/);
    if (m) edits.push({ at: it.start + m.index + m[1].length, del: m[2].length, text: '"' + escAttr(name) + '"' });
    else { const at = it.start + 1 + it.tag.length; edits.push({ at, del: 0, text: ` name="${escAttr(name)}"` }); }
  }
  let out = src; for (const e of edits.sort((a, b) => b.at - a.at)) out = out.slice(0, e.at) + e.text + out.slice(e.at + e.del);
  return out;
}
/** The shop name of a store item: { raw, text } where raw may be plain text, per-language tags, or a $l10n_ key. */
function storeName(src, texts = new Map()) {
  const sd = src.match(/<storeData>[\s\S]*?<\/storeData>/); if (!sd) return null;
  const m = sd[0].match(/<name>([\s\S]*?)<\/name>/); if (!m) return null;
  const raw = m[1].trim(), en = raw.match(/<en>([\s\S]*?)<\/en>/);
  let text = unesc((en ? en[1] : raw).trim());
  if (text.startsWith('$l10n_')) text = texts.get(text.slice(6)) || text;
  return { raw, text };
}
function setStoreName(src, name) {
  const sd = src.match(/<storeData>[\s\S]*?<\/storeData>/); if (!sd) return src;
  const at = sd.index + sd[0].search(/<name>/); if (at < sd.index) return src;
  const end = src.indexOf('</name>', at) + 7;
  return src.slice(0, at) + '<name>' + escText(name) + '</name>' + src.slice(end);
}
/** Add " (tag)" to a mod's title in modDesc.xml, in every language, so a separate copy is easy to tell apart. */
function tagModTitle(src, tag) {
  const m = src.match(/<title>([\s\S]*?)<\/title>/); if (!m) return src;
  const suffix = ` (${escText(tag)})`;
  let inner = m[1];
  if (/<[a-z]{2}>/.test(inner)) inner = inner.replace(/<([a-z]{2})>([\s\S]*?)<\/\1>/g, (all, l, t) => t.includes(suffix) ? all : `<${l}>${t.trimEnd()}${suffix}</${l}>`);
  else if (!inner.includes(suffix)) inner = inner.trimEnd() + suffix;
  return src.slice(0, m.index) + '<title>' + inner + '</title>' + src.slice(m.index + m[0].length);
}

/* ================= adding new geometry (stickers) ================= */
/**
 * Build the plain (unencrypted) bytes of a one-material shape for an .i3d.shapes file (format version 10).
 * verts: [[x,y,z]...] in the parent's local space; tris: flat index list; uvs: [[u,v]...]
 * Layout matches shapes written by the GIANTS exporter: header, one subset, 16-bit indices, positions, normals, uv0.
 */
function buildShapeEntity({ name, shapeId, verts, tris, uvs, normals = null, version = 10 }) {
  const nv = verts.length, ni = tris.length, big = nv > 65535;
  // normals from the triangles (counter-clockwise = front, as in exported shapes)
  const nrm = verts.map(() => [0, 0, 0]);
  for (let i = 0; i < ni; i += 3) {
    const [a, b, c] = [tris[i], tris[i + 1], tris[i + 2]].map(k => verts[k]);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const k of [tris[i], tris[i + 1], tris[i + 2]]) for (let j = 0; j < 3; j++) nrm[k][j] += n[j];
  }
  for (const n of nrm) { const l = Math.hypot(...n) || 1; n[0] /= l; n[1] /= l; n[2] /= l; }
  if (normals) normals.forEach((n, i) => { const l = Math.hypot(...n) || 1; nrm[i] = [n[0] / l, n[1] / l, n[2] / l]; }); // smooth normals from the surface underneath
  const ctr = [0, 1, 2].map(j => verts.reduce((t, v) => t + v[j], 0) / nv), rad = Math.max(...verts.map(v => Math.hypot(v[0] - ctr[0], v[1] - ctr[1], v[2] - ctr[2])));
  const nameB = new TextEncoder().encode(name), head = (4 + nameB.length + 3) & ~3;
  const idxBytes = big ? ni * 4 : (ni * 2 + 3) & ~3;
  const v10 = version >= 10, size = head + 4 * (v10 ? 16 : 14) + idxBytes + nv * 12 * 2 + nv * 8 + 4;
  const out = new Uint8Array(size), dv = new DataView(out.buffer); let o = 0;
  dv.setInt32(o, nameB.length, true); out.set(nameB, 4); o = head;
  const I = v => { dv.setInt32(o, v, true); o += 4; }, F = v => { dv.setFloat32(o, v, true); o += 4; };
  I(shapeId); F(ctr[0]); F(ctr[1]); F(ctr[2]); F(rad);
  I(ni); I(1); I(nv); I(3);            // index count, subsets, vertex count, flags (normals + uv0)
  if (v10) I(0);                       // reserved (version 10+)
  I(0); I(nv); I(0); I(ni); F(1);      // subset: first vertex, vertex count, first index, index count, uv density
  if (v10) I(0);                       // reserved (version 10+)
  for (let i = 0; i < ni; i++) big ? dv.setUint32(o + 4 * i, tris[i], true) : dv.setUint16(o + 2 * i, tris[i], true); o += idxBytes;
  for (const v of verts) { F(v[0]); F(v[1]); F(v[2]); }
  for (const n of nrm) { F(n[0]); F(n[1]); F(n[2]); }
  for (const t of uvs) { F(t[0]); F(t[1]); }
  I(0);                                // reserved
  return out;
}
/* ---------- stickers that wrap onto the surface ---------- */
/**
 * Weld a triangle mesh (positions already in world space) so neighbouring triangles can be found.
 * pos: flat [x,y,z,...]; tris: flat vertex indices. Face order is kept, so a raycast faceIndex still points at the same face.
 */
function weldMesh(pos, tris) {
  const map = new Map(), remap = new Int32Array(pos.length / 3), P = [];
  for (let i = 0; i < remap.length; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2], key = Math.round(x * 2e4) + ',' + Math.round(y * 2e4) + ',' + Math.round(z * 2e4);
    let k = map.get(key); if (k === undefined) { k = P.length / 3; map.set(key, k); P.push(x, y, z); } remap[i] = k;
  }
  const nf = Math.floor(tris.length / 3), T = new Int32Array(nf * 3), FN = new Float64Array(nf * 3), FA = new Float64Array(nf);
  const edges = new Map(), vf = Array.from({ length: P.length / 3 }, () => []);
  for (let f = 0; f < nf; f++) {
    const a = remap[tris[f * 3]], b = remap[tris[f * 3 + 1]], c = remap[tris[f * 3 + 2]]; T[f * 3] = a; T[f * 3 + 1] = b; T[f * 3 + 2] = c;
    const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]], e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], l = Math.hypot(n[0], n[1], n[2]);
    FA[f] = l / 2; if (l > 0) { FN[f * 3] = n[0] / l; FN[f * 3 + 1] = n[1] / l; FN[f * 3 + 2] = n[2] / l; }
    if (a === b || b === c || a === c) continue; // degenerate after welding
    for (const [u, v] of [[a, b], [b, c], [c, a]]) { const key = u < v ? u * 4194304 + v : v * 4194304 + u; let L = edges.get(key); if (!L) edges.set(key, L = []); L.push(f); }
    vf[a].push(f); vf[b].push(f); vf[c].push(f);
  }
  return { P, T, FN, FA, edges, vf, nf };
}
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function faceN(m, f) { return [m.FN[f * 3], m.FN[f * 3 + 1], m.FN[f * 3 + 2]]; }
function nearestFace(m, p) { // fallback when no raycast face index is known
  let best = -1, bd = Infinity;
  for (let f = 0; f < m.nf; f++) {
    let cx = 0, cy = 0, cz = 0; for (let k = 0; k < 3; k++) { const v = m.T[f * 3 + k]; cx += m.P[v * 3]; cy += m.P[v * 3 + 1]; cz += m.P[v * 3 + 2]; }
    const d = (cx / 3 - p[0]) ** 2 + (cy / 3 - p[1]) ** 2 + (cz / 3 - p[2]) ** 2 - 4 * m.FA[f]; // big faces may be far from their centre
    if (d < bd) { bd = d; best = f; }
  }
  return best;
}
/**
 * Lay a w×h sticker onto the surface like vinyl: start at the face under `point` and unfold neighbouring
 * faces into the sticker's plane, so it follows curves and wraps round corners (up to about 100°, never
 * folding back round a panel edge). maxBendCos: sharpest fold allowed at one edge (cosine; 0.77 ≈ 40° keeps it
 * off the far side of a sharp corner while still following smooth curves). Returns world-space verts/normals/uvs/tris, lifted `offset` off the surface.
 * r,u: unit right/up directions on the surface at the point; n: the outward normal there.
 */
function wrapDecal(m, { point, n, r, u, w, h, offset = 0.004, face = -1, maxBendCos = -0.2, maxTurnCos = -0.2 }) {
  let f0 = face >= 0 && face < m.nf ? face : nearestFace(m, point); if (f0 < 0) return null;
  const s = dot3(faceN(m, f0), n) < 0 ? -1 : 1, n0 = faceN(m, f0).map(v => v * s);
  const at = v => [m.P[v * 3], m.P[v * 3 + 1], m.P[v * 3 + 2]];
  const to2 = v => { const q = at(v), d = [q[0] - point[0], q[1] - point[1], q[2] - point[2]]; return [dot3(d, r), dot3(d, u)]; };
  const hw = w / 2, hh = h / 2;
  const cornerN = new Map(); // smooth normal per (vertex, side of the sheet), so wrapped pieces stay joined
  const smooth = (v, f) => {
    const key = v * 2 + (s > 0 ? 1 : 0) + ':' + f; let c = cornerN.get(key); if (c) return c;
    const fn = faceN(m, f), acc = [0, 0, 0];
    for (const g of m.vf[v]) { const gn = faceN(m, g); if (dot3(gn, fn) > -0.5) { acc[0] += gn[0] * m.FA[g]; acc[1] += gn[1] * m.FA[g]; acc[2] += gn[2] * m.FA[g]; } }
    const l = Math.hypot(...acc) || 1; c = [acc[0] / l * s, acc[1] / l * s, acc[2] / l * s]; cornerN.set(key, c); return c;
  };
  const verts = [], nrms = [], uvs = [], tris = [];
  const seen = new Uint8Array(m.nf), queue = [[f0, [0, 1, 2].map(k => to2(m.T[f0 * 3 + k]))]]; seen[f0] = 1;
  let guard = 0;
  while (queue.length && guard++ < 200000) {
    const [f, q] = queue.shift(), idx = [m.T[f * 3], m.T[f * 3 + 1], m.T[f * 3 + 2]];
    // clip this face to the sticker rectangle (in the unfolded plane), carrying 3D position and normal
    let poly = [0, 1, 2].map(k => ({ x: q[k][0], y: q[k][1], p: at(idx[k]), nn: smooth(idx[k], f) }));
    for (const [ax, sg, lim] of [['x', 1, hw], ['x', -1, hw], ['y', 1, hh], ['y', -1, hh]]) {
      const out = [], inside = v => sg * v[ax] <= lim + 1e-9;
      for (let i = 0; i < poly.length; i++) {
        const A = poly[i], B = poly[(i + 1) % poly.length], ia = inside(A), ib = inside(B);
        if (ia) out.push(A);
        if (ia !== ib) { const t = (lim - sg * A[ax]) / (sg * B[ax] - sg * A[ax]), L = (a, b) => a + (b - a) * t;
          out.push({ x: L(A.x, B.x), y: L(A.y, B.y), p: [0, 1, 2].map(j => L(A.p[j], B.p[j])), nn: [0, 1, 2].map(j => L(A.nn[j], B.nn[j])) }); }
      }
      poly = out; if (!poly.length) break;
    }
    if (poly.length >= 3) {
      const base = verts.length, fn = faceN(m, f).map(v => v * s);
      for (const v of poly) { const l = Math.hypot(...v.nn) || 1, nn = v.nn.map(c => c / l); verts.push(v.p.map((c, j) => c + nn[j] * offset)); nrms.push(nn); uvs.push([v.x / w + 0.5, v.y / h + 0.5]); }
      for (let i = 1; i + 1 < poly.length; i++) {
        const a = verts[base], b = verts[base + i], c = verts[base + i + 1];
        const cr = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
        if (dot3(cr, fn) >= 0) tris.push(base, base + i, base + i + 1); else tris.push(base, base + i + 1, base + i);
      }
    }
    // unfold neighbours across each edge that still touches the rectangle
    const fnf = faceN(m, f);
    for (let e = 0; e < 3; e++) {
      const ia = idx[e], ib = idx[(e + 1) % 3], A = q[e], B = q[(e + 1) % 3], C = q[(e + 2) % 3];
      const L = m.edges.get(ia < ib ? ia * 4194304 + ib : ib * 4194304 + ia); if (!L) continue;
      let g = -1, bestDot = -2;
      for (const c of L) { if (c === f || seen[c]) continue; const d = dot3(faceN(m, c), fnf); if (d > bestDot) { bestDot = d; g = c; } }
      if (g < 0 || bestDot < maxBendCos || dot3(faceN(m, g).map(v => v * s), n0) < maxTurnCos) continue; // too sharp a fold, or turned back on itself
      const gi = [m.T[g * 3], m.T[g * 3 + 1], m.T[g * 3 + 2]], third = gi.find(v => v !== ia && v !== ib); if (third === undefined) continue;
      const pa = at(ia), pb = at(ib), pd = at(third), ab = pb.map((v, j) => v - pa[j]), ad = pd.map((v, j) => v - pa[j]);
      const ab2 = dot3(ab, ab) || 1e-12, t = dot3(ad, ab) / ab2, foot = ab.map((v, j) => pa[j] + v * t), hgt = Math.hypot(pd[0] - foot[0], pd[1] - foot[1], pd[2] - foot[2]);
      const ex = B[0] - A[0], ey = B[1] - A[1], el = Math.hypot(ex, ey) || 1e-12, px = -ey / el, py = ex / el;
      const side = ((ex) * (C[1] - A[1]) - (ey) * (C[0] - A[0])) >= 0 ? -1 : 1; // put the new face on the far side of the shared edge
      const D = [A[0] + ex * t + side * px * hgt, A[1] + ey * t + side * py * hgt];
      const q2 = gi.map(v => v === ia ? A : v === ib ? B : D);
      const minX = Math.min(...q2.map(v => v[0])), maxX = Math.max(...q2.map(v => v[0])), minY = Math.min(...q2.map(v => v[1])), maxY = Math.max(...q2.map(v => v[1]));
      seen[g] = 1;
      if (maxX < -hw || minX > hw || maxY < -hh || minY > hh) continue; // fully outside: don't spread past it
      queue.push([g, q2]);
    }
  }
  if (!tris.length) return null;
  return { verts, normals: nrms, uvs, tris };
}
/** Return a copy of an .i3d.shapes file with extra shape entities appended (encrypted like the rest). */
function appendShapeEntities(u8, datas) {
  const idx = indexShapes(u8), last = idx.list[idx.list.length - 1];
  datas = datas.map(d => typeof d === 'function' ? d(idx.version) : d); // builders get the file's format version
  let blk = last ? last.blk + Math.ceil(last.size / 64) : 1, pos = last ? last.pos + last.size : 8;
  if (pos !== u8.length) throw new Error('unexpected data at the end of the shapes file');
  const extra = datas.reduce((t, d) => t + 8 + d.length, 0), out = new Uint8Array(u8.length + extra);
  out.set(u8);
  // count lives in the first 4 bytes after the header, encrypted with block 0
  const cnt = decryptRange(u8, 4, 4, 0, idx.ks), n = (cnt[0] | (cnt[1] << 8) | (cnt[2] << 16) | (cnt[3] << 24)) + datas.length;
  const nb = new Uint8Array(4); new DataView(nb.buffer).setInt32(0, n, true);
  const xorWith = (plain, b) => { const ksb = decryptRange(new Uint8Array(plain.length), 0, plain.length, b, idx.ks); return plain.map((v, i) => v ^ ksb[i]); };
  out.set(xorWith(nb, 0), 4);
  for (const d of datas) {
    const t = new Uint8Array(4), s = new Uint8Array(4); new DataView(t.buffer).setInt32(0, 1, true); new DataView(s.buffer).setInt32(0, d.length, true);
    out.set(xorWith(t, blk), pos); pos += 4; blk += 1;
    out.set(xorWith(s, blk), pos); pos += 4; blk += 1;
    out.set(xorWith(d, blk), pos); pos += d.length; blk += Math.ceil(d.length / 64);
  }
  // read-back check: every old part unchanged in count, every new part readable
  const chk = indexShapes(out);
  if (chk.list.length !== idx.list.length + datas.length) throw new Error('shapes file check failed (part count)');
  for (const e of chk.list.slice(idx.list.length)) if (!readShape(out, chk, e)) throw new Error('shapes file check failed (new part unreadable)');
  return out;
}
/** Read every shape in a shapes file (for the 3D view). Returns Map(shapeId -> geometry). */
function readAllShapes(u8, onProgress) {
  const idx = indexShapes(u8), out = new Map(); let i = 0;
  for (const e of idx.list) { if (e.type === 1) { try { const g = readShape(u8, idx, e); if (g) out.set(e.shapeId, g); } catch (err) {} } if (onProgress && ++i % 20 === 0) onProgress(i / idx.list.length); }
  return out;
}
/** An empty .i3d.shapes file (version 10) — used by the tests. */
function emptyShapesFile(seed) { const ks = makeKeystream(seed), w = new Uint32Array(16); ks(0, w); const b = new Uint8Array(w.buffer); return Uint8Array.of(10, 0, seed, 0, b[0], b[1], b[2], b[3]); }
const maxShapeId = u8 => Math.max(0, ...indexShapes(u8).list.map(e => e.shapeId));
/** Insert text at several positions in one pass. edits: [{at, text}] */
function insertAll(src, edits) { let out = src; for (const e of edits.slice().sort((a, b) => b.at - a.at)) out = out.slice(0, e.at) + e.text + out.slice(e.at); return out; }
/** Make a relative path from one mod file's folder to another mod file. */
function relPath(fromFile, toFile) {
  const a = dirOf(fromFile).split('/').filter(Boolean), b = toFile.split('/'); let k = 0;
  while (k < a.length && k < b.length - 1 && a[k] === b[k]) k++;
  return '../'.repeat(a.length - k) + b.slice(k).join('/');
}

return { modTexts, configItems, renameConfigItems, storeName, setStoreName, tagModTitle, weldMesh, wrapDecal, emptyShapesFile, mat, mmul, buildShapeEntity, appendShapeEntities, readAllShapes, maxShapeId, insertAll, relPath, dirOf, toDDS, resolveRef, kids, find, findAll,
  ddsInfo, decodeDDS, encodeDDS, parseXML, analyzeMod, analyzeI3D, indexShapes, readShape, addConfigOption, slug, normPath };
})();
if (typeof module !== 'undefined') module.exports = Core;
