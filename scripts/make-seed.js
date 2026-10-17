// Makes a seed.js that preloads logos into a fresh library (used for personal builds).
//   node scripts/make-seed.js out.js "Name=path/to/logo.png" "Other name=path.webp" ...
const fs = require('fs'), path = require('path');
const [out, ...pairs] = process.argv.slice(2);
const logos = pairs.map((p, i) => { const k = p.indexOf('='), name = p.slice(0, k), file = p.slice(k + 1); const ext = path.extname(file).slice(1).toLowerCase();
  return { id: 'seed-' + i, name, src: `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,` + fs.readFileSync(file).toString('base64') }; });
fs.writeFileSync(out, 'window.FDS_SEED = ' + JSON.stringify(logos) + ';\n');
console.log('wrote', out, logos.map(l => l.name));
