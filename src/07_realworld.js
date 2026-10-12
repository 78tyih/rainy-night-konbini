/* ============ 07 real-world physics + detail pass ============
   Applied on top of the existing scene. Owns its own rAF update loop
   so it never has to touch the main animate() in 06.
   Priorities come from external review (K2.8 Preview + gpt-6-astra).
   ================================================================ */
(function () {

  /* ---------- 1. light subtraction: 17 real lights -> 10 ----------
     Physical point lights in r128 use 1/d^decay, so every light within
     ~1.5m of a surface blows it out. Non-essential lights are removed and
     their glow is carried by emissive + radial sprites instead.          */
  (function lightSubtract() {
    const kill = [];
    scene.traverse(function (o) {
      if (!o.isLight || o.type !== 'PointLight') return;
      const hex = o.color.getHexString();
      const d = o.distance;
      // vending machine glows (4x)
      if (hex === 'bfdcff' && d === 5.5) kill.push(o);
      // alley wall lamp
      else if (hex === 'ffc98a' && Math.abs(d - 6.5) < 0.01) kill.push(o);
      // bulletin board lamp
      else if (hex === 'ffd8a0' && d === 4) kill.push(o);
      // facade spill (its job is done by the additive glow decals)
      else if (hex === 'ffc98a' && Math.abs(d - 7) < 0.01) kill.push(o);
    });
    kill.forEach(function (l) { if (l.parent) l.parent.remove(l); });

    // rebalance what remains: interior strongest, moonlight cold & blue-violet.
    // Raised back up after the colour pipeline landed: linearising every
    // material removed the double-gamma lift the old values were tuned against,
    // so the whole scene dropped ~2 stops and read as one flat blue note.
    AMB.color.setHex(0x232c48); AMB.intensity = 0.24;
    HEMI.color.setHex(0x4d6191); HEMI.groundColor.setHex(0x12161f); HEMI.intensity = 0.18;
    MOON.color.setHex(0x8098d6); MOON.intensity = 0.30;
    RIM.color.setHex(0x6f8cc9); RIM.intensity = 0.14;
    scene.traverse(function (o) {
      if (o.isLight && o.type === 'PointLight' && o.color.getHexString() === 'ffd7a2') o.intensity = 0.80;
    });
    // hard, clean shadow edges read far more "anime background" than soft ones
    MOON.shadow.bias = -0.0004;
    MOON.shadow.normalBias = 0.012;
  })();

  /* ---------- 2. outline grading + air perspective ----------
     Outline: pure black reads like a sticker at night -> deep indigo;
     and thickness is graded so small interior props don't get heavy shells.
     Air perspective: distant masses desaturate and drift toward fog colour. */
  (function grade() {
    const FOG = new T.Color(0x1b2440);
    const OUT_INDIGO = 0x141226;
    const far = [];
    scene.traverse(function (o) {
      if (o.isMesh && o.userData.isOutline) {
        if (!o.material.__graded) {
          const m = o.material.clone();
          m.color.setHex(OUT_INDIGO);
          o.material = m; o.material.__graded = true;
        }
        const s = o.scale;
        const avg = (s.x + s.y + s.z) / 3;
        if (avg > 1.25) { // very small parts: thin shell
          o.scale.set(1 + (s.x - 1) * 0.62, 1 + (s.y - 1) * 0.62, 1 + (s.z - 1) * 0.62);
        }
      }
      if (o.isMesh && !o.userData.isOutline && o.material && o.material.color) {
        // Same baked-geometry trap as addOutline(): these meshes all sit at
        // (0,0,0), so getWorldPosition() reports the world origin — which is
        // INSIDE the shop — for every seg()/prismAt() surface in the file.
        // Use the geometry's own bounding-box centre in world space instead.
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        const wp = o.geometry.boundingBox.getCenter(new T.Vector3());
        o.updateWorldMatrix(true, false);
        wp.applyMatrix4(o.matrixWorld);
        // anything inside the shop volume is exempt from air perspective AND
        // from fog: distance haze on a lit interior destroys the warm/cold
        // contrast the whole piece is built on
        const inside = wp.x > -6.6 && wp.x < 3.4 && wp.z > -6.3 && wp.z < 3.0 && wp.y < 2.7;
        if (inside) { o.material.fog = false; return; }
        const d = Math.hypot(wp.x, wp.z);
        if (d > 9.5 || wp.z < -7.0) far.push(o);
      }
    });
    far.forEach(function (o) {
      const m = o.material.clone();
      const c = m.color.clone();
      const hsl = { h: 0, s: 0, l: 0 };
      c.getHSL(hsl);
      c.setHSL(hsl.h, hsl.s * 0.62, hsl.l * 0.74);
      c.lerp(FOG, 0.24);
      m.color.copy(c);
      o.material = m;
    });
  })();

  /* ---------- 3. sky: stars on the existing dome ---------- */
  (function stars() {
    const n = 140, p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const el = 0.25 + Math.random() * 1.15;
      const r = 76;
      p[i * 3] = Math.cos(a) * Math.cos(el) * r;
      p[i * 3 + 1] = Math.sin(el) * r;
      p[i * 3 + 2] = Math.sin(a) * Math.cos(el) * r;
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(p, 3));
    const m = new T.PointsMaterial({ color: 0xcfe0ff, size: 0.55, sizeAttenuation: true, transparent: true, opacity: 0.55, fog: false, depthWrite: false });
    const pts = new T.Points(g, m);
    pts.frustumCulled = false;
    scene.add(pts);
  })();

  /* ---------- 4. rain physics: terminal-velocity tiers, length from speed,
        a shared low-frequency wind field (no per-frame jitter) ---------- */
  const WIND = { x: 0.95, z: 0.30, t: 0 };
  function windGen(seed) {
    const b = [
      { tau: 0.30, amp: 0.10, v: 0 },
      { tau: 1.50, amp: 0.16, v: 0 },
      { tau: 6.00, amp: 0.11, v: 0 },
      { tau: 20.0, amp: 0.07, v: 0 }
    ];
    return { b: b, seed: seed };
  }
  const WIND_X = windGen(1.7), WIND_Z = windGen(4.3);
  function windStep(gen, dt) {
    let out = 0;
    for (let i = 0; i < gen.b.length; i++) {
      const band = gen.b[i];
      /* THE BUG THIS GUARDS (found round 5, cost the rain its entire existence):
         a negative dt makes a = exp(-dt/tau) > 1, so 1 - a*a goes negative and
         Math.sqrt of it is NaN.  `band.v = a*band.v + ...*NaN` is NaN forever,
         WIND inherits it, the rain shader multiplies its vertices by it and
         nothing rasterises -- and because WIND.x is refilled from the bands
         every frame, the NaN is permanent and unrecoverable.  Measured: rain
         dead in 5 of 6 cold loads.  Both halves of the guard are needed:
         clamp dt upstream AND keep the sqrt argument non-negative here, because
         a NaN already in band.v would otherwise survive a dt-only fix. */
      const tau = (isFinite(band.tau) && band.tau > 1e-4) ? band.tau : 1.0;
      const a = Math.exp(-dt / tau);
      const inner = Math.max(0, 1 - a * a);
      band.v = a * band.v + (Math.random() * 2 - 1) * band.amp * Math.sqrt(inner);
      if (!isFinite(band.v)) band.v = 0;
      out += band.v;
    }
    return isFinite(out) ? out : 0;
  }
  (function rainPhysics() {
    const g = RAIN.geometry;
    const spd = g.attributes.aSpd.array, len = g.attributes.aLen.array, seed = g.attributes.aSeed.array;
    /* Four terminal-velocity tiers, 6-9 m/s (GPT r5).  The shader advances the
       phase by `uTime * aSpd` straight, so aSpd is cycles per second and the
       fall is honest: uSpan 22 m crossed in 22/v seconds.  Streak length is
       v * 26 ms of exposure -> 0.14-0.26 m, i.e. 16-30 px at the hero camera. */
    const tiers = [6.0, 7.0, 8.0, 9.0];
    for (let i = 0; i < spd.length; i++) {
      const tier = tiers[Math.floor(seed[i] * 3.999)];
      const v = tier * (0.9 + (seed[i] * 7.3 % 1) * 0.2);
      spd[i] = v / 1.87;
      len[i] = v * 0.026;
    }
    g.attributes.aSpd.needsUpdate = true;
    g.attributes.aLen.needsUpdate = true;
    RAIN.material.uniforms.uColor.value.setHex(0xcde0ff);
    /* 0.235 -> 0.28.  probe_rain measures the mean fade envelope vA = 0.896,
       so the effective peak is 0.896 * 0.28 = 0.251 -- the first value to clear
       GPT r6's "peak effective alpha 0.25-0.55" floor.  It was 0.211 before,
       which is the second reason the splashes read as uncaused. */
    RAIN.material.uniforms.uOp.value = 0.28;
    /* `uCut` used to live here with a comment claiming it stopped the rain at
       the canopy.  The shader never referenced it -- it was a dead uniform
       pretending a feature existed.  The real cut is uOccMin/uOccMax, built in
       06_effects.js from 04_store.js's own constants. */
  })();

  /* ---------- 5. eave drips: reservoir model, splash + ripple coupled
        to the SAME impact point (the causal link the review asked for) ------ */
  const DRIPS = [];

  /* ====================== RIPPLES ======================
     The ground's answer to the rain.  Replaces BOTH previous attempts:

       (a) 700 additive Points whose gl_PointSize computed to
           0.055 * 450 / 27 = 0.917 px and was then clamped up to 1 px, so
           every particle was one pixel wide, and
       (b) a 22-mesh pool of RingGeometry(0.02, 0.055, 14) -- a 0.035 m annulus
           on a 0.11 m ring, 1.93-5.29 px across, 7 of 22 alive at a time.

     Measured verdict: the causal chain was always correct (real CPU drops, the
     same wind, a real dry zone under the canopy), and the signal was still
     absent, because both attempts put the whole effect inside 1-5 pixels at
     58.1 px/m.  The rain escaped this same trap earlier by moving from
     GL_LINES to ribbons; this moves the ground splash into world-space
     geometry the same way.

     DESIGN, and which review each part answers:

     * InstancedBufferGeometry, one 4-vertex quad, 512 instances.  GPT r9 #1:
       "若把 1024 个 quad 拼进普通 BufferGeometry，那是合批，不是实例化".
     * The quad is expanded in the VERTEX shader to a radius in METRES, so the
       on-screen size is pure perspective and no size can be clamped away.
     * r(t) = r0 + 0.106 * t^(2/3).  Kimi r9 #1, from the capillary-wave-front
       law r = 2.54 (sigma/rho)^(1/3) t^(2/3); the LINEAR reading I proposed is
       explicitly wrong ("任何'匀速 0.3 m/s'之类的取法在物理上都站不住"), and the
       capillary minimum phase speed c_min ~ 0.23 m/s puts a floor under any
       constant-speed approximation.
     * CONSTANT band width ~18 mm, NOT proportional to the radius.  Kimi r9 #2:
       the ring locks to the capillary-gravity minimum wavelength (1.5-2.5 cm),
       which is why real rain rings read as a fine line rather than a thickening
       halo.  This is the opposite of scaling a ring geometry.
     * Two-tone, NORMAL blending, never additive.  GPT r9 #5 ("水花没有自动获得
       破格发光的资格 ... 遍地自发光环会把雨夜便利店变成魔法地面") and Kimi r9 #7
       ("你现在的加法混合发光环在物理上是错的符号：环带两侧应一侧变亮、一侧
       变暗") agree.  A ripple is the surface tilting, so the near side takes
       the dark and the far side takes the light.  Both colours are lifted from
       the wet asphalt, and linearised by hand because colourPipeline() skips
       ShaderMaterial.
     * fwidth() analytic AA.  Kimi's headline risk: an 18 mm band is 1.05 px at
       58.1 px/m and, squashed by sin(0.22) = 0.22 at the hero elevation, only
       0.23 px across.  Without derivative-based AA this is flicker, and moving
       from one clamped primitive into a thin geometric band would be "从同一个
       坑的左壁爬到右壁".
     * Capacity discipline.  Survival = acceptance rate x lifetime must stay
       well under the slot count or the ring buffer overwrites live ripples and
       they vanish mid-life -- GPT r9 #9 and Kimi r9 #6 both call that worse
       than never appearing.  The writer SEARCHES for a dead slot and COUNTS
       refusals rather than overwriting; refusals are published.
     * Depth from the authored puddles.  Kimi r9 #7: film thickness governs both
       damping and ring size, so deep spots get a bigger, longer ring; the low
       spots are already marked by buildPuddles()' own coordinates, so this
       reuses authored data instead of inventing a texture.
     * frustumCulled = false.  GPT r9 #9's engineering kill-shot: the CPU
       bounding volume cannot know the shader will expand vertices, so the whole
       system can be culled while entirely on screen. */
  const RIPPLES = (function () {
    const K = 512;                 // slots
    /* Staged, not final.  The algebra: survival = RATE * lifetime.
       220 x ~0.5 s = ~110 live  (0.21 K)  -- no overwrite possible, big margin.
       Kimi's target of 600-1500/s needs 300-750 live, i.e. K >= 1024 AND the
       paired I0/IR/IG/IRG contrast budget built first (GPT r9 #3).  220 is the
       value this round can actually stand behind; it is a staging number with
       the arithmetic shown, not a claim about rain.
       GPT r9 #1 is explicit that the rate must not be scaled before a single
       event has been shown legible: "先保持事件率，验证单个事件在目标视角可读，
       再增加事件率".  One event is now ~9-20 px instead of 1-5 px, which is the
       condition that made that instruction worth keeping. */
    const RATE = 220;              // accepted events / second
    const R0 = 0.004;              // birth radius, absorbs the sqrt(t) stage
    const RSPEED = 0.106;          // metres per t^(2/3)  (Kimi r9 #1)
    const BAND = 0.009;            // annulus HALF width -> ~18 mm full band
    const LIGHT = new T.Color(0x66799a).convertSRGBToLinear();
    const DARK = new T.Color(0x171c26).convertSRGBToLinear();

    const CORNER = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const base = new T.InstancedBufferGeometry();
    const vp = new Float32Array(4 * 3), vc = new Float32Array(4 * 2);
    CORNER.forEach(function (c, i) {
      vp[i * 3] = 0; vp[i * 3 + 1] = 0; vp[i * 3 + 2] = 0;
      vc[i * 2] = c[0]; vc[i * 2 + 1] = c[1];
    });
    base.setAttribute('position', new T.BufferAttribute(vp, 3));
    base.setAttribute('aCorner', new T.BufferAttribute(vc, 2));
    base.setIndex([0, 1, 2, 0, 2, 3]);
    const iCenter = new T.InstancedBufferAttribute(new Float32Array(K * 3), 3);
    const iBirth = new T.InstancedBufferAttribute(new Float32Array(K), 1);
    const iMaxR = new T.InstancedBufferAttribute(new Float32Array(K), 1);
    const iDur = new T.InstancedBufferAttribute(new Float32Array(K), 1);
    const iPeak = new T.InstancedBufferAttribute(new Float32Array(K), 1);
    const iSeed = new T.InstancedBufferAttribute(new Float32Array(K), 1);
    /* every slot starts "born in the far past" = dead, so nothing pops on
       frame 1 and the dead-slot search always succeeds early on */
    for (let i = 0; i < K; i++) { iBirth.array[i] = -1e3; iDur.array[i] = 0.5; }
    [iCenter, iBirth, iMaxR, iDur, iPeak, iSeed].forEach(function (a) {
      a.setUsage(T.DynamicDrawUsage);
    });
    base.setAttribute('iCenter', iCenter);
    base.setAttribute('iBirth', iBirth);
    base.setAttribute('iMaxR', iMaxR);
    base.setAttribute('iDur', iDur);
    base.setAttribute('iPeak', iPeak);
    base.setAttribute('iSeed', iSeed);
    base.instanceCount = K;

    const mat = new T.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uR0: { value: R0 }, uSpeed: { value: RSPEED },
        uBand: { value: BAND },
        uLight: { value: LIGHT }, uDark: { value: DARK }, uOp: { value: 1.0 },
        /* the impact core.  Kimi r10 #3 called this "not optional": without it
           every ring expands from nothing, because at birth r = R0 = 4 mm
           (0.4 px) and the ring's own amplitude is still inside its 40 ms
           smoothstep ramp.  A ring appears out of empty road.  The core is the
           one part that is brightest at age 0 and gone in ~3 frames. */
        uCoreR: { value: 0.018 },                // 18 mm -> 1.7 px @ 96.3 px/m
        uCoreT: { value: 0.05 },                 // seconds; ~3 frames at 60 fps
        uCore: { value: new T.Color(0xa9bcda).convertSRGBToLinear() }
      },
      transparent: true, depthWrite: false, depthTest: true,
      blending: T.NormalBlending, side: T.DoubleSide,
      extensions: { derivatives: true },
      vertexShader: [
        'attribute vec2 aCorner;',
        'attribute vec3 iCenter; attribute float iBirth; attribute float iMaxR;',
        'attribute float iDur; attribute float iPeak; attribute float iSeed;',
        'uniform float uTime; uniform float uR0; uniform float uSpeed;',
        'uniform float uCoreR; uniform float uCoreT;',
        'varying float vR; varying float vRing; varying float vA; varying float vSeed;',
        'varying float vC; varying float vCR;',
        'void main(){',
        '  float age = max(uTime - iBirth, 0.0);',
        '  float t = clamp(age / max(0.05, iDur), 0.0, 1.0);',
        /* capillary front: r = r0 + c * t^(2/3), clamped to this event's cap */
        '  float r = min(iMaxR, uR0 + uSpeed * pow(age, 0.6667));',
        '  vec3 p = iCenter + vec3(aCorner.x * r, 0.0, aCorner.y * r);',
        /* radial distance of THIS vertex, in metres -- the fragment needs it in
           world units so the band is a constant width, not a screen fraction */
        '  vR = length(aCorner) * r;',
        '  vRing = r;',
        '  vSeed = iSeed;',
        /* amplitude: exponentially damped (Kimi r9 #1 "薄膜黏性阻尼") and forced
           to exact zero at the end of life so nothing snaps out */
        '  float damp = exp(-3.0 * t) * (1.0 - t);',
        '  float born = smoothstep(0.0, 0.04, age);',
        '  vA = damp * born * iPeak;',
        /* the core is deliberately NOT multiplied by `born`: it is the one
           thing that must be at full strength on the exact frame of impact,
           while the ring is still ramping up.  It decays on its own clock so
           nothing about its life is tied to the ring's. */
        '  vC = clamp(1.0 - age / uCoreT, 0.0, 1.0) * iPeak;',
        '  vCR = max(uCoreR, r);',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform float uBand; uniform vec3 uLight; uniform vec3 uDark; uniform vec3 uCore; uniform float uOp;',
        'varying float vR; varying float vRing; varying float vA; varying float vSeed;',
        'varying float vC; varying float vCR;',
        'void main(){',
        '  if (max(vA, vC) < 0.004) discard;',
        '  float d = vR - vRing;',
        '  float ad = abs(d);',
        /* AA: the band is ~1 px before projection squashes it to ~0.23 px, so
           the filter width is the only thing standing between this and flicker */
        '  float aa = fwidth(vR) * 1.6 + 0.0008;',
        '  float band = 1.0 - smoothstep(uBand, uBand + aa, ad);',
        /* the impact core: a filled disc of radius vCR, not an annulus */
        '  float disc = 1.0 - smoothstep(vCR - aa, vCR + aa, vR);',
        /* the tilt: near side of the front takes the dark, far side the light.
           Two discrete levels, no smooth gradient -- GPT r9 #5. */
        '  vec3 col = mix(uDark, uLight, step(0.0, d));',
        /* per-event variation so a field of rings is not one stamped sprite */
        '  float ra = band * vA * uOp * (0.78 + 0.44 * fract(vSeed * 7.31));',
        '  float ca = disc * vC * uOp * 0.9;',
        '  float alpha = clamp(ra + ca, 0.0, 1.0);',
        '  if (alpha <= 0.002) discard;',
        /* the core is still a shade of wet asphalt, never a white flash --
           GPT r9 #5 forbids a water splash earning additive glow by default */
        '  col = mix(col, uCore, clamp(ca / max(alpha, 0.0001), 0.0, 1.0));',
        '  gl_FragColor = vec4(col, alpha);',
        '}'
      ].join('\n')
    });
    const mesh = new T.Mesh(base, mat);
    mesh.frustumCulled = false;    // see the design note: the shader expands
    mesh.renderOrder = 4;
    scene.add(mesh);

    let spi = 0, cool = 0, dropped = 0, accepted = 0, uNow = 0;
    /* A slot may only be reused once its ripple is genuinely dead.  Walking
       forward beats overwriting in place: an overwritten ripple disappears
       mid-life, which GPT and Kimi both rank as more objectionable than one
       that never appeared. */
    function take(now) {
      for (let n = 0; n < K; n++) {
        const i = (spi + n) % K;
        if (now - iBirth.array[i] >= iDur.array[i]) { spi = (i + 1) % K; return i; }
      }
      return -1;                   // capacity exhausted: refuse, do not clobber
    }
    /* Marshall-Palmer-ish skew.  Kimi r9 #10: sampling max radius from a skewed
       distribution (many small, few large) removes the machine-uniform look for
       the price of one rand(). */
    function emit(x, z, power, isDrip) {
      const now = uNow;
      const i = take(now);
      if (i < 0) { dropped++; return; }
      accepted++;
      const deep = puddleDepth(x, z);            // 0 dryish / 1 shallow / 2 deep
      const big = Math.pow(Math.random(), 2.2);
      let maxR = 0.09 + 0.20 * big;
      let dur = 0.34 + Math.random() * 0.42;
      let peak = 0.34 + 0.16 * big;
      if (deep === 2) { maxR *= 1.9; dur *= 2.1; peak *= 1.35; }      // standing water
      else if (deep === 1) { maxR *= 1.35; dur *= 1.4; }
      if (isDrip) {
        /* Kimi r9 #9: an eave drip and a raindrop arrive at almost the SAME
           speed (sqrt(2 g h) = 7.1 m/s vs 6-9 m/s) -- the difference is size,
           and the energy goes as d^3 v^2, i.e. ~12x.  So it is made LOUDER, not
           just bigger: the ring only grows ~1.5x, while peak brightness and
           lifetime carry the difference. */
        maxR *= 1.5 * (1 + power * 0.35);
        dur *= 1.8;
        peak *= 2.1;
      }
      iCenter.array[i * 3] = x;
      iCenter.array[i * 3 + 1] = surfaceY(x, z) + 0.004;
      iCenter.array[i * 3 + 2] = z;
      iBirth.array[i] = now;
      iMaxR.array[i] = maxR;
      iDur.array[i] = dur;
      iPeak.array[i] = peak;
      iSeed.array[i] = Math.random();
      /* second concentric ring.  Kimi r9 #3: when the crater collapses and the
         Worthington jet re-lands, 30-80 ms later, a second ring is fired at
         30-50 % of the first.  Only for the larger impacts, and explicitly NOT
         a harmonic series -- the two have no integer frequency relationship. */
      if (big > 0.62 && accepted % 100 < 35) {
        const j = take(now);
        if (j >= 0) {
          iCenter.array[j * 3] = x;
          iCenter.array[j * 3 + 1] = iCenter.array[i * 3 + 1];
          iCenter.array[j * 3 + 2] = z;
          iBirth.array[j] = now + 0.055 + Math.random() * 0.02;
          iMaxR.array[j] = maxR * 0.85;
          iDur.array[j] = dur * 0.9;
          iPeak.array[j] = peak * 0.4;
          iSeed.array[j] = Math.random();
        }
      }
    }
    return {
      emit: emit,
      setNow: function (t) { uNow = t; },
      step: function (dt, t) {
        uNow = t;
        mat.uniforms.uTime.value = t;
      },
      flush: function () {
        iCenter.needsUpdate = true; iBirth.needsUpdate = true;
        iMaxR.needsUpdate = true; iDur.needsUpdate = true;
        iPeak.needsUpdate = true; iSeed.needsUpdate = true;
      },
      stats: function () {
        let live = 0;
        for (let i = 0; i < K; i++) if (uNow - iBirth.array[i] < iDur.array[i]) live++;
        return { K: K, live: live, accepted: accepted, dropped: dropped, rate: RATE };
      }
    };
  })();

  /* Film depth, taken from the puddles buildPuddles() already authored.  A
     puddle IS a low spot, so its footprint is the honest place to look for
     standing water -- no new texture, and the two can never disagree about
     where the ground is wet. Kimi r9 #7: film thickness sets damping and ring
     size, and "你不该补'水膜几何'，但必须补'水膜信息'". */
  function puddleDepth(x, z) {
    let best = 0;
    for (let i = 0; i < puddles.length; i++) {
      const m = puddles[i];
      const g = m.geometry, pa = g.parameters || {};
      if (!pa.width) continue;
      const dx = x - m.position.x, dz = z - m.position.z;
      /* the decal is rotated in-plane by m.rotation.z; undo it to test the
         ellipse in its own frame */
      const c = Math.cos(-m.rotation.z), s = Math.sin(-m.rotation.z);
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      const u = (lx / (pa.width / 2)), v = (lz / (pa.height / 2));
      const r2 = u * u + v * v;
      if (r2 < 0.55) best = 2;              // solidly inside a puddle
      else if (r2 < 1.15 && best < 1) best = 1;
    }
    return best;
  }
  (function eaveDrips() {
    /* Reservoir sites sit ON THE DRIP LINE, not somewhere under the eave.
       The canopy slab runs from off 0.09 to 1.11 and its fascia to 1.125, so
       on the front facade the water leaves the roof at z = 3.00 + 1.125 =
       4.13 and on the right facade at x = 3.40 + 1.125 = 4.53.  The old sites
       (z = 3.95, x = 3.35) were still 0.18 m INSIDE the canopy footprint --
       rain that visibly fell through its own roof.  Likewise y: the water
       creeps down the 0.44 m fascia and releases off its bottom lip at
       EAVE_Y - 0.28 = 2.34, not from 2.72 up at slab level.
       Both the front walk (z 3.0..5.5) and the right walk (x 3.4..5.5) extend
       far enough to catch every one of these. */
    const sites = [
      [-5.4, 2.40, 4.16], [-4.1, 2.40, 4.16], [-2.8, 2.40, 4.16],
      [-1.5, 2.40, 4.16], [-0.2, 2.40, 4.16], [1.6, 2.40, 4.16],
      [4.53, 2.40, -4.6], [4.53, 2.40, -2.6], [4.53, 2.40, -0.6], [4.53, 2.40, 1.2]
    ];
    const dropGeo = new T.SphereGeometry(0.055, 8, 6);
    const dropMat = basic(0xbcd8f0, { opacity: 0.75 });
    sites.forEach(function (p, i) {
      const m = new T.Mesh(dropGeo, dropMat);
      m.visible = false;
      /* A falling droplet is a particle, not matter: it is SUPPOSED to be in
         mid-air, and a support audit that does not know that will report the
         one that happens to be falling at the sampled frame as a floating
         object.  Tag it so probe_float2 / probe_sunk can skip the class. */
      m.userData.transient = true;
      scene.add(m);
      DRIPS.push({
        m: m, x: p[0], y0: p[1], z: p[2],
        vol: Math.random() * 0.7,        // 0..1 fill state
        // per-site supply: most water runs to the gutter, only a few lips
        // leak — so the eight points must NOT share one uniform rate
        rate: [0.10, 0.26, 0.07, 0.30, 0.13, 0.22, 0.09, 0.17][i % 8],
        cap: 0.75 + Math.random() * 0.5, // pinning threshold varies per site
        falling: false, v: 0, y: p[1]
      });
    });
    /* ONE emitter for every landing event, so no ripple can exist without a
       cause -- the gate GPT r5 set ("没有对应落水事件的主动溅射 0 次") and Kimi r9
       #3 restated from the other side ("有落水必溅射").  There is no ring
       geometry and no pool of meshes any more: both callers hand a real
       position to RIPPLES, which owns placement, size, life and colour. */
    DRIPS.emitSplash = function (x, z, power) {
      RIPPLES.emit(x, z, power === undefined ? 0 : power, true);
    };
    /* ambient rainfall: 07's coupled CPU drops call this on landing */
    DRIPS.spawnImpact = function (x, z) {
      RIPPLES.emit(x, z, 0, false);
    };
  })();

  /* ---------- 5b. ambient rainfall impacts ----------
     The drops are simulated on the CPU with the SAME wind vector, the same
     velocity tiers and the same shelter boxes as the GPU rain in 06_effects.js
     -- not a decorative timer.  Every ring therefore has a real (x,z) parent,
     the dry zone under the canopy really is dry, and the wind that tilts the
     rain is the wind that moves the impact point (GPT r5 chain #1 and #2). */
  const IMPACTS = (function () {
    /* N and RATE were set for a 26/s drip of rings.  RIPPLES accepts 220/s, and
       the population has to be able to SUPPLY that, so N was sized from the
       measured gate ratios rather than guessed: a drop falls ~17 m at 6-9 m/s
       (~2.27 s per cycle), and of every landing only ~44 % is on open ground
       (the rest is off the base or under the canopy), so the supply rate is
       N * 0.44 / 2.27 = N * 0.194.  1400 drops therefore supply ~272/s against
       a demand of 220/s, leaving the throttle rather than the population as the
       binding term.  1400 float integrations a frame is nothing; the cost that
       mattered was never here, it was the per-ring mesh. */
    const N = 1400, tiers = [6.0, 7.0, 8.0, 9.0], RATE = 220;   // impacts / second
    const d = [];
    /* Spawn disc R matches the rain's own spawn radius in 06_effects.js (17.0).
       Kimi r9 #3: with the old 13.5 m cull the outer 13.5-17 m annulus rained
       with nothing answering it, and at a grazing angle that annulus is a large
       share of the frame.  Same radius both sides, which is the dual of the
       r5 gate: no impact without a drop, no drop without an impact. */
    const R = 17.0;
    for (let i = 0; i < N; i++) {
      const a = rnd() * Math.PI * 2, r = R * Math.sqrt(rnd());
      d.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, y: rr(-4, 17),
               v: tiers[Math.floor(rnd() * 3.999)] });
    }
    /* ACCUMULATED BUDGET, not a per-frame one-shot.
       The old throttle was `if (cool <= 0) { emit(); cool = 1 / RATE; }`, which
       was fine at RATE = 26 because 26/s is below any frame rate.  At 220/s it
       is not: one event per frame is ALL that structure can ever produce, so the
       measured result was 34 events in 34 frames -- exactly one per frame --
       while `RATE = 220` sat in the source looking authoritative.  Anything
       above the frame rate was silently discarded, and at the probe's 2.8 fps
       (SwiftShader) that was a 6x undercount on top.
       Now the frame is paid a budget of dt * RATE events and spends it, with
       the carry clamped so a long stall (tab restore, GC) cannot dump a burst.
       NOTE ON UNITS: everything here is SIMULATED seconds.  dt is clamped to
       0.05 s upstream, so on a slow renderer simulated time advances far slower
       than wall clock -- 34 frames is 1.7 simulated seconds, not 12 s.  Rate and
       lifetime numbers must be read in simulated seconds or they look absurd. */
    const BURST = 0.10;                       // never owe more than 100 ms
    let budget = 0;
    const C = window.__IMPACTS = { land: 0, onBase: 0, open: 0, cooled: 0, emitted: 0, frames: 0 };
    return {
      step: function (dt) {
        const wx = isFinite(WIND.x) ? WIND.x : 0.95;
        const wz = isFinite(WIND.z) ? WIND.z : 0.30;
        budget = Math.min(budget + dt * RATE, RATE * BURST);
        C.frames++;
        for (let i = 0; i < N; i++) {
          const p = d[i];
          p.y -= p.v * dt;
          p.x += wx * 0.16 * p.v * dt;
          p.z += wz * 0.16 * p.v * dt;
          /* A drop lands when it reaches the SURFACE, and the surface is
             ROAD_TOP.  Testing against TOP_ROAD let every drop fall 40 mm
             through the visible ground before it was allowed to splash, so the
             impact -- and therefore the ripple -- was registered up to 40 mm
             below where a viewer would see the ground. */
          if (p.y <= ROAD_TOP) {
            C.land++;
            /* only real ground can be splashed: off the base there is nothing to
               hit, and an "impact" out there would be exactly the causeless
               splash the r5 review deleted */
            const onBase = (p.x > -HALF && p.x < HALF && p.z > -HALF && p.z < HALF);
            if (onBase) {
              C.onBase++;
              if (shelterTop(p.x, p.z) === -Infinity) {
                C.open++;
                if (budget >= 1) {
                  DRIPS.spawnImpact(p.x, p.z);
                  C.emitted++;
                  budget -= 1;
                } else { C.cooled++; }
              }
            }
            p.y = 17;
            const a2 = rnd() * Math.PI * 2, r2 = R * Math.sqrt(rnd());
            p.x = Math.cos(a2) * r2; p.z = Math.sin(a2) * r2;
          }
        }
        C.budget = +budget.toFixed(2);
      }
    };
  })();

  /* ---------- 6. wet ground reflections: clamp length, break up with
        world-space noise so the streak never becomes an infinite bar ------- */
  (function wetGround() {
    reflectCards.forEach(function (c) { c.len = Math.min(c.len, 6.2); });
  })();

  /* ---------- 7. flicker: Ornstein-Uhlenbeck micro-flicker + one failing
        old lamp. Replaces the uniform sine flicker from 06. --------------- */
  const FLI = [];
  (function flicker() {
    const old = ANIM.flicker.slice();
    ANIM.flicker.length = 0;              // stop 06's sine update
    old.forEach(function (f, i) {
      FLI.push({ s: f.s, base: f.base, sigma: 0.004, state: 0, failing: false });
    });
    if (FLI.length) {
      FLI[FLI.length - 1].sigma = 0.012;  // the aged lamp
      FLI[FLI.length - 1].failing = true;
      FLI[FLI.length - 1].failTimer = 3 + Math.random() * 6;
      FLI[FLI.length - 1].pulse = 0;
    }
  })();

  /* ---------- 8. rain streaks on glass + cooler glass mist --------------- */
  function streakTex() {
    const o = mk(256, 512), g = o.g;
    g.clearRect(0, 0, 256, 512);
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * 256;
      const w = 1 + Math.random() * 2.6;
      const top = Math.random() * 180;
      const len = 90 + Math.random() * 340;
      const grd = g.createLinearGradient(0, top, 0, top + len);
      grd.addColorStop(0, 'rgba(226,240,255,0.00)');
      grd.addColorStop(0.18, 'rgba(226,240,255,0.30)');
      grd.addColorStop(0.75, 'rgba(210,232,255,0.16)');
      grd.addColorStop(1, 'rgba(200,225,255,0.00)');
      g.fillStyle = grd;
      // a wandering vertical trail, slightly wobbling
      g.beginPath();
      let px = x;
      g.moveTo(px, top);
      for (let t = 0; t <= len; t += 24) {
        px = x + Math.sin((t / len) * 4.0 + i) * 5.0;
        g.lineTo(px, top + t);
      }
      g.lineWidth = w; g.strokeStyle = grd; g.stroke();
      // pinned droplet at the trail head
      g.fillStyle = 'rgba(232,244,255,0.34)';
      g.beginPath(); g.ellipse(px, top + len, w * 0.9, w * 1.5, 0, 0, 6.3); g.fill();
    }
    return tx(o.c);
  }
  (function glassRain() {
    const tex = streakTex();
    const panels = [
      { x: -2.8, z: 3.06, w: 5.9, h: 1.72, y: 1.42, ry: 0 },
      { x: 2.05, z: 3.06, w: 2.1, h: 1.72, y: 1.42, ry: 0 },
      { x: 3.06, z: -3.1, w: 4.7, h: 1.72, y: 1.42, ry: Math.PI / 2 }
    ];
    panels.forEach(function (p) {
      const m = new T.Mesh(new T.PlaneGeometry(p.w, p.h),
        /* 0.15 -> 0.07 -> 0.045.  K2.8 round-3: "雨痕贴花 0.15 -> 0.07 … 两者
           贴图必须保证大面积 alpha=0，只有雨丝/流痕处有值."  Round 4 pushed it
           further because the measured residual said the veil was still eating
           chroma: three additive panels cover the whole glazing, and the goods
           faces behind them were coming back at 12-19 % saturation.  Additive
           white over a warm interior lifts every channel, and lifting the
           minimum channel is exactly what destroys saturation.  The cold tint
           is kept -- a cold reflection on warm glass is correct for a rainy
           night and the warm/cool contrast helps. */
        new T.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.045, depthWrite: false, blending: T.AdditiveBlending }));
      m.position.set(p.x, p.y, p.z);
      m.rotation.y = p.ry;
      m.renderOrder = 5;
      store.add(m);
    });
  })();

  /* ---------- 9. signage decals + street detail ---------- */
  function labelTex(draw, w, h) {
    const o = mk(w, h), g = o.g;
    draw(g, w, h);
    return tx(o.c);
  }
  function decalPlane(parent, tex, w, h, x, y, z, ry, op) {
    const m = new T.Mesh(new T.PlaneGeometry(w, h),
      new T.MeshBasicMaterial({ map: tex, transparent: true, opacity: op === undefined ? 0.92 : op, depthWrite: false, side: T.DoubleSide }));
    m.position.set(x, y, z); m.rotation.y = ry || 0;
    m.renderOrder = 2;
    m.userData.role = 'decal';
    parent.add(m);
    return m;
  }

  /* These three used to hang at z = 3.07 / 3.08 / 3.09, i.e. 50-70 mm OUTSIDE
     the outer face of the glazing, which occupies z 2.98..3.02 -- three more
     "things pinned to nothing" of exactly the kind Sera reported.  probe_gap
     listed them separately from the three big posters in 04_store.js because
     they come from a different builder: those went through poster(), these go
     through decalPlane().  Every pasted face now resolves to 2.9795, half a
     millimetre inboard of the pane's inner face, so the whole storefront reads
     as one consistent mounting rule rather than some inside and some outside.

     Open question, deliberately NOT resolved here: the strip says 自動ドア
     (automatic door) but sits on the front glazing at x = 0.2, while 04_store.js
     puts the actual automatic doors on the corner line at (1.65, 1.25).  Either
     the label is on the wrong aperture or there is a second door I cannot see.
     It is on a real surface now either way; the semantic question goes to r8. */
  (function signage() {
    // "自動ドア" strip on the sliding doors
    const doorTex = labelTex(function (g, w, h) {
      g.fillStyle = 'rgba(250,250,246,0.94)'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(40,46,60,0.55)'; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4);
      g.fillStyle = '#28303f'; g.font = '800 46px ' + JP; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('自動ドア', w / 2, h / 2);
    }, 256, 64);
    decalPlane(store, doorTex, 1.5, 0.22, 0.2, 1.92, 2.9795, 0, 0.9);

    // window stickers: 24h / ATM / たばこ
    const winTex = labelTex(function (g, w, h) {
      g.clearRect(0, 0, w, h);
      const items = [['24h', '#c9532f'], ['ATM', '#2b6bb5'], ['たばこ', '#3b4250']];
      items.forEach(function (it, i) {
        g.fillStyle = it[1];
        g.globalAlpha = 0.85;
        g.fillRect(6, 8 + i * 68, w - 12, 56);
        g.globalAlpha = 1;
        g.fillStyle = '#fdfdf8'; g.font = '800 38px ' + JP;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(it[0], w / 2, 36 + i * 68);
      });
    }, 128, 220);
    decalPlane(store, winTex, 0.44, 0.76, -4.4, 1.85, 2.9795, 0, 0.85);
    decalPlane(store, winTex, 0.40, 0.70, 3.03, 1.80, 0.4, Math.PI / 2, 0.8);

    // 防犯カメラ作動中 sticker by the entrance
    const secTex = labelTex(function (g, w, h) {
      g.fillStyle = '#f4efe2'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#2b3240'; g.lineWidth = 3; g.strokeRect(2, 2, w - 4, h - 4);
      g.fillStyle = '#1b2030'; g.font = '700 30px ' + JP; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('防犯カメラ作動中', w / 2, h / 2 - 6);
      g.fillStyle = '#a03a2a'; g.font = '700 18px ' + JP;
      g.fillText('24時間録画', w / 2, h / 2 + 20);
    }, 256, 96);
    decalPlane(store, secTex, 0.62, 0.24, -1.55, 2.16, 2.9795, 0, 0.9);

    // parking sign 「関係者以外駐車禁止」
    const parkTex = labelTex(function (g, w, h) {
      g.fillStyle = '#f2f0e8'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#1d4f8a'; g.fillRect(0, 0, w, 30);
      g.fillStyle = '#fff'; g.font = '700 20px ' + JP; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('駐車場', w / 2, 16);
      g.fillStyle = '#232a38'; g.font = '800 26px ' + JP;
      g.fillText('関係者以外', w / 2, 62);
      g.fillText('駐車禁止', w / 2, 94);
    }, 200, 130);
    const pg = group(PROPS, -7.2, 0, 9.6);
    addMesh(pg, new T.CylinderGeometry(0.045, 0.045, 1.25, 8), toon(0x8b8f98), { y: 0.62, ow: 0.03 });
    addMesh(pg, new T.BoxGeometry(0.72, 0.5, 0.05), toon(0xdfe3e8), { y: 1.36, ow: 0.035 });
    decalPlane(pg, parkTex, 0.68, 0.46, 0, 1.36, 0.035, 0, 0.95);

    // utility pole: neighbourhood plate 町名表示板
    const plateTex = labelTex(function (g, w, h) {
      g.fillStyle = '#f6f4ee'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#2b3240'; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4);
      g.fillStyle = '#1b2030'; g.font = '800 40px ' + JP; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('さくら町', w / 2, 34);
      g.font = '700 30px ' + JP;
      g.fillText('二丁目', w / 2, 76);
    }, 180, 110);
    /* The neighbourhood plate used to be a bare decalPlane at
       (7.28, 3.05, 1.55) with NO post and NO wall: probe_near reports that
       within 1.2 m of that point there is exactly one mesh in the whole scene --
       the plate itself.  Nothing under it for 2.9 m.  It floated, and it only
       looked bolted because from the hero angle it projects in front of the
       store's white corner column.

       Both reviewers were asked about it.  Kimi wanted it moved onto the
       utility pole at (4.4, 9.6) at y~2.2; GPT wanted "移到真实安装面或删除".
       Moving it to that pole would take it 8.9 m out of frame to the back edge
       and make it invisible, which is a delete by another name, so I am taking
       GPT's first branch literally instead: give it the mounting face it should
       always have had.  A thin steel post from the walk to the plate plus two
       straps is exactly how a 町名表示板 is installed in Japan, and it needs no
       new composition decision. */
    const npX = 5.30, npZ = 1.55, npY = 3.05;
    /* npX used to be 7.28.  That is 1.78 m out into the roadway, and worse, it
       is INSIDE the right-road crossing: buildPaint lays its bars across
       x 5.68..8.53 at z -3.51..2.55, so the post stood in the middle of a
       pedestrian crossing -- and, being modelled at y = TOP_WALK, 40 mm above
       the tarmac it was standing on.  probe_columns measured both:
       base -0.0300 over ground -0.0400 at (7.28, 1.55).
       A 町名表示板 goes on the pavement hard against the kerb, so it keeps its
       z (and therefore its silhouette against the store's corner) and moves to
       x = 5.30: on the right walk (3.4..5.5), 0.22 m behind the kerb at 5.52 and
       0.25 m clear of the gutter grating's inner edge at 5.55. */
    /* the plate faces -X (ry = -PI/2), so its mounting offsets run along -X,
       not -Z.  The post is 0.047 radius; the plate's back sits on the post's
       -X face and the printed decal sits on the plate's -X face. */
    addMesh(PROPS, new T.CylinderGeometry(0.047, 0.055, npY + 0.16, 10),
            toon(0x9aa2ad), { x: npX, y: (npY + 0.16) / 2, z: npZ, ow: 0.03 });
    addMesh(PROPS, new T.CylinderGeometry(0.10, 0.12, 0.09, 10),
            toon(0x5f6774), { x: npX, y: 0.045, z: npZ, ow: 0.028 });
    addMesh(PROPS, new T.BoxGeometry(0.055, 0.40, 0.40),
            toon(0x6d747f), { x: npX - 0.075, y: npY, z: npZ, ow: 0.026 });
    addMesh(PROPS, new T.BoxGeometry(0.035, 0.37, 0.54), toon(0xdfe3e8),
            { x: npX - 0.105, y: npY, z: npZ, ow: 0.03 });
    decalPlane(PROPS, plateTex, 0.46, 0.30, npX - 0.124, npY, npZ, -Math.PI / 2, 0.9);

    // おでん price board over the hot counter
    const odenTex = labelTex(function (g, w, h) {
      g.fillStyle = '#8c3a2c'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#f7efdc'; g.font = '800 52px ' + JP; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('おでん', w / 2, h / 2 - 8);
      g.font = '700 26px ' + JP;
      g.fillText('各種 120円〜', w / 2, h / 2 + 32);
    }, 200, 110);
    /* TWO HANGERS ADDED.  At (1.1, 2.28, -5.9) this board had nothing within
       30 mm of it in any direction -- probe_near returns only the board
       itself inside 0.6 m.  The interior back wall's inner face is at z=-6.01
       and the gondola below it tops out at y=1.99, so the board hung 0.11 m off
       the wall and 0.29 m over the gondola with no visible means of support.
       A konbini oden board is a hung POP, so it now hangs: two 0.16 m rods from
       the ceiling at 2.60 down to the board's top edge at 2.45. */
    addMesh(store, new T.BoxGeometry(0.018, 0.155, 0.018), toon(0x6d747f),
            { x: 0.92, y: 2.525, z: -5.94, outline: false, ow: 0.02 });
    addMesh(store, new T.BoxGeometry(0.018, 0.155, 0.018), toon(0x6d747f),
            { x: 1.28, y: 2.525, z: -5.94, outline: false, ow: 0.02 });
    decalPlane(store, odenTex, 0.62, 0.34, 1.1, 2.28, -5.94, 0, 0.95);
  })();

  /* runoff materials, animated from the tick loop below */
  const RUNOFF = { mats: [] };

  /* ---------- 10. small real-world props ---------- */
  (function detailProps() {
    // (a) stray cat sheltering under the canopy — pure silhouette + outline
    (function cat() {
      const g = group(PROPS, 4.55, 0, 3.35);
      g.rotation.y = -0.5;
      const fur = toon(0x4c4a52), fur2 = toon(0x3a3841);
      /* FOUR LEGS.  Without them the body is a box whose underside is at 0.11 m,
         so probe_float2 reported the cat as a 5-mesh component with 0.090 m
         between its belly and the pavement -- it hovered. */
      [[-0.15, -0.07], [-0.15, 0.07], [0.15, -0.07], [0.15, 0.07]].forEach(function (p) {
        addMesh(g, new T.BoxGeometry(0.07, 0.13, 0.07), fur2,
                { x: p[0], y: 0.065, z: p[1], ow: 0.022 });
      });
      addMesh(g, new T.BoxGeometry(0.44, 0.26, 0.24), fur, { y: 0.24, ow: 0.03 });
      addMesh(g, new T.BoxGeometry(0.16, 0.20, 0.19), fur, { x: 0.28, y: 0.36, ow: 0.028 });
      addMesh(g, new T.ConeGeometry(0.055, 0.09, 4), fur2, { x: 0.30, y: 0.50, z: -0.07, ow: 0.02 });
      addMesh(g, new T.ConeGeometry(0.055, 0.09, 4), fur2, { x: 0.30, y: 0.50, z: 0.07, ow: 0.02 });
      addMesh(g, new T.CylinderGeometry(0.03, 0.045, 0.30, 6), fur2, { x: -0.26, y: 0.34, rz: 0.55, ow: 0.024 });
      const eye = basic(0xffe9a8, { add: true, opacity: 0.85 });
      addMesh(g, new T.SphereGeometry(0.022, 6, 5), eye, { x: 0.40, y: 0.38, z: -0.05, outline: false, cast: false });
      addMesh(g, new T.SphereGeometry(0.022, 6, 5), eye, { x: 0.40, y: 0.38, z: 0.05, outline: false, cast: false });
    })();

    // (b) fallen leaves: gather at the gutter and kerb, never random
    (function leaves() {
      const cols = [0x7a5a2e, 0x8e6b32, 0x5f4a24, 0x94693a];
      const spots = [
        [-0.6, 5.44], [0.9, 5.46], [5.36, 2.1], [5.38, -0.4], [5.34, -2.9],
        [-3.2, 5.42], [2.4, 5.47], [-6.2, 5.4], [7.6, 3.1]
      ];
      spots.forEach(function (s, i) {
        const c = cols[i % cols.length];
        const m = new T.Mesh(new T.CircleGeometry(0.11, 5), new T.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, side: T.DoubleSide }));
        m.rotation.x = -Math.PI / 2;
        m.rotation.z = Math.random() * 6.28;
        m.scale.set(1, 0.62, 1);
        m.position.set(s[0], ROAD_TOP + 0.012, s[1]);
        PROPS.add(m);
      });
    })();

    // (c) asphalt patch squares + a manhole
    (function roadSurface() {
      const patchMat = new T.MeshBasicMaterial({ color: 0x1e2432, transparent: true, opacity: 0.55, depthWrite: false });
      [[-4.2, 9.8, 2.6, 1.9], [2.4, 10.6, 1.7, 1.4], [10.0, 5.2, 2.2, 1.6]].forEach(function (p) {
        const m = new T.Mesh(new T.PlaneGeometry(p[2], p[3]), patchMat);
        m.rotation.x = -Math.PI / 2;
        m.position.set(p[0], ROAD_TOP + 0.004, p[1]);
        PROPS.add(m);
      });
      const mh = decal(world, decalMat(concreteTex(), 0.9), 1.5, 1.5, 9.2, 9.4, ROAD_TOP + 0.005, 0.5);
      mh.material.color = new T.Color(0x39404f);
    })();

    // (d) damp skirting at the base of the shop walls (rising damp)
    (function damp() {
      const o = mk(64, 64), g = o.g;
      const grd = g.createLinearGradient(0, 0, 0, 64);
      grd.addColorStop(0, 'rgba(24,30,42,0.55)');
      grd.addColorStop(0.45, 'rgba(24,30,42,0.22)');
      grd.addColorStop(1, 'rgba(24,30,42,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
      const t = tx(o.c);
      /* THE TRIO SAT AT A FIXED 3.12 FROM THE MIDDLE OF THE SITE, WHICH IS NOT
         WHERE ANY WALL IS.  Measured against the built geometry with
         probe_slab: the front facade's `seg(..., thick: 0.3, off: 0)` runs
         z 2.85..3.15 with a 0.02 detail panel to 3.16, and the right facade is
         the mirror of it at x 3.25..3.56.  So the panel at z = 3.12 was 40 mm
         INSIDE the front wall -- invisible, i.e. Sera's "该隐藏的部分没有隐藏"
         -- and the one at x = 3.12 was 130 mm inside the SHOP, a damp stain
         painted on the wrong side of 0.19 m of structure.  probe_gap measured
         90 mm of clear air between it and the interior lining at x = 3.21.
         And the third, at (2.05, z 3.12), reported NO HIT in either direction
         over 2 m: the front facade LINE ends at x = 0.4 and the corner facade
         is diagonal, so it stood in the open doorway of the recessed entrance.

         A rising-damp stain belongs on the OUTER face of the wall it stains, so
         each strip is now derived from its own facade LINE plus that wall's own
         half-depth.  The third panel is deleted rather than re-homed: the
         corner facade is solid for only 0.30 m at each end (oL = 0.30/L, not
         30 % of the line) with glazing and the automatic doors over everything
         between, so there is no wall at its base to stain. */
      function dampStrip(line, t0, t1, nm) {
        const dx = line.B.x - line.A.x, dz = line.B.z - line.A.z;
        const L = Math.hypot(dx, dz);
        const HW = 0.30 / 2 + 0.02;               // half-depth + 20 mm clear
        const tc = (t0 + t1) / 2;
        const m = new T.Mesh(new T.PlaneGeometry(L * (t1 - t0), 0.62),
          new T.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.6,
                                    depthWrite: false, side: T.DoubleSide }));
        /* DECLARED.  This strip sat 20 mm proud of the wall as anonymous
           geometry, and probe_spout_mount picked it up as the "nearest
           structure" for the lowest downspout bracket -- a stain reported as a
           fixing surface, which is GPT r16 Q4's 共同根因 (几何命中代替语义关系)
           in its purest form.  It is paint: no volume, depthWrite off, 20 mm in
           front of a wall that IS structural.  Anything asking "what can I
           screw to here" must look through it, so it says so itself. */
        m.userData.role = 'grime';
        m.name = 'DAMP_STRIP_' + nm;
        m.position.set(line.A.x + dx * tc + line.out[0] * HW,
                       TOP_WALK + 0.30,
                       line.A.z + dz * tc + line.out[1] * HW);
        /* a plane with ry = 0 faces +z; turn its normal onto the wall's own
           outward vector */
        m.rotation.y = Math.atan2(line.out[0], line.out[1]);
        store.add(m);
      }
      dampStrip(LINES.front, 0.0, 1.0, 'front');
      dampStrip(LINES.right, 0.0, 1.0, 'right');
      /* r18: the left and back walls were getting neither this nor the
         泥はね帯, so their bases met the ground as a bare cut edge.  Both
         lines are full-length solid wall (solidWall('left') / ('back') span
         FY..ROOF_Y), so unlike the corner facade there is a wall here to
         stain.  Derived from the line, so the outward offset is the wall's
         own half-depth and cannot drift. */
      dampStrip(LINES.left, 0.0, 1.0, 'left');
      dampStrip(LINES.back, 0.0, 1.0, 'back');
    })();

    // (d2) runoff streaks: narrow sheets of water crawling toward the gutter
    //      grates. Cheap, but it answers "where does the rain go?"
    (function runoff() {
      const o = mk(64, 256), g = o.g;
      g.clearRect(0, 0, 64, 256);
      for (let i = 0; i < 26; i++) {
        const x = Math.random() * 64, w = 0.7 + Math.random() * 2.2;
        const len = 26 + Math.random() * 120, y0 = Math.random() * 256;
        const grd = g.createLinearGradient(0, y0, 0, y0 + len);
        grd.addColorStop(0, 'rgba(190,214,240,0.0)');
        grd.addColorStop(0.45, 'rgba(200,222,246,0.55)');
        grd.addColorStop(1, 'rgba(190,214,240,0.0)');
        g.fillStyle = grd; g.fillRect(x, y0, w, len);
      }
      const tex = tx(o.c);
      [
        { x: -3.6, z: 5.02, w: 1.5, h: 2.4 }, { x: -0.9, z: 5.06, w: 1.2, h: 2.2 },
        { x: 4.9, z: 1.4, w: 2.4, h: 1.2 }, { x: 4.9, z: -2.6, w: 2.4, h: 1.2 }
      ].forEach(function (r) {
        const m = new T.Mesh(new T.PlaneGeometry(r.w, r.h),
          new T.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.30, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
        m.rotation.x = -Math.PI / 2;
        if (r.w > r.h) m.rotation.z = Math.PI / 2;
        m.position.set(r.x, ROAD_TOP + 0.004, r.z);
        m.renderOrder = 2;
        PROPS.add(m);
      });
      PROPS.traverse(function (o2) {
        if (o2.isMesh && o2.material && o2.material.map === tex) RUNOFF.mats.push(o2.material);
      });
    })();

    // (e) guard-rail end reflectors -- DELETED, they had no guard rail
    /* Three 0.09 x 0.13 x 0.05 amber additive plates sat at y = 0.86 with
       hardcoded ground positions (8.12, 6.4), (8.12, 1.2), (6.6, 7.28).
       probe_props measured 835 mm of clear air under each one, and probe_ident
       put NOTHING within 1.2 m of two of them in any direction -- no post, no
       rail, no wall.  They were the worst float in the scene and they glowed,
       because an additive plate in mid-air has nothing to sit against.
       The rail they were written for does exist, but it moved: guardRail() in
       05_props.js now builds at z = 8.78 on the far sidewalk, and it carries its
       own reflectors mounted on the posts (recorded there under Kimi r5's 80 mm
       measurement).  These three were a stale copy of that idea pinned to
       coordinates the rail had long since left, so the honest fix is removal,
       not re-hanging: an end reflector with no rail end is not a detail. */
  })();

  /* ---------- 10.5 interior warmth rebuild ----------
     The light-subtraction pass overcorrected: the warm shop interior —
     the whole point of the cold-street / warm-shop contrast — went dark.
     Re-boost the emissive-driven warmth. No new lights are added, so the
     r128 1/d^decay blow-out we debugged cannot repeat. */
  (function interiorWarmth() {
    /* (a) was: "boost the glow decals behind the glass (colour ffdfae) by
       1.55x".  That predicate never matched anything -- the colour pipeline
       linearises every material colour, so getHexString() no longer returns
       the authored hex -- and the decal family it was meant to target has now
       been deleted anyway on both reviewers' advice.  Removed rather than left
       as a trap. */
    /* (b) shared toon materials, matched by emissive hex.  toon() caches, so
       one mutation regrades every user of that material.  Retuned DOWN: with
       the goods panels dropping from ei 1.45 to 0.40, the surrounding surfaces
       have to stop out-shouting them, otherwise the shelves revert to being
       the dimmest thing in a glowing room.  Note this block runs BEFORE the
       colour pipeline, so the keys are still authored sRGB hexes. */
    const boosts = { 'ffca8a': 1.05, 'ffd6a0': 1.10, 'ffcf96': 1.05 };
    scene.traverse(function (o) {
      if (!o.isMesh || !o.material || !o.material.emissive) return;
      const hex = o.material.emissive.getHexString();
      if (boosts[hex]) {
        o.material.emissiveIntensity = o.material.emissiveIntensity * boosts[hex];
      }
    });
    // (b2) from a diorama angle you mostly see the canopy TOP and the roof.
    //      Both were bright grey-violet, which is what made the whole block
    //      read cold. Push them down to silhouette values.
    scene.traverse(function (o) {
      if (!o.isMesh || !o.material || !o.material.color) return;
      // NB: seg()/prismAt() bake coordinates into the geometry, so every such
      //     mesh sits at the group origin — a world-y test silently never
      //     matched and the canopy stayed bright. Match on the material.
      if (o.material.color.getHexString() === 'b6b5ac') {   // canopy slab (TRIM)
        o.material = o.material.clone();
        /* 0x2c313d was too absolute: TRIM is shared by the canopy slabs AND the
           small corner patch, and at the corner the patch is an isolated
           segment, so it read as a black oval hanging over the entrance rather
           than as a piece of eave.  0x4a505e lands the top face at screen
           luminance ~35 — still silhouette against the lit shopfront, but it
           keeps its shape. */
        o.material.color.setHex(0x4a505e);
      }
    });

    // (c) canopy underside catches the shop light — give it a warm sheen.
    //     On a real konbini the lit soffit is the brightest thing on the
    //     building after the sign; it is what makes the eave read as a light
    //     source rather than a dark lid.
    scene.traverse(function (o) {
      if (!o.isMesh || !o.material || !o.material.emissive) return;
      if (o.material.color && o.material.color.getHexString() === 'cfcec6' &&
          o.material.emissive.getHexString() === '000000') {
        o.material.emissive = new T.Color(0xffd9a4);
        o.material.emissiveIntensity = 0.75;
      }
    });
    // (d) final word on the interior warm point lights.  Six of them, in two
    //     aisles (04).  Round 4 moved the rig from y=1.62 (buried inside the
    //     gondola carcasses, which is why the three identical end-caps
    //     measured 40.3 / 180.3 / 124.8) up to y=2.20 and clear of every body,
    //     so the per-lamp value is set here and nowhere else.
    scene.traverse(function (o) {
      if (o.isLight && o.type === 'PointLight' && o.color.getHexString() === 'ffd7a2') {
        o.intensity = 0.80;
      }
    });
    // (e) warm light spilling out onto the wet pavement. A real konbini at
    //     night reads warm mostly because of this pool on the ground, not
    //     because you can see the shelves — this is the cheapest signal that
    //     the inside is bright and warm.
    //
    //     ROUND 4 CORRECTION -- AND IT WAS NOT THE EAVE LAMP.
    //     K2.8 read the numbers as "人行道 157 / 积水 174，比玻璃带平均 130 还亮…
    //     檐外灯 1.10 这个加强方向是错的."  The diagnosis of the symptom was
    //     right and the attribution was wrong: the eave PointLight is 0.72 now
    //     and contributes maybe 15 points to the pavement, whereas THESE four
    //     additive quads were laying op 0.50-0.62 of near-white glow over 7.8 x
    //     3.4 m of sidewalk.  That is the whole "the ground out-brightens the
    //     shopfront" effect, and it is the exact mistake the shopfront itself
    //     was cured of in round 3: additive light covering an area that is
    //     supposed to show objects.  Pulled back ~30 %, which keeps the warm
    //     pool legible and puts the brightest man-made surface back inside the
    //     glazing band where it belongs.
    (function spillPool() {
      const runs = [
        { cx: -2.8, cz: 4.45, w: 7.8, d: 3.4, op: 0.40 },  // front glazing -> sidewalk
        { cx: 4.70, cz: -3.10, w: 3.2, d: 5.4, op: 0.34 }, // right glazing -> sidewalk
        { cx: 1.55, cz: 2.30, w: 3.4, d: 3.0, op: 0.44 },  // entrance apron
        { cx: -7.30, cz: 6.60, w: 4.6, d: 4.6, op: 0.24 }  // street-lamp pool
      ];
      runs.forEach(function (r) {
        const m = new T.Mesh(new T.PlaneGeometry(r.w, r.d),
          new T.MeshBasicMaterial({ map: glowTex(), color: r.cz > 5 ? 0xffb066 : 0xffc98a, transparent: true, opacity: r.op, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
        m.rotation.x = -Math.PI / 2;
        /* Was `TOP_WALK + 0.05` for all four -- the identical mistake the puddle
           block in 03_ground.js records and had already been cured of: a fixed
           height chosen for the sidewalk, applied to quads that are not all on
           the sidewalk.  Measured by src/probe_additions.py `ground`, which
           lists every pasted plane sitting above 30 mm: three of the four were
           50 mm proud of the walk, and the street-lamp pool at (-7.30, 6.60)
           hangs 90 mm over the carriageway, because that one is on the ROAD.
           A sheet of additive light held 50-90 mm off the ground is exactly
           what makes a wet pavement read as painted rather than wet.  surfaceY()
           knows which slab is underfoot -- and now knows about the corner apron
           too -- so the lift is 8 mm wherever the quad actually lands. */
        m.position.set(r.cx, surfaceY(r.cx, r.cz) + 0.008, r.cz);
        m.renderOrder = 2;
        /* Declared, not inferred -- the convention 03_ground.js's decal() sets
           out.  These four were the only pasted faces in the scene with no
           role, which is why the ground probe could report them but not name
           them, and why they survived every earlier float audit. */
        m.userData.role = 'spill';
        m.name = 'SPILL_POOL_' + r.cx.toFixed(2);
        PROPS.add(m);
      });
    })();
  })();

  /* ---------- 10.6 two people: the ones this scene has been missing ---------
     GPT r5: "放两人：店内一名店员，棚外一名撑伞行人… 两人足以同时说明「店在
     营业」和「外面正在下雨」";  Kimi r5: "0 个让「24h 便利店」不成立… 2 个是
     「读得出生活气」的最小剂量".  Both cap it at two.

     Both also rule out the same things: no face, no fingers, no cloth
     simulation, no walk cycle (GPT: "若不做步态动画，就用静止的等候姿态，避免
     整个人保持迈步造型平移").  So everything below is built from exactly the
     parts they asked for -- head, tapered torso, two arms with elbows, two
     SEPARATED legs, one garment colour, one dark trouser colour -- plus, for
     the pedestrian, an umbrella whose lean is driven by the same WIND vector
     that tilts the rain and offsets the eave drips. */

  /* ---------- 11. update loop (runs alongside the main render loop) ---------- */
  let last = performance.now();
  function tick(now) {
    requestAnimationFrame(tick);
    /* Frozen: leave every dynamic state exactly where it is (see 01_boot).
       Returning here -- rather than passing dt = 0 -- is deliberate: `now`
       itself is what the ripples age against, so a dt of 0 would still let
       uTime jump and every ripple would leap forward between the two
       exposures. */
    if (window.FREEZE && window.FREEZE.on) return;
    /* Clamp BOTH ends.  Math.min(0.05, x) alone let a negative first-frame dt
       through: the first rAF timestamp is the frame's start time and can
       predate the performance.now() captured when this module evaluated, so
       dt went negative, a = exp(-dt/tau) exceeded 1, and the wind field was
       NaN'd permanently -- killing the rain and the eave drips in 5 of 6
       loads.  A non-finite dt (tab restore, clock jump) is treated as 0. */
    const rawDt = (now - last) / 1000;
    const dt = (!isFinite(rawDt) || rawDt < 0) ? 0 : Math.min(0.05, rawDt);
    last = now;
    const t = now / 1000;

    // gust field: four time scales, shared by rain / drips / wires so the
    // whole scene reacts to ONE wind instead of每 system inventing its own
    WIND.x = 0.95 + windStep(WIND_X, dt) * 1.15;
    WIND.z = 0.30 + windStep(WIND_Z, dt) * 0.85;
    // last line of defence: a poisoned wind must never reach a uniform or a
    // position again, and the bands have to be reset with it or it comes back.
    if (!isFinite(WIND.x) || !isFinite(WIND.z)) {
      WIND.x = 0.95; WIND.z = 0.30;
      WIND_X.b.forEach(function (bb) { bb.v = 0; });
      WIND_Z.b.forEach(function (bb) { bb.v = 0; });
    }
    RAIN.material.uniforms.uWind.value.set(WIND.x, WIND.z);


    // eave drips: fill -> release -> fall with gravity -> splash on impact
    DRIPS.forEach(function (d) {
      if (!d.falling) {
        d.vol += d.rate * dt;
        d.m.visible = false;
        if (d.vol >= d.cap) { d.falling = true; d.v = 0; d.y = d.y0; d.m.visible = true; }
      } else {
        d.v += 9.81 * dt;                       // gravity, no drag over ~2.7m
        d.y -= d.v * dt;
        /* The drip is pushed sideways by the SAME wind that tilts the rain and
           leans the umbrella, using the rain's own 0.16 lateral-metres-per-metre
           factor (GPT r5 chain #3: 雨倾角 = 檐滴水横偏 = 伞面朝向, one vector).
           The offset is proportional to distance FALLEN, and the landing point
           is derived from it rather than reusing the site coordinate -- that is
           what keeps "檐滴位置与水花位置同源": the ring lands where the drop
           landed, not 0.36 m upwind of it. */
        const fall = Math.max(0, d.y0 - d.y);
        const ox = WIND.x * 0.16 * fall, oz = WIND.z * 0.16 * fall;
        const stretch = Math.min(2.4, 1 + d.v * 0.10);
        d.m.position.set(d.x + ox, d.y, d.z + oz);
        d.m.scale.set(1 / Math.sqrt(stretch), stretch, 1 / Math.sqrt(stretch));
        if (d.y <= TOP_WALK + 0.06) {
          d.falling = false; d.vol = 0;
          d.m.visible = false;
          DRIPS.emitSplash(d.x + ox, d.z + oz, Math.min(1, d.v / 6.5));
        }
      }
    });

    // runoff crawls toward the gutter (the texture scrolls downstream)
    for (let i = 0; i < RUNOFF.mats.length; i++) {
      const mm = RUNOFF.mats[i].map;
      mm.offset.y = (mm.offset.y - dt * 0.11) % 1;
    }

    /* Ripples are no longer per-frame per-mesh work: RIPPLES advances one
       uniform and the vertex shader derives every radius from (uTime - birth).
       What has to happen on the CPU is the WRITE, and only when something was
       written -- flush() is what uploads the instance attributes.
       The clock here is tick's own `t = now / 1000`, NEVER T0: the shader
       measures (uTime - iBirth), so if births were stamped from a different
       clock than uTime, every new ripple would be born with a wrong (possibly
       negative) age.  Kimi r9 #7 raised exactly this class -- "出生时刻和推进
       时钟必须同源 ... 这条要写进系统契约". */
    RIPPLES.step(dt, t);

    // ambient rainfall impacts: coupled to the same wind as the rain
    IMPACTS.step(dt);
    RIPPLES.flush();
    window.__RIPPLES = RIPPLES.stats();

    // flicker: OU micro-noise, plus occasional failure on the aged lamp
    const corr = 0.07;
    FLI.forEach(function (f) {
      const a = Math.exp(-dt / corr);
      const gauss = (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 0.7;
      f.state = a * f.state + f.sigma * Math.sqrt(1 - a * a) * gauss;
      let mul = 1 + f.state;
      if (f.failing) {
        f.failTimer -= dt;
        if (f.failTimer <= 0 && f.pulse <= 0) { f.pulse = 1 + Math.floor(Math.random() * 3); f.failTimer = 6 + Math.random() * 12; }
        if (f.pulse > 0) {
          f.pulse -= dt * 9;
          if (f.pulse > 0 && (f.pulse % 1) > 0.55) mul *= 0.22;
        }
      }
      if (f.s && f.s.material) f.s.material.opacity = Math.max(0, f.base * mul);
    });
  }

  /* ---------- 11. colour pipeline: author in sRGB, light in linear ----------
     renderer.outputEncoding is sRGBEncoding, but every hex in this project was
     written as a plain sRGB value and handed to three untouched.  three then
     encoded it a SECOND time on output, and the render is exactly what that
     predicts: the deep-indigo outline 0x141226 (20,18,38) displayed as
     (79,75,108) — measured 78,74,106 on the frame, analytic value 79,75,108.
     Nothing dark can survive that floor, so contours dissolve into violet-grey,
     the roof slab turns lavender and the whole image reads as grey wash.
     Fix: linearise authored colours once, and tag colour maps as sRGB so they
     are decoded on sample.  gradientMap stays linear — it is a light ramp, not
     a colour.  Custom ShaderMaterials (sky dome, rain, glass FX) write raw
     values and are deliberately skipped.                                  */
  /* ---------- settle every level printed face onto the surface that is
        ACTUALLY under it --------------------------------------------------- */
  /* This is the one defect class behind most of probe_gap's 85/94: every
     horizontal print -- contact shadows, puddles, road paint, the floor and
     ceiling colour shapes -- floats ~20 mm over whatever carries it.  It is
     hard to see from the source because each print is authored against a named
     constant (TOP_WALK, TOP_ROAD, FY), while the thing under it is whichever
     slab happens to win at that x/z.  They disagree whenever the print lands on
     a slab its author did not have in mind: Kimi r6 read the same pair of
     samples as one real 20 mm and one bogus 56 mm, purely because the second
     one's pavement was a textured plane that the probe had excluded.

     Rather than patch two hundred call sites against a table that has already
     drifted twice, RESOLVE THE HOST AT BUILD TIME: look straight down, take the
     first real surface, put the print 1 mm above it.  A printed face belongs to
     its host by definition, so this is what the constant should have been.

     Two guards, because a ray that quietly finds the wrong thing is worse than
     no fix at all:
       * A level print is recognised by its WORLD BOUNDING BOX, never by
         transforming local +Z.  The floor and ceiling 512x512 Shapes have their
         rotation BAKED into the geometry, so their matrices are identity and any
         normal derived from them comes out +Z even though the surface is flat
         and level -- and that bogus normal is exactly what made probe_gap cast
         along z from a horizontal face and report 620 mm of nothing.
       * Only accept a host within 0.60 m in either direction.  A ceiling print
         that sees the floor 2.4 m down is a mis-detection, so it is left for a
         human with its original y.                                          */
  (function settlePrints() {
    scene.updateMatrixWorld(true);
    const solid = [];
    scene.traverse(function (o) {
      if (!o.isMesh) return;
      if (o.userData.isOutline || o.userData.role === 'decal') return;
      if (o.userData.transient) return;
      const m = o.material;
      if (!m || Array.isArray(m) || m.isShaderMaterial) return;
      if (m.blending === T.AdditiveBlending) return;
      let p = o;
      while (p) { if (p.visible === false) return; p = p.parent; }
      solid.push(o);
    });
    /* Kimi r7 Q1 killed the bbox test I wrote here.  His counterexample: take
       PlaneGeometry(0.6, 0.025), rotate it 45 deg about the long edge.  Its
       world AABB is x 0.60, y 0.0177, z 0.0177 -- y is under my 0.02 threshold
       and x clears 0.05, so my rule called it level and settlePrints would have
       driven one end of a sloping strip into the ground.  Every narrow slanted
       strip whose across-slope width is <= 28 mm slips through (28 = 0.02/sin45).
       He also caught that `x >= 0.05 OR z >= 0.05` lets small stickers escape
       BOTH conditions at once and never get audited at all.

       So: stop using heuristics, use the exact answer.  Take the triangles,
       push the vertices through matrixWorld, cross two edges.  That stays
       correct even when the rotation is baked into the geometry and the matrix
       is identity -- which is the whole reason transformDirection lied about
       the floor and ceiling Shapes in the first place. */
    /* Kimi r8 found three defects in the first version of this function, all of
       which fail SILENTLY, so each is worth the ink:

       (a) Taking the first 40 triangles in order is biased.  If those 40 are a
           degenerate band, every cross is ~0, both limps over the finish line
           as a failure, and the whole budget is spent on nothing.  Replaced by
           area-weighted accumulation of the RAW cross products -- magnitude is
           2*area, so degenerate slivers contribute ~0 for free and there is no
           truncation bias at all.
       (b) The planarity threshold could not have been 0.5.  Two unit normals at
           90 deg with equal weight have an average of length cos(45deg) =
           0.7071, so lengthSq = 0.5 EXACTLY -- an equal-area right-angle corner
           strip sat precisely on the knife edge, and the side it fell on gave a
           45 deg phantom normal that lands in the levelness dead zone: neither
           settled nor skipped, invisible in every report.  General form:
           lengthSq = cos^2(theta/2), so 0.5 tolerates a 90 deg fold.
       (c) `if (!g.index) return null` was wrong about the library: in r128
           ExtrudeGeometry, TextGeometry and the whole PolyhedronGeometry family
           (Tetrahedron/Octahedron/Icosahedron/Dodecahedron) are NON-INDEXED, so
           every one of those meshes was silently skipped.  ShapeGeometry is
           indexed; Plane/Box/Sphere/Cylinder/Cone/Torus/Lathe/Ring are too.

       Planarity is now the ratio |sum of crosses| / sum of magnitudes, which is
       1 for a flat face and 0.7071 for an equal-area right angle.  It is held to
       cos(15 deg) = 0.966 to match the levelness tolerance below, and skip
       reasons are counted so that none of this can ever fail quietly again. */
    const SKIP = { nonIndexed: 0, degenerate: 0, notFlat: 0, deadZone: 0, noIndexSupport: 0 };
    function worldNormal(mesh) {
      const g = mesh.geometry, pos = g.attributes && g.attributes.position;
      if (!pos) { SKIP.noIndexSupport++; return null; }
      mesh.updateWorldMatrix(true, false);
      const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
      const ab = new T.Vector3(), ac = new T.Vector3(), n = new T.Vector3();
      const sum = new T.Vector3();
      const idx = g.index;
      let magSum = 0;
      const count = idx ? idx.count : pos.count;
      for (let i = 0; i + 2 < count; i += 3) {
        const i0 = idx ? idx.getX(i) : i,
              i1 = idx ? idx.getX(i + 1) : i + 1,
              i2 = idx ? idx.getX(i + 2) : i + 2;
        a.fromBufferAttribute(pos, i0).applyMatrix4(mesh.matrixWorld);
        b.fromBufferAttribute(pos, i1).applyMatrix4(mesh.matrixWorld);
        c.fromBufferAttribute(pos, i2).applyMatrix4(mesh.matrixWorld);
        ab.subVectors(b, a); ac.subVectors(c, a);
        n.crossVectors(ab, ac);
        const m2 = n.lengthSq();
        if (m2 < 1e-12) { SKIP.degenerate++; continue; }   // zero-area sliver
        magSum += Math.sqrt(m2);
        sum.add(n);                                        // area-weighted, raw
      }
      if (magSum < 1e-12) { SKIP.degenerate++; return null; }
      sum.divideScalar(magSum);
      if (sum.length() < 0.966) { SKIP.notFlat++; return null; }
      return sum.normalize();
    }
    const rc = new T.Raycaster();
    rc.far = 0.60;
    const DOWN = new T.Vector3(0, -1, 0), UP = new T.Vector3(0, 1, 0);
    const c = new T.Vector3(), start = new T.Vector3(), want = new T.Vector3();
    const log = [];
    scene.traverse(function (o) {
      if (!o.isMesh || o.userData.role !== 'decal') return;
      const n = worldNormal(o);
      /* |n.y| >= cos(15 deg): flat enough to be level, within tolerance.
         Anything between -0.966 and +0.966 is neither level nor ceiling-facing:
         it is a wall-mounted print and belongs to probe_gap, not here.  Kimi r8
         flags this as one of four silent-exit paths, so it is counted. */
      if (!n) return;
      if (Math.abs(n.y) < 0.966) { SKIP.deadZone++; return; }
      o.getWorldPosition(c);
      let hit, target;
      if (n.y > 0) {
        start.set(c.x, c.y + 0.004, c.z);
        rc.set(start, DOWN); rc.far = 0.60;
        hit = rc.intersectObjects(solid, false);
        if (!hit.length) { log.push({ x: +c.x.toFixed(2), y: +c.y.toFixed(3),
                                      z: +c.z.toFixed(2), dy: null,
                                      note: 'NO HOST BELOW' }); return; }
        target = hit[0].point.y + 0.001;
      } else {
        /* Host is ABOVE: ceilings, canopy soffits and eave undersides all bind
           upward.  probe_gap cannot express this at all -- it casts along +-n,
           which for these faces is a direction Kimi calls INVALID_PROBE. */
        start.set(c.x, c.y - 0.004, c.z);
        rc.set(start, UP); rc.far = 0.50;
        const up = rc.intersectObjects(solid, false)
                     .filter(function (h) { return h.distance >= 0.005; });
        if (!up.length) {
          log.push({ x: +c.x.toFixed(2), y: +c.y.toFixed(3), z: +c.z.toFixed(2),
                     dy: null, note: 'CEILING FACE, NO STRUCTURE ABOVE (left alone)' });
          return;
        }
        target = up[0].point.y - 0.001;
      }
      const dy = c.y - target;
      if (Math.abs(dy) < 0.0005) return;
      if (Math.abs(dy) > 0.60) {
        log.push({ x: +c.x.toFixed(2), y: +c.y.toFixed(3), z: +c.z.toFixed(2),
                   dy: +dy.toFixed(3), note: 'TOO FAR, LEFT ALONE' });
        return;
      }
      want.set(c.x, target, c.z);
      o.position.copy(o.parent.worldToLocal(want.clone()));
      log.push({ x: +c.x.toFixed(2), y: +c.y.toFixed(3), z: +c.z.toFixed(2),
                 dy: +dy.toFixed(3), note: n.y > 0 ? 'settled' : 'mounted upward' });
    });
    scene.updateMatrixWorld(true);
    window.__SETTLED = log;
    /* Kimi r8: four silent exits, four buckets, printed every run.  Without
       this, "84 settled, same as before" can hide a whole class that stopped
       being examined when the geometry type changed. */
    window.__NORMALSKIP = SKIP;
  })();

  (function colourPipeline() {
    let n = 0;
    scene.traverse(function (o) {
      const m = o.material;
      if (!m || m.__piped) return;
      if (m.isShaderMaterial || m.isRawShaderMaterial) return;
      if (!(m.isMeshToonMaterial || m.isMeshBasicMaterial || m.isMeshStandardMaterial ||
            m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isSpriteMaterial)) return;
      m.__piped = true; n++;
      if (m.color) m.color.convertSRGBToLinear();
      if (m.emissive && (m.emissive.r || m.emissive.g || m.emissive.b)) m.emissive.convertSRGBToLinear();
      if (m.map && m.map.encoding !== T.sRGBEncoding) m.map.encoding = T.sRGBEncoding;
      if (m.emissiveMap && m.emissiveMap.encoding !== T.sRGBEncoding) m.emissiveMap.encoding = T.sRGBEncoding;
      if (m.gradientMap) m.gradientMap.encoding = T.LinearEncoding;
      if (m.aoMap && m.aoMap.encoding !== T.LinearEncoding) m.aoMap.encoding = T.LinearEncoding;
      m.needsUpdate = true;
    });
    console.log('[pipeline] linearised ' + n + ' materials');
  })();

  requestAnimationFrame(tick);
})();
