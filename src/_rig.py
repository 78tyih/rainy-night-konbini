#!/usr/bin/env python3
"""
_rig.py —— 探针 / 截图脚本共用的「运行台」。

为什么存在
==========
66 个探针各自组装自己的运行环境，于是同一段环境代码被抄了 66 遍：

    63 个文件钉死了 chromium 的**绝对**路径
        /Users/a1234/Library/Caches/ms-playwright/chromium-1243/...
    46 个文件把产物 URL 写成了**绝对**路径
        file:///Users/a1234/projects/WorkBuddy/2026-10-07-08-10-39/outputs/...
    61 个文件靠页面全局变量 `scene` 取场景

三者合起来的结果：**换一台机器、或者把仓库换个目录，整套测量就跑不起来。**
这不是某个探针写错了，是「每个探针各自组装环境」这个分工本身的问题。
（外部评审 r18 的 Kimi 通道最早指出这一点，我复核后确认属实。）

这里只做三件事，探针只写自己的断言。


一、浏览器：不再钉死路径
========================
旧写法钉死 `chromium-1243` 这个版本号。缓存里同时存在 `chromium-1234`
与 `chromium-1243`，钉死 1243 以后升级 playwright 就会断。

**为什么不能简单去掉 executable_path（实测结论，别想当然）：**

    launch(headless=True)                      → 失败
      Executable doesn't exist at .../chromium_headless_shell-1243/.../chrome-headless-shell

本机装了 `chromium-1234` + `chromium_headless_shell-1234`，却**只有**
`chromium-1243`、没有配对 headless_shell。headless=True 时 playwright 会去找
headless shell，于是报错。**这正是当初写死路径的原因。**

实测两种都可用：
  A. `launch(headless=True, channel='chromium')`        不需要任何路径 ← 推荐
  B. `launch(headless=True, executable_path=<扫到的>)`   扫描缓存里最新的完整版

本模块两者都提供：`launch()` 用 A（新代码请用它）；
`CHROME` 用 B 的扫描结果（给沿用 `executable_path=CHROME` 的老探针）。
环境变量 `KONBINI_CHROME` 优先于两者。

    KONBINI_CHROME=/path/to/chrome python3 src/probe_fascia.py


二、产物 URL：相对本文件解析
============================
优先级：`--file PATH`  >  `$KONBINI_HTML`  >  默认产物。
三种写法都相对 `src/` 解析，所以仓库整体搬到别处不影响。
产物不存在时**直接报错退出**，不静默跑一个空场景。

    python3 src/probe_fascia.py --file outputs/rainy-night-konbini.html
    KONBINI_HTML=/tmp/other.html python3 src/gate_build.py


三、场景取用：先走诊断桥
========================
产物侧的约定（见 `build.py` 的 HEAD 模板）：

    window.__SCENE_DIAGNOSTICS__ = {
      getScene: () => scene, getCamera: () => camera, getRenderer: () => renderer
    }

探针侧的取法，按优先级：

    _rig.SCENE     —— 一段 JS 表达式，可嵌进 probe 自己的 evaluate 里
    _rig.scene(page) —— 直接在当前页取一次，取不到就**抛错**

「取不到就抛错」是关键。旧写法假定 `scene` 一定在，取不到时
`scene.traverse(...)` 会抛 TypeError 被吞掉，或者遍历到 0 个对象 ——
而「遍历到 0 个」在断言里常常表现为**通过**。
把「拿不到场景」和「场景里没有这个东西」混为一谈，正是静默失效的来源。

注意：本项目的产物是**不包裹**的顶层拼接，`scene` 是全局词法绑定，
所以老的裸 `scene` 写法仍然可用。本模块不删除那条兼容路径 ——
但新写的探针请用 `_rig.SCENE`。
"""

import os
import pathlib
import sys

# ── 一、浏览器 ────────────────────────────────────────────────────────

# headless 下要跑 WebGL，必须走软件光栅。这三个开关与目录无关，保留。
ARGS = [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
]

# playwright 把浏览器缓存在这些位置（按平台）
_CACHE_DIRS = [
    '~/Library/Caches/ms-playwright',     # macOS
    '~/.cache/ms-playwright',             # Linux
    '~/AppData/Local/ms-playwright',      # Windows
]

# 缓存里「完整版 chromium」的相对 glob（注意：不是 headless_shell）
_CHROMIUM_GLOBS = [
    'chromium-[0-9]*/chrome-mac-arm64/*.app/Contents/MacOS/*',   # macOS arm64
    'chromium-[0-9]*/chrome-mac/*.app/Contents/MacOS/*',         # macOS x64
    'chromium-[0-9]*/chrome-linux/chrome',                       # Linux
    'chromium-[0-9]*/chrome-linux64/chrome',                     # Linux (新)
    'chromium-[0-9]*/chrome-win/chrome.exe',                     # Windows
]

# 系统装的 Chrome / Chromium（缓存里没有时的兜底）
_SYSTEM_GLOBS = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
]


