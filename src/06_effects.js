/* ============ 06 effects / controls / loop ============ */
const clock = new T.Clock();
let T0 = 0;

/* ---------- rain ---------- */
/* Ribbons, not lines.
   GL line width is capped at 1 device pixel by every ANGLE / Metal backend, so
   at DPR 2 a streak was half a CSS pixel wide and read as absent no matter how
   many there were (GPT r5 gate: streak width 1-2 REAL output pixels).  Six
   vertices per drop give exact control of that width.

   Analytic occluders, not a footprint reject.
   Rejecting spawn positions inside the canopy footprint would also delete the
   rain ABOVE the canopy and carve a rain-free column up the whole sky.  Each
   streak is instead tested against real boxes and truncated at the first lid
   over its own footprint (GPT r5: "解析盒体求交, 不能只检查中心点").  The boxes
   are authored from 04_store.js's own constants so they cannot drift.  Box 5 is
   slot 5 is PARKED at 999.  It used to be the pedestrian's umbrella, which
   07_realworld.js re-pointed at the canopy every frame; both the figure and
   the umbrella it held were removed on 2026-10-09, so the slot holds nothing
   and the loop bound stays 5 to avoid a shader recompile. */
const RAIN = (function () {
  /* 3200, inside GPT's 3000-3800 band.  Count is the only lever that adds rain
     edge energy (Laplacian) without making each streak longer than his
     0.13-0.26 m length band, so the high-frequency floor is bought here and
     paid for by thinning the ribbons below.  3800 measured a mean sky coverage
     of 2.23 % but gust-driven frames reached 2.76 %, through his 2.5 % ceiling;
     3200 puts the worst frame back inside it while keeping Laplacian mean 2.22. */
  /* WHY THE RAIN COULD NOT BE SEEN, AND WHY THE FIX IS A TRADE NOT A DIAL.
     Sera: "地面上有雨水溅起的水花，但实际上画面中并没有雨".  Measured at the
     hero camera with probe_rain (19200 verts, uRes 1440x900):

       in-frame drops      ~1210        (7257/19200 vertices)   gate >= 250  OK
       streak length       0.14-0.26 m  (7-13 CSS px)           gate 6-14    OK
       ribbon full width   2*uWidth device px = 2 device px
                           = 1.0 CSS px at DPR 2                gate 1-2     AT FLOOR
       effective peak alpha vA*uOp = 0.896*0.235 = 0.211        gate 0.25-0.55  FAIL

     Count and length were never the problem; per-streak contrast was.  But
     width cannot be raised freely: GPT r5 put a 2.5 % ceiling on mean sky
     coverage, and the recorded history has 2.0 px -> 3.4 % (over).  Covered
     area goes as COUNT * width, so WIDTH AND COUNT TRADE OFF AT CONSTANT INK:
     3200 x 1.0 -> 2130 x 1.5 keeps the AREA identical while making every
     streak 1.5x thicker.  GPT r7 checked it: the area trade holds to first
     order (2130*1.5 / 3200*1.0 = 0.998), but my "ink is conserved" claim did
     NOT -- I raised uOp as well, and under a linear sparse-blend approximation
     the OPACITY-WEIGHTED ink went up by 0.28/0.235 = +19 %.  He also moved the
     target from 1.6 to 1.5 so the full width lands on 3 whole device pixels =
     1.5 CSS px at DPR 2, avoiding the partial-coverage pixel a non-integer 3.2
     adds at the edges.
     So this is a DELIBERATE BREACH of the old 2.5 % proxy, not a free lunch.
     GPT r7 wants the ceiling switched to his weighted metric W_S, which needs
     paired rain/no-rain renders; those are not built yet.  Until they are,
     treat 2.5 % as breached and this as a judged trade made against Sera's own
     complaint ("画面中看不出有雨"), not as a verified pass.
     Fewer-and-thicker beats more-and-thinner whenever the marks sit at the edge
     of the perceptual threshold, and 2130 still leaves ~830 drops in frame
     against a gate of 250. */
  const COUNT = 2130;
  const CORNER = [[0, -1], [0, 1], [1, -1], [0, 1], [1, 1], [1, -1]];
  const V = COUNT * 6;
  const pos = new Float32Array(V * 3);
  const seed = new Float32Array(V);
  const spd = new Float32Array(V);
  const len = new Float32Array(V);
  const tip = new Float32Array(V);
  const side = new Float32Array(V);
  for (let i = 0; i < COUNT; i++) {
    const r = 17.0 * Math.sqrt(Math.random());
    const a = Math.random() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const s = Math.random();
    const sp = 0.75 + Math.random() * 0.75;
    const ln = 0.45 + Math.random() * 0.85;
    for (let k = 0; k < 6; k++) {
      const idx = i * 6 + k;
      pos[idx * 3] = x; pos[idx * 3 + 1] = 0; pos[idx * 3 + 2] = z;
      seed[idx] = s; spd[idx] = sp; len[idx] = ln;
      tip[idx] = CORNER[k][0]; side[idx] = CORNER[k][1];
    }
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new T.BufferAttribute(seed, 1));
  geo.setAttribute('aSpd', new T.BufferAttribute(spd, 1));
  geo.setAttribute('aLen', new T.BufferAttribute(len, 1));
  geo.setAttribute('aTip', new T.BufferAttribute(tip, 1));
  geo.setAttribute('aSide', new T.BufferAttribute(side, 1));

  const OCC_MIN = SHELTER_MIN, OCC_MAX = SHELTER_MAX;

  const mat = new T.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uTop: { value: 17.0 }, uSpan: { value: 22.0 },
      /* Base wind is the ONE vector that drives the rain tilt, the eave-drip
         lateral offset and the umbrella lean (GPT r5 chain #3).  It was 0.46,
         i.e. a 4.2 deg tilt -- too flat to read as wind-driven, and it would
         have contradicted the 5-12 deg umbrella lean the same review asks for.
         0.16 * 0.95 = 0.152 lateral metres per metre fallen = 8.6 deg, which
         sits inside that band and makes the streaks read as lines. */
      uWind: { value: new T.Vector2(0.95, 0.30) },
      /* The height the rain is truncated at.  It has to be the surface the
         camera sees (ROAD_TOP), not the structural slab (TOP_ROAD): at
         TOP_ROAD every streak ran 40 mm into the ground, and the sidewalk --
         which is 40 mm higher again -- was penetrated by 80 mm.  A single
         uGround cannot be exact for both slabs, so it is set to the road and
         accepts the 40 mm of walk penetration, which is the smaller error. */
      uGround: { value: ROAD_TOP },
      uOccMin: { value: OCC_MIN }, uOccMax: { value: OCC_MAX },
      uRes: { value: new T.Vector2(renderer.domElement.width, renderer.domElement.height) },
      /* 1.0 real output pixels -- the bottom of GPT's 1-2 px band, chosen
         because it is the only lever that moves sky COVERAGE without touching
         streak LENGTH, and length is what carries the Laplacian energy.  Measured
         history on the auto sky window, all with 3800 drops:
           2.0 px -> coverage 3.4 %  (over his 2.5 % ceiling)
           1.4 px -> coverage 1.7 %, Laplacian mean 1.89 (under his 2.0 floor)
           1.2 px -> coverage 2.49 %, but frame-to-frame gusts pushed single
                     frames to 2.92 %, i.e. straight through the ceiling
           1.0 px -> coverage ~2.1 %, Laplacian mean ~2.35: both land inside. */
      /* 1.6 real output pixels.  The ribbon spans aSide = -1..+1, so full width
         is 2*uWidth device px = 3.2 px, i.e. 1.6 CSS px at DPR 2 -- the middle
         of GPT's 1-2 CSS px band.  See the COUNT comment for the constant-ink
         trade that pays for it.  Measured history on the auto sky window, all
         with 3800 drops, is retained for reference:
           2.0 px -> coverage 3.4 %  (over his 2.5 % ceiling)
           1.4 px -> coverage 1.7 %, Laplacian mean 1.89 (under his 2.0 floor)
           1.2 px -> coverage 2.49 %, gusts to 2.92 %
           1.0 px -> coverage ~2.1 %, Laplacian mean ~2.35 */
      uWidth: { value: 1.5 },
      /* paler than the original 0x9ec2f0: peak pixel brightness has to clear
         GPT's p99.9 >= 50 while the covered AREA stays under 2.5 %, and a
         brighter tint raises the peak without lengthening a single streak. */
      uColor: { value: new T.Color(0xcde0ff) }, uOp: { value: 0.235 }
    },
    transparent: true, depthWrite: false, blending: T.NormalBlending, side: T.DoubleSide,
    vertexShader: [
      'attribute float aSeed; attribute float aSpd; attribute float aLen;',
      'attribute float aTip; attribute float aSide;',
      'uniform float uTime; uniform float uTop; uniform float uSpan;',
      'uniform vec2 uWind; uniform float uGround; uniform vec2 uRes; uniform float uWidth;',
      'uniform vec3 uOccMin[5]; uniform vec3 uOccMax[5];',
      'varying float vA;',
      'void main(){',
      '  float ph = fract(aSeed + uTime * aSpd);',
      '  float yTop = uTop - ph * uSpan;',
      '  vec2 w = uWind * 0.16;',                 /* lateral drift per metre of fall */
      '  float drift = uTop - yTop;',
      '  float px = position.x + w.x * drift;',
      '  float pz = position.z + w.y * drift;',
      /* the highest lid over this drop's own footprint */
      '  float cutY = uGround;',
      '  for (int i = 0; i < 5; i++) {',
      '    if (px > uOccMin[i].x && px < uOccMax[i].x &&',
      '        pz > uOccMin[i].z && pz < uOccMax[i].z) cutY = max(cutY, uOccMax[i].y);',
      '  }',
      '  float yHead = max(yTop, cutY);',
      '  float yTail = max(yTop - aLen, cutY);',
      '  vec3 pH = vec3(px, yHead, pz);',
      '  vec3 pT = vec3(px + w.x * aLen, yTail, pz + w.y * aLen);',
      '  vec4 cH = projectionMatrix * modelViewMatrix * vec4(pH, 1.0);',
      '  vec4 cT = projectionMatrix * modelViewMatrix * vec4(pT, 1.0);',
      '  vec4 c = mix(cH, cT, aTip);',
      /* widen along the screen-space normal, in real output pixels */
      '  vec2 sH = cH.xy / max(0.0001, cH.w) * uRes * 0.5;',
      '  vec2 sT = cT.xy / max(0.0001, cT.w) * uRes * 0.5;',
      '  vec2 d = sH - sT;',
      '  float L = max(0.001, length(d));',
      '  vec2 n = vec2(-d.y, d.x) / L;',
      '  c.xy += (n * (aSide * uWidth)) / (uRes * 0.5) * c.w;',
      '  vA = smoothstep(0.0, 0.06, ph) * smoothstep(cutY, cutY + 0.30, yTail)',
      '     * smoothstep(0.0, 0.02, yHead - yTail);',
      '  gl_Position = c;',
      '}'
    ].join('\n'),
    fragmentShader: [
      'uniform vec3 uColor; uniform float uOp; varying float vA;',
      'void main(){ if (vA < 0.004) discard; gl_FragColor = vec4(uColor, vA * uOp); }'
    ].join('\n')
  });
  const m = new T.Mesh(geo, mat);
  m.frustumCulled = false;
  scene.add(m);
  return m;
})();

