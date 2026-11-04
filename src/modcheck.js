/* Farm Decal Swapper — mod check. Finds problems in mod zips that the game would trip over, and the fixes that are safe to make.
   Pure functions over a mod's file names and its XML/i3d text; works in the page (window.ModCheck) and in Node (module.exports). */
(function (root) {
'use strict';
const C = () => (typeof Core !== 'undefined' ? Core : root.Core) || (typeof require !== 'undefined' ? require('./core.js') : null); // core.js loads first in the page

const REF_EXT = /\.(i3d|xml|dds|png|tga|jpg|ogg|wav|lua|gdm|grle|shapes)$/i;
const XML_REF_ATTRS = ['filename', 'xmlFilename', 'iconFilename', 'imageFilename', 'image', 'i3dFilename', 'file', 'sourceFile'];
const XML_REF_TAGS = ['filename', 'image', 'iconFilename', 'xmlFilename', 'imageFilename'];
const norm = p => C().normPath(String(p || '').replace(/\\/g, '/'));
const toDDS = p => p.replace(/\.(png|tga|jpg|jpeg)$/i, '.dds');
const lower = s => s.toLowerCase();
const dirOf = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '';
const base = p => p.slice(p.lastIndexOf('/') + 1);
function relFrom(fromDir, target) { // path of target relative to a folder (both mod-relative)
  const a = fromDir.split('/').filter(Boolean), b = target.split('/'); let i = 0;
  while (i < a.length && i < b.length - 1 && a[i].toLowerCase() === b[i].toLowerCase()) i++;
  return '../'.repeat(a.length - i) + b.slice(i).join('/');
}
const unescapedAmp = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g;
const fixAmp = t => t.split(/(<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->)/).map((part, i) => i % 2 ? part : part.replace(unescapedAmp, '&amp;')).join(''); // never inside CDATA or comments

/**
 * mod: { name, names: [zip entry names], texts: { entryName: text } }
 * opts: { wellFormed(text) -> null | 'error message', installed: Set(lowercase mod names) }
 * returns { prefix, problems: [{ id, kind, file, msg, fix?: { type, ... } }] }
 */
function analyze(mod, opts = {}) {
  const problems = [], add = (kind, file, msg, fix) => problems.push({ id: kind + ':' + file + ':' + problems.length, kind, file, msg, fix: fix || null });
  const md = mod.names.find(n => /(^|\/)moddesc\.xml$/i.test(n));
  if (!md) { add('nomoddesc', '', 'There’s no modDesc.xml in this zip, so the game can’t load it as a mod.'); return { prefix: '', problems }; }
  const prefix = md.slice(0, md.length - 'modDesc.xml'.length);
  if (prefix) add('nested', md, `Everything is inside a folder (“${prefix.replace(/\/$/, '')}”) in the zip, so the game can’t find modDesc.xml and won’t load the mod.`, { type: 'unnest', prefix });
  const files = mod.names.filter(n => n.startsWith(prefix)).map(n => n.slice(prefix.length));
  const have = new Set(files), byLower = new Map(), byBase = new Map();
  for (const f of files) { byLower.set(lower(f), f); const b = lower(base(f)); if (!byBase.has(b)) byBase.set(b, []); byBase.get(b).push(f); }
  const exists = p => have.has(p) || have.has(toDDS(p));
  const findLike = p => { // the file the reference probably means: same path in other capitals, or the only file with that name
    for (const q of [p, toDDS(p)]) { const hit = byLower.get(lower(q)); if (hit) return hit; }
    for (const q of [p, toDDS(p)]) { const list = byBase.get(lower(base(q))); if (list && list.length === 1) return list[0]; }
    return null;
  };
  const allTexts = Object.entries(mod.texts).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v.replace(/^\uFEFF/, '')]);
  const texts = allTexts.filter(([k]) => /\.(xml|i3d)$/i.test(k)), luas = allTexts.filter(([k]) => /\.lua$/i.test(k)).map(([, v]) => v.toLowerCase());
  const pngUse = new Map(); // picture files (PNG/JPG) the mod's models and XML use: path -> [{ file, raw, from }]
  for (const [file, text] of texts) {
    // 1. XML the game can't read
    const bad = opts.wellFormed ? opts.wellFormed(text) : null;
    if (bad) {
      const fixed = fixAmp(text);
      if (fixed !== text && opts.wellFormed && !opts.wellFormed(fixed)) add('xml', file, `${file} has a bare “&” the game can’t read (it should be written &amp;).`, { type: 'amp' });
      else add('xml', file, `${file} isn’t valid XML, so the game can’t read it: ${String(bad).split('\n')[0].slice(0, 160)}`);
    }
    // 2. files it points to that aren't in the mod
    const isI3d = /\.i3d$/i.test(file), seen = new Set();
    const refs = [];
    if (isI3d) for (const m of text.matchAll(/<File\b[^>]*\bfilename="([^"]+)"/g)) refs.push({ raw: m[1], from: 'dir' });
    else {
      for (const m of text.matchAll(new RegExp(`\\b(?:${XML_REF_ATTRS.join('|')})="([^"]+)"`, 'g'))) refs.push({ raw: m[1], from: 'root' });
      for (const m of text.matchAll(new RegExp(`<(${XML_REF_TAGS.join('|')})>\\s*([^<]+?)\\s*</\\1>`, 'g'))) refs.push({ raw: m[2], from: 'root' });
    }
    for (const r of refs) {
      const raw = r.raw.trim(); if (!raw || /^\$data/i.test(raw) || !REF_EXT.test(raw) || raw.includes('$') && !/^\$moddir\$/i.test(raw)) continue;
      const clean = raw.replace(/^\$moddir\$[^/\\]*[/\\]?/i, '').replace(/\\/g, '/');
      const cands = r.from === 'dir' ? [norm(dirOf(file) + clean)] : [norm(clean), norm(dirOf(file) + clean)]; // XML paths count from the mod folder (sometimes from the file's own folder)
      const hit = cands.find(c => have.has(c));
      if (hit && /\.(png|jpe?g)$/i.test(hit) && !have.has(toDDS(hit))) { if (!pngUse.has(hit)) pngUse.set(hit, []); pngUse.get(hit).push({ file, raw, from: r.from }); }
      if (cands.some(exists) || seen.has(raw)) continue; seen.add(raw);
      if (/\.shapes$/i.test(raw)) continue;
      const like = findLike(cands[0]);
      if (like) {
        const to = r.from === 'dir' ? relFrom(dirOf(file), like) : (/^\$moddir\$/i.test(raw) ? raw.replace(/^(\$moddir\$[^/\\]*[/\\]?).*$/i, '$1') + like : like);
        const toRef = /\.(png|tga)$/i.test(raw) && /\.dds$/i.test(like) ? to.replace(/\.dds$/i, raw.slice(raw.lastIndexOf('.'))) : to; // keep .png if the game finds the .dds by itself
        add('ref', file, `${file} points to “${raw}”, which isn’t in the mod. ${lower(like) === lower(cands[0]) || lower(toDDS(like)) === lower(toDDS(cands[0])) ? 'The file is there with different capital letters' : 'There is a file with that name in another folder'}: “${like}”.`, { type: 'ref', from: raw, to: toRef });
      } else add('missing', file, `${file} points to “${raw}”, which isn’t in the mod. The mod is probably incomplete: download it again.`);
    }
  }
  // 3. textures that cost the graphics card more than they need to
  if (pngUse.size) {
    const items = [...pngUse].map(([path, uses]) => ({ path, uses, keep: luas.some(t => t.includes(lower(base(path)))) })), mb = items.reduce((a, it) => a + ((mod.sizes || {})[prefix + it.path] || 0), 0) / 1048576;
    add('png', '', `${items.length} texture${items.length === 1 ? ' is a PNG/JPG picture' : 's are PNG/JPG pictures'}${mb ? ` (${mb.toFixed(1)} MB)` : ''}. The game has to unpack ${items.length === 1 ? 'it' : 'them'} into full-size video memory with no smaller versions for distance, which costs more VRAM and load time than DDS. Convert to compressed DDS: ${items.slice(0, 4).map(i => base(i.path)).join(', ')}${items.length > 4 ? ', …' : ''}.`, { type: 'png2dds', items });
  }
  if (mod.heads) {
    const big = Object.entries(mod.heads).filter(([k, h]) => k.startsWith(prefix) && h && !h.compressed && h.bytesPerPixel && h.width * h.height >= 256 * 256).map(([k, h]) => ({ path: k.slice(prefix.length), h }));
    if (big.length) {
      const now = big.reduce((a, b) => a + b.h.width * b.h.height * b.h.bytesPerPixel * 4 / 3, 0) / 1048576, after = big.reduce((a, b) => a + b.h.width * b.h.height * 4 / 3, 0) / 1048576;
      add('bigtex', '', `${big.length} texture${big.length === 1 ? ' is' : 's are'} stored uncompressed, using about ${now.toFixed(0)} MB of video memory; compressed (DXT1/DXT5) ${big.length === 1 ? 'it' : 'they'} would use about ${(after / 2).toFixed(0)}–${after.toFixed(0)} MB. Slight quality loss. Files: ${big.slice(0, 4).map(b => base(b.path)).join(', ')}${big.length > 4 ? ', …' : ''}.`, { type: 'compress', items: big.map(b => ({ path: b.path })) });
    }
  }
  // 4. mods it needs
  const mdText = (texts.find(([k]) => lower(k) === 'moddesc.xml') || [])[1] || '';
  // the shop-section mod the app used to make (turned off now): items go back to the game's own categories
  if (opts.oldCatMod) {
    if (lower(mod.name.replace(/\.zip$/i, '')) === lower(opts.oldCatMod)) add('retire', '', 'This is the shop-section and build-menu mod the app made before. You don’t use it any more: take it out of your mods folder (it’s kept in Backups). Fix the mods that still use it first (tick them too).', { type: 'retire' });
    else if (new RegExp('<dependency>\\s*' + opts.oldCatMod + '\\s*</dependency>', 'i').test(mdText)) add('owncats', 'modDesc.xml', 'Still uses your old shop section and build-menu tabs. Put its items back in the game’s own categories (taken from the original mod) and drop that requirement.', { type: 'uncat' });
  }
  // your brand mod: needed only while the mod's items are listed under one of your own brands
  const needsDep = name => name && new RegExp('<dependency>\\s*' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*</dependency>', 'i').test(mdText);
  if (opts.brandMod && needsDep(opts.brandMod) && lower(mod.name.replace(/\.zip$/i, '')) !== lower(opts.brandMod)) {
    const own = opts.ownBrands || new Set(), game = opts.gameBrands || new Set(), used = new Set();
    for (const [k, t] of texts) { if (!/\.xml$/i.test(k) || lower(k) === 'moddesc.xml') continue;
      const b = (((t.match(/<storeData>[\s\S]*?<\/storeData>/) || [''])[0].match(/<brand>\s*([^<]*?)\s*<\/brand>/) || [])[1] || '').toUpperCase();
      if (b && b !== 'NONE' && (own.has(b) || (game.size && !game.has(b)))) used.add(b); }
    const list = [...used].join(', '), installed = opts.installed && opts.installed.has(lower(opts.brandMod));
    const missing = installed && opts.brandModBrands ? [...used].filter(b => !opts.brandModBrands.has(b)) : [];
    if (!used.size) add('ownbrand', 'modDesc.xml', `Lists your brand mod (${opts.brandMod}) as needed, but nothing in it uses your brands any more. Drop that requirement.`, { type: 'unbrand' });
    else if (!installed) add('ownbrand', 'modDesc.xml', `Needs your brand mod ${opts.brandMod}, which isn’t in your mods folder (its items are listed under ${list}). Tick to put back the brand the original mod had and drop that requirement. To keep your brand instead, use “Update my brand mod now” in Settings, then check again.`, { type: 'unbrand' });
    else if (missing.length) add('ownbrand', 'modDesc.xml', `Is listed under ${missing.join(', ')}, which your brand mod ${opts.brandMod} doesn’t have, so the game can’t find that brand. Use “Update my brand mod now” in Settings to add it, or tick to put back the brand the original mod had.`, { type: 'unbrand' });
  }
  if (opts.installed) for (const m of mdText.matchAll(/<dependency>\s*([^<]+?)\s*<\/dependency>/g))
    if (!(opts.oldCatMod && lower(m[1]) === lower(opts.oldCatMod)) && !(opts.brandMod && lower(m[1]) === lower(opts.brandMod)) && !opts.installed.has(lower(m[1]))) add('dependency', 'modDesc.xml', `Needs the mod “${m[1]}”, which isn’t in your mods folder. Without it this mod doesn’t load.`);
  return { prefix, problems };
}

/** Take one requirement out of a modDesc (and the <dependencies> block if that leaves it empty). which: RegExp for the mod name */
function dropDependency(md, which) {
  const t = md.replace(new RegExp('[ \\t]*<dependency>\\s*' + which.source + '\\s*</dependency>[ \\t]*\\r?\\n?', 'gi'), '');
  return t.replace(/[ \t]*<dependencies>\s*<\/dependencies>[ \t]*\r?\n?/i, '').replace(/[ \t]*<dependencies\s*\/>[ \t]*\r?\n?/i, '');
}
/** Changed files for the ticked fixes. texts: { entryName: text } (full zip names);
    returns { write: Map(name -> text), move: prefix|null, textures: [{ op: 'png2dds' | 'compress', path, keep }] } (paths inside the mod) */
function applyFixes(mod, prefix, fixes) {
  const write = new Map(), textures = []; let move = null, uncat = false, unbrand = false, retire = false;
  const get = f => write.has(prefix + f) ? write.get(prefix + f) : (mod.texts[prefix + f] || '').replace(/^\uFEFF/, '');
  for (const p of fixes) {
    const fx = p.fix; if (!fx) continue;
    if (fx.type === 'unnest') move = fx.prefix;
    else if (fx.type === 'amp') write.set(prefix + p.file, fixAmp(get(p.file)));
    else if (fx.type === 'ref') {
      const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), t = get(p.file)
        .replace(new RegExp(`="${esc(fx.from)}"`, 'g'), `="${fx.to}"`).replace(new RegExp(`>(\\s*)${esc(fx.from)}(\\s*)<`, 'g'), `>$1${fx.to}$2<`);
      write.set(prefix + p.file, t);
    }
    else if (fx.type === 'png2dds') for (const it of fx.items) { // the DDS goes next to the picture; references now name the DDS
      textures.push({ op: 'png2dds', path: it.path, keep: it.keep });
      for (const u of it.uses) { const to = u.raw.replace(/\.(png|jpe?g)$/i, '.dds'), esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        write.set(prefix + u.file, get(u.file).replace(new RegExp(`="${esc(u.raw)}"`, 'g'), `="${to}"`).replace(new RegExp(`>(\\s*)${esc(u.raw)}(\\s*)<`, 'g'), `>$1${to}$2<`)); }
    }
    else if (fx.type === 'compress') for (const it of fx.items) textures.push({ op: 'compress', path: it.path });
    else if (fx.type === 'uncat' || fx.type === 'unbrand') { const md = Object.keys(mod.texts).find(k => k.startsWith(prefix) && /(^|\/)moddesc\.xml$/i.test(k));
      if (md) write.set(md, dropDependency(get(md.slice(prefix.length)), fx.type === 'uncat' ? /FS25_[A-Za-z0-9]+_Categories/ : /FS25_[A-Za-z0-9]+_Brand/));
      if (fx.type === 'uncat') uncat = true; else unbrand = true; }
    else if (fx.type === 'retire') retire = true;
  }
  return { write, move, textures, uncat, unbrand, retire };
}