def _version_key(path):
    """从路径里抽 chromium-<N> 的 N，用来挑最新的那个。抽不到算 0。"""
    import re
    m = re.search(r'chromium-(\d+)', path)
    return int(m.group(1)) if m else 0


def discover_chrome():
    """扫一个可用的 chromium 可执行文件。

    顺序：$KONBINI_CHROME → playwright 缓存里**最新**的完整 chromium
          → 系统 Chrome → None（并打印诊断）

    挑「最新」而不是钉版本，是这次修复的要点：换机器 / 升级 playwright
    之后仍然找得到，而不再依赖 1243 这个具体数字。
    """
    import glob

    env = os.environ.get('KONBINI_CHROME')
    if env:
        if not os.path.exists(env):
            sys.exit('[_rig] $KONBINI_CHROME 指向的文件不存在：%s' % env)
        return env

    found = []
    for d in _CACHE_DIRS:
        base = os.path.expanduser(d)
        for g in _CHROMIUM_GLOBS:
            found += glob.glob(os.path.join(base, g))
    # 只保留「看起来像可执行文件」的：完整 chromium 的叶子名不含 ABOUT/LICENSE
    found = [f for f in found
             if os.path.isfile(f) and os.access(f, os.X_OK)
             and os.path.basename(f).lower() not in ('about', 'license', 'notice')]
    if found:
        return sorted(found, key=_version_key)[-1]

    for g in _SYSTEM_GLOBS:
        if os.path.isfile(g) and os.access(g, os.X_OK):
            return g

    return None


CHROME = discover_chrome()


def launch(p, headless=True, **kw):
    """推荐的启动入口。不传任何路径就用 channel='chromium'。

    p 可以是 sync 或 async 的 playwright 对象（调用方负责 await）。

        # sync
        with sync_playwright() as p:
            b = _rig.launch(p)
        # async
        async with async_playwright() as p:
            b = await _rig.launch(p)
    """
    kw.setdefault('args', ARGS)
    if CHROME:
        return p.chromium.launch(headless=headless, executable_path=CHROME, **kw)
    return p.chromium.launch(headless=headless, channel='chromium', **kw)

# ── 二、产物 URL ──────────────────────────────────────────────────────

SRC = pathlib.Path(__file__).resolve().parent
PROJECT = SRC.parent
DEFAULT_HTML = PROJECT / 'outputs' / 'rainy-night-konbini.html'


def cli_file(argv=None):
    """从命令行取 `--file PATH`。取不到返回 None。

    ⚠ 参数畸形时**报错退出，不静默回落到默认产物**。
    -----------------------------------------------------------------
    这条是踩出来的：我写测试循环时把参数拼成一个字符串再展开，
    而 **zsh 不做单词切分**，于是 `--file /tmp/x.html` 以**单个** argv
    元素传了进来。旧实现两个分支都不匹配 → 返回 None → 悄悄测了默认产物
    → 反例打印 PASS。

    「以为是 A，其实测的是 B」比报错危险得多，所以这里必须炸。
    """
    argv = sys.argv[1:] if argv is None else list(argv)
    for i, a in enumerate(argv):
        if a == '--file':
            if i + 1 >= len(argv):
                sys.exit('[_rig] --file 后面没有跟路径')
            return argv[i + 1]
        if a.startswith('--file='):
            val = a.split('=', 1)[1]
            if not val:
                sys.exit('[_rig] --file= 后面是空的')
            return val
        # 典型错法：--file 与路径被当成同一个参数（shell 没做单词切分）
        if a.startswith('--file ') or a.startswith('--file\t'):
            sys.exit(
                '[_rig] --file 与路径被当成**同一个**参数传进来了：\n'
                '       %r\n'
                '       shell 没有做单词切分。请写成 --file PATH 两个独立参数。' % a
            )
    return None


def html_path(argv=None):
    """产物路径。优先级：--file > $KONBINI_HTML > 默认。不检查存在性。"""
    raw = cli_file(argv) or os.environ.get('KONBINI_HTML') or DEFAULT_HTML
    p = pathlib.Path(raw)
    return p if p.is_absolute() else (PROJECT / p)


def url(argv=None):
    """产物 file:// URL。产物不存在则报错退出 —— 不静默跑空场景。"""
    p = html_path(argv).resolve()
    if not p.exists():
        sys.exit(
            '[_rig] 产物不存在：%s\n'
            '       用 --file PATH 指定，或设 $KONBINI_HTML。' % p
        )
    return p.as_uri()


# ── 三、场景取用 ──────────────────────────────────────────────────────