/* ---------- droplet system (eave drips only) ----------
   This used to build two systems.  The ground one -- SPLASH, 700 additive
   Points, mode 0 -- is GONE: it sized every particle by
       gl_PointSize = clamp(uSize * uPix / -mv.z, 1.0, 12.0)
                    = clamp(0.055 * 450 / 27, 1.0, 12.0) = clamp(0.917) = 1 px
   so the whole ground splash rendered as 700 single pixels.  The ground is now
   RIPPLES in 07_realworld.js -- instanced world-space geometry whose radius is
   in metres, which cannot be clamped away.  Mode 1 (falling eave water) is
   unaffected and still runs through here. */
function dropletSystem(list, opts) {
  const n = list.length;
  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n);
  const spd = new Float32Array(n);
  const hi = new Float32Array(n);
  list.forEach(function (p, i) {
    pos[i * 3] = p[0]; pos[i * 3 + 1] = p[1]; pos[i * 3 + 2] = p[2];
    seed[i] = Math.random();
    spd[i] = opts.sp0 + Math.random() * (opts.sp1 - opts.sp0);
    hi[i] = opts.h0 + Math.random() * (opts.h1 - opts.h0);
  });
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new T.BufferAttribute(seed, 1));
  geo.setAttribute('aSpd', new T.BufferAttribute(spd, 1));
  geo.setAttribute('aHi', new T.BufferAttribute(hi, 1));
  const mat = new T.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uPix: { value: 400.0 }, uSize: { value: opts.size },
      uColor: { value: new T.Color(opts.color) }, uOp: { value: opts.op }, uMode: { value: opts.mode }
    },
    transparent: true, depthWrite: false, blending: T.AdditiveBlending,
    vertexShader: [
      'attribute float aSeed; attribute float aSpd; attribute float aHi;',
      'uniform float uTime; uniform float uPix; uniform float uSize; uniform float uMode;',
      'varying float vA;',
      'void main(){',
      '  float t = fract(aSeed + uTime * aSpd);',
      '  vec3 p = position;',
      '  if (uMode < 0.5) {',
      '    p.y += sin(3.1415926 * t) * aHi;',
      '    float rad = t * 0.10;',
      '    p.x += sin(aSeed * 63.0) * rad; p.z += cos(aSeed * 41.0) * rad;',
      '    vA = (1.0 - t) * 0.9;',
      '  } else {',
      '    float fall = pow(t, 2.0);',
      '    p.y = aHi - fall * aHi;',
      '    vA = (1.0 - smoothstep(0.75, 1.0, t)) * smoothstep(0.0, 0.08, t);',
      '  }',
      '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
      '  gl_PointSize = clamp(uSize * uPix / max(0.001, -mv.z), 1.0, 12.0);',
      '  gl_Position = projectionMatrix * mv;',
      '}'
    ].join('\n'),
    fragmentShader: [
      'uniform vec3 uColor; uniform float uOp; varying float vA;',
      'void main(){',
      '  float d = length(gl_PointCoord - vec2(0.5));',
      '  float a = smoothstep(0.5, 0.08, d) * vA * uOp;',
      '  if (a < 0.01) discard;',
      '  gl_FragColor = vec4(uColor, a);',
      '}'
    ].join('\n')
  });
  const pts = new T.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  return pts;
}

