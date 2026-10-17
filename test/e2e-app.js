// End-to-end test of the desktop app. Needs Playwright (npm i -D playwright) and, on Linux, xvfb-run.
//   FDS_TEST_MOD=path/to/some_mod.zip  FDS_TEST_LOGO=path/to/logo.png  node test/e2e-app.js
// It builds a throwaway home folder, so your real mods folder and library are never touched.
const { _electron: electron } = require('playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const MOD = process.env.FDS_TEST_MOD, LOGO = process.env.FDS_TEST_LOGO;
if (!MOD || !LOGO) { console.error('Set FDS_TEST_MOD and FDS_TEST_LOGO.'); process.exit(2); }
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fds-'));
const docs = path.join(home, 'Documents'), mods = path.join(docs, 'My Games', 'FarmingSimulator2025', 'mods');
fs.mkdirSync(mods, { recursive: true }); fs.mkdirSync(path.join(home, '.config'), { recursive: true });
fs.writeFileSync(path.join(home, '.config', 'user-dirs.dirs'), 'XDG_DOCUMENTS_DIR="$HOME/Documents"\n');
fs.copyFileSync(MOD, path.join(mods, path.basename(MOD)));
(async () => {
  const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--no-sandbox'],
    env: { ...process.env, HOME: home, USERPROFILE: home, FDS_AUTOSAVE: '1' } });
  const pg = await app.firstWindow(), errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  await pg.waitForSelector('.modcard', { timeout: 60000 });
  await pg.click('.nav[data-view=library]'); await pg.setInputFiles('#upLogo', LOGO); await pg.waitForTimeout(1500);
  if (await pg.isVisible('#bgDlg')) await pg.click('#bgApply');
  await pg.click('.nav[data-view=mods]'); await pg.click('.modcard');
  await pg.waitForSelector('#view-mod:not([hidden])', { timeout: 180000 }); await pg.waitForTimeout(1500);
  const card = await pg.$('#gridLikely .tex'); if (!card) throw new Error('no logo-like textures found in this mod');
  await card.click(); await pg.waitForTimeout(800); await pg.click('#edApply');
  await pg.click('#btnSave');
  await pg.waitForFunction(() => /Saved to|failed/.test(document.getElementById('saveMsg').textContent), null, { timeout: 600000 });
  const msg = await pg.textContent('#saveMsg'); console.log(msg);
  await app.close();
  if (!/Saved to/.test(msg) || errs.length) { console.error('FAILED', errs); process.exit(1); }
  console.log('ok - app opened a mod, applied a logo and saved with a backup');
})().catch(e => { console.error('FAILED', e); process.exit(1); });
