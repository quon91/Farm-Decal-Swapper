/* Specs: reads the numbers a vehicle or placeable XML already has (working speed, capacity, engine power, top speed,
   unload speed, weight, price…) and writes changed ones back in place, keeping the file's own layout. */
'use strict';
const Specs = (() => {
const TAG = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
const ATTR = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Every element with where its tag, attribute values and (for leaf elements) text sit in the file. */
function scan(text) {
  const out = [], stack = []; let m; TAG.lastIndex = 0;
  while ((m = TAG.exec(text))) {
    if (!m[2]) continue;
    if (m[1]) { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].name === m[2]) { stack[i].closeStart = m.index; stack.length = i; break; } continue; }
    const parent = stack[stack.length - 1] || null, el = { name: m[2], start: m.index, end: m.index + m[0].length, attrs: new Map(), parent, kids: [], self: !!m[4] };
    el.path = (parent ? parent.path + '/' : '') + el.name; if (parent) parent.kids.push(el);
    const base = m.index + 1 + m[2].length; let a; ATTR.lastIndex = 0;
    while ((a = ATTR.exec(m[3]))) { const v = a[2] != null ? a[2] : a[3], vs = base + a.index + a[0].search(/["']/) + 1; el.attrs.set(a[1], { value: v, start: vs, end: vs + v.length }); }
    out.push(el); if (!el.self) stack.push(el);
  }
  return out;
}
const up = (el, name) => { for (let p = el.parent; p; p = p.parent) if (p.name === name) return p; return null; };
const nth = el => el.parent ? el.parent.kids.filter(k => k.name === el.name).indexOf(el) : 0;
const count = el => el.parent ? el.parent.kids.filter(k => k.name === el.name).length : 1;
const attr = (el, n) => el && el.attrs.has(n) ? el.attrs.get(n).value : '';
const short = s => { const w = String(s).trim().split(/\s+/).filter(Boolean); return w.slice(0, 3).map(x => x.toLowerCase().replace(/^\$l10n_\w+?_/, '')).join(', ') + (w.length > 3 ? ` +${w.length - 3}` : ''); };
const cfgName = (el, word) => { const c = el.name === 'motorConfiguration' ? el : up(el, 'motorConfiguration'); if (!c) return word;
  const n = attr(c, 'name'); return n && !n.startsWith('$') ? n : count(c) > 1 ? `${word} ${nth(c) + 1}` : word; };
function fillLabel(el) {
  const c = up(el, 'fillUnitConfiguration'), cfg = c && count(c) > 1 ? (attr(c, 'name') && !attr(c, 'name').startsWith('$') ? attr(c, 'name') : `Setup ${nth(c) + 1}`) + ': ' : '';
  const what = attr(el, 'fillTypes') || attr(el, 'fillTypeCategories'), fuel = /^(diesel|electriccharge|methane|def)$/i.test(what.trim()) && attr(el, 'showInShop') === 'false';
  const cap = x => x.replace(/^./, c => c.toUpperCase()), name = /^air$/i.test(what.trim()) ? 'Air (brakes)' : fuel ? `${cap(short(what))} tank` : what ? cap(short(what)) : `Tank ${nth(el) + 1}`;
  return cfg + name;
}
const unitOf = el => /piece|bale|pallet/i.test(attr(el, 'unitTextOverride')) ? 'pieces' : /^air$/i.test(attr(el, 'fillTypes').trim()) ? 'l' : 'l';

/* what can be edited: group, label, unit, a hint, and whether it's only the shop's text */
const RULES = [
  { key: 'price', text: true, path: /^[^/]+\/storeData\/price$/, group: 'Shop', label: () => 'Price', unit: '' },
  { key: 'upkeep', text: true, path: /^[^/]+\/storeData\/dailyUpkeep$/, group: 'Shop', label: () => 'Daily upkeep', unit: '' },
  { key: 'shopPower', text: true, path: /\/storeData\/specs\/power$/, group: 'Shop', label: () => 'Power the shop shows', unit: 'hp', hint: 'Shop text only. The real power is the engine’s.' },
  { key: 'shopMax', text: true, path: /\/storeData\/specs\/maxSpeed$/, group: 'Shop', label: () => 'Top speed the shop shows', unit: 'km/h', hint: 'Shop text only. The real top speed is the engine’s.' },
  { key: 'shopNeed', text: true, path: /\/storeData\/specs\/neededPower$/, group: 'Shop', label: () => 'Power needed (shop)', unit: 'hp', hint: 'Shop text only.' },
  { key: 'shopWidth', text: true, path: /\/storeData\/specs\/workingWidth$/, group: 'Shop', label: () => 'Working width the shop shows', unit: 'm', hint: 'Shop text only. The width it really works is set by its work areas in the 3D model.' },
  { key: 'speed', attr: 'value', path: /^vehicle\/base\/speedLimit$/, group: 'Working', label: () => 'Working speed', unit: 'km/h', hint: 'Its top speed while working or towed, and the working speed the shop shows.' },
  { key: 'hp', attr: 'hp', path: /\/motorConfiguration$/, group: 'Engine', label: el => `${cfgName(el, 'Engine')}: power`, unit: 'hp', hint: 'The pulling force below changes to match, so the power is real.' },
  { key: 'torque', attr: 'torqueScale', path: /\/motorConfiguration\/motor$/, group: 'Engine', label: el => `${cfgName(el, 'Engine')}: pulling force`, unit: '×', step: 'any', hint: 'The game’s torque scale: the real power.' },
  { key: 'fwd', attr: 'maxForwardSpeed', path: /\/motorConfiguration\/motor$/, group: 'Engine', label: el => `${cfgName(el, 'Engine')}: top speed`, unit: 'km/h' },
  { key: 'back', attr: 'maxBackwardSpeed', path: /\/motorConfiguration\/motor$/, group: 'Engine', label: el => `${cfgName(el, 'Engine')}: reverse speed`, unit: 'km/h' },
  { key: 'rpm', attr: 'maxRpm', path: /\/motorConfiguration\/motor$/, group: 'Engine', label: el => `${cfgName(el, 'Engine')}: max rpm`, unit: 'rpm' },
  { key: 'enginePrice', attr: 'price', path: /\/motorConfiguration$/, group: 'Engine', label: el => `${cfgName(el, 'Engine')}: extra price`, unit: '' },
  { key: 'cap', attr: 'capacity', path: /\/fillUnits\/fillUnit$/, group: 'Capacity', label: fillLabel, unit: unitOf },
  { key: 'unload', attr: 'emptySpeed', path: /\/dischargeNode$/, group: 'Unloading', label: () => 'Unload speed', unit: 'l/s' },
  { key: 'mass', attr: 'mass', path: /^vehicle\/base\/components\/component$/, group: 'Weight', label: el => count(el) > 1 ? `Part ${nth(el) + 1} weight` : 'Weight', unit: 'kg', hint: 'Empty weight of that part.' },
  { key: 'store', attr: 'capacity', path: /\/storages?\/storage$/, group: 'Storage', label: el => count(el) > 1 ? `Storage ${nth(el) + 1}` : 'Storage capacity', unit: 'l' },
  { key: 'storeEach', attr: 'capacityPerFillType', path: /\/storages?\/storage$/, group: 'Storage', label: el => count(el) > 1 ? `Storage ${nth(el) + 1} per fill type` : 'Capacity per fill type', unit: 'l' },
  { key: 'animals', attr: 'maxNumAnimals', path: /\/animals$/, group: 'Animals', label: () => 'Most animals', unit: '' },
];
const NUM = /^\s*-?\d+(\.\d+)?\s*$/;

/** The editable numbers in one XML: [{ id, key, group, label, unit, hint, value, start, end, el }] plus one for a working speed it hasn't got. */
function fields(text) {
  const els = scan(text), out = [], seen = new Map();
  for (const el of els) for (const r of RULES) {
    if (!r.path.test(el.path)) continue;
    let value, start, end;
    if (r.text) { if (el.self || el.closeStart == null || el.kids.length) continue; start = el.end; end = el.closeStart; value = text.slice(start, end); if (!NUM.test(value)) continue; const lead = value.match(/^\s*/)[0].length; start += lead; value = value.trim(); end = start + value.length; }
    else { const a = el.attrs.get(r.attr); if (!a || !NUM.test(a.value)) continue; ({ value, start, end } = a); }
    const base = r.key + ':' + el.path, n = seen.get(base) || 0; seen.set(base, n + 1);
    out.push({ id: base + '#' + n, key: r.key, group: r.group, label: r.label(el), unit: typeof r.unit === 'function' ? r.unit(el) : r.unit, hint: r.hint || '', value, start, end, el });
  }
  const n = new Map(), seenL = new Map(); for (const f of out) n.set(f.group + f.label, (n.get(f.group + f.label) || 0) + 1);
  for (const f of out) if (n.get(f.group + f.label) > 1) { const i = (seenL.get(f.group + f.label) || 0) + 1; seenL.set(f.group + f.label, i); f.label += ` ${i}`; }
  const root = els.find(e => !e.parent), base = els.find(e => e.path === 'vehicle/base');
  if (root && root.name === 'vehicle' && base && !base.self && !out.some(f => f.key === 'speed') && !els.some(e => e.name === 'motorized' || e.name === 'motorConfigurations'))
    out.push({ id: 'add:speedLimit', key: 'speed', group: 'Working', label: 'Working speed', unit: 'km/h', hint: 'It has none set. Type one to add it: its top speed while working or towed.', value: '', add: true, el: base });
  return out;
}
const fmt = x => String(+x.toFixed(4));

/** Writes changed values. changes: Map(id -> value). opts.link: change the pulling force with the power, and the shop text with the real value.
 *  Returns { text, auto: Map(id -> value) } — auto lists values that changed to match. */
function apply(text, changes, opts = {}) {
  const fs = fields(text), byId = new Map(fs.map(f => [f.id, f])), set = new Map(), auto = new Map(), link = opts.link !== false;
  for (const [id, v] of changes) { const f = byId.get(id), s = String(v).trim(); if (!f || !NUM.test(s) || (!f.add && +s === +f.value)) continue; set.set(id, s); }
  const put = (f, v) => { if (f && !changes.has(f.id) && v !== f.value) { set.set(f.id, v); auto.set(f.id, v); } };
  if (link) for (const [id, v] of [...set]) {
    const f = byId.get(id);
    if (f.key === 'hp' && +f.value > 0) { // more horsepower: scale the torque the same, the way the game's own engine options do
      const ratio = +v / +f.value, motor = f.el.kids.find(k => k.name === 'motor'), tq = motor && fs.find(x => x.key === 'torque' && x.el === motor);
      if (tq) put(tq, fmt(+tq.value * ratio));
      const all = fs.filter(x => x.key === 'hp'), top = Math.max(...all.map(x => +x.value)), shop = fs.find(x => x.key === 'shopPower');
      if (shop && +shop.value === top && +f.value === top) put(shop, v);
    }
    if (f.key === 'fwd') { const shop = fs.find(x => x.key === 'shopMax'), top = Math.max(...fs.filter(x => x.key === 'fwd').map(x => +x.value)); if (shop && +shop.value === +f.value && +f.value === top) put(shop, v); }
  }
  const edits = [];
  for (const [id, v] of set) { const f = byId.get(id);
    if (!f.add) { edits.push({ at: f.start, end: f.end, s: v }); continue; }
    const b = f.el, nl = text.includes('\r\n') ? '\r\n' : '\n', lineStart = text.lastIndexOf('\n', b.start) + 1, bInd = text.slice(lineStart, b.start).match(/^[ \t]*/)[0];
    const k = b.kids[0], kInd = k ? text.slice(text.lastIndexOf('\n', k.start) + 1, k.start).match(/^[ \t]*/)[0] : bInd + '    ';
    let at = b.closeStart; while (at > b.end && /\s/.test(text[at - 1])) at--;
    edits.push({ at, end: at, s: `${nl}${kInd}<speedLimit value="${v}" />` });
  }
  edits.sort((a, b) => b.at - a.at);
  for (const e of edits) text = text.slice(0, e.at) + e.s + text.slice(e.end);
  return { text, auto, count: set.size - auto.size };
}

return { scan, fields, apply };
})();
if (typeof module !== 'undefined') module.exports = Specs;