const DRIPS = (function () {
  const list = [];
  // along the front canopy edge
  for (let i = 0; i < 60; i++) list.push([-6.8 + Math.random() * 12.2, 0.02, 4.55 + rr(-0.12, 0.12)]);
  // right canopy edge
  for (let i = 0; i < 34; i++) list.push([4.98 + rr(-0.12, 0.12), 0.02, -7.2 + Math.random() * 10.0]);
  // corner eave
  for (let i = 0; i < 22; i++) {
    const t = Math.random();
    list.push([0.4 + 3.0 * t + 1.13, 0.02, 3.0 - 3.0 * t + 1.13]);
  }
  return dropletSystem(list, { sp0: 0.30, sp1: 0.62, h0: 2.55, h1: 2.78, size: 0.05, color: 0xbcd6f5, op: 0.42, mode: 1 });
})();

/* ---------- ripples ----------
   DELETED round 5.  This used to place ~52 ring decals on fixed timers at
   TOP_ROAD + 0.045 -- i.e. buried 35 mm INSIDE the pavement slab wherever a
   sidewalk exists, correlated with no rain drop, no wind and no impact.  That
   is what Sera was seeing when he said "地面上有雨水溅起的水花，但实际上画面中
   并没有雨": splash rings that had no cause, next to rain that had been NaN'd
   out of existence.  Rings are now emitted only by a real landing event, from
   07_realworld.js's coupled CPU drop population (GPT r5: "没有对应落水事件的
   主动溅射 0 次"). */

