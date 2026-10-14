/* tools/shot.js — 确定性截图驱动（Chrome headless，零依赖，Node 22）
 *
 *   node tools/shot.js --html dist/rainy-night-konbini.html --out build/shots \
 *        --shots hero,interior --w 1600 --h 900 --dpr 1 --t 8 --seed 1337 [--runs 3]
 *
 * 三条设计要点，每一条都对应一个踩过的坑：
 *  1. 机位不写在这里。以前 shots_v1.json 与 06_effects.js 各存一份真值，改机位要
 *     两边同步，不同步就静默腐烂。现在这里只传 ?shot=<name>，真值住在
 *     src/00_shot.js 的 SHOTS 表里。--pose 只允许临时覆盖做实验。
 *  2. 就绪握手读 window.__shot.ready，不 sleep 猜时序。协议自带版本号 v=1，
 *     参数解析错误会进 __shot.errors，驱动读到就报错退出，绝不静默出图。
 *  3. 对不带 00_shot.js 的旧构建自动降级到 legacy 注入（FREEZE + 直接写 ctrl），
 *     这样同一支脚本可以对新旧产物做对照实测——确定性是量出来的，不是讲出来的。
 */
const fs = require('fs');
const path = require('path');
const { sleep, launch, open, lockViewport, closeTab, captureStable } = require('./cdp.js');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt;
}

const HTML = path.resolve(arg('html', 'dist/rainy-night-konbini.html'));
const OUT = path.resolve(arg('out', 'build/shots'));
const SHOT_NAMES = arg('shots', 'hero').split(',').map(s => s.trim()).filter(Boolean);
const W = +arg('w', 1600), H = +arg('h', 900), DPR = +arg('dpr', 1);
const T = arg('t', '8'), SEED = arg('seed', '1337');
const RUNS = +arg('runs', 1);
const TIMEOUT = +arg('timeout', 240);
const GPU = arg('gpu', 'swiftshader');      /* swiftshader 更可复现；metal 更快 */
const POSE = arg('pose', '');               /* 形如 az=0.9&el=0.3：只做实验，别进流水线 */
const EXTRA = arg('extra', '');             /* 原样追加到 query，例如 labels=1&lang=en */

fs.mkdirSync(OUT, { recursive: true });

/* 就绪条件里必须有 document.readyState。
   漏掉它的表现是：图能出、看着也对，但偶尔少一层东西——因为整座场景是**同步**
   构建的（约 10 秒），后面的脚本（诊断桥、标注层）要等场景脚本跑完才被解析。
   window.__shot.ready 由第一段脚本里的帧泵置位，它可能在解析还没走到末尾时就为真，
   于是截图拍到一个「DOM 还没解析完」的画面。这种失败是间歇性的，最难查。 */
const READY_PROBE = `(function(){
  var s = window.__shot;
  if (!s) return 'LEGACY';
  if (s.errors && s.errors.length) return 'ERRORS:' + s.errors.join(' | ');
  if (document.readyState !== 'complete') return 'LOADING(' + document.readyState + ')';
  if (!s.ready) return 'WAIT frame=' + s.frame + ' frozen=' + s.frozen;
  return 'READY';
})()`;

/* legacy 路径：旧构建没有 00_shot，只能沿用「注入内部变量」的老办法。
   留着它就是为了让新旧对照能在同一支脚本里量出来。 */
