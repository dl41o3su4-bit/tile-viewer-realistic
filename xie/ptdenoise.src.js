// Edge-aware à-trous denoiser + auto-exposure for three-gpu-pathtracer output.
// Guides (rasterized once per camera): albedo (demodulation) and view normal + linear depth.
import * as THREE from 'three';
const VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const ACES = `
vec3 RRTAndODTFit(vec3 v){ vec3 a = v*(v+0.0245786)-0.000090537; vec3 b = v*(0.983729*v+0.4329510)+0.238081; return a/b; }
vec3 aces(vec3 c){ const mat3 I = mat3(vec3(0.59719,0.07600,0.02840),vec3(0.35458,0.90834,0.13383),vec3(0.04823,0.01566,0.83777));
  const mat3 O = mat3(vec3(1.60475,-0.10208,-0.00327),vec3(-0.53108,1.10813,-0.07276),vec3(-0.07367,-0.00605,1.07602));
  c *= 1.0/0.6; c = I*c; c = RRTAndODTFit(c); c = O*c; return clamp(c,0.0,1.0); }
vec3 toSRGB(vec3 c){ return mix(c*12.92, 1.055*pow(c,vec3(1.0/2.4))-0.055, step(0.0031308,c)); }`;
function rt(w, h, type = THREE.HalfFloatType, lin = false, samples = 0) { return new THREE.WebGLRenderTarget(w, h, { type, samples, minFilter: lin ? THREE.LinearFilter : THREE.NearestFilter, magFilter: lin ? THREE.LinearFilter : THREE.NearestFilter, format: THREE.RGBAFormat, depthBuffer: true, generateMipmaps: false }); }
function quadMat(fs, uniforms) { return new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false, toneMapped: false }); }
// demodulate + firefly clamp
const FS_DEMOD = `uniform sampler2D tPT, tAlb; uniform vec2 px; varying vec2 vUv;
float L(vec3 c){ return dot(c, vec3(0.2126,0.7152,0.0722)); }
void main(){ vec3 a = max(texture2D(tAlb, vUv).rgb, vec3(0.03)); vec3 c = texture2D(tPT, vUv).rgb / a; if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
  float m = 0.0; for (int y=-1;y<=1;y++) for (int x=-1;x<=1;x++){ if (x==0&&y==0) continue; m += L(texture2D(tPT, vUv+vec2(x,y)*px).rgb / max(texture2D(tAlb, vUv+vec2(x,y)*px).rgb, vec3(0.03))); }
  m /= 8.0; float l = L(c), mx = 4.0*m + 0.05; if (l > mx) c *= mx/l; gl_FragColor = vec4(c, 1.0); }`;
const FS_ATROUS = `uniform sampler2D tC, tG; uniform vec2 px; uniform float stepw, sigL, sigN, ortho; uniform vec2 pj; varying vec2 vUv;
vec3 VP(vec2 uv, float z){ vec2 n = uv*2.0-1.0; return ortho > 0.5 ? vec3(n/pj, -z) : vec3(n*z/pj, -z); }
float L(vec3 c){ return dot(c, vec3(0.2126,0.7152,0.0722)); }
void main(){ vec4 g0 = texture2D(tG, vUv); vec3 c0 = texture2D(tC, vUv).rgb; float l0 = L(c0);
  bool inv = g0.a <= 0.0;
  vec3 n0 = g0.xyz*2.0-1.0, P0 = VP(vUv, g0.a); float sigP = 0.012*g0.a + 0.004; float k[3]; k[0]=3.0/8.0; k[1]=1.0/4.0; k[2]=1.0/16.0; vec3 s = vec3(0.0); float ws = 0.0;
  for (int y=-2;y<=2;y++) for (int x=-2;x<=2;x++){ vec2 uv = vUv + vec2(x,y)*px*stepw; vec4 g = texture2D(tG, uv); vec3 c = texture2D(tC, uv).rgb;
    float w = k[x<0?-x:x]*k[y<0?-y:y]; if (inv) { s += c*w; ws += w; continue; } if (g.a <= 0.0) continue;
    w *= pow(max(dot(g0.xyz*2.0-1.0, g.xyz*2.0-1.0), 0.0), sigN);
    w *= exp(-abs(dot(n0, VP(uv, g.a)-P0))/sigP);
    w *= exp(-abs(L(c)-l0)/(sigL*(l0+L(c))*0.5 + 1e-3));
    s += c*w; ws += w; }
  gl_FragColor = vec4(ws > 0.0 ? s/ws : c0, 1.0); }`;
