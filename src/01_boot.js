/* ============ 01 boot / core helpers ============ */
const T = THREE;

const canvasEl = document.getElementById('scene');
const renderer = new T.WebGLRenderer({ canvas: canvasEl, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputEncoding = T.sRGBEncoding;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
renderer.setClearColor(0x090c17, 1);

const scene = new T.Scene();
const camera = new T.PerspectiveCamera(32, 1, 0.5, 300);

/* ---- backdrop ---- */
(function backdrop() {
  const geo = new T.CylinderGeometry(90, 90, 90, 48, 1, true);
  const mat = new T.ShaderMaterial({
    side: T.BackSide, depthWrite: false, fog: false,
    uniforms: {},
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader:
      'varying vec3 vP;' +
      'void main(){' +
      '  float h = clamp((vP.y + 45.0) / 90.0, 0.0, 1.0);' +
      '  vec3 low  = vec3(0.075, 0.098, 0.176);' +
      '  vec3 mid  = vec3(0.055, 0.070, 0.130);' +
      '  vec3 high = vec3(0.030, 0.040, 0.078);' +
      '  vec3 c = mix(low, mid, smoothstep(0.0, 0.42, h));' +
      '  c = mix(c, high, smoothstep(0.40, 1.0, h));' +
      '  float glow = pow(max(0.0, 1.0 - abs(h - 0.30) * 5.5), 2.0);' +
      '  c += vec3(0.055, 0.045, 0.030) * glow;' +
      '  gl_FragColor = vec4(c, 1.0);' +
      '}'
  });
  const m = new T.Mesh(geo, mat);
  m.frustumCulled = false;
  scene.add(m);
})();

/* ---- toon ramp ---- */
function toonRamp(stops) {
  const c = document.createElement('canvas');
  c.width = stops.length; c.height = 1;
  const g = c.getContext('2d');
  stops.forEach(function (v, i) { g.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')'; g.fillRect(i, 0, 1, 1); });
  const t = new T.CanvasTexture(c);
  t.minFilter = T.NearestFilter; t.magFilter = T.NearestFilter; t.generateMipmaps = false;
  t.encoding = T.LinearEncoding;
  return t;
}
const RAMP = toonRamp([86, 146, 206, 255]);
const RAMP_SOFT = toonRamp([118, 176, 222, 255]);

/* ---- material factories ---- */
const _mcache = {};
function toon(color, o) {
  o = o || {};
  var key = 't' + color + '|' + (o.soft ? 1 : 0) + '|' + (o.opacity === undefined ? 1 : o.opacity) + '|' + (o.map ? o.map.uuid : '') + '|' + (o.emissiveMap ? o.emissiveMap.uuid : '') + '|' + (o.emissive || 0) + '|' + (o.ei === undefined ? 1 : o.ei);
  if (_mcache[key]) return _mcache[key];
  var p = { color: color, gradientMap: o.soft ? RAMP_SOFT : RAMP };
  if (o.map) { p.map = o.map; }
  if (o.opacity !== undefined) p.opacity = o.opacity;
  if (o.emissiveMap) {
    p.emissiveMap = o.emissiveMap;
    p.emissive = o.emissive === undefined ? 0xffffff : o.emissive;
    p.emissiveIntensity = o.ei === undefined ? 1 : o.ei;
  } else if (o.emissive) { p.emissive = o.emissive; p.emissiveIntensity = o.ei === undefined ? 1 : o.ei; }
  var m = new T.MeshToonMaterial(p);
  if (o.side) m.side = o.side;
  if (o.opacity !== undefined) { m.transparent = true; m.depthWrite = o.opacity > 0.9; }
  _mcache[key] = m;
  return m;
}
function basic(color, o) {
  o = o || {};
  var key = 'b' + color + '|' + (o.opacity === undefined ? 1 : o.opacity) + '|' + (o.map ? o.map.uuid : '') + '|' + (o.add ? 1 : 0) + '|' + (o.side || 0) + '|' + (o.depthWrite === false ? 0 : 1);
  if (_mcache[key]) return _mcache[key];
  var p = { color: color };
  if (o.map) p.map = o.map;
  if (o.opacity !== undefined) { p.opacity = o.opacity; p.transparent = true; }
  if (o.side) p.side = o.side;
  if (o.depthWrite === false) p.depthWrite = false;
  if (o.add) { p.blending = T.AdditiveBlending; p.depthWrite = false; }
  var m = new T.MeshBasicMaterial(p);
  _mcache[key] = m;
  return m;
}
function uniq(mat) { var c = mat.clone(); return c; }

/* ---- outline shell ---- */
const OUTLINE_COLOR = 0x0e1424;
const _omat = {};
function outlineMat(color, opacity) {
  var key = 'o' + color + (opacity === undefined ? 1 : opacity);
  if (_omat[key]) return _omat[key];
  var m = new T.MeshBasicMaterial({ color: color, side: T.BackSide });
  if (opacity !== undefined && opacity < 1) { m.transparent = true; m.opacity = opacity; }
  _omat[key] = m;
  return m;
}
function addOutline(mesh, w, color) {
  var g = mesh.geometry;
  if (!g.boundingBox) g.computeBoundingBox();
  var bb = g.boundingBox;
  var cx = (bb.max.x + bb.min.x) / 2;
  var cy = (bb.max.y + bb.min.y) / 2;
  var cz = (bb.max.z + bb.min.z) / 2;
  var sx = Math.max(bb.max.x - bb.min.x, 0.0001);
  var sy = Math.max(bb.max.y - bb.min.y, 0.0001);
  var sz = Math.max(bb.max.z - bb.min.z, 0.0001);
  w = w === undefined ? 0.045 : w;
  var kx = Math.min(1 + (w * 2) / sx, 1.6);
  var ky = Math.min(1 + (w * 2) / sy, 1.6);
  var kz = Math.min(1 + (w * 2) / sz, 1.6);
  var o = new T.Mesh(g, outlineMat(color === undefined ? OUTLINE_COLOR : color));
  /* The hull MUST be inflated about the geometry's own centre, not about the
     mesh origin.  prismAt()/seg() bake world coordinates straight into the
     vertex data, so such a mesh keeps position (0,0,0) while its geometry
     lives metres away.  Scaling a child mesh then scales about the WORLD
     origin: the roof slab (0.22 m thick, centred at y=4.16) got ky = 1.409
     and its hull floated up to y=6.02 — a 10.7 x 9.9 m plate hovering 1.75 m
     above the building, which is exactly the "floating table" that dominated
     every render.  p = c * (1 - k) puts the scaled copy back on centre.      */
  o.scale.set(kx, ky, kz);
  o.position.set(cx * (1 - kx), cy * (1 - ky), cz * (1 - kz));
  o.castShadow = false; o.receiveShadow = false;
  o.userData.isOutline = true;
  mesh.add(o);
  return o;
}

/* ---- generic mesh helpers ---- */
function addMesh(parent, geo, mat, o) {
  o = o || {};
  var m = new T.Mesh(geo, mat);
  m.position.set(o.x || 0, o.y || 0, o.z || 0);
  if (o.rx !== undefined || o.ry !== undefined || o.rz !== undefined) m.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0);
  if (o.sx || o.sy || o.sz) m.scale.set(o.sx || 1, o.sy || 1, o.sz || 1);
  m.castShadow = o.cast !== false;
  m.receiveShadow = o.recv !== false;
  if (o.order !== undefined) m.renderOrder = o.order;
  parent.add(m);
  if (o.outline !== false) addOutline(m, o.ow, o.oc);
  return m;
}
function boxW(parent, mat, w, h, d, x, y, z, o) {
  return addMesh(parent, new T.BoxGeometry(w, h, d), mat, Object.assign({ x: x, y: y, z: z }, o || {}));
}
function cylW(parent, mat, rt, rb, h, x, y, z, seg, o) {
  return addMesh(parent, new T.CylinderGeometry(rt, rb, h, seg || 12, 1), mat, Object.assign({ x: x, y: y, z: z }, o || {}));
}
function planeW(parent, mat, w, h, x, y, z, o) {
  return addMesh(parent, new T.PlaneGeometry(w, h), mat, Object.assign({ x: x, y: y, z: z }, o || {}));
}
function group(parent, x, y, z) {
  var g = new T.Group();
  g.position.set(x || 0, y || 0, z || 0);
  (parent || scene).add(g);
  return g;
}
function vec(x, y, z) { return new T.Vector3(x, y, z); }

/* line-based builder: a slab along A->B */
function alongGeo(A, B, opts) {
  var dx = B.x - A.x, dz = B.z - A.z;
  var L = Math.sqrt(dx * dx + dz * dz);
  var ux = dx / L, uz = dz / L;
  var a = L * opts.t0, b = L * opts.t1;
  var cx = A.x + ux * (a + b) / 2, cz = A.z + uz * (a + b) / 2;
  var len = b - a;
  var nrm = opts.out || [0, 1];
  var off = opts.off || 0;
  return {
    geo: new T.BoxGeometry(len, opts.y1 - opts.y0, opts.thick === undefined ? 0.28 : opts.thick),
    x: cx + nrm[0] * off,
    y: (opts.y0 + opts.y1) / 2,
    z: cz + nrm[1] * off,
    ry: Math.atan2(-uz, ux)
  };
}
function seg(parent, A, B, opts) {
  var r = alongGeo(A, B, opts);
  var o = Object.assign({ x: r.x, y: r.y, z: r.z, ry: r.ry }, opts.o || {});
  /* seg() used to forward ONLY opts.o to addMesh, so an `outline: false` written
     directly on the seg options was silently dropped and every single call got
     an inverted-hull shell anyway.  That put a dark shell around all five
     glazing panes, the interior lining strips, the transom rails and the brand
     stripes — the shopfront was walled off by its own outlines.  Forward the
     flags explicitly. */
  if (o.outline === undefined && opts.outline !== undefined) o.outline = opts.outline;
  if (o.ow === undefined && opts.ow !== undefined) o.ow = opts.ow;
  if (o.oc === undefined && opts.oc !== undefined) o.oc = opts.oc;
  return addMesh(parent, r.geo, opts.mat, o);
}
function segNo(parent, A, B, opts) { opts.outline = false; return seg(parent, A, B, opts); }

/* utility: random with seed-ish determinism */
let _seed = 20261007;
function rnd() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }
function rr(a, b) { return a + (b - a) * rnd(); }
function pick(arr) { return arr[Math.floor(rnd() * arr.length) % arr.length]; }

