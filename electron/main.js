// Farm Decal Swapper — desktop shell. All mod work happens in the page; this file only touches the disk when asked.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const yauzl = require('yauzl');

const DEFAULT_MODS = () => path.join(app.getPath('documents'), 'My Games', 'FarmingSimulator2025', 'mods');
const BACKUPS = () => path.join(app.getPath('documents'), 'Farm Decal Swapper', 'Backups');
const ORIGINALS = () => path.join(app.getPath('documents'), 'Farm Decal Swapper', 'Original mods');
const GAME_DIR = () => path.dirname(DEFAULT_MODS()); // savegame1, savegame2, ... live here
let win;
const AUTOSAVE = process.env.FDS_AUTOSAVE === '1'; // used only by the automated tests: skips the save dialog

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 900, minWidth: 420, minHeight: 500,
    title: 'Farm Decal Swapper', backgroundColor: '#ECEFE7', show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  win.once('ready-to-show', () => win.show());
  // links open in the real browser; dropping a file never navigates the app away
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', e => e.preventDefault());
  // page-initiated downloads (none expected) get a normal save dialog
  win.webContents.session.on('will-download', (_e, item) => item.setSaveDialogOptions({ title: 'Save file' }));
  win.webContents.on('before-input-event', (e, input) => { if (input.type === 'keyDown' && input.key === 'F12' && !app.isPackaged) win.webContents.toggleDevTools(); });
}

/* ---------- reading mod zips without loading them fully ---------- */
function readZipEntries(file, want) { // want(name) -> true for entries to extract
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err) return reject(err);
      const out = {}; zip.readEntry();
      zip.on('entry', entry => {
        if (!want(entry.fileName) || entry.uncompressedSize > 8e6) return zip.readEntry();
        zip.openReadStream(entry, (e2, rs) => {
          if (e2) return zip.readEntry();
          const chunks = []; rs.on('data', c => chunks.push(c)); rs.on('end', () => { out[entry.fileName] = Buffer.concat(chunks); zip.readEntry(); });
        });
      });
      zip.on('end', () => resolve(out)); zip.on('error', reject);
    });
  });
}
function modInfoFrom(xml) {
  const title = (xml.match(/<title>[\s\S]*?<en>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/en>/i) || [])[1];
  const version = (xml.match(/<version>\s*([^<]+?)\s*<\/version>/i) || [])[1];
  const icon = (xml.match(/<iconFilename>\s*([^<]+?)\s*<\/iconFilename>/i) || [])[1];
  return { title: title ? title.trim() : null, version: version || null, icon: icon ? icon.replace(/\\/g, '/').replace(/\.(png|tga)$/i, '.dds') : null };
}
async function describeZip(full) {
  const st = await fsp.stat(full);
  const base = { name: path.basename(full), path: full, kind: 'zip', size: st.size, mtime: st.mtimeMs, title: null, version: null, icon: null };
  try {
    const first = await readZipEntries(full, n => /(^|\/)moddesc\.xml$/i.test(n));
    const key = Object.keys(first).sort((a, b) => a.length - b.length)[0]; if (!key) return null; // not an FS mod
    const info = modInfoFrom(first[key].toString('utf8').replace(/^﻿/, '')), prefix = key.slice(0, key.length - 'modDesc.xml'.length);
    Object.assign(base, { title: info.title, version: info.version });
    if (info.icon) { const ic = await readZipEntries(full, n => n.toLowerCase() === (prefix + info.icon).toLowerCase()); const k = Object.keys(ic)[0]; if (k) base.icon = new Uint8Array(ic[k]); }
  } catch (e) { return null; }
  return base;
}
async function describeFolder(full) {
  const md = path.join(full, 'modDesc.xml'); if (!fs.existsSync(md)) return null;
  const xml = (await fsp.readFile(md, 'utf8')).replace(/^﻿/, ''), info = modInfoFrom(xml);
  const res = { name: path.basename(full), path: full, kind: 'folder', size: 0, mtime: (await fsp.stat(full)).mtimeMs, title: info.title, version: info.version, icon: null };
  if (info.icon) { const ip = path.join(full, info.icon); if (fs.existsSync(ip)) res.icon = new Uint8Array(await fsp.readFile(ip)); }
  return res;
}
async function walk(dir, base = dir, out = []) {
  for (const d of await fsp.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) await walk(p, base, out); else out.push(p);
  }
  return out;
}
const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
function safeJoin(dir, rel) { const p = path.resolve(dir, rel); if (!p.startsWith(path.resolve(dir) + path.sep)) throw new Error('Refusing to write outside the mod folder'); return p; }

