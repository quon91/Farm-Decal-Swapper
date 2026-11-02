/* Farm Decal Swapper — logo maker. Builds logos as SVG from a template, a picture, text, colours and a font.
   Works in the app (window.LogoMaker) and in Node (module.exports) so packs can be made from the same designs. */
(function (root) {
'use strict';

/* ---------------- fonts, colours, helpers ---------------- */
const FONTS = {
  western: { family: 'Rye', w: 0.80, label: 'Western' },
  slab: { family: 'Alfa Slab One', w: 0.70, label: 'Slab' },
  bold: { family: 'Bebas Neue', w: 0.42, label: 'Tall bold' },
  stencil: { family: 'Saira Stencil One', w: 0.64, label: 'Stencil' },
  script: { family: 'Pacifico', w: 0.58, label: 'Script' },
};
const PALETTES = {
  delta: { label: 'Delta green & gold', bg: '#1f4d22', metal: '#e9b23a', ink: '#0f2c12', text: '#e9b23a', accent: '#d9531a', soft: '#f3ead2' },
  construction: { label: 'Construction black & orange', bg: '#1d1d1b', metal: '#f39200', ink: '#0b0b0a', text: '#f39200', accent: '#ffcc00', soft: '#f2efe9' },
  landscaping: { label: 'Landscaping greens', bg: '#24502a', metal: '#9ccc4b', ink: '#10260f', text: '#ffffff', accent: '#6b4a2b', soft: '#eef5e2' },
  livestock: { label: 'Livestock oxblood & tan', bg: '#5b1e17', metal: '#d4b07a', ink: '#2a0c08', text: '#f2e3c6', accent: '#1b1b1b', soft: '#f5eadb' },
  hauling: { label: 'Hauling navy & chrome', bg: '#14284a', metal: '#c9d1db', ink: '#0a1529', text: '#ffffff', accent: '#c0262d', soft: '#eef1f5' },
  timber: { label: 'Timber pine & rust', bg: '#2c3a23', metal: '#c7743a', ink: '#141c10', text: '#f0e2c8', accent: '#7a4a24', soft: '#f1ead9' },
  grain: { label: 'Grain wheat & brown', bg: '#4a3418', metal: '#e8c15a', ink: '#24180a', text: '#f6e3a8', accent: '#9a6a22', soft: '#f7efd9' },
  black: { label: 'Black & white', bg: '#161616', metal: '#ffffff', ink: '#000000', text: '#ffffff', accent: '#9a9a9a', soft: '#f2f2f2' },
};
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f = n => +(+n).toFixed(1);
function hex(c) { c = c.replace('#', ''); if (c.length === 3) c = c.split('').map(x => x + x).join(''); return [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16)); }
function mix(a, b, t) { const A = hex(a), B = hex(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); }
const light = (c, t) => mix(c, '#ffffff', t), dark = (c, t) => mix(c, '#000000', t);
let uidN = 0;
function rng(s) { let x = s % 2147483647 || 7; return () => (x = (x * 16807) % 2147483647) / 2147483647; }

/* ---------------- pictures: 0..1000 box. kind 'scene' fills the box; 'object' sits on a background ---------------- */
// shared scene parts
const skyGrad = (id, top, mid, bot) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset=".55" stop-color="${mid}"/><stop offset="1" stop-color="${bot}"/></linearGradient>`;
function treeLine(r, y, h, fill, x0 = -20, x1 = 1020, gap = 0) {
  let d = `M${x0} ${y}`, x = x0;
  while (x < x1) { const k = gap && Math.abs(x - 500) < gap ? 0.25 : 1, rr = h * k * (0.45 + r() * 0.55), w = Math.max(18, rr * (1.1 + r() * 0.7));
    d += ` L${f(x)} ${f(y - rr * 0.35)} A${f(w / 2)} ${f(rr)} 0 0 1 ${f(x + w)} ${f(y - rr * 0.35)}`; x += w * (0.62 + r() * 0.3); }
  return `<path d="${d} L${x1} ${y} Z" fill="${fill}"/>`;
}
function rowsField(vx, vy, y1, n, light1, dark1, spread = 3.2) {
  let s = `<rect x="-10" y="${vy}" width="1020" height="${1010 - vy}" fill="${dark1}"/>`;
  for (let i = 0; i < n; i++) { const a = 500 - 1000 * spread / 2 + 1000 * spread * i / n, b = 500 - 1000 * spread / 2 + 1000 * spread * (i + 0.5) / n;
    s += `<path d="M${vx} ${vy} L${f(a)} ${y1} L${f(b)} ${y1} Z" fill="${light1}"/>`; }
  return s;
}
function sun(id, cx, cy, r, glow = 3.4) {
  return `<radialGradient id="${id}g"><stop offset="0" stop-color="#fffbe8"/><stop offset=".3" stop-color="#fff2c4" stop-opacity=".9"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient>
    <circle cx="${cx}" cy="${cy}" r="${r * glow}" fill="url(#${id}g)"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff6d6"/>`;
}
function cypress(r, x, base, h, fill, moss) { // bald cypress: tall straight trunk with a flared base, feathery flat sprays, hanging moss
  const top = base - h, tw = h * 0.014;
  let s = `<path d="M${f(x - h * 0.075)} ${base} C${f(x - h * 0.03)} ${f(base - h * 0.06)} ${f(x - h * 0.028)} ${f(base - h * 0.16)} ${f(x - h * 0.024)} ${f(base - h * 0.3)} L${f(x - tw)} ${f(top + h * 0.08)} L${f(x + tw)} ${f(top + h * 0.08)} L${f(x + h * 0.024)} ${f(base - h * 0.3)} C${f(x + h * 0.03)} ${f(base - h * 0.16)} ${f(x + h * 0.035)} ${f(base - h * 0.06)} ${f(x + h * 0.085)} ${base} Z" fill="${fill}"/>`;
  const tiers = 9;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1), yy = top + h * (0.02 + t * 0.5), side = i % 2 ? 1 : -1, span = h * (0.07 + 0.12 * Math.sin(Math.PI * (0.25 + t * 0.6))) * (0.8 + r() * 0.4);
    const bx = x + side * span * (0.2 + r() * 0.4);
    s += `<path d="M${f(x)} ${f(yy + h * 0.035)} Q${f((x + bx) / 2)} ${f(yy + h * 0.01)} ${f(bx)} ${f(yy)}" stroke="${fill}" stroke-width="${f(h * 0.007)}" fill="none"/>`;
    const n = 6 + Math.round(r() * 4);
    for (let k = 0; k < n; k++) { const ex = bx + (r() - 0.5) * span * 1.6, ey = yy + (r() - 0.6) * h * 0.035, rx = h * (0.025 + r() * 0.035), ry = h * (0.009 + r() * 0.012);
      s += `<ellipse cx="${f(ex)}" cy="${f(ey)}" rx="${f(rx)}" ry="${f(ry)}" transform="rotate(${f((r() - 0.5) * 14)} ${f(ex)} ${f(ey)})" fill="${fill}"/>`;
      if (moss && r() < 0.45) { const ml = h * (0.03 + r() * 0.07); s += `<path d="M${f(ex)} ${f(ey + ry * 0.6)} q${f((r() - 0.5) * 8)} ${f(ml / 2)} ${f((r() - 0.5) * 12)} ${f(ml)}" stroke="${moss}" stroke-width="${f(h * 0.006)}" fill="none" stroke-linecap="round" opacity=".9"/>`; } }
  }
  return s;
}
function mallardShape(x, y, s, flip, colors) { // drake in flight; colors null = silhouette in `flip.fill`
  const c = colors, F = flip && flip.fill, g = (fill) => c ? fill : F;
  const t = `translate(${f(x)} ${f(y)}) scale(${s})`;
  return `<g transform="${t}">
    <path d="M-30 -150 C10 -110 60 -60 80 -10 L40 10 C20 -40 -10 -100 -30 -150 Z" fill="${g('#5f5b52')}"/>
    <path d="M-260 30 C-190 -10 -70 -30 70 -18 C130 -13 175 5 200 30 C170 65 90 90 -20 88 C-130 86 -210 70 -260 30 Z" fill="${g('#a5a197')}"/>
    <path d="M70 -18 C130 -13 175 5 200 30 C170 65 120 80 70 82 C100 50 100 10 70 -18 Z" fill="${g('#6e331a')}"/>
    <path d="M-260 30 L-330 10 L-318 34 L-336 58 L-250 52 Z" fill="${g('#1d1d1b')}"/>
    <path d="M150 -2 C175 -45 210 -70 245 -76 L270 -50 C240 -40 215 -15 200 25 Z" fill="${g('#0f5a38')}"/>
    <ellipse cx="275" cy="-78" rx="52" ry="38" fill="${g('#13703f')}"/>
    <path d="M318 -80 L392 -64 L320 -58 Z" fill="${g('#e2b23a')}"/>
    ${c ? '<path d="M160 6 C178 -18 196 -30 212 -36" stroke="#fff" stroke-width="9" fill="none"/><circle cx="288" cy="-88" r="6" fill="#111"/>' : ''}
    <path d="M-20 0 C-60 -110 -130 -220 -250 -330 C-160 -300 -60 -220 10 -120 C40 -70 55 -30 50 0 Z" fill="${g('#7a766c')}"/>
    ${c ? '<path d="M-72 -70 L-30 -40 L-10 -78 L-52 -108 Z" fill="#2f55c8"/><path d="M-72 -70 L-30 -40" stroke="#fff" stroke-width="6"/><path d="M-250 -330 C-200 -300 -150 -262 -110 -222 L-150 -210 C-185 -255 -215 -290 -250 -330 Z" fill="#3b3934"/>' : ''}
    <path d="M30 0 C40 -130 90 -270 190 -400 C190 -290 150 -170 110 -70 C95 -35 80 -10 70 4 Z" fill="${g('#8f8b80')}"/>
    ${c ? '<path d="M190 -400 C185 -330 165 -270 140 -215 L118 -235 C140 -290 165 -345 190 -400 Z" fill="#3b3934"/>' : ''}
  </g>`;
}
function cottonBoll(x, y, s, mono) {
  const id = 'cb' + (++uidN), lobe = mono ? mono : `url(#${id})`;
  const br = mono ? mono : '#5b3a1f';
  let o = mono ? '' : `<radialGradient id="${id}" cx=".38" cy=".35" r=".75"><stop offset="0" stop-color="#ffffff"/><stop offset=".7" stop-color="#f1ede4"/><stop offset="1" stop-color="#cdc5b6"/></radialGradient>`;
  for (let i = 0; i < 5; i++) { const a = Math.PI * (0.15 + i * 0.175) + Math.PI * 0.5; o += `<path d="M${f(x)} ${f(y + 10 * s)} L${f(x + Math.cos(a) * 85 * s - 14 * s)} ${f(y + Math.sin(a) * 85 * s)} L${f(x + Math.cos(a) * 92 * s + 12 * s)} ${f(y + Math.sin(a) * 92 * s)} Z" fill="${br}"/>`; }
  for (const [dx, dy, r] of [[-38, 0, 46], [38, 0, 46], [0, -40, 48], [-22, 32, 40], [22, 32, 40]]) o += `<circle cx="${f(x + dx * s)}" cy="${f(y + dy * s)}" r="${f(r * s)}" fill="${lobe}" ${mono ? '' : 'stroke="#d8d0c0" stroke-width="2"'}/>`;
  return o;
}
function cottonLeaf(x, y, s, rot, fill) {
  return `<path transform="translate(${f(x)} ${f(y)}) rotate(${rot}) scale(${s})" d="M0 0 C-10 -30 -60 -40 -70 -80 C-40 -70 -30 -95 -20 -120 C-5 -100 5 -100 20 -120 C30 -95 40 -70 70 -80 C60 -40 10 -30 0 0 Z" fill="${fill}"/>`;
}
function riceStalk(x, base, h, lean, fill, grain) {
  const tx = x + lean, ty = base - h;
  let s = `<path d="M${f(x)} ${base} Q${f(x + lean * 0.2)} ${f(base - h * 0.6)} ${f(tx)} ${f(ty)}" stroke="${fill}" stroke-width="${f(h * 0.018)}" fill="none" stroke-linecap="round"/>`;
  for (let i = 0; i < 9; i++) { const t = i / 9, px = tx + lean * 0.6 * t + Math.sin(t * 3) * 6, py = ty + h * 0.32 * t;
    s += `<ellipse cx="${f(px - 9)}" cy="${f(py)}" rx="${f(h * 0.012)}" ry="${f(h * 0.028)}" transform="rotate(${f(-30 + lean / 5)} ${f(px - 9)} ${f(py)})" fill="${grain}"/><ellipse cx="${f(px + 9)}" cy="${f(py + 4)}" rx="${f(h * 0.012)}" ry="${f(h * 0.028)}" transform="rotate(${f(30 + lean / 5)} ${f(px + 9)} ${f(py + 4)})" fill="${grain}"/>`; }
  s += `<path d="M${f(x)} ${f(base - h * 0.2)} Q${f(x - h * 0.25)} ${f(base - h * 0.5)} ${f(x - h * 0.32)} ${f(base - h * 0.75)}" stroke="${fill}" stroke-width="${f(h * 0.02)}" fill="none" stroke-linecap="round"/>`;
  return s;
}
function plane(x, y, s, fill) { // crop duster, low wing tail-dragger, facing right
  return `<g transform="translate(${f(x)} ${f(y)}) scale(${s})" fill="${fill}">
    <path d="M-300 -10 C-200 -30 -40 -40 120 -38 C190 -37 240 -30 262 -14 L262 14 C230 26 160 30 60 30 C-80 30 -220 20 -300 10 Z"/>
    <path d="M-300 -10 L-345 -95 L-305 -95 L-250 -20 Z"/><path d="M-330 0 L-250 -6 L-250 8 L-330 14 Z"/>
    <path d="M40 -38 C60 -80 120 -92 165 -78 L175 -38 Z"/><path d="M-120 22 L240 22 L250 38 L-110 40 Z"/>
    <rect x="262" y="-60" width="10" height="120" rx="5"/><ellipse cx="267" cy="0" rx="10" ry="74" opacity=".35"/>
    <path d="M150 30 L130 92 L146 92 L172 30 Z"/><circle cx="138" cy="100" r="18"/><circle cx="-290" cy="22" r="9"/>
  </g>`;
}
function bins(x, base, w, h, metal, roof, ink, rib) {
  let s = `<rect x="${f(x - w / 2)}" y="${f(base - h)}" width="${w}" height="${h}" fill="${metal}"/>`;
  for (let i = 1; i < 9; i++) s += `<line x1="${f(x - w / 2)}" x2="${f(x + w / 2)}" y1="${f(base - h * i / 9)}" y2="${f(base - h * i / 9)}" stroke="${rib}" stroke-width="2.5" opacity=".6"/>`;
  s += `<rect x="${f(x - w / 2)}" y="${f(base - h)}" width="${f(w * 0.28)}" height="${h}" fill="#000" opacity=".18"/><rect x="${f(x + w * 0.2)}" y="${f(base - h)}" width="${f(w * 0.12)}" height="${h}" fill="#fff" opacity=".22"/>`;
  s += `<path d="M${f(x - w / 2 - 6)} ${f(base - h)} L${x} ${f(base - h - w * 0.38)} L${f(x + w / 2 + 6)} ${f(base - h)} Z" fill="${roof}"/><rect x="${f(x - 10)}" y="${f(base - h - w * 0.44)}" width="20" height="${f(w * 0.08)}" fill="${ink}"/>`;
  return s;
}

