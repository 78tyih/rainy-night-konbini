#!/usr/bin/env python3
"""prompt-selfcheck · 版本化提示词文档的四道闸门。

背景（这套闸门是被打出来才长出来的）：一份会被别人照抄的提示词文档，
一旦开始 v1→v2→v3 迭代，就会长出三类**不显眼但会误导读者**的失败：

  1. **编号断裂**——条款跳号 / 重复 / 节数对不上。文档超过 ~40 条时手数必错，
     而"第 35 条"这种引用会因此指向不存在的东西。
  2. **两版不同步**——文档里同时存在「完整版」和「可粘贴精简版」，
     改了一处忘了另一处，读者照精简版做，得到的不是你说的那个东西。
  3. **旧错复活**——某条已确认的错被"修掉"之后，又在**断言位置**冒出来。
  4. **（r20 补）回归闸门的绕过面**——豁免机制太宽、扫描有盲区、跨行可逃。

v2 的修订全部来自三通道外部评审，且**每一条都先用变异实证过才改**：
原先"同一行出现错/编/别即豁免"能被 `没错`、`编号`、`区别`、`不能`
四个自然措辞绕过；非 text 围栏块被删除后根本不检查；断言折行即逃。
详见 references/false-positives.md 案例六～案例九。

三个子命令 + 一个自测，对应四道闸门。零第三方依赖，只用标准库。

用法：
  python3 check_prompt.py numbering FILE --clauses N [--sections M] [--block SEL]
  python3 check_prompt.py sync      FULL.md SHORT.md [--full-index I] [--short-index I]
  python3 check_prompt.py regression FILE --bad PATTERN [--bad PATTERN ...]
  python3 check_prompt.py selftest

退出码：0 = 通过；1 = 失败；2 = 用法/文件/检查器错误（**不是"通过"**）。
"""
import argparse
import difflib
import re
import sys
from pathlib import Path

# ── 圈码表：①..⑳(1-20) ㉑..㉟(21-35) ㊱..㊿(36-50) ──
# 超过 50 条的文档请改用阿拉伯数字；圈码只覆盖到 50。
CIRC = {}
for i, cp in enumerate(range(0x2460, 0x2474)):
    CIRC[chr(cp)] = i + 1
for i, cp in enumerate(range(0x3251, 0x3260)):
    CIRC[chr(cp)] = i + 21
for i, cp in enumerate(range(0x32B1, 0x32C0)):
    CIRC[chr(cp)] = i + 36

SECTION_RE = re.compile(r'^═+\s*(.+?)\s*═+$', re.M)
BLOCK_RE = re.compile(r'```(\w*)\n(.*?)```', re.S)
# 语言标签白名单：提示词本体常用的几种。白名单外的块**仍会被检查**，
# 但会被单独报告，避免"```python 里的旧错没人管"这种盲区。
TEXT_LANGS = ('', 'text', 'plaintext', 'md', 'markdown')
CANON_RE = re.compile(r'<!--\s*prompt:canonical\s*-->')

# ── 订正上下文标记（v2 重修）──────────────────────────────────────────
# ⚠ 为什么从"裸子串"改成正则：原先 DEFAULT_FIX 里有 错/编/别/不能/误 这类
#   单字，于是 `这个结论没错`、`与编号 ㉔ 一致`、`二者的区别在于`、
#   `不能调整` 四个**自然措辞**都能把真复活豁免掉。已用变异实证：
#   四种写法在旧版下全部 VERDICT: PASS。
# 现在的规则：只用**多字**订正标记；单字错/编/别一律不作数。
# 代价：`旧版写法是 65%` 这种不含标记的正当引用会误报——
#   这是**有意取的偏保守**，漏报比误报危险，且误报可显式加 --fix 消。
DEFAULT_FIX = (
    r'错误', r'错了', r'是错', r'错的', r'并非', r'不对',
    r'编造', r'编的', r'是编', r'瞎编', r'虚构',
    r'笔误', r'勘误', r'更正', r'修正', r'改为', r'推翻',
    r'废弃', r'不再适用', r'已修', r'残留', r'删掉',
    r'误写', r'误植', r'转录错', r'单位.{0,4}变',
    r'曾经', r'栽过', r'打回', r'评审', r'判为', r'真凶',
    r'原\s*v\d', r'原文', r'旧版', r'前述.{0,6}不', r'⚠',
)


