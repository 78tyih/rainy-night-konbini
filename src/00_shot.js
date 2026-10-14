/* ============ 00 shot · 确定性截图模式（协议 + 种子 + 虚拟时钟 + 钉死视口） ============

为什么这个文件必须排在所有场景块之前（文件名以 00 开头就是为了这个）：
  场景在**构建期**就已经消费 Math.random()。例如 06_effects.js:437
  `const DOOR = { next: 6 + Math.random() * 12, ... }` 是在模块求值时算的，
  雨粒子的初始相位同理。如果等场景搭好再换随机源，只能冻住运行时，
  **首帧仍然不可复现**——这正是旧流水线 PSNR ≈ 31 dB 的成因之一。
  所以：种子化 PRNG、虚拟时钟、DPR 钉死，必须在 01_boot.js 之前装好。

为什么不开启 capture 时这个文件是纯空操作：
  本仓库的底线是「不加任何参数时，行为和改动前一模一样」。因此 capture 未开启时，
  除了挂一个只读的 window.__shot 供探针读取以外，不 patch 任何东西、不碰相机、
  不碰随机源、不碰时钟。任何「顺手优化」都不得越出 if (CAPTURE) 的边界。

URL 协议（v=1；capture=1 时才生效）：
  ?capture=1&v=1&shot=hero&t=8&seed=1337&dpr=1&w=1600&h=900
  ?capture=1&v=1&az=0.86&el=0.22&d=27&tx=-0.2&ty=1.35&tz=-0.5
  参数优先级：内建 hero 默认 → shot 命名机位 → 散装数值覆盖
  单位：角度一律**弧度**、距离**米**（沿用本仓库既有 ctrl 口径，不是角度制）

确定性靠四件事同时成立，缺一不可：
  1. 种子化 PRNG（构建期就生效）—— 消除 Math.random
  2. 虚拟时钟（固定步长、按帧推进）—— 消除墙钟抖动与「冻结前跑了多少帧」
  3. 相机每帧强制设为目标值（绕过阻尼）—— 消除收敛过程
  4. 固定 DPR 与画布尺寸 —— 消除像素栅格差异
  第 3 条由 06_effects.js 注册的 __SHOT_SET_HOOK__ 完成（相机在 06 里，
  那边才知道 ctrl 是什么）；第 4 条在这里钉住 window.devicePixelRatio。
*/

