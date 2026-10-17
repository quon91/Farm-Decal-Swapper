/* Farm Decal Swapper — 3D model view for placing stickers. Uses three.js (global THREE) and Core. */
(() => {
'use strict';

function FDSViewer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputEncoding = THREE.sRGBEncoding;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 2000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445544, 0.85));
  const sun = new THREE.DirectionalLight(0xffffff, 0.75); camera.add(sun); sun.position.set(0.4, 0.8, 0.3); scene.add(camera);
  const root = new THREE.Group(); scene.add(root);
  const stickerGroup = new THREE.Group(); scene.add(stickerGroup);
  let meshes = [], disposed = false, needs = true, onPick = null, onSelect = null, onDrag = null, bg = '#d9ded3', modelSize = 0;
  const ray = new THREE.Raycaster();

  /* ---------- orbit camera ---------- */
  const orbit = { target: new THREE.Vector3(), dist: 10, yaw: Math.PI * 0.75, pitch: 0.35 };
  function placeCamera() {
    const cp = Math.cos(orbit.pitch);
    camera.position.set(orbit.target.x + orbit.dist * cp * Math.sin(orbit.yaw), orbit.target.y + orbit.dist * Math.sin(orbit.pitch), orbit.target.z + orbit.dist * cp * Math.cos(orbit.yaw));
    camera.lookAt(orbit.target); needs = true;
  }
  let drag = null;
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => {
    drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, pan: e.button === 2 || e.shiftKey, moved: false, sticker: null };
    if (e.button === 0 && !e.shiftKey) { const st = stickerAt(e); if (st) drag.sticker = st; } // left-drag on a sticker moves it
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) { canvas.style.cursor = stickerAt(e) ? 'grab' : ''; return; }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
    if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 4) drag.moved = true;
    if (drag.sticker) {
      if (!drag.moved) return; canvas.style.cursor = 'grabbing';
      ray.setFromCamera(ndc(e), camera); const hit = ray.intersectObjects(meshes, false)[0];
      if (hit && onDrag) onDrag(drag.sticker, describeHit(hit, ray.ray.direction));
      return;
    }
    if (drag.pan) {
      const s = orbit.dist * 0.0018, right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0), up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
      orbit.target.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
    } else { orbit.yaw -= dx * 0.008; orbit.pitch = Math.max(-1.5, Math.min(1.5, orbit.pitch + dy * 0.008)); }
    placeCamera();
  });
  canvas.addEventListener('pointerup', e => { const d = drag; drag = null; canvas.style.cursor = ''; if (d && !d.moved && e.button === 0) click(e); });
  canvas.addEventListener('wheel', e => { e.preventDefault(); orbit.dist = Math.max(0.2, Math.min(500, orbit.dist * Math.exp(e.deltaY * 0.0012))); placeCamera(); }, { passive: false });

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
    return { point: hit.point.toArray(), normal: n.toArray(), nodeId: hit.object.userData.nodeId, name: hit.object.userData.name };
  }
  /** Cast a ray at the model (for mirrored copies and nudging). */
  function castAt(point, dir, maxDist) {
    const r = new THREE.Raycaster(new THREE.Vector3(...point), new THREE.Vector3(...dir).normalize(), 0, maxDist || 1);
    const hit = r.intersectObjects(meshes, false)[0]; return hit ? describeHit(hit, r.ray.direction) : null;
  }

  /* ---------- loading a model ---------- */
  function clear() {
    for (const m of meshes) { (Array.isArray(m.material) ? m.material : [m.material]).forEach(x => { if (x.map) x.map.dispose(); x.dispose(); }); }
    root.clear(); meshes = []; needs = true;
  }
  /**
   * opts: { i3dPath, text, shapes:Map(shapeId->geom), files:Map(path->Uint8Array), onStatus }
   */
  async function load(opts) {
    clear();
    const doc = Core.parseXML(opts.text), i3d = Core.find(doc, 'i3D') || doc;
    const files = {}; for (const f of Core.findAll(i3d, e => e.tag === 'File')) files[f.attrs.fileId] = f.attrs.filename;
    const mats = {}, texJobs = [];
    for (const m of Core.findAll(i3d, e => e.tag === 'Material')) {
      const a = m.attrs, params = {}; for (const c of Core.kids(m, 'CustomParameter')) params[c.attrs.name] = c.attrs.value;
      const tex = Core.kids(m, 'Texture')[0]; let color = null;
      if (params.colorMat0) color = params.colorMat0.split(/\s+/).slice(0, 3).map(Number);
      else if (params.colorScale) color = params.colorScale.split(/\s+/).slice(0, 3).map(Number); // FS25 vehicle shader
      else if (a.diffuseColor) color = a.diffuseColor.split(/\s+/).slice(0, 3).map(Number);
      const mat = new THREE.MeshLambertMaterial({ color: color ? new THREE.Color(color[0], color[1], color[2]).convertLinearToSRGB() : new THREE.Color(0.62, 0.64, 0.6), side: THREE.DoubleSide, transparent: a.alphaBlending === 'true', alphaTest: a.alphaBlending === 'true' ? 0.05 : 0 });
      if (tex && !params.colorMat0) { const ref = files[tex.attrs.fileId]; const path = ref && !ref.startsWith('$') ? Core.toDDS(Core.resolveRef(opts.i3dPath, ref)) : null; if (path) texJobs.push({ mat, path }); }
      mats[a.materialId] = mat;
    }
    const geoCache = new Map();
    const geo = sid => {
      if (geoCache.has(sid)) return geoCache.get(sid);
      const g = opts.shapes.get(sid); let bg = null;
      if (g) {
        bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(g.pos, 3));
        if (g.uv) bg.setAttribute('uv', new THREE.BufferAttribute(g.uv, 2));
        bg.setIndex(new THREE.BufferAttribute(g.nv > 65535 ? new Uint32Array(g.tris) : new Uint16Array(g.tris), 1));
        if (g.subsets && g.subsets.length > 1) g.subsets.forEach((s, k) => bg.addGroup(s.fi, s.ni, k));
        bg.computeVertexNormals(); bg.computeBoundingSphere();
      }
      geoCache.set(sid, bg); return bg;
    };
    const vec = (s, d) => s ? s.trim().split(/\s+/).map(Number) : d;
    const walk = (el, parent) => {
      for (const c of el.children) {
        if (!['Shape', 'TransformGroup', 'Light', 'Camera', 'Dynamic', 'AudioSource'].includes(c.tag)) continue;
        const a = c.attrs, M = Core.mat(vec(a.translation, [0, 0, 0]), vec(a.rotation, [0, 0, 0]), vec(a.scale, [1, 1, 1]));
        let obj;
        const helper = a.nonRenderable === 'true' || a.trigger === 'true' || (/(^|_)(col|collision|trigger)/i.test(a.name || '') && (a.kinematic === 'true' || a.static === 'true' || a.dynamic === 'true' || a.collisionMask || a.collisionFilterGroup));
        if (c.tag === 'Shape' && a.shapeId && !helper && !a.skinBindNodeIds && geo(+a.shapeId)) {
          const ids = (a.materialIds || '').split(',').map(x => x.trim()).filter(Boolean);
          const ms = ids.map(id => mats[id] || new THREE.MeshLambertMaterial({ color: 0x999999, side: THREE.DoubleSide }));
          obj = new THREE.Mesh(geo(+a.shapeId), ms.length > 1 ? ms : ms[0]);
          obj.userData = { nodeId: a.nodeId, name: a.name || '' }; meshes.push(obj);
        } else obj = new THREE.Group();
        obj.matrixAutoUpdate = false; obj.matrix.fromArray(M); obj.visible = a.visibility !== 'false';
        parent.add(obj); walk(c, obj);
      }
    };
    const sc = Core.find(i3d, 'Scene'); if (sc) walk(sc, root);
    root.updateMatrixWorld(true);
    meshes = meshes.filter(m => { let o = m; while (o) { if (!o.visible) return false; o = o.parent; } return true; });
    fit(); needs = true;
    // textures load after the first frame
    for (const j of texJobs) {
      if (disposed) return; const u8 = opts.files.get(j.path); if (!u8) continue;
      await new Promise(r => setTimeout(r, 0));
      const r = Core.decodeDDS(u8, { maxSize: 512 }); if (r.error) continue;
      const c = document.createElement('canvas'); c.width = r.width; c.height = r.height; c.getContext('2d').putImageData(new ImageData(r.rgba, r.width, r.height), 0, 0);
      const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; j.mat.map = t; j.mat.color.set(0xffffff); j.mat.needsUpdate = true; needs = true;
    }
  }
  function fit() {
    const box = new THREE.Box3(); for (const m of meshes) box.expandByObject(m);
    if (box.isEmpty()) return; const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3()).length(); modelSize = s;
    orbit.target.copy(c); orbit.dist = s * 1.15; camera.near = Math.max(0.005, s / 2000); camera.far = s * 50; camera.updateProjectionMatrix(); placeCamera();
  }

  /* ---------- stickers ---------- */
  const texCache = new WeakMap();
  function setStickers(list) { // [{id, corners:[[x,y,z]x4], logo:canvas, selected}]
    stickerGroup.clear();
    for (const s of list) {
      if (!s.corners) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(s.corners.flat()), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      let t = texCache.get(s.logo); if (!t) { t = new THREE.CanvasTexture(s.logo); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; texCache.set(s.logo, t); }
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.02, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
      m.userData.stickerId = s.id; m.renderOrder = 2; stickerGroup.add(m);
      if (s.selected) { const e = new THREE.LineLoop(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(s.corners.flat()), 3)), new THREE.LineBasicMaterial({ color: 0xe5a040 })); e.renderOrder = 3; stickerGroup.add(e); }
    }
    needs = true;
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
    load, setStickers, castAt, worldMatrixOf, focus, fit,
    set onPick(f) { onPick = f; }, set onSelect(f) { onSelect = f; }, set onDrag(f) { onDrag = f; },
    get modelSize() { return modelSize; },
    setBackground(c) { bg = c; needs = true; },
    snapshot() { renderer.render(scene, camera); return canvas.toDataURL('image/png'); },
    dispose() { disposed = true; clear(); renderer.dispose(); },
  };
}
window.FDSViewer = FDSViewer;
})();