/** Mods that load the same thing twice. mods: [{ name, path, title, version, names, modDesc }] */
function duplicates(mods, tag) {
  const out = [], key = m => lower((m.title || '').replace(/\s*\([^)]*\)\s*$/, '').trim());
  const groups = new Map(); for (const m of mods) { const k = key(m); if (!k) continue; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m); }
  for (const [, g] of groups) {
    if (g.length < 2) continue;
    const t = lower(tag || ''), mine = g.filter(m => t && lower(m.name).startsWith('fs25_' + t + '_')), others = g.filter(m => !mine.includes(m));
    const same = (a, b) => a.names.length === b.names.length && a.modDesc === b.modDesc;
    if (mine.length && others.length) out.push({ kind: 'copy', keep: mine[0], drop: others, msg: `Your copy and the original are both in your mods folder, so the shop lists everything twice and choices can clash.` });
    else if (g.every(m => same(m, g[0]))) { const sorted = [...g].sort((a, b) => (/[\s()]/.test(a.name) ? 1 : 0) - (/[\s()]/.test(b.name) ? 1 : 0) || (b.mtime || 0) - (a.mtime || 0)); out.push({ kind: 'same', keep: sorted[0], drop: sorted.slice(1), msg: 'The same mod is in your mods folder more than once.' }); }
    else { const sorted = [...g].sort((a, b) => String(b.version || '').localeCompare(String(a.version || ''), undefined, { numeric: true }) || (b.mtime || 0) - (a.mtime || 0)); out.push({ kind: 'versions', keep: sorted[0], drop: sorted.slice(1), msg: `Different versions of the same mod are in your mods folder (${g.map(m => 'v' + (m.version || '?')).join(', ')}).` }); }
  }
  return out;
}

