/* Farm Decal Swapper — app logic. Runs in the desktop app (window.fds bridge) or in a plain browser. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const APP = window.fds || null;               // desktop bridge (Electron preload) when present
const S = {
  lib: [], view: 'mods', tab: 'logos', mods: [], modsDir: '',
  mod: null,       // { zip, name, path, kind, prefix, files, entries, analysis, title, edits, groups, textEdits, thumbs }
  current: null, edView: 'after',
};

/* ================= small helpers ================= */
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
};
const tick = () => new Promise(r => setTimeout(r, 16));
const fmtSize = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
const human = s => { s = String(s || '').replace(/^\$l10n_/, '').replace(/^configuration_/, ''); s = s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); };
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const baseName = p => p.split(/[\\/]/).pop();
const cleanErr = e => String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
function status(msg, kind) { const el = $('status'); if (!msg) { el.hidden = true; return; } el.hidden = false; el.className = 'status' + (kind === 'err' ? ' err' : ''); el.innerHTML = (kind === 'busy' ? '<span class="spin"></span>' : '') + '<span></span>'; el.lastChild.textContent = msg; }
let toastT = null;
function toast(msg, ms = 3800) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, ms); }
function dataBlob(u) { const [h, b] = u.split(','), bin = atob(b), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new Blob([a], { type: h.slice(5).split(';')[0] }); }
const canvasBlob = c => new Promise(r => c.toBlob(r, 'image/png'));
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
async function blobToCanvas(blob) { const url = URL.createObjectURL(blob); try { return toCanvas(await loadImg(url)); } finally { URL.revokeObjectURL(url); } }
function toCanvas(img) { const c = document.createElement('canvas'); c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height; c.getContext('2d').drawImage(img, 0, 0); return c; }
function rgbaToCanvas(rgba, W, H, max) {
  const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').putImageData(new ImageData(rgba, W, H), 0, 0);
  if (!max || (W <= max && H <= max)) return c;
  const s = Math.min(max / W, max / H), t = document.createElement('canvas'); t.width = Math.max(1, Math.round(W * s)); t.height = Math.max(1, Math.round(H * s));
  const g = t.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(c, 0, 0, t.width, t.height); return t;
}

/* ---- saving a file to the user's computer ---- */
async function offerFile(name, data, kind) {
  if (APP) { const r = await APP.saveFile({ name, data: data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data, kind }); return r ? 'saved' : 'canceled'; }
  const blob = data instanceof Blob ? data : new Blob([data]);
  if (window.claude && window.claude.use) {
    const dl = await window.claude.use('downloads');
    if (!dl) throw new Error('This view can’t save files.');
    try { await dl.save({ filename: name, data: blob }); return 'saved'; } catch (e) { if (e && e.code === 'declined') return 'canceled'; throw e; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000); return 'saved';
}

/* ================= settings ================= */
const quality = () => ($('qSmall').checked ? 'dxt5' : 'lossless');
const hdOn = () => $('hd').checked;
const hdFactor = (w, h) => { if (!hdOn()) return 1; let f = 1; while (Math.max(w, h) * f * 2 <= 2048) f *= 2; return f; };
function initSettings() {
  (store.get('quality') === 'dxt5' ? $('qSmall') : $('qBest')).checked = true;
  $('hd').checked = store.get('hd') !== '0';
  $('backup').checked = store.get('backup') !== '0';
  document.querySelectorAll('input[name=q]').forEach(i => i.addEventListener('change', () => { store.set('quality', quality()); if (S.current) syncEditor(); }));
  $('hd').addEventListener('change', () => { store.set('hd', hdOn() ? '1' : '0'); if (S.current) syncEditor(); });
  $('backup').addEventListener('change', () => store.set('backup', $('backup').checked ? '1' : '0'));
  if (APP) {
    $('setBackup').hidden = false; $('setFolder').hidden = false; $('btnFolder').hidden = false;
    APP.backupDir().then(p => $('backupPath').textContent = p);
    $('btnOpenBackups').onclick = () => APP.openPath('backups');
    APP.version().then(v => $('appVer').textContent = 'v' + v);
    $('sideFoot').textContent = 'Everything runs on your computer. Works offline.';
  }
}

/* ================= navigation ================= */
function setView(v) {
  if (v === 'mod' && !S.mod) v = 'mods';
  S.view = v;
  for (const id of ['mods', 'mod', 'library', 'settings']) $('view-' + id).hidden = id !== v;
  document.querySelectorAll('.nav').forEach(b => { if (b.dataset.view === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  window.scrollTo(0, 0);
}
document.querySelectorAll('.nav').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
function setTab(t) {
  S.tab = t;
  document.querySelectorAll('.tab').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t));
  for (const id of ['logos', 'place', 'options', 'textures', 'files']) $('tab-' + id).hidden = id !== t;
  if (t === 'textures') renderAll(); if (t === 'logos') renderLikely(); if (t === 'files') renderFiles(); if (t === 'place') initPlace();
}
document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

/* ================= mods folder (desktop app) ================= */
async function loadModsFolder() {
  if (!APP) return;
  S.modsDir = store.get('modsDir') || await APP.defaultModsDir();
  $('modsFolderBlock').hidden = false; $('modsPath').textContent = S.modsDir; $('setModsPath').textContent = S.modsDir;
  $('modsSub').textContent = 'Pick a mod from your FS25 mods folder, or drop any mod zip here.';
  $('modGrid').innerHTML = '<div class="status"><span class="spin"></span><span>Reading your mods folder…</span></div>';
  let list = [];
  try { list = await APP.listMods(S.modsDir); } catch (e) {
    $('modGrid').innerHTML = ''; const d = document.createElement('div'); d.className = 'empty';
    d.textContent = /ENOENT/.test(e.message) ? 'There’s no mods folder at this location yet. Use Change folder to point at the folder where FS25 keeps your mods, or open a mod zip directly.' : 'This folder couldn’t be read (' + cleanErr(e) + '). Use Change folder to pick another one.';
    $('modGrid').appendChild(d); return; }
  S.mods = list; renderModGrid();
}
function renderModGrid() {
  const q = ($('modSearch').value || '').toLowerCase(), grid = $('modGrid'); grid.innerHTML = '';
  const list = S.mods.filter(m => !q || (m.title + ' ' + m.name).toLowerCase().includes(q));
  if (!S.mods.length) { grid.innerHTML = '<div class="empty">No mods found in this folder. FS25 keeps them in Documents\\My Games\\FarmingSimulator2025\\mods. Use Change folder if yours is somewhere else.</div>'; return; }
  if (!list.length) { grid.innerHTML = '<div class="empty">No mods match your search.</div>'; return; }
  for (const m of list) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'modcard';
    b.innerHTML = '<canvas width="64" height="64" class="checker"></canvas><div style="min-width:0"><div class="t"></div><div class="f"></div><div class="m"></div></div>';
    b.querySelector('.t').textContent = m.title || m.name; b.querySelector('.f').textContent = m.name;
    b.querySelector('.m').textContent = [m.kind === 'folder' ? 'Unzipped folder' : fmtSize(m.size), m.version ? 'v' + m.version : ''].filter(Boolean).join(' · ');
    if (m.icon) drawIcon(b.querySelector('canvas'), m.icon);
    b.onclick = () => openModFromPath(m);
    grid.appendChild(b);
  }
}
function drawIcon(cv, bytes) {
  try { const r = Core.decodeDDS(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)); if (r.error) return; const c = rgbaToCanvas(r.rgba, r.width, r.height, 128), g = cv.getContext('2d'); g.imageSmoothingQuality = 'high'; g.clearRect(0, 0, cv.width, cv.height); g.drawImage(c, 0, 0, cv.width, cv.height); } catch (e) {}
}
$('modSearch').addEventListener('input', renderModGrid);
async function changeFolder() { const p = await APP.pickFolder(S.modsDir); if (p) { store.set('modsDir', p); loadModsFolder(); } }
$('btnFolder').onclick = changeFolder; $('btnFolder2').onclick = changeFolder;
$('btnFolderReset').onclick = () => { try { localStorage.removeItem('modsDir'); } catch (e) {} loadModsFolder(); };

