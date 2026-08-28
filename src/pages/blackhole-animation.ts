/**
 * Lensed black-hole animation — the landing hero's WebGL scene, shared.
 *
 * One shader, many sizes. This is the single source for the lensed black hole
 * (iterative geodesic bending, thin accretion disc with Doppler beaming,
 * physically-modeled infalling particles). Any page that wants the black hole
 * embeds THIS script and provides:
 *
 *   <canvas id="bh" aria-hidden="true"></canvas>
 *
 * sized by its container's CSS. The shader reads canvas.clientWidth, so scale
 * is carried entirely by the container — a 400px box renders the same scene
 * the landing hero renders at ~650px. The bright photon ring spans roughly
 * two thirds of the canvas width, hence instances style the canvas wider than
 * its box (landing uses 148%) with transparent corners overhanging.
 *
 * Consumers: src/pages/landing.ts (hero, full size) and
 * src/routes/attack-pack.ts (/attack index, smaller instance). Do not fork
 * this script per page — new sizes are new CSS on the container, not new
 * shader code (docs/style-guide.md, "Event Horizon").
 *
 * Behavior contract carried by the script itself: prefers-reduced-motion and
 * ?still render a deterministic single frame; ?seed / ?fast / ?debug / ?obs
 * query params work on any embedding page; rendering pauses off-screen via
 * IntersectionObserver; a missing WebGL context leaves the canvas transparent.
 */

