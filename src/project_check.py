"""Where does each element actually land on screen, and is anything in front of it?

Three gate-6 frames in a row framed their subject badly, and each time I only
found out by looking and squinting.  This asks the camera directly: project every
element's defining world points, report the screen bbox, and raycast from the
camera to each point to see whether something is between.

That turns "the tactile run looks short" into either "it is off the left edge" /
"the bin occludes 4 of 6 tiles" / "my azimuth is degenerate" -- three different
fixes.

Usage:  python src/project_check.py
"""
import sys
import pathlib

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import _rig                       # 运行台：浏览器 / 产物 URL / 场景取用

CHROME = _rig.CHROME
ARGS = _rig.ARGS

ROOT = pathlib.Path(__file__).resolve().parent.parent
URL = (ROOT / 'outputs/rainy-night-konbini.html').as_uri()

# the three poses from shot_gate6b.py, plus the viewport each was shot at
POSES = [
    ('plan',    -0.20, 1.30, 6.5, 1.700, 0.00,  2.200, 1100, 950),
    ('tactile', -0.785, 0.55, 5.5, 2.340, 0.05,  2.931, 1100, 900),
    ('spoutF',   0.55, 0.22, 6.6, 0.155, 1.385, 4.160,  820, 1050),
]

# what to project, expressed in world coordinates (read off src/04_store.js)
APRON = [[3.4, 3.0], [0.70, 3.0], [3.4, 0.30]]
TACTILE_U = [0.7071067811865476, 0.7071067811865476]
TACTILE_B = [1.705, 2.295]          # first tile centre minus its 0.15 offset
TACTILE_STEP = 0.30
TACTILE_N = 4

