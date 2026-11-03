/* Farm Decal Swapper — 3D model view for placing stickers. Uses three.js (global THREE) and Core. */
(() => {
'use strict';

function FDSViewer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputEncoding = THREE.sRGBEncoding;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 2000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445544, 0.85));
  const sun = new THREE.DirectionalLight(0xffffff, 0.75); camera.add(sun); sun.position.set(0.4, 0.8, 0.3); scene.add(camera);
  const root = new THREE.Group(); scene.add(root);
  const stickerGroup = new THREE.Group(); scene.add(stickerGroup);
  let meshes = [], disposed = false, needs = true, onPick = null, onSelect = null, onDrag = null, onDragEnd = null, bg = '#d9ded3', modelSize = 0, modelCenter = [0, 0, 0];
  const ray = new THREE.Raycaster(); ray.firstHitOnly = true; // nearest hit only: with the BVH below this is fast on big models
  const BVH = window.MeshBVHLib || null;

  /* ---------- orbit camera ---------- */
  const orbit = { target: new THREE.Vector3(), dist: 10, yaw: Math.PI * 0.75, pitch: 0.35 };
  function placeCamera() {
    const cp = Math.cos(orbit.pitch);
    camera.position.set(orbit.target.x + orbit.dist * cp * Math.sin(orbit.yaw), orbit.target.y + orbit.dist * Math.sin(orbit.pitch), orbit.target.z + orbit.dist * cp * Math.cos(orbit.yaw));
    camera.lookAt(orbit.target); needs = true;
  }
  let drag = null, hoverEv = null, hoverQueued = false;
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => {
    drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, pan: e.button === 2 || e.shiftKey, moved: false, sticker: null };
    if (e.button === 0 && !e.shiftKey) { const st = stickerAt(e); if (st) drag.sticker = st; } // left-drag on a sticker moves it
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) { hoverEv = e; if (!hoverQueued) { hoverQueued = true; requestAnimationFrame(() => { hoverQueued = false; if (!drag && hoverEv) canvas.style.cursor = stickerAt(hoverEv) ? 'grab' : ''; }); } return; }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
    if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 4) drag.moved = true;
    if (drag.sticker) {
      if (!drag.moved) return; canvas.style.cursor = 'grabbing';
      // one move per frame: the mouse can send far more events than the screen shows
      drag.last = e; if (!drag.queued) { drag.queued = true; const d = drag; requestAnimationFrame(() => { d.queued = false; if (drag !== d || !d.last) return;
        ray.setFromCamera(ndc(d.last), camera); const hit = ray.intersectObjects(meshes, false)[0];
        if (hit && onDrag) { d.dragged = true; onDrag(d.sticker, describeHit(hit, ray.ray.direction)); } }); }
      return;
    }
    if (drag.pan) {
      const s = orbit.dist * 0.0018, right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0), up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
      orbit.target.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
    } else { touched = true; orbit.yaw -= dx * 0.008; orbit.pitch = Math.max(-1.5, Math.min(1.5, orbit.pitch + dy * 0.008)); }
    placeCamera();
  });
  canvas.addEventListener('pointerup', e => { const d = drag; drag = null; canvas.style.cursor = ''; if (d && !d.moved && e.button === 0) click(e); if (d && d.sticker && d.dragged && onDragEnd) onDragEnd(d.sticker); });
  canvas.addEventListener('wheel', e => { e.preventDefault(); touched = true; orbit.dist = Math.max(0.2, Math.min(500, orbit.dist * Math.exp(e.deltaY * 0.0012))); placeCamera(); }, { passive: false });

  function ndc(e) { const r = canvas.getBoundingClientRect(); return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); }
  function stickerAt(e) { // id of the sticker under the pointer, if it isn't hidden behind the model
    ray.setFromCamera(ndc(e), camera);
    const st = ray.intersectObjects(stickerGroup.children.filter(o => o.isMesh), false)[0]; if (!st) return null;
    const hit = ray.intersectObjects(meshes, false)[0]; return !hit || st.distance <= hit.distance + 0.01 ? st.object.userData.stickerId : null;
  }
  function click(e) {
    ray.setFromCamera(ndc(e), camera);
    const st = ray.intersectObjects(stickerGroup.children, false)[0], hit = ray.intersectObjects(meshes, false)[0];
    if (st && (!hit || st.distance <= hit.distance + 0.01)) { onSelect && onSelect(st.object.userData.stickerId); return; }
    if (!hit) return; onPick && onPick(describeHit(hit, ray.ray.direction));
  }
  function describeHit(hit, dir) {
    const nm = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
    const n = hit.face.normal.clone().applyMatrix3(nm).normalize(); if (n.dot(dir) > 0) n.negate();
    return { point: hit.point.toArray(), normal: n.toArray(), nodeId: hit.object.userData.nodeId, name: hit.object.userData.name, face: origFace(hit) };
  }
  /** The triangle's number in the model file. The search tree reorders the triangles it is built on, so look the hit's corners up in the original order. */
  function origFace(hit) {
    const g = hit.object.geometry, o = g.userData.origIndex; if (!o || !hit.face) return hit.faceIndex == null ? -1 : hit.faceIndex;
    if (!g.userData.firstOf) { // faces listed by their first corner
      const nv = g.attributes.position.count, start = new Int32Array(nv + 1), list = new Int32Array(o.length / 3);
      for (let i = 0; i < o.length; i += 3) start[o[i] + 1]++;
      for (let v = 0; v < nv; v++) start[v + 1] += start[v];
      const fill = start.slice(0, nv); for (let f = 0; f < list.length; f++) list[fill[o[f * 3]]++] = f;
      g.userData.firstOf = { start, list };
    }
    const { start, list } = g.userData.firstOf, { a, b, c } = hit.face;
    for (let k = start[a]; k < start[a + 1]; k++) { const f = list[k]; if (o[f * 3 + 1] === b && o[f * 3 + 2] === c) return f; }
    return -1;
  }
  /** Cast a ray at the model (for mirrored copies and nudging). */
  function castAt(point, dir, maxDist) {
    const r = new THREE.Raycaster(new THREE.Vector3(...point), new THREE.Vector3(...dir).normalize(), 0, maxDist || 1); r.firstHitOnly = true;
    const hit = r.intersectObjects(meshes, false)[0]; return hit ? describeHit(hit, r.ray.direction) : null;
  }

  /* ---------- loading a model ---------- */
  function clear() {
    for (const m of meshes) { (Array.isArray(m.material) ? m.material : [m.material]).forEach(x => { if (x.map) x.map.dispose(); x.dispose(); }); }
    root.clear(); meshes = []; needs = true;
    if (typeof extraGroup !== 'undefined') { extraGroup.traverse(o => { if (o.isMesh) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(x => { if (x.map) x.map.dispose(); x.dispose(); }); } }); extraGroup.clear(); }
  }
  /** A texture or model path as the game resolves it: mod-relative, or "$data/..." for the game's own files. */
  function refPath(from, ref) {
    if (!ref) return null; ref = ref.replace(/\\/g, '/');
    if (/^\$data\//i.test(ref)) return '$data/' + Core.normPath(ref.slice(6));
    if (ref.startsWith('$')) return null;
    if (/^\$data\//.test(from)) return '$data/' + Core.normPath(Core.dirOf(from.slice(6)) + ref);
    return Core.resolveRef(from, ref);
  }
  const vec = (s, d) => s ? s.trim().split(/\s+/).map(Number) : d;
  const SCENE = ['Shape', 'TransformGroup', 'Light', 'Camera', 'Dynamic', 'AudioSource'];
  /** Materials and shapes of one i3d file, and a builder that turns its nodes into 3D objects. */
  const TIRE_YELLOW = '0.8 0.55 0.05'; // the vehicle shader's unset colour
  function sceneOf(i3d, i3dPath, shapes, texJobs, slots) {
    const files = {}; for (const f of Core.findAll(i3d, e => e.tag === 'File')) files[f.attrs.fileId] = f.attrs.filename;
    const mats = {};
    for (const m of Core.findAll(i3d, e => e.tag === 'Material')) {
      const a = m.attrs, params = {}; for (const c of Core.kids(m, 'CustomParameter')) params[c.attrs.name] = c.attrs.value;
      const tex = Core.kids(m, 'Texture')[0], slot = slots && slots.get(a.name); let color = null, tint = null;
      if (params.colorMat0) { color = params.colorMat0.split(/\s+/).slice(0, 3).map(Number);
        if (params.colorMat0.startsWith(TIRE_YELLOW) && /tire|tyre|rubber/i.test((a.customShaderVariation || '') + ' ' + (a.name || ''))) color = [0.03, 0.03, 0.03]; } // rubber
      else if (params.colorScale) color = tint = params.colorScale.split(/\s+/).slice(0, 3).map(Number); // FS25 vehicle shader: tints the texture
      else if (a.diffuseColor) color = a.diffuseColor.split(/\s+/).slice(0, 3).map(Number);
      // FS25: a plain texture with a detail material on top; rubber is black whatever the base texture says
      const det = Core.kids(m, 'Custommap').find(c => c.attrs.name === 'detailDiffuse'), detName = det ? files[det.attrs.fileId] || '' : '';
      if (!params.colorScale && !params.colorMat0 && /rubber/i.test(detName)) color = tint = [0.025, 0.025, 0.025];
      if (slot && slot.color) color = tint = slot.color; // the shop's default colour for this paint slot
      const lin = c => new THREE.Color(c[0], c[1], c[2]).convertLinearToSRGB();
      const mat = new THREE.MeshLambertMaterial({ color: color ? lin(color) : new THREE.Color(0.62, 0.64, 0.6), side: THREE.DoubleSide, transparent: a.alphaBlending === 'true', alphaTest: a.alphaBlending === 'true' ? 0.05 : 0 });
      mat.userData.tint = tint ? lin(tint) : null;
      if (/mud|snow|dirt/i.test(files[a.customShaderId] || '')) mat.visible = false; // mud/snow shells only show when the vehicle is dirty
      const texRef = slot && slot.diffuse ? slot.diffuse : tex && files[tex.attrs.fileId];
      if (texRef && (!params.colorMat0 || (slot && slot.diffuse))) { const p = slot && slot.diffuse ? slot.diffuse : refPath(i3dPath, texRef); if (p) texJobs.push({ mat, path: Core.toDDS(p) }); }
      mats[a.materialId] = mat;
    }
    const geoCache = new Map();
    const geo = sid => {
      if (geoCache.has(sid)) return geoCache.get(sid);
      const g = shapes.get(sid); let bg = null;
      if (g) {
        bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(g.pos, 3));
        if (g.uv) bg.setAttribute('uv', new THREE.BufferAttribute(g.uv, 2));
        bg.setIndex(new THREE.BufferAttribute(g.nv > 65535 ? new Uint32Array(g.tris) : new Uint16Array(g.tris), 1));
        if (g.subsets && g.subsets.length > 1) g.subsets.forEach((s, k) => bg.addGroup(s.fi, s.ni, k));
        bg.computeVertexNormals(); bg.computeBoundingSphere();
      }
      geoCache.set(sid, bg); return bg;
    };
    /** One node (and everything under it) as 3D objects. pick: may stickers go on it; vis: visibility overrides by nodeId. */
    const build = (c, parent, { pick, vis, out, byNode }) => {
      const a = c.attrs, M = Core.mat(vec(a.translation, [0, 0, 0]), vec(a.rotation, [0, 0, 0]), vec(a.scale, [1, 1, 1]));
      let obj;
      const helper = a.nonRenderable === 'true' || a.trigger === 'true' || (/(^|_)(col|collision|trigger)/i.test(a.name || '') && (a.kinematic === 'true' || a.static === 'true' || a.dynamic === 'true' || a.collisionMask || a.collisionFilterGroup));
      if (c.tag === 'Shape' && a.shapeId && !helper && geo(+a.shapeId)) {
        const ids = (a.materialIds || '').split(',').map(x => x.trim()).filter(Boolean);
        const ms = ids.map(id => mats[id] || new THREE.MeshLambertMaterial({ color: 0x999999, side: THREE.DoubleSide }));
        obj = new THREE.Mesh(geo(+a.shapeId), ms.length > 1 ? ms : ms[0]);
        // bendy parts (hoses, belts) are drawn in their resting shape; stickers don't go on them
        obj.userData = { nodeId: pick && !a.skinBindNodeIds ? a.nodeId : null, name: a.name || '' }; out.push(obj);
      } else obj = new THREE.Group();
      obj.matrixAutoUpdate = false; obj.matrix.fromArray(M);
      const ov = vis && a.nodeId && vis.get(a.nodeId); obj.visible = ov && ov.visibility != null ? ov.visibility : a.visibility !== 'false';
      if (byNode && a.nodeId) byNode.set(a.nodeId, obj);
      parent.add(obj);
      for (const k of c.children) if (SCENE.includes(k.tag)) build(k, obj, { pick, vis, out, byNode });
      return obj;
    };
    return { build };
  }
  /** The node at an index path inside an i3d ("0|1|2", or "0>1|2"). */
  function nodeAt(i3d, path) {
    const sc = Core.find(i3d, 'Scene'); if (!sc || !path) return null;
    const parts = String(path).replace('>', '|').split('|').filter(x => x !== '').map(Number); let el = sc;
    for (const i of parts) { const kids = el.children.filter(k => SCENE.includes(k.tag)); el = kids[i]; if (!el) return null; }
    return el === sc ? null : el;
  }
  const isVisible = o => { while (o) { if (!o.visible) return false; o = o.parent; } return true; };
  let loadNo = 0, extraGroup = new THREE.Group(), touched = false; scene.add(extraGroup);
  /**
   * opts: { i3dPath, text, shapes:Map(shapeId->geom), files:Map(path->Uint8Array), getFile?(path) -> Promise<Uint8Array|null> (for "$data/..."),
   *         vis?: Map(nodeId -> {visibility}) (parts the shop's default choices show or hide), extras?: Promise<[...]> (wheels and other parts from other files) }
   */
  async function load(opts) {
    clear(); const token = ++loadNo; touched = false;
    const doc = Core.parseXML(opts.text), i3d = Core.find(doc, 'i3D') || doc, texJobs = [], all = [], byNode = new Map();
    const S0 = sceneOf(i3d, opts.i3dPath, opts.shapes, texJobs, opts.slots);
    const sc = Core.find(i3d, 'Scene'); if (sc) for (const c of sc.children) if (SCENE.includes(c.tag)) S0.build(c, root, { pick: true, vis: opts.vis, out: all, byNode });
    root.updateMatrixWorld(true);
    meshes = all.filter(m => m.userData.nodeId && isVisible(m));
    fit(); needs = true;
    if (BVH) { // a search tree per part, so clicks and drags don't test every triangle; built in small steps after the first frame
      const todo = [...new Set(meshes.map(m => m.geometry))];
      for (const m of meshes) m.raycast = BVH.acceleratedRaycast;
      (async () => { let t = performance.now(); for (const g of todo) { if (disposed || token !== loadNo || !g.index) continue; try { const keep = g.index.array.slice(); g.boundsTree = new BVH.MeshBVH(g); g.userData.origIndex = keep; } catch (e) { console.warn(e); }
        if (performance.now() - t > 30) { await new Promise(r => setTimeout(r, 0)); t = performance.now(); } } })();
    }
    const getBytes = async p => /^\$data\//.test(p) ? (opts.getFile ? await opts.getFile(p) : null) : opts.files.get(p);
    const loadTextures = async jobs => { // after the first frame
      for (const j of jobs) {
        if (disposed || token !== loadNo) return; let u8 = null; try { u8 = await getBytes(j.path); } catch (e) {} if (!u8) continue;
        await new Promise(r => setTimeout(r, 0));
        const r = Core.decodeDDS(u8, { maxSize: 512 }); if (r.error) continue;
        const c = document.createElement('canvas'); c.width = r.width; c.height = r.height; c.getContext('2d').putImageData(new ImageData(r.rgba, r.width, r.height), 0, 0);
        const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; j.mat.map = t; if (j.mat.userData.tint) j.mat.color.copy(j.mat.userData.tint); else j.mat.color.set(0xffffff); j.mat.needsUpdate = true; needs = true;
      }
    };
    const texDone = loadTextures(texJobs);
    // parts from other files (wheels): placed on a node of this model, never picked for stickers. Loads in the background.
    if (opts.extras) (async () => {
      let list = []; try { list = await opts.extras; } catch (e) { console.warn(e); }
      if (token !== loadNo || disposed) return;
      const jobs = [], scenes = new Map(), added = [];
      for (const x of list) {
        try {
          const anchor = byNode.get(x.anchorId); if (!anchor || !isVisible(anchor)) continue;
          if (!scenes.has(x.i3dPath)) { const d = Core.find(Core.parseXML(x.text), 'i3D'); scenes.set(x.i3dPath, { d, S: sceneOf(d, x.i3dPath, x.shapes, jobs) }); }
          const { d, S } = scenes.get(x.i3dPath), el = nodeAt(d, x.nodePath); if (!el) continue;
          // where the wheel sits: its node, moved as the default choice moves it, then along the axle
          const W = new THREE.Matrix4().copy(anchor.parent.matrixWorld).multiply(x.anchorLocal ? new THREE.Matrix4().fromArray(x.anchorLocal) : anchor.matrix);
          const pos = new THREE.Vector3().setFromMatrixPosition(W), inward = pos.x > 0 ? -1 : 1;
          if (x.inward) W.premultiply(new THREE.Matrix4().makeTranslation(inward * x.inward, 0, 0));
          const holder = new THREE.Group(); holder.matrixAutoUpdate = false; holder.matrix.copy(W); extraGroup.add(holder);
          const part = S.build(el, holder, { pick: false, out: added });
          const ps = vec(el.attrs.scale, [1, 1, 1]), sc2 = x.scale || ps;
          part.matrix.copy(new THREE.Matrix4().compose(new THREE.Vector3(), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, x.flip ? Math.PI : 0, 0)), new THREE.Vector3(...sc2)));
          part.visible = true;
        } catch (e) { console.warn('extra part', e); }
      }
      extraGroup.updateMatrixWorld(true); needs = true;
      if (!touched) fit();
      await texDone; await loadTextures(jobs);
    })().catch(e => console.warn(e));
  }
  function fit() {
    const box = new THREE.Box3(); for (const m of meshes) box.expandByObject(m);
    extraGroup.traverse(o => { if (o.isMesh && isVisible(o)) box.expandByObject(o); }); // wheels too
    if (box.isEmpty()) return; const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3()).length(); modelSize = s; modelCenter = c.toArray();
    orbit.target.copy(c); orbit.dist = s * 1.15; camera.near = Math.max(0.005, s / 2000); camera.far = s * 50; camera.updateProjectionMatrix(); placeCamera();
  }

  /* ---------- stickers ---------- */
  const texCache = new WeakMap(); let shown = new Map(); // key -> the objects drawn for it
  const dispose = o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); };
  function setStickers(list) { // [{id, key?, corners:[[x,y,z]x4] | mesh, logo:canvas, selected}]; items with an unchanged key are kept as they are
    const next = new Map(), keep = new Set();
    for (const s of list) if (s.key != null && shown.has(s.key) && !next.has(s.key)) { next.set(s.key, shown.get(s.key)); keep.add(s.key); }
    for (const [k, objs] of shown) if (!keep.has(k)) for (const o of objs) { stickerGroup.remove(o); dispose(o); }
    shown = next;
    for (const s of list) {
      if (!s.corners && !s.mesh) continue;
      if (s.key != null && keep.has(s.key)) { keep.delete(s.key); continue; }
      const before = stickerGroup.children.length;
      const g = new THREE.BufferGeometry();
      if (s.mesh) { // wrapped onto the surface
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(s.mesh.verts.flat()), 3));
        g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(s.mesh.uvs.flat()), 2)); g.setIndex(s.mesh.tris);
      } else {
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(s.corners.flat()), 3));
        g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2)); g.setIndex([0, 1, 2, 0, 2, 3]);
      }
      let t = texCache.get(s.logo); if (!t) { t = new THREE.CanvasTexture(s.logo); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; texCache.set(s.logo, t); }
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.02, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
      m.userData.stickerId = s.id; m.renderOrder = 2; stickerGroup.add(m);
      if (s.selected) {
        const edge = s.mesh ? new THREE.LineSegments(new THREE.EdgesGeometry(g, 1), new THREE.LineBasicMaterial({ color: 0xe5a040 })) : null;
        const e = edge || new THREE.LineLoop(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(s.corners.flat()), 3)), new THREE.LineBasicMaterial({ color: 0xe5a040 }));
        if (edge) { // only the outline, not every fold: keep edges that belong to one triangle
          const cnt = new Map(), t = s.mesh.tris, V = s.mesh.verts, k = i => V[i].map(c => Math.round(c * 1e4)).join(','), out = [];
          for (let i = 0; i < t.length; i += 3) for (const [a, b] of [[t[i], t[i + 1]], [t[i + 1], t[i + 2]], [t[i + 2], t[i]]]) { const ka = k(a), kb = k(b), key = ka < kb ? ka + '|' + kb : kb + '|' + ka; const c = cnt.get(key); cnt.set(key, c ? [c[0] + 1, a, b] : [1, a, b]); }
          for (const [n, a, b] of cnt.values()) if (n === 1) out.push(...V[a], ...V[b]);
          e.geometry.dispose(); e.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(out), 3));
        }
        e.renderOrder = 3; stickerGroup.add(e);
      }
      const objs = stickerGroup.children.slice(before), k = s.key != null ? s.key : Symbol();
      if (shown.has(k)) shown.get(k).push(...objs); else shown.set(k, objs);
    }
    needs = true;
  }
  /** World-space triangles of one part (for wrapping stickers onto it). */
  function meshData(nodeId) {
    const m = meshes.find(x => x.userData.nodeId === nodeId); if (!m || !m.geometry.index) return null;
    const src = m.geometry.attributes.position, pos = new Float32Array(src.count * 3), v = new THREE.Vector3();
    for (let i = 0; i < src.count; i++) { v.fromBufferAttribute(src, i).applyMatrix4(m.matrixWorld); pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z; }
    return { pos, tris: m.geometry.index.array };
  }
  function worldMatrixOf(nodeId) { for (const m of meshes) if (m.userData.nodeId === nodeId) return m.matrixWorld.toArray(); return null; }
  function focus(point) { orbit.target.set(...point); placeCamera(); }

  /* ---------- render loop ---------- */
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
    if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); needs = true; }
  }
  function frame() { if (disposed) return; resize(); if (needs) { scene.background = new THREE.Color(bg); renderer.render(scene, camera); needs = false; } requestAnimationFrame(frame); }
  requestAnimationFrame(frame);
  placeCamera();
  return {
    load, setStickers, castAt, worldMatrixOf, meshData, focus, fit,
    set onPick(f) { onPick = f; }, set onSelect(f) { onSelect = f; }, set onDrag(f) { onDrag = f; }, set onDragEnd(f) { onDragEnd = f; },
    get modelSize() { return modelSize; }, get modelCenter() { return modelCenter; },
    setBackground(c) { bg = c; needs = true; },
    snapshot() { renderer.render(scene, camera); return canvas.toDataURL('image/png'); },
    /** Render the current view at w×h with a see-through background; returns a 2D canvas. */
    snapshotAt(w, h, o = {}) { // o.fit: frame the whole model, as the shop picture does (same angle as the view)
      const pr = renderer.getPixelRatio(), cw = canvas.clientWidth, ch = canvas.clientHeight, oldBg = scene.background;
      renderer.setPixelRatio(1); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
      const saved = { t: orbit.target.clone(), d: orbit.dist };
      if (o.fit) {
        const box = new THREE.Box3(); for (const m of meshes) box.expandByObject(m); extraGroup.traverse(x => { if (x.isMesh && isVisible(x)) box.expandByObject(x); });
        root.traverse(x => { if (x.isMesh && isVisible(x) && !meshes.includes(x)) box.expandByObject(x); });
        if (!box.isEmpty()) {
          const pts = []; for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) pts.push(new THREE.Vector3(x, y, z));
          orbit.target.copy(box.getCenter(new THREE.Vector3())); placeCamera();
          const margin = o.margin || 0.9, th = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
          for (let i = 0; i < 4; i++) { // pull back or in until the box fills the frame, then centre it
            camera.updateMatrixWorld(); let x0 = 1, x1 = -1, y0 = 1, y1 = -1;
            for (const p of pts) { const q = p.clone().project(camera); x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
            const ext = Math.max((x1 - x0) / 2, (y1 - y0) / 2), right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0), up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
            orbit.target.addScaledVector(right, (x0 + x1) / 2 * orbit.dist * th * camera.aspect).addScaledVector(up, (y0 + y1) / 2 * orbit.dist * th);
            orbit.dist *= ext / margin; placeCamera();
          }
        }
      }
      scene.background = null; renderer.setClearColor(0x000000, 0);
      const out = document.createElement('canvas'); out.width = w; out.height = h; const og = out.getContext('2d', { willReadFrequently: !!o.fit });
      const shoot = () => { renderer.render(scene, camera); og.clearRect(0, 0, w, h); og.drawImage(canvas, 0, 0, w, h); };
      shoot();
      if (o.fit) for (let pass = 0; pass < 2; pass++) { // the box is bigger than the vehicle: measure what was drawn and frame that
        const d = og.getImageData(0, 0, w, h).data; let x0 = w, x1 = -1, y0 = h, y1 = -1;
        for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (d[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        if (x1 < 0) break;
        const th = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2), right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0), up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
        const cx = ((x0 + x1) / 2 / w) * 2 - 1, cy = 1 - ((y0 + y1) / 2 / h) * 2, ext = Math.max((x1 - x0 + 2) / w, (y1 - y0 + 2) / h);
        orbit.target.addScaledVector(right, cx * orbit.dist * th * camera.aspect).addScaledVector(up, cy * orbit.dist * th);
        orbit.dist *= ext / (o.margin || 0.9); placeCamera(); camera.updateMatrixWorld(); shoot();
      }
      if (o.fit) { orbit.target.copy(saved.t); orbit.dist = saved.d; placeCamera(); }
      scene.background = oldBg; renderer.setPixelRatio(pr); renderer.setSize(cw, ch, false); camera.aspect = cw / ch; camera.updateProjectionMatrix(); needs = true;
      return out;
    },
    dispose() { disposed = true; clear(); renderer.dispose(); },
  };
}
window.FDSViewer = FDSViewer;
})();
