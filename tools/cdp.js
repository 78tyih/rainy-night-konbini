/* tools/cdp.js — 零依赖 CDP 底座（Chrome headless + 全局 WebSocket，Node 22）
 * 被 tools/shot.js 与 tools/gate.js 共用：一处踩坑，两处都记住。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/* 路径不写死：CI 上 Chrome 在别处（ubuntu runner 是 /usr/bin/google-chrome）。
   写死路径的表现是「本地全绿、CI 全红」，而且报错是 spawn ENOENT，看不出是路径问题。 */
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout ' + method)); }
      }, 60000);
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  }
}

async function newTab(port, url) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
      return await r.json();
    } catch (e) { await sleep(250); }
  }
  throw new Error('chrome devtools not reachable');
}

/* 为什么这里列了这么多 flag：
   headless 下 Chrome 会按自己的判断节流后台标签、缩放窗口、改 deviceScaleFactor。
   每一条都会让「同一份 URL 出两张不同的图」，所以全部显式关掉。
   setDeviceMetricsOverride 另说：--window-size 只能请求，不能保证，
   真正锁住视口的是那个 CDP 调用（见 lockViewport）。 */
function launch(port, dpr, gpu) {
  /* 每次都给一个**全新的一次性 profile**。不这么做的话 Chrome 用默认 profile，
     磁盘缓存会把上一次的 file:// 内容喂给下一次——表现是「页面没变」，
     而且更坏：它会让「两次截图逐字节相同」这种结论变成缓存制造的假象。
     这个坑是在查「注入的代码为什么没执行」时撞出来的：
     改了文件、字节数都变了，DOM 还是老的那一份。 */
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'konbini-profile-'));
  const p = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`,
    '--user-data-dir=' + udd,
    '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars',
    '--force-device-scale-factor=' + dpr,
    '--use-angle=' + gpu, '--enable-unsafe-swiftshader',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=CalculateNativeWinOcclusion',
    'about:blank'
  ], { stdio: 'ignore' });
  /* kill 必须**幂等并可注销**：一次 gate 会起十几个 Chrome，
     每次都挂一个 process.on('exit') 会撞 MaxListenersExceededWarning，
     而且退出时那十几个监听器全都还会跑一遍。 */
  let killed = false;
  const kill = () => {
    if (killed) return;
    killed = true;
    process.removeListener('exit', kill);
    try { p.kill(); } catch (e) {}
    try { fs.rmSync(udd, { recursive: true, force: true }); } catch (e) {}
  };
  process.on('exit', kill);
  return { proc: p, kill };
}

async function open(port, url) {
  const tab = await newTab(port, url);
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = new CDP(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  return { tab, ws, cdp };
}

async function lockViewport(cdp, w, h, dpr) {
  await cdp.send('Emulation.setDeviceMetricsOverride',
    { width: w, height: h, deviceScaleFactor: dpr, mobile: false });
}

async function closeTab(port, tab) {
  try { await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`, { method: 'PUT' }); } catch (e) {}
}

module.exports = { CDP, sleep, launch, open, lockViewport, closeTab, newTab, CHROME };
