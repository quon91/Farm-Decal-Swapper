// Builds a single self-contained HTML file of the app for use in a browser.
//   node scripts/build-web.js [--out file] [--seed seed.js] [--jszip inline|cdn] [--fragment]
const fs = require('fs'), path = require('path');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const flag = k => process.argv.includes(k);
const src = p => fs.readFileSync(path.join(__dirname, '..', 'src', p), 'utf8');
const out = arg('--out', path.join(__dirname, '..', 'dist', 'farm-decal-swapper.html'));
const seed = arg('--seed') ? fs.readFileSync(arg('--seed'), 'utf8') : src('seed.js');
const jszip = arg('--jszip', 'inline');
const esc = s => s.replace(/<\/script/gi, '<\\/script');
let html = src('index.html');
html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\n?/, '');
html = html.replace('<link rel="stylesheet" href="fonts.css">', '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Zilla+Slab:wght@600;700&family=Public+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">');
html = html.replace('<link rel="stylesheet" href="styles.css">', () => '<style>\n' + src('styles.css') + '\n</style>');
html = html.replace('<script src="vendor/jszip.min.js"></script>', () => jszip === 'cdn' ? '<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>' : '<script>' + esc(src('vendor/jszip.min.js')) + '</script>');
html = html.replace('<script src="vendor/three.min.js"></script>', () => jszip === 'cdn' ? '<script src="https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.min.js"></script>' : '<script>' + esc(src('vendor/three.min.js')) + '</script>');
for (const f of ['tables.js', 'core.js', 'viewer.js', 'app.js']) html = html.replace(`<script src="${f}"></script>`, () => '<script>\n' + esc(src(f)) + '\n</script>');
html = html.replace('<script src="seed.js"></script>', () => '<script>\n' + esc(seed) + '\n</script>');
if (flag('--fragment')) { // page body only: for hosts that add their own document skeleton
  html = html.replace(/^[\s\S]*?<head>\n?/, '').replace(/<meta charset="utf-8">\n?/, '').replace(/<meta name="viewport"[^>]*>\n?/, '').replace('</head>\n<body>\n', '').replace(/<\/body>\n<\/html>\n?$/, '');
}
fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, html);
console.log('wrote', out, (html.length / 1e6).toFixed(2) + ' MB');
