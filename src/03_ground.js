/* ============ 03 ground / streets / paint ============ */
/* TWO heights, and until now only one of them was ever named.
   ---------------------------------------------------------------------------
   TOP_ROAD  is the BASE SLAB's top face.  It is STRUCTURAL.  Nothing stands on
             it and nothing can see it.
   ROAD_TOP  is the rim trim's top face.  It is the surface the camera actually
             sees wherever there is no sidewalk slab, i.e. the real road.

   The rim trim is a SOLID 23.44 m box laid straight over the base slab, so it
   buries TOP_ROAD by RIM_H/2 - RIM_DROP = 40 mm across the entire base, and it
   is 120 mm wider on every side.  Every road feature in this project was
   authored against TOP_ROAD, so every one of them was 20-40 mm UNDERGROUND.

   Measured, not reasoned -- src/probe_ground.py raycasts straight down at a
   spread of road points and reports every layer:
       y = -0.0390   contact shadow decal        (visibly on top)
       y = -0.0400   rim trim, id 23, 23.44 box  <-- ROAD_TOP, the road
       y = -0.0790   crosswalk paint   id 36     <-- buried 40 mm, INVISIBLE
       y = -0.0790   more road paint   id 127    <-- buried
       y = -0.0800   base slab, id 21, 23.2 box  <-- TOP_ROAD, buried

   and every splash ring placed on the road measured 21-30 mm below the surface
   it was supposed to lie on.  GPT r9 listed the class independently: "地面高度
   不是永久常量 ... 单独的 aGY 无法支持倾斜表面", and it put a hard gate on it:
   "落点和支撑面射线交点误差 <= 1 cm".

   So ROAD_TOP is DERIVED from the same expression that builds the rim, not
   written down as a literal.  If anyone moves the rim, the surface constant
   moves with it and the two cannot drift apart -- which is exactly how the
   40 mm error survived four rounds of review in the first place. */
const TOP_ROAD = -0.08;
const RIM_H = 0.16, RIM_DROP = 0.04;
const ROAD_TOP = TOP_ROAD - RIM_DROP + RIM_H / 2;   // -0.04, the rim's top face
const TOP_WALK = 0.0;
const HALF = 11.6;
const walkMat = toon(0x767c88, { map: walkTex() });
const roadMat = toon(0x2a3040, { map: roadTex() });
const baseMat = toon(0x4b5162, { map: concreteTex() });
const darkMetal = toon(0x2b3244);
const curbMat = toon(0x878e99);
const paintWhite = toon(0xd9dee6);

const world = new T.Group();
scene.add(world);

function decal(parent, mat, w, h, x, z, y, rot) {
  const m = planeW(parent, mat, w, h, x, y, z, { rx: -Math.PI / 2, ry: 0, rz: rot || 0, outline: false, cast: false });
  m.receiveShadow = false;
  /* Kimi r6 Q1: stop INFERRING "this is a pasted face" from material props.
     Every previous exclusion rule keyed on geometry+texture+opacity failed in a
     new way (see probe_gap.py's header).  From here on the class is DECLARED --
     anything built through decal() / contact() is a pasted face, whatever its
     material ends up doing -- and the probes may trust userData.role blindly. */
  m.userData.role = 'decal';
  return m;
}
function decalMat(map, opacity, add) {
  const p = { map: map, side: T.DoubleSide, depthWrite: false };
  const m = new T.MeshBasicMaterial(p);
  m.opacity = opacity === undefined ? 1 : opacity;
  m.transparent = true;
  m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
  if (add) { m.blending = T.AdditiveBlending; }
  return m;
}
function contact(parent, x, z, r, op, y) {
  const mat = SHADOW_MAT.clone();
  mat.opacity = op === undefined ? 0.8 : op;
  const m = decal(parent, mat, 2, 2, x, z, y === undefined ? TOP_WALK + 0.014 : y, 0);
  m.scale.set(r, r, 1);
  return m;
}

const SHADOW_MAT = decalMat(shadowTex(), 0.85);
const PUDDLE_MAT = decalMat(puddleTex(), 0.9);