/** Errors and warnings in the game's log.txt, by mod. modNames: lowercase mod names in the folder. */
function parseLog(text, modNames) {
  const out = new Map(), lines = String(text || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]; if (!/\b(Error|Warning)\b/.test(line) || /Warning \(perf/i.test(line)) continue;
    const modIn = l => { for (const m of l.matchAll(/(?:[/\\]mods[/\\]|\b)(FS25_[A-Za-z0-9_\-]+)/g)) if (modNames.has(lower(m[1]))) return m[1];
      const m = l.match(/[/\\]mods[/\\]([^/\\'"\s:]+)/); return m && modNames.has(lower(m[1].replace(/\.zip$/i, ''))) ? m[1].replace(/\.zip$/i, '') : null; };
    let mod = modIn(line);
    if (!mod && /LUA|call stack/i.test(line)) for (let j = i + 1; j < Math.min(lines.length, i + 8) && !mod; j++) mod = modIn(lines[j]); // script errors name the mod on the lines below
    if (!mod) continue;
    const level = /\bError\b/.test(line) ? 'error' : 'warning';
    const kind = /LUA|\.lua\b|call stack/i.test(line) ? 'script' : /can'?t load|not found|failed to (open|load)|missing/i.test(line) ? 'file' : /invalid|unknown|not supported/i.test(line) ? 'value' : 'other';
    const k = lower(mod); if (!out.has(k)) out.set(k, []);
    const list = out.get(k), msg = line.replace(/^\s*\d{4}-\d\d-\d\d \d\d:\d\d(:\d\d(\.\d+)?)?\s*/, '').trim();
    if (!list.some(x => x.msg === msg)) list.push({ level, kind, msg, line: i + 1 });
  }
  return out;
}
const LOG_HELP = {
  script: 'A script in this mod went wrong while you played. The app can’t fix scripts: check for an update of the mod, or take it out if the game misbehaves.',
  file: 'The game couldn’t find a file this mod needs. If the check found the file under another name, it can fix this; otherwise download the mod again.',
  value: 'The mod has a setting the game doesn’t accept. Usually harmless, but it can break that feature.',
  other: '',
};

const api = { analyze, applyFixes, duplicates, parseLog, LOG_HELP, relFrom };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ModCheck = api;
})(typeof window !== 'undefined' ? window : globalThis);