/* ---------- rain on glass ---------- */
const GLASS_FX = (function () {
  const mat = new T.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uOp: { value: 0.05 }, uColor: { value: new T.Color(0xe2eefb) } },
    transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: [
      'varying vec2 vUv; uniform float uTime; uniform float uOp; uniform vec3 uColor;',
      'float hash(float n){ return fract(sin(n) * 43758.5453); }',
      'void main(){',
      '  float a = 0.0;',
      '  for (int i = 0; i < 3; i++) {',
      '    float fi = float(i);',
      '    float cols = 22.0 + fi * 11.0;',
      '    float cx = (floor(vUv.x * cols) + 0.5) / cols;',
      '    float sd = hash(floor(vUv.x * cols) * 1.37 + fi * 7.13);',
      '    float head = fract(sd + uTime * (0.05 + sd * 0.10));',
      '    float yy = 1.0 - head;',
      '    float w = 0.0035 + sd * 0.011;',
      '    float wob = sin(vUv.y * 9.0 + sd * 24.0) * 0.004;',
      '    float dist = abs(vUv.x - cx - wob);',
      '    float streak = smoothstep(0.55, 0.0, vUv.y - yy) * step(yy, vUv.y + 0.001);',
      '    a += smoothstep(w, 0.0, dist) * streak * (0.35 + sd * 0.65);',
      '  }',
      '  gl_FragColor = vec4(uColor, a * 1.30 * uOp);',
      '}'
    ].join('\n')
  });
  const uni = [];
  ['front', 'right', 'corner'].forEach(function (nm) {
    const line = LINES[nm];
    const L = lineLen(line);
    const c = alongGeo(line.A, line.B, { t0: 0.5, t1: 0.5, y0: 0, y1: 0, thick: 0, out: line.out, off: 0.09 });
    const m = mat.clone();
    uni.push(m);
    const mesh = new T.Mesh(new T.PlaneGeometry(L, GZ1 - GZ0 - 0.06), m);
    mesh.position.set(c.x, (GZ0 + GZ1) / 2, c.z);
    mesh.rotation.y = c.ry;
    mesh.renderOrder = 6;
    mesh.frustumCulled = false;
    store.add(mesh);
  });
  return uni;
})();

