// Packages the Windows app: node scripts/package-win.js [--seed seed.js] [--out dir]
const path = require('path'), fs = require('fs');
const { packager } = require('@electron/packager');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const root = path.join(__dirname, '..'), pkg = require(path.join(root, 'package.json'));
const seed = arg('--seed'), outDir = arg('--out', path.join(root, 'dist'));
(async () => {
  const [appPath] = await packager({
    dir: root, out: outDir, overwrite: true, platform: 'win32', arch: 'x64', asar: true, prune: true,
    name: pkg.productName, executableName: pkg.productName, appVersion: pkg.version,
    ignore: [/^\/dist($|\/)/, /^\/test($|\/)/, /^\/docs($|\/)/, /^\/personal($|\/)/, /^\/scripts($|\/)/, /^\/\.github($|\/)/, /^\/test_.*/, /\.md$/],
    afterCopy: [(buildPath, _v, _p, _a, done) => { if (seed) fs.copyFileSync(seed, path.join(buildPath, 'src', 'seed.js')); done(); }],
  });
  // icon + version info on the .exe, written in plain JavaScript (no Wine needed)
  const ResEdit = await import('resedit');
  const exePath = path.join(appPath, pkg.productName + '.exe');
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);
  const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(root, 'build', 'icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const gid = groups.length ? groups[0].id : 1, lang = groups.length ? groups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, gid, lang, ico.icons.map(i => i.data));
  const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
  const [a, b, c] = pkg.version.split('.').map(Number), L = { lang: 1033, codepage: 1200 };
  vi.setFileVersion(a, b, c, 0); vi.setProductVersion(a, b, c, 0);
  vi.setStringValues(L, { ProductName: pkg.productName, FileDescription: pkg.productName, CompanyName: pkg.author || '', LegalCopyright: 'MIT License', OriginalFilename: pkg.productName + '.exe', InternalName: pkg.productName, FileVersion: pkg.version, ProductVersion: pkg.version });
  vi.outputToResourceEntries(res.entries); res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log('packaged', appPath);
})().catch(e => { console.error(e); process.exit(1); });