def _err(msg):
    """用法/文件/检查器错误 → 退出码 2。

    ⚠ 不能用 sys.exit(msg)：那会把字符串写进 stderr 并**以 1 退出**，
      于是"路径打错"和"文档真有错"无法区分——这违背自家规则 1。
      v2 实测确认旧版 rc=1（见 references/false-positives.md 案例九）。
    """
    print(f'[prompt-selfcheck] {msg}', file=sys.stderr)
    return 2


def _read(p):
    q = Path(p)
    if not q.is_file():
        raise _FileMissing(str(q))
    return q.read_text(encoding='utf-8')


class _FileMissing(Exception):
    pass


def _norm(s):
    """归一化：只去**行尾空白**与首尾的空行，逐行保留前导缩进。

    ⚠ v1 用 s.strip()，会把整块第一行的前导缩进一起吃掉，
      超出"只忽略行尾空白"的承诺（已实证：4 空格缩进的首行被剥成顶格）。
    """
    lines = s.split('\n')
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    return '\n'.join(l.rstrip() for l in lines)


def _blocks(t):
    """返回 [(lang, body, start_line)]，start_line 为块在文件中的起始行号。"""
    out = []
    for m in BLOCK_RE.finditer(t):
        out.append((m.group(1), m.group(2), t[:m.start()].count('\n') + 1))
    return out


def _pick_block(t, which, what):
    """选取要检查的块。

    优先级：显式索引 > canonical 标记 > 最长块（带警告）。
    三条闸门必须作用在**同一个对象**上，否则"联合通过"没有共同主语。
    """
    bl = _blocks(t)
    if not bl:
        raise _NoBlock(f'{what} 里没有 ``` 围栏块——提示词本体通常要放在代码块里，'
                       f'否则编辑器会把它当普通散文改格式。')
    if which is not None:
        if not -len(bl) <= which < len(bl):
            raise _NoBlock(f'{what} 的 --index {which} 越界（共 {len(bl)} 个块）')
        return bl[which][1], bl[which][2]
    m = CANON_RE.search(t)
    if m:
        for lang, body, ln in bl:
            if ln > t[:m.start()].count('\n') + 1:
                return body, ln
    if len(bl) > 1:
        print(f'  ⚠ {what} 有 {len(bl)} 个围栏块，未指定索引，默认取最长的一个。'
              f'若提示词本体不是最长的那个，请用 --index 显式指定，'
              f'或在正文写 <!-- prompt:canonical --> 标记。')
    bi = max(range(len(bl)), key=lambda i: len(bl[i][1]))
    return bl[bi][1], bl[bi][2]


class _NoBlock(Exception):
    pass