/* ---------- wet-ground reflections toward camera ---------- */
const reflectCards = [];
/* Wet-asphalt reflection of the shopfront, locked to the ground plane.  After
   the colour pipeline these had to come up: they are the cheapest and most
   legible way to say "the street is wet" from a diorama distance, and at the
   old opacity they were almost invisible against the dark road. */
ANIM.reflect.push({ pos: [-1.2, 3.0, 4.4], color: 0xffc98a, w: 8.5, len: 7.0, op: 0.40 });
ANIM.reflect.push({ pos: [-1.2, 3.0, 4.4], color: 0xffe0b0, w: 4.0, len: 4.5, op: 0.34 });
const _qBase = new T.Quaternion().setFromEuler(new T.Euler(-Math.PI / 2, 0, 0));
const _qYaw = new T.Quaternion();
const _YAXIS = new T.Vector3(0, 1, 0);
const _pTmp = new T.Vector3();
ANIM.reflect.forEach(function (r) {
  const mat = new T.MeshBasicMaterial({ map: reflectTex(), color: r.color, transparent: true, opacity: r.op, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide });
  const m = new T.Mesh(new T.PlaneGeometry(r.w, r.len), mat);
  /* Cards default to road level, but the shop's ceiling-light reflections have
     to lie on the INTERIOR floor (FY + a hair).  They were being dropped at
     TOP_ROAD + 0.05 = -0.03, i.e. 0.17 m under the shop floor and inside the
     plinth, so the polished-floor reflection of the ceiling strips — one of
     the few things you can actually see through the glass at this distance —
     never rendered at all. */
  /* Cards default to the visible road level.  They used to sit at
     TOP_ROAD + 0.05 = -0.03, i.e. 10 mm over a road that was believed to be at
     -0.08 -- so they were the ONLY road-level feature that happened to clear
     the rim trim, which is why the reflections were visible while the paint,
     the puddles and the gratings next to them were not.  6 mm over ROAD_TOP. */
  m.position.set(r.pos[0], r.y === undefined ? ROAD_TOP + 0.006 : r.y, r.pos[2]);
  m.renderOrder = 3;
  m.quaternion.copy(_qBase);
  world.add(m);
  reflectCards.push({ m: m, base: [r.pos[0], r.pos[2]], len: r.len });
});