/* ---- lights ---- */
const AMB = new T.AmbientLight(0x2e3a5e, 0.22);
scene.add(AMB);
const HEMI = new T.HemisphereLight(0x54699c, 0x191e2c, 0.18);
scene.add(HEMI);

const MOON = new T.DirectionalLight(0xa8c2ff, 0.30);
MOON.position.set(-16, 22, -12);
MOON.castShadow = true;
MOON.shadow.mapSize.width = 2048;
MOON.shadow.mapSize.height = 2048;
MOON.shadow.camera.left = -17; MOON.shadow.camera.right = 17;
MOON.shadow.camera.top = 17; MOON.shadow.camera.bottom = -17;
MOON.shadow.camera.near = 1; MOON.shadow.camera.far = 70;
MOON.shadow.bias = -0.0009;
MOON.shadow.normalBias = 0.02;
scene.add(MOON);

const RIM = new T.DirectionalLight(0x6f8cc9, 0.10);
RIM.position.set(13, 7, 15);
scene.add(RIM);

/* ---- deterministic freeze + variant toggle (MEASUREMENT ONLY) ----
   The scene runs two independent rAF loops -- 06's animate() drives T0 from
   clock.getDelta() and owns renderer.render(); 07's tick() drives WIND, DRIPS,
   RIPPLES and the camera controller off performance.now().  A paired A/B render
   needs the state to be bit-identical between the two exposures, and neither
   loop can be frozen by pausing one of them:

     FREEZE.on -> 06 passes dt = 0, so T0 stops advancing and every shader
                  uniform keyed to time (RAIN.uTime, DRIPS.uTime, GLASS_FX,
                  RIPPLES.uTime via 07) holds its value;
                -> 07 returns before doing anything, so positions, births,
                  wind, run-off offsets and the camera stop moving.

   GPT r11 section 2 is the reason this exists: "四张图从同一状态渲染，切换
   开关不能推进动画".  The honest limit of this version is that it freezes a
   state but does not make that state reproducible run-to-run -- Math.random()
   still seeds emissions.  A paired A/B does not need reproducibility, only
   immobility, so the pair below is valid; a cross-run comparison is not, and
   any report built on it has to say so. */
window.FREEZE = { on: false };
/* Declared roles, never inferred: an audit must not have to recognise the new
   pole fittings by geometry or colour. */
function setRoleVisible(role, v) {
  let n = 0;
  scene.traverse(function (o) {
    if (o.userData && o.userData.role === role) { o.visible = v; n++; }
  });
  return n;
}
window.__toggle = setRoleVisible;
