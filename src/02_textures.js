/* ============ 02 canvas textures ============ */
const JP = '"Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic","Noto Sans JP","Meiryo","Microsoft YaHei",sans-serif';
const _tcache = {};

function mk(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return { c: c, g: g };
}
function tx(canvas, repX, repY) {
  const t = new T.CanvasTexture(canvas);
  t.encoding = T.sRGBEncoding;
  t.anisotropy = 4;
  if (repX || repY) {
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.repeat.set(repX || 1, repY || 1);
  }
  return t;
}
function cache(key, fn) { if (!_tcache[key]) _tcache[key] = fn(); return _tcache[key]; }
function hex(n) { return '#' + ('000000' + n.toString(16)).slice(-6); }
function noiseFill(g, w, h, col, alpha, count, size) {
  g.save();
  for (let i = 0; i < count; i++) {
    g.globalAlpha = alpha * rr(0.4, 1.2);
    g.fillStyle = typeof col === 'function' ? col() : col;
    const s = size * rr(0.5, 1.6);
    g.fillRect(rr(0, w), rr(0, h), s, s);
  }
  g.restore();
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath(); g.fill();
}
function vtext(g, str, x, y, size, color, gap) {
  g.save(); g.fillStyle = color; g.font = '700 ' + size + 'px ' + JP; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i < str.length; i++) g.fillText(str[i], x, y + i * (size + (gap || 4)));
  g.restore();
}

/* ---- road / ground ---- */
function roadTex() {
  return cache('road', function () {
    const o = mk(512, 512), g = o.g, W = 512, H = 512;
    g.fillStyle = '#242a3a'; g.fillRect(0, 0, W, H);
    noiseFill(g, W, H, function () { return rr(0, 1) > 0.5 ? '#2b3244' : '#1e2431'; }, 0.5, 2600, 5);
    noiseFill(g, W, H, '#39415a', 0.16, 700, 7);
    for (let i = 0; i < 26; i++) {
      g.globalAlpha = rr(0.05, 0.16); g.fillStyle = '#4a5570';
      g.beginPath(); g.ellipse(rr(0, W), rr(0, H), rr(20, 90), rr(12, 60), rr(0, 3), 0, 6.3); g.fill();
    }
    g.globalAlpha = 1;
    return tx(o.c, 5, 5);
  });
}
function walkTex() {
  return cache('walk', function () {
    const o = mk(512, 512), g = o.g, W = 512, H = 512;
    g.fillStyle = '#6e747f'; g.fillRect(0, 0, W, H);
    noiseFill(g, W, H, function () { return rr(0, 1) > 0.5 ? '#767c88' : '#666c77'; }, 0.35, 2400, 5);
    g.strokeStyle = 'rgba(40,46,58,0.55)'; g.lineWidth = 2;
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, H); g.moveTo(0, i * 128); g.lineTo(W, i * 128); g.stroke(); }
    g.strokeStyle = 'rgba(150,158,172,0.35)'; g.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 128 + 2, 0); g.lineTo(i * 128 + 2, H); g.moveTo(0, i * 128 + 2); g.lineTo(W, i * 128 + 2); g.stroke(); }
    return tx(o.c, 6, 6);
  });
}
function concreteTex() {
  return cache('conc', function () {
    const o = mk(256, 256), g = o.g;
    g.fillStyle = '#4d5364'; g.fillRect(0, 0, 256, 256);
    noiseFill(g, 256, 256, function () { return rr(0, 1) > 0.5 ? '#565c6d' : '#454b5b'; }, 0.4, 1600, 4);
    return tx(o.c, 3, 3);
  });
}
function tileTex() {
  return cache('tile', function () {
    const o = mk(512, 512), g = o.g;
    g.fillStyle = '#ece5d6'; g.fillRect(0, 0, 512, 512);
    noiseFill(g, 512, 512, '#ded5c4', 0.25, 900, 5);
    g.strokeStyle = 'rgba(168,160,146,0.65)'; g.lineWidth = 3;
    for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, 512); g.moveTo(0, i * 64); g.lineTo(512, i * 64); g.stroke(); }
    return tx(o.c, 3, 3);
  });
}
function ceilTex() {
  return cache('ceil', function () {
    const o = mk(512, 512), g = o.g;
    g.fillStyle = '#e9e6de'; g.fillRect(0, 0, 512, 512);
    noiseFill(g, 512, 512, '#dedbd2', 0.3, 700, 5);
    g.strokeStyle = 'rgba(160,158,150,0.7)'; g.lineWidth = 4;
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, 512); g.moveTo(0, i * 128); g.lineTo(512, i * 128); g.stroke(); }
    return tx(o.c, 2, 2);
  });
}