/* ================= opening a mod ================= */
const drop = $('drop');
['dragenter', 'dragover'].forEach(t => document.addEventListener(t, e => { e.preventDefault(); if (S.view === 'mods') drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => document.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
document.addEventListener('drop', e => {
  const f = e.dataTransfer && e.dataTransfer.files[0]; if (!f) return;
  if (/\.zip$/i.test(f.name)) { const p = APP && APP.pathForFile ? APP.pathForFile(f) : null; openZipFile(f, p); }
  else if (/\.(png|jpe?g|webp|svg)$/i.test(f.name) && S.view === 'library') addLogoFiles([...e.dataTransfer.files]);
});
$('btnOpenZip').onclick = async () => {
  if (APP) { const r = await APP.pickZip(S.modsDir); if (r) openZipBytes(r.data, r.name, r.path); }
  else $('zipIn').click();
};
$('zipIn').addEventListener('change', e => { const f = e.target.files[0]; if (f) openZipFile(f, null); e.target.value = ''; });
async function openModFromPath(m) {
  if (S.mod && changeCount() && !confirmDiscard()) return;
  setView('mods'); status('Opening ' + m.name + '…', 'busy'); await tick();
  try {
    if (m.kind === 'folder') { const files = await APP.readFolder(m.path); const zip = new JSZip(); for (const f of files) zip.file(f.rel, f.data); await loadMod(zip, m.name, m.path, 'folder'); }
    else { const data = await APP.readFile(m.path); await openZipBytes(data, m.name, m.path); }
  } catch (e) { status('Couldn’t open ' + m.name + ': ' + cleanErr(e), 'err'); }
}
async function openZipFile(file, path) {
  if (!/\.zip$/i.test(file.name)) { status('That isn’t a .zip file. FS25 mods are zip archives.', 'err'); return; }
  if (S.mod && changeCount() && !confirmDiscard()) return;
  setView('mods'); status('Opening ' + file.name + '…', 'busy'); await tick();
  let zip; try { zip = await JSZip.loadAsync(file); } catch (e) { status('The zip couldn’t be opened: ' + e.message, 'err'); return; }
  await loadMod(zip, file.name, path, 'zip');
}
async function openZipBytes(data, name, path) {
  let zip; try { zip = await JSZip.loadAsync(data); } catch (e) { status('The zip couldn’t be opened: ' + e.message, 'err'); return; }
  await loadMod(zip, name, path, 'zip');
}
let discardArmed = 0;
function confirmDiscard() { // no confirm() dialogs: second click within 6 s continues
  if (Date.now() - discardArmed < 6000) return true;
  discardArmed = Date.now(); toast('You have unsaved changes in the open mod. Click again to discard them, or save first.', 6000); return false;
}
async function loadMod(zip, name, path, kind) {
  const names = Object.keys(zip.files).filter(n => !zip.files[n].dir);
  const md = names.filter(n => /(^|\/)moddesc\.xml$/i.test(n)).sort((a, b) => a.length - b.length)[0];
  if (!md) { status('No modDesc.xml found, so this isn’t an FS25 mod. If it’s a pack of several zips, unzip it first.', 'err'); return; }
  const prefix = md.slice(0, md.length - 'modDesc.xml'.length);
  const files = new Map(); let n = 0;
  const want = names.filter(p => p.startsWith(prefix) && /\.(xml|i3d|shapes|dds)$/i.test(p));
  for (const p of want) { files.set(p.slice(prefix.length), await zip.files[p].async('uint8array')); if (++n % 25 === 0) { status(`Reading files ${n}/${want.length}…`, 'busy'); await tick(); } }
  status('Reading the 3D models…', 'busy'); await tick();
  let analysis; const logs = [];
  try { analysis = Core.analyzeMod(files, m => logs.push(m)); } catch (e) { status('Couldn’t read this mod: ' + e.message, 'err'); return; }
  let title = name.replace(/\.zip$/i, ''), icon = null;
  try {
    const t = new TextDecoder().decode(files.get('modDesc.xml'));
    const m = t.match(/<title>[\s\S]*?<en>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/en>/i); if (m) title = m[1].trim();
    const ic = t.match(/<iconFilename>\s*([^<]+?)\s*<\/iconFilename>/i); if (ic) icon = files.get(Core.normPath(ic[1].replace(/\.(png|tga)$/i, '.dds'))) || null;
  } catch (e) {}
  const entries = names.filter(p => p.startsWith(prefix)).map(p => ({ rel: p.slice(prefix.length), size: zip.files[p]._data && zip.files[p]._data.uncompressedSize || 0 }));
  if (S.viewer) { S.viewer.dispose(); S.viewer = null; } loadedModel = null;
  S.mod = { zip, name, path, kind, prefix, files, entries, analysis, title, icon, logs, edits: new Map(), groups: new Map(), textEdits: new Map(), thumbs: new Map(), fileSel: null, stickers: [], models: listModels(files), place: null };
  status(null);
  $('modTitle').textContent = title; $('modFile').textContent = (path || name) + (logs.length ? ' · some models couldn’t be read' : '');
  const ic = $('modIcon'); ic.getContext('2d').clearRect(0, 0, 64, 64); if (icon) drawIcon(ic, icon);
  $('navMod').hidden = false; $('navModName').textContent = title; $('saveMsg').hidden = true;
  $('cntOptions').textContent = analysis.groups.length || ''; $('cntTex').textContent = analysis.textures.length; $('cntFiles').textContent = entries.length;
  renderOpts(); setView('mod'); setTab(analysis.textures.some(isLikely) || !analysis.groups.length ? 'logos' : 'options'); updateChanges();
}
$('btnCloseMod').onclick = () => { if (changeCount() && !confirmDiscard()) return; if (S.viewer) { S.viewer.dispose(); S.viewer = null; } S.mod = null; $('navMod').hidden = true; setView('mods'); };
window.addEventListener('beforeunload', e => { if (S.mod && changeCount() && !APP) { e.preventDefault(); e.returnValue = ''; } });

/* ================= logo library ================= */
function idb() { return new Promise((res) => { try { const r = indexedDB.open('farm-decal-swapper', 1); r.onupgradeneeded = () => r.result.createObjectStore('library', { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => res(null); } catch (e) { res(null); } }); }
async function dbAll() { const db = await idb(); if (!db) return null; return new Promise(res => { try { const q = db.transaction('library').objectStore('library').getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => res(null); } catch (e) { res(null); } }); }
async function dbPut(rec) { const db = await idb(); if (!db) return; try { db.transaction('library', 'readwrite').objectStore('library').put(rec); } catch (e) {} }
async function dbDel(id) { const db = await idb(); if (!db) return; try { db.transaction('library', 'readwrite').objectStore('library').delete(id); } catch (e) {} }
function trimCanvas(c) {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0 || (x0 === 0 && y0 === 0 && x1 === c.width - 1 && y1 === c.height - 1)) return c;
  const o = document.createElement('canvas'); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1; o.getContext('2d').drawImage(c, -x0, -y0); return o;
}
function edgeIsClear(c) {
  const W = c.width, H = c.height, d = c.getContext('2d').getImageData(0, 0, W, H).data; let n = 0, t = 0;
  const chk = (x, y) => { n++; if (d[(y * W + x) * 4 + 3] < 24) t++; };
  for (let x = 0; x < W; x += Math.max(1, W >> 7)) { chk(x, 0); chk(x, H - 1); }
  for (let y = 0; y < H; y += Math.max(1, H >> 7)) { chk(0, y); chk(W - 1, y); }
  return t / n > .6;
}
const logoById = id => S.lib.find(l => l.id === id) || S.lib[0] || null;
const newId = () => 'logo-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
async function addLogo(blob, name, opts = {}) {
  const raw = await blobToCanvas(blob);
  const rec = { id: opts.id || newId(), name: name || 'Logo', canvas: opts.canvas || trimCanvas(raw), original: blob, order: S.lib.length, cleaned: !!opts.cleaned, needsBg: !edgeIsClear(raw) && !opts.cleaned };
  S.lib.push(rec); return rec;
}
async function saveRec(rec) { const image = await canvasBlob(rec.canvas); await dbPut({ id: rec.id, name: rec.name, order: rec.order, image, original: rec.original, cleaned: rec.cleaned }); }
async function addLogoFiles(files) {
  let last = null;
  for (const f of files) {
    try { last = await addLogo(f, f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()); await saveRec(last); }
    catch (err) { toast(`“${f.name}” couldn’t be read. Use a PNG, WebP, JPG or SVG.`); }
  }
  renderLib(); refreshLogos();
  if (last && files.length === 1 && last.needsBg) openBg(last);
  else if (files.length) toast(`${files.length} logo${files.length === 1 ? '' : 's'} added.`);
}
$('upLogo').addEventListener('change', e => { const f = [...e.target.files]; e.target.value = ''; addLogoFiles(f); });
const thumbCache = new WeakMap();
function thumbURL(c, w = 480, h = 240) { let u = thumbCache.get(c); if (u) return u; const t = document.createElement('canvas'), s = Math.min(1, w / c.width, h / c.height); t.width = Math.max(1, Math.round(c.width * s)); t.height = Math.max(1, Math.round(c.height * s)); const g = t.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(c, 0, 0, t.width, t.height); u = t.toDataURL(); thumbCache.set(c, u); return u; }
function renderLib() {
  const box = $('lib'); box.innerHTML = '';
  $('navLibCount').textContent = S.lib.length || '';
  if (!S.lib.length) { box.innerHTML = '<div class="empty" style="grid-column:1/-1">Your library is empty. Use <b>Add logos</b> to bring in your farm logo and any brands you want, or drop image files here.</div>'; return; }
  S.lib.forEach((l, i) => {
    const el = document.createElement('div'); el.className = 'libcard';
    el.innerHTML = `<div class="pv checker"><img alt=""></div><div class="body"><input type="text" aria-label="Logo name"><span class="dim"></span>
      <div class="acts"><button type="button" class="btn small" data-a="bg">Remove background</button><button type="button" class="btn small" data-a="up" aria-label="Move earlier">←</button><button type="button" class="btn small" data-a="down" aria-label="Move later">→</button><button type="button" class="btn small danger" data-a="del">Delete</button></div></div>`;
    el.querySelector('img').src = thumbURL(l.canvas);
    const nm = el.querySelector('input'); nm.value = l.name;
    nm.addEventListener('change', () => { l.name = nm.value.trim() || 'Logo'; nm.value = l.name; saveRec(l); refreshLogos(); });
    el.querySelector('.dim').textContent = `${l.canvas.width} × ${l.canvas.height} px` + (l.needsBg && !l.cleaned ? ' · has a solid background' : '') + (l.cleaned ? ' · background removed' : '');
    el.querySelector('[data-a=bg]').onclick = () => openBg(l);
    const move = d => { const j = i + d; if (j < 0 || j >= S.lib.length) return; S.lib.splice(i, 1); S.lib.splice(j, 0, l); S.lib.forEach((x, k) => { x.order = k; saveRec(x); }); renderLib(); refreshLogos(); };
    el.querySelector('[data-a=up]').onclick = () => move(-1); el.querySelector('[data-a=up]').disabled = i === 0;
    el.querySelector('[data-a=down]').onclick = () => move(1); el.querySelector('[data-a=down]').disabled = i === S.lib.length - 1;
    el.querySelector('[data-a=del]').onclick = () => {
      S.lib.splice(i, 1); dbDel(l.id); S.lib.forEach((x, k) => x.order = k);
      if (S.mod) { for (const ed of S.mod.edits.values()) if (ed.logo === l.id) ed.logo = S.lib[0] ? S.lib[0].id : null; for (const g of S.mod.groups.values()) g.logos = g.logos.filter(x => x !== l.id); }
      renderLib(); refreshLogos(); toast(`Deleted “${l.name}”.`);
    };
    box.appendChild(el);
  });
}
function refreshLogos() { if (S.mod) { renderOpts(); repaintCards(); updateChanges(); if (S.mod.place) { fillPlaceLogos(); drawStickers(); } } if (S.current) { refreshEditorLogos(); drawEditor(); } }

/* ---- library packs (zip of PNGs + names) ---- */
$('btnExportPack').onclick = async () => {
  if (!S.lib.length) { toast('Your library is empty.'); return; }
  const z = new JSZip(), meta = [];
  for (const l of S.lib) { const f = `logos/${Core.slug(l.name)}_${l.id.slice(-4)}.png`; z.file(f, await canvasBlob(l.canvas)); meta.push({ name: l.name, file: f, order: l.order }); }
  z.file('library.json', JSON.stringify({ app: 'Farm Decal Swapper', version: 1, logos: meta }, null, 2));
  const blob = await z.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  try { const r = await offerFile('logo-library.zip', blob, 'zip'); if (r === 'saved') toast('Library exported.'); } catch (e) { toast('Couldn’t save: ' + e.message); }
};
$('btnImportPack').onclick = () => $('packIn').click();
$('packIn').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const z = await JSZip.loadAsync(f), metaF = z.file('library.json'); let list;
    if (metaF) list = JSON.parse(await metaF.async('string')).logos || [];
    else list = Object.keys(z.files).filter(n => /\.(png|webp|jpe?g)$/i.test(n)).map(n => ({ name: baseName(n).replace(/\.[^.]+$/, ''), file: n }));
    let n = 0;
    for (const it of list) { const zf = z.file(it.file); if (!zf) continue; const blob = new Blob([await zf.async('uint8array')], { type: 'image/png' }); const rec = await addLogo(blob, it.name, { cleaned: true }); rec.needsBg = false; await saveRec(rec); n++; }
    renderLib(); refreshLogos(); toast(`${n} logo${n === 1 ? '' : 's'} imported.`);
  } catch (err) { toast('That file isn’t a logo pack: ' + err.message); }
});

/* ---- background remover ---- */
const BG = { rec: null, src: null, color: [255, 255, 255], view: 'after', result: null };
async function openBg(rec) {
  BG.rec = rec; BG.src = await blobToCanvas(rec.original); BG.view = 'after'; BG.color = edgeColor(BG.src);
  $('bgTitle').textContent = rec.name; $('bgRestore').hidden = !rec.cleaned; $('bgHoles').checked = false;
  $('bgInfo').textContent = `${BG.src.width} × ${BG.src.height} px · processed at full resolution`;
  if (edgeIsClear(BG.src)) $('bgInfo').textContent += ' · this image already has a see-through background';
  $('bgDlg').hidden = false; runBg();
}
function edgeColor(c) {
  const W = c.width, H = c.height, d = c.getContext('2d').getImageData(0, 0, W, H).data, bins = new Map();
  const add = (x, y) => { const i = (y * W + x) * 4; if (d[i + 3] < 128) return; const k = (d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | (d[i + 2] >> 3); const b = bins.get(k) || [0, 0, 0, 0]; b[0]++; b[1] += d[i]; b[2] += d[i + 1]; b[3] += d[i + 2]; bins.set(k, b); };
  for (let x = 0; x < W; x++) { add(x, 0); add(x, H - 1); } for (let y = 0; y < H; y++) { add(0, y); add(W - 1, y); }
  let best = null; for (const b of bins.values()) if (!best || b[0] > best[0]) best = b;
  return best ? [best[1] / best[0], best[2] / best[0], best[3] / best[0]] : [255, 255, 255];
}
function removeBackground(src, bg, tol, soft, holes) {
  const W = src.width, H = src.height, ctx = src.getContext('2d'), im = ctx.getImageData(0, 0, W, H), d = im.data, N = W * H;
  const dist = new Float32Array(N);
  for (let p = 0, i = 0; p < N; p++, i += 4) { const dr = d[i] - bg[0], dg = d[i + 1] - bg[1], db = d[i + 2] - bg[2]; dist[p] = d[i + 3] < 8 ? 0 : Math.sqrt(dr * dr + dg * dg + db * db); }
  const lim = tol + soft, mask = new Uint8Array(N);
  if (holes) { for (let p = 0; p < N; p++) if (dist[p] <= lim) mask[p] = 1; }
  else {
    const q = new Int32Array(N); let h = 0, t = 0;
    const push = p => { if (!mask[p] && dist[p] <= lim) { mask[p] = 1; q[t++] = p; } };
    for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); } for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
    while (h < t) { const p = q[h++], x = p % W; if (x > 0) push(p - 1); if (x < W - 1) push(p + 1); if (p >= W) push(p - W); if (p < N - W) push(p + W); }
  }
  const out = ctx.createImageData(W, H), o = out.data;
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    const a0 = d[i + 3] / 255; let a = a0;
    if (mask[p]) a = a0 * (soft > 0 ? Math.min(1, Math.max(0, (dist[p] - tol) / soft)) : 0);
    o[i + 3] = Math.round(a * 255);
    if (mask[p] && a > 0 && a < a0) { const k = a / a0; for (let c = 0; c < 3; c++) o[i + c] = Math.max(0, Math.min(255, bg[c] + (d[i + c] - bg[c]) / k)); }
    else { o[i] = d[i]; o[i + 1] = d[i + 1]; o[i + 2] = d[i + 2]; }
  }
  const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').putImageData(out, 0, 0); return c;
}
let bgTimer = null;
function runBg() {
  const tol = +$('bgTol').value, soft = +$('bgSoft').value; $('bgTolV').textContent = tol; $('bgSoftV').textContent = soft;
  const hx = '#' + BG.color.map(v => Math.round(v).toString(16).padStart(2, '0')).join(''); $('bgSwatch').style.background = hx; $('bgHex').textContent = hx;
  $('bgBefore').setAttribute('aria-pressed', BG.view === 'before'); $('bgAfter').setAttribute('aria-pressed', BG.view === 'after');
  clearTimeout(bgTimer); bgTimer = setTimeout(() => {
    BG.result = removeBackground(BG.src, BG.color, tol, soft, $('bgHoles').checked);
    const show = BG.view === 'after' ? BG.result : BG.src, cv = $('bgCanvas'), s = Math.min(1, 1400 / show.width, 1400 / show.height);
    cv.width = Math.round(show.width * s); cv.height = Math.round(show.height * s); const g = cv.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(show, 0, 0, cv.width, cv.height);
  }, 60);
}
['bgTol', 'bgSoft', 'bgHoles'].forEach(id => $(id).addEventListener('input', runBg));
$('bgBefore').onclick = () => { BG.view = 'before'; runBg(); };
$('bgAfter').onclick = () => { BG.view = 'after'; runBg(); };
$('bgCanvas').addEventListener('click', e => {
  const cv = $('bgCanvas'), b = cv.getBoundingClientRect(), x = Math.floor((e.clientX - b.left) / b.width * BG.src.width), y = Math.floor((e.clientY - b.top) / b.height * BG.src.height);
  const d = BG.src.getContext('2d').getImageData(Math.max(0, x - 1), Math.max(0, y - 1), 3, 3).data; let r = 0, g = 0, bb = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; bb += d[i + 2]; n++; } BG.color = [r / n, g / n, bb / n]; runBg();
});
$('bgCancel').onclick = () => { $('bgDlg').hidden = true; };
$('bgApply').onclick = async () => { clearTimeout(bgTimer); const rec = BG.rec; if (!BG.result) BG.result = removeBackground(BG.src, BG.color, +$('bgTol').value, +$('bgSoft').value, $('bgHoles').checked); rec.canvas = trimCanvas(BG.result); rec.cleaned = true; rec.needsBg = false; await saveRec(rec); $('bgDlg').hidden = true; renderLib(); refreshLogos(); toast(`Background removed from “${rec.name}”.`); };
$('bgRestore').onclick = async () => { const rec = BG.rec; rec.canvas = trimCanvas(await blobToCanvas(rec.original)); rec.cleaned = false; rec.needsBg = !edgeIsClear(rec.canvas); await saveRec(rec); $('bgDlg').hidden = true; renderLib(); refreshLogos(); };
$('bgDlg').addEventListener('click', e => { if (e.target === $('bgDlg')) $('bgCancel').click(); });