# ══════════════════════════════════════════════════════════════════
# 闸门一：编号连续性
# ══════════════════════════════════════════════════════════════════
def cmd_numbering(a):
    if a.clauses < 1:
        return _err(f'--clauses 必须 ≥1，收到 {a.clauses}')
    if a.sections < 0:
        return _err(f'--sections 不能为负，收到 {a.sections}')
    try:
        txt = _read(a.file)
        body, bl_start = _pick_block(txt, a.block, 'numbering')
    except (_FileMissing, _NoBlock) as e:
        return _err(str(e))

    # ── 候选条款行 ──
    # 语法：①..⑳ 圈码 / ㉑..㉟ / ㊱..㊿，或 `N.` `N、` `N)`
    #       或 `N `（数字+空白）。一律要求**第 0 列**（缩进的是子项）。
    cand = []          # (块内行号, 数字, 原文)
    for ln, line in enumerate(body.split('\n'), 1):
        if not line.strip():
            continue
        ch = line[0]
        if ch in CIRC:
            cand.append((ln, CIRC[ch], line))
            continue
        m = re.match(r'^(\d+)[.、)）]\s', line) or re.match(r'^(\d+)\s', line)
        if m:
            n = int(m.group(1))
            if n >= 1:
                cand.append((ln, n, line))

    # ── 排除越界数字行 ──
    # `2026 年修订`、`300 盏灯` 这类正文数字若大于条款总数，直接排除并明示。
    kept, dropped = [], []
    for ln, n, line in cand:
        if a.clauses and n > a.clauses:
            dropped.append((ln, n, line))
        else:
            kept.append((ln, n, line))
    if dropped:
        print(f'  ℹ 已排除 {len(dropped)} 个越界数字行（数字 > 条款总数 '
              f'{a.clauses}，判为正文）：' +
              '、'.join(f'L{ln}:{n}' for ln, n, _ in dropped[:5]))

    # ── 容错：单发杂散数字不判失败，只警告 ──
    # 场景：`9 盏点光从顶部投射。` 是正文，但语法上长得像第 9 条。
    # 做法：若剔掉某一个候选后能恰好构成 1..N，则该候选判为正文数字行。
    nums = [n for _, n, _ in kept]
    expected = list(range(1, a.clauses + 1))
    ok = nums == expected
    strays = []
    if not ok:
        seen = set()
        for ln, n, line in kept:
            if (ln, n) in seen:
                continue
            trial = list(nums)
            trial.remove(n)
            if trial == expected:
                strays.append((ln, n, line))
                seen.add((ln, n))
        if strays:
            stray_keys = {(ln, n) for ln, n, _ in strays}
            kept = [c for c in kept if (c[0], c[1]) not in stray_keys]
            nums = [n for _, n, _ in kept]
            ok = nums == expected
            if ok:
                print(f'  ℹ 已排除 {len(strays)} 个疑似正文数字行'
                      f'（剔除后编号恰好连续）：'
                      + '、'.join(f'L{ln}:{n}' for ln, n, _ in strays[:5]))

    print(f'条款定义点：{len(nums)} 个（期望 {a.clauses}）')
    if ok:
        print(f'  ✓ 1..{a.clauses} 连续、无重复、无跳号')
    else:
        print(f'  ✗ 与 1..{a.clauses} 不符')
        dupes = sorted({n for n in nums if nums.count(n) > 1})
        if dupes:
            print(f'    重复：{dupes}')
        miss = [n for n in expected if n not in set(nums)]
        if miss:
            print(f'    缺失：{miss}')
        extra = [n for n in nums if n not in set(expected)]
        if extra:
            print(f'    越界：{extra}')
        print('    实际序列：', nums[:20], '…' if len(nums) > 20 else '')

    if a.sections:
        secs = SECTION_RE.findall(body)
        print(f'分节数：{len(secs)}（期望 {a.sections}）')
        if len(secs) != a.sections:
            ok = False
            print('  ✗ 分节数不符。当前各节：')
            for s in secs:
                print('     -', s)
        else:
            print('  ✓ 相符')

    print('\n' + ('VERDICT: PASS' if ok else 'VERDICT: FAIL'))
    return 0 if ok else 1


# ══════════════════════════════════════════════════════════════════
# 闸门二：两版同步
# ══════════════════════════════════════════════════════════════════
def cmd_sync(a):
    try:
        ftxt, stxt = _read(a.full), _read(a.short)
        f, f_ln = _pick_block(ftxt, a.full_index, '完整版')
        s, s_ln = _pick_block(stxt, a.short_index, '精简版')
    except (_FileMissing, _NoBlock) as e:
        return _err(str(e))

    print(f'完整版：{len(f)} 字符（文件 L{f_ln} 起）')
    print(f'精简版：{len(s)} 字符（文件 L{s_ln} 起）')
    if len(s) > len(f):
        print('  ⚠ 精简版比完整版还长——多半是索引选错了块')

    A, B = _norm(f), _norm(s)
    if A == B:
        print('\nVERDICT: PASS —— 两份拷贝一致（已忽略行尾空白与首尾空行）')
        return 0

    print('\n✗ 两份拷贝不一致，差异如下（- 完整版 / + 精简版）：')
    for line in difflib.unified_diff(A.split('\n'), B.split('\n'),
                                     'full', 'short', lineterm='', n=1):
        print('  ' + line)
    print('\nVERDICT: FAIL —— 两版不同步')
    return 1


