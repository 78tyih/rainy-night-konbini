/* tools/gate.js — 发布闸门：把「应该还是好的」变成「跑一遍就知道还是不是好的」
 *
 *   node tools/gate.js --html dist/rainy-night-konbini.html [--quick]
 *
 * 三件事必须**分开**验证，因为它们会各自独立地坏掉，而坏掉的方式都是静默的：
 *   A. 默认路径没被污染 —— 不带任何参数时，行为与改动前一模一样
 *   B. 指定机位可复现 —— 同一个 URL，两个进程，出来的图必须逐字节相同
 *   C. 构建可复现 —— 同一个源码，构建两次，产物 md5 必须相同（由 gate.py 管）
 *
 * 为什么 A 和 B 不能合并成一条「跑一遍看看」：
 *   只验 B 的话，一个「顺手把默认行为也改了」的提交会一路绿灯——它自己是可复现的。
 *   只验 A 的话，确定性有没有真的落地根本没测到。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sleep, launch, open, lockViewport, closeTab } = require('./cdp.js');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt;
}
const flag = name => process.argv.includes('--' + name);

const HTML = path.resolve(arg('html', 'dist/rainy-night-konbini.html'));
const W = +arg('w', 1600), H = +arg('h', 900), DPR = +arg('dpr', 1);
const GPU = arg('gpu', 'swiftshader');
const T = arg('t', '3');
const TIMEOUT = +arg('timeout', 180);
const QUICK = flag('quick');

let fails = 0;
function ok(name, pass, detail) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!pass) fails++;
}
const md5 = b => crypto.createHash('md5').update(b).digest('hex');

async function waitReady(cdp, label) {
  const deadline = Date.now() + TIMEOUT * 1000;
  let last = '';
  for (;;) {
    last = await cdp.eval(`(function(){
      var s = window.__shot;
      if (!s) return 'LEGACY';
      if (s.errors && s.errors.length) return 'ERRORS:' + s.errors.join(' | ');
      if (document.readyState !== 'complete') return 'LOADING(' + document.readyState + ')';
      return s.ready ? 'READY' : 'WAIT frame=' + s.frame;
    })()`);
    if (last === 'READY') return true;
    if (last.startsWith('ERRORS:')) { ok(label + ' · protocol', false, last); return false; }
    if (Date.now() > deadline) { ok(label + ' · ready', false, 'timeout, last=' + last); return false; }
    await sleep(200);
  }
}

/* ---------- A. 默认路径没被污染 ---------- */
const CLEAN_PROBE = `(function(){
  var s = window.__shot || {};
  return JSON.stringify({
    hasShot:     !!window.__shot,
    mode:        s.mode || null,
    errors:      s.errors || [],
    randomNative: /native code/.test(String(Math.random)),
    perfNative:   /native code/.test(String(performance.now)),
    rndPatched:   typeof window.__rnd !== 'undefined',
    autoRotate:   (typeof ctrl !== 'undefined') ? ctrl.autoRotate : null,
    sceneReady:   !!(window.__SCENE_DIAGNOSTICS__ && window.__SCENE_DIAGNOSTICS__.isReady()),
    innerW:       window.innerWidth,
    innerH:       window.innerHeight,
    dpr:          window.devicePixelRatio
  });
})()`;

async function checkDefault(port) {
  const { tab, ws, cdp } = await open(port, 'file://' + HTML);
  try {
    await lockViewport(cdp, W, H, DPR);
    for (let i = 0; i < 240; i++) {
      if (await cdp.eval(`document.readyState === 'complete'`)) break;
      await sleep(500);
    }
    const r = JSON.parse(await cdp.eval(CLEAN_PROBE));
    ok('A1 场景照常起来', r.sceneReady === true);
    ok('A2 默认处于 live 模式', r.mode === 'live', 'mode=' + r.mode);
    ok('A3 Math.random 未被替换', r.randomNative === true);
    ok('A4 performance.now 未被替换', r.perfNative === true);
    ok('A5 未挂 __rnd', r.rndPatched === false);
    ok('A6 自转仍然开着', r.autoRotate === true, 'autoRotate=' + r.autoRotate);
    ok('A7 视口未被钉死', r.innerW === W && r.innerH === H, `${r.innerW}x${r.innerH} @${r.dpr}`);
    ok('A8 无协议错误', r.errors.length === 0, r.errors.join('|'));
  } finally { try { ws.close(); } catch (e) {} await closeTab(port, tab); }
}

/* ---------- B. 指定机位可复现 ---------- */
/* 每次都**另起一个 Chrome 进程**：同一个进程开两个标签会共享 GPU 进程与缓存，
   看起来「复现了」，其实只是同一条时间线被拍了两次。要验就得是独立进程。 */