JS = r"""
(args) => {
  const T = THREE;
  const [az, el, dist, tx, ty, tz, vw, vh,
         APRON, TB, TU, TN] = args;
  ctrl.az = ctrl.azT = az; ctrl.el = ctrl.elT = el;
  ctrl.dist = ctrl.distT = dist; ctrl.autoRotate = false;
  ctrl.target.set(tx, ty, tz);
  camera.aspect = vw / vh; camera.updateProjectionMatrix();
  camera.position.set(tx + dist * Math.cos(el) * Math.sin(az),
                      ty + dist * Math.sin(el),
                      tz + dist * Math.cos(el) * Math.cos(az));
  camera.lookAt(tx, ty, tz);
  camera.updateMatrixWorld(true);
  /* `updateMatrixWorld` refreshes camera.matrixWorld but NOT
     camera.matrixWorldInverse -- only the renderer does that, and Vector3.project()
     goes through the inverse.  Left stale, this probe reports screen positions
     computed from the PREVIOUS frame's camera while its RAYCASTS (which use
     camera.position, correctly updated) describe the requested one -- so the two
     halves of every record disagreed and the picture was a lie.  That is what
     produced "出框 5/5 个样本点" for a view that was in fact well framed. */
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

  const img = new T.Vector3();
  function toScreen(p) {
    img.copy(p).project(camera);
    return {x: (img.x * 0.5 + 0.5) * vw, y: (-img.y * 0.5 + 0.5) * vh, z: img.z};
  }
  // is anything solid between the camera and this world point?
  //
  // Two traps, both already paid for once in probe_fascia.py, and BOTH were
  // still live here:
  //
  //   1. `Box3.setFromObject(o)` folds in the mesh's CHILDREN.  Every outlined
  //      mesh here carries an inverted-hull child, and some carry whole
  //      sub-assemblies, so the box that gets reported can describe an object
  //      that is nothing like the one the ray hit.  That is how a decal whose
  //      own geometry is 0.5 x 0.7 m came back as "9.9 x 0 x 0.3 m".
  //   2. The box was never checked against the hit point.  If the reported AABB
  //      does not contain the point the ray struck, the record is self-refuting
  //      and must say so rather than be printed as fact.
  //
  // So: report the mesh's OWN geometry bbox (local -> world via matrixWorld),
  // report the child-folded box separately for contrast, report the raw
  // transform, and assert containment.  Also walk the next few hits, because
  // "the first thing the ray met" is only interesting if it actually blocks.
  const rc = new T.Raycaster(); rc.camera = camera;
  const _bb = new T.Box3(), _v = new T.Vector3();

  function ownBox(o) {
    if (!o.geometry) return null;
    o.geometry.computeBoundingBox();
    const b = o.geometry.boundingBox.clone();
    if (b.isEmpty()) return null;
    b.applyMatrix4(o.matrixWorld);
    return b;
  }
  function describe(o, hit) {
    const own = ownBox(o);
    const full = new T.Box3().setFromObject(o);
    const chain = [];
    let q = o;
    while (q && chain.length < 5) {
      chain.push(q.type + (q.name ? '(' + q.name + ')' : '')
                 + ((q.userData && q.userData.role) ? '#' + q.userData.role : ''));
      q = q.parent;
    }
    const V = (v) => [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)];
    const S = (b) => b ? [+(b.max.x-b.min.x).toFixed(3), +(b.max.y-b.min.y).toFixed(3),
                         +(b.max.z-b.min.z).toFixed(3)] : null;
    const c = new T.Vector3();
    if (own) own.getCenter(c); else full.getCenter(c);
    return {
      at: +hit.distance.toFixed(3),
      hitPoint: V(hit.point),
      geom: o.geometry ? o.geometry.type : '(none)',
      // the mesh's own geometry, world-transformed
      ownSize: S(own), ownCentre: V(c),
      ownRangeY: own ? [+own.min.y.toFixed(3), +own.max.y.toFixed(3)] : null,
      ownContainsPoint: own ? own.containsPoint(hit.point) : null,
      // children folded in -- kept only so the two can be compared
      fullSize: S(full),
      fullContainsPoint: full.containsPoint(hit.point),
      pos: V(o.position), rot: V(o.rotation), scale: V(o.scale),
      mats: (Array.isArray(o.material) ? o.material.map(m => m.name)
                                       : [o.material && o.material.name]).join(','),
      chain: chain.join(' < '),
    };
  }
  function occluder(p) {
    const dir = p.clone().sub(camera.position);
    const len = dir.length(); dir.normalize();
    rc.set(camera.position, dir);
    rc.far = len - 0.02;
    const hits = rc.intersectObjects(scene.children, true).filter(h =>
      h.object.visible && !(h.object.userData && h.object.userData.isOutline)
      && !h.object.isPoints && !h.object.isSprite);
    if (!hits.length) return null;
    const first = describe(hits[0].object, hits[0]);
    // if the first hit's own geometry does not contain the struck point, that is
    // a measurement fault, not a finding -- show what else is along the ray.
    const rest = hits.slice(1, 4).map(h => describe(h.object, h));
    return {first, rest, solo: hits.length === 1};
  }
  function survey(label, pts) {
    const out = pts.map(p => {
      const s = toScreen(new T.Vector3(p[0], p[1], p[2]));
      return {w: p, s: {x: +s.x.toFixed(1), y: +s.y.toFixed(1)},
              in: s.x >= 0 && s.x <= vw && s.y >= 0 && s.y <= vh,
              occ: occluder(new T.Vector3(p[0], p[1], p[2]))};
    });
    const xs = out.map(o => o.s.x), ys = out.map(o => o.s.y);
    return {label, pts: out,
            bbox: {x0: +Math.min(...xs).toFixed(0), x1: +Math.max(...xs).toFixed(0),
                   y0: +Math.min(...ys).toFixed(0), y1: +Math.max(...ys).toFixed(0)},
            spanX: +(Math.max(...xs) - Math.min(...xs)).toFixed(0),
            spanY: +(Math.max(...ys) - Math.min(...ys)).toFixed(0),
            ppm: +(1569.3 / dist).toFixed(1)};
  }

  const groups = {};
  groups.apron = survey('apron', APRON.map(p => [p[0], TOP_WALK, p[1]]));
  const tac = [];
  for (let i = 0; i < TN; i++) {
    const d = 0.15 + i * 0.30;
    tac.push([TB[0] + TU[0] * d, TOP_WALK + 0.006, TB[1] + TU[1] * d]);
  }
  tac.push([TB[0] - TU[0] * 0.15, TOP_WALK + 0.006, TB[1] - TU[1] * 0.15]);
  groups.tactile = survey('tactile', tac);
  groups.spout = survey('spout', [[0.155, 0.010, 4.160], [0.155, 2.760, 4.160]]);
  return {groups, vw, vh};
}
"""