/* ---- glow / utilities ---- */
function glowTex() {
  return cache('glow', function () {
    const o = mk(128, 128), g = o.g;
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    grd.addColorStop(0.6, 'rgba(255,255,255,0.14)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    return tx(o.c);
  });
}
function shadowTex() {
  return cache('shadow', function () {
    const o = mk(128, 128), g = o.g;
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(0,0,0,0.55)');
    grd.addColorStop(0.5, 'rgba(0,0,0,0.26)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    return tx(o.c);
  });
}
function ringTex() {
  return cache('ring', function () {
    const o = mk(128, 128), g = o.g;
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(190,225,255,0)');
    grd.addColorStop(0.62, 'rgba(190,225,255,0)');
    grd.addColorStop(0.80, 'rgba(200,232,255,0.55)');
    grd.addColorStop(0.90, 'rgba(210,238,255,0.18)');
    grd.addColorStop(1, 'rgba(210,238,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    return tx(o.c);
  });
}
function reflectTex() {
  return cache('reflect', function () {
    const o = mk(64, 256), g = o.g;
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, 'rgba(255,255,255,0.85)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 256);
    const grd2 = g.createLinearGradient(0, 0, 64, 0);
    grd2.addColorStop(0, 'rgba(0,0,0,1)'); grd2.addColorStop(0.5, 'rgba(0,0,0,0)'); grd2.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = grd2; g.fillRect(0, 0, 64, 256);
    g.globalCompositeOperation = 'source-over';
    return tx(o.c);
  });
}
function puddleTex() {
  return cache('puddle', function () {
    const S = 256, o = mk(S, S), g = o.g;
    g.clearRect(0, 0, S, S);

    /* Irregular outlines.
       GPT r5: "用 3-6 个重叠的不规则软形状合成一片水洼 / 不画中心、不画放射
       纹、不画闭合等距线";  Kimi r5: "对贴图做径向自相关，周期性峰值 < 0.1；
       扰动幅度 >= 短轴的 15%".
       Two or three harmonics would still leave a detectable period, so the
       radius comes from a SMOOTHED RANDOM WALK: irregular at every scale,
       periodic at none.  Amplitude 19-28 % of the short axis, above his 15 %
       floor.  The previous texture was 40 uniform ellipses -- not concentric,
       but patchy in a way that reads as noise rather than as water. */
    function outline(cx, cy, rx, ry, amp) {
      const N = 26, raw = [];
      for (let i = 0; i < N; i++) raw.push(1 + (Math.random() * 2 - 1) * amp);
      for (let pass = 0; pass < 2; pass++) {
        const s = raw.slice();
        for (let i = 0; i < N; i++) {
          raw[i] = (s[(i + N - 1) % N] + 2 * s[i] + s[(i + 1) % N]) / 4;
        }
      }
      const M = 96, pts = [];
      for (let i = 0; i < M; i++) {
        const t = i / M * N, i0 = Math.floor(t), f = t - i0;
        const k = raw[i0 % N] * (1 - f) + raw[(i0 + 1) % N] * f;
        const a = i / M * Math.PI * 2;
        pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
      }
      return pts;
    }
    function path(pts) {
      g.beginPath();
      for (let i = 0; i < pts.length; i++) {
        if (i === 0) g.moveTo(pts[i][0], pts[i][1]); else g.lineTo(pts[i][0], pts[i][1]);
      }
      g.closePath();
    }

    /* Five overlapping soft shapes, largest 1.6 x 0.9 of the half-width, so one
       decal plane reads as a CLUSTER of puddles rather than one bullseye. */
    const blobs = [
      outline(104, 156, 78, 46, 0.19),
      outline(158, 132, 56, 38, 0.23),
      outline(132, 176, 46, 30, 0.25),
      outline(178, 162, 34, 24, 0.28),
      outline(86, 116, 40, 27, 0.24)
    ];

    /* Body: one wide, slow vertical gradient.  No centre, no radial spokes.
       Edges softened with a 4 px blur = 0.03-0.06 m at the sizes these planes
       are actually used at, inside GPT's 0.02-0.08 m transition band. */
    g.save();
    g.filter = 'blur(4px)';
    blobs.forEach(function (b) {
      const grd = g.createLinearGradient(0, 90, 0, 200);
      grd.addColorStop(0, 'rgba(24,30,46,0.94)');
      grd.addColorStop(0.5, 'rgba(34,42,62,0.90)');
      grd.addColorStop(1, 'rgba(46,56,80,0.86)');
      g.fillStyle = grd;
      path(b); g.fill();
    });

    /* One or two BROKEN edge highlights, on the lit side only.
       GPT r5: "每片最多保留 1-2 处断续边缘高光；亮部来自附近灯光方向".  Index
       0.75 of the ring is the top of the texture (angle 3*pi/2), and every
       puddle decal is rotated so that edge faces the shopfront -- so the
       highlight lands on the side the light actually comes from. */
    g.filter = 'blur(2.5px)';
    g.lineWidth = 5;
    g.lineCap = 'round';
    [[blobs[0], 0.60, 0.80], [blobs[1], 0.86, 0.98]].forEach(function (h) {
      const b = h[0], a0 = Math.floor(b.length * h[1]), a1 = Math.floor(b.length * h[2]);
      g.beginPath();
      for (let i = a0; i <= a1; i++) {
        const q = b[i % b.length];
        if (i === a0) g.moveTo(q[0], q[1]); else g.lineTo(q[0], q[1]);
      }
      g.strokeStyle = 'rgba(196,214,238,0.30)';
      g.stroke();
    });

    /* The warm shop light's own smear inside the water -- a vertically
       stretched reflection, not a radial gradient (Kimi r5). */
    g.filter = 'blur(6px)';
    const warm = g.createLinearGradient(0, 96, 0, 152);
    warm.addColorStop(0, 'rgba(255,206,146,0.00)');
    warm.addColorStop(0.45, 'rgba(255,206,146,0.24)');
    warm.addColorStop(1, 'rgba(255,206,146,0.00)');
    g.fillStyle = warm;
    path(blobs[0]); g.fill();
    g.restore();

    return tx(o.c);
  });
}
function wetTex(yDry, yWet) {
  return cache('wet_' + yDry + '_' + yWet, function () {
    const W = 256, H = 256;
    const o = mk(W, H), g = o.g;
    /* Multiply map for the wet/dry split.  White is the identity, so the band
       under the canopy leaves the pavement exactly as authored and everything
       outside it is darkened toward wet asphalt.  The gradient between the two
       is the 0.3 m transition GPT asked for ("雨棚外缘向棚内做 0.15-0.35 m 的
       干湿过渡").

       This used to be a 16 x 256 one-dimensional ramp, and that is why the
       pavement grew a dead-straight 12.4 m ruled line across it: a multiply map
       has no alpha, so its "no effect" state must be literal white, and a ramp
       that varies only in V can only ever terminate on a line of constant V.
       Two more things made it worse: the slab is 12.4 x 2.50, so a 16 px width
       was 0.77 m per texel sideways, and the transition itself was 0.30 m
       across a 12.4 m edge -- an aspect ratio of 41:1, which is not a gradient,
       it is an edge.

       So the map is now two-dimensional and both of its edges wander:
       `wander(u)` adds up to ~0.13 of V (0.33 m on this slab) as a sum of three
       sines, so the dry/wet boundary is never a straight line, and the U
       falloff eases the multiply back to identity over the last 14 % of each
       end so the slab does not end on a second pair of lines. */
    const dry = [255, 255, 255];
    const wet = [0xc2, 0xca, 0xd9];
    const wander = function (u) {
      return 0.072 * Math.sin(u * 6.1 + 0.7) +
             0.040 * Math.sin(u * 13.7 + 2.1) +
             0.018 * Math.sin(u * 27.3 + 0.3);
    };
    const img = g.createImageData(W, H);
    const d = img.data;
    for (let y = 0; y < H; y++) {
      const v = y / (H - 1);
      for (let x = 0; x < W; x++) {
        const u = x / (W - 1);
        const eu = Math.min(1, Math.min(u, 1 - u) / 0.14);
        const su = eu * eu * (3 - 2 * eu);                 // smoothstep
        let vice = (v + wander(u) - yDry) / Math.max(0.0001, yWet - yDry);
        vice = Math.max(0, Math.min(1, vice));
        vice = vice * vice * (3 - 2 * vice) * su;
        const i = (y * W + x) * 4;
        d[i] = dry[0] + (wet[0] - dry[0]) * vice;
        d[i + 1] = dry[1] + (wet[1] - dry[1]) * vice;
        d[i + 2] = dry[2] + (wet[2] - dry[2]) * vice;
        d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return tx(o.c);
  });
}

function smokeTex() {
  return cache('smoke', function () {
    const o = mk(128, 128), g = o.g;
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 62);
    grd.addColorStop(0, 'rgba(255,255,255,0.75)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.28)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    return tx(o.c);
  });
}

/* ---- signage ---- */
const BRAND = { r: '#e0503c', o: '#f2a83c', g: '#3ea173' };
function signBoardTex() {
  return cache('signboard', function () {
    const o = mk(1024, 256), g = o.g, W = 1024, H = 256;
    g.fillStyle = '#e6dfcc'; g.fillRect(0, 0, W, H);
    const bands = [[BRAND.r, 0, 46], [BRAND.o, 46, 92], [BRAND.g, 92, 138]];
    bands.forEach(function (b) { g.fillStyle = b[0]; g.fillRect(0, b[1], W, b[2] - b[1]); });
    g.strokeStyle = 'rgba(20,24,34,0.35)'; g.lineWidth = 4;
    g.strokeRect(2, 2, W - 4, H - 4);
    g.fillStyle = '#1b2030';
    g.font = '800 84px ' + JP; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText('ミニストップ', 42, 176);
    g.font = '700 44px ' + JP;
    g.fillStyle = '#c9532f';
    g.fillText('コンビニエンスストア', 340, 206);
    // 24h block
    g.fillStyle = BRAND.r; roundRect(g, 812, 152, 172, 76, 12); g.fill();
    g.fillStyle = '#ffffff'; g.font = '800 58px ' + JP; g.textAlign = 'center';
    g.fillText('24h', 898, 184);
    return tx(o.c);
  });
}
function signBoardShortTex() {
  return cache('signshort', function () {
    const o = mk(512, 256), g = o.g, W = 512, H = 256;
    g.fillStyle = '#e6dfcc'; g.fillRect(0, 0, W, H);
    g.fillStyle = BRAND.g; g.fillRect(0, 0, W, 74);
    g.fillStyle = BRAND.o; g.fillRect(0, 74, W, 74);
    g.fillStyle = BRAND.r; g.fillRect(0, 148, W, 74);
    g.strokeStyle = 'rgba(20,24,34,0.35)'; g.lineWidth = 5; g.strokeRect(2, 2, W - 4, H - 4);
    g.fillStyle = '#ffffff'; g.font = '800 62px ' + JP; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('ミニストップ', 256, 128);
    g.font = '700 34px ' + JP;
    g.fillText('24時間営業', 256, 214);
    return tx(o.c);
  });
}
function poleSignTex() {
  return cache('polesign', function () {
    const o = mk(256, 768), g = o.g, W = 256, H = 768;
    g.fillStyle = '#e6dfcc'; g.fillRect(0, 0, W, H);
    g.fillStyle = BRAND.r; g.fillRect(0, 0, W, 168);
    g.fillStyle = BRAND.o; g.fillRect(0, 168, W, 168);
    g.fillStyle = BRAND.g; g.fillRect(0, 336, W, 168);
    g.strokeStyle = 'rgba(20,24,34,0.4)'; g.lineWidth = 6; g.strokeRect(3, 3, W - 6, H - 6);
    vtext(g, 'ミニストップ', 128, 100, 92, '#1b2030', 12);
    g.save(); g.translate(128, 640); g.fillStyle = BRAND.r; roundRect(g, -104, -54, 208, 108, 16); g.fill();
    g.fillStyle = '#fff'; g.font = '800 76px ' + JP; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('24h', 0, 4); g.restore();
    return tx(o.c);
  });
}

/* ---- pole number plate (電柱番号札) ----
   Kimi r11 Q2 calls this "日本电线杆辨识度最高的单体元素" and he is right about
   the reason: at 29 x 39 px on screen the digits are NOT readable and are not
   meant to be.  What the eye actually locks onto is "bright small rectangle,
   black rule, dark glyph mass, mounted at chest height on a dark column" --
   that is the whole signal.  So the canvas is drawn for VALUE first (a
   near-white ground against a #9c968a shaft) and for plausible glyph mass
   second, and the small print at the foot exists to give the lower third of
   the plate a different mean so the plate does not read as a blank sticker.
   Aspect is 3:4 because the real 柱札 is 300 x 400 mm; drawing at 8 px per
   25 mm keeps whole-pixel stroke widths. */
function poleNoTex(n) {
  n = n || '21';
  return cache('poleno' + n, function () {
    const o = mk(240, 320), g = o.g, W = 240, H = 320;
    g.fillStyle = '#e9e6da'; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(24,28,38,0.09)'; g.fillRect(0, 0, W, 34);
    g.fillStyle = 'rgba(24,28,38,0.07)'; g.fillRect(0, 286, W, 34);
    g.strokeStyle = '#161a24'; g.lineWidth = 5; g.strokeRect(4, 4, W - 8, H - 8);
    g.strokeStyle = '#161a24'; g.lineWidth = 11; g.strokeRect(20, 20, W - 40, H - 40);
    g.fillStyle = '#12161f';
    g.font = '900 ' + (n.length > 2 ? 128 : 168) + 'px ' + JP;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(n, 120, 162);
    g.font = '700 30px ' + JP;
    g.fillText('南口線', 120, 268);
    return tx(o.c);
  });
}

/* ---- pole trunk: splash-back staining as a VALUE GRADIENT, not a band ----
   Kimi r11 Q2 item 3 asks for the three proposed staining bands to be cut to
   one, because toon quantises a thin colour band into a visible edge and three
   of them read as "分段错误".  A band edge is the problem, not the band count,
   so the honest version has no edge at all: the shaft is a single mesh wearing
   one vertical gradient that fades from clean concrete at the head to a wet
   muddy base over the bottom ~1.7 m.  That is also what actually happens --
   splash-back is a deposition profile, not a stripe.

   The canvas is a MULTIPLIER on the shaft colour (near-white 1.0 at the head,
   ~0.55 at the base), so the toon ramp still shapes the form and the whole
   shaft keeps one material.  Canvas row 0 maps to uv.v = 1 maps to the top of
   the cylinder (CanvasTexture.flipY = true), so v=0.0-0.20 of the canvas
   height -- the bottom of the image -- is the bottom of the pole.  The poles
   are h 8.6 and 8.2, so "bottom 20 %" is 1.72 m and 1.64 m; the 8 cm the two
   differ by is 0.6 px of band-edge position and both are inside the range
   Kimi asked for. */
function poleTrunkTex() {
  return cache('poletrunk', function () {
    const o = mk(48, 512), g = o.g, W = 48, H = 512;
    /* Local deterministic jitter.  NOT rr()/noiseFill(): both draw from the
       page-global `_seed`, and the textures are built lazily during the scene
       walk, so consuming the shared sequence here would reshuffle every later
       rr() in the build and change details all over the model.  A/B evidence
       would then be measuring the reshuffle, not the pole. */
    let s = 0x9e3779b1;
    function j() { s = (s * 1664525 + 1013904223) & 0x7fffffff; return s / 0x7fffffff; }
    function jr(a, b) { return a + (b - a) * j(); }
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0.00, '#ffffff');
    grad.addColorStop(0.62, '#fbfaf7');
    grad.addColorStop(0.80, '#e9e4d8');
    grad.addColorStop(0.88, '#cfc7b6');
    grad.addColorStop(0.94, '#b3aa96');
    grad.addColorStop(1.00, '#a49a86');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    /* Vertical run-off streaks.  Only in the stained third -- rain does not
       streak clean concrete, it streaks what it is already carrying. */
    g.save();
    for (let i = 0; i < 26; i++) {
      const x = jr(0, W), w = jr(1, 3.4), y0 = jr(H * 0.72, H * 0.97);
      g.globalAlpha = jr(0.05, 0.16) * (y0 / H);
      g.fillStyle = '#6d6555';
      g.fillRect(x, y0, w, H - y0);
    }
    g.restore();
    /* Grit at the very foot, where splash actually deposits solids.
       Canvas row H is the bottom of the pole, so this block is translated to
       the foot -- an untranslated fill would put the grit on the pole head. */
    g.save();
    g.translate(0, H * 0.86);
    for (let i = 0; i < 90; i++) {
      g.globalAlpha = jr(0.08, 0.26);
      g.fillStyle = '#5c5646';
      const sz = jr(1, 3);
      g.fillRect(jr(0, W), jr(0, H * 0.14), sz, sz);
    }
    g.restore();
    return tx(o.c);
  });
}
function openTex() {
  return cache('open', function () {
    const o = mk(256, 128), g = o.g;
    g.fillStyle = 'rgba(250,250,244,0.95)'; roundRect(g, 6, 6, 244, 116, 14); g.fill();
    g.strokeStyle = 'rgba(30,36,50,0.5)'; g.lineWidth = 5; g.stroke();
    g.fillStyle = '#2b8f5c'; g.font = '800 62px ' + JP; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('営業中', 128, 66);
    return tx(o.c);
  });
}
function doorSignTex() {
  return cache('doorsign', function () {
    const o = mk(256, 128), g = o.g;
    g.fillStyle = 'rgba(246,244,238,0.96)'; roundRect(g, 6, 6, 244, 116, 12); g.fill();
    g.strokeStyle = 'rgba(30,36,50,0.45)'; g.lineWidth = 5; g.stroke();
    g.fillStyle = '#28303f'; g.font = '800 52px ' + JP; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('自動ドア', 128, 66);
    return tx(o.c);
  });
}

/* ---- vending machine ---- */
function vendingTex() {
  return cache('vending', function () {
    const o = mk(384, 640), g = o.g, W = 384, H = 640;
    g.fillStyle = '#f2f4f7'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#2b3244'; g.fillRect(0, 0, W, 96);
    g.fillStyle = '#ffffff'; g.font = '800 52px ' + JP; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText('ドリンク', 22, 48);
    g.fillStyle = BRAND.r; roundRect(g, 268, 22, 96, 52, 10); g.fill();
    g.fillStyle = '#fff'; g.font = '700 34px ' + JP; g.textAlign = 'center'; g.fillText('自販機', 316, 49);
    // window area
    const x0 = 20, y0 = 116, ww = W - 40, hh = 330;
    g.fillStyle = '#101823'; g.fillRect(x0, y0, ww, hh);
    const cols = 4, rows = 3;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cw = ww / cols, ch = hh / rows;
        const cx = x0 + c * cw + 10, cy = y0 + r * ch + 8, bw = cw - 20, bh = ch - 18;
        const base = pick(['#3d8fd6', '#d9483c', '#4fae78', '#e0a53a', '#8a5fd0', '#48b8c8']);
        g.fillStyle = base; roundRect(g, cx, cy, bw, bh, 8); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(cx + 4, cy + bh * 0.36, bw - 8, bh * 0.3);
        g.fillStyle = 'rgba(20,24,34,0.75)'; g.fillRect(cx + 8, cy + bh * 0.44, bw - 16, bh * 0.1);
        g.fillStyle = '#e9eef5'; g.fillRect(cx + bw * 0.2, cy + 3, bw * 0.6, bh * 0.12);
        // price
        g.fillStyle = '#ffd24a'; g.font = '600 20px ' + JP; g.textAlign = 'center';
        g.fillText('¥' + pick([120, 130, 150, 160]), cx + bw / 2, cy + bh - 10);
      }
    }
    g.strokeStyle = 'rgba(180,190,205,0.5)'; g.lineWidth = 3; g.strokeRect(x0, y0, ww, hh);
    // buttons row
    for (let i = 0; i < 8; i++) {
      g.fillStyle = pick(['#ffcf4a', '#ff8b6a', '#7fd0a3']);
      roundRect(g, 22 + i * 43, 462, 34, 26, 6); g.fill();
      g.strokeStyle = 'rgba(30,36,50,0.5)'; g.lineWidth = 2; g.stroke();
    }
    // tray + slot
    g.fillStyle = '#20283a'; g.fillRect(24, 508, W - 48, 84);
    g.fillStyle = '#39445c'; g.fillRect(40, 524, W - 80, 52);
    g.fillStyle = '#1a2030'; roundRect(g, 130, 604, 130, 28, 8); g.fill();
    return tx(o.c);
  });
}

/* ---- shelf fronts ---- */
function shelfTex(kind) {
  return cache('shelf_' + kind, function () {
    const W = 512, H = 256;
    const o = mk(W, H), g = o.g;
    /* ---- repaint for READABILITY, not for illustration density -------------
       Three rounds of "why can't I see the products" ended with two external
       reviews agreeing on the same thing: the panel was drawn at illustration
       density, and at hero distance 1 px of the glazing is worth ~10 cm, so a
       16 px packet is a sub-pixel smudge.  The rule they gave is 3x3 px
       minimum for anything meant to be seen, i.e. a >=30 cm colour block.

       So this panel now has three jobs and they are ordered:
         1. the SHELF BOARDS are the structure -- deep charcoal, 12 px, with a
            dark top edge.  "The rhythm of the rows comes from the boards, not
            from the goods."  (both reviewers)
         2. the FACINGS are big -- 24-34 px wide (>0.24 m), 13-15 per row, and
            saturated to 0.7-0.9 with warm and cool alternating so adjacent
            packets differ by >=30% in value.
         3. the CAVITY behind them is dark, so 50-65% of the panel is
            structure and 35-50% is colour.
       The old version painted every gap as lit grey and every packet as a
       pastel, which averaged out to one warm grid -- exactly the "flat暖白"
       that killed the shopfront. */
    const rows = kind === 'mag' ? 3 : 4;
    const rh = H / rows;
    /* every palette is deliberately high-chroma and mixes warm with cool */
    const palette = {
      snack:   ['#e0483a', '#f08a1c', '#f2c81e', '#e8536e', '#f2ede0', '#2f78c8'],
      bento:   ['#f2ede0', '#e0483a', '#2f9e78', '#f0a83c', '#3a3f4a', '#f2ede0'],
      onigiri: ['#f6f2e6', '#2f9e78', '#e0483a', '#f2ede0', '#3a3f4a', '#f0a83c'],
      drink:   ['#2f78c8', '#e0483a', '#2fb0cc', '#f2c81e', '#5a52c8', '#2fa07a'],
      daily:   ['#4a90d0', '#2fa07a', '#e0483a', '#f2ede0', '#8a5ad0', '#3a3f4a'],
      cup:     ['#e0483a', '#f2c81e', '#f2ede0', '#2f9e78', '#f0a83c', '#3a3f4a'],
      mag:     ['#d8452f', '#2f78c8', '#f0c020', '#2fa07a', '#8a5ad0', '#e8536e']
    };
    const pal = palette[kind] || palette.snack;
    /* the cavity behind the packets: dark, with a slight top-to-bottom fall so
       it still reads as a lit shelf rather than a black hole */
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0.00, '#4c515a');
    bg.addColorStop(0.50, '#363a42');
    bg.addColorStop(1.00, '#24272d');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    /* vertical stanchions every 128 px -- a hard dark divider that survives
       minification and says "these are separate shelf bays" */
    g.fillStyle = 'rgba(18,20,26,0.55)';
    for (let sx = 0; sx < W; sx += 128) g.fillRect(sx, 0, 5, H);

    for (let r = 0; r < rows; r++) {
      const y0 = r * rh, y1 = y0 + rh;
      const boardH = 12;
      const baseY = y1 - boardH;          // products stand on this
      /* ---- the shelf board: the structural actor ---- */
      g.fillStyle = '#1c1f25'; g.fillRect(0, baseY, W, 4);          // dark top edge
      g.fillStyle = '#33373f'; g.fillRect(0, baseY + 4, W, boardH - 4);
      g.fillStyle = '#5b6069'; g.fillRect(0, y1 - 2, W, 2);         // lit front lip

      let x = 7, guard = 0;
      while (x < W - 24 && guard < 40) {
        guard++;
        let pw, ph;
        /* Round 4 widened every facing again, 24-38 -> 28-46 px.  The measured
           read on the three long product faces was a mean pixel saturation of
           12.5-18.6 %, and K2.8's target is >=30 %: "12-19% 的饱和度在 130 亮度
           底上读出来是「灰彩条纹」，不是「红黄绿的商品」."  A facing of 46 px on
           a 512 px panel is 0.45 m of real shelf, which is a plausible large
           packet, and on the widest face (391 px on screen) it survives as
           ~35 px -- comfortably above the 3x3 px readability floor. */
        if (kind === 'mag') { pw = rr(30, 40); ph = rh * rr(0.72, 0.84); }
        else if (kind === 'onigiri') { pw = rr(30, 40); ph = rh * rr(0.42, 0.54); }
        else if (kind === 'cup') { pw = rr(28, 38); ph = rh * rr(0.40, 0.52); }
        else if (kind === 'bento') { pw = rr(34, 46); ph = rh * rr(0.50, 0.60); }
        else { pw = rr(30, 44); ph = rh * rr(0.52, 0.68); }
        if (x + pw > W - 4) break;
        const col = pick(pal);
        const topY = baseY - ph;
        /* 2 px of ground shadow under the packet, 1 px of top highlight: the
           two cues that make a rounded rectangle read as a standing object
           rather than as a printed stripe (K2.8 round-4 T3). */
        g.fillStyle = 'rgba(8,10,14,0.55)';
        g.fillRect(x + 1, baseY - 2, pw - 2, 2);
        g.fillStyle = col;
        roundRect(g, x, topY, pw, ph, 2); g.fill();
        g.strokeStyle = 'rgba(12,14,20,0.55)'; g.lineWidth = 1.6; g.stroke();
        g.fillStyle = 'rgba(255,255,255,0.28)';
        g.fillRect(x + 2, topY + 1, pw - 4, 1);
        /* THE LABEL BAND WAS THE DESATURATION SOURCE, AND IT WAS MINE.
           It used to cover 30 % of every packet's height at 86 % white -- i.e.
           nearly a third of the coloured area of the whole shelf was
           near-white paint, which is the single biggest reason a panel authored
           at HSV saturation ~0.9 measured 12-19 % on screen. 16 % height at
           0.72 alpha still reads unmistakably as packaging, and gives the
           palette back roughly a third of its chroma. */
        g.fillStyle = 'rgba(255,255,255,0.72)';
        g.fillRect(x + 2, topY + ph * 0.30, pw - 4, Math.max(3, ph * 0.16));
        g.fillStyle = 'rgba(18,20,28,0.62)';
        g.fillRect(x + 2, topY + ph * 0.52, pw - 4, 2);
        /* price tag: cheap, and the single strongest "this is a shelf" cue */
        g.fillStyle = '#f7f3e4'; g.fillRect(x + pw - 13, baseY - 9, 12, 8);
        g.fillStyle = '#c03a2c'; g.fillRect(x + pw - 12, baseY - 7, 10, 2);
        x += pw + rr(3, 6);
      }
    }
    const t = new T.CanvasTexture(o.c);
    t.encoding = T.sRGBEncoding; t.anisotropy = 4;
    return t;
  });
}

/* ---- posters ---- */
function posterTex(kind) {
  return cache('poster_' + kind, function () {
    const o = mk(384, 512), g = o.g, W = 384, H = 512;
    if (kind === 'noodle') {
      g.fillStyle = '#f4e9d2'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#e0453a'; g.fillRect(0, 0, W, 130);
      g.fillStyle = '#fff'; g.font = '800 74px ' + JP; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('新発売', W / 2, 68);
      g.fillStyle = '#f7c25a'; g.beginPath(); g.ellipse(192, 320, 120, 92, 0, 0, 6.3); g.fill();
      g.fillStyle = '#e8b23c'; g.beginPath(); g.ellipse(192, 320, 96, 72, 0, 0, 6.3); g.fill();
      g.fillStyle = '#f0f0e4'; g.beginPath(); g.ellipse(192, 320, 74, 52, 0, 0, 6.3); g.fill();
      g.fillStyle = '#c98c3a'; g.font = '800 44px ' + JP; g.fillText('特製ラーメン', 192, 452);
    } else if (kind === 'coffee') {
      g.fillStyle = '#2e2a3c'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#6b4a2f'; g.beginPath(); g.ellipse(192, 300, 110, 130, 0, 0, 6.3); g.fill();
      g.fillStyle = '#8a5a34'; g.beginPath(); g.ellipse(192, 250, 96, 60, 0, 0, 6.3); g.fill();
      g.fillStyle = '#efe6d4'; g.beginPath(); g.ellipse(192, 250, 84, 50, 0, 0, 6.3); g.fill();
      g.fillStyle = '#fff'; g.font = '800 46px ' + JP; g.textAlign = 'center'; g.fillText('HOT COFFEE', 192, 96);
      g.fillStyle = '#f0b25a'; g.font = '700 40px ' + JP; g.fillText('¥150', 192, 470);
    } else if (kind === 'sale') {
      g.fillStyle = '#ffe9a8'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#e24b3c'; g.beginPath(); g.moveTo(0, 0); g.lineTo(W, 0); g.lineTo(W, 120); g.lineTo(0, 190); g.closePath(); g.fill();
      g.fillStyle = '#fff'; g.font = '800 92px ' + JP; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('SALE', 192, 92);
      g.fillStyle = '#e24b3c'; g.font = '800 62px ' + JP; g.fillText('お買得', 192, 300);
      g.strokeStyle = '#e24b3c'; g.lineWidth = 8; g.strokeRect(40, 360, W - 80, 110);
      g.fillStyle = '#333'; g.font = '800 54px ' + JP; g.fillText('20% OFF', 192, 416);
    } else if (kind === 'lottery') {
      g.fillStyle = '#dfe9f5'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#3b6ea8'; g.fillRect(0, 300, W, 212);
      g.fillStyle = '#fff'; g.font = '800 70px ' + JP; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#e2b03a'; g.fillText('宝くじ', 192, 110);
      g.fillStyle = '#3b6ea8'; g.fillText('LOTO', 192, 200);
      g.fillStyle = '#fff'; g.font = '700 46px ' + JP; g.fillText('夢を買おう', 192, 400);
    } else if (kind === 'beer') {
      g.fillStyle = '#1d2436'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#e0b24a'; g.beginPath(); g.ellipse(140, 300, 70, 130, 0, 0, 6.3); g.fill();
      g.fillStyle = '#f2e8c8'; g.beginPath(); g.ellipse(140, 200, 56, 40, 0, 0, 6.3); g.fill();
      g.fillStyle = '#fff'; g.font = '800 66px ' + JP; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('生ビール', 300, 150);
      g.fillStyle = '#7fd0a3'; g.font = '700 44px ' + JP; g.fillText('冷やし', 300, 250);
    } else {
      g.fillStyle = '#f0efe6'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#4d7fb8'; g.fillRect(0, 0, W, 90);
      g.fillStyle = '#fff'; g.font = '800 50px ' + JP; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('求人情報', 192, 48);
      g.fillStyle = '#252c3c'; g.font = '700 46px ' + JP; g.fillText('スタッフ募集', 192, 200);
      g.fillStyle = '#888'; g.font = '600 34px ' + JP; g.fillText('週2日〜OK', 192, 300);
      g.fillStyle = '#c0492f'; g.fillRect(60, 380, W - 120, 84);
      g.fillStyle = '#fff'; g.font = '700 44px ' + JP; g.fillText('詳細は店内', 192, 422);
    }
    g.strokeStyle = 'rgba(30,36,50,0.35)'; g.lineWidth = 6; g.strokeRect(3, 3, W - 6, H - 6);
    return tx(o.c);
  });
}

/* ---- bulletin board ---- */
function bulletinTex() {
  return cache('bulletin', function () {
    const o = mk(512, 384), g = o.g, W = 512, H = 384;
    g.fillStyle = '#c9b394'; g.fillRect(0, 0, W, H);
    noiseFill(g, W, H, '#bda684', 0.25, 900, 4);
    for (let i = 0; i < 12; i++) {
      const pw = rr(70, 120), ph = rr(80, 130);
      const x = rr(6, W - pw - 6), y = rr(6, H - ph - 6);
      g.save(); g.translate(x + pw / 2, y + ph / 2); g.rotate(rr(-0.07, 0.07));
      g.fillStyle = pick(['#f6f2e4', '#eef3f7', '#f9e9ea', '#e9f1e8']);
      g.fillRect(-pw / 2, -ph / 2, pw, ph);
      g.fillStyle = pick(['#d05a4a', '#4a7fb5', '#5aa06e', '#c79a3c']);
      g.fillRect(-pw / 2 + 8, -ph / 2 + 8, pw - 16, ph * 0.28);
      g.fillStyle = 'rgba(60,66,80,0.5)';
      for (let k = 0; k < 4; k++) g.fillRect(-pw / 2 + 10, -ph / 2 + ph * 0.45 + k * 15, pw - 20 - (k % 2) * 22, 6);
      g.strokeStyle = 'rgba(60,50,40,0.25)'; g.lineWidth = 2; g.strokeRect(-pw / 2, -ph / 2, pw, ph);
      g.restore();
    }
    return tx(o.c);
  });
}

/* ---- traffic & road signs ---- */
function streetSignTex() {
  return cache('streetsign', function () {
    const o = mk(512, 320), g = o.g, W = 512, H = 320;
    g.fillStyle = '#f2f4f6'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#2b3244'; g.lineWidth = 10; g.strokeRect(6, 6, W - 12, H - 12);
    g.fillStyle = '#2b3244'; g.font = '800 84px ' + JP; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('桜坂', 256, 88);
    g.font = '600 48px ' + JP; g.fillText('SAKURAZAKA', 256, 168);
    g.fillStyle = '#3d8fd6'; g.fillRect(40, 210, W - 80, 8);
    g.fillStyle = '#3a4252'; g.font = '600 44px ' + JP; g.fillText('← 駅前 2km', 256, 258);
    return tx(o.c);
  });
}
function parkSignTex() {
  return cache('parksign', function () {
    const o = mk(512, 256), g = o.g, W = 512, H = 256;
    g.fillStyle = '#2f6fc0'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#fff'; g.font = '800 74px ' + JP; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('駐車場', 256, 92);
    g.font = '600 40px ' + JP; g.fillText('P  24h', 256, 186);
    g.strokeStyle = '#fff'; g.lineWidth = 8; g.strokeRect(8, 8, W - 16, H - 16);
    return tx(o.c);
  });
}
function backDoorTex() {
  return cache('backdoor', function () {
    const o = mk(256, 128), g = o.g;
    g.fillStyle = 'rgba(245,242,235,0.96)'; g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#28303f'; g.font = '700 34px ' + JP; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('関係者以外', 128, 40);
    g.fillStyle = '#c0492f'; g.fillText('立入禁止', 128, 92);
    g.strokeStyle = 'rgba(30,36,50,0.4)'; g.lineWidth = 5; g.strokeRect(3, 3, 250, 122);
    return tx(o.c);
  });
}
function menuCardTex() {
  return cache('menu', function () {
    const o = mk(256, 256), g = o.g, W = 256, H = 256;
    g.fillStyle = '#f7f2e4'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#c0492f'; g.fillRect(0, 0, W, 46);
    g.fillStyle = '#fff'; g.font = '800 32px ' + JP; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('おでん', 128, 25);
    g.fillStyle = '#2b3244'; g.font = '600 26px ' + JP;
    const items = ['大根 100', '卵 90', '練物 120', '厚揚 130'];
    items.forEach(function (s, i) { g.fillText('¥ ' + s, 128, 90 + i * 38); });
    g.strokeStyle = 'rgba(30,36,50,0.35)'; g.lineWidth = 4; g.strokeRect(3, 3, W - 6, H - 6);
    return tx(o.c);
  });
}
function atmTex() {
  return cache('atm', function () {
    const o = mk(256, 384), g = o.g, W = 256, H = 384;
    g.fillStyle = '#2c3346'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#41506e'; g.fillRect(16, 16, W - 32, 150);
    g.fillStyle = '#7fd0ff'; g.font = '800 60px ' + JP; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('ATM', 128, 92);
    g.fillStyle = '#1c2233'; g.fillRect(16, 190, W - 32, 100);
    for (let i = 0; i < 9; i++) {
      g.fillStyle = '#5d6a86'; roundRect(g, 30 + (i % 3) * 68, 206 + Math.floor(i / 3) * 30, 54, 22, 4); g.fill();
    }
    g.fillStyle = '#38425c'; g.fillRect(30, 306, 196, 60);
    return tx(o.c);
  });
}
function trashTex() {
  return cache('trash', function () {
    const o = mk(256, 256), g = o.g, W = 256, H = 256;
    g.fillStyle = '#f2f2ee'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#3fae74'; g.fillRect(0, 0, W, 60);
    g.fillStyle = '#fff'; g.font = '800 42px ' + JP; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('ゴミ', 128, 32);
    g.fillStyle = '#28303f'; g.font = '700 36px ' + JP; g.fillText('分別', 128, 130);
    g.fillStyle = '#888'; g.font = '600 26px ' + JP; g.fillText('びん・かん', 128, 200);
    return tx(o.c);
  });
}