/* ================= drawing logos & pictures ================= */
// Draw a logo into a w×h box so it looks right when that box is shown at `aspect` (metres wide / tall) on the model.
function logoInto(w, h, aspect, id, margin) {
  const rec = logoById(id), L = rec && rec.canvas, c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  if (!L) return c;
  const xs = aspect ? (w / h) / aspect : 1, lw = L.width * xs, lh = L.height, m = margin / 100;
  const s = Math.min(c.width * (1 - 2 * m) / lw, c.height * (1 - 2 * m) / lh);
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
  g.drawImage(L, (c.width - lw * s) / 2, (c.height - lh * s) / 2, lw * s, lh * s); return c;
}
function pictureInto(w, h, aspect, img, fit) {
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  if (!img) return c; const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
  if (fit === 'stretch') { g.drawImage(img, 0, 0, c.width, c.height); return c; }
  const xs = aspect ? (w / h) / aspect : 1, iw = img.width * xs, ih = img.height;
  const s = fit === 'cover' ? Math.max(c.width / iw, c.height / ih) : Math.min(c.width / iw, c.height / ih);
  g.drawImage(img, (c.width - iw * s) / 2, (c.height - ih * s) / 2, iw * s, ih * s); return c;
}
function composite(base, W, H, ed) {
  const out = new Uint8ClampedArray(base);
  for (const r of ed.regions) {
    if (!r.on) continue;
    const x0 = Math.round(r.u0 * W), x1 = Math.round(r.u1 * W), y0 = Math.round((1 - r.v1) * H), y1 = Math.round((1 - r.v0) * H), w = x1 - x0, h = y1 - y0;
    if (w < 2 || h < 2) continue;
    if (ed.mode === 'hide' || ed.mode === 'paint') {
      const f = ed.mode === 'paint' ? hex(ed.paint) : [0, 0, 0], a = ed.mode === 'paint' ? 255 : 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 4; out[i] = f[0]; out[i + 1] = f[1]; out[i + 2] = f[2]; out[i + 3] = a; }
      continue;
    }
    if (ed.mode === 'image' && !ed.image) continue;
    if (ed.bg !== 'keep' || ed.mode === 'image' && ed.fit !== 'fit') {
      const f = ed.bg === 'fill' ? hex(ed.fill) : null;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 4; if (f) { out[i] = f[0]; out[i + 1] = f[1]; out[i + 2] = f[2]; out[i + 3] = 255; } else out[i + 3] = 0; }
    }
    const lc = ed.mode === 'image' ? pictureInto(w, h, r.aspect, ed.image, ed.fit) : logoInto(w, h, r.aspect, ed.logo, ed.margin);
    const d = lc.getContext('2d').getImageData(0, 0, w, h).data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4, a = d[s + 3] / 255; if (!a) continue;
      const i = ((y0 + y) * W + x0 + x) * 4, ba = out[i + 3] / 255, oa = a + ba * (1 - a);
      for (let c = 0; c < 3; c++) out[i + c] = (d[s + c] * a + out[i + c] * ba * (1 - a)) / oa;
      out[i + 3] = oa * 255;
    }
  }
  return out;
}
function upscale(rgba, W, H, f) {
  if (f === 1) return rgba;
  const src = document.createElement('canvas'); src.width = W; src.height = H; src.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba), W, H), 0, 0);
  const c = document.createElement('canvas'); c.width = W * f; c.height = H * f; const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, c.width, c.height);
  return g.getImageData(0, 0, c.width, c.height).data;
}