(function buildBase() {
  // base slab -- structural; its top face is TOP_ROAD and is never seen
  const h = 1.32;
  addMesh(world, new T.BoxGeometry(HALF * 2, h, HALF * 2), baseMat, { x: 0, y: TOP_ROAD - h / 2, z: 0, ow: 0.05 });
  // rim trim -- ROAD_TOP is this box's top face, by construction
  addMesh(world, new T.BoxGeometry(HALF * 2 + 0.24, RIM_H, HALF * 2 + 0.24), toon(0x353b4a), { x: 0, y: TOP_ROAD - RIM_DROP, z: 0, cast: false, ow: 0.05 });
  addMesh(world, new T.BoxGeometry(HALF * 2 + 0.24, 0.1, HALF * 2 + 0.24), toon(0x2a3040), { x: 0, y: TOP_ROAD - 1.24, z: 0, cast: false, outline: false });
})();

/* ---- sidewalk slabs ---- */
function walkSlab(parent, x0, x1, z0, z1) {
  const w = x1 - x0, d = z1 - z0;
  const m = addMesh(parent, new T.BoxGeometry(w, 0.08, d), walkMat, { x: (x0 + x1) / 2, y: TOP_WALK - 0.04, z: (z0 + z1) / 2, ow: 0.04 });
  return m;
}
(function buildWalk() {
  walkSlab(world, -6.9, 5.5, 3.0, 5.5);      // front sidewalk
  walkSlab(world, 3.4, 5.5, -7.4, 3.0);      // right sidewalk
  walkSlab(world, -HALF, HALF, 8.7, HALF);   // far sidewalk strip
  walkSlab(world, -8.6, 4.0, -HALF, -6.2);   // back of house apron
  // curb faces are the slab sides; add thin light edge line
  const edge = toon(0x9aa2ad);
  seg(world, { x: -6.9, z: 5.52 }, { x: 5.5, z: 5.52 }, { t0: 0, t1: 1, y0: TOP_WALK - 0.09, y1: TOP_WALK + 0.005, thick: 0.06, mat: curbMat, out: [0, 1], off: 0, outline: false });
  seg(world, { x: 5.52, z: 3.0 }, { x: 5.52, z: -7.4 }, { t0: 0, t1: 1, y0: TOP_WALK - 0.09, y1: TOP_WALK + 0.005, thick: 0.06, mat: curbMat, out: [1, 0], off: 0, outline: false });
})();

/* ---- road paint ----
   Painted stripes are applied ON the road, so they hang off ROAD_TOP.  They
   used to be pinned to TOP_ROAD + 0.012 = -0.068, i.e. 28 mm UNDER the surface
   the camera sees: the crosswalks, the centre lines, both stop lines and the
   whole parking bay were invisible, which is a large part of why the road read
   as a flat dead slab.  The lift is 6 mm: enough to clear the surface, small
   enough that the paint never casts a visible lip at a grazing angle. */
(function buildPaint() {
  const y = ROAD_TOP + 0.006;
  const PM = new T.MeshBasicMaterial({ map: null, color: 0xdfe4ea, transparent: true, opacity: 0.92, depthWrite: false });
  PM.polygonOffset = true; PM.polygonOffsetFactor = -3; PM.polygonOffsetUnits = -3;
  function stripe(x, z, w, d, op) {
    const m = PM.clone(); m.opacity = op === undefined ? 0.9 : op;
    decal(world, m, w, d, x, z, y, 0);
  }
  // crosswalk across front road
  for (let i = 0; i < 9; i++) {
    stripe(-4.6 + i * 0.82, 7.1, 0.42, 2.85, 0.88);
  }
  // crosswalk across right road
  for (let i = 0; i < 8; i++) {
    stripe(7.1, -3.3 + i * 0.82, 2.85, 0.42, 0.88);
  }
  // centre / edge lines
  stripe(-9.6, 7.1, 3.4, 0.16, 0.5);
  stripe(9.9, 7.1, 2.6, 0.16, 0.5);
  stripe(7.1, 4.6, 0.16, 1.4, 0.5);
  stripe(7.1, -4.9, 0.16, 1.6, 0.5);
  // stop lines
  stripe(-6.0, 6.15, 0.22, 2.4, 0.75);
  stripe(6.15, -6.0, 2.4, 0.22, 0.75);
  // parking lot lines (back right)
  const px0 = 5.4, pz0 = -11.3, pw = 1.95;
  for (let i = 0; i <= 3; i++) {
    stripe(px0 + i * pw, (pz0 + -6.8) / 2, 0.16, 4.5, 0.8);
  }
  stripe((px0 + 5.85) / 2, pz0 + 0.2, 5.9, 0.16, 0.8);
  // number blocks
  const NM = new T.MeshBasicMaterial({ color: 0xe8e4d6, transparent: true, opacity: 0.85, depthWrite: false });
  NM.polygonOffset = true; NM.polygonOffsetFactor = -3;
  decal(world, NM, 0.7, 0.7, px0 + pw * 0.5, -10.6, y, 0);
  decal(world, NM, 0.7, 0.7, px0 + pw * 1.5, -10.6, y, 0);
})();