# ══════════════════════════════════════════════════════════════════
# 闸门三：旧错不以断言形式复活
# ══════════════════════════════════════════════════════════════════
def cmd_regression(a):
    if a.fix_window < 0:
        return _err(f'--fix-window 不能为负，收到 {a.fix_window}')
    try:
        txt = _read(a.file)
    except _FileMissing as e:
        return _err(str(e))
    try:
        pats = [re.compile(p) for p in a.bad]
    except re.error as e:
        return _err(f'--bad 正则无法编译：{e}')

    fixres = [re.compile(p) for p in (a.fix if a.fix else DEFAULT_FIX)]

    # 三个扫描面，合起来覆盖全文，互不重叠：
    #   【A】每个围栏块逐个查（含非 text 语言——旧版把它们删了就不查，是盲区）
    #   【B】去掉所有围栏块后的正文
    #   【C】跨行窗口：把相邻行拼起来再查一次，防"断言折行即逃"
    bl = _blocks(txt)
    fails, exempted = 0, 0

    def cells(line):
        """Markdown 表格行拆格。表格里一格断言、另一格写"修正配色"
        不该整行豁免——所以豁免判断要精确到格。"""
        if line.lstrip().startswith('|'):
            return [c for c in line.split('|')]
        return [line]

    def is_fix(text, strict):
        if strict:
            return False
        return any(r.search(text) for r in fixres)

    def scan(text, label, strict=False, offset=0):
        nonlocal fails, exempted
        ls = text.split('\n')
        hits, ex = [], []
        for i, ln in enumerate(ls):
            for pat in pats:
                if not pat.search(ln):
                    continue
                # 表格行：一格断言、另一格写"修正配色"不该整行豁免，
                # 所以**先**按格判定，命中格内无订正标记才算真复活。
                if ln.lstrip().startswith('|'):
                    hit_cell = next((c for c in cells(ln) if pat.search(c)), '')
                    if is_fix(hit_cell, strict):
                        ex.append((i + offset, pat.pattern, ln))
                        continue
                elif is_fix(ln, strict):
                    ex.append((i + offset, pat.pattern, ln))
                    continue
                hits.append((i + offset, pat.pattern, ln))
        # 跨行：相邻两行拼接后再查（断言被折行时唯一能抓到的方式）
        if not strict:
            for i in range(len(ls) - 1):
                joined = ls[i] + ls[i + 1]
                if not any(p.search(joined) for p in pats):
                    continue
                if any(p.search(ls[i]) or p.search(ls[i + 1]) for p in pats):
                    continue          # 单行已处理过
                if is_fix(joined, strict) or is_fix(ls[i], strict) \
                        or is_fix(ls[i + 1], strict):
                    ex.append((i + offset, '跨行', joined))
                    continue
                hits.append((i + offset, '跨行', joined))

        if hits:
            fails += len(hits)
            print(f'   ✗ {label}：{len(hits)} 处')
            for i, pat, ln in hits:
                print(f'       L{i} /{pat}/')
                print(f'         {ln.strip()[:110]}')
        else:
            print(f'   ✓ {label}：零命中')
        if ex:
            # 同一行可能被多个 --bad 模式命中，按 (行号, 行文) 去重，
            # 否则"另有 N 处"会虚高，削弱诊断可信度。
            uniq, seen = [], set()
            for i, pat, ln in ex:
                k = (i, ln)
                if k not in seen:
                    seen.add(k)
                    uniq.append((i, pat, ln))
            ex = uniq
            exempted += len(ex)
            print(f'   △ {label}：{len(ex)} 处命中但判为订正引用（已豁免，非零命中）')
            for i, pat, ln in ex[:3]:
                print(f'       L{i} {ln.strip()[:90]}')
            if len(ex) > 3:
                print(f'       …另 {len(ex) - 3} 处')

    print(f'【A】围栏块逐个查（{len(bl)} 个，'
          + ('零容忍' if a.strict_blocks else '订正上下文豁免') + '）')
    if not bl:
        print('   （无围栏块）')
    for k, (lang, b, ln0) in enumerate(bl, 1):
        tag = f'块{k}({lang or "text"}, L{ln0})'
        scan(b, tag, strict=a.strict_blocks)

    print('\n【B】正文（已移除围栏块）· 订正上下文豁免')
    prose = re.sub(r'```(?:\w*)\n.*?```', '\n@@PASTE@@\n', txt, flags=re.S)
    scan(prose, '正文')

    print('\n【C】跨行拼接补查 · 订正上下文豁免')
    scan(prose, '跨行', offset=0)

    print('\n' + (f'VERDICT: PASS —— 旧错未以断言形式复活'
                  f'（另有 {exempted} 处判为订正引用）' if not fails
                  else f'VERDICT: FAIL —— {fails} 处'
                       f'（另有 {exempted} 处判为订正引用，可用 --fix-window / '
                       f'--fix 调整）'))
    return 1 if fails else 0


