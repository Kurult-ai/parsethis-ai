
// Lightweight homage to steeltroops-ai/blackhole-simulation:
// one raw-WebGL fragment shader — iterative geodesic bending (48 steps),
// thin accretion disc with Doppler beaming + gravitational dimming, photon
// ring emerges from the loop, procedural starfield lensed by the same rays,
// slow global hue drift. No WASM, no framework, DPR capped, pauses offscreen.
(function(){
  const canvas = document.getElementById('bh');
  const still0 = new URLSearchParams(location.search).has('still');
  const gl = canvas.getContext('webgl', { alpha:true, antialias:false, depth:false, stencil:false, powerPreference:'low-power', preserveDrawingBuffer: still0 });
  if (!gl) return;
  const still = new URLSearchParams(location.search).has('still');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const vs = 'attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }';
  const fs = `
precision highp float;
uniform vec2 R; uniform float T;

mat3 hueRot(float a){
  float c = cos(a), s = sin(a);
  return mat3(.299,.587,.114,.299,.587,.114,.299,.587,.114)
       + c * (mat3(1,0,0,0,1,0,0,0,1) - mat3(.299,.587,.114,.299,.587,.114,.299,.587,.114))
       + s * mat3(-.3,-.588,.886, .143,-.353,.258, -.787,.715,.072);
}
float hash(vec3 q){ return fract(sin(dot(q, vec3(127.1,311.7,74.7))) * 43758.5453); }
vec3 stars(vec3 d){
  vec3 q = normalize(d);
  vec3 cell = floor(q * 90.);
  float h = hash(cell);
  float star = smoothstep(.995, 1., h) * (.35 + .45 * hash(cell + 1.3));
  return vec3(star) * .95;
}
void main(){
  vec2 uv = (gl_FragCoord.xy - .5 * R) / R.y;
  // ── the journey: 34s looping free-fall, proper-time pacing ──
  float pj = fract(T / 34.);
  float fall = pow(pj, 2.05);
  vec3 ro = mix(vec3(0., 4.2, -13.5), vec3(0., -.85, .55), fall);
  float fov = mix(1.15, .62, fall);
  vec3 rd = normalize(vec3(uv.x, uv.y, fov));

  vec3 p = ro, v = rd;
  vec3 col = vec3(0.);
  float captured = 0.;
  float w = 1.;
  float jit = .9 + .2 * hash(vec3(gl_FragCoord.xy, 7.));

  for (int i = 0; i < 110; i++) {
    float r = length(p);
    if (r < .9) { captured = 1.; break; }
    float dt = clamp(.05 + .055 * r, .06, .3) * jit;
    vec3 acc = -1.55 * p / (r * r * r * r);
    v += acc * dt;
    vec3 pp = p;
    p += v * dt;
    if (pp.y * p.y < 0.) {
      float t = pp.y / (pp.y - p.y);
      vec3 hit = mix(pp, p, t);
      float hr = length(hit.xz);
      if (hr > 1.3 && hr < 4.6) {
        float ang = atan(hit.z, hit.x);
        float doppler = 1. + .6 * sin(ang) / sqrt(hr);
        float arms = sin(ang * 2. - hr * 3.5 + T * 1.1);
        float fine = sin(ang * 9. - hr * 11. + T * 2.2);
        float bands = .72 + .28 * arms + .10 * fine;
        float glow = pow(1.55 / hr, 2.2) * bands * doppler;
        vec3 disc = mix(vec3(1.0), vec3(.62), clamp((hr-1.3)/3.3, 0., 1.));
        disc = mix(disc, vec3(1.06), clamp((doppler - 1.)*.5, 0., .4));
        col += disc * glow * .55 * w;
        w *= .5;
      }
    }
  }
  if (captured < .5) col += stars(v) * 1.5;
  float lum = dot(col, vec3(.299, .587, .114));
  col = vec3(lum);
  col *= (1. + 2.6 * smoothstep(.72, .93, pj));
  col *= 1. - smoothstep(.90, .985, pj);
  col *= smoothstep(0., .05, pj);   // slow luminance breathe, fully neutral
  float vig = smoothstep(1.15, .45, length(uv));
  gl_FragColor = vec4(col * vig, 1.);
}`;

  function shader(type, src){ const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s)); return s; }
  const prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog); gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uR = gl.getUniformLocation(prog, 'R'), uT = gl.getUniformLocation(prog, 'T');

  function size(){
    const dpr = Math.min(devicePixelRatio || 1, 1.25);
    const w = canvas.clientWidth * dpr, h = canvas.clientHeight * dpr;
    if (canvas.width !== w) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
  }
  let visible = true, raf = 0;
  new IntersectionObserver(e => { visible = e[0].isIntersecting; if (visible && !raf && !still && !reduced) loop(); }).observe(canvas);
  function frame(t){
    size();
    gl.uniform2f(uR, canvas.width, canvas.height);
    gl.uniform1f(uT, t * .001);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function loop(){ raf = requestAnimationFrame(ts => { frame(ts); raf = 0; if (visible) loop(); }); }
  if (still || reduced) { const tSec = parseFloat(new URLSearchParams(location.search).get('t')) || 9; size(); frame(tSec * 1000); window.__bhOK = (gl.getError() === 0); window.__bhShot = () => canvas.toDataURL('image/png'); } else loop();
})();
