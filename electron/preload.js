// The only bridge between the page and the computer. Exposes a small, fixed set of file operations.
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const call = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('fds', {
  version: () => call('version'),
  defaultModsDir: () => call('defaultModsDir'),
  backupDir: () => call('backupDir'),
  openPath: which => call('openPath', which),
  pickFolder: (current, title) => call('pickFolder', current, title),
  gameDataDir: dir => call('gameDataDir', dir),
  readGameFile: (dataDir, rel) => call('readGameFile', dataDir, rel),
  zipNames: file => call('zipNames', file),
  modCheckData: file => call('modCheckData', file),
  readGameLog: () => call('readGameLog'),
  listMods: dir => call('listMods', dir),
  readFile: p => call('readFile', p),
  readFolder: dir => call('readFolder', dir),
  pickZip: dir => call('pickZip', dir),
  saveZip: opts => call('saveZip', opts),
  writeFolder: opts => call('writeFolder', opts),
  saveFile: opts => call('saveFile', opts),
  replaceOriginal: opts => call('replaceOriginal', opts),
  scanEdited: opts => call('scanEdited', opts),
  gameRunning: () => call('gameRunning'),
  writeNewZip: opts => call('writeNewZip', opts),
  originalsDir: () => call('originalsDir'),
  listOriginals: () => call('listOriginals'),
  pathForFile: file => { try { return webUtils.getPathForFile(file); } catch (e) { return null; } },
});