const PICS = {
  sunrise: { label: 'Sunrise over the rows', group: 'Delta farm', kind: 'scene', mono: 'sunburst', draw(p) {
    const id = 'sr' + (++uidN), r = rng(11);
    return `<defs>${skyGrad(id, '#d9531a', '#f39a2b', '#fdd77a')}</defs><rect width="1000" height="1000" fill="url(#${id})"/>${sun(id, 500, 610, 70)}
      ${treeLine(r, 615, 70, '#163a17', -20, 1020, 120)}${rowsField(500, 612, 1000, 40, '#4f9a32', '#1d4a1e')}<rect y="610" width="1000" height="8" fill="#f6c453" opacity=".6"/>
      ${mallardShape(690, 260, 0.22, { fill: '#1b1b16' }, null)}${mallardShape(800, 200, 0.17, { fill: '#1b1b16' }, null)}`; } },
  cottonField: { label: 'Cotton field at sunrise', group: 'Delta farm', kind: 'scene', mono: 'cotton', draw(p) {
    const id = 'cf' + (++uidN), r = rng(5), hy = 560;
    let s = `<defs>${skyGrad(id, '#c9622b', '#f2a24a', '#fde3a1')}</defs><rect width="1000" height="1000" fill="url(#${id})"/>${sun(id, 560, hy, 60)}${treeLine(r, hy + 4, 60, '#2b3d22', -20, 1020, 80)}`;
    s += rowsField(500, hy, 1000, 46, '#4c6b2a', '#2c3f1b', 4);
    for (let i = 0; i < 46; i++) for (let t = 0.05; t < 1; t += 0.035 + t * 0.05) { const a = 500 - 2000 + 4000 * (i + 0.27) / 46, px = 500 + (a - 500) * t, py = hy + (1000 - hy) * t;
      if (px < -30 || px > 1030) continue; const rr = 1.2 + t * 15; s += `<circle cx="${f(px + (r() - 0.5) * rr * 2)}" cy="${f(py - rr * 0.6)}" r="${f(rr)}" fill="#fbf8f0" opacity="${f(0.75 + t * 0.25)}"/>`; }
    return s; } },
  riceField: { label: 'Flooded rice field', group: 'Delta farm', kind: 'scene', mono: 'rice', draw(p) {
    const id = 'rf' + (++uidN), r = rng(9), hy = 520;
    let s = `<defs>${skyGrad(id, '#e2793a', '#f6b25a', '#fde7b0')}<linearGradient id="${id}w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4c375"/><stop offset=".5" stop-color="#d9824a"/><stop offset="1" stop-color="#5a4a52"/></linearGradient></defs>
      <rect width="1000" height="1000" fill="url(#${id})"/>${sun(id, 430, hy, 55)}${treeLine(r, hy + 2, 55, '#2f3b2a')}<rect y="${hy}" width="1000" height="${1000 - hy}" fill="url(#${id}w)"/>`;
    for (let row = 0; row < 14; row++) { const t = (row + 1) / 15, y = hy + 8 + (1000 - hy) * t * t, n = 8 + row * 3;
      for (let k = 0; k < n; k++) { const x = (k + 0.5 + (row % 2) * 0.5) * 1000 / n, hh = 6 + t * 70;
        s += `<path d="M${f(x)} ${f(y)} l${f(-hh * 0.15)} ${f(-hh)} M${f(x)} ${f(y)} l${f(hh * 0.05)} ${f(-hh * 1.1)} M${f(x)} ${f(y)} l${f(hh * 0.2)} ${f(-hh * 0.9)}" stroke="#3f7a2a" stroke-width="${f(1 + t * 3)}" stroke-linecap="round"/>`; } }
    for (let i = 0; i < 7; i++) s += riceStalk(60 + i * 140 + r() * 40, 1010, 300 + r() * 120, 60 + r() * 60, '#6d8a2c', '#e0b64a');
    s += mallardShape(690, 230, 0.2, { fill: '#2a2420' }, null) + mallardShape(560, 170, 0.15, { fill: '#2a2420' }, null);
    return s; } },
  cypress: { label: 'Cypress bayou', group: 'Delta farm', kind: 'scene', mono: 'cypressTree', draw(p) {
    const id = 'cy' + (++uidN), r = rng(3), hy = 640;
    let s = `<defs>${skyGrad(id, '#5a2f4a', '#d4693a', '#f8c46a')}<linearGradient id="${id}w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9a457"/><stop offset="1" stop-color="#2b2633"/></linearGradient></defs>
      <rect width="1000" height="1000" fill="url(#${id})"/>${sun(id, 640, hy - 40, 62)}${treeLine(r, hy + 2, 40, '#2a1f26')}<rect y="${hy}" width="1000" height="${1000 - hy}" fill="url(#${id}w)"/>`;
    for (let i = 0; i < 8; i++) s += `<rect x="${f(560 - 120 + i * 30)}" y="${f(hy + 30 + i * 22)}" width="${f(240 - i * 24)}" height="6" rx="3" fill="#ffd89a" opacity="${f(0.6 - i * 0.06)}"/>`;
    const trees = [[200, hy + 30, 560], [380, hy + 10, 400], [860, hy + 20, 500], [70, hy + 5, 300]];
    const tr = trees.map(([x, b, h]) => cypress(r, x, b, h, '#1a1416', '#3a3a32')).join('');
    s += `<g opacity=".35" transform="translate(0 ${2 * hy + 40}) scale(1 -1)">${trees.map(([x, b, h]) => cypress(rng(4), x, b, h, '#1a1416', null)).join('')}</g>` + tr;
    for (let i = 0; i < 9; i++) { const x = 120 + r() * 800, y = hy + 40 + r() * 120; s += `<path d="M${f(x - 8)} ${f(y)} L${f(x - 3)} ${f(y - 22)} L${f(x + 4)} ${f(y - 24)} L${f(x + 9)} ${f(y)} Z" fill="#1a1416"/>`; }
    s += mallardShape(520, 300, 0.16, { fill: '#1a1416' }, null);
    return s; } },
  ducks: { label: 'Mallards over the marsh', group: 'Delta farm', kind: 'scene', mono: 'mallard', draw(p) {
    const id = 'dk' + (++uidN), r = rng(21), hy = 700;
    let s = `<defs>${skyGrad(id, '#7b8fb0', '#e8b07a', '#fbe0b0')}<linearGradient id="${id}w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9c08f"/><stop offset="1" stop-color="#5d6b7a"/></linearGradient></defs>
      <rect width="1000" height="1000" fill="url(#${id})"/>${sun(id, 300, hy - 20, 50)}${treeLine(r, hy + 2, 50, '#3a3a33')}<rect y="${hy}" width="1000" height="${1000 - hy}" fill="url(#${id}w)"/>`;
    for (let i = 0; i < 26; i++) { const x = r() * 1000, h = 120 + r() * 220, lean = (r() - 0.5) * 60;
      s += `<path d="M${f(x)} 1010 Q${f(x + lean / 2)} ${f(1010 - h / 2)} ${f(x + lean)} ${f(1010 - h)}" stroke="#2c3424" stroke-width="7" fill="none"/>`;
      if (i % 3 === 0) s += `<ellipse cx="${f(x + lean)}" cy="${f(1010 - h + 30)}" rx="10" ry="34" fill="#4a3220"/>`; }
    s += mallardShape(560, 420, 0.62, null, true) + mallardShape(250, 300, 0.3, { fill: '#33302a' }, null) + mallardShape(820, 230, 0.24, { fill: '#33302a' }, null);
    return s; } },
  duster: { label: 'Crop duster over the field', group: 'Delta farm', kind: 'scene', mono: 'plane', draw(p) {
    const id = 'du' + (++uidN), r = rng(8), hy = 600;
    let s = `<defs>${skyGrad(id, '#5d8fc4', '#a9cbe4', '#f4e6c2')}<linearGradient id="${id}m" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".75"/></linearGradient></defs>
      <rect width="1000" height="1000" fill="url(#${id})"/>${treeLine(r, hy + 2, 55, '#3a5a2e')}${rowsField(500, hy, 1000, 40, '#6aa23a', '#2f5a24', 3.6)}`;
    s += `<path d="M40 560 C200 520 380 470 560 440 L560 470 C380 500 220 560 60 620 Z" fill="url(#${id}m)"/>`;
    s += plane(650, 420, 0.95, '#c7a21f') + `<path d="M380 400 L940 400 L950 408 L390 410 Z" fill="#000" opacity=".12"/>`;
    return s; } },
  binsScene: { label: 'Grain bins at dusk', group: 'Delta farm', kind: 'scene', mono: 'binsIcon', draw(p) {
    const id = 'gb' + (++uidN), r = rng(14), hy = 760;
    let s = `<defs>${skyGrad(id, '#3e4f7a', '#d4774a', '#f7c77a')}<linearGradient id="${id}m" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8d939b"/><stop offset=".55" stop-color="#e6e9ec"/><stop offset="1" stop-color="#9aa1a9"/></linearGradient></defs>
      <rect width="1000" height="1000" fill="url(#${id})"/>${sun(id, 820, hy - 30, 50)}${treeLine(r, hy + 2, 45, '#2a2a2a')}`;
    s += `<rect x="470" y="200" width="26" height="${hy - 200}" fill="#5a5f66"/><path d="M483 210 L280 470 M483 230 L640 420 M483 250 L820 520" stroke="#5a5f66" stroke-width="9"/>`;
    s += bins(300, hy, 230, 300, `url(#${id}m)`, '#b9c0c7', '#4b5056', '#5e646b') + bins(640, hy, 260, 340, `url(#${id}m)`, '#b9c0c7', '#4b5056', '#5e646b') + bins(860, hy, 170, 230, `url(#${id}m)`, '#b9c0c7', '#4b5056', '#5e646b');
    s += rowsField(500, hy, 1000, 30, '#b8902f', '#6d521c', 3);
    return s; } },
  // objects
  cotton: { label: 'Cotton boll', group: 'Delta farm', kind: 'object', draw(p, mono) {
    const leaf = mono || '#3d6b2a', stem = mono || '#5b3a1f';
    return `<path d="M500 980 C500 820 470 700 420 560 M470 720 C560 640 640 560 690 420 M490 860 C400 820 330 760 300 640" stroke="${stem}" stroke-width="22" fill="none" stroke-linecap="round"/>
      ${cottonLeaf(470, 760, 1.6, -40, leaf)}${cottonLeaf(560, 640, 1.3, 50, leaf)}${cottonLeaf(380, 860, 1.4, -100, leaf)}
      ${cottonBoll(420, 470, 2.0, mono)}${cottonBoll(700, 330, 1.6, mono)}${cottonBoll(290, 560, 1.4, mono)}`; } },
  rice: { label: 'Rice heads', group: 'Delta farm', kind: 'object', draw(p, mono) {
    let s = ''; for (let i = 0; i < 5; i++) s += riceStalk(380 + i * 60, 980, 760 - i * 40, 160 - i * 50, mono || '#5d7d28', mono || '#e0b64a'); return s; } },
  cypressTree: { label: 'Cypress tree', group: 'Delta farm', kind: 'object', draw(p, mono) {
    return cypress(rng(3), 500, 950, 900, mono || p.ink, mono ? null : light(p.ink, 0.35)) + `<path d="M120 960 Q500 930 880 960" stroke="${mono || p.ink}" stroke-width="18" fill="none" stroke-linecap="round"/>`; } },
  mallard: { label: 'Mallard drake', group: 'Delta farm', kind: 'object', draw(p, mono) { return mallardShape(470, 640, 1.25, mono ? { fill: mono } : null, !mono); } },
  plane: { label: 'Crop duster plane', group: 'Delta farm', kind: 'object', draw(p, mono) { return plane(500, 520, 1.45, mono || p.ink); } },
  binsIcon: { label: 'Grain bins', group: 'Grain', kind: 'object', draw(p, mono) {
    const m = mono || p.metal, ink = mono ? 'none' : p.ink;
    return `<rect x="482" y="120" width="30" height="820" fill="${mono || p.ink}"/><path d="M497 140 L260 470 M497 170 L740 440" stroke="${mono || p.ink}" stroke-width="14"/>` +
      bins(300, 940, 270, 400, m, mono || light(p.metal, 0.3), mono || p.ink, mono ? 'transparent' : dark(p.metal, 0.4)) + bins(700, 940, 300, 470, m, mono || light(p.metal, 0.3), mono || p.ink, mono ? 'transparent' : dark(p.metal, 0.4)); } },
  wheat: { label: 'Wheat', group: 'Grain', kind: 'object', draw(p, mono) {
    const c = mono || p.metal; let s = '';
    for (const [x, lean] of [[420, -120], [500, 0], [580, 120]]) { s += `<path d="M500 980 Q${f(500 + lean * 0.3)} 600 ${f(x + lean * 0.4)} 300" stroke="${c}" stroke-width="16" fill="none"/>`;
      for (let i = 0; i < 8; i++) { const t = i / 8, cx = x + lean * 0.4 - lean * 0.12 * t, cy = 290 - t * 230; s += `<ellipse cx="${f(cx - 26)}" cy="${f(cy)}" rx="20" ry="44" transform="rotate(-28 ${f(cx - 26)} ${f(cy)})" fill="${c}"/><ellipse cx="${f(cx + 26)}" cy="${f(cy + 10)}" rx="20" ry="44" transform="rotate(28 ${f(cx + 26)} ${f(cy + 10)})" fill="${c}"/>`; }
      s += `<ellipse cx="${f(x + lean * 0.4 - lean * 0.12)}" cy="40" rx="18" ry="46" fill="${c}"/>`; }
    return s; } },
  excavator: { label: 'Excavator', group: 'Construction', kind: 'object', draw(p, mono) {
    const body = mono || p.metal, ink = mono || p.ink, glass = mono ? 'none' : light(p.ink, 0.25);
    return `<g>
      <rect x="300" y="790" width="560" height="120" rx="60" fill="${ink}"/>${mono ? '' : [360, 450, 540, 630, 720, 800].map(x => `<circle cx="${x}" cy="850" r="34" fill="${light(p.ink, 0.25)}"/>`).join('')}
      <rect x="330" y="760" width="500" height="40" fill="${ink}"/>
      <path d="M400 760 L400 600 Q400 580 420 580 L880 580 Q920 580 920 620 L920 760 Z" fill="${body}"/>
      <path d="M560 580 L560 420 Q560 400 580 400 L700 400 Q720 400 726 420 L760 580 Z" fill="${body}"/>
      ${mono ? '<path d="M585 425 L695 425 L728 560 L585 560 Z" fill="#000" opacity="0"/>' : `<path d="M585 425 L695 425 L728 560 L585 560 Z" fill="${glass}"/>`}
      <path d="M470 600 L520 600 L330 260 L270 290 Z" fill="${body}"/>
      <path d="M330 262 L272 292 L170 560 L215 575 Z" fill="${body}"/>
      <path d="M150 540 L250 560 L265 640 Q220 700 140 690 L95 640 Z" fill="${ink}"/>
      <path d="M95 640 L70 660 M120 680 L95 702 M150 690 L130 716" stroke="${ink}" stroke-width="18" stroke-linecap="round"/>
      <rect x="290" y="420" width="16" height="200" transform="rotate(-30 298 520)" fill="${ink}" opacity="${mono ? 0 : 0.6}"/>
    </g>`; } },
  hardhat: { label: 'Hard hat', group: 'Construction', kind: 'object', draw(p, mono) {
    const c = mono || p.metal, sh = mono ? 'none' : dark(p.metal, 0.25), hl = mono ? 'none' : light(p.metal, 0.35);
    return `<path d="M180 640 C180 400 330 250 500 250 C670 250 820 400 820 640 Z" fill="${c}"/>
      <path d="M420 262 L440 640 L560 640 L580 262 C540 254 460 254 420 262 Z" fill="${sh}"/>
      <path d="M260 560 C270 420 360 320 470 290" stroke="${hl}" stroke-width="26" fill="none" stroke-linecap="round"/>
      <path d="M90 640 L910 640 Q950 640 950 680 L950 700 Q950 730 910 730 L90 730 Q60 730 60 700 L60 680 Q60 640 90 640 Z" fill="${c}"/>
      <rect x="60" y="700" width="890" height="30" fill="${sh}"/>`; } },
  oak: { label: 'Live oak tree', group: 'Landscaping', kind: 'object', draw(p, mono) {
    const c = mono || p.metal, tr = mono || p.accent, r = rng(17); let s = '';
    s += `<path d="M460 940 C470 820 470 720 440 640 C380 560 280 520 180 500 L190 480 C300 490 390 530 450 600 C460 540 440 470 400 420 L420 410 C470 460 500 530 505 600 C540 520 610 470 700 440 L708 460 C620 500 560 560 540 650 C530 740 540 840 560 940 Z" fill="${tr}"/>`;
    for (let i = 0; i < 46; i++) { const a = r() * Math.PI, rr = 120 + r() * 230, x = 500 + Math.cos(a) * rr * 1.2, y = 450 - Math.sin(a) * rr * 0.7, cr = 55 + r() * 60;
      s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(cr)}" fill="${c}"/>`; }
    s += `<path d="M120 940 L880 940" stroke="${mono || p.metal}" stroke-width="20" stroke-linecap="round"/>`;
    return s; } },
  leaf: { label: 'Leaf', group: 'Landscaping', kind: 'object', draw(p, mono) {
    const c = mono || p.metal, v = mono ? 'transparent' : dark(p.metal, 0.35);
    return `<path d="M500 900 C260 760 180 520 260 260 C330 170 430 120 520 90 C640 200 790 380 760 590 C730 760 620 860 500 900 Z" fill="${c}"/>
      <path d="M500 900 C500 700 520 420 520 90" stroke="${v}" stroke-width="18" fill="none"/>${[0.25, 0.42, 0.58, 0.74].map((t, i) => { const y = 900 - 810 * t; return `<path d="M${f(503 + 17 * t)} ${f(y)} Q${f(400 - i * 10)} ${f(y - 60)} ${f(300 + i * 10)} ${f(y - 140)} M${f(503 + 17 * t)} ${f(y + 20)} Q${f(620 + i * 6)} ${f(y - 50)} ${f(700 - i * 14)} ${f(y - 120)}" stroke="${v}" stroke-width="12" fill="none"/>`; }).join('')}`; } },
  bull: { label: 'Bull head', group: 'Livestock', kind: 'object', draw(p, mono) {
    const c = mono || p.ink, horn = mono || light(p.metal, 0.4), cut = mono ? null : p.bg;
    const half = 'M500 300 C560 296 600 300 640 318 C700 300 790 330 850 372 C800 400 730 410 680 404 C672 470 650 520 630 570 C620 640 600 700 560 740 C540 760 520 770 500 772';
    const mirror = half.replace(/(-?\d+\.?\d*) (-?\d+\.?\d*)/g, (m, x, y) => `${f(1000 - x)} ${y}`);
    return `<path d="M640 318 C700 280 760 220 770 140 C790 220 760 300 690 350 Z" fill="${horn}"/><path d="M360 318 C300 280 240 220 230 140 C210 220 240 300 310 350 Z" fill="${horn}"/>
      <path d="${half} L500 300 Z" fill="${c}"/><path d="${mirror} L500 300 Z" fill="${c}"/>
      ${cut ? `<ellipse cx="420" cy="470" rx="16" ry="11" fill="${cut}"/><ellipse cx="580" cy="470" rx="16" ry="11" fill="${cut}"/><ellipse cx="465" cy="720" rx="14" ry="20" fill="${cut}"/><ellipse cx="535" cy="720" rx="14" ry="20" fill="${cut}"/>` : ''}`; } },
  semi: { label: 'Semi truck', group: 'Hauling', kind: 'object', draw(p, mono) {
    const cab = mono || p.metal, tr = mono || light(p.bg, 0.15), ink = mono || p.ink, rim = mono ? null : '#c9ced6';
    const wheel = x => `<circle cx="${x}" cy="760" r="56" fill="${ink}"/>` + (rim ? `<circle cx="${x}" cy="760" r="26" fill="${rim}"/>` : '');
    return `<rect x="30" y="380" width="560" height="320" rx="8" fill="${tr}" ${mono ? '' : `stroke="${ink}" stroke-width="8"`}/>
      ${mono ? '' : [1, 2, 3, 4, 5, 6, 7].map(i => `<line x1="${30 + i * 70}" x2="${30 + i * 70}" y1="390" y2="690" stroke="${ink}" stroke-width="4" opacity=".35"/>`).join('')}
      <rect x="30" y="700" width="560" height="22" fill="${ink}"/><rect x="560" y="690" width="400" height="26" fill="${ink}"/>
      <path d="M612 700 L612 400 Q612 380 632 380 L720 380 Q740 380 740 400 L740 700 Z" fill="${cab}"/>
      <path d="M740 700 L740 470 L800 470 L850 560 L940 580 Q965 585 965 610 L965 700 Z" fill="${cab}"/>
      ${mono ? '' : `<path d="M752 485 L795 485 L832 555 L752 555 Z" fill="${light(p.ink, 0.3)}"/><rect x="900" y="600" width="58" height="80" fill="${dark(p.metal, 0.3)}"/>`}
      <rect x="700" y="250" width="18" height="290" rx="9" fill="${mono || '#c9ced6'}"/><rect x="760" y="630" width="110" height="46" rx="23" fill="${mono || '#c9ced6'}"/>
      ${wheel(110)}${wheel(230)}${wheel(660)}${wheel(780)}${wheel(910)}`; } },
  pine: { label: 'Pines & logs', group: 'Timber', kind: 'object', draw(p, mono) {
    const c = mono || p.bg === p.ink ? (mono || p.metal) : (mono || light(p.bg, 0.25)), log = mono || p.metal, ring = mono ? null : dark(p.metal, 0.35);
    const tree = (x, b, h) => { let s = `<rect x="${x - 12}" y="${b - 60}" width="24" height="60" fill="${mono || p.accent}"/>`; for (let i = 0; i < 4; i++) { const w = h * (0.42 - i * 0.08), y = b - 50 - i * h * 0.2; s += `<path d="M${f(x - w)} ${f(y)} L${x} ${f(y - h * 0.34)} L${f(x + w)} ${f(y)} Z" fill="${c}"/>`; } return s; };
    const l = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${log}"/>` + (ring ? `<circle cx="${x}" cy="${y}" r="${f(r * 0.62)}" fill="none" stroke="${ring}" stroke-width="7"/><circle cx="${x}" cy="${y}" r="${f(r * 0.28)}" fill="none" stroke="${ring}" stroke-width="6"/>` : '');
    return tree(330, 700, 620) + tree(560, 640, 760) + tree(760, 700, 560) + l(300, 860, 80) + l(470, 860, 80) + l(640, 860, 80) + l(385, 720, 80) + l(555, 720, 80);
  } },
  sunburst: { label: 'Rising sun', group: 'Delta farm', kind: 'object', draw(p, mono) {
    const c = mono || p.metal; let s = '';
    for (let i = 0; i < 17; i++) { const a = Math.PI + Math.PI * (i + 0.5) / 17, w = 0.05, r0 = 230, r1 = i % 2 ? 420 : 500;
      s += `<path d="M${f(500 + r0 * Math.cos(a - w))} ${f(620 + r0 * Math.sin(a - w))} L${f(500 + r1 * Math.cos(a))} ${f(620 + r1 * Math.sin(a))} L${f(500 + r0 * Math.cos(a + w))} ${f(620 + r0 * Math.sin(a + w))} Z" fill="${c}"/>`; }
    s += `<path d="M310 620 A190 190 0 0 1 690 620 Z" fill="${c}"/><rect x="80" y="632" width="840" height="16" rx="8" fill="${c}"/>`;
    for (let i = 0; i < 9; i++) { const xb = 500 + (i - 4) * 120; s += `<path d="M500 668 L${f(xb - 34)} 960 L${f(xb + 34)} 960 Z" fill="${c}"/>`; }
    return s; } },
  none: { label: 'No picture', group: 'Other', kind: 'none', draw() { return ''; } },
};