async function shootProcess(port, url, label) {
  const c = launch(port, DPR, GPU);
  try {
    const { tab, ws, cdp } = await open(port, url);
    try {
      await lockViewport(cdp, W, H, DPR);
      if (!(await waitReady(cdp, label))) return null;
      const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
      return { buf: Buffer.from(s.data, 'base64'),
               eff: await cdp.eval(`JSON.stringify(window.__shot.effective)`) };
    } finally { try { ws.close(); } catch (e) {} await closeTab(port, tab); }
  } finally { c.kill(); await sleep(300); }
}

async function probeOnce(port, expr) {
  const c = launch(port, DPR, GPU);
  try {
    const { tab, ws, cdp } = await open(port, 'file://' + HTML + '?capture=1&v=1');
    try {
      for (let i = 0; i < 120; i++) {
        if (await cdp.eval(`!!window.__shot`)) break;
        await sleep(250);
      }
      return await cdp.eval(`String(${expr})`);
    } finally { try { ws.close(); } catch (e) {} await closeTab(port, tab); }
  } finally { c.kill(); await sleep(300); }
}

async function checkRepro(base) {
  /* 必须是 JSON.stringify。String(数组) 出来是 "hero,interior,..."，
     JSON.parse 会报 "Unexpected token 'h'" —— 看起来像协议坏了，其实是自己的锅。 */
  const names = JSON.parse(await probeOnce(base, 'JSON.stringify(Object.keys(window.__shot.SHOTS))'));
  console.log('  shots:', names.join(', '));
  const list = QUICK ? names.slice(0, 2) : names;
  for (const n of list) {
    const q = `capture=1&v=1&shot=${n}&t=${T}&seed=1337&dpr=${DPR}&w=${W}&h=${H}`;
    const url = 'file://' + HTML + '?' + q;
    const a = await shootProcess(base + 1, url, n + '#1');
    if (!a) { ok(`B ${n} · 首跑`, false); continue; }
    const b = await shootProcess(base + 3, url, n + '#2');
    if (!b) { ok(`B ${n} · 复跑`, false); continue; }
    const ha = md5(a.buf), hb = md5(b.buf);
    ok(`B ${n} · 两进程逐字节相同`, ha === hb, `${ha} vs ${hb}`);
    const e = JSON.parse(a.eff);
    ok(`B ${n} · 画布尺寸钉死`, e.bufferW === W * DPR && e.bufferH === H * DPR,
       `${e.bufferW}x${e.bufferH} dpr=${e.dpr}`);
  }
}

/* ---------- D. 标注层锚点全部解析成功（只在注入过的产物上验） ---------- */
async function checkLabels(port) {
    const { tab, ws, cdp } = await open(port, 'file://' + HTML + '?labels=1');
  try {
    await lockViewport(cdp, W, H, DPR);
    /* 等加载真正结束，而不是等「场景起来了」。
       标注层的脚本排在场景脚本之后，场景起来 ≠ 标注层已经跑过。 */
    for (let i = 0; i < 240; i++) {
      if (await cdp.eval(`document.readyState === 'complete'`)) break;
      await sleep(500);
    }
    await sleep(500);
    const has = await cdp.eval(`typeof window.__caption`);
    if (has === 'undefined') { console.log('SKIP  D 标注层（本产物未注入）'); return; }
    const u = await cdp.eval(`JSON.stringify(window.__caption.unresolved())`);
    ok('D1 锚点全部解析', u === '[]', 'unresolved=' + u);
    const vis = await cdp.eval(`document.querySelectorAll('#cap-layer .cap-chip').length`);
    ok('D2 标签已渲染', vis > 0, 'chips=' + vis);
    /* 双语残留：切到 en 后用 innerText 逐行扫。
       别用元素 display 判断——祖先隐藏、后代可见会骗过你。 */
    await cdp.eval(`window.__caption.setLang('en')`);
    await sleep(400);
    const zh = await cdp.eval(`(document.body.innerText||'').split('\\n').filter(function(s){return /[\\u4e00-\\u9fff]/.test(s);})`);
    ok('D3 切 EN 后无中文残留', zh.length === 0, zh.join(' / ').slice(0, 160));
  } finally { try { ws.close(); } catch (e) {} await closeTab(port, tab); }
}

(async () => {
  console.log('gate on', HTML);
  if (!fs.existsSync(HTML)) { console.error('FATAL missing', HTML); process.exit(1); }

  const base = 9500;
  let chrome = launch(base, DPR, GPU);
  try { await checkDefault(base); } finally { chrome.kill(); }
  await sleep(400);

  chrome = launch(base, DPR, GPU);
  try { await checkRepro(base); } finally { chrome.kill(); }
  await sleep(400);

  if (HTML.indexOf('labels') >= 0 || flag('labels')) {
    chrome = launch(base, DPR, GPU);
    try { await checkLabels(base); } finally { chrome.kill(); }
  }

  console.log(fails ? `\nGATE FAILED (${fails})` : '\nGATE OK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FATAL', e && e.stack || e); process.exit(1); });