const FS_REMOD = `uniform sampler2D tC, tAlb, tPT; uniform float useD; varying vec2 vUv;
void main(){ vec3 a = max(texture2D(tAlb, vUv).rgb, vec3(0.03)); vec3 c = useD > 0.5 ? texture2D(tC, vUv).rgb * a : texture2D(tPT, vUv).rgb; gl_FragColor = vec4(c, 1.0); }`;
const FS_OUT = `uniform sampler2D tC; uniform float expo; uniform vec2 px; varying vec2 vUv; ${ACES}
float L(vec3 c){ return dot(c, vec3(0.2126,0.7152,0.0722)); }
void main(){ vec3 c = texture2D(tC, vUv).rgb, a = texture2D(tC, vUv+vec2(px.x,0.0)).rgb, b = texture2D(tC, vUv-vec2(px.x,0.0)).rgb, d = texture2D(tC, vUv+vec2(0.0,px.y)).rgb, e = texture2D(tC, vUv-vec2(0.0,px.y)).rgb;
  float mn = min(min(L(a),L(b)),min(L(d),L(e))); if (L(c) < 0.3*mn) c = (a+b+d+e)*0.25; // speckle (isolated dark texel) removal
  gl_FragColor = vec4(toSRGB(aces(c*expo)), 1.0); }`;
const GUIDE = new THREE.ShaderMaterial({ vertexShader: `varying vec3 vN; varying float vZ; void main(){ vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vZ = -mv.z; gl_Position = projectionMatrix*mv; }`,
  fragmentShader: `varying vec3 vN; varying float vZ; void main(){ vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n; gl_FragColor = vec4(n*0.5+0.5, vZ); }`, side: THREE.DoubleSide });