/* ---------------- text ---------------- */
function fitText(txt, font, size, maxW, spacing = 0) { const nat = String(txt).length * FONTS[font].w * size + Math.max(0, String(txt).length - 1) * spacing; return nat > maxW ? maxW : 0; }
function text(o, txt, x, y, size, maxW, opt = {}) {
  if (!txt) return '';
  const font = opt.font || o.font, fam = FONTS[font].family, sp = opt.spacing || 0, tl = fitText(txt, font, size, maxW, sp);
  const fill = opt.fill || (o.mono || o.pal.text), stroke = o.mono || font === 'stencil' ? null : (opt.stroke === undefined ? o.pal.ink : opt.stroke);
  const attrs = `x="${f(x)}" y="${f(y)}" font-family="${fam}" font-size="${f(size)}" text-anchor="middle"${sp ? ` letter-spacing="${f(sp)}"` : ''}${tl ? ` textLength="${f(tl)}" lengthAdjust="spacingAndGlyphs"` : ''}`;
  let s = '';
  if (!o.mono && opt.shadow !== false && stroke) s += `<text ${attrs} fill="${stroke}" stroke="${stroke}" stroke-width="${f(size * 0.16)}" stroke-linejoin="round" transform="translate(${f(size * 0.025)} ${f(size * 0.045)})" opacity=".8">${esc(txt)}</text>`;
  s += `<text ${attrs} fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${f(size * (opt.sw || 0.08))}" stroke-linejoin="round" paint-order="stroke"` : ''}>${esc(txt)}</text>`;
  return s;
}
function arcText(o, txt, pathId, d, len, size, opt = {}) {
  if (!txt) return '';
  const font = opt.font || o.font, n = String(txt).length, sp = opt.spacing == null ? size * 0.08 : opt.spacing;
  const fit = Math.min(size, len * 0.9 / (n * FONTS[font].w + (n - 1) * sp / size));
  const stroke = o.mono ? '' : ` stroke="${o.pal.ink}" stroke-width="${f(fit * 0.09)}" stroke-linejoin="round" paint-order="stroke"`;
  return `<path id="${pathId}" d="${d}" fill="none"/><text font-family="${FONTS[font].family}" font-size="${f(fit)}" letter-spacing="${f(sp * fit / size)}" text-anchor="middle" fill="${opt.fill || o.mono || o.metalFill}"${stroke}><textPath href="#${pathId}" startOffset="50%">${esc(txt)}</textPath></text>`;
}
function star(x, y, r, fill) { let d = ''; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.42 : r; d += (i ? 'L' : 'M') + f(x + rr * Math.cos(a)) + ' ' + f(y + rr * Math.sin(a)); } return `<path d="${d}Z" fill="${fill}"/>`; }

/* the picture inside a box; scenes fill the box, objects sit on `bgFill` */
function art(o, x, y, w, h, opts = {}) { // the picture, moved and sized as the user set it
  const inner = artInner(o, x, y, w, h, opts); if (!inner) return '';
  const s = o.picScale || 1, k = picKind(o) === 'scene' || (o.mono && picKind(o) === 'scene');
  let dx = (o.picX || 0) * o.TW, dy = (o.picY || 0) * o.TH;
  if (k) { const mx = Math.max(0, (s - 1) * w / 2), my = Math.max(0, (s - 1) * h / 2); dx = Math.max(-mx, Math.min(mx, dx)); dy = Math.max(-my, Math.min(my, dy)); } // backgrounds never leave a gap
  if (!dx && !dy && s === 1) return inner;
  const cx = x + w / 2, cy = y + h / 2;
  return `<g transform="translate(${f(dx + cx)} ${f(dy + cy)}) scale(${+s.toFixed(3)}) translate(${f(-cx)} ${f(-cy)})">${inner}</g>`;
}
function artInner(o, x, y, w, h, opts = {}) {
  if (o.photo) { // the user's own photo, screenshot or 3D render
    const fill = o.photoMode === 'fill', pad = fill ? 0 : (opts.pad == null ? 0.08 : opts.pad);
    const filt = o.mono ? ` filter="url(#${o.uid}${fill ? 'gray' : 'sil'})"` : '';
    return `<image href="${o.photo}" x="${f(x + w * pad)}" y="${f(y + h * pad)}" width="${f(w * (1 - 2 * pad))}" height="${f(h * (1 - 2 * pad))}" preserveAspectRatio="xMidYMid ${fill ? 'slice' : 'meet'}"${filt}/>`;
  }
  let key = o.pic, pic = PICS[key] || PICS.none;
  if (o.mono && pic.kind === 'scene') { key = pic.mono; pic = PICS[key]; }
  if (pic.kind === 'none') return '';
  const fit = pic.kind === 'scene' ? 'xMidYMid slice' : 'xMidYMid meet', pad = pic.kind === 'object' ? (opts.pad == null ? 0.12 : opts.pad) : 0;
  return `<svg x="${f(x + w * pad)}" y="${f(y + h * pad)}" width="${f(w * (1 - 2 * pad))}" height="${f(h * (1 - 2 * pad))}" viewBox="0 0 1000 1000" preserveAspectRatio="${fit}">${pic.draw(o.pal, o.mono)}</svg>`;
}
const picKind = o => o.photo ? (o.photoMode === 'fill' ? 'scene' : 'object') : (PICS[o.pic] || PICS.none).kind;
const isScene = o => !o.mono && picKind(o) === 'scene';

/* ---------------- templates ---------------- */
const TEMPLATES = {
  seal: { label: 'Round seal', w: 2048, h: 2048, draw(o) {
    const u = o.uid, c = 1024, M = o.metalFill, ink = o.mono ? 'none' : o.pal.ink;
    let s = o.mono ? `<circle cx="${c}" cy="${c}" r="990" fill="none" stroke="${o.mono}" stroke-width="26"/>` : `<circle cx="${c}" cy="${c}" r="1012" fill="${ink}"/><circle cx="${c}" cy="${c}" r="988" fill="${M}"/><circle cx="${c}" cy="${c}" r="958" fill="${o.pal.bg}"/>`;
    s += `<clipPath id="${u}c"><circle cx="${c}" cy="${c}" r="690"/></clipPath>`;
    if (!o.mono && !isScene(o)) s += `<circle cx="${c}" cy="${c}" r="690" fill="${light(o.pal.bg, 0.08)}"/>`;
    s += `<g clip-path="url(#${u}c)">${art(o, c - 700, c - 700, 1400, 1400, { pad: 0.14 })}</g>`;
    s += `<circle cx="${c}" cy="${c}" r="705" fill="none" stroke="${M}" stroke-width="${o.mono ? 22 : 30}"/>`;
    s += arcText(o, o.l1, u + 't', `M${c - 780} ${c} A780 780 0 0 1 ${c + 780} ${c}`, Math.PI * 780 * 0.92, 200);
    s += arcText(o, o.l2, u + 'b', `M${c - 905} ${c} A905 905 0 0 0 ${c + 905} ${c}`, Math.PI * 905 * 0.62, 160, { spacing: 40 });
    s += star(c - 840, c, 60, M) + star(c + 840, c, 60, M);
    if (o.l3) s += `<rect x="${c - 560}" y="${c + 400}" width="1120" height="150" rx="16" fill="${o.mono ? 'none' : o.pal.bg}" stroke="${M}" stroke-width="14"/>` + text(o, o.l3, c, c + 512, 100, 1000, { font: 'bold', spacing: 12, fill: o.mono || o.pal.text, shadow: false });
    return s; } },
  shield: { label: 'Shield', w: 1700, h: 2048, draw(o) {
    const u = o.uid, W = 1700, cx = 850, M = o.metalFill;
    const sh = `M150 120 L${W - 150} 120 L${W - 150} 1050 Q${W - 150} 1640 ${cx} 1960 Q150 1640 150 1050 Z`;
    let s = o.mono ? `<path d="${sh}" fill="none" stroke="${o.mono}" stroke-width="26"/>` : `<path d="${sh}" fill="${o.pal.ink}" transform="translate(${cx} 1040) scale(1.06) translate(${-cx} -1040)"/><path d="${sh}" fill="${M}" transform="translate(${cx} 1040) scale(1.035) translate(${-cx} -1040)"/><path d="${sh}" fill="${o.pal.bg}"/>`;
    s += `<clipPath id="${u}s"><path d="${sh}"/></clipPath><g clip-path="url(#${u}s)">${isScene(o) || (o.mono && picKind(o) === 'scene') ? art(o, 150, 120, W - 300, 930) : art(o, cx - 440, 150, 880, 880, { pad: 0.06 })}</g>`;
    s += `<path d="M40 1010 L${W - 40} 1010 L${W - 10} 1110 L${W - 40} 1215 L40 1215 L10 1110 Z" fill="${o.mono ? 'none' : o.pal.ink}"${o.mono ? ` stroke="${o.mono}" stroke-width="14"` : ''}/>`;
    if (!o.mono) s += `<path d="M55 1025 L${W - 55} 1025 L${W - 28} 1110 L${W - 55} 1200 L55 1200 L28 1110 Z" fill="${M}"/><path d="M80 1045 L${W - 80} 1045 L${W - 55} 1110 L${W - 80} 1180 L80 1180 L55 1110 Z" fill="${o.pal.bg}"/>`;
    s += text(o, o.l1, cx, 1160, 150, 1380, { fill: o.mono || o.metalFill });
    s += text(o, o.l2, cx, 1500, 210, 1150, { fill: o.mono || o.metalFill, spacing: 30 });
    s += text(o, o.l3, cx, 1680, 90, 900, { font: 'bold', spacing: 14, fill: o.mono || o.pal.text, shadow: false });
    if (!o.l3) s += star(cx - 300, 1700, 46, M) + star(cx, 1760, 56, M) + star(cx + 300, 1700, 46, M);
    return s; } },
  stacked: { label: 'Door logo (picture over name)', w: 2048, h: 1400, draw(o) {
    const u = o.uid, M = o.metalFill, cx = 1024, hy = 640, r = 560;
    let s = '';
    if (picKind(o) !== 'none') {
      s += `<clipPath id="${u}a"><path d="M${cx - r} ${hy} A${r} ${r} 0 0 1 ${cx + r} ${hy} Z"/></clipPath>`;
      if (!o.mono && !isScene(o)) s += `<path d="M${cx - r} ${hy} A${r} ${r} 0 0 1 ${cx + r} ${hy} Z" fill="${o.pal.bg}"/>`;
      const sceneLike = isScene(o) || (o.mono && picKind(o) === 'scene' && !o.photo);
      s += `<g clip-path="url(#${u}a)">${sceneLike ? art(o, cx - r, hy - r, 2 * r, r * 1.02) : art(o, cx - r * 0.8, hy - r * 0.99, r * 1.6, r * 0.97, { pad: 0 })}</g>`;
      s += `<path d="M${cx - r} ${hy} A${r} ${r} 0 0 1 ${cx + r} ${hy}" fill="none" stroke="${o.mono || o.pal.ink}" stroke-width="${o.mono ? 24 : 42}"/>`;
      if (!o.mono) s += `<path d="M${cx - r} ${hy} A${r} ${r} 0 0 1 ${cx + r} ${hy}" fill="none" stroke="${M}" stroke-width="16"/>`;
      s += `<rect x="${cx - 900}" y="${hy - 6}" width="1800" height="20" rx="10" fill="${M}"/>`;
    }
    s += text(o, o.l1, cx, 990, 300, 1940, { fill: o.mono || M });
    const l2y = 1180, l2s = 140;
    if (o.l2) { const tw = Math.min(1500, String(o.l2).length * (FONTS[o.font].w * l2s + 40)), rw = Math.min(300, (2048 - tw) / 2 - 60 - 50); // rules shrink to stay inside
      if (rw > 50) s += `<rect x="${f(cx - tw / 2 - 60 - rw)}" y="${l2y - 62}" width="${f(rw)}" height="20" rx="10" fill="${M}"/><rect x="${f(cx + tw / 2 + 60)}" y="${l2y - 62}" width="${f(rw)}" height="20" rx="10" fill="${M}"/>`; }
    s += text(o, o.l2, cx, l2y, l2s, 1500, { spacing: 40, fill: o.mono || M });
    s += text(o, o.l3, cx, 1340, 96, 1600, { font: 'bold', spacing: 18, fill: o.mono || o.pal.text, shadow: false, stroke: o.mono ? null : o.pal.ink, sw: 0.12 });
    return s; } },
  horizontal: { label: 'Horizontal (emblem + name)', w: 2048, h: 720, draw(o) {
    const u = o.uid, M = o.metalFill, ex = 360, ey = 360, er = 330;
    let s = o.mono ? `<circle cx="${ex}" cy="${ey}" r="${er}" fill="none" stroke="${o.mono}" stroke-width="18"/>` : `<circle cx="${ex}" cy="${ey}" r="${er + 14}" fill="${o.pal.ink}"/><circle cx="${ex}" cy="${ey}" r="${er}" fill="${M}"/><circle cx="${ex}" cy="${ey}" r="${er - 22}" fill="${o.pal.bg}"/>`;
    s += `<clipPath id="${u}e"><circle cx="${ex}" cy="${ey}" r="${er - 34}"/></clipPath><g clip-path="url(#${u}e)">${art(o, ex - er, ey - er, er * 2, er * 2, { pad: 0.1 })}</g>`;
    const tx = 1380;
    s += text(o, o.l1, tx, 330, 210, 1240, { fill: o.mono || M });
    s += text(o, o.l2, tx, 500, 120, 1100, { spacing: 30, fill: o.mono || M });
    s += `<rect x="${tx - 600}" y="372" width="1200" height="14" rx="7" fill="${M}"/>`;
    s += text(o, o.l3, tx, 640, 80, 1100, { font: 'bold', spacing: 14, fill: o.mono || o.pal.text, shadow: false });
    return s; } },
  oval: { label: 'Oval', w: 2048, h: 1400, draw(o) {
    const u = o.uid, cx = 1024, cy = 700, M = o.metalFill;
    let s = o.mono ? `<ellipse cx="${cx}" cy="${cy}" rx="985" ry="675" fill="none" stroke="${o.mono}" stroke-width="24"/>` : `<ellipse cx="${cx}" cy="${cy}" rx="1000" ry="690" fill="${o.pal.ink}"/><ellipse cx="${cx}" cy="${cy}" rx="975" ry="665" fill="${M}"/><ellipse cx="${cx}" cy="${cy}" rx="945" ry="635" fill="${o.pal.bg}"/>`;
    s += `<clipPath id="${u}w"><ellipse cx="${cx}" cy="${cy}" rx="720" ry="430"/></clipPath>`;
    if (!o.mono && !isScene(o)) s += `<ellipse cx="${cx}" cy="${cy}" rx="720" ry="430" fill="${light(o.pal.bg, 0.08)}"/>`;
    s += `<g clip-path="url(#${u}w)">${art(o, 304, 270, 1440, 860, { pad: 0.08 })}</g><ellipse cx="${cx}" cy="${cy}" rx="720" ry="430" fill="none" stroke="${M}" stroke-width="16"/>`;
    s += arcText(o, o.l1, u + 't', `M234 ${cy} A790 505 0 0 1 1814 ${cy}`, 2000, 150);
    s += arcText(o, o.l2, u + 'b', `M144 ${cy} A880 590 0 0 0 1904 ${cy}`, 1200, 135, { spacing: 50 });
    s += star(cx - 832, cy, 44, M) + star(cx + 832, cy, 44, M);
    return s; } },
  patch: { label: 'Hat patch', w: 2048, h: 1400, draw(o) {
    const u = o.uid, W = 2048, H = 1400, M = o.metalFill;
    let s = o.mono ? `<rect x="14" y="14" width="${W - 28}" height="${H - 28}" rx="190" fill="none" stroke="${o.mono}" stroke-width="26"/>` : `<rect width="${W}" height="${H}" rx="200" fill="${o.pal.ink}"/><rect x="24" y="24" width="${W - 48}" height="${H - 48}" rx="180" fill="${M}"/><rect x="56" y="56" width="${W - 112}" height="${H - 112}" rx="150" fill="${o.pal.bg}"/>`;
    s += `<clipPath id="${u}p"><rect x="56" y="56" width="${W - 112}" height="1044" rx="150"/></clipPath><g clip-path="url(#${u}p)">${art(o, 56, 56, W - 112, 1100, { pad: 0.1 })}</g>`;
    if (!o.mono) s += `<rect x="56" y="1100" width="${W - 112}" height="244" rx="0" fill="${o.pal.bg}"/><rect x="56" y="1100" width="${W - 112}" height="14" fill="${M}"/>`;
    else s += `<rect x="56" y="1100" width="${W - 112}" height="14" fill="${o.mono}"/>`;
    s += text(o, [o.l1, o.l2].filter(Boolean).join(' '), 1024, 1262, 138, 1640, { fill: o.mono || M });
    s += `<rect x="96" y="96" width="${W - 192}" height="${H - 192}" rx="115" fill="none" stroke="${o.mono || light(o.pal.metal, 0.4)}" stroke-width="10" stroke-dasharray="34 22"/>`;
    return s; } },
  wordmark: { label: 'Name only', w: 2048, h: 1000, draw(o) {
    const M = o.metalFill; let s = '';
    if (picKind(o) === 'object') s += art(o, 904, 10, 240, 240, { pad: 0 });
    const top = picKind(o) === 'object' ? 230 : 100;
    s += text(o, o.l1, 1024, top + 330, 290, 1940, { fill: o.mono || M });
    if (o.l2) s += `<rect x="150" y="${top + 420}" width="380" height="20" rx="10" fill="${M}"/><rect x="${2048 - 530}" y="${top + 420}" width="380" height="20" rx="10" fill="${M}"/>`;
    s += text(o, o.l2, 1024, top + 490, 150, 900, { spacing: 40, fill: o.mono || M });
    s += text(o, o.l3, 1024, top + 610, 80, 1500, { font: 'bold', spacing: 16, fill: o.mono || o.pal.text, shadow: false });
    return s; } },
  plate: { label: 'Licence plate', w: 2048, h: 1024, draw(o) {
    const u = o.uid, W = 2048, H = 1024, M = o.metalFill;
    let s = '';
    if (o.mono) s += `<rect x="24" y="24" width="${W - 48}" height="${H - 48}" rx="90" fill="none" stroke="${o.mono}" stroke-width="30"/>`;
    else s += `<linearGradient id="${u}pl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${o.pal.soft}"/><stop offset="1" stop-color="${mix(o.pal.soft, o.pal.metal, 0.25)}"/></linearGradient>
      <rect width="${W}" height="${H}" rx="100" fill="${o.pal.ink}"/><rect x="22" y="22" width="${W - 44}" height="${H - 44}" rx="84" fill="url(#${u}pl)"/><rect x="60" y="60" width="${W - 120}" height="${H - 120}" rx="60" fill="none" stroke="${o.pal.bg}" stroke-width="12"/>`;
    if (picKind(o) === 'object') s += `<g opacity="${o.mono ? 1 : 0.9}">${art(Object.assign({}, o, { pal: o.pal }), 110, 330, 380, 380, { pad: 0.04 })}</g>`;
    for (const [x, y] of [[230, 140], [W - 230, 140], [230, H - 140], [W - 230, H - 140]]) s += `<circle cx="${x}" cy="${y}" r="26" fill="${o.mono ? 'none' : light(o.pal.ink, 0.5)}" stroke="${o.mono || o.pal.ink}" stroke-width="6"/>`;
    s += text(o, o.l2, W / 2, 205, 120, 1300, { font: 'bold', spacing: 26, fill: o.mono || o.pal.bg, stroke: null, shadow: false });
    const objPic = picKind(o) === 'object' && !isScene(o);
    s += `<text x="${objPic ? 1170 : W / 2}" y="760" font-family="Bebas Neue" font-size="560" text-anchor="middle" letter-spacing="20"${fitText(o.l1, 'bold', 560, objPic ? 1450 : 1800, 20) ? ` textLength="${objPic ? 1450 : 1800}" lengthAdjust="spacingAndGlyphs"` : ''} fill="${o.mono || o.pal.ink}">${esc(o.l1)}</text>`;
    s += text(o, o.l3, W / 2, H - 110, 96, 1300, { font: 'bold', spacing: 22, fill: o.mono || o.pal.bg, stroke: null, shadow: false });
    return s; } },
  plateWide: { label: 'Licence plate (wide)', w: 2048, h: 434, draw(o) { // European size, 520 × 110 mm
    const u = o.uid, W = 2048, H = 434, B = 250;
    let s = '';
    if (o.mono) s += `<rect x="16" y="16" width="${W - 32}" height="${H - 32}" rx="44" fill="none" stroke="${o.mono}" stroke-width="22"/><line x1="${B}" y1="40" x2="${B}" y2="${H - 40}" stroke="${o.mono}" stroke-width="10"/>`;
    else s += `<linearGradient id="${u}pl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${o.pal.soft}"/><stop offset="1" stop-color="${mix(o.pal.soft, o.pal.metal, 0.25)}"/></linearGradient>
      <clipPath id="${u}pc"><rect x="16" y="16" width="${W - 32}" height="${H - 32}" rx="40"/></clipPath>
      <rect width="${W}" height="${H}" rx="54" fill="${o.pal.ink}"/><rect x="16" y="16" width="${W - 32}" height="${H - 32}" rx="40" fill="url(#${u}pl)"/>
      <rect x="16" y="16" width="${B - 16}" height="${H - 32}" fill="${o.pal.bg}" clip-path="url(#${u}pc)"/>`;
    const band = o.l3 || o.l2, bandFill = o.mono || o.pal.soft;
    if (picKind(o) === 'object') s += art(Object.assign({}, o, { mono: o.mono || o.pal.soft }), 40, 40, B - 60, band ? 240 : H - 80, { pad: 0.04 });
    if (band) s += text(o, band, (B + 16) / 2, picKind(o) === 'object' ? H - 56 : H / 2 + 34, picKind(o) === 'object' ? 64 : 96, B - 50, { font: 'bold', spacing: 6, fill: bandFill, stroke: null, shadow: false });
    const tw = W - B - 140, fit = fitText(o.l1, 'bold', 380, tw, 16);
    s += `<text x="${(B + W) / 2}" y="${H / 2 + 136}" font-family="Bebas Neue" font-size="380" text-anchor="middle" letter-spacing="16"${fit ? ` textLength="${tw}" lengthAdjust="spacingAndGlyphs"` : ''} fill="${o.mono || o.pal.ink}">${esc(o.l1)}</text>`;
    return s; } },
};

/* ---------------- build ---------------- */
/** opts: { template, pic, l1, l2, l3, palette (key) | colors {bg, metal, ink, text}, font, mono ('#fff' | '#000' | null), fonts: {family: dataURL} } */
function svg(opts) {
  const t = TEMPLATES[opts.template] || TEMPLATES.seal, base = PALETTES[opts.palette] || PALETTES.delta;
  const pal = Object.assign({}, base, opts.colors || {});
  const uid = 'lm' + (++uidN) + '_';
  const o = { pal, uid, pic: opts.pic || 'none', l1: opts.l1 || '', l2: opts.l2 || '', l3: opts.l3 || '', font: FONTS[opts.font] ? opts.font : 'western', mono: opts.mono || null,
    photo: opts.photo || null, photoMode: opts.photoMode === 'fill' ? 'fill' : 'cutout',
    picX: +opts.picX || 0, picY: +opts.picY || 0, picScale: Math.max(0.2, Math.min(4, +opts.picScale || 1)), TW: t.w, TH: t.h };
  const gold = `<linearGradient id="${uid}m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light(pal.metal, 0.45)}"/><stop offset=".5" stop-color="${pal.metal}"/><stop offset="1" stop-color="${dark(pal.metal, 0.3)}"/></linearGradient>`;
  o.metalFill = o.mono || `url(#${uid}m)`;
  const filters = o.mono && o.photo ? `<filter id="${uid}sil" color-interpolation-filters="sRGB"><feFlood flood-color="${o.mono}"/><feComposite in2="SourceAlpha" operator="in"/></filter><filter id="${uid}gray" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/></filter>` : '';
  const css = opts.fonts ? Object.entries(opts.fonts).map(([fam, url]) => `@font-face{font-family:'${fam}';src:url(${url}) format('woff2');}`).join('') : '';
  const body = t.draw(o);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${t.w}" height="${t.h}" viewBox="0 0 ${t.w} ${t.h}">${css ? `<style>${css}</style>` : ''}<defs>${gold}${filters}</defs>${body}</svg>`;
}

const api = { svg, TEMPLATES, PICS, PALETTES, FONTS, size: k => { const t = TEMPLATES[k] || TEMPLATES.seal; return [t.w, t.h]; } };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LogoMaker = api;
})(typeof window !== 'undefined' ? window : globalThis);