/** Browser-side IIFE. Emit inside a <script> tag on a page that has #bh. */
export const BLACK_HOLE_ANIMATION_JS = `// ═══════════════════════════════════════════════════════════════════════════
// Lensed black hole + physically-modeled infalling particles.
// Base renderer: the production parsethis.ai hero (raw WebGL fragment shader,
// iterative geodesic bending, thin disc with Doppler beaming, lensed stars).
// Added here:
//   · massive test particles on Schwarzschild geodesics (RK4, proper time)
//   · adiabatic α-disc inspiral → ISCO → pure geodesic plunge
//   · gravitational redshift + relativistic Doppler beaming (flux ∝ g⁴)
//   · infalling-observer vs distant-observer time mapping (toggle)
//   · particles drawn along the SAME bent rays → lensed images + shadow occlusion
//   · Keplerian disc pattern rotation Ω ∝ r^(−3/2)  (faster toward the hole)
// Units: G = c = 1, M = 0.5  ⇒  R_s = 2M = 1.0, ISCO = 6M = 3.0.
// ═══════════════════════════════════════════════════════════════════════════
(function(){
  var canvas = document.getElementById('bh');
  if (!canvas) return;
  var qs = new URLSearchParams(location.search);
  var still = qs.has('still');
  // Global time scale. 0.25 = quarter speed: it slows the shader clock (camera
  // yaw, hue drift, Keplerian pattern rotation) and the particle sim together,
  // so the physics stays self-consistent. ?fast=1 restores real-time.
  var FAST = parseFloat(qs.get('fast')) || 0.25;
  var DEBUG = qs.has('debug');
  var gl = canvas.getContext('webgl', { alpha:true, antialias:false, depth:false, stencil:false, powerPreference:'low-power', preserveDrawingBuffer: still });
  if (!gl) return;
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── deterministic RNG (reproducible screenshots via ?seed=) ──
  var seed = (parseInt(qs.get('seed'), 10) || 7) >>> 0;
  function rng(){ seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }

  // ── physics constants ──
  // Framework ported from steeltroops-ai/blackhole-simulation
  // (gravitas-core): BPT 1972 circular-orbit integrals, ISCO plunge
  // entry state, velocity-Verlet geodesic stepping, Planckian LUT
  // coloring, plunge emissivity envelope. Geometrized units G=c=1,
  // M = 0.5 ⇒ R_s = 2M = 1.0.
  var M = 0.5, RS = 1.0;
  var SPIN = 0;          // a* = a/M. 0 keeps particles consistent with the
                         // production photon bender (Schwarzschild = Kerr a*=0).
                         // The BPT formulas below carry the spin terms already.
  var A = SPIN * M;
  // Bardeen 1972 ISCO radius (prograde), exact for any a*; = 6M at a*=0.
  var Z1 = 1 + Math.cbrt(1 - SPIN*SPIN) * (Math.cbrt(1 + SPIN) + Math.cbrt(1 - SPIN));
  var Z2 = Math.sqrt(3*SPIN*SPIN + Z1*Z1);
  var ISCO = M * (3 + Z2 - Math.sqrt((3 - Z1) * (3 + Z1 + 2*Z2)));
  var TS = 13.0;         // coordinate-time units per wall second
  var KEP = TS * Math.sqrt(M);   // wall-clock Keplerian Ω scale for the speck field
  var CAM_Y = 0.34;              // low camera height: edge-on disc + lensed arch
  var ZOOM = 0.8;                // scene scale about the canvas centre. Widens the
                                 // field instead of moving the camera, so the
                                 // lensing geometry and particle world positions
                                 // are untouched — only the framing changes. The
                                 // alpha edge mask stays on unscaled screen uv so
                                 // the glow still dissolves before the canvas rim.
  var K_VISC = 0.0016;   // α-disc toy: dL/dτ = −K_VISC·L during inspiral
  var C_DAMP = 0.11;     // ≈ critical damping 2√κ of the radial epicyclic mode:
                         // lets r adiabatically track r_circ(L) down the
                         // circular-orbit sequence instead of lagging behind
  var DPR_SEED = 0.004;  // plunge.rs dpr_seed: tiny inward kick at the ISCO
  var PLUNGE_FALLOFF = 3.0;  // plunge_emissivity_envelope falloff_scale_m
  var MAXP = 3;          // uniform slots
  var MAXCONC = 2;       // concurrently spawning (3rd slot absorbs fade overlap)

  // ── BPT 1972 circular equatorial orbit integrals (prograde), in the
  //    Bardeen v ≡ √(M/r) form — ported from plunge.rs ──
  function circE(r){
    var v = Math.sqrt(M/r), v3 = v*v*v;
    var den = 1 - 3*M/r + 2*SPIN*v3;
    if (den <= 0) return 1;
    return (1 - 2*M/r + SPIN*v3) / Math.sqrt(den);
  }
  function circL(r){
    var v = Math.sqrt(M/r), v3 = v*v*v, v4 = v3*v;
    var den = 1 - 3*M/r + 2*SPIN*v3;
    if (den <= 0) return 0;
    return M * (1 - 2*SPIN*v3 + SPIN*SPIN*v4) / (v * Math.sqrt(den));
  }
  var E_ISCO = circE(ISCO);              // √(8/9) ≈ 0.9428 at a*=0
  var L_ISCO = circL(ISCO);              // 2√3·M ≈ 1.7320508 at a*=0
  function Lcirc(r){ return circL(r); }

  // ── Planckian color LUT (the reference pre-integrates spectra into a
  //    1D LUT; same idea, compact blackbody chromaticity fit) ──
  function bbRGB(T){
    var t = Math.max(T, 500) / 100, r, g, b;
    if (t <= 66) { r = 1; }
    else { r = Math.min(1.3, 1.292936 * Math.pow(t - 60, -0.1332047)); }
    if (t <= 66) { g = Math.max(0, 0.3900816 * Math.log(t) - 0.6318414); }
    else { g = Math.min(1.15, 1.1298909 * Math.pow(t - 60, -0.0755148)); }
    if (t >= 66) { b = 1; }
    else if (t <= 19) { b = 0; }
    else { b = Math.max(0, 0.5432068 * Math.log(t - 10) - 1.1962541); }
    if (T < 1600) { var k = Math.max(T - 500, 0) / 1100; r *= (.25 + .75*k); g *= k*k; b *= k*k; }
    return [r, g, b];
  }
  var BB_LUT = [], BB_N = 96, BB_T0 = 500, BB_T1 = 14000;
  for (var bi = 0; bi < BB_N; bi++) BB_LUT.push(bbRGB(BB_T0 * Math.pow(BB_T1/BB_T0, bi/(BB_N-1))));
  function lutCol(T){
    var x = Math.log(Math.min(Math.max(T, BB_T0), BB_T1)/BB_T0) / Math.log(BB_T1/BB_T0) * (BB_N-1);
    var i = Math.min(Math.floor(x), BB_N-2), fr = x - i;
    var a = BB_LUT[i], b = BB_LUT[i+1];
    return [a[0]+(b[0]-a[0])*fr, a[1]+(b[1]-a[1])*fr, a[2]+(b[2]-a[2])*fr];
  }
  // Thin-disc emitter temperature, the reference disk.rs baseline shape
  // T ∝ r^{−3/4}; the plunging stream carries its ISCO temperature inward.
  function Temit(r){ return 4300 * Math.pow(4.5 / Math.max(r, ISCO), 0.75); }
  // plunge.rs plunge_emissivity_envelope: exp(−(r_isco − r)/(scale·M)) inside ISCO
  function plungeEnv(r){
    if (r >= ISCO) return 1;
    if (r < RS) return 0;
    return Math.exp(-((ISCO - r) / M) / PLUNGE_FALLOFF);
  }

  // ── shader ──
  var vs = 'attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }';
  var fs = [
  'precision highp float;',
  'uniform vec2 R; uniform float T;',
  'uniform int pN;',
  'uniform vec4 pA[3];',   // head xyz, w: kernel radius
  'uniform vec4 pB[3];',   // tail xyz, w: brightness
  'uniform vec4 pC[3];',   // observed rgb
  'mat3 hueRot(float a){',
  '  float c = cos(a), s = sin(a);',
  '  return mat3(.299,.587,.114,.299,.587,.114,.299,.587,.114)',
  '       + c * (mat3(1,0,0,0,1,0,0,0,1) - mat3(.299,.587,.114,.299,.587,.114,.299,.587,.114))',
  '       + s * mat3(-.3,-.588,.886, .143,-.353,.258, -.787,.715,.072);',
  '}',
  'float hash(vec3 q){ return fract(sin(dot(q, vec3(127.1,311.7,74.7))) * 43758.5453); }',
  'vec3 stars(vec3 d){',
  '  vec3 q = normalize(d);',
  '  vec3 cell = floor(q * 90.);',
  '  float h = hash(cell);',
  '  float star = smoothstep(.995, 1., h) * (.35 + .45 * hash(cell + 1.3));',
  '  return vec3(star) * vec3(.85, .9, 1.);',
  '}',
  'void main(){',
  '  vec2 uv = (gl_FragCoord.xy - .5 * R) / R.y;',
  '  vec2 zuv = uv / __ZOOM__;',             // <1 widens the field: the scene shrinks toward centre
  '  vec3 ro = vec3(0., __CAMY__, -7.2);',   // low camera: edge-on disc, lensed over-arch
  '  vec3 rd = normalize(vec3(zuv.x, zuv.y - .02, 1.05));',
  '  float ca = -.10;',
  '  mat3 tilt = mat3(1.,0.,0., 0.,cos(ca),-sin(ca), 0.,sin(ca),cos(ca));',
  '  ro = tilt * ro; rd = tilt * rd;',
  '  float yaw = T * .06;',
  '  mat3 orb = mat3(cos(yaw),0.,sin(yaw), 0.,1.,0., -sin(yaw),0.,cos(yaw));',
  '  ro = orb * ro; rd = orb * rd;',
  '  vec3 p = ro, v = rd;',
  '  vec3 col = vec3(0.);',
  '  float captured = 0.;',
  '  float w = 1.;',
  '  float minr = 1e3;',
  '  float jit = .9 + .2 * hash(vec3(gl_FragCoord.xy, 7.));',
  '  for (int i = 0; i < 110; i++) {',
  '    float r = length(p);',
  '    minr = min(minr, r);',
  '    if (r < .9) { captured = 1.; break; }',
  '    float dt = clamp(.05 + .055 * r, .06, .3) * jit;',
  '    vec3 acc = -1.55 * p / (r * r * r * r);',
  '    v += acc * dt;',
  '    vec3 pp = p;',
  '    p += v * dt;',
  // ── optically-thin disc atmosphere: path-integrated haze hugging the plane
  //    (long edge-on sightlines glow — the misty sea + soft arch of the reference) ──
  '    float hz = exp(-abs(p.y) * 6.5) * smoothstep(6.2, 2.2, r) * smoothstep(1.05, 1.6, r);',
  '    col += vec3(1., .55, .22) * (hz * dt * .07 * w);',
  // ── infalling particles: emission integrated along the bent ray.
  //    Segment-segment closest distance (ray step vs particle streak capsule)
  //    so a small hot kernel is never skipped over by a large march step. ──
  '    for (int j = 0; j < 3; j++) {',
  '      if (j < pN) {',
  '        vec3 a  = pA[j].xyz;',
  '        vec3 d1 = p - pp;',
  '        vec3 d2v = pB[j].xyz - a;',
  '        vec3 rr = pp - a;',
  '        float A2 = dot(d1,d1), E2 = dot(d2v,d2v);',
  '        float B2 = dot(d1,d2v), C2 = dot(d1,rr), F2 = dot(d2v,rr);',
  '        float den = A2*E2 - B2*B2;',
  '        float sN = den > 1e-7 ? clamp((B2*F2 - C2*E2)/den, 0., 1.) : 0.;',
  '        float tN = clamp((B2*sN + F2)/max(E2,1e-6), 0., 1.);',
  '        sN = clamp((B2*tN - C2)/max(A2,1e-6), 0., 1.);',
  '        vec3 dv = (pp + d1*sN) - (a + d2v*tN);',
  '        float d2 = dot(dv, dv);',
  '        float s = pA[j].w;',
  '        float core = s*s / (d2 + s*s*.06);',
  '        float halo = s*s / (d2 + s*s*6.);',
  '        float taper = 1. - .72 * tN;',
  '        col += pC[j].rgb * (pB[j].w * (core*.85 + halo*.55) * taper * w);',
  '      }',
  '    }',
  // ── thin accretion disc (production art — solid pattern speed; a Keplerian
  //    Ω(r) pattern shears itself into moiré within seconds, so the particles,
  //    not the disc texture, carry the faster-closer-in physics) ──
  '    if (pp.y * p.y < 0.) {',
  '      float t = pp.y / (pp.y - p.y);',
  '      vec3 hit = mix(pp, p, t);',
  '      float hr = length(hit.xz);',
  '      if (hr > 1.3 && hr < 4.6) {',
  '        float ang = atan(hit.z, hit.x);',
  '        float doppler = 1. + .6 * sin(ang) / sqrt(hr);',
  '        float arms = sin(ang * 2. - hr * 3.5 + T * 1.1);',
  '        float fine = sin(ang * 9. - hr * 11. + T * 2.2);',
  '        float bands = .72 + .28 * arms + .10 * fine;',
  '        float glow = pow(1.55 / hr, 2.2) * bands * doppler;',
  '        vec3 disc = mix(vec3(1.0,.78,.42), vec3(1.0,.45,.16), clamp((hr-1.3)/3.3, 0., 1.));',
  '        disc = mix(disc, vec3(1.02,.98,.9), clamp((doppler - 1.)*.5, 0., .35));',
  '        col += disc * glow * .85 * w;',
  // ── matter specks riding the flow: cell-hashed points in co-rotating
  //    coordinates u = φ − Ω(r)·T with Keplerian Ω ∝ r^{−3/2}. Each speck
  //    genuinely orbits at its radius — visibly faster the closer in —
  //    and isolated points cannot shear into moiré like a fixed pattern. ──
  '        float om = __KEP__ / (hr * sqrt(hr));',
  '        float uu = (ang - om * T) * 3.5014 + hash(vec3(floor((hr - 1.3) * 6.), 1., 9.)) * 6.28;',        // 22 cells / 2π
  '        float vv = (hr - 1.3) * 6.;',
  '        float cu = floor(uu), cvf = floor(vv);',
  '        float hsp = hash(vec3(cu, cvf, 3.7));',
  '        if (hsp > .86) {',
  '          float ux = fract(uu) - .5, vx = fract(vv) - .5;',
  '          float speck = exp(-(ux*ux*7. + vx*vx*46.));',
  '          col += vec3(1., .93, .8) * (speck * (.35 + .65*hsp) * doppler * doppler * pow(1.9/hr, 1.6) * w * .6);',
  '        }',
  '        w *= .5;',
  '      }',
  '    }',
  '  }',
  // ── photon ring: rays whose deepest approach skims the photon sphere ──
  '  if (captured < .5) {',
  '    float ring = exp(-pow(minr - 1.5, 2.) * 420.);',
  '    col += vec3(1.02, .95, .84) * ring * .5;',
  '    col += stars(v) * .8;',
  '  }',
  // Palette is fixed. This used to ride a hue rotation of sin(T * .045) * .3,
  // which drifted the whole scene ±.3rad on a ~140s cycle; the hole now keeps
  // the hue it starts at (that drift was zero at T=0, so this IS the start
  // colour). Brightness still varies — Doppler beaming and redshift are
  // physics, not palette.
  // Slow drift from amber through pink into purple — no yellow. Measured
  // against this palette, the hue rotation maps:
  //   -0.30 gold 45deg | +0.02 amber 26deg | +0.20 pink 344deg
  //   +0.30 purple 300deg | +0.40 blue 270deg (too far)
  // The drift runs +0.02..+0.32, so it never reaches the gold end and stops
  // short of blue. Two frequencies so it wanders instead of ticking; the
  // shader clock runs at FAST (0.25), so these are ~180s and ~81s of wall time.
  '  col = clamp(hueRot(.17 + .11 * sin(T * .14) + .04 * sin(T * .31)) * col, 0., 1.3);',
  // borderless: alpha carries the scene — empty space is transparent, the
  // shadow stays opaque, and a radial falloff dissolves the glow before the
  // canvas edge so nothing ever clips. The falloff must be radial, not a
  // max-norm square: the faint star/glow haze covers the whole quad, so a
  // square mask ends on straight contours that the 45° canvas rotation
  // renders as a visible diagonal seam across the hero.
  '  float edge = smoothstep(.5, .3, length(uv));',
  '  col *= edge;',
  '  float aa = clamp(max(col.r, max(col.g, col.b)) * 2.4 + captured, 0., 1.) * edge;',
  '  gl_FragColor = vec4(col, aa);',
  '}'].join('\\n').split('__KEP__').join(KEP.toFixed(4)).split('__CAMY__').join(CAM_Y.toFixed(3))
     .split('__ZOOM__').join(ZOOM.toFixed(3));

  function shader(type, src){ var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s)); return s; }
  var prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog); gl.useProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) console.error('link: ' + gl.getProgramInfoLog(prog));
  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  var uR = gl.getUniformLocation(prog, 'R'), uT = gl.getUniformLocation(prog, 'T');
  var uN = gl.getUniformLocation(prog, 'pN');
  var uA = gl.getUniformLocation(prog, 'pA'), uB = gl.getUniformLocation(prog, 'pB'), uC = gl.getUniformLocation(prog, 'pC');
  var fA = new Float32Array(12), fB = new Float32Array(12), fC = new Float32Array(12);

  // ── vector helpers ──
  function rotAxis(v, u, ang){ // Rodrigues
    var c = Math.cos(ang), s = Math.sin(ang), d = (1-c)*(u[0]*v[0]+u[1]*v[1]+u[2]*v[2]);
    return [
      v[0]*c + (u[1]*v[2]-u[2]*v[1])*s + u[0]*d,
      v[1]*c + (u[2]*v[0]-u[0]*v[2])*s + u[1]*d,
      v[2]*c + (u[0]*v[1]-u[1]*v[0])*s + u[2]*d ];
  }
  function camPos(T){ // mirrors the shader ray transform exactly
    var x = 0, y = CAM_Y, z = -7.2, ca = -.10;
    var c = Math.cos(ca), s = Math.sin(ca);
    var y2 = y*c + z*s, z2 = -y*s + z*c;
    var yaw = T * .06, cy = Math.cos(yaw), sy = Math.sin(yaw);
    return [x*cy + z2*sy, y2, -x*sy + z2*cy];
  }

  // ── particle state ──
  // horizon-penetrating time by default (matter falls through, ever faster);
  // ?obs=distant re-imposes far-observer coordinate time (freeze + fade at the rim)
  var OBS = qs.get('obs') === 'distant' ? 'distant' : 'infall';
  var slots = [];
  for (var i = 0; i < MAXP; i++) slots.push({ active:false });
  var nextSpawn = 1.0, simT = 0;

  function spawn(t){
    var s = null;
    var live = 0;
    for (var i = 0; i < MAXP; i++) { if (slots[i].active) live++; else if (!s) s = slots[i]; }
    if (!s || live >= MAXCONC) return;
    var r0 = 4.5 + rng()*1.1;
    var axAng = rng()*Math.PI*2;
    var ax = [Math.cos(axAng), 0, Math.sin(axAng)];
    var tiltAmt = (8 + 14*rng()) * (Math.PI/180) * (rng() < .5 ? 1 : -1);
    s.e1 = rotAxis([1,0,0], ax, tiltAmt);
    s.e2 = rotAxis([0,0,1], ax, tiltAmt);
    s.r = r0; s.pr = (rng()-.5)*.016; s.phi = rng()*Math.PI*2;
    s.L = Lcirc(r0);
    s.mode = 'inspiral'; s.fade = 1; s.active = true; s.counted = false;
    s.born = t; s.prev = null; s.frozeT = 0; s.crossT = 0;
    if (DEBUG) console.log('[bh] spawn r0=' + r0.toFixed(2) + ' tilt=' + (tiltAmt*180/Math.PI).toFixed(1) + '° t=' + t.toFixed(1) + 's');
  }

  // Timelike radial force in the equatorial effective potential (a*=0 branch;
  // the −3ML²/r⁴ term is the GR correction that creates the ISCO and plunge).
  function force(r, L){
    return -M/(r*r) + L*L/(r*r*r) - 3*M*L*L/(r*r*r*r);
  }
  // Velocity-Verlet — the reference's real-time GPU path ("2nd-order
  // symplectic"): bounded energy drift through the plunge, unlike RK4.
  // Weak drag terms (inspiral only) use the standard damped-VV half-kicks.
  function verlet(s, dtau, insp){
    var a0 = force(s.r, s.L) - (insp ? C_DAMP * s.pr : 0);
    var r1 = s.r + s.pr * dtau + 0.5 * a0 * dtau * dtau;
    var rm = 0.5 * (s.r + r1);
    if (insp) s.L *= Math.exp(-K_VISC * dtau);
    var a1 = force(r1, s.L) - (insp ? C_DAMP * (s.pr + a0 * dtau) : 0);
    s.pr += 0.5 * (a0 + a1) * dtau;
    s.phi += s.L / (rm * rm) * dtau;
    s.r = r1;
  }
  function energy(s){
    var f = 1 - RS/s.r;
    return Math.sqrt(Math.max(s.pr*s.pr + f*(1 + s.L*s.L/(s.r*s.r)), 1e-9));
  }
  function worldPos(s, rr){
    var r = (rr !== undefined) ? rr : s.r;
    var c = Math.cos(s.phi), n = Math.sin(s.phi);
    return [ s.e1[0]*r*c + s.e2[0]*r*n, s.e1[1]*r*c + s.e2[1]*r*n, s.e1[2]*r*c + s.e2[2]*r*n ];
  }

  function stepParticle(s, dtWall, T){
    if (!s.active) return;
    var insp = s.mode === 'inspiral';

    if (s.mode === 'fade' || s.mode === 'frozen') {
      var tf = s.mode === 'fade' ? 0.22 : 1.5;
      s.fade *= Math.exp(-dtWall / tf);
      if (s.fade < 0.02) { s.active = false; if (DEBUG) console.log('[bh] despawn (' + s.mode + ') t=' + simT.toFixed(1) + 's'); }
      return;
    }

    // advance geodesic; time mapping depends on the chosen observer
    var budget = dtWall * TS;                        // distant: coordinate time
    if (OBS === 'infall') budget = dtWall * TS * .92; // infalling: proper time
    var guard = 0;
    while (budget > 1e-7 && guard++ < 260) {
      var f = 1 - RS/s.r;
      var E = energy(s);
      // curvature-adaptive step (the reference's manual dt shrink near the hole)
      var cap = Math.min(0.05, 0.006 + 0.03*Math.max(s.r - 1, 0));
      var dtau;
      if (OBS === 'infall') { dtau = Math.min(cap, budget); budget -= dtau; }
      else {
        if (f < 1e-4) break;
        dtau = Math.min(cap, budget * f / E * .9);
        if (dtau < 1e-6) break;                       // frozen at the horizon (dt/dτ → ∞)
        budget -= dtau * E / f;
      }
      verlet(s, dtau, insp);
      if (insp && s.r <= ISCO * 1.015) {
        // plunge.rs plunge_entry_state: the stream leaves the marginally
        // stable orbit carrying the exact conserved (E_ISCO, L_ISCO);
        // a tiny inward dpr_seed makes the orbit no longer marginal.
        insp = false; s.mode = 'plunge';
        s.L = L_ISCO;
        s.pr = Math.min(s.pr, -DPR_SEED);
        if (DEBUG) console.log('[bh] plunge begins r=' + s.r.toFixed(3) + ' L=' + s.L.toFixed(4) + ' E=' + energy(s).toFixed(4) + ' (E_isco=' + E_ISCO.toFixed(4) + ') t=' + simT.toFixed(1) + 's');
      }
      if (s.r <= RS * 1.004) break;
    }

    if (s.r <= RS * 1.004) {
      if (OBS === 'infall') {
        if (!s.counted) { s.counted = true; if (DEBUG) console.log('[bh] crossed horizon t=' + simT.toFixed(1) + 's · E drift ' + Math.abs(energy(s) - E_ISCO).toExponential(1) + ' (invariant audit)'); }
        s.r = RS * 1.002; s.mode = 'fade'; s.crossT = simT;
      } else {
        if (!s.counted) { s.counted = true; if (DEBUG) console.log('[bh] frozen at horizon t=' + simT.toFixed(1) + 's'); }
        s.r = RS * 1.02; s.mode = 'frozen'; s.frozeT = simT;
      }
    } else if (OBS === 'distant' && s.mode === 'plunge') {
      var ff = 1 - RS/s.r;
      if (ff < 0.03) { // integrator hit the asymptote: visually frozen
        s.counted = true;
        s.mode = 'frozen'; s.frozeT = simT;
      }
    }
  }

  function packUniforms(dtWall, T){
    var cam = camPos(T);
    var k = 0;
    for (var i = 0; i < MAXP && k < MAXP; i++) {
      var s = slots[i];
      if (!s.active) continue;
      var pos = worldPos(s);
      // world velocity (for streak + Doppler direction)
      var vw = [0,0,0], speed = 0;
      if (s.prev && dtWall > 1e-4) {
        vw = [(pos[0]-s.prev[0])/dtWall, (pos[1]-s.prev[1])/dtWall, (pos[2]-s.prev[2])/dtWall];
        speed = Math.sqrt(vw[0]*vw[0]+vw[1]*vw[1]+vw[2]*vw[2]);
      }
      s.prev = pos;
      var f = Math.max(1 - RS/s.r, 1e-4);
      var E = energy(s);
      // local static-frame velocity components → β
      var vr = (s.pr * f / E) / f;
      var vt = s.r * ((s.L/(s.r*s.r)) * f / E) / Math.sqrt(f);
      var beta = Math.min(Math.sqrt(vr*vr + vt*vt), 0.995);
      var gamma = 1/Math.sqrt(1 - beta*beta);
      // Doppler along line of sight
      var toCam = [cam[0]-pos[0], cam[1]-pos[1], cam[2]-pos[2]];
      var dc = Math.sqrt(toCam[0]*toCam[0]+toCam[1]*toCam[1]+toCam[2]*toCam[2]) || 1;
      var mu = 0;
      if (speed > 1e-6) mu = (vw[0]*toCam[0]+vw[1]*toCam[1]+vw[2]*toCam[2]) / (speed*dc);
      // redshift.rs combined interface: g = g_grav · δ, with the local
      // static-frame β. (The rigorous target is g = (p·u)_em/(p·u)_obs.)
      var delta = 1/(gamma*(1 - beta*mu));
      var g = Math.sqrt(f) * delta;
      // Planckian LUT lookup at T_obs = g · T_emit — disc profile T ∝ r^{−3/4};
      // the plunging stream carries its ISCO temperature inward.
      var col = lutCol(g * Temit(s.r));
      // Liouville scaling is g⁴ (redshift.rs intensity_scaling, optically
      // thick) — which renders a horizon-hugging ember mathematically
      // invisible. Display-compress to g^1.5·δ²; color still tells the full
      // redshift story. Swap the exponent back for strict realism.
      var bright = 1.15 * Math.pow(Math.min(g, 1.55), 1.5)
                 * (0.5 + 0.5 * Math.pow(Math.min(delta, 1.8), 2))
                 * plungeEnv(s.r) * s.fade;
      // the frozen/fading ember stays legible; its vanish is carried by fade
      if (s.mode === 'frozen' || s.mode === 'fade') bright = Math.max(bright, 0.22 * s.fade);
      // streak: velocity-aligned capsule, frozen ⇒ collapses to an ember dot
      var sl = Math.min(Math.max(speed * .085, .05), .8);
      var tail = pos;
      if (speed > 1e-5) tail = [pos[0]-vw[0]/speed*sl, pos[1]-vw[1]/speed*sl, pos[2]-vw[2]/speed*sl];
      var size = .07 + .03 * Math.max(0, Math.min(1, (4 - s.r) / 3));
      if (s.mode === 'frozen' || s.mode === 'fade') size *= (.55 + .45 * s.fade);
      fA[k*4+0]=pos[0];  fA[k*4+1]=pos[1];  fA[k*4+2]=pos[2];  fA[k*4+3]=size;
      fB[k*4+0]=tail[0]; fB[k*4+1]=tail[1]; fB[k*4+2]=tail[2]; fB[k*4+3]=bright;
      fC[k*4+0]=col[0];  fC[k*4+1]=col[1];  fC[k*4+2]=col[2];  fC[k*4+3]=0;
      k++;
    }
    gl.uniform1i(uN, k);
    gl.uniform4fv(uA, fA); gl.uniform4fv(uB, fB); gl.uniform4fv(uC, fC);
  }

  // ── sizing / loop ──
  function size(){
    var dpr = Math.min(devicePixelRatio || 1, 1.25);
    var w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
  }
  var visible = true, raf = 0, lastTs = 0;
  new IntersectionObserver(function(e){ visible = e[0].isIntersecting; if (visible && !raf && !still && !reduced) { lastTs = 0; loop(); } }).observe(canvas);
  document.addEventListener('visibilitychange', function(){ if (!document.hidden && visible && !raf && !still && !reduced) { lastTs = 0; loop(); } });

  function frame(t, dtWall){
    size();
    var T = t * .001;
    simT += dtWall;
    if (simT >= nextSpawn) { spawn(simT); nextSpawn = simT + 4.5 - Math.log(1 - rng()) * 4.5; }
    for (var i = 0; i < MAXP; i++) stepParticle(slots[i], dtWall, T);
    gl.uniform2f(uR, canvas.width, canvas.height);
    gl.uniform1f(uT, T);
    packUniforms(dtWall, T);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function loop(){
    raf = requestAnimationFrame(function(ts){
      var dt = (lastTs ? Math.min((ts - lastTs) * .001, .05) : .016) * FAST;
      lastTs = ts;
      frame(ts * FAST, dt);
      raf = 0;
      if (visible && !document.hidden) loop();
    });
  }

  // ── debug sanity checks (the reference's invariants/audit idea) ──
  if (DEBUG) {
    console.log('[bh] a*=' + SPIN + ' r_isco=' + ISCO.toFixed(4) + ' (expect 3.0000 at a*=0)');
    console.log('[bh] L_isco expect 1.7320508 got ' + L_ISCO.toFixed(7));
    console.log('[bh] E_isco expect 0.9428090 got ' + E_ISCO.toFixed(7) + ' · η = ' + ((1-E_ISCO)*100).toFixed(2) + '% (BPT/Cunningham: 5.72%)');
    var t0 = { r: 4, pr: 0, L: Lcirc(4), phi: 0 };
    var drift = 0;
    for (var i = 0; i < 3000; i++) { verlet(t0, .04, false); drift = Math.max(drift, Math.abs(t0.r - 4)); }
    console.log('[bh] circular-orbit drift over Δτ=120: ' + drift.toExponential(2) + (drift < .01 ? ' PASS' : ' FAIL'));
  }

  // ── still mode: deterministic tableau for screenshots / QA ──
  if (still || reduced) {
    var tSec = parseFloat(qs.get('t')) || 9;
    // scripted states across the lifecycle
    var A = slots[0]; A.active = true; A.mode = 'inspiral'; A.fade = 1;
    A.e1 = rotAxis([1,0,0], [1,0,0], .24); A.e2 = rotAxis([0,0,1], [1,0,0], .24);
    A.r = 4.1; A.pr = -.01; A.L = Lcirc(4.1); A.phi = 2.0; A.prev = null; A.counted = true;
    var B = slots[1]; B.active = true; B.mode = 'plunge'; B.fade = 1;
    B.e1 = rotAxis([1,0,0], [0,0,1], -.18); B.e2 = rotAxis([0,0,1], [0,0,1], -.18);
    // exact plunging-stream state at r=1.8: conserved (E_ISCO, L_ISCO),
    // pr from E² = pr² + f(1 + L²/r²)
    B.r = 1.8; B.L = L_ISCO; B.phi = 4.4; B.prev = null; B.counted = true;
    B.pr = -Math.sqrt(Math.max(E_ISCO*E_ISCO - (1 - RS/B.r)*(1 + B.L*B.L/(B.r*B.r)), 0));
    var C = slots[2]; C.active = true; C.mode = 'frozen'; C.fade = .55;
    C.e1 = [1,0,0]; C.e2 = [0,0,1];
    C.r = 1.02; C.pr = 0; C.L = L_ISCO; C.phi = .8; C.prev = null; C.counted = true;
    size();
    // two priming frames so world velocities (streaks) exist
    frame(tSec * 1000 - 16, 0);
    frame(tSec * 1000, .016);
    window.__bhOK = (gl.getError() === 0);
    window.__bhShot = function(){ return canvas.toDataURL('image/png'); };
  } else { loop(); }
})();`;