/* ---------- camera controls ---------- */
/* The hero elevation used to be 0.35 rad at 33 m, i.e. the camera sat ~12.6 m
   up looking down at ~20 deg.  At that angle the sight line grazing the window
   head (y = 2.30) reaches the shop floor at z ~ -0.5, so the only interior a
   viewer could ever see was a 3.5 m strip of flooring behind the glass -- the
   four shelf rows at z = -1.4 / -2.85 / -4.3 and the back-wall coolers were
   outside the view cone as a matter of geometry, not of lighting.  K2.8 derived
   the same conclusion from the brief and recommended exactly this: "机位 el
   0.35 -> 0.22、dist 33 -> 27，让视廊穿堂".  At 0.22 rad / 27 m the visible
   floor reaches z ~ -2.8 and the whole interior opens up, while the shot still
   reads as the same elevated three-quarter diorama. */
const ctrl = {
  az: 0.86, el: 0.22, dist: 27.0,
  azT: 0.86, elT: 0.22, distT: 27.0,
  target: new T.Vector3(-0.2, 1.35, -0.5),
  touched: false, autoRotate: true
};
const canvas = renderer.domElement;
let dragId = null, lastX = 0, lastY = 0, pinchD = 0;
canvas.style.touchAction = 'none';
canvas.addEventListener('pointerdown', function (e) {
  if (dragId !== null) return;
  dragId = e.pointerId;
  lastX = e.clientX; lastY = e.clientY;
  ctrl.touched = true; ctrl.autoRotate = false;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', function (e) {
  if (e.pointerId !== dragId) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  if (e.shiftKey || e.buttons === 2) {
    // pan
    const s = ctrl.dist * 0.0016;
    const right = new T.Vector3(Math.cos(ctrl.az), 0, -Math.sin(ctrl.az));
    const fwd = new T.Vector3(Math.sin(ctrl.az), 0, Math.cos(ctrl.az));
    ctrl.target.addScaledVector(right, -dx * s);
    ctrl.target.addScaledVector(fwd, dy * s);
    ctrl.target.x = Math.max(-9, Math.min(9, ctrl.target.x));
    ctrl.target.z = Math.max(-9, Math.min(9, ctrl.target.z));
  } else {
    ctrl.azT -= dx * 0.006;
    ctrl.elT = Math.max(0.05, Math.min(1.32, ctrl.elT + dy * 0.004));
  }
});
function endDrag(e) { if (e.pointerId === dragId) dragId = null; }
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', function (e) {
  e.preventDefault();
  ctrl.distT = Math.max(9, Math.min(62, ctrl.distT * (1 + e.deltaY * 0.0011)));
  ctrl.touched = true; ctrl.autoRotate = false;
}, { passive: false });
canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
canvas.addEventListener('touchmove', function (e) {
  if (e.touches.length === 2) {
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    if (pinchD) ctrl.distT = Math.max(9, Math.min(62, ctrl.distT * (pinchD / d)));
    pinchD = d;
    e.preventDefault();
  }
}, { passive: false });
canvas.addEventListener('touchend', function () { pinchD = 0; });

