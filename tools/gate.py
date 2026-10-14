#!/usr/bin/env python3
"""构建侧闸门：不启动浏览器，纯 Python 就能验的三件事。

    python3 tools/gate.py

  C. 构建可复现 —— 同一份源码构建两次，产物 md5 必须相同。
     坏了的表现非常隐蔽：产物能跑、能看、截图也能出，只是每次都不一样。
     于是「回归基线」永远对不上，而你会以为是截图流水线不稳定。
  D. 源码块顺序 —— 00_shot.js 必须排在 01_boot.js 之前。
     种子化 PRNG 若装在场景块之后，构建期消费掉的 Math.random 就补不回来，
     首帧仍然不可复现。这个错误不会报错，只会让 PSNR 一直上不去。
  E. 语法检查 —— 每个源码块都能被 node --check 过。
     拼接式构建里，一个块的语法错误要等到浏览器里才炸，而且报的行号是拼接后的。
"""
import hashlib
import pathlib
import re
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'src'
BUILD = SRC / 'build.py'


def md5_of(p):
    return hashlib.md5(p.read_bytes()).hexdigest()


def main():
    fails = 0

    def ok(name, passed, detail=''):
        nonlocal fails
        print(('PASS' if passed else 'FAIL') + '  ' + name + ('  — ' + detail if detail else ''))
        if not passed:
            fails += 1

    # C. 构建可复现
    with tempfile.TemporaryDirectory() as td:
        a = pathlib.Path(td) / 'a.html'
        b = pathlib.Path(td) / 'b.html'
        subprocess.run([sys.executable, str(BUILD), '--out', str(a)], check=True, capture_output=True)
        subprocess.run([sys.executable, str(BUILD), '--out', str(b)], check=True, capture_output=True)
        ha, hb = md5_of(a), md5_of(b)
        ok('C1 两次构建逐字节相同', ha == hb, '%s vs %s' % (ha, hb))
        ok('C2 产物非空', a.stat().st_size > 100_000, '%.1f KB' % (a.stat().st_size / 1024))

        committed = ROOT / 'dist' / 'rainy-night-konbini.html'
        if committed.exists():
            hc = md5_of(committed)
            ok('C3 dist/ 与源码同步', hc == ha,
               'dist=%s build=%s（不同则说明有人改了源码没重新构建）' % (hc[:8], ha[:8]))

    # D. 源码块顺序
    chunks = sorted(p.name for p in SRC.glob('0*.js'))
    ok('D1 00_shot.js 排在 01_boot.js 之前',
       '00_shot.js' in chunks and '01_boot.js' in chunks
       and chunks.index('00_shot.js') < chunks.index('01_boot.js'),
       ' < '.join(chunks))

    # E. 语法检查
    node = None
    for cand in ('node', '/usr/local/bin/node', '/opt/homebrew/bin/node'):
        try:
            subprocess.run([cand, '--version'], check=True, capture_output=True)
            node = cand
            break
        except Exception:
            continue
    if not node:
        print('SKIP  E 语法检查（找不到 node）')
    else:
        for p in chunks:
            r = subprocess.run([node, '--check', str(SRC / p)], capture_output=True, text=True)
            ok('E ' + p, r.returncode == 0, r.stderr.strip().splitlines()[0] if r.returncode else '')

    # F. 协议版本号：产物里必须能找到 v=1，且 00_shot 暴露 shots 列表
    built = (SRC.parent / 'dist' / 'rainy-night-konbini.html').read_text(encoding='utf-8', errors='replace')
    ok('F1 产物含 __shot 协议', 'window.__shot' in built)
    ok('F2 产物含 SHOTS 机位表', 'moonshadow' in built)
    m = re.search(r"unsupported protocol version v=", built)
    ok('F3 产物含版本校验', bool(m))

    print()
    print('GATE FAILED (%d)' % fails if fails else 'GATE OK')
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