/* ---------- IPC ---------- */
ipcMain.handle('version', () => app.getVersion());
ipcMain.handle('defaultModsDir', () => DEFAULT_MODS());
ipcMain.handle('backupDir', () => BACKUPS());
ipcMain.handle('openPath', async (_e, which) => { const p = which === 'backups' ? BACKUPS() : which === 'originals' ? ORIGINALS() : null; if (p) { await fsp.mkdir(p, { recursive: true }); shell.openPath(p); } });
ipcMain.handle('originalsDir', () => ORIGINALS());

/* ---------- replacing a mod with your own copy ---------- */
function gameRunning() {
  if (process.platform !== 'win32') return Promise.resolve(false);
  return new Promise(res => require('child_process').execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true }, (err, out) => res(!err && /"FarmingSimulator2025[^"]*\.exe"/i.test(out))));
}
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Mods in the folder that list `name` as a dependency (they'd break if it moved). */
async function dependentsOf(modsDir, name) {
  const re = new RegExp('<dependency>\\s*' + escRe(name) + '\\s*</dependency>', 'i'), out = [];
  for (const d of await fsp.readdir(modsDir, { withFileTypes: true })) {
    const full = path.join(modsDir, d.name); let xml = null;
    try {
      if (d.isFile() && /\.zip$/i.test(d.name)) { const e = await readZipEntries(full, n => /(^|\/)moddesc\.xml$/i.test(n)); const k = Object.keys(e)[0]; if (k) xml = e[k].toString('utf8'); }
      else if (d.isDirectory() && fs.existsSync(path.join(full, 'modDesc.xml'))) xml = await fsp.readFile(path.join(full, 'modDesc.xml'), 'utf8');
    } catch (e) {}
    if (xml && re.test(xml)) out.push(d.name);
  }
  return out;
}
/** Point every savegame at the new mod name. Whole names only (FS25_X never matches inside FS25_X_Extra). Backs up each file it changes. */
async function retargetSavegames(oldName, newName, backupRoot) {
  const re = new RegExp('(?<![A-Za-z0-9_])' + escRe(oldName) + '(?![A-Za-z0-9_])', 'g'), out = [];
  let dirs = []; try { dirs = (await fsp.readdir(GAME_DIR(), { withFileTypes: true })).filter(d => d.isDirectory() && /^savegame\d+$/i.test(d.name)); } catch (e) { return out; }
  for (const d of dirs) {
    const sd = path.join(GAME_DIR(), d.name), changed = [];
    for (const f of (await fsp.readdir(sd)).filter(f => /\.xml$/i.test(f))) {
      const p = path.join(sd, f), txt = await fsp.readFile(p, 'utf8'); re.lastIndex = 0; if (!re.test(txt)) continue; re.lastIndex = 0;
      const b = path.join(backupRoot, d.name, f); await fsp.mkdir(path.dirname(b), { recursive: true }); await fsp.copyFile(p, b);
      const tmp = p + '.fds'; await fsp.writeFile(tmp, txt.replace(re, newName)); await fsp.rename(tmp, p); changed.push(f);
    }
    if (changed.length) out.push({ savegame: d.name, files: changed });
  }
  return out;
}
ipcMain.handle('replaceOriginal', async (_e, { oldPath, oldName, newName }) => {
  if (await gameRunning()) return { error: 'game-running' };
  const backupRoot = path.join(BACKUPS(), `Savegames before ${newName} ${stamp()}`);
  const savegames = await retargetSavegames(oldName, newName, backupRoot);
  let movedTo = null; const dependents = oldPath && fs.existsSync(oldPath) ? (await dependentsOf(path.dirname(oldPath), oldName)).filter(n => n !== path.basename(oldPath)) : [];
  if (oldPath && fs.existsSync(oldPath) && !dependents.length) {
    await fsp.mkdir(ORIGINALS(), { recursive: true });
    movedTo = path.join(ORIGINALS(), path.basename(oldPath));
    if (fs.existsSync(movedTo)) movedTo = path.join(ORIGINALS(), `${path.basename(oldPath, '.zip')}_${stamp()}.zip`);
    try { await fsp.rename(oldPath, movedTo); } catch (e) { if (e.code !== 'EXDEV') throw e; await fsp.copyFile(oldPath, movedTo); await fsp.unlink(oldPath); }
  }
  return { movedTo, savegames, backupDir: savegames.length ? backupRoot : null, dependents };
});
ipcMain.handle('pickFolder', async (_e, current) => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose your FS25 mods folder', defaultPath: current || DEFAULT_MODS(), properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('listMods', async (_e, dir) => {
  const items = await fsp.readdir(dir, { withFileTypes: true }); const out = [];
  for (const d of items) {
    const full = path.join(dir, d.name);
    try {
      if (d.isFile() && /\.zip$/i.test(d.name)) { const m = await describeZip(full); if (m) out.push(m); }
      else if (d.isDirectory()) { const m = await describeFolder(full); if (m) out.push(m); }
    } catch (e) { /* skip unreadable entries */ }
  }
  return out.sort((a, b) => (a.title || a.name).localeCompare(b.title || b.name));
});
ipcMain.handle('readFile', async (_e, p) => new Uint8Array(await fsp.readFile(p)));
ipcMain.handle('readFolder', async (_e, dir) => {
  const files = await walk(dir);
  return Promise.all(files.map(async f => ({ rel: path.relative(dir, f).split(path.sep).join('/'), data: new Uint8Array(await fsp.readFile(f)) })));
});
ipcMain.handle('pickZip', async (_e, dir) => {
  const r = await dialog.showOpenDialog(win, { title: 'Open a mod', defaultPath: dir || DEFAULT_MODS(), filters: [{ name: 'FS25 mod', extensions: ['zip'] }], properties: ['openFile'] });
  if (r.canceled) return null; const p = r.filePaths[0];
  return { path: p, name: path.basename(p), data: new Uint8Array(await fsp.readFile(p)) };
});
ipcMain.handle('saveZip', async (_e, { path: orig, name, data, backup }) => {
  const r = AUTOSAVE ? { filePath: orig || path.join(DEFAULT_MODS(), name) } : await dialog.showSaveDialog(win, { title: 'Save the patched mod', defaultPath: orig || path.join(DEFAULT_MODS(), name), filters: [{ name: 'FS25 mod', extensions: ['zip'] }] });
  if (r.canceled || !r.filePath) return { canceled: true };
  let backupPath = null;
  if (backup && fs.existsSync(r.filePath)) {
    await fsp.mkdir(BACKUPS(), { recursive: true });
    backupPath = path.join(BACKUPS(), `${path.basename(r.filePath, '.zip')}_${stamp()}.zip`);
    await fsp.copyFile(r.filePath, backupPath);
  }
  const tmp = r.filePath + '.saving'; await fsp.writeFile(tmp, Buffer.from(data)); await fsp.rename(tmp, r.filePath);
  return { saved: true, path: r.filePath, backupPath };
});
ipcMain.handle('writeFolder', async (_e, { dir, files, backup }) => {
  let backupPath = null;
  if (backup) {
    backupPath = path.join(BACKUPS(), `${path.basename(dir)}_${stamp()}`);
    for (const f of files) { const src = safeJoin(dir, f.rel); if (fs.existsSync(src)) { const dst = path.join(backupPath, f.rel); await fsp.mkdir(path.dirname(dst), { recursive: true }); await fsp.copyFile(src, dst); } }
  }
  for (const f of files) { const p = safeJoin(dir, f.rel); await fsp.mkdir(path.dirname(p), { recursive: true }); await fsp.writeFile(p, Buffer.from(f.data)); }
  return { saved: true, path: dir, backupPath };
});
ipcMain.handle('saveFile', async (_e, { name, data, kind }) => {
  const filters = kind === 'png' ? [{ name: 'PNG image', extensions: ['png'] }] : kind === 'zip' ? [{ name: 'Zip', extensions: ['zip'] }] : [];
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), name), filters });
  if (r.canceled || !r.filePath) return null;
  await fsp.writeFile(r.filePath, Buffer.from(data)); return r.filePath;
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