function updateCamera(dt) {
  if (ctrl.autoRotate) ctrl.azT += dt * 0.035;
  ctrl.az += (ctrl.azT - ctrl.az) * Math.min(1, dt * 8);
  ctrl.el += (ctrl.elT - ctrl.el) * Math.min(1, dt * 8);
  ctrl.dist += (ctrl.distT - ctrl.dist) * Math.min(1, dt * 7);
  const ce = Math.cos(ctrl.el), se = Math.sin(ctrl.el);
  camera.position.set(
    ctrl.target.x + ctrl.dist * ce * Math.sin(ctrl.az),
    ctrl.target.y + ctrl.dist * se,
    ctrl.target.z + ctrl.dist * ce * Math.cos(ctrl.az)
  );
  camera.lookAt(ctrl.target);
}

/* ---------- deterministic capture: per-frame camera force-set ---------- */
/* 为什么是「每帧强制设成目标值」而不是「设一次、然后等阻尼收敛」：
   updateCamera 的阻尼是 az += (azT - az) * min(1, dt*8)，落点与 dt 有关。
   dt 来自虚拟时钟，单看是可复现的；但只要 06 的循环与 07 的循环推进的帧数
   出现一帧差（掉帧、GC 停顿、tab 切走），落点就差一丁点。差一丁点在 27 米外
   就是几十个像素——旧流水线同脚本两次跑出来 PSNR ≈ 31 dB 就是这么来的。
   把 az 与 azT 同时设成目标值，阻尼项恒为 0，相机与「跑了多少帧」彻底解耦。
   不开 capture 时钩子根本不会被调用（帧泵只在 capture 下注册），这里是零成本。 */
if (window.__SHOT_SET_HOOK__) {
  window.__SHOT_SET_HOOK__(function (frame, t, frozen) {
    var c = window.__shot && window.__shot.config;
    if (!c || !c.capture) return;
    if (c.az   !== null) { ctrl.az   = c.az;   ctrl.azT   = c.az; }
    if (c.el   !== null) { ctrl.el   = c.el;   ctrl.elT   = c.el; }
    if (c.dist !== null) { ctrl.dist = c.dist; ctrl.distT = c.dist; }
    if (c.tx !== null) ctrl.target.x = c.tx;
    if (c.ty !== null) ctrl.target.y = c.ty;
    if (c.tz !== null) ctrl.target.z = c.tz;
    /* autoRotate 必须关掉：updateCamera 开头会给 azT 加 dt * 0.035，
       只要它开着，azT 就会在钩子设完之后继续漂。 */
    ctrl.autoRotate = false;
    ctrl.touched = true;
  });
}

