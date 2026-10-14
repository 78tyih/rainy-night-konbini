/* ================= realtime-caption · 实时渲染「图内双语」标注层 =================
 *
 * 一个零依赖的覆盖层：贴在**正在实时运行**的 3D 画面上，把说明文字画进图里，
 * 而不是画在旁边的表格里。图内双语 = 同一张图，中文 / 英文两套文案，随时切。
 *
 * 用法（注入到一个已存在的单文件 HTML 末尾即可，不需要改场景代码）：
 *   〔script〕window.__CAPTION_LABELS__ = [ ... ];〔/script〕
 *   〔script〕{ 本文件内容 }〔/script〕
 *
 * 注意上面那两行：这里**故意不写真的尖括号 script 标签**。
 * 写在脚本元素里的 JS，哪怕只是注释，只要出现字面量「小于号 斜杠 script」，
 * HTML 解析器就会在那里把脚本元素闭合掉 —— 后面的代码变成正文：不执行、
 * 不报错、控制台干干净净。这个坑在本文件第一次注入时就踩到了，
 * 12 KB 的代码被吞，我对着「标签怎么不出来」查了很久。
 * inject.py 会再做一道兜底：注入前把该序列转义，并拒绝任何含孤立标签的载荷。
 *
 * 标签 JSON 契约：
 *   {
 *     "id":   "roof",                    // 稳定 id，切换语言时保持同一条
 *     "anchor": { "ref": "ROOF_CAP" },   // 方式 A：按场景对象名解析（几何动了标签跟着走）
 *              { "refPrefix": "SPILL_POOL_" },          // 名字带序号时用前缀
 *              { "world": [x, y, z] },                  // 方式 B：世界坐标，逐帧投影
 *              { "screen": [u, v] },                    // 方式 C：归一化屏幕坐标 0..1
 *     "offset": [0, 0.3, 0],             // 可选：世界坐标偏移，把锚点抬到面之上
 *     "chip":  [96, -46],                // 标签框相对锚点的像素偏移（会自动防越界翻转）
 *     "zh": "屋顶压顶",  "en": "Roof cap" // 两套文案，缺一则回退到另一套
 *   }
 *
 * URL 协议：
 *   ?lang=zh|en      语言
 *   ?theme=night|day  标注层配色（与画面本体无关，只管标注）
 *   ?labels=0         整层关闭 —— 截图流水线用它拿干净画面
 *   ?capture=1        确定性截图模式；此时若未显式指定 labels，默认关闭标注层，
 *                     避免「截图里混进 UI」这种最难查的污染
 *
 * 为什么锚点要能按对象名解析：
 *   screen 坐标一旦写死就是第二份真值——相机一改、机位一加，所有标签全歪，
 *   而且不报错。按对象名解析，锚点由几何自己算出来，永远不会和模型脱节。
 */