/* ---- gutters ---- */
(function buildGutter() {
  const grateCv = mk(64, 64), gg = grateCv.g;
  gg.fillStyle = '#141a28'; gg.fillRect(0, 0, 64, 64);
  gg.fillStyle = '#5b6580';
  for (let i = 0; i < 4; i++) gg.fillRect(4, 6 + i * 15, 56, 6);
  const grateTx = tx(grateCv.c, 1, 1);
  grateTx.wrapS = grateTx.wrapT = T.RepeatWrapping;
  const gm = new T.MeshToonMaterial({ map: grateTx, gradientMap: RAMP });
  grateTx.repeat.set(1, 1);
  /* GZ / GX are the gutter centrelines.  A Japanese 側溝 with a grated lid runs
     along the ROAD edge, hard against the kerb -- the kerb face is at z 5.52
     (front) and x 5.52 (right), and the walk slabs stop at 5.5.  These used to
     sit at 5.42, i.e. 250 mm of the 340 mm grating was INSIDE the sidewalk slab
     and only the outer 90 mm stuck out into the road; whatever showed was a
     19 mm proud strip.  Now 5.72 puts the whole 340 mm in the road, touching
     the kerb, and the grating's top face is 2 mm proud instead of 19. */
  const GZ = 5.72, GX = 5.72;
  const fgG = new T.BoxGeometry(12.0, 0.03, 0.34);
  const fg = addMesh(world, fgG, gm, { x: -0.7, y: ROAD_TOP - 0.012, z: GZ, outline: false, cast: false });
  const grateT2 = grateTx.clone(); grateT2.needsUpdate = true; grateT2.wrapS = grateT2.wrapT = T.RepeatWrapping; grateT2.repeat.set(24, 1);
  fg.material = new T.MeshToonMaterial({ map: grateT2, gradientMap: RAMP });
  // right gutter
  const rgG = new T.BoxGeometry(0.34, 0.03, 10.6);
  const grateT3 = grateTx.clone(); grateT3.needsUpdate = true; grateT3.wrapS = grateT3.wrapT = T.RepeatWrapping; grateT3.repeat.set(21, 1);
  addMesh(world, rgG, new T.MeshToonMaterial({ map: grateT3, gradientMap: RAMP }), { x: GX, y: ROAD_TOP - 0.012, z: -2.2, outline: false, cast: false });
  // dark water line inside gutters
  const waterMat = basic(0x3d5a80, { opacity: 0.55, depthWrite: false });
  decal(world, waterMat, 12.0, 0.3, -0.7, GZ, ROAD_TOP + 0.006, 0);
  decal(world, waterMat, 0.3, 10.4, GX, -2.2, ROAD_TOP + 0.006, 0);
})();