def main():
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME,
                               args=['--use-gl=angle', '--use-angle=swiftshader',
                                     '--enable-unsafe-swiftshader'])
        pg = b.new_page(viewport={'width': 1100, 'height': 950})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(URL, wait_until='domcontentloaded')
        pg.wait_for_function(
            "() => (typeof ctrl !== 'undefined') && (typeof camera !== 'undefined')"
            " && scene.children.length > 5", timeout=180000)
        pg.wait_for_timeout(6000)

        for name, az, el, dist, tx, ty, tz, vw, vh in POSES:
            res = pg.evaluate(JS, [az, el, dist, tx, ty, tz, vw, vh,
                                  APRON, TACTILE_B, TACTILE_U, TACTILE_N])
            print(f'═══ pose {name}   az={az} el={el} dist={dist}  '
                  f'视口 {vw}x{vh}  {res["groups"]["apron"]["ppm"]} px/m')
            for key in ('apron', 'tactile', 'spout'):
                g = res['groups'][key]
                bb = g['bbox']
                print(f'  {key:8s} '
                      f'屏幕跨度 X {g["spanX"]} px / Y {g["spanY"]} px   '
                      f'bbox x[{bb["x0"]}..{bb["x1"]}] y[{bb["y0"]}..{bb["y1"]}]')
                off = [p for p in g['pts'] if not p['in']]
                occ = [p for p in g['pts'] if p['occ']]
                if off:
                    print(f'           出框 {len(off)}/{len(g["pts"])} 个样本点')
                if occ:
                    print(f'           被遮挡 {len(occ)}/{len(g["pts"])} 个，逐个列出：')
                    for p in g['pts']:
                        tag = f'屏 x={p["s"]["x"]:7.1f} y={p["s"]["y"]:7.1f}'
                        if not p['occ']:
                            print(f'             {tag}  可见')
                            continue
                        o = p['occ']['first']
                        print(f'             {tag}  世界({p["w"][0]:.2f},{p["w"][1]:.2f},'
                              f'{p["w"][2]:.2f})')
                        print(f'                ← 挡在 {o["at"]:.2f} m 处 {o["chain"]}')
                        print(f'                  几何 {o["geom"]}  '
                              f'自身尺寸{o["ownSize"]} 中心{o["ownCentre"]}')
                        print(f'                  自身 y {o["ownRangeY"]}')
                        print(f'                  命中点{o["hitPoint"]}  '
                              f'自身几何含该点={o["ownContainsPoint"]}')
                        if o['ownContainsPoint'] is False:
                            print(f'                  ⚠ 测量自身矛盾：命中点不在该几何的'
                                  f'包围盒内 —— 这条记录不能当结论')
                            print(f'                  （含子节点的 Box3 = {o["fullSize"]} '
                                  f'含点={o["fullContainsPoint"]}；'
                                  f'pos={o["pos"]} rot={o["rot"]} scale={o["scale"]}）')
                        print(f'                  材质 {o["mats"]}')
                        if not p['occ']['solo']:
                            print(f'                  后方还有 {len(p["occ"]["rest"])} 个：')
                            for r in p['occ']['rest']:
                                print(f'                    · {r["at"]:.2f} m {r["chain"]} '
                                      f'{r["geom"]} {r["ownSize"]}')
                        else:
                            print(f'                  后方无其它命中（该射线只有这一个物体）')
                else:
                    print(f'           无遮挡，{len(g["pts"])} 个样本点全部可见')
            print()

        if errs:
            print('pageerror:', errs[:2])
        b.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