(function () {
  var QS = null;
  try { QS = new URLSearchParams(location.search); } catch (e) { QS = null; }
  function q(k) { return QS ? QS.get(k) : null; }

  var LABELS = window.__CAPTION_LABELS__ || [];
  var CAPTURE = q('capture') === '1';
  var lang = q('lang') === 'en' ? 'en' : 'zh';
  var theme = q('theme') === 'day' ? 'day' : 'night';
  var shown = q('labels') === '0' ? false : (q('labels') === '1' ? true : !CAPTURE);

  /* ---------- 样式：整层自给自足，不依赖宿主页面的 CSS ---------- */
  var CSS = [
    '#cap-layer{position:fixed;inset:0;z-index:50;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;}',
    '#cap-layer svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible;}',
    '.cap-chip{position:absolute;left:0;top:0;max-width:230px;padding:7px 11px 8px;border-radius:11px;',
    '  font-size:13px;line-height:1.35;letter-spacing:.01em;white-space:nowrap;will-change:transform;}',
    '.cap-chip b{display:block;font-size:10px;font-weight:600;letter-spacing:.14em;opacity:.62;margin-bottom:3px;text-transform:uppercase;}',
    '.cap-ctl{position:fixed;right:14px;top:14px;z-index:51;display:flex;gap:6px;pointer-events:auto;}',
    '.cap-ctl button{font:inherit;font-size:12px;padding:5px 11px;border-radius:9px;cursor:pointer;letter-spacing:.04em;}',
    /* night */
    '#cap-layer[data-theme=night] .cap-chip{background:rgba(12,16,28,.74);color:#eef2fb;border:1px solid rgba(150,175,225,.30);backdrop-filter:blur(7px);}',
    '#cap-layer[data-theme=night] .cap-chip b{color:#9db6e6;}',
    '#cap-layer[data-theme=night] .cap-lead{stroke:rgba(160,190,240,.62);}',
    '#cap-layer[data-theme=night] .cap-dot{fill:#cfe0ff;stroke:rgba(12,16,28,.9);}',
    '.cap-ctl[data-theme=night] button{background:rgba(12,16,28,.74);color:#dce6f8;border:1px solid rgba(150,175,225,.30);}',
    /* day —— 画面是夜景，标注层仍要能在浅色底上读，用于投影/打印场景 */
    '#cap-layer[data-theme=day] .cap-chip{background:rgba(255,255,255,.92);color:#141a26;border:1px solid rgba(20,26,38,.20);}',
    '#cap-layer[data-theme=day] .cap-chip b{color:#4a5876;}',
    '#cap-layer[data-theme=day] .cap-lead{stroke:rgba(20,26,38,.55);}',
    '#cap-layer[data-theme=day] .cap-dot{fill:#1d2740;stroke:rgba(255,255,255,.9);}',
    '.cap-ctl[data-theme=day] button{background:rgba(255,255,255,.92);color:#141a26;border:1px solid rgba(20,26,38,.20);}'
  ].join('\n');

  var st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);

  var layer = document.createElement('div');
  layer.id = 'cap-layer';
  layer.setAttribute('data-theme', theme);

  var svgNS = 'http://www.w3.org/2000/svg';
  var svg = document.createElementNS(svgNS, 'svg');
  layer.appendChild(svg);

  var ctl = document.createElement('div');
  ctl.className = 'cap-ctl';
  ctl.setAttribute('data-theme', theme);
  function mkBtn(zh, en) {
    var b = document.createElement('button');
    b.textContent = lang === 'zh' ? zh : en;
    b.setAttribute('data-zh', zh); b.setAttribute('data-en', en);
    ctl.appendChild(b);
    return b;
  }
  var langBtn = mkBtn('EN', '中文');
  var themeBtn = mkBtn('夜', 'DAY');
  document.body.appendChild(layer);
  document.body.appendChild(ctl);

  function setState(next) {
    if (next.lang) lang = next.lang;
    if (next.theme) theme = next.theme;
    layer.setAttribute('data-theme', theme);
    ctl.setAttribute('data-theme', theme);
    langBtn.textContent = lang === 'zh' ? 'EN' : '中文';
    themeBtn.textContent = theme === 'night' ? (lang === 'zh' ? '日' : 'DAY') : (lang === 'zh' ? '夜' : 'NIGHT');
    render();
  }
  langBtn.addEventListener('click', function () { setState({ lang: lang === 'zh' ? 'en' : 'zh' }); });
  themeBtn.addEventListener('click', function () { setState({ theme: theme === 'night' ? 'day' : 'night' }); });

  /* ---------- 锚点解析：能按对象名就按对象名，绝不写死屏幕坐标 ---------- */
  function bridge() {
    return window.__SCENE_DIAGNOSTICS__ || null;
  }
  /* 兜底取全局的 helper 里**不能**有叫 scene / camera 的局部变量：
     那样会遮蔽外层的同名绑定，typeof 永远得到 'undefined'，兜底路径静默失效。
     我第一次就是这样写的，症状是「有桥的时候一切正常」，看不出问题。 */
  function globalScene() {
    try { if (typeof scene !== 'undefined' && scene) return scene; } catch (e) {}
    try { return window.scene || null; } catch (e) { return null; }
  }
  function globalCamera() {
    try { if (typeof camera !== 'undefined' && camera) return camera; } catch (e) {}
    try { return window.camera || null; } catch (e) { return null; }
  }
  function objByRef(ref, prefix) {
    var b = bridge();
    var sc = (b && b.getScene) ? b.getScene() : globalScene();
    if (!sc) return null;
    if (prefix) {
      var hit = null;
      sc.traverse(function (o) { if (!hit && o.name && o.name.indexOf(prefix) === 0) hit = o; });
      return hit;
    }
    return sc.getObjectByName(ref) || null;
  }

  var _box = null;
  function anchorPoint(a) {
    var b = bridge();
    var cam = (b && b.getCamera) ? b.getCamera() : globalCamera();
    var THREE = window.THREE;
    if (!cam || !THREE) return null;

    if (a.screen) return { x: a.screen[0], y: a.screen[1], z: 0 };

    var p = null;
    if (a.anchor.ref || a.anchor.refPrefix) {
      var o = objByRef(a.anchor.ref, a.anchor.refPrefix);
      if (!o) return null;
      o.updateWorldMatrix(true, false);
      if (!_box) _box = new THREE.Box3();
      _box.setFromObject(o);
      if (_box.isEmpty()) return null;
      p = _box.getCenter(new THREE.Vector3());
    } else if (a.anchor.world) {
      p = new THREE.Vector3(a.anchor.world[0], a.anchor.world[1], a.anchor.world[2]);
    } else {
      return null;
    }
    if (a.offset) p.x += a.offset[0], p.y += a.offset[1], p.z += a.offset[2];

    var v = p.clone().project(cam);
    if (v.z > 1) return null;                       /* 在相机背后 */
    return { x: v.x * 0.5 + 0.5, y: -v.y * 0.5 + 0.5, z: v.z };
  }

  /* ---------- DOM 构建 ---------- */
  var items = LABELS.map(function (a) {
    var chip = document.createElement('div');
    chip.className = 'cap-chip';
    layer.appendChild(chip);

    var lead = document.createElementNS(svgNS, 'path');
    lead.setAttribute('class', 'cap-lead');
    lead.setAttribute('fill', 'none');
    lead.setAttribute('stroke-width', '1.1');
    svg.appendChild(lead);

    var dot = document.createElementNS(svgNS, 'circle');
    dot.setAttribute('class', 'cap-dot');
    dot.setAttribute('r', '2.6');
    dot.setAttribute('stroke-width', '1.2');
    svg.appendChild(dot);

    return { def: a, chip: chip, lead: lead, dot: dot };
  });

  function render() {
    items.forEach(function (it) {
      var txt = it.def[lang] || it.def.zh || it.def.en || '';
      var sup = it.def['sub_' + lang] || '';
      it.chip.innerHTML = '';
      if (sup) {
        var b = document.createElement('b');
        b.textContent = sup;
        it.chip.appendChild(b);
      }
      it.chip.appendChild(document.createTextNode(txt));
    });
  }

  var W = 0, H = 0;
  function measure() { W = window.innerWidth; H = window.innerHeight; }
  measure();
  window.addEventListener('resize', measure);

  function clampi(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function place() {
    if (!shown) return;

    /* 分两步：先把所有位置算出来，再统一解冲突，最后才写 DOM。
       一边算一边写的话，条与条之间互相看不见，重叠就治不了。
       两个锚点靠得近时标签框会叠在一起（GROUND 和 CORNER 就踩过），
       手工调 offset 只能治这一组数据；模板必须自己能撑住。 */
    var boxes = [];
    items.forEach(function (it) {
      var p = anchorPoint(it.def);
      if (!p) { boxes.push({ it: it, ok: false }); return; }
      var ax = p.x * W, ay = p.y * H;
      var c = it.def.chip || [96, -46];
      var cx = ax + c[0], cy = ay + c[1];
      var cw = it.chip.offsetWidth || 140, chh = it.chip.offsetHeight || 36;

      /* 防越界：撞到左右边就翻到另一侧，撞上下就夹住。
         不这么做，改一次机位就会有一半标签跑到画面外——而且是静默的。 */
      if (cx + cw > W - 10) cx = ax - c[0] - cw;
      cx = clampi(cx, 10, Math.max(10, W - 10 - cw));
      cy = clampi(cy, 10, Math.max(10, H - 10 - chh));

      boxes.push({ it: it, ok: true, ax: ax, ay: ay, cx: cx, cy: cy, cw: cw, ch: chh, pinned: false });
    });

    /* 贪心解重叠：谁先被放下谁不动，后来者往下让。来回两轮，够用且稳定
       （稳定很重要：抖动会让标签在动画里跳来跳去）。 */
    var live = boxes.filter(function (b) { return b.ok; });
    for (var pass = 0; pass < 2; pass++) {
      for (var i = 0; i < live.length; i++) {
        for (var j = i + 1; j < live.length; j++) {
          var a = live[i], b = live[j];
          var ox = Math.min(a.cx + a.cw, b.cx + b.cw) - Math.max(a.cx, b.cx);
          var oy = Math.min(a.cy + a.ch, b.cy + b.ch) - Math.max(a.cy, b.cy);
          if (ox <= 4 || oy <= 4) continue;
          /* 让位方向：优先往「离自己锚点反方向」推，引线才不会穿过标签框 */
          var push = oy + 6;
          b.cy = b.cy + push;
          if (b.cy + b.ch > H - 10) b.cy = Math.max(10, a.cy - b.ch - 6);
          b.cy = clampi(b.cy, 10, Math.max(10, H - 10 - b.ch));
        }
      }
    }

    boxes.forEach(function (b) {
      if (!b.ok) {
        b.it.chip.style.display = 'none';
        b.it.lead.setAttribute('d', '');
        b.it.dot.setAttribute('r', '0');
        return;
      }
      b.it.chip.style.display = '';
      b.it.chip.style.transform = 'translate(' + Math.round(b.cx) + 'px,' + Math.round(b.cy) + 'px)';

      /* 引线：锚点 → 横向折线 → 标签框靠锚点那条边的中点 */
      var edgeX = (b.cx > b.ax) ? b.cx : b.cx + b.cw;
      var edgeY = b.cy + b.ch * 0.5;
      var midX = (b.ax + edgeX) * 0.5;
      b.it.lead.setAttribute('d', 'M' + b.ax.toFixed(1) + ' ' + b.ay.toFixed(1) +
        ' L' + midX.toFixed(1) + ' ' + b.ay.toFixed(1) +
        ' L' + midX.toFixed(1) + ' ' + edgeY.toFixed(1) +
        ' L' + edgeX.toFixed(1) + ' ' + edgeY.toFixed(1));
      b.it.dot.setAttribute('r', '2.6');
      b.it.dot.setAttribute('cx', b.ax.toFixed(1));
      b.it.dot.setAttribute('cy', b.ay.toFixed(1));
    });
  }

  function loop() { place(); requestAnimationFrame(loop); }

  function apply() {
    layer.style.display = shown ? '' : 'none';
    ctl.style.display = shown ? '' : 'none';
    if (shown) { measure(); render(); place(); }
  }
  apply();
  if (shown) requestAnimationFrame(loop);

  /* 给外部（探针 / 未来的流水线）一个开关，不必靠改 URL 再刷新 */
  window.__caption = {
    v: 1,
    get state() { return { lang: lang, theme: theme, shown: shown, count: items.length }; },
    setLang: function (l) { setState({ lang: l }); },
    setTheme: function (t) { setState({ theme: t }); },
    show: function (on) { shown = !!on; apply(); },
    /* 未解析成功的锚点：这类静默失败必须能被查出来 */
    unresolved: function () {
      return items.filter(function (it) { return !anchorPoint(it.def); }).map(function (it) { return it.def.id; });
    }
  };
})();