/* ================= texture cards ================= */
const isLikely = t => !t.skip && t.score > 0;
const decodeCache = new Map();
function decodeTex(path) {
  if (decodeCache.has(path)) return decodeCache.get(path);
  const r = Core.decodeDDS(S.mod.files.get(path)); if (decodeCache.size > 6) decodeCache.delete(decodeCache.keys().next().value);
  decodeCache.set(path, r); return r;
}
let thumbQueue = [], thumbBusy = false;
const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { io.unobserve(e.target); thumbQueue.push(e.target); pump(); } }, { rootMargin: '300px' }) : null;
async function pump() {
  if (thumbBusy) return; thumbBusy = true;
  while (thumbQueue.length) {
    const el = thumbQueue.shift(); if (!S.mod) break; const p = el.dataset.path; await tick();
    let c = S.mod.thumbs.get(p);
    if (!c) {
      const data = S.mod.files.get(p); if (!data) continue;
      const r = data.length > 48e6 ? { error: 'too large to preview' } : Core.decodeDDS(data);
      if (r.error) { c = { error: r.error, w: r.width, h: r.height, format: r.format }; S.mod.thumbs.set(p, c); paintCard(el); continue; }
      c = { canvas: rgbaToCanvas(r.rgba, r.width, r.height, 360), w: r.width, h: r.height, format: r.format }; S.mod.thumbs.set(p, c);
    }
    paintCard(el);
  }
  thumbBusy = false;
}
const flagText = ed => ({ hide: 'Hidden', paint: 'Painted', image: 'New picture' })[ed.mode] || 'Logo';
function paintCard(el) {
  const p = el.dataset.path, th = S.mod && S.mod.thumbs.get(p); if (!th) return;
  const box = el.querySelector('.thumb'), ed = S.mod.edits.get(p);
  if (th.error) { box.innerHTML = '<span class="muted" style="font-size:.75rem;padding:10px;text-align:center"></span>'; box.firstChild.textContent = 'No preview: ' + th.error; }
  else {
    let cv = box.querySelector('canvas'); if (!cv) { cv = document.createElement('canvas'); box.prepend(cv); }
    cv.width = th.canvas.width; cv.height = th.canvas.height; const g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height);
    if (ed) { const r = decodeTex(p); g.drawImage(rgbaToCanvas(composite(r.rgba, r.width, r.height, ed), r.width, r.height, 360), 0, 0, cv.width, cv.height); }
    else g.drawImage(th.canvas, 0, 0);
  }
  let fl = box.querySelector('.flag');
  if (ed && !fl) { fl = document.createElement('span'); fl.className = 'chip hot flag'; box.appendChild(fl); }
  if (!ed && fl) fl.remove(); if (ed) fl.textContent = flagText(ed);
  el.classList.toggle('on', !!ed);
  el.querySelector('.meta').textContent = `${th.w || '?'}×${th.h || '?'} · ${th.format || ''} · ${fmtSize(S.mod.files.get(p).length)}`;
}
function makeCard(t) {
  const el = document.createElement('button'); el.type = 'button'; el.className = 'tex'; el.dataset.path = t.path;
  el.innerHTML = '<div class="thumb checker"></div><div class="body"><span class="name"></span><span class="meta">…</span><span class="chips"></span></div>';
  el.querySelector('.name').textContent = t.path;
  const spots = goodSpots(t), chips = el.querySelector('.chips');
  const add = (txt, cls) => { const c = document.createElement('span'); c.className = 'chip' + (cls ? ' ' + cls : ''); c.textContent = txt; chips.appendChild(c); };
  if (t.reasons.includes('name')) add('Logo-like name');
  if (t.reasons.includes('material')) add('Decal material');
  if (t.reasons.includes('option')) add('Shop option');
  if (spots.length) add(spots.length === 1 ? `On model ${spots[0].wM.toFixed(2)}×${spots[0].hM.toFixed(2)} m` : `${spots.length} spots on model`, 'ok');
  el.addEventListener('click', () => openEditor(t));
  if (S.mod.thumbs.has(t.path)) paintCard(el); else if (io) io.observe(el); else { thumbQueue.push(el); pump(); }
  return el;
}
const goodSpots = t => t.spots.filter(s => (s.u1 - s.u0) * (s.v1 - s.v0) > .004);
function renderLikely() {
  const grid = $('gridLikely'); grid.innerHTML = ''; if (!S.mod) return;
  const list = S.mod.analysis.textures.filter(isLikely);
  if (!list.length) { grid.innerHTML = '<div class="empty" style="grid-column:1/-1">No logo-like textures found automatically. Check <b>All textures</b> to pick one yourself.</div>'; return; }
  for (const t of list) grid.appendChild(makeCard(t));
}
function renderAll() {
  const grid = $('gridAll'); grid.innerHTML = ''; if (!S.mod) return;
  const q = ($('texSearch').value || '').toLowerCase(), maps = $('texMaps').checked;
  const list = S.mod.analysis.textures.filter(t => (maps || !t.skip) && (!q || t.path.toLowerCase().includes(q)));
  if (!list.length) { grid.innerHTML = '<div class="empty" style="grid-column:1/-1">No textures match.</div>'; return; }
  for (const t of list) grid.appendChild(makeCard(t));
}
$('texSearch').addEventListener('input', renderAll); $('texMaps').addEventListener('change', renderAll);
function repaintCards() { document.querySelectorAll('.tex[data-path]').forEach(paintCard); }

/* ================= shop options ================= */
const groupKey = g => g.xml + '|' + g.tag + '|' + g.slot;
function renderOpts() {
  const box = $('optList'); box.innerHTML = ''; if (!S.mod) return;
  const gs = S.mod.analysis.groups;
  if (!gs.length) { box.innerHTML = '<div class="empty">This mod has no shop choices that swap a decal. Use <b>Logos &amp; decals</b> or <b>All textures</b> to change its textures directly.</div>'; return; }
  if (!S.lib.length) { box.innerHTML = '<div class="empty">Add logos to your library first, then tick them here to add them as shop choices.</div>'; return; }
  const wrap = document.createElement('div'); wrap.className = 'opts';
  gs.forEach((g, i) => {
    const k = groupKey(g); if (!S.mod.groups.has(k)) S.mod.groups.set(k, { on: false, makeDefault: true, logos: [] });
    const st = S.mod.groups.get(k); st.logos = st.logos.filter(id => S.lib.some(l => l.id === id));
    const asp = g.aspect || 2, row = document.createElement('div'); row.className = 'opt';
    row.innerHTML = `<input type="checkbox" class="switch" aria-label="Add choices to this set">
      <div class="what"><h3></h3><span class="mono muted"></span>
        <div class="ctl"><span class="muted">Add as choices:</span><span class="logoPick"></span></div>
        <div class="ctl"><label><input type="checkbox" class="def"> Pre-select the first one in the shop</label></div></div>
      <canvas class="checker" width="320" height="${Math.round(320 / asp)}"></canvas>`;
    row.querySelector('h3').textContent = `${g.vehicle ? g.vehicle + ' · ' : ''}${human(g.title)}`;
    row.querySelector('.mono').textContent = `${g.xml} · ${g.options} existing choices · ${g.aspect ? 'decal is ' + g.aspect.toFixed(2) + ' : 1 on the model' : 'decal size unknown, assuming 2 : 1'}`;
    const sw = row.querySelector('.switch'), d = row.querySelector('.def'), pick = row.querySelector('.logoPick'), cv = row.querySelector('canvas');
    sw.checked = st.on; d.checked = st.makeDefault;
    const draw = () => { const g2 = cv.getContext('2d'); g2.clearRect(0, 0, cv.width, cv.height); if (st.logos[0]) g2.drawImage(logoInto(cv.width, cv.height, cv.width / cv.height, st.logos[0], 4), 0, 0); cv.style.opacity = st.on && st.logos.length ? 1 : .35; };
    for (const l of S.lib) {
      const lab = document.createElement('label'), cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = st.logos.includes(l.id);
      cb.onchange = () => { st.logos = S.lib.filter(x => x === l ? cb.checked : st.logos.includes(x.id)).map(x => x.id); if (st.logos.length) st.on = true; sw.checked = st.on; draw(); updateChanges(); };
      lab.append(cb, document.createTextNode(l.name)); pick.appendChild(lab);
    }
    sw.onchange = () => { st.on = sw.checked; if (st.on && !st.logos.length && S.lib[0]) { st.logos = [S.lib[0].id]; pick.querySelector('input').checked = true; } draw(); updateChanges(); };
    d.onchange = () => { st.makeDefault = d.checked; };
    draw(); wrap.appendChild(row);
  });
  box.appendChild(wrap);
}