# ══════════════════════════════════════════════════════════════════
# 闸门四：自测（把反证变成一条命令）
# ══════════════════════════════════════════════════════════════════
BASE = """<!-- prompt:canonical -->
```text
══════ 一、交付形态 ══════
① 交付物是单个 html 文件。
② 引擎内联，断网可开。
③ 可自由旋转缩放。
══════ 二、渲染 ══════
④ 三渲二，硬边。
⑤ 色阶 N=4，灰阶 86 / 146 / 206 / 255。
⑥ 描边宽度 0.008–0.06 米。
```
"""

# 精简版必须是**同一段内容的拷贝**，不是另一段内容——
# sync 检查的是"同一规范的两处副本"，不是"完整规格 vs 摘要"。
GOOD_POST = """```text
══════ 一、交付形态 ══════
① 交付物是单个 html 文件。
② 引擎内联，断网可开。
③ 可自由旋转缩放。
══════ 二、渲染 ══════
④ 三渲二，硬边。
⑤ 色阶 N=4，灰阶 86 / 146 / 206 / 255。
⑥ 描边宽度 0.008–0.06 米。
```
"""


def _mk(p, s):
    Path(p).write_text(s, encoding='utf-8')


def cmd_selftest(a):
    """自动反证：对临时副本注入变异 → 断言变红 → 再断言原文变绿。

    ⚠ 硬规则 5「没红过的探针只是装饰」的可执行形态。
    每一步都先**验证变异真的生效**，再把"没改动的文件通过检查"
    误读成"检查器抓到了改动"（references/false-positives.md 案例五）。
    """
    import tempfile
    tmp = Path(tempfile.mkdtemp(prefix='prompt-selfcheck-'))
    results = []

    def check(name, cond, detail=''):
        results.append((name, cond, detail))
        print(f"  {'✓' if cond else '✗'} {name}" + (f'  [{detail}]' if detail else ''))

    base_p, post_p = tmp / 'base.md', tmp / 'post.md'
    _mk(base_p, BASE)
    _mk(post_p, GOOD_POST)

    print('【1】基线必须全绿')
    r = _run(['numbering', str(base_p), '--clauses', '6', '--sections', '2'])
    check('numbering 基线 PASS', r == 0, f'rc={r}')
    r = _run(['sync', str(base_p), str(post_p)])
    check('sync 基线 PASS', r == 0, f'rc={r}')
    r = _run(['regression', str(base_p), '--bad', r'色阶\s*N\s*=\s*5'])
    check('regression 基线 PASS', r == 0, f'rc={r}')

    print('\n【2】用法/文件错误必须 rc=2（不是 1，也不是 0）')
    r = _run(['numbering', str(tmp / 'nope.md'), '--clauses', '3'])
    check('读不到文件 → 2', r == 2, f'rc={r}')
    r = _run(['numbering', str(base_p), '--clauses', '0'])
    check('clauses=0 → 2', r == 2, f'rc={r}')
    r = _run(['sync', str(base_p), str(base_p), '--full-index', '99'])
    check('索引越界 → 2', r == 2, f'rc={r}')
    r = _run(['regression', str(base_p), '--bad', '(unclosed'])
    check('坏正则 → 2', r == 2, f'rc={r}')

    print('\n【3】编号闸门反证')
    b = BASE.replace('⑥ 描边宽度 0.008–0.06 米。\n', '')
    assert '⑥' not in b, '变异未生效'
    _mk(base_p, b)
    r = _run(['numbering', str(base_p), '--clauses', '6', '--sections', '2'])
    check('删第 6 条 → FAIL 且报 缺失:[6]', r == 1, f'rc={r}')
    _mk(base_p, BASE)

    print('\n【4】编号闸门反证 · 普通数字正文不得误判')
    b2 = BASE.replace('③ 可自由旋转缩放。', '9 盏点光从顶部投射。\n③ 可自由旋转缩放。')
    assert '9 盏点光' in b2
    _mk(base_p, b2)
    r = _run(['numbering', str(base_p), '--clauses', '6', '--sections', '2'])
    check('正文"9 盏点光" → PASS', r == 0, f'rc={r}')
    b3 = BASE.replace('══════ 一、交付形态 ══════', '══════ 一、交付形态 ══════\n2026 年修订过一次。')
    assert '2026 年' in b3
    _mk(base_p, b3)
    r = _run(['numbering', str(base_p), '--clauses', '6', '--sections', '2'])
    check('正文"2026 年" → PASS', r == 0, f'rc={r}')
    _mk(base_p, BASE)

    print('\n【5】阿拉伯数字条款语法')
    b4 = BASE.replace('① 交付物是单个 html 文件。', '1. 交付物是单个 html 文件。')
    b4 = b4.replace('② 引擎内联，断网可开。', '2. 引擎内联，断网可开。')
    b4 = b4.replace('③ 可自由旋转缩放。', '3. 可自由旋转缩放。')
    b4 = b4.replace('④ 三渲二，硬边。', '4. 三渲二，硬边。')
    b4 = b4.replace('⑤ 色阶 N=4，灰阶 86 / 146 / 206 / 255。', '5. 色阶 N=4，灰阶 86 / 146 / 206 / 255。')
    b4 = b4.replace('⑥ 描边宽度 0.008–0.06 米。', '6. 描边宽度 0.008–0.06 米。')
    assert '1. 交付物' in b4 and '①' not in b4
    _mk(base_p, b4)
    r = _run(['numbering', str(base_p), '--clauses', '6', '--sections', '2'])
    check('`1. ` 写法 → PASS', r == 0, f'rc={r}')
    _mk(base_p, BASE)

    print('\n【6】同步闸门反证')
    bad_post = GOOD_POST.replace('N=4', 'N=5')
    assert bad_post != GOOD_POST
    _mk(post_p, bad_post)
    r = _run(['sync', str(base_p), str(post_p)])
    check('精简版改一处 → FAIL', r == 1, f'rc={r}')
    _mk(post_p, GOOD_POST)

    print('\n【7】回归闸门反证 · 四种豁免绕过必须全部抓住')
    bypasses = {
        '「没错」': '⑤ 色阶 N=5，这个结论没错。',
        '「编号」': '与编号 ㉔ 一致：色阶 N=5。',
        '「区别」': '二者的区别在于色阶 N=5。',
        '「不能」': '⑤ 色阶 N=5，不能调整。',
    }
    for name, line in bypasses.items():
        d = BASE.replace('⑤ 色阶 N=4，灰阶 86 / 146 / 206 / 255。', line)
        assert line in d, f'变异未生效：{name}'
        _mk(base_p, d)
        r = _run(['regression', str(base_p), '--bad', r'色阶\s*N\s*=\s*5'])
        check(f'绕过 {name} → FAIL', r == 1, f'rc={r}')
    _mk(base_p, BASE)

    print('\n【8】回归闸门反证 · 盲区必须堵住')
    d = BASE + '\n```python\nx = "色阶 N=5"  # 旧错藏在 python 块\n```\n'
    assert '```python' in d
    _mk(base_p, d)
    r = _run(['regression', str(base_p), '--bad', r'色阶\s*N\s*=\s*5'])
    check('python 块内旧错 → FAIL', r == 1, f'rc={r}')

    d = BASE.replace('⑤ 色阶 N=4，灰阶 86 / 146 / 206 / 255。',
                     '⑤ 色阶\nN=5。')
    assert '⑤ 色阶\nN=5' in d
    _mk(base_p, d)
    r = _run(['regression', str(base_p), '--bad', r'色阶\s*N\s*=\s*5'])
    check('断言折行 → FAIL', r == 1, f'rc={r}')
    _mk(base_p, BASE)

    print('\n【9】正当订正不得误报')
    d = BASE.replace('⑤ 色阶 N=4，灰阶 86 / 146 / 206 / 255。',
                     '原 v1 写「色阶 N=5」，这是编的，已改为 N=4。')
    assert '这是编的' in d
    _mk(base_p, d)
    r = _run(['regression', str(base_p), '--bad', r'色阶\s*N\s*=\s*5'])
    check('同行带订正标记 → PASS', r == 0, f'rc={r}')

    print('\n' + '─' * 60)
    bad = [n for n, c, _ in results if not c]
    print(f'selftest：{len(results) - len(bad)}/{len(results)} 通过'
          + (f'；失败 {len(bad)} 项：{bad}' if bad else ''))
    print('VERDICT: ' + ('PASS' if not bad else 'FAIL'))
    return 0 if not bad else 1