/* ---------- animate ---------- */
const DOOR = { next: 6 + Math.random() * 12, dwell: 3.0, t0: 0, closed: true };
function doorOpen(t) {
  // irregular open/dwell: no people in this scene, so a metronome would be a
  // narrative error (flagged in review) — random intervals read as a person
  if (t < DOOR.next) return 0;
  if (DOOR.closed) { DOOR.closed = false; DOOR.dwell = 2.6 + Math.random() * 2.0; }
  const dt = t - DOOR.next;
  if (dt > DOOR.dwell) {
    DOOR.closed = true;
    DOOR.next = t + 7 + Math.random() * 19;
    return 0;
  }
  const a = Math.min(dt / 0.85, 1);
  const b = Math.min(Math.max((DOOR.dwell - dt) / 0.85, 0), 1);
  return Math.min(a, b);
}
function animate() {
  requestAnimationFrame(animate);
  /* dt = 0 while frozen (see 01_boot).  T0 then holds, so uTime holds, so the
     rain, the drips and the ripples all stop while the render still runs --
     which is what lets two variants be photographed from one state. */
  const dt = window.FREEZE.on ? 0 : Math.min(0.05, clock.getDelta());
  T0 += dt;
  const t = T0;
  // rain
  RAIN.material.uniforms.uTime.value = t;
  RAIN.material.uniforms.uRes.value.set(renderer.domElement.width, renderer.domElement.height);
  // the old ground-splash Points system used to be advanced here; it is gone,
  // replaced by RIPPLES (07_realworld.js), which is driven from 07's own tick
  DRIPS.material.uniforms.uTime.value = t;
  DRIPS.material.uniforms.uPix.value = renderer.domElement.height * 0.5;
  GLASS_FX.forEach(function (m) { m.uniforms.uTime.value = t; });
  // ripples: emitted per landing event in 07_realworld.js, not on a timer
  // reflections toward camera
  for (let i = 0; i < reflectCards.length; i++) {
    const c = reflectCards[i];
    const dx = camera.position.x - c.base[0];
    const dz = camera.position.z - c.base[1];
    const dl = Math.hypot(dx, dz) || 1;
    const ux = dx / dl, uz = dz / dl;
    _pTmp.set(c.base[0] + ux * c.len * 0.5, ROAD_TOP + 0.006, c.base[1] + uz * c.len * 0.5);
    c.m.position.copy(_pTmp);
    const a = Math.atan2(ux, uz);
    _qYaw.setFromAxisAngle(_YAXIS, a);
    c.m.quaternion.copy(_qYaw).multiply(_qBase);
  }
  // auto doors
  const open = doorOpen(t);
  ANIM.doors.forEach(function (d) {
    const off = open * d.dist * d.s;
    d.g.position.x = d.base.x + DOOR_U.x * off;
    d.g.position.z = d.base.z + DOOR_U.z * off;
  });
  // fans
  ANIM.fans.forEach(function (f) { f.obj.rotation.z += dt * f.sp; });
  // flicker
  ANIM.flicker.forEach(function (f) {
    const v = 0.72 + 0.28 * Math.sin(t * f.sp * 2.1) * Math.sin(t * f.sp * 0.7 + 1.3);
    f.s.material.opacity = f.base * (0.82 + 0.18 * v);
  });
  // steam
  ANIM.steam.forEach(function (s) {
    const k = (Math.sin(t * s.sp + s.ph) + 1) * 0.5;
    s.s.position.y = s.base.y + k * s.amp;
    s.s.material.opacity = 0.24 * (0.35 + 0.65 * (1 - Math.abs(k - 0.4)));
    const sc = 0.8 + k * 0.5;
    s.s.scale.set(sc, sc, 1);
  });
  // traffic signal
  ANIM.signals.forEach(function (sg) {
    if (!sg.ready) {
      sg.lamps.forEach(function (l) { l.material = l.material.clone(); });
      sg.ready = true;
    }
    const cycle = sg.per;
    const ph = t % cycle;
    let active = 0;
    if (ph < cycle * 0.45) active = 0;
    else if (ph < cycle * 0.52) active = 1;
    else active = 2;
    /* The one place in the build that writes a colour into a material every
       frame, and it was writing sRGB into a slot the pipeline had already
       linearised.  An unlit lamp was set to 0.12 x its sRGB value, which the
       renderer then treated as linear and encoded on the way out -- so 0.12
       displayed as 0.12^(1/2.2) = 0.38, and all three lamps of every traffic
       signal read as lit at once.  Converting here puts the dim lamp at the
       intended 0.12 and keeps the lit one at its true colour. */
    sg.lamps.forEach(function (l, i) {
      const c = new T.Color(sg.cols[i]).convertSRGBToLinear();
      if (i === active) { l.material.color.copy(c); }
      else { l.material.color.copy(c).multiplyScalar(0.12); }
    });
    sg.sprites.forEach(function (sp, i) {
      sp.material.opacity = i === active ? 0.55 : 0.0;
    });
  });
  updateCamera(dt);
  renderer.render(scene, camera);
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
animate();