/* ================= texture editor ================= */
function defaultEdit(t, r) {
  const spots = goodSpots(t).slice(0, 16), snap = (v, e) => Math.abs(v - e) < .02 ? e : v;
  let big = 0; spots.forEach((s, i) => { if ((s.u1 - s.u0) * (s.v1 - s.v0) * s.wM * s.hM > (spots[big].u1 - spots[big].u0) * (spots[big].v1 - spots[big].v0) * spots[big].wM * spots[big].hM) big = i; });
  const regions = spots.length ? spots.map((s, i) => ({ u0: snap(s.u0, 0), v0: snap(s.v0, 0), u1: snap(s.u1, 1), v1: snap(s.v1, 1), aspect: +s.aspect.toFixed(2), on: i === big, label: `${s.wM.toFixed(2)} × ${s.hM.toFixed(2)} m · ${s.nodes.slice(0, 3).join(', ')}${s.count > 1 ? ' · ×' + s.count : ''}` }))
    : [{ u0: 0, v0: 0, u1: 1, v1: 1, aspect: +(r.width / r.height).toFixed(2), on: true, label: 'Whole texture (size on the model unknown)' }];
  let clear = 0; for (let i = 3; i < r.rgba.length; i += 28) if (r.rgba[i] < 16) clear++;
  const transparent = clear / (r.rgba.length / 28) > .08;
  return { mode: 'logo', paint: '#000000', regions, logo: S.lib[0] ? S.lib[0].id : null, margin: 4, bg: transparent ? 'clear' : 'fill', fill: avgColor(r), fit: 'stretch', image: null, imageName: '', _alpha: transparent || !!t.alphaMat, _new: true };
}
function avgColor(r) { let R = 0, G = 0, B = 0, n = 0; const W = r.width, H = r.height; for (let x = 0; x < W; x += 8) for (const y of [0, H - 1]) { const i = (y * W + x) * 4; R += r.rgba[i]; G += r.rgba[i + 1]; B += r.rgba[i + 2]; n++; } const h = v => Math.round(v / n).toString(16).padStart(2, '0'); return '#' + h(R) + h(G) + h(B); }
let drag = null;
function openEditor(t) {
  const r = decodeTex(t.path); if (r.error) { toast(t.path + ': ' + r.error); return; }
  const prev = S.mod.edits.get(t.path);
  const ed = prev ? { ...prev, regions: prev.regions.map(x => ({ ...x })) } : defaultEdit(t, r);
  S.current = { t, ed, r, existing: !!prev }; S.edView = 'after';
  if (!S.lib.length && ed.mode === 'logo') ed.mode = 'hide';
  $('edTitle').textContent = t.path; $('editor').hidden = false;
  syncEditor(); $('edClose').focus();
}
function commitEdit() {} // edits apply when the user clicks Apply
function refreshEditorLogos() {
  const sel = $('edLogo'); sel.innerHTML = '';
  if (!S.lib.length) { const o = document.createElement('option'); o.textContent = 'Library is empty'; sel.appendChild(o); sel.disabled = true; return; }
  sel.disabled = false; for (const l of S.lib) { const o = document.createElement('option'); o.value = l.id; o.textContent = l.name; sel.appendChild(o); }
  if (S.current) sel.value = (logoById(S.current.ed.logo) || {}).id;
}
function syncEditor() {
  const { ed, r } = S.current, f = ed.mode === 'hide' || ed.mode === 'paint' ? 1 : hdFactor(r.width, r.height);
  $('edInfo').textContent = `${r.width}×${r.height} ${r.format} → saved as ${r.width * f}×${r.height * f} ${quality() === 'dxt5' ? 'DXT5' : 'lossless'}`;
  document.querySelectorAll('#edMode button').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === ed.mode));
  $('fLogo').hidden = ed.mode !== 'logo'; $('fMargin').hidden = ed.mode !== 'logo'; $('fBg').hidden = ed.mode !== 'logo' && !(ed.mode === 'image' && ed.fit === 'fit');
  $('fImage').hidden = ed.mode !== 'image'; $('fPaint').hidden = ed.mode !== 'paint';
  $('edPaint').value = ed.paint; $('edImgName').textContent = ed.imageName || 'No picture chosen';
  document.querySelectorAll('#edFit input').forEach(i => i.checked = i.value === ed.fit);
  $('edModeHint').textContent = ({
    logo: S.lib.length ? 'Puts a logo from your library on the marked areas, sized for how they appear on the model.' : 'Your logo library is empty. Add logos under Logo library first.',
    image: 'Replaces the marked areas with any picture, for example a new paint pattern or a full retexture.',
    hide: ed._alpha ? 'Makes the marked areas see-through, so whatever was printed there disappears.' : 'This texture has no see-through parts, so its material may not support them. If the spot shows black in game, use Colour and match the paint.',
    paint: 'Paints the marked areas one flat colour, for example the vehicle’s paint colour.',
  })[ed.mode];
  refreshEditorLogos(); $('edMargin').value = ed.margin; $('edMarginV').textContent = ed.margin + '%'; $('edFill').value = ed.fill;
  document.querySelectorAll('#edBg input[name=bg]').forEach(i => i.checked = i.value === ed.bg);
  $('vBefore').setAttribute('aria-pressed', S.edView === 'before'); $('vAfter').setAttribute('aria-pressed', S.edView === 'after');
  $('edRemove').hidden = !S.current.existing;
  $('edApply').disabled = (ed.mode === 'image' && !ed.image) || (ed.mode === 'logo' && !S.lib.length) || !ed.regions.some(x => x.on);
  const box = $('edSpots'); box.innerHTML = '';
  ed.regions.forEach((rg, i) => {
    const row = document.createElement('label'); row.className = 'spot';
    row.innerHTML = '<input type="checkbox"><span></span><span class="sub">Shown at <input type="number" step="0.05" min="0.1" max="20"> : 1</span>';
    row.children[1].textContent = (rg.custom ? 'Your area · ' : `Spot ${i + 1} · `) + rg.label;
    const cb = row.children[0], num = row.querySelector('input[type=number]'); cb.checked = rg.on; num.value = rg.aspect;
    cb.onchange = () => { rg.on = cb.checked; syncEditor(); };
    num.onchange = () => { const v = parseFloat(num.value); if (v > 0) { rg.aspect = v; syncEditor(); } };
    box.appendChild(row);
  });
  drawEditor();
}
function drawEditor() {
  const { r, ed } = S.current, cv = $('edCanvas');
  const base = S.edView === 'after' ? composite(r.rgba, r.width, r.height, ed) : r.rgba;
  const src = rgbaToCanvas(base, r.width, r.height, 1400);
  cv.width = src.width; cv.height = src.height; const g = cv.getContext('2d'); g.drawImage(src, 0, 0);
  const sx = cv.width / r.width, sy = cv.height / r.height, acc = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#B86E0E';
  g.lineWidth = Math.max(1.5, cv.width / 500);
  ed.regions.forEach(rg => {
    const x = rg.u0 * r.width * sx, y = (1 - rg.v1) * r.height * sy, w = (rg.u1 - rg.u0) * r.width * sx, h = (rg.v1 - rg.v0) * r.height * sy;
    g.setLineDash(rg.on ? [] : [6, 5]); g.strokeStyle = rg.on ? acc : 'rgba(128,128,128,.9)'; g.strokeRect(x, y, w, h);
  });
  if (drag && drag.w) { g.setLineDash([4, 4]); g.strokeStyle = '#888'; g.strokeRect(drag.x, drag.y, drag.w, drag.h); }
  g.setLineDash([]);
}
function refreshCardFor(p) { document.querySelectorAll('.tex[data-path]').forEach(el => { if (el.dataset.path === p) paintCard(el); }); }
function closeEditor() { const c = S.current; $('editor').hidden = true; S.current = null; if (c) refreshCardFor(c.t.path); updateChanges(); }
$('edClose').onclick = closeEditor;
$('edApply').onclick = () => { const c = S.current; S.mod.edits.set(c.t.path, c.ed); closeEditor(); renderFiles(); toast(`${flagText(c.ed)} applied to ${baseName(c.t.path)}. Save the mod when you’re done.`); };
$('editor').addEventListener('click', e => { if (e.target === $('editor')) closeEditor(); });
document.addEventListener('keydown', e => { if (e.key !== 'Escape') return; if (!$('bgDlg').hidden) $('bgCancel').click(); else if (!$('editor').hidden) closeEditor(); });
$('edRemove').onclick = () => { const p = S.current.t.path; S.mod.edits.delete(p); $('editor').hidden = true; S.current = null; refreshCardFor(p); updateChanges(); toast('Changes to this texture undone.'); };
document.querySelectorAll('#edMode button').forEach(b => b.onclick = () => { S.current.ed.mode = b.dataset.mode; if (b.dataset.mode !== 'image' || S.current.ed.image) commitEdit(); syncEditor(); });
$('edPaint').oninput = e => { S.current.ed.paint = e.target.value; syncEditor(); };
$('edLogo').onchange = e => { S.current.ed.logo = e.target.value; syncEditor(); };
$('edMargin').oninput = e => { S.current.ed.margin = +e.target.value; $('edMarginV').textContent = e.target.value + '%'; syncEditor(); };
$('edFill').oninput = e => { S.current.ed.fill = e.target.value; S.current.ed.bg = 'fill'; commitEdit(); syncEditor(); };
document.querySelectorAll('#edBg input[name=bg]').forEach(i => i.onchange = () => { S.current.ed.bg = i.value; syncEditor(); });
document.querySelectorAll('#edFit input').forEach(i => i.onchange = () => { S.current.ed.fit = i.value; commitEdit(); syncEditor(); });
$('edImgIn').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try { S.current.ed.image = await blobToCanvas(f); S.current.ed.imageName = f.name; S.current.ed.mode = 'image'; commitEdit(); syncEditor(); } catch (err) { toast('That picture couldn’t be read.'); }
});
$('vBefore').onclick = () => { S.edView = 'before'; syncEditor(); };
$('vAfter').onclick = () => { S.edView = 'after'; syncEditor(); };
const cvEl = $('edCanvas');
const pt = e => { const b = cvEl.getBoundingClientRect(); return [(e.clientX - b.left) * cvEl.width / b.width, (e.clientY - b.top) * cvEl.height / b.height]; };
cvEl.addEventListener('pointerdown', e => { if (!S.current) return; const [x, y] = pt(e); drag = { x0: x, y0: y, x, y, w: 0, h: 0 }; cvEl.setPointerCapture(e.pointerId); });
cvEl.addEventListener('pointermove', e => { if (!drag) return; const [x, y] = pt(e); drag.x = Math.min(x, drag.x0); drag.y = Math.min(y, drag.y0); drag.w = Math.abs(x - drag.x0); drag.h = Math.abs(y - drag.y0); drawEditor(); });
cvEl.addEventListener('pointerup', () => {
  if (!drag) return; const d = drag; drag = null;
  if (d.w > 8 && d.h > 8) {
    const W = cvEl.width, H = cvEl.height, rg = { u0: d.x / W, u1: (d.x + d.w) / W, v1: 1 - d.y / H, v0: 1 - (d.y + d.h) / H, on: true, custom: true, label: 'drawn by you' };
    rg.aspect = +(d.w / d.h * (S.current.r.width / S.current.r.height) / (W / H)).toFixed(2);
    S.current.ed.regions.forEach(x => x.on = false); S.current.ed.regions.push(rg); commitEdit(); syncEditor();
  } else drawEditor();
});
$('edToLib').onclick = async () => {
  const { r, ed, t } = S.current, rg = ed.regions.filter(x => x.on).pop() || ed.regions[0];
  const x0 = Math.round(rg.u0 * r.width), x1 = Math.round(rg.u1 * r.width), y0 = Math.round((1 - rg.v1) * r.height), y1 = Math.round((1 - rg.v0) * r.height);
  const crop = document.createElement('canvas'); crop.width = x1 - x0; crop.height = y1 - y0;
  crop.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(r.rgba), r.width, r.height), -x0, -y0);
  // undo the model's stretch so the logo has its real proportions
  const outW = Math.max(1, Math.round(crop.height * (rg.aspect || crop.width / crop.height))), fix = document.createElement('canvas'); fix.width = outW; fix.height = crop.height;
  const g = fix.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(crop, 0, 0, outW, crop.height);
  const rec = await addLogo(await canvasBlob(fix), baseName(t.path).replace(/\.dds$/i, '').replace(/[_-]+/g, ' '));
  await saveRec(rec); renderLib(); refreshLogos();
  toast(`Added “${rec.name}” to your logo library${rec.needsBg ? '. It has a solid background; remove it from the Logo library.' : '.'}`, 5000);
};
$('edExport').onclick = async () => {
  const { r, ed, t } = S.current, rgba = composite(r.rgba, r.width, r.height, ed);
  const blob = await canvasBlob(rgbaToCanvas(rgba, r.width, r.height));
  try { const res = await offerFile(baseName(t.path).replace(/\.dds$/i, '.png'), blob, 'png'); if (res === 'saved') toast('PNG saved.'); } catch (e) { toast('Couldn’t save: ' + e.message); }
};