def _run(args):
    import subprocess
    import tempfile
    p = subprocess.run([sys.executable, str(Path(__file__).resolve())] + args,
                       capture_output=True, text=True)
    if a_verbose():
        print(p.stdout)
    return p.returncode


_VERBOSE = [False]


def a_verbose():
    return _VERBOSE[0]


# ══════════════════════════════════════════════════════════════════
def main():
    ap = argparse.ArgumentParser(
        prog='check_prompt.py',
        description='版本化提示词文档的四道闸门',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='退出码：0 通过 / 1 失败 / 2 用法·文件·检查器错误（按 FAIL 处理）')
    sub = ap.add_subparsers(dest='cmd', required=True)

    p = sub.add_parser('numbering', help='条款编号连续性 + 分节数')
    p.add_argument('file')
    p.add_argument('--clauses', type=int, required=True,
                   help='期望的条款总数，必须 ≥1（例：--clauses 77）')
    p.add_argument('--sections', type=int, default=0,
                   help='期望的分节数（0 = 不检查）')
    p.add_argument('--block', type=int, default=None,
                   help='取第几个围栏块；默认最长块。多块文档建议显式指定，'
                        '或在正文写 <!-- prompt:canonical -->')
    p.set_defaults(fn=cmd_numbering)

    p = sub.add_parser('sync', help='两份拷贝一致性（同一内容的两处拷贝）')
    p.add_argument('full')
    p.add_argument('short')
    p.add_argument('--full-index', type=int, default=None,
                   help='完整版取第几个围栏块（默认：canonical 标记 > 最长块）')
    p.add_argument('--short-index', type=int, default=None,
                   help='精简版取第几个围栏块')
    p.set_defaults(fn=cmd_sync)

    p = sub.add_parser('regression', help='已确认的错误不得以断言形式复活')
    p.add_argument('file')
    p.add_argument('--bad', action='append', required=True,
                   help='错误模式（正则），描述断言的**形式**。'
                        '例：--bad "立面.{0,14}65\\s*%"')
    p.add_argument('--fix', action='append', default=None,
                   help='订正上下文标记（正则），命中则不算复活。'
                        '默认用内置多字标记表。'
                        '⚠ 单字"错/编/别"不可作标记——"没错/编号/区别"会绕过')
    p.add_argument('--fix-window', type=int, default=0, metavar='N',
                   help='订正标记的搜索窗口行数，默认 0 = 只算同一行。'
                        '⚠ 放大窗口会让"专门讲自己错在哪"的文档把真复活也豁免掉')
    p.add_argument('--strict-blocks', action='store_true',
                   help='围栏块零容忍：块内出现该模式即失败，不给订正豁免。'
                        '仅在文档**不**把更正说明写进围栏块时使用')
    p.set_defaults(fn=cmd_regression)

    p = sub.add_parser('selftest', help='自动反证：注入变异→断言变红→原文变绿')
    p.add_argument('-v', '--verbose', action='store_true')
    p.set_defaults(fn=cmd_selftest)

    a = ap.parse_args()
    _VERBOSE[0] = getattr(a, 'verbose', False)
    try:
        rc = a.fn(a)
    except SystemExit:
        raise
    except Exception as e:                                   # noqa: BLE001
        print(f'[prompt-selfcheck] 检查器自身出错：{type(e).__name__}: {e}')
        print('  ★ 检查器报错不等于文档通过。按 FAIL 处理并修检查器。')
        rc = 2
    sys.exit(rc if isinstance(rc, int) else 2)


if __name__ == '__main__':
    main()
