import pathlib, sys

# 相对本文件解析，不再写死工程绝对路径 —— 否则整个仓库存到别处就构建不了
SRC = pathlib.Path(__file__).resolve().parent
ROOT = SRC.parent
OUT = ROOT / 'outputs' / 'rainy-night-konbini.html'

for _i, _a in enumerate(sys.argv):
    if _a == '--out' and _i + 1 < len(sys.argv):
        OUT = pathlib.Path(sys.argv[_i + 1]).resolve()

THREE = (SRC / 'three.min.js').read_text(encoding='utf-8')
chunks = sorted(p for p in SRC.glob('0*.js'))
game = '\n'.join('/* ---- %s ---- */\n%s' % (p.name, p.read_text(encoding='utf-8')) for p in chunks)

# ── 诊断桥 ─────────────────────────────────────────────────────────────
# 为什么必须有：探针要测量场景，就得先拿到 scene / camera / renderer。
# 老探针的做法是直接引用页面全局变量 `scene`，这在「顶层拼接、不包裹」
# 的产物上能用，但一旦有人把代码包进 IIFE 或 ES module，**所有探针会同时
# 瞎掉**，而且是静默的：遍历到 0 个对象，断言常常表现为「通过」。
#
# 所以产物主动提供一个稳定接口。用 getter 而不是快照，是因为这段脚本
# 可能在对象建好之前就执行；getter 在被调用那一刻才取值，时序无关。
#
#   注意：bridge 是**可选的**，不是契约的全部。探针侧应当先试 bridge，
#   再退回落全局变量（见 src/_rig.py 的 SCENE 表达式）。
RIG = """(function () {
  var pick = function (name, get) {
    try { return get() || null; } catch (e) { return null; }
  };
  window.__SCENE_DIAGNOSTICS__ = {
    version: 1,
    getScene:    function () { return pick('scene',    function () { return scene; }); },
    getCamera:   function () { return pick('camera',   function () { return camera; }); },
    getRenderer: function () { return pick('renderer', function () { return renderer; }); },
    /* 就绪标记：探针不该靠 sleep 猜时序 */
    isReady: function () {
      try { return !!(scene && camera && renderer); } catch (e) { return false; }
    }
  };
})();"""

HEAD = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>雨夜便利店街角 · 微缩场景</title>
<style>
  html, body { margin:0; padding:0; height:100%; overflow:hidden; background:#05070f; }
  body { -webkit-tap-highlight-color: transparent; }
  #scene { display:block; width:100%; height:100%; touch-action:none; cursor:grab; }
  #scene:active { cursor:grabbing; }
  /* frame-vignette only, no UI chrome */
  #vig { position:fixed; inset:0; pointer-events:none;
         background: radial-gradient(ellipse 78% 72% at 50% 46%, rgba(0,0,0,0) 42%, rgba(3,5,12,0.55) 100%); }
</style>
</head>
<body>
<canvas id="scene"></canvas>
<div id="vig"></div>
<script>
__THREE__
</script>
<script>
__GAME__
</script>
<script>
__RIG__
</script>
</body>
</html>
"""

html = (HEAD.replace('__THREE__', THREE)
            .replace('__GAME__', game)
            .replace('__RIG__', RIG))
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(html, encoding='utf-8')
print('built:', OUT, round(OUT.stat().st_size / 1024, 1), 'KB')
print('chunks:', [p.name for p in chunks])