/* ================= files tab ================= */
const TEXT_EXT = /\.(xml|i3d|lua|txt|cfg|json|xsd|md|gls)$/i;
function renderFiles() {
  const list = $('fileList'); list.innerHTML = ''; if (!S.mod) return;
  const byDir = new Map();
  for (const e of S.mod.entries.slice().sort((a, b) => a.rel.localeCompare(b.rel))) { const d = e.rel.includes('/') ? e.rel.slice(0, e.rel.lastIndexOf('/')) : ''; if (!byDir.has(d)) byDir.set(d, []); byDir.get(d).push(e); }
  for (const [d, items] of byDir) {
    const h = document.createElement('div'); h.className = 'fdir'; h.textContent = d ? d + '/' : 'Mod folder'; list.appendChild(h);
    for (const e of items) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'fitem'; b.setAttribute('role', 'option'); b.setAttribute('aria-selected', S.mod.fileSel === e.rel);
      b.innerHTML = '<span class="nm"></span><span class="sz"></span>'; b.querySelector('.nm').textContent = baseName(e.rel); b.querySelector('.sz').textContent = e.size ? fmtSize(e.size) : '';
      if (S.mod.textEdits.has(e.rel) || S.mod.edits.has(e.rel)) { const dot = document.createElement('span'); dot.className = 'dot'; dot.title = 'Changed'; b.prepend(dot); }
      b.onclick = () => openFile(e.rel); list.appendChild(b);
    }
  }
}
async function openFile(rel) {
  S.mod.fileSel = rel; renderFiles(); const view = $('fileView'); view.innerHTML = '';
  const head = document.createElement('div'); head.className = 'fhead'; head.innerHTML = '<span class="mono"></span><span class="acts" style="display:flex;gap:8px;flex-wrap:wrap"></span>'; head.firstChild.textContent = rel; view.appendChild(head);
  const acts = head.lastChild;
  if (/\.dds$/i.test(rel)) {
    const t = S.mod.analysis.textures.find(x => x.path === rel);
    const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'This is a texture.'; view.appendChild(p);
    const b = document.createElement('button'); b.className = 'btn primary small'; b.textContent = 'Open in texture editor'; b.onclick = () => t && openEditor(t); acts.appendChild(b);
    return;
  }
  if (!TEXT_EXT.test(rel)) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'This file type can’t be edited here. It stays exactly as it is when you save.'; view.appendChild(p); return; }
  const zf = S.mod.zip.file(S.mod.prefix + rel); let text = S.mod.textEdits.get(rel);
  if (text === undefined) { const raw = await zf.async('uint8array'); if (raw.length > 4e6) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'This file is too large to edit here.'; view.appendChild(p); return; } text = new TextDecoder().decode(raw).replace(/^﻿/, ''); }
  const ta = document.createElement('textarea'); ta.spellcheck = false; ta.value = text; ta.setAttribute('aria-label', rel);
  const err = document.createElement('p'); err.className = 'err'; err.hidden = true;
  const apply = document.createElement('button'); apply.className = 'btn primary small'; apply.textContent = 'Keep these edits';
  const revert = document.createElement('button'); revert.className = 'btn small'; revert.textContent = 'Revert to original'; revert.disabled = !S.mod.textEdits.has(rel);
  apply.onclick = () => {
    if (/\.(xml|i3d|xsd)$/i.test(rel)) { const doc = new DOMParser().parseFromString(ta.value, 'application/xml'), pe = doc.querySelector('parsererror'); if (pe) { err.hidden = false; err.textContent = 'This XML has an error, so the game would fail to load it: ' + pe.textContent.split('\n').slice(0, 2).join(' '); return; } }
    err.hidden = true; S.mod.textEdits.set(rel, ta.value); revert.disabled = false; updateChanges(); renderFiles(); toast('Edits kept. Save the mod to write them.');
  };
  revert.onclick = () => { S.mod.textEdits.delete(rel); updateChanges(); openFile(rel); };
  acts.append(revert, apply); view.append(ta, err);
}

