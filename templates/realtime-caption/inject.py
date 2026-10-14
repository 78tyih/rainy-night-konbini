#!/usr/bin/env python3
"""把「图内双语」标注层注入到一个已有的单文件 HTML 里，产出第二个单文件 HTML。

    python3 inject.py --in dist/rainy-night-konbini.html \
                      --labels labels.konbini.json \
                      --out docs/labels.html

为什么是「注入出第二份」而不是「改原文件」：
  场景本体（dist/）必须保持纯净——它是确定性截图流水线的输入，多一个 UI 层
  就多一处污染。标注页是**旁支产物**：同一份场景，多一层可切换的说明。
  这样标注层怎么改都不会动到截图基线。

为什么用字符串拼接而不是往 head 里插 <script src>：
  单文件 HTML 的价值就是断网可开。外链一断，标注层就静默消失，页面还照常显示，
  看起来「没问题」。内联是这条约束的一部分，不是风格偏好。
"""
import argparse, json, pathlib, re, sys

HERE = pathlib.Path(__file__).resolve().parent


def strip_json_comments(text):
    """labels 文件带注释更好读，但 json 模块不吃。去掉 // 与 /* */（不处理字符串内的）。"""
    out, i, n = [], 0, len(text)
    while i < n:
        c = text[i]
        if c == '"':
            j = i + 1
            while j < n:
                if text[j] == '\\':
                    j += 2
                    continue
                if text[j] == '"':
                    break
                j += 1
            out.append(text[i:j + 1])
            i = j + 1
        elif text.startswith('/*', i):
            j = text.find('*/', i + 2)
            i = n if j < 0 else j + 2
        elif text.startswith('//', i):
            j = text.find('\n', i)
            i = n if j < 0 else j
        else:
            out.append(c)
            i += 1
    return ''.join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--in', dest='src', required=True)
    ap.add_argument('--labels', default=str(HERE / 'labels.konbini.json'))
    ap.add_argument('--runtime', default=str(HERE / 'caption.js'))
    ap.add_argument('--out', required=True)
    a = ap.parse_args()

    src = pathlib.Path(a.src).resolve()
    out = pathlib.Path(a.out).resolve()
    html = src.read_text(encoding='utf-8')

    labels = json.loads(strip_json_comments(pathlib.Path(a.labels).read_text(encoding='utf-8')))
    runtime = pathlib.Path(a.runtime).read_text(encoding='utf-8')

    # 锚点引用必须能在产物里查得到，否则标签会静默不显示。构建期先自证一遍。
    missing = [l['id'] for l in labels
               if not (l.get('anchor', {}).get('ref')
                       or l.get('anchor', {}).get('refPrefix')
                       or l.get('anchor', {}).get('world')
                       or l.get('anchor', {}).get('screen'))]
    if missing:
        sys.exit('labels without a resolvable anchor: %s' % ', '.join(missing))

    refs = [l['anchor']['ref'] for l in labels if l.get('anchor', {}).get('ref')]
    prefixes = [l['anchor']['refPrefix'] for l in labels if l.get('anchor', {}).get('refPrefix')]
    unresolved = []

    # 场景里大量名字是拼出来的（'PIER_' + 'FRONT'、'UTIL_POLE_' + '21'），
    # 字面量永远查不到。所以先收集所有拼接前缀，再按「字面量 OR 前缀」判定。
    concat = set(re.findall(r"name\s*=\s*['\"]([^'\"]+)['\"]\s*\+", html))
    for r in refs:
        if r in html:
            continue
        if not any(r.startswith(p) for p in concat):
            unresolved.append('ref:' + r + '（既非字面量，也不属于任一拼接前缀：'
                              + ', '.join(sorted(concat)[:6]) + ' …）')
    for p in prefixes:
        if p not in html and not any(p.startswith(c) for c in concat):
            unresolved.append('refPrefix:' + p)
    if unresolved:
        sys.exit('anchor(s) not found in built html: %s\n'
                 '—— 锚点解析失败是静默的：标签不显示、页面不报错。构建期就拦住。'
                 % ', '.join(unresolved))

    # ── 渲染器闸门 ────────────────────────────────────────────────────────
    # 写进 <script> 元素里的文本，哪怕只是注释，只要出现字面量 </script，
    # HTML 解析器就会在那里闭合 script 元素。后面的代码变成正文：不执行、
    # 不报错、控制台干净，页面照常显示。这个坑第一次注入时就踩到了——
    # 12 KB 的 caption.js 被吞掉，我对着「标签怎么不出现」查了半天。
    # 标准解法是把 </script 里的斜杠转义：在注释里是普通字符，在字符串里是合法转义。
    def esc(t):
        return re.sub(r'</(script)', r'<\\/\1', t, flags=re.I)

    labels_js = esc(json.dumps(labels, ensure_ascii=False, indent=1))
    runtime_js = esc(runtime)

    # 光转义 </script 还不够：载荷里若还有一个孤立的 <script（没有斜杠），
    # 也会把解析器带进奇怪的恢复路径。载荷里一个都不许有。
    for nm, payload in (('labels', labels_js), ('runtime', runtime_js)):
        if re.search(r'<script', payload, re.I):
            sys.exit('injected %s contains a literal "<script"; it must not' % nm)

    opens_before = len(re.findall(r'<script', html, re.I))

    block = ('<script>\nwindow.__CAPTION_LABELS__ = %s;\n</script>\n'
             '<script>\n/* ---- realtime-caption/ ---- */\n%s\n</script>\n'
             % (labels_js, runtime_js))

    if '</body>' in html:
        html = html.replace('</body>', block + '</body>', 1)
    else:
        html += '\n' + block

    # 注入后数一遍：开闭必须配平，且总数正好是原来的 + 2。
    # 不配平说明上面那个坑又回来了，直接失败，不产出一份「看着正常」的坏页面。
    opens = len(re.findall(r'<script', html, re.I))
    closes = len(re.findall(r'</script>', html, re.I))
    if opens != closes or opens != opens_before + 2:
        sys.exit('script tags unbalanced after injection: %d open / %d close '
                 '(expected %d, had %d before)'
                 % (opens, closes, opens_before + 2, opens_before))

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding='utf-8')
    print('injected %d labels -> %s (%.1f KB); script tags %d/%d balanced'
          % (len(labels), out, out.stat().st_size / 1024, opens, closes))


if __name__ == '__main__':
    main()
