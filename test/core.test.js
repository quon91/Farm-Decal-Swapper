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
test('a new sticker shape can be built, appended and read back', () => {
  const plain0 = Core.buildShapeEntity({ name: 'probe', shapeId: 1, verts: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], tris: [0, 1, 2, 0, 2, 3], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] });
  const base = Core.emptyShapesFile(7); assert.strictEqual(Core.indexShapes(base).list.length, 0);
  const out = Core.appendShapeEntities(base, [plain0]);
  const idx = Core.indexShapes(out); assert.strictEqual(idx.list.length, 1); assert.strictEqual(idx.list[0].name, 'probe');
  const g = Core.readShape(out, idx, idx.list[0]);
  assert.deepStrictEqual([...g.pos], [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]); assert.deepStrictEqual([...g.tris], [0, 1, 2, 0, 2, 3]); assert.deepStrictEqual([...g.uv], [0, 0, 1, 0, 1, 1, 0, 1]);
});
test('i3d rotations compose as Rz * Ry * Rx', () => {
  const M = Core.mat([0, 0, 0], [90, 0, 90], [1, 1, 1]); // x: 90 then z: 90
  const v = [0, 1, 0], out = [M[0] * v[0] + M[4] * v[1] + M[8] * v[2], M[1] * v[0] + M[5] * v[1] + M[9] * v[2], M[2] * v[0] + M[6] * v[1] + M[10] * v[2]].map(x => Math.round(x * 1e6) / 1e6 + 0);
  assert.deepStrictEqual(out, [0, 0, 1]); // Rx(90) takes +Y to +Z, then Rz leaves +Z alone
});
console.log(`\n${n} tests passed`);