/* ================= place logos (3D) ================= */
function listModels(files) { // i3d files with the store name that uses them
  const out = [], names = new Map();
  for (const [p, u8] of files) if (/\.xml$/i.test(p)) {
    let t; try { t = new TextDecoder().decode(u8); } catch (e) { continue; }
    const fn = t.match(/<filename>\s*([^<]+?\.i3d)\s*<\/filename>/i), nm = t.match(/<storeData>[\s\S]*?<name>\s*(?:<en>)?\s*([^<$][^<]*?)\s*</);
    if (fn) { const rel = Core.normPath(fn[1]); if (files.has(rel) && !names.has(rel)) names.set(rel, nm ? nm[1] : null); }
  }
  for (const p of files.keys()) if (/\.i3d$/i.test(p) && files.has(p + '.shapes')) out.push({ path: p, name: names.get(p) || null, main: names.has(p) });
  return out.sort((a, b) => (b.main - a.main) || (files.get(b.path + '.shapes').length - files.get(a.path + '.shapes').length));
}
function initPlace() {
  const M = S.mod; if (!M) return;
  if (!M.models.length) { $('viewStatus').hidden = false; $('viewStatus').textContent = 'This mod has no 3D models the app can read.'; return; }
  if (!S.viewer) {
    if (!window.THREE || !window.FDSViewer) { $('viewStatus').hidden = false; $('viewStatus').textContent = 'The 3D view couldn’t start (3D library missing).'; return; }
    try { S.viewer = FDSViewer($('view3d')); } catch (e) { $('viewStatus').hidden = false; $('viewStatus').textContent = 'The 3D view couldn’t start on this computer: ' + e.message; return; }
    S.viewer.onPick = placeAt; S.viewer.onSelect = id => selectSticker(id);
    S.viewer.setBackground(getComputedStyle(document.documentElement).getPropertyValue('--check-a').trim() || '#d9ded3');
  }
  const sel = $('placeModel'); sel.innerHTML = '';
  for (const m of M.models) { const o = document.createElement('option'); o.value = m.path; o.textContent = (m.name ? m.name + ' · ' : '') + baseName(m.path); sel.appendChild(o); }
  $('fPlaceModel').hidden = M.models.length < 2;
  if (!M.place) M.place = { i3d: M.models[0].path, sel: null }; sel.value = M.place.i3d;
  fillPlaceLogos(); loadModel(M.place.i3d);
}
$('placeModel').addEventListener('change', e => { S.mod.place.i3d = e.target.value; S.mod.place.sel = null; loadModel(e.target.value); });
let loadedModel = null;
async function loadModel(i3d) {
  const M = S.mod; if (loadedModel === M.name + '|' + i3d && S.viewer) { drawStickers(); return; }
  const st = $('viewStatus'); st.hidden = false; st.textContent = 'Reading the 3D model…'; await tick(); await tick();
  try {
    const text = new TextDecoder().decode(M.files.get(i3d)).replace(/^﻿/, '');
    const shapes = Core.readAllShapes(M.files.get(i3d + '.shapes'));
    await S.viewer.load({ i3dPath: i3d, text, shapes, files: M.files });
    loadedModel = M.name + '|' + i3d; st.hidden = true; drawStickers();
  } catch (e) { st.textContent = 'This model couldn’t be shown: ' + e.message; }
}
function fillPlaceLogos() {
  const sel = $('placeLogo'), cur = sel.value; sel.innerHTML = '';
  if (!S.lib.length) { const o = document.createElement('option'); o.textContent = 'Add logos in the Logo library first'; sel.appendChild(o); sel.disabled = true; return; }
  sel.disabled = false; for (const l of S.lib) { const o = document.createElement('option'); o.value = l.id; o.textContent = l.name; sel.appendChild(o); }
  const st = selected(); sel.value = st ? st.logo : (S.lib.some(l => l.id === cur) ? cur : S.lib[0].id);
}
const selected = () => S.mod && S.mod.place && S.mod.stickers.find(x => x.id === S.mod.place.sel) || null;
$('placeLogo').addEventListener('change', e => { const st = selected(); if (st) { st.logo = e.target.value; drawStickers(); updateChanges(); } });
const V = { sub: (a, b) => a.map((v, i) => v - b[i]), add: (a, b) => a.map((v, i) => v + b[i]), mul: (a, k) => a.map(v => v * k), dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], norm: a => { const l = Math.hypot(...a) || 1; return a.map(v => v / l); } };
function frameOf(normal, rotDeg) { // right/up directions on the surface; text reads normally from outside
  const n = V.norm(normal), ref = Math.abs(n[1]) > 0.92 ? [0, 0, 1] : [0, 1, 0];
  let r = V.norm(V.cross(ref, n)), u = V.cross(n, r);
  const a = rotDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return { n, r: V.add(V.mul(r, c), V.mul(u, s)), u: V.sub(V.mul(u, c), V.mul(r, s)) };
}
function cornersOf(p, rotDeg, width, aspect, normal) {
  const f = frameOf(normal, rotDeg), h = width / aspect, c = V.add(p, V.mul(f.n, 0.004)), hw = V.mul(f.r, width / 2), hh = V.mul(f.u, h / 2);
  return [V.sub(V.sub(c, hw), hh), V.sub(V.add(c, hw), hh), V.add(V.add(c, hw), hh), V.add(V.sub(c, hw), hh)];
}
function logoAspect(id) { const l = logoById(id); return l ? l.canvas.width / l.canvas.height : 2; }
function updateTwin(st) {
  st.twin = null; if (!st.mirror || !S.viewer) return;
  if (Math.abs(st.point[0]) < 0.05) { st.twinNote = 'This sticker is on the centre line, so there’s no other side.'; return; }
  const p = [-st.point[0], st.point[1], st.point[2]], n = [-st.normal[0], st.normal[1], st.normal[2]];
  const hit = S.viewer.castAt(V.add(p, V.mul(n, 0.25)), V.mul(n, -1), 0.6);
  if (!hit) { st.twinNote = 'No matching surface found on the other side.'; return; }
  st.twin = { point: hit.point, normal: n, nodeId: hit.nodeId, name: hit.name, parentM: S.viewer.worldMatrixOf(hit.nodeId) }; st.twinNote = '';
}
function placeAt(hit) {
  if (!S.lib.length) { toast('Add a logo to your Logo library first.'); return; }
  const M = S.mod, logo = $('placeLogo').value;
  const st = { id: 'st' + Date.now().toString(36), i3d: M.place.i3d, logo, point: hit.point, normal: hit.normal, nodeId: hit.nodeId, name: hit.name, parentM: S.viewer.worldMatrixOf(hit.nodeId), width: 0.6, rot: 0, mirror: false, twin: null, twinNote: '' };
  M.stickers.push(st); M.place.sel = st.id; drawStickers(); updateChanges();
  toast(`Sticker placed on “${hit.name || 'part'}”. Adjust its size and position on the right.`);
}
function selectSticker(id) { S.mod.place.sel = id; drawStickers(); }
function drawStickers() {
  const M = S.mod; if (!M || !M.place || !S.viewer) return;
  const here = M.stickers.filter(st => st.i3d === M.place.i3d), list = [];
  for (const st of here) {
    const l = logoById(st.logo); if (!l) continue; const asp = logoAspect(st.logo);
    list.push({ id: st.id, corners: cornersOf(st.point, st.rot, st.width, asp, st.normal), logo: l.canvas, selected: st.id === M.place.sel });
    if (st.twin) list.push({ id: st.id, corners: cornersOf(st.twin.point, -st.rot, st.width, asp, st.twin.normal), logo: l.canvas, selected: st.id === M.place.sel });
  }
  S.viewer.setStickers(list);
  // side panel
  const st = selected(), ed = $('stickerEdit'); ed.hidden = !st;
  if (st) {
    $('stWidth').value = st.width; $('stWidthV').textContent = st.width.toFixed(2) + ' m'; $('stRot').value = st.rot; $('stRotV').textContent = st.rot + '°';
    $('stMirror').checked = st.mirror; $('placeLogo').value = st.logo;
    $('stInfo').textContent = `On “${st.name || 'part'}”` + (st.twin ? ` and “${st.twin.name || 'part'}”` : '') + (st.twinNote ? '. ' + st.twinNote : '.');
  }
  const box = $('stickerList'); box.innerHTML = '';
  if (!here.length) { box.innerHTML = '<div class="empty">No stickers yet. Pick a logo above, then click the model where it should go.</div>'; return; }
  for (const x of here) {
    const l = logoById(x.logo), b = document.createElement('button'); b.type = 'button'; b.className = 'stick'; b.setAttribute('aria-pressed', x.id === M.place.sel);
    b.innerHTML = '<img alt=""><div style="min-width:0"><div class="t"></div><div class="m"></div></div>';
    if (l) b.querySelector('img').src = thumbURL(l.canvas); b.querySelector('.t').textContent = l ? l.name : 'Missing logo';
    b.querySelector('.m').textContent = `${x.width.toFixed(2)} m on ${x.name || 'part'}${x.twin ? ' · both sides' : ''}`;
    b.onclick = () => { selectSticker(x.id); S.viewer.focus(x.point); };
    box.appendChild(b);
  }
}
$('stWidth').addEventListener('input', e => { const st = selected(); if (!st) return; st.width = +e.target.value; drawStickers(); });
$('stRot').addEventListener('input', e => { const st = selected(); if (!st) return; st.rot = +e.target.value; drawStickers(); });
$('stMirror').addEventListener('change', e => { const st = selected(); if (!st) return; st.mirror = e.target.checked; updateTwin(st); drawStickers(); updateChanges(); });
$('stDelete').onclick = () => { const M = S.mod, st = selected(); if (!st) return; M.stickers = M.stickers.filter(x => x !== st); M.place.sel = null; drawStickers(); updateChanges(); };
document.querySelectorAll('.nudge [data-n]').forEach(b => b.onclick = () => {
  const st = selected(); if (!st) return; const [dx, dy] = b.dataset.n.split(',').map(Number), step = +$('stStep').value, f = frameOf(st.normal, st.rot);
  const p = V.add(st.point, V.add(V.mul(f.r, dx * step), V.mul(f.u, dy * step)));
  const hit = S.viewer.castAt(V.add(p, V.mul(f.n, 0.2)), V.mul(f.n, -1), 0.4); // stay on the surface
  if (hit) { st.point = hit.point; st.nodeId = hit.nodeId; st.name = hit.name; st.parentM = S.viewer.worldMatrixOf(hit.nodeId); } else st.point = p;
  updateTwin(st); drawStickers();
});
/** Write stickers into one model: new shapes, a material + texture per logo, and Shape nodes under the parts they sit on. */
async function buildStickers(i3d, list) {
  const M = S.mod, shapesPath = i3d + '.shapes', files = [];
  let text = M.textEdits.get(i3d) || new TextDecoder().decode(M.files.get(i3d)).replace(/^﻿/, '');
  const doc = Core.parseXML(text), root = Core.find(doc, 'i3D') || doc;
  const all = Core.findAll(root, () => true), nl = text.includes('\r\n') ? '\r\n' : '\n';
  let maxFile = 0, maxMat = 0, maxNode = 0;
  for (const e of all) { if (e.tag === 'File') maxFile = Math.max(maxFile, +e.attrs.fileId || 0); if (e.tag === 'Material') maxMat = Math.max(maxMat, +e.attrs.materialId || 0); if (e.attrs.nodeId) maxNode = Math.max(maxNode, +e.attrs.nodeId || 0); }
  const filesEl = Core.find(root, 'Files'), matsEl = Core.find(root, 'Materials');
  if (!filesEl || filesEl.closeStart == null || !matsEl || matsEl.closeStart == null) throw new Error(baseName(i3d) + ' has no Files or Materials section');
  const lineStart = at => text.lastIndexOf('\n', at - 1) + 1, indentAt = at => text.slice(lineStart(at), at).match(/^[ \t]*/)[0];
  const ops = [];
  // one texture + material per logo
  const matFor = new Map();
  for (const id of [...new Set(list.map(st => st.logo))]) {
    const l = logoById(id), W = hdOn() ? 2048 : 1024; let H = 1; while (H * 2 <= W / (l.canvas.width / l.canvas.height) * 1.4) H *= 2; H = Math.max(64, H);
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(l.canvas, 0, 0, W, H); // the sticker's shape restores the proportions
    const tex = `custom_decals/${Core.slug(l.name).toLowerCase()}_sticker.dds`;
    files.push({ rel: tex, data: Core.encodeDDS(g.getImageData(0, 0, W, H).data, W, H, quality()) });
    const fid = ++maxFile, mid = ++maxMat; matFor.set(id, mid);
    const fi = indentAt(filesEl.closeStart) + '  ', mi = indentAt(matsEl.closeStart) + '  ';
    ops.push({ at: lineStart(filesEl.closeStart), del: 0, text: `${fi}<File fileId="${fid}" filename="${Core.relPath(i3d, tex)}"/>${nl}` });
    ops.push({ at: lineStart(matsEl.closeStart), del: 0, text: `${mi}<Material name="fds_${Core.slug(l.name).toLowerCase()}" materialId="${mid}" alphaBlending="true">${nl}${mi}  <Texture fileId="${fid}"/>${nl}${mi}</Material>${nl}` });
  }
  // geometry
  let sid = Math.max(Core.maxShapeId(M.files.get(shapesPath)), ...Core.findAll(root, e => e.tag === 'Shape').map(e => +e.attrs.shapeId || 0));
  const entities = [], children = new Map(); let k = 0;
  const addOne = (st, point, normal, rot, nodeId, parentM) => {
    const inv = new THREE.Matrix4().fromArray(parentM).invert();
    const corners = cornersOf(point, rot, st.width, logoAspect(st.logo), normal).map(c => new THREE.Vector3(...c).applyMatrix4(inv).toArray());
    const id = ++sid, name = `fds_sticker_${++k}`;
    entities.push(version => Core.buildShapeEntity({ name, shapeId: id, verts: corners, tris: [0, 1, 2, 0, 2, 3], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]], version }));
    if (!children.has(nodeId)) children.set(nodeId, []);
    children.get(nodeId).push(`<Shape name="${name}" shapeId="${id}" castsShadows="false" receiveShadows="true" decalLayer="1" clipDistance="150" nodeId="${++maxNode}" materialIds="${matFor.get(st.logo)}"/>`);
  };
  for (const st of list) { addOne(st, st.point, st.normal, st.rot, st.nodeId, st.parentM); if (st.twin) addOne(st, st.twin.point, st.twin.normal, -st.rot, st.twin.nodeId, st.twin.parentM); }
  for (const [nodeId, kidsXml] of children) {
    const el = Core.findAll(root, e => e.tag === 'Shape' && e.attrs.nodeId === nodeId)[0]; if (!el) throw new Error('part ' + nodeId + ' not found');
    const ind = indentAt(el.start);
    if (el.closeStart != null) ops.push({ at: lineStart(el.closeStart), del: 0, text: kidsXml.map(x => ind + '  ' + x + nl).join('') });
    else { const slash = text.lastIndexOf('/>', el.end); ops.push({ at: slash, del: 2, text: '>' + nl + kidsXml.map(x => ind + '  ' + x + nl).join('') + ind + '</Shape>' }); }
  }
  for (const op of ops.sort((a, b) => b.at - a.at)) text = text.slice(0, op.at) + op.text + text.slice(op.at + op.del);
  files.push({ rel: shapesPath, data: Core.appendShapeEntities(M.files.get(shapesPath), entities) });
  return { files, i3dText: text };
}