const LEGACY_SHOTS = {
  hero:       { az: 0.86, el: 0.22, dist: 27, tx: -0.2, ty: 1.35, tz: -0.5 },
  interior:   { az: 0.86, el: 0.16, dist: 17, tx: -0.2, ty: 1.10, tz: -0.6 },
  storefront: { az: 0.86, el: 0.20, dist: 13, tx: -0.2, ty: 1.50, tz: -0.2 },
  ground:     { az: 1.20, el: 0.05, dist:  9, tx:  0.5, ty: 0.15, tz:  0.5 },
  corner:     { az: 2.20, el: 0.25, dist: 30, tx:  0.0, ty: 1.20, tz:  0.0 },
  moonshadow: { az: -0.5, el: 0.35, dist: 38, tx:  2.0, ty: 0.80, tz:  2.0 }
};
const LEGACY_POSE = `(function(){
  ctrl.autoRotate = false; ctrl.touched = true;
  ctrl.azT = %AZ%; ctrl.elT = %EL%; ctrl.distT = %DIST%;
  ctrl.az = %AZ%; ctrl.el = %EL%; ctrl.dist = %DIST%;
  ctrl.target.set(%TX%, %TY%, %TZ%);
  window.FREEZE.on = true; T0 = 0;
  return 'ok';
})()`;

async function main() {
  const results = [];
  for (let run = 0; run < RUNS; run++) {
    const port = 9400 + run;
    const chrome = launch(port, DPR, GPU);
    try {
      for (const name of SHOT_NAMES) {
        const q = `capture=1&v=1&shot=${encodeURIComponent(name)}&t=${T}&seed=${SEED}&dpr=${DPR}&w=${W}&h=${H}`
          + (POSE ? '&' + POSE : '') + (EXTRA ? '&' + EXTRA : '');
        const url = 'file://' + HTML + '?' + q;
        const { tab, ws, cdp } = await open(port, url);
        try {
          await lockViewport(cdp, W, H, DPR);

          let state = '', legacy = false;
          const deadline = Date.now() + TIMEOUT * 1000;
          for (;;) {
            state = await cdp.eval(READY_PROBE);
            if (state === 'READY') break;
            if (state === 'LEGACY') { legacy = true; break; }
            if (state.startsWith('ERRORS:')) throw new Error(name + ': ' + state);
            if (Date.now() > deadline) throw new Error(name + ': timeout, last=' + state);
            await sleep(200);
          }

          if (legacy) {
            for (let i = 0; i < 120; i++) {
              if (await cdp.eval(`!!(window.__SCENE_DIAGNOSTICS__ && window.__SCENE_DIAGNOSTICS__.isReady())`)) break;
              await sleep(250);
            }
            const P = LEGACY_SHOTS[name];
            if (!P) throw new Error('legacy mode needs a pose for ' + name);
            const expr = LEGACY_POSE
              .replace(/%AZ%/g, P.az).replace(/%EL%/g, P.el).replace(/%DIST%/g, P.dist)
              .replace(/%TX%/g, P.tx).replace(/%TY%/g, P.ty).replace(/%TZ%/g, P.tz);
            if (await cdp.eval(expr) !== 'ok') throw new Error('legacy pose set failed');
            await sleep(900);
          }

          const cap = await captureStable(cdp, +arg('settle', 1000));
          const buf = cap.buf;
          if (!cap.stable) console.log(`[shot] 警告: ${name} 连抓 ${cap.attempts} 次仍未稳定`);
          const file = path.join(OUT, `run${run + 1}-${name}.png`);
          fs.writeFileSync(file, buf);
          const eff = await cdp.eval(`JSON.stringify(window.__shot ? window.__shot.effective : null)`);
          results.push({ run: run + 1, shot: name, mode: legacy ? 'legacy' : 'capture',
                         file: path.basename(file), bytes: buf.length, effective: eff });
          console.log(`[shot] run${run + 1} ${name}${legacy ? ' (legacy)' : ''} ${(buf.length / 1024).toFixed(0)}KB ${eff || ''}`);
        } finally {
          try { ws.close(); } catch (e) {}
          await closeTab(port, tab);
        }
      }
    } finally { chrome.kill(); }
    await sleep(300);
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'),
    JSON.stringify({ html: HTML, W, H, DPR, T, SEED, results }, null, 2));
  console.log('[shot] done', results.length, 'shots ->', OUT);
}

main().catch(e => { console.error('FATAL', e && e.stack || e); process.exit(1); });
