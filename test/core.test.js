// Unit tests for the core (no dependencies): node test/core.test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const ctx = { TextDecoder, TextEncoder, console, Math, Uint8Array, Uint32Array, Float32Array, Uint8ClampedArray, DataView, Map, Set, Array, String, Number, JSON, Error, isFinite };
vm.createContext(ctx);
for (const f of ['tables.js', 'core.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'), ctx);
const Core = vm.runInContext('Core', ctx);
let n = 0; const test = (name, fn) => { fn(); n++; console.log('ok -', name); };

// a test image: colour gradient with a see-through hole
const W = 64, H = 32, img = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; img[i] = x * 4; img[i + 1] = y * 8; img[i + 2] = 128; img[i + 3] = (x > 20 && x < 40) ? 0 : 255; }

test('lossless DDS round-trips exactly', () => {
  const dds = Core.encodeDDS(img, W, H, 'lossless'), r = Core.decodeDDS(dds);
  assert.strictEqual(r.width, W); assert.strictEqual(r.height, H);
  for (let i = 0; i < img.length; i++) assert.strictEqual(r.rgba[i], img[i]);
  assert.strictEqual(Core.ddsInfo(dds).mips, 7); // 64x32 -> 1x1
});
test('DXT5 DDS stays close to the source', () => {
  const r = Core.decodeDDS(Core.encodeDDS(img, W, H, 'dxt5')); let se = 0, c = 0;
  for (let i = 0; i < img.length; i += 4) if (img[i + 3] === 255) for (let k = 0; k < 3; k++) { se += (r.rgba[i + k] - img[i + k]) ** 2; c++; }
  const psnr = 10 * Math.log10(255 * 255 / (se / c)); assert(psnr > 30, 'PSNR ' + psnr.toFixed(1));
  for (let i = 3; i < img.length; i += 4) assert(Math.abs(r.rgba[i] - img[i]) < 20);
});
test('XML reader finds nested elements', () => {
  const doc = Core.parseXML('<?xml version="1.0"?><a x="1"><b><c y=\'2\'/></b><!-- note --><d/></a>');
  assert.strictEqual(doc.children[0].tag, 'a'); assert.strictEqual(doc.children[0].children[0].children[0].attrs.y, '2');
});
test('shop choice is inserted before the closing tag, keeping CRLF', () => {
  const src = '<vehicle>\r\n    <designConfigurations title="x">\r\n        <designConfiguration name="A" price="0"/>\r\n    </designConfigurations>\r\n</vehicle>\r\n';
  const g = { tag: 'designConfigurations', itemTag: 'designConfiguration', slot: 'doorDecal', closeIdx: src.indexOf('</designConfigurations') };
  const out = Core.addConfigOption(src, g, 'My "Farm"', 'custom_decals/x.dds', true);
  assert(out.includes('name="My &quot;Farm&quot;" price="0" isDefault="true"'));
  assert(out.indexOf('My &quot;Farm') < out.indexOf('</designConfigurations>'));
  assert(!/[^\r]\n/.test(out), 'line endings stay CRLF');
  Core.parseXML(out);
});
console.log(`\n${n} tests passed`);