/* ---- planter / hedge strip (right side) ---- */
function hedgeStrip() {
  const g = group(world, 0, 0, 0);
  addMesh(g, new T.BoxGeometry(2.9, 0.55, 11.6), toon(0x54503f, { map: concreteTex() }), { x: 10.15, y: 0.2, z: -0.8, ow: 0.05 });
  // hedge bushes
  const hedge = toon(0x2b4230);
  const light = toon(0x37533a);
  for (let i = 0; i < 9; i++) {
    const z = -6.0 + i * 1.28;
    addMesh(g, new T.SphereGeometry(0.62, 10, 8), hedge, { x: 10.1 + rr(-0.1, 0.1), y: 0.62 + rr(-0.05, 0.12), z: z, sx: 1.3, sy: 0.7, sz: 0.95, ow: 0.05 });
    addMesh(g, new T.SphereGeometry(0.36, 8, 6), light, { x: 9.9, y: 0.95, z: z + 0.4, ow: 0.04 });
  }
  // tree
  function tree(x, z, s) {
    const t = group(g, x, 0.45, z);
    t.scale.setScalar(s);
    addMesh(t, new T.CylinderGeometry(0.16, 0.24, 2.2, 8), toon(0x4b3d33), { y: 1.1, ow: 0.05 });
    addMesh(t, new T.SphereGeometry(1.05, 12, 10), toon(0x2f4a34), { y: 2.5, sx: 1.05, sy: 0.9, sz: 1.05, ow: 0.06 });
    addMesh(t, new T.SphereGeometry(0.8, 10, 8), toon(0x3c5c3a), { x: 0.5, y: 2.9, z: 0.3, ow: 0.06 });
    addMesh(t, new T.SphereGeometry(0.7, 10, 8), toon(0x2a4430), { x: -0.55, y: 2.75, z: -0.3, ow: 0.06 });
  }
  tree(9.55, -4.6, 0.9);
  tree(10.4, 2.6, 0.78);
  return g;
}
hedgeStrip();

/* ---- puddles ---- */
const puddles = [];
(function buildPuddles() {
  /* Round 5: three of these were physically wrong.
     [10.2, 4.4] sat INSIDE the hedge planter (a 0.55 m box whose top is at
     0.475), so it was buried half a metre underground; [-6.6, 4.2] and
     [4.6, 4.6] reached under the canopy, which is supposed to be the dry zone.
     And every puddle was pinned to TOP_ROAD + 0.02 regardless of what slab was
     underfoot, so the one on the back apron sank into the pavement.  y now
     comes from surfaceY(), and the canopy footprint is left dry. */
  const spots = [
    [-3.4, 6.6, 3.2, 1.5], [1.2, 7.6, 2.4, 1.2], [7.4, 3.2, 1.8, 2.4], [7.6, -1.4, 2.2, 1.6],
    [-6.8, 5.05, 1.5, 0.8], [4.9, 4.6, 1.3, 0.85], [-7.6, -3.2, 1.2, 1.6], [7.0, 6.9, 1.6, 1.2],
    [-9.4, 7.0, 2.0, 1.2], [9.4, 7.6, 1.6, 1.4], [3.2, -8.2, 2.4, 1.6], [-4.2, -8.6, 2.0, 1.4]
  ];
  /* The puddle texture's lit edge lives at the TOP of the map, so each decal is
     yawed until that edge points at the light which actually lights it -- the
     shopfront.  The old code used a random in-plane rotation, which put the
     highlight on a different side of every puddle; that is precisely what makes
     a wet patch read as painted-on rather than as reflecting something.
     Derivation: with the decal's rx = -pi/2, the texture's +v axis maps to
     (-sin rz, 0, -cos rz), so rz = atan2(p.x - L.x, p.z - L.z) aims +v at L. */
  const LX = -1.6, LZ = 3.0;                       // shopfront interior centre
  spots.forEach(function (s) {
    const rot = Math.atan2(s[0] - LX, s[1] - LZ);
    /* x0.72: GPT's per-puddle long axis is 0.3-1.2 m, and a 6.4 m plane was
       carrying five 1.8 m blobs.  Shrinking the plane, not the texture, keeps
       the cluster reading as several puddles rather than one big one. */
    const sc = 0.72 * rr(0.85, 1.15);
    /* 6 mm above whichever slab is underfoot, not 20 mm.  A puddle is water
       lying ON the surface, and 20 mm is a visible float at a grazing angle --
       it would read as a sheet of glass held over the road.  surfaceY() now
       returns the surface the camera actually sees, so this is honest for both
       the road and the sidewalk without a special case. */
    const m = decal(world, PUDDLE_MAT.clone(), s[2] * 2 * sc, s[3] * 2 * sc,
                    s[0], s[1], surfaceY(s[0], s[1]) + 0.006, rot);
    m.material.opacity = rr(0.6, 0.9);
    puddles.push(m);
  });
})();