# 一段**表达式**（不是语句），可嵌进探针自己的 evaluate 里：
#
#     const scene = %s;      // ← 注意看下面那条 TDZ 的坑
#     scene.traverse(...);
#
# 顺序：诊断桥 → 全局 scene → null。
#
# ⚠ 为什么全局那一步要用间接 eval，而不是直接写 `typeof scene !== 'undefined'`
# ---------------------------------------------------------------------------
# 上一版写成：
#
#     const scene = (function(){ ... if (typeof scene !== 'undefined') return scene; ... })();
#     ^^^^^^^^^^^   这里的 `scene` 解析到的是**正在初始化的这个 const 自己**，
#                   不是页面全局 → ReferenceError: Cannot access 'scene'
#                   before initialization（暂时性死区 TDZ）。
#
# 阴险之处：**有诊断桥时它被短路掩盖**（`if(s) return s` 先返回了），
# 只有把桥去掉的反例才暴露。这个 bug 就是本项目的 cf_nobridge 反例抓出来的
# —— 「没红过的断言只是装饰」这句话对工具代码本身同样成立。
#
# 间接 eval `(0, eval)(...)` 在**全局作用域**求值，看不到外层局部 const，
# 因此既能拿到顶层 `const scene`，又不会撞上 TDZ。
#
# ⚠ 第二条坑：`id="scene"` 的 <canvas> 会被浏览器自动挂成 `window.scene`
# ---------------------------------------------------------------------------
# 这是被 cf_sealed 反例抓出来的：把真正场景封进 IIFE 之后，`typeof window.scene`
# 依然是 `'object'` —— 因为 `<canvas id="scene">` 有一个同名的**命名访问**
# （named access on window）。它不是 THREE.Scene：`isScene` 为 undefined、
# `children.length` 为 0。
#
# 危害在于「truthy 就算数」的判据会把它当成场景：老写法里
# `scene.traverse(...)` 会在一个 canvas 元素上抛 TypeError，异常被吞掉，
# 遍历到 0 个对象，然后断言往往表现为**通过**。这是一条真实存在的静默失效通道。
#
# 所以判据必须是**结构性的**：有 isScene 标记 + 有 traverse 方法。
def _js_ok():
    return "function ok(s){return !!s&&s.isScene===true&&typeof s.traverse==='function';}"


SCENE = (
    "(function(){" + _js_ok() +
    "var d=window.__SCENE_DIAGNOSTICS__;"
    "if(d&&typeof d.getScene==='function'){try{var b=d.getScene();if(ok(b))return b;}catch(e){}}"
    "try{var g=(0,eval)('typeof scene!==\"undefined\"?scene:null');if(ok(g))return g;}catch(e){}"
    "return null;})()"
)


class SceneUnreachable(RuntimeError):
    """场景拿不到。区别于「场景里没有某个对象」。"""


def scene(page, what='场景对象'):
    """在当前页取一次场景；取不到抛 SceneUnreachable，**不返回空**。

    返回 'bridge' 或 'global'，说明是从哪条路拿到的。
    """
    expr = (
        "(function(){" + _js_ok() +
        "var d=window.__SCENE_DIAGNOSTICS__;"
        "if(d&&typeof d.getScene==='function'){try{if(ok(d.getScene()))return 'bridge';}catch(e){}}"
        "try{var g=(0,eval)('typeof scene!==\"undefined\"?scene:null');if(ok(g))return 'global';}catch(e){}"
        "return null;})()"
    )
    try:
        src = page.evaluate(expr)
    except Exception:
        src = None
    if not src:
        raise SceneUnreachable(
            '[_rig] 取不到%s。\n'
            '       产物既没有可用的 window.__SCENE_DIAGNOSTICS__.getScene()，\n'
            '       也没有全局 THREE.Scene。\n'
            '       常见陷阱：<canvas id="scene"> 会让 window.scene 变成一个\n'
            '       canvas 元素 —— 它 truthy，但没有 traverse。\n'
            '       这**不等于**「场景里没有这个东西」—— '
            '不可测必须显式失败，不能当成通过。' % what
        )
    return src


def diagnostics_ready(page):
    """产物是否提供了**可用**的诊断桥。True/False，不抛错。"""
    return bool(page.evaluate(
        "(function(){" + _js_ok() +
        "var d=window.__SCENE_DIAGNOSTICS__;"
        "if(d&&typeof d.getScene==='function'){try{return ok(d.getScene());}catch(e){return false;}}"
        "return false;})()"
    ))


def require_scene(page, what='场景对象'):
    """探针开跑前的体检：场景取不到就**抛错**，而不是让后面静默测 0 个。

    这是给「沿用裸 scene 写法的老探针」用的 —— 它们自己不查，但
    由调用方统一查一次，就能把「拿不到场景」和「场景里没有这个东西」
    这两种完全不同的情况分开。
    """
    return scene(page, what)


if __name__ == '__main__':
    print('SRC            =', SRC)
    print('PROJECT        =', PROJECT)
    print('默认产物        =', DEFAULT_HTML, '(exists=%s)' % DEFAULT_HTML.exists())
    print('CHROME         =', CHROME or '(扫不到；launch() 会退回 channel="chromium")')
    print('  ^ 版本        =', _version_key(CHROME) if CHROME else '-')
    print('KONBINI_CHROME =', os.environ.get('KONBINI_CHROME') or '(未设置)')
    print('KONBINI_HTML   =', os.environ.get('KONBINI_HTML') or '(未设置)')
    print('--file         =', cli_file() or '(未给)')
    try:
        print('url()          =', url())
    except SystemExit as e:
        print('url() 报错     :', e)