(function () {
  /* ---------- 命名机位：从媒体流水线搬进场景，成为单一真值 ---------- */
  /* 这些数值原样来自 deliverables 的 shots_v1.json。以前它们活在
     cdp_shot.js 里，是「流水线与场景各存一份」的重复真值：机位一改就要两边同步，
     不同步就静默腐烂。搬进来之后，流水线只传 ?shot=hero。 */
  var SHOTS = {
    hero:       { az: 0.86, el: 0.22, dist: 27, tx: -0.2, ty: 1.35, tz: -0.5 },
    interior:   { az: 0.86, el: 0.16, dist: 17, tx: -0.2, ty: 1.10, tz: -0.6 },
    storefront: { az: 0.86, el: 0.20, dist: 13, tx: -0.2, ty: 1.50, tz: -0.2 },
    ground:     { az: 1.20, el: 0.05, dist:  9, tx:  0.5, ty: 0.15, tz:  0.5 },
    corner:     { az: 2.20, el: 0.25, dist: 30, tx:  0.0, ty: 1.20, tz:  0.0 },
    moonshadow: { az: -0.5, el: 0.35, dist: 38, tx:  2.0, ty: 0.80, tz:  2.0 }
  };

  /* ---------- URL 解析 ---------- */
  var QS = null;
  try { QS = new URLSearchParams(location.search); } catch (e) { QS = null; }

  function has(k) { return QS ? QS.has(k) : false; }
  function str(k) { return QS ? QS.get(k) : null; }
  function num(k) {
    var s = str(k);
    if (s === null) return null;
    s = String(s).trim();
    if (s === '') return null;
    var n = Number(s);
    /* 绝对不能写 Number(s) || DEFAULT —— 合法的 0（tx=0、az=0）会被 || 吃掉，
       变成「参数写了但没生效」，而且不报错。这是所有 URL 参数解析都会踩一次的坑。 */
    return Number.isFinite(n) ? n : NaN;
  }

  var errors = [];
  function check(k) {
    var v = num(k);
    if (v === null) return null;
    if (v !== v) { errors.push('param ' + k + ' is not a finite number: ' + str(k)); return null; }
    return v;
  }

  var CAPTURE = str('capture') === '1';
  if (has('capture') && !CAPTURE) errors.push('capture must be exactly "1"; got ' + str('capture'));

  var version = str('v');
  if (CAPTURE && version !== null && version !== '1') {
    errors.push('unsupported protocol version v=' + version + ' (this build speaks v=1)');
  }

  /* ---------- 生效配置 ---------- */
  var cfg = {
    v: 1,
    capture: CAPTURE,
    shot: null,
    az: null, el: null, dist: null, tx: null, ty: null, tz: null,
    seed: 1337,
    t: 8.0,        /* 秒：虚拟时钟推进到这里后冻结 */
    warm: null,    /* 帧：显式覆盖 warmFrames（优先于 t） */
    dpr: 1,
    w: null, h: null,
    errors: errors
  };

  if (CAPTURE) {
    var sn = str('shot');
    if (sn !== null && sn !== '') {
      if (!SHOTS[sn]) errors.push('unknown shot "' + sn + '"; known: ' + Object.keys(SHOTS).join(', '));
      else {
        cfg.shot = sn;
        cfg.az = SHOTS[sn].az; cfg.el = SHOTS[sn].el; cfg.dist = SHOTS[sn].dist;
        cfg.tx = SHOTS[sn].tx; cfg.ty = SHOTS[sn].ty; cfg.tz = SHOTS[sn].tz;
      }
    }
    var loose = { az: 'az', el: 'el', d: 'dist', tx: 'tx', ty: 'ty', tz: 'tz' };
    for (var k in loose) {
      var v = check(k);
      if (v !== null) cfg[loose[k]] = v;
    }
    var sd = check('seed'); if (sd !== null) cfg.seed = sd;
    var tt = check('t'); if (tt !== null) cfg.t = tt;
    var wm = check('warm'); if (wm !== null) cfg.warm = Math.max(1, Math.round(wm));
    var dp = check('dpr'); if (dp !== null) cfg.dpr = Math.max(0.5, Math.min(3, dp));
    var ww = check('w'); if (ww !== null) cfg.w = Math.max(64, Math.round(ww));
    var hh = check('h'); if (hh !== null) cfg.h = Math.max(64, Math.round(hh));

    if ((cfg.w === null) !== (cfg.h === null)) {
      errors.push('w and h must be given together (got w=' + cfg.w + ' h=' + cfg.h + ')');
    }
    if (cfg.el !== null) cfg.el = Math.max(0.02, Math.min(1.45, cfg.el));
    if (cfg.dist !== null) cfg.dist = Math.max(6, Math.min(80, cfg.dist));
    if (cfg.t < 0) cfg.t = 0;
  }

  cfg.warmFrames = cfg.warm !== null ? cfg.warm : Math.max(3, Math.round(cfg.t * 60));

  /* ---------- 种子化 PRNG ---------- */
  function mulberry32(a) {
    a = a >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /* 具名流：按子系统派生独立随机流。这样「多加一滴雨」不会把后面所有子系统的
     随机布局整体平移——单流 PRNG 最容易踩的坑就是牵一发动全身。
     现有 7 个块还做不到逐点接入具名流（那要逐处改），先把口子留出来：
     window.__rnd('rain') 返回一条稳定的流，将来新代码直接用它。 */
  var STREAMS = {};
  function stream(name) {
    if (!STREAMS[name]) {
      var h = 2166136261;
      for (var i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 16777619); }
      STREAMS[name] = mulberry32((Math.imul(cfg.seed | 0, 2654435761) ^ h) >>> 0);
    }
    return STREAMS[name];
  }

  /* ---------- 视口 / DPR 钉死 ---------- */
  /* 06 的 resize() 读 window.innerWidth/innerHeight，01 的 setPixelRatio 读
     window.devicePixelRatio。三者都只在这里被改写，且只在 capture 模式下改写。
     不在 capture 模式下：一个字节都不动，走真实视口。 */
  function pin(prop, val) {
    try {
      Object.defineProperty(window, prop, {
        configurable: true, get: function () { return val; }
      });
      return true;
    } catch (e) {
      errors.push('cannot pin window.' + prop + ': ' + e.message);
      return false;
    }
  }

  var ACTIVE = CAPTURE && !errors.length;
  if (ACTIVE) {
    pin('devicePixelRatio', cfg.dpr);
    if (cfg.w !== null && cfg.h !== null) {
      pin('innerWidth', cfg.w);
      pin('innerHeight', cfg.h);
    }
  }

  /* ---------- 虚拟时钟 ---------- */
  var STEP = 1000 / 60;
  var V = { t: 0, frame: 0, frozen: false, frozenFrames: 0, step: STEP };

  /* 钩子做成**列表**而不是单个槽位：00 自己也挂一个（镜像帧状态），
     06 再挂一个（相机强制设位）。写成单槽的话后注册的会把先注册的顶掉，
     相机一动不动但帧状态永远停在 0 —— 这种 bug 不会报错，只会让探针死等。 */
  var hooks = [];
  window.__SHOT_SET_HOOK__ = function (fn) { if (typeof fn === 'function') hooks.push(fn); };

  if (ACTIVE) {
    Math.random = stream('scene');               /* 必须在场景块求值之前 */
    window.__rnd = stream;

    /* three.js 的 Clock 走 performance.now()，07 的 tick 走 rAF 时间戳。
       两个时钟都改成读同一个虚拟时钟，才谈得上「两个循环推进同样的时间」。 */
    if (typeof performance !== 'undefined' && performance.now) {
      performance.now = function () { return V.t; };
    }
    Date.now = function () { return V.t; };

    var rafOrig = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = function (cb) {
      return rafOrig(function () { return cb(V.t); });
    };

    /* 帧泵：用原始 rAF 注册，且注册早于 06/07 的循环，所以每帧它先跑，
       06 的 animate 与 07 的 tick 都读同一个已经推进过的 V.t。 */
    function pump() {
      rafOrig(pump);
      if (!V.frozen) {
        V.frame++;
        V.t = V.frame * STEP;
        if (V.frame >= cfg.warmFrames) V.frozen = true;
      }
      if (V.frozen) V.frozenFrames++;
      for (var hi = 0; hi < hooks.length; hi++) {
        try { hooks[hi](V.frame, V.t, V.frozen); }
        catch (e) { errors.push('hook[' + hi + ']: ' + (e && e.message ? e.message : e)); }
      }
      /* 就绪握手：探针不该靠 sleep 猜时序。
         冻结后的第 1 帧由本帧的 animate() 渲染出来（dt=0，状态已停），
         所以等到 frozenFrames >= 3 再报 ready：此刻画面必然已经渲染并提交过多次。
         要 3 不是 2 —— 渲染是一回事，**合成器把这一帧真正提交出去**是另一回事，
         两者之间隔着一次 compositor commit。只要留得够久，抓到的必然是冻结态。 */
      if (V.frozen && V.frozenFrames >= 3) window.__shot.ready = true;
    }
    rafOrig(pump);
  }

  /* ---------- 对外状态（探针读这个，不再注入内部变量） ---------- */
  /* effective 用 getter 而不是快照：这段脚本跑的时候 renderer 还没建出来。 */
  window.__shot = {
    v: 1,
    mode: CAPTURE ? 'capture' : 'live',
    ready: false,
    frame: 0,
    frozen: false,
    config: cfg,
    shots: Object.keys(SHOTS),
    errors: errors,
    SHOTS: SHOTS,
    get effective() {
      try {
        var c = renderer.domElement;
        return {
          cssW: window.innerWidth, cssH: window.innerHeight,
          dpr: window.devicePixelRatio,
          bufferW: c.width, bufferH: c.height,
          aspect: camera.aspect
        };
      } catch (e) { return { error: String(e && e.message ? e.message : e) }; }
    }
  };
  window.__SHOT_V__ = V;

  /* 每帧把 V 的进展镜像到 __shot 上，方便外部一次读全。放在 pump 之后、
     animate 之前的 hook 阶段做，避免再注册一个循环。 */
  if (ACTIVE) {
    window.__SHOT_SET_HOOK__(function (frame, t, frozen) {
      window.__shot.frame = frame;
      window.__shot.frozen = frozen;
      window.__shot.frozenFrames = V.frozenFrames;
    });
  }
})();