function aces(x) { const a = x * (x + 0.0245786) - 0.000090537, b = x * (0.983729 * x + 0.432951) + 0.238081; return Math.min(1, Math.max(0, a / b)); }
const srgb = c => c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
export class PTDenoiser {
  constructor(renderer) { this.r = renderer; this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); this.qs = new THREE.Scene(); this.qs.add(this.quad); this.qc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.mDemod = quadMat(FS_DEMOD, { tPT: { value: null }, tAlb: { value: null }, px: { value: new THREE.Vector2() } });
    this.mAt = quadMat(FS_ATROUS, { tC: { value: null }, tG: { value: null }, px: { value: new THREE.Vector2() }, stepw: { value: 1 }, sigL: { value: 1 }, sigN: { value: 64 }, ortho: { value: 0 }, pj: { value: new THREE.Vector2(1, 1) } });
    this.mRemod = quadMat(FS_REMOD, { tC: { value: null }, tAlb: { value: null }, tPT: { value: null }, useD: { value: 1 } });
    this.mOut = quadMat(FS_OUT, { tC: { value: null }, expo: { value: 1 }, px: { value: new THREE.Vector2() } }); this.expo = 1; this.enabled = true; this.targetLuma = null; }
  pass(m, target) { this.quad.material = m; this.r.setRenderTarget(target); this.r.render(this.qs, this.qc); }
  setSize(w, h) { if (this.w === w && this.h === h) return; this.dispose(); this.w = w; this.h = h;
    this.alb = rt(w, h, THREE.HalfFloatType, false, 4); this.gd = rt(w, h, THREE.FloatType); this.a = rt(w, h); this.b = rt(w, h); this.fin = rt(w, h, THREE.FloatType); }
  // rasterize guides with the same camera / visibility as the path tracer
  buildGuides(scene, camera) { camera.updateProjectionMatrix && camera.updateMatrixWorld(); const pe = camera.projectionMatrix.elements; this.mAt.uniforms.pj.value.set(pe[0], pe[5]); this.mAt.uniforms.ortho.value = camera.isOrthographicCamera ? 1 : 0; const r = this.r, saved = [], bgS = scene.background, envS = scene.environment, fog = scene.fog;
    const tm = r.toneMapping, cc = new THREE.Color(); r.getClearColor(cc); const ca = r.getClearAlpha(); r.toneMapping = THREE.NoToneMapping;
    scene.traverse(o => { if (!o.isMesh || !o.material || Array.isArray(o.material)) return; const m = o.material;
      if (m.transparent && m.opacity < 0.9 || m.transmission > 0) { saved.push([o, 'visible', o.visible]); o.visible = false; return; }
      const emit = m.emissive && m.emissiveIntensity > 0 && (m.emissive.r + m.emissive.g + m.emissive.b) > 0;
      const bm = new THREE.MeshBasicMaterial({ color: emit ? 0xffffff : (m.color || new THREE.Color(1, 1, 1)), map: emit ? null : (m.map || null), side: m.side, alphaTest: m.alphaTest || 0, toneMapped: false });
      saved.push([o, 'material', m]); o.material = bm; });
    scene.background = new THREE.Color(1, 1, 1); scene.environment = null; scene.fog = null; r.setClearColor(0xffffff, 1);
    r.setRenderTarget(this.alb); r.clear(); r.render(scene, camera);
    for (const [o, k, v] of saved) if (k === 'material') { o.material.dispose(); o.material = v; }
    scene.overrideMaterial = GUIDE; scene.background = null; r.setClearColor(0x000000, 0); r.setRenderTarget(this.gd); r.clear(); r.render(scene, camera); scene.overrideMaterial = null;
    for (const [o, k, v] of saved) if (k === 'visible') o.visible = v;
    scene.background = bgS; scene.environment = envS; scene.fog = fog; r.setClearColor(cc, ca); r.toneMapping = tm; r.setRenderTarget(null); }
  // mean display luma of what the user currently sees on the canvas (call right after a normal render)
  captureCanvasLuma() { const gl = this.r.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); let s = 0, n = 0;
    for (let i = 0; i < w * h; i += 7) { s += (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255; n++; } this.targetLuma = n ? s / n : null; return this.targetLuma; }
  // denoise ptTarget (linear float accumulation) → this.fin (linear)
  process(ptTex, spp) { const px = new THREE.Vector2(1 / this.w, 1 / this.h);
    if (!this.enabled) { Object.assign(this.mRemod.uniforms, {}); this.mRemod.uniforms.tPT.value = ptTex; this.mRemod.uniforms.useD.value = 0; this.pass(this.mRemod, this.fin); return; }
    this.mDemod.uniforms.tPT.value = ptTex; this.mDemod.uniforms.tAlb.value = this.alb.texture; this.mDemod.uniforms.px.value = px; this.pass(this.mDemod, this.a);
    const steps = spp < 48 ? [1, 1, 2, 2, 4, 4, 8, 1, 1] : spp < 200 ? [1, 1, 2, 4, 8, 1, 1] : [1, 2, 4, 1], sigL = Math.min(4, 6 / Math.sqrt(Math.max(1, spp))); let src = this.a, dst = this.b;
    steps.forEach((st, i) => { const u = this.mAt.uniforms; u.tC.value = src.texture; u.tG.value = this.gd.texture; u.px.value = px; u.stepw.value = st; u.sigL.value = sigL * (i < 2 ? 4 : 1); u.sigN.value = 64;
      this.pass(this.mAt, dst); [src, dst] = [dst, src]; });
    const m = this.mRemod.uniforms; m.tC.value = src.texture; m.tAlb.value = this.alb.texture; m.tPT.value = ptTex; m.useD.value = 1; this.pass(this.mRemod, this.fin); }
  // choose exposure so the mean displayed luma matches the raster view
  autoExposure() { if (this.targetLuma == null) return this.expo; const w = this.w, h = this.h, buf = new Float32Array(w * h * 4); this.r.readRenderTargetPixels(this.fin, 0, 0, w, h, buf);
    const Ls = []; for (let i = 0; i < w * h; i += 5) { const l = 0.2126 * buf[i * 4] + 0.7152 * buf[i * 4 + 1] + 0.0722 * buf[i * 4 + 2]; if (isFinite(l)) Ls.push(l); }
    if (!Ls.length) return this.expo; const f = e => { let s = 0; for (const l of Ls) s += srgb(aces(l * e / 0.6)); return s / Ls.length; };
    let lo = 0.3, hi = 12; for (let k = 0; k < 24; k++) { const mid = Math.sqrt(lo * hi); if (f(mid) < this.targetLuma) lo = mid; else hi = mid; } this.expo = Math.sqrt(lo * hi); return this.expo; }
  display() { this.mOut.uniforms.tC.value = this.fin.texture; this.mOut.uniforms.expo.value = this.expo; this.mOut.uniforms.px.value.set(1 / this.w, 1 / this.h); this.pass(this.mOut, null); }
  dispose() { for (const k of ['alb', 'gd', 'a', 'b', 'fin']) if (this[k]) { this[k].dispose(); this[k] = null; } this.w = this.h = 0; }
}