/* ================= changes + saving ================= */
function plan() {
  if (!S.mod) return { tex: [], grp: [], txt: [], stk: [] };
  const tex = [...S.mod.edits.entries()].filter(([, e]) => e.regions.some(r => r.on) && (e.mode !== 'image' || e.image) && (e.mode !== 'logo' || S.lib.length));
  const grp = S.mod.analysis.groups.filter(g => { const st = S.mod.groups.get(groupKey(g)); return st && st.on && st.logos.length; });
  const txt = [...S.mod.textEdits.entries()];
  const stk = S.mod.stickers.filter(st => logoById(st.logo));
  return { tex, grp, txt, stk };
}
function changeCount() { const p = plan(); return p.tex.length + p.grp.length + p.txt.length + p.stk.length; }
function updateChanges() {
  if (!S.mod) return; const p = plan(), nOpt = p.grp.reduce((a, g) => a + S.mod.groups.get(groupKey(g)).logos.length, 0); let n = p.tex.length + nOpt + p.txt.length + p.stk.length;
  $('cntStickers').textContent = p.stk.length ? p.stk.length : '';
  const nSt = p.stk.reduce((a, st) => a + 1 + (st.twin ? 1 : 0), 0);
  const parts = []; if (nSt) parts.push(`<b>${nSt}</b> sticker${nSt === 1 ? '' : 's'}`); if (p.tex.length) parts.push(`<b>${p.tex.length}</b> texture${p.tex.length === 1 ? '' : 's'}`); if (nOpt) parts.push(`<b>${nOpt}</b> shop choice${nOpt === 1 ? '' : 's'}`); if (p.txt.length) parts.push(`<b>${p.txt.length}</b> file edit${p.txt.length === 1 ? '' : 's'}`);
  $('changeSum').innerHTML = n ? parts.join(' · ') : 'No changes yet';
  $('btnSave').disabled = !n; $('navChanges').hidden = !n; $('navChanges').textContent = n;
}
$('btnSave').onclick = saveMod;
async function saveMod() {
  const btn = $('btnSave'), msg = $('saveMsg'); btn.disabled = true; msg.hidden = false; msg.className = 'savemsg';
  const say = t => { msg.textContent = t; };
  const M = S.mod, z = M.zip, P = M.prefix, changed = [];
  try {
    const { tex, grp, txt } = plan(); let i = 0;
    for (const [path, ed] of tex) {
      say(`Painting ${baseName(path)} (${++i}/${tex.length})…`); await tick();
      const r = Core.decodeDDS(M.files.get(path)), f = ed.mode === 'hide' || ed.mode === 'paint' ? 1 : hdFactor(r.width, r.height), W = r.width * f, H = r.height * f;
      changed.push({ rel: path, data: Core.encodeDDS(composite(upscale(r.rgba, r.width, r.height, f), W, H, ed), W, H, quality()) });
    }
    const textOut = new Map(txt);
    const byXml = new Map(); for (const g of grp) { if (!byXml.has(g.xml)) byXml.set(g.xml, []); byXml.get(g.xml).push(g); }
    for (const [xml, gs] of byXml) {
      if (textOut.has(xml)) { say(`Skipped shop choices in ${xml}: you edited that file by hand. Revert it in Files to add choices.`); await new Promise(r => setTimeout(r, 1500)); continue; }
      const raw = M.files.get(xml); let src = new TextDecoder().decode(raw).replace(/^﻿/, '');
      gs.sort((a, b) => b.closeIdx - a.closeIdx);
      for (const g of gs) {
        const st = M.groups.get(groupKey(g)), asp = g.aspect || 2, ids = st.logos.slice();
        for (let k = 0; k < ids.length; k++) { // each choice goes in just before the closing tag, so this keeps library order
          const rec = logoById(ids[k]); say(`Adding ${rec.name} to ${human(g.title)}…`); await tick();
          const W = hdOn() ? 2048 : 1024, H = W / 2, rgba = logoInto(W, H, asp, rec.id, 4).getContext('2d').getImageData(0, 0, W, H).data;
          const texPath = `custom_decals/${Core.slug(rec.name).toLowerCase()}_${g.slot}_${baseName(xml).replace(/\.xml$/i, '')}.dds`;
          changed.push({ rel: texPath, data: Core.encodeDDS(rgba, W, H, quality()) });
          src = Core.addConfigOption(src, g, rec.name, texPath, st.makeDefault && k === 0);
        }
      }
      textOut.set(xml, src);
    }
    // stickers: new geometry + material + texture per model file
    const byI3d = new Map(); for (const st of plan().stk) { if (!byI3d.has(st.i3d)) byI3d.set(st.i3d, []); byI3d.get(st.i3d).push(st); }
    for (const [i3d, list] of byI3d) {
      if (textOut.has(i3d)) { say(`Skipped stickers on ${i3d}: you edited that file by hand. Revert it in Files to add stickers.`); await new Promise(r => setTimeout(r, 1500)); continue; }
      say(`Adding ${list.length} sticker${list.length === 1 ? '' : 's'} to ${baseName(i3d)}…`); await tick();
      const res = await buildStickers(i3d, list);
      changed.push(...res.files); textOut.set(i3d, res.i3dText);
    }
    for (const [rel, s] of textOut) { const raw = M.files.get(rel) || await z.file(P + rel).async('uint8array'); const bom = raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF; changed.push({ rel, data: new TextEncoder().encode((bom ? '﻿' : '') + s) }); }

    let result;
    if (M.kind === 'folder' && APP) {
      say('Writing files…'); await tick();
      result = await APP.writeFolder({ dir: M.path, files: changed, backup: $('backup').checked });
    } else {
      const originals = new Map();
      for (const c of changed) { const f = z.file(P + c.rel); originals.set(c.rel, f ? await f.async('uint8array') : null); z.file(P + c.rel, c.data); }
      say('Packing the zip…'); await tick();
      let blob;
      try { blob = await z.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } }, m => say(`Packing the zip… ${Math.round(m.percent)}%`)); }
      finally { for (const [rel, orig] of originals) { if (orig) z.file(P + rel, orig); else z.remove(P + rel); } } // keep the open mod pristine for the next save
      if (APP) result = await APP.saveZip({ path: M.path, name: M.name, data: new Uint8Array(await blob.arrayBuffer()), backup: $('backup').checked });
      else { const r = await offerFile(M.name, blob, 'zip'); result = r === 'saved' ? { saved: true, name: M.name, size: blob.size } : { canceled: true }; }
    }
    if (result && result.canceled) { msg.hidden = true; return; }
    msg.textContent = APP
      ? `Saved to ${result.path}${result.backupPath ? '. The original is backed up in ' + result.backupPath : ''}. Start the game to see it.`
      : `Saved ${M.name}. Put it in your mods folder under the same name, replacing the old one.`;
  } catch (e) { msg.className = 'savemsg err'; msg.textContent = 'Saving failed: ' + cleanErr(e) + (/EBUSY|EPERM|EACCES/.test(String(e && e.message)) ? '. If the game is running, close it and try again.' : ''); }
  finally { updateChanges(); }
}

/* ================= boot ================= */
(async () => {
  initSettings();
  const saved = await dbAll();
  if (saved && saved.length) {
    saved.sort((a, b) => a.order - b.order);
    for (const r of saved) { try { const rec = await addLogo(r.image, r.name, { id: r.id, cleaned: r.cleaned }); rec.original = r.original || r.image; rec.order = r.order; if (r.cleaned) rec.needsBg = false; } catch (e) {} }
  } else if (window.FDS_SEED && window.FDS_SEED.length && !store.get('seeded')) {
    for (const d of window.FDS_SEED) { const rec = await addLogo(dataBlob(d.src), d.name, { id: d.id }); rec.needsBg = false; await saveRec(rec); }
    store.set('seeded', '1');
  }
  renderLib(); setView('mods'); loadModsFolder();
})();
})();
