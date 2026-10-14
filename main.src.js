import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || Math.min(innerWidth, innerHeight) < 600;
let quality = params.get('q') || (isMobile ? 'mobile' : 'high');

// ---------- asset loading (assets stored as base64 text so the repo can be maintained through the GitHub API) ----------
const VER = '5';
let loadedCount = 0, totalCount = 1;
function progress() { $('loadtxt').textContent = `載入中… ${Math.round(100 * loadedCount / totalCount)}%`; }
async function fetchB64(path) {
  totalCount++; progress();
  const r = await fetch(`assets/${path}.b64?v=${VER}`);
  if (!r.ok) throw new Error('fetch ' + path + ' ' + r.status);
  const s = (await r.text()).replace(/\s+/g, '');
  // perf: native base64 decode (no per-byte JS loop)
  const buf = Uint8Array.fromBase64 ? Uint8Array.fromBase64(s).buffer : await (await fetch('data:application/octet-stream;base64,' + s)).arrayBuffer();
  loadedCount++; progress();
  return buf;
}
const gltfLoader = new GLTFLoader(); gltfLoader.setMeshoptDecoder(MeshoptDecoder);
const modelCache = {};
function loadModel(name) {
  if (!modelCache[name]) modelCache[name] = fetchB64(name + '.glb').then(buf => new Promise((res, rej) => gltfLoader.parse(buf, '', g => {
    g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material) o.material.envMapIntensity = 1; } });
    res(g.scene);
  }, rej)));
  return modelCache[name];
}
async function loadImage(path, type = 'image/jpeg') {
  const buf = await fetchB64(path);
  const url = URL.createObjectURL(new Blob([buf], { type }));
  const img = new Image(); img.src = url; await img.decode(); return img;
}

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('shot') });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
RectAreaLightUniformsLib.init();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d0d0f);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 60);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 0.4;

let composer, renderPass, gtaoPass, bloomPass, smaaPass, outputPass;
function setupPipeline() {
  const pr = quality === 'high' ? Math.min(devicePixelRatio, 2) : Math.min(devicePixelRatio, 1.25);
  renderer.setPixelRatio(pr);
  composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 0 }));
  composer.setPixelRatio(pr); composer.setSize(innerWidth, innerHeight);
  renderPass = new RenderPass(scene, camera); composer.addPass(renderPass);
  if (quality === 'high') {
    gtaoPass = new GTAOPass(scene, camera, innerWidth, innerHeight);
    gtaoPass.blendIntensity = 0.85;
    gtaoPass.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.5, thickness: 1.5, scale: 1.0, samples: 12 });
    gtaoPass.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    composer.addPass(gtaoPass);
  } else gtaoPass = null;
  bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.18, 0.5, 1.6);
  composer.addPass(bloomPass);
  outputPass = new OutputPass(); composer.addPass(outputPass);
  smaaPass = new SMAAPass(innerWidth * pr, innerHeight * pr); composer.addPass(smaaPass);
  renderer.shadowMap.needsUpdate = true;
}

// ---------- procedural helper textures ----------
function rand(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function noiseCanvas(w, h, f) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d');
  const id = ctx.createImageData(w, h); f(id.data, w, h); ctx.putImageData(id, 0, 0); return c;
}
// smooth value noise
function makeNoise(seed) {
  const R = rand(seed), P = new Float32Array(256 * 256); for (let i = 0; i < P.length; i++) P[i] = R();
  const g = (x, y) => P[((y & 255) << 8) | (x & 255)];
  return (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return (g(xi, yi) * (1 - u) + g(xi + 1, yi) * u) * (1 - v) + (g(xi, yi + 1) * (1 - u) + g(xi + 1, yi + 1) * u) * v; };
}
function fbm(n, x, y, o = 4) { let a = 0, amp = 0.5, f = 1; for (let i = 0; i < o; i++) { a += amp * n(x * f, y * f); f *= 2; amp *= 0.5; } return a; }

let marbleImg = null;

// tile styles. size in meters [w,h]
const STYLES = {
  marble80: { name: '80×80 淺灰石紋（拋光）', size: [0.8, 0.8], rough: 0.12, slip: 0, kind: 'marble', tint: [0.93, 0.93, 0.94], polished: true },
  marble6060w: { name: '60×60 白色雪花石', size: [0.6, 0.6], rough: 0.14, slip: 0, kind: 'marble', tint: [1.0, 0.99, 0.97], bright: 1.1, polished: true },
  quartz30: { name: '30×30 止滑石英磚', size: [0.3, 0.3], rough: 0.62, slip: 1, kind: 'quartz', tint: [0.80, 0.78, 0.74] },
  wall3060: { name: '30×60 亮面白壁磚', size: [0.6, 0.3], rough: 0.10, slip: 0, kind: 'marble', tint: [1.0, 1.0, 1.0], bright: 1.12, polished: true },
  grey3060: { name: '30×60 灰色霧面止滑', size: [0.6, 0.3], rough: 0.78, slip: 1, kind: 'cement', tint: [0.55, 0.55, 0.55] },
  wood20120: { name: '20×120 木紋磚', size: [1.2, 0.2], rough: 0.45, slip: 0, kind: 'wood', tint: [0.62, 0.45, 0.31] },
};

const variantCache = {};
function getVariants(styleKey, pw, ph) {
  const key = styleKey + pw + 'x' + ph;
  if (variantCache[key]) return variantCache[key];
  const st = STYLES[styleKey], out = [];
  for (let v = 0; v < 4; v++) {
    const c = document.createElement('canvas'); c.width = pw; c.height = ph; const ctx = c.getContext('2d', { willReadFrequently: true });
    if (st.kind === 'photo') {
      const img = st.imgs[v % st.imgs.length], t = Math.floor(v / st.imgs.length) % 4;
      ctx.save(); ctx.translate(pw / 2, ph / 2);
      if (t === 1) ctx.rotate(Math.PI); if (t === 2) ctx.scale(-1, 1); if (t === 3) ctx.scale(1, -1);
      ctx.drawImage(img, -pw / 2, -ph / 2, pw, ph); ctx.restore();
    } else if (st.kind === 'marble') {
      const n = makeNoise(301 + v * 13), n2 = makeNoise(77 + v), R = rand(41 + v * 3);
      const id = ctx.createImageData(pw, ph), d = id.data, t = st.tint, ppm = pw / st.size[0], b = st.bright || 1.0;
      const ang = R() * Math.PI, ca = Math.cos(ang), sa = Math.sin(ang), ox = R() * 50, oy = R() * 50;
      for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
        const i = (y * pw + x) * 4, mx = x / ppm * 2.2 + ox, my = y / ppm * 2.2 + oy;
        const u = mx * ca - my * sa, w = mx * sa + my * ca;
        const warp = fbm(n, u * 1.3, w * 1.3, 5) * 5.0;
        const vein = Math.pow(1 - Math.abs(Math.sin(u * 2.2 + warp)), 18);
        const vein2 = Math.pow(1 - Math.abs(Math.sin(w * 5.0 + fbm(n2, u * 3, w * 3, 4) * 7.0)), 40);
        const cloud = fbm(n2, mx * 0.8, my * 0.8, 4);
        const soft = Math.pow(1 - Math.abs(Math.sin(u * 2.2 + warp)), 4);
        let l = (0.87 + 0.1 * cloud) * b - 0.2 * vein - 0.08 * vein2 - 0.07 * soft;
        l = Math.max(0.3, Math.min(1, l));
        d[i] = 255 * Math.min(1, l * t[0]); d[i + 1] = 255 * Math.min(1, l * t[1]); d[i + 2] = 255 * Math.min(1, l * t[2] * 1.01); d[i + 3] = 255;
      }
      ctx.putImageData(id, 0, 0);
    } else {
      const n = makeNoise(99 + v * 7), R = rand(5 + v);
      const id = ctx.createImageData(pw, ph), d = id.data, t = st.tint, ppm = pw / st.size[0];
      for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
        const i = (y * pw + x) * 4, mx = x / ppm, my = y / ppm; let l;
        if (st.kind === 'quartz') { l = 0.92 + 0.12 * (fbm(n, mx * 6, my * 6) - 0.5) + (R() < 0.05 ? (R() - 0.5) * 0.5 : 0) + (R() - 0.5) * 0.05; }
        else if (st.kind === 'cement') { l = 1.0 + 0.22 * (fbm(n, mx * 3, my * 3, 5) - 0.5) + 0.08 * (n(mx * 40, my * 40) - 0.5) + (R() < 0.02 ? -0.12 : 0); }
        else { // wood
          const gr = fbm(n, mx * 1.2, my * 18, 5); const ring = 0.5 + 0.5 * Math.sin((my * 40 + gr * 8 + n(mx * 0.7, 3) * 6) * 3.0);
          l = 0.85 + 0.25 * ring * gr + 0.06 * (n(mx * 60, my * 300) - 0.5) + v * 0.03 - 0.045;
        }
        d[i] = 255 * Math.min(1, l * t[0]); d[i + 1] = 255 * Math.min(1, l * t[1]); d[i + 2] = 255 * Math.min(1, l * t[2]); d[i + 3] = 255;
      }
      ctx.putImageData(id, 0, 0);
    }
    out.push(c);
  }
  return (variantCache[key] = out);
}

// layout: returns list of tile rects in meters (x,y,w,h) covering W x H
function layout(W, H, tw, th, pattern) {
  const rects = []; const off = pattern === 'half' ? 0.5 : pattern === 'third' ? 1 / 3 : 0;
  const x0 = (W / 2) % tw - tw, y0 = (H / 2) % th - th; let row = 0;
  for (let y = y0; y < H; y += th, row++) {
    const sh = ((row * off) % 1) * tw;
    for (let x = x0 - sh; x < W; x += tw) rects.push([x, y, tw, th]);
  }
  return rects;
}

// perf: baked tile maps are memoised per (size, style, pattern, grout, seed, quality); LRU-bounded by pixel budget, textures in use are never disposed
const bakeCache = new Map(); let bakeBytes = 0; const texUse = new Map();
const BAKE_BUDGET = () => (quality === 'high' ? 1400e6 : 200e6);
function setBaked(m, t) { if (m.userData.bk) texRef(m.userData.bk, -1); m.userData.bk = t; if (t) { texRef(t, +1); m.map = t.map; m.normalMap = t.normalMap; m.roughnessMap = t.roughnessMap; } }
function texRef(t, d) { for (const q of ['map', 'normalMap', 'roughnessMap']) if (t && t[q]) texUse.set(t[q], (texUse.get(t[q]) || 0) + d); }
function bakeTiles(W, H, styleKey, pattern, groutMM, groutHex, seed = 1) {
  const key = [W.toFixed(4), H.toFixed(4), styleKey, pattern, groutMM, groutHex, seed, quality].join('|');
  let e = bakeCache.get(key);
  if (e) { bakeCache.delete(key); bakeCache.set(key, e); return e.t; }
  const t = bakeTilesRaw(W, H, styleKey, pattern, groutMM, groutHex, seed);
  const img = t.map.image, bytes = img.width * img.height * 4 * 3; bakeCache.set(key, { t, bytes }); bakeBytes += bytes;
  for (const [k, v] of bakeCache) { if (bakeBytes <= BAKE_BUDGET() || bakeCache.size <= 1) break;
    if (['map', 'normalMap', 'roughnessMap'].some(q => (texUse.get(v.t[q]) || 0) > 0)) continue;
    bakeCache.delete(k); bakeBytes -= v.bytes; for (const q of ['map', 'normalMap', 'roughnessMap']) { v.t[q].dispose(); texUse.delete(v.t[q]); } }
  return t;
}
function bakeTilesRaw(W, H, styleKey, pattern, groutMM, groutHex, seed = 1) {
  const st = STYLES[styleKey];
  let ppm = quality === 'high' ? 600 : 340; ppm = Math.min(ppm, 4096 / Math.max(W, H));
  const cw = Math.round(W * ppm), ch = Math.round(H * ppm);
  const [tw, th] = st.size; const g = groutMM / 1000 * ppm;
  const pw = Math.round(tw * ppm), ph = Math.round(th * ppm);
  const vars = getVariants(styleKey, pw, ph);
  const albedo = document.createElement('canvas'); albedo.width = cw; albedo.height = ch;
  const actx = albedo.getContext('2d', { willReadFrequently: true }); actx.fillStyle = groutHex; actx.fillRect(0, 0, cw, ch);
  const hc = document.createElement('canvas'); hc.width = cw; hc.height = ch; const hctx = hc.getContext('2d', { willReadFrequently: true });
  hctx.fillStyle = '#000'; hctx.fillRect(0, 0, cw, ch);
  const R = rand(seed * 977 + 3);
  const tileVar = [];
  for (const [x, y, w, h] of layout(W, H, tw, th, pattern)) {
    const px = x * ppm + g / 2, py = y * ppm + g / 2, pww = w * ppm - g, phh = h * ppm - g;
    const vi = Math.floor(R() * 4), flip = R() < 0.5;
    actx.save(); actx.beginPath(); actx.rect(px, py, pww, phh); actx.clip();
    actx.translate(x * ppm + w * ppm / 2, y * ppm + h * ppm / 2); if (flip) actx.rotate(Math.PI);
    actx.drawImage(vars[vi], -pw / 2, -ph / 2, pw, ph);
    // per-tile shade variation
    actx.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '255,255,255'},${R() * 0.035})`; actx.fillRect(-pw / 2, -ph / 2, pw, ph);
    actx.restore();
    const lv = Math.round(200 + R() * 55);
    hctx.fillStyle = `rgb(255,${lv},0)`; hctx.fillRect(px, py, pww, phh);
  }
  // compute normal, roughness mask, AO in grout
  const hd = hctx.getImageData(0, 0, cw, ch).data, ad = actx.getImageData(0, 0, cw, ch);
  const A = ad.data, N = actx.createImageData(cw, ch), Nd = N.data, Rr = actx.createImageData(cw, ch), Rd = Rr.data;
  const Hh = new Float32Array(cw * ch);
  const n = makeNoise(seed + 11);
  for (let i = 0; i < cw * ch; i++) Hh[i] = hd[i * 4] / 255;
  // bevel blur (2 passes of 3x3 box)
  const tmp = new Float32Array(cw * ch);
  const bevel = Math.max(1, Math.round(ppm * 0.0015));
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      let s = 0, c = 0;
      for (let k = -bevel; k <= bevel; k++) { const xx = Math.min(cw - 1, Math.max(0, x + k)); s += Hh[y * cw + xx]; c++; }
      tmp[y * cw + x] = s / c;
    }
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      let s = 0, c = 0;
      for (let k = -bevel; k <= bevel; k++) { const yy = Math.min(ch - 1, Math.max(0, y + k)); s += tmp[yy * cw + x]; c++; }
      Hh[y * cw + x] = s / c;
    }
  }
  const depth = 0.0025 * ppm * 0.9, slip = st.slip;
  const bump = st.kind === 'photo' ? (st.bump || 0.5) : 0; let Lum = null;
  if (bump) { Lum = new Float32Array(cw * ch); for (let i = 0; i < cw * ch; i++) Lum[i] = (A[i * 4] + A[i * 4 + 1] + A[i * 4 + 2]) / 765; }
  for (let y = 0; y < ch; y++) { const ro = y * cw, ru = (y > 0 ? y - 1 : 0) * cw, rd = (y < ch - 1 ? y + 1 : ch - 1) * cw, my = y / ppm * 300;
   for (let x = 0; x < cw; x++) {
    const i = ro + x, j = i * 4, xr = x < cw - 1 ? x + 1 : cw - 1, xl = x > 0 ? x - 1 : 0;
    const h = Hh[i];
    const hx = Hh[ro + xr] - Hh[ro + xl];
    const hy = Hh[ru + x] - Hh[rd + x];
    let nx = -hx * depth, ny = -hy * depth;
    if (bump && h > 0.9) { nx -= (Lum[ro + xr] - Lum[ro + xl]) * bump * 2.0; ny -= (Lum[ru + x] - Lum[rd + x]) * bump * 2.0; }
    if (slip && h > 0.9) { const mx = x / ppm * 300, n0 = n(mx, my); nx += (n0 - n(mx + 1, my)) * 0.6; ny += (n0 - n(mx, my + 1)) * 0.6; }
    const l = Math.sqrt(nx * nx + ny * ny + 1);
    Nd[j] = (nx / l * 0.5 + 0.5) * 255; Nd[j + 1] = (ny / l * 0.5 + 0.5) * 255; Nd[j + 2] = (1 / l * 0.5 + 0.5) * 255; Nd[j + 3] = 255;
    const groutMask = 1 - Math.min(1, h * 1.05);
    const ao = 0.62 + 0.38 * Math.min(1, h * 1.3);
    A[j] *= ao; A[j + 1] *= ao; A[j + 2] *= ao;
    Rd[j] = 255; Rd[j + 1] = groutMask * 255; Rd[j + 2] = hd[j + 1]; Rd[j + 3] = 255;
  } }
  actx.putImageData(ad, 0, 0);
  const nc = document.createElement('canvas'); nc.width = cw; nc.height = ch; nc.getContext('2d', { willReadFrequently: true }).putImageData(N, 0, 0);
  const rc = document.createElement('canvas'); rc.width = cw; rc.height = ch; rc.getContext('2d', { willReadFrequently: true }).putImageData(Rr, 0, 0);
  const mk = (c, srgb) => { const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); t.generateMipmaps = true; return t; };
  return { map: mk(albedo, true), normalMap: mk(nc, false), roughnessMap: mk(rc, false) };
}

function tileMaterial(styleKey, reflect) {
  const st = STYLES[styleKey];
  const m = new THREE.MeshPhysicalMaterial({ roughness: st.rough, metalness: 0, clearcoat: 0, normalScale: new THREE.Vector2(1, 1) });
  m.userData.u = { uGroutRough: { value: 0.92 }, tReflect: { value: null }, reflMat: { value: new THREE.Matrix4() }, uRefl: { value: 0 } };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, m.userData.u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform mat4 reflMat; varying vec4 vReflUv;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvReflUv = reflMat * modelMatrix * vec4(transformed,1.0);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uGroutRough; uniform sampler2D tReflect; uniform float uRefl; varying vec4 vReflUv;')
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = roughness;
        vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
        roughnessFactor = mix(roughness * (0.8 + 0.4 * texelRoughness.b), uGroutRough, texelRoughness.g);`)
      .replace('#include <opaque_fragment>', `
        if (uRefl > 0.0) {
          vec3 vd = normalize(vViewPosition);
          float ndv = clamp(dot(normal, vd), 0.0, 1.0);
          float fr = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
          vec4 ru = vReflUv; ru.xy += normal.xy * 0.015 * ru.w;
          vec3 rc = texture2DProj(tReflect, ru).rgb;
          float gloss = pow(clamp(1.0 - roughnessFactor * 2.2, 0.0, 1.0), 2.0);
          outgoingLight += rc * fr * gloss * uRefl;
        }
        #include <opaque_fragment>`);
  };
  return m;
}

// ---------- generic materials ----------
function plasterMat(hex, rough = 0.92) {
  if (!plasterMat.nm) {
    const n = makeNoise(3), s = 512;
    const c = noiseCanvas(s, s, (d) => { const H = new Float32Array(s * s); for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) H[y * s + x] = fbm(n, x / 18, y / 18, 4) + 0.3 * n(x / 3, y / 3);
      for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) { const i = (y * s + x) * 4, a = H[y * s + ((x + 1) % s)] - H[y * s + ((x + s - 1) % s)], b = H[((y + 1) % s) * s + x] - H[((y + s - 1) % s) * s + x];
        const nx = -a * 0.6, ny = b * 0.6, l = Math.hypot(nx, ny, 1); d[i] = (nx / l * .5 + .5) * 255; d[i + 1] = (ny / l * .5 + .5) * 255; d[i + 2] = (1 / l * .5 + .5) * 255; d[i + 3] = 255; } });
    plasterMat.nm = new THREE.CanvasTexture(c); plasterMat.nm.wrapS = plasterMat.nm.wrapT = THREE.RepeatWrapping; plasterMat.nm.repeat.set(3, 3);
  }
  return new THREE.MeshStandardMaterial({ color: hex, roughness: rough, normalMap: plasterMat.nm, normalScale: new THREE.Vector2(0.25, 0.25), shadowSide: THREE.DoubleSide });
}
const M = {};
function initMaterials() {
  M.white = new THREE.MeshStandardMaterial({ color: 0xf2f1ee, roughness: 0.5 });
  M.cabinet = new THREE.MeshPhysicalMaterial({ color: 0xe9e6e0, roughness: 0.35, clearcoat: 0.3, clearcoatRoughness: 0.3 });
  M.oak = (() => { const n = makeNoise(8); const c = noiseCanvas(256, 512, (d, w, h) => { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4, g = fbm(n, x / 40, y / 3, 4), r = 0.5 + 0.5 * Math.sin(x / 9 + g * 9); const l = 0.75 + 0.25 * r; d[i] = 176 * l; d[i + 1] = 128 * l; d[i + 2] = 86 * l; d[i + 3] = 255; } });
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return new THREE.MeshStandardMaterial({ map: t, roughness: 0.55 }); })();
  M.chrome = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.06 });
  M.steel = new THREE.MeshStandardMaterial({ color: 0xbfc2c4, metalness: 1, roughness: 0.32 });
  M.black = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.4, metalness: 0.5 });
  M.ceramic = new THREE.MeshPhysicalMaterial({ color: 0xf6f6f3, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 });
  M.glass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.02, transmission: 1, thickness: 0.008, ior: 1.5, metalness: 0, transparent: true, opacity: 1, envMapIntensity: 1.2, side: THREE.DoubleSide });
  M.windowGlass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.0, transmission: 1, thickness: 0.004, transparent: true, side: THREE.DoubleSide });
  M.frame = new THREE.MeshStandardMaterial({ color: 0x2a2b2d, roughness: 0.45, metalness: 0.6 });
  M.sky = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 2.9, 2.7), toneMapped: true });
  M.emit = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xfff0dc, emissiveIntensity: 9 });
  M.tube = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xf4f8ff, emissiveIntensity: 6 });
  M.skirting = new THREE.MeshStandardMaterial({ color: 0xf4f3f0, roughness: 0.4 });
  M.towel = (() => { const n = makeNoise(21), s = 256; const c = noiseCanvas(s, s, d => { for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) { const i = (y * s + x) * 4, a = n(x * 0.9, y * 0.9), b = ((x + y) % 4 < 2) ? 0.1 : -0.1; const v = a + b; d[i] = d[i + 1] = 128 + v * 90; d[i + 2] = 255; d[i + 3] = 255; } });
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 6);
    return new THREE.MeshStandardMaterial({ color: 0xd9cbb6, roughness: 1, normalMap: t, normalScale: new THREE.Vector2(1.2, 1.2) }); })();
  M.rug = (() => { const n = makeNoise(41), w = 512, h = 384; const c = noiseCanvas(w, h, d => { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; const border = (x < 22 || x > w - 23 || y < 22 || y > h - 23) && !(x < 14 || x > w - 15 || y < 14 || y > h - 15);
      const l = 0.85 + 0.25 * fbm(n, x / 30, y / 30) + 0.12 * (n(x * 1.3, y * 1.3) - 0.5); const base = border ? [92, 86, 80] : [196, 186, 170]; d[i] = base[0] * l; d[i + 1] = base[1] * l; d[i + 2] = base[2] * l; d[i + 3] = 255; } });
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const nn = noiseCanvas(256, 256, d => { const R = rand(5); for (let i = 0; i < d.length; i += 4) { d[i] = 128 + (R() - .5) * 120; d[i + 1] = 128 + (R() - .5) * 120; d[i + 2] = 255; d[i + 3] = 255; } });
    const nt = new THREE.CanvasTexture(nn); nt.wrapS = nt.wrapT = THREE.RepeatWrapping; nt.repeat.set(10, 8);
    return new THREE.MeshStandardMaterial({ map: t, roughness: 1, normalMap: nt, normalScale: new THREE.Vector2(0.8, 0.8) }); })();
  M.counter = new THREE.MeshPhysicalMaterial({ color: 0xf3f2ef, roughness: 0.15, clearcoat: 0.6, clearcoatRoughness: 0.1 });
  M.darkwood = new THREE.MeshStandardMaterial({ color: 0x5a4334, roughness: 0.55 });
  M.concrete = plasterMat(0xb9b9b6, 0.95);
}

function box(w, h, d, mat, x, y, z, parent, opts = {}) {
  const g = opts.r ? new RoundedBoxGeometry(w, h, d, 3, opts.r) : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); m.castShadow = opts.cast !== false; m.receiveShadow = true;
  if (opts.ry) m.rotation.y = opts.ry; parent.add(m); return m;
}

// ---------- room shell ----------
let room = null, roomKey = params.get('room') || 'living';
const state = { wallStyle: null, style: null, pattern: 'grid', groutMM: 3, groutHex: '#b9b5ae', rough: null, polished: true };
const ROOMS = {
  living: { name: '客廳＋開放式廚房 4.2×3.6 m', W: 4.2, D: 3.6, H: 2.8, floor: 'ayun1', pattern: 'grid', grout: '#c9c5bd', groutMM: 2, wall: 0xe8e3db,
    cam: [1.55, 1.5, 1.72], target: [-0.7, 0.75, -0.6] },
  bath: { name: '浴室 2.6×2.2×2.4 m', W: 2.6, D: 2.2, H: 2.4, floor: 'nt3202', pattern: 'grid', grout: '#8f8a83', groutMM: 3, wallTile: 'jl3632', wallPattern: 'half',
    cam: [-1.1, 1.45, 0.95], target: [0.25, 0.85, -0.55] },
  garage: { name: '車庫 5.0×4.0 m', W: 5.0, D: 4.0, H: 2.8, floor: 'oak', pattern: 'half', grout: '#6b6863', groutMM: 3, wall: 0xc9c6c0,
    cam: [2.35, 2.0, 1.9], target: [-0.9, 0.5, -1.0] },
};

let floorMesh, floorReflector, wallTileMeshes = [];
function wallWithHoles(len, H, holes, mat, parent) {
  // wall in local XY, centered on x, from y=0..H, faces +z. holes: [{x0,x1,y0,y1}]
  const shape = new THREE.Shape(); shape.moveTo(-len / 2, 0); shape.lineTo(len / 2, 0); shape.lineTo(len / 2, H); shape.lineTo(-len / 2, H); shape.lineTo(-len / 2, 0);
  for (const h of holes) { const p = new THREE.Path(); p.moveTo(h.x0, h.y0); p.lineTo(h.x0, h.y1); p.lineTo(h.x1, h.y1); p.lineTo(h.x1, h.y0); p.lineTo(h.x0, h.y0); shape.holes.push(p); }
  const g = new THREE.ShapeGeometry(shape);
  const uv = g.attributes.uv, pos = g.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + len / 2) / len, pos.getY(i) / H);
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.castShadow = true; parent.add(m);
  // thickness reveal around holes
  for (const h of holes) {
    const t = 0.18, cx = (h.x0 + h.x1) / 2, cy = (h.y0 + h.y1) / 2, w = h.x1 - h.x0, hh = h.y1 - h.y0;
    const rm = mat.clone ? mat : mat;
    const mk = (gw, gh, gd, x, y) => { const b = new THREE.Mesh(new THREE.BoxGeometry(gw, gh, gd), plasterMat(0xeeeeea)); b.position.set(x, y, -t / 2); b.receiveShadow = b.castShadow = true; m.add(b); };
    mk(w, 0.01, t, cx, h.y0 - 0.005); mk(w, 0.01, t, cx, h.y1 + 0.005); mk(0.01, hh, t, h.x0 - 0.005, cy); mk(0.01, hh, t, h.x1 + 0.005, cy);
  }
  return m;
}
function addWindow(parent, x0, x1, y0, y1, depthBack, mull = 1) {
  const w = x1 - x0, h = y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, fz = -0.09;
  const ft = 0.05;
  box(w, ft, 0.07, M.frame, cx, y0 + ft / 2, fz, parent); box(w, ft, 0.07, M.frame, cx, y1 - ft / 2, fz, parent);
  box(ft, h, 0.07, M.frame, x0 + ft / 2, cy, fz, parent); box(ft, h, 0.07, M.frame, x1 - ft / 2, cy, fz, parent);
  for (let i = 1; i <= mull; i++) box(0.04, h, 0.07, M.frame, x0 + w * i / (mull + 1), cy, fz, parent);
  const gl = new THREE.Mesh(new THREE.PlaneGeometry(w, h), M.windowGlass); gl.position.set(cx, cy, fz); parent.add(gl);
  // sill
  box(w + 0.08, 0.025, 0.22, M.counter, cx, y0 - 0.0125, -0.02, parent);
  // bright exterior backdrop (overexposed daylight like in renders)
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(w * 3, h * 3), M.sky); sky.position.set(cx, cy, -depthBack); parent.add(sky);
  // soft area light from window
  const ra = new THREE.RectAreaLight(0xfff6ea, 4.5, w, h); ra.position.set(cx, cy, -0.02); ra.lookAt(cx, cy, 5); parent.add(ra);
}

function makeWalls(R, cfg, group) {
  const { W, D, H } = R;
  const walls = [];
  // each: position, rotation, length, holes
  for (const wdef of cfg) {
    const g = new THREE.Group(); g.position.set(...wdef.pos); g.rotation.y = wdef.ry; group.add(g);
    const mesh = wallWithHoles(wdef.len, H, wdef.holes || [], wdef.mat, g);
    mesh.userData.wdef = wdef; walls.push({ g, mesh, wdef });
    (wdef.windows || []).forEach(h => addWindow(g, h.x0, h.x1, h.y0, h.y1, 1.2, h.mull ?? 1));
    if (wdef.skirting) box(wdef.len, 0.08, 0.012, M.skirting, 0, 0.04, 0.006, g, { cast: false });
  }
  // ceiling
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), plasterMat(0xf4f3f0)); ceil.rotation.x = Math.PI / 2; ceil.position.y = H; ceil.receiveShadow = true; group.add(ceil);
  return walls;
}

function downlight(group, x, z, H, intensity = 6, shadow = false) {
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.01, 32), M.white); ring.position.set(x, H - 0.004, z); group.add(ring);
  const disk = new THREE.Mesh(new THREE.CircleGeometry(0.04, 32), M.emit); disk.rotation.x = Math.PI / 2; disk.position.set(x, H - 0.0095, z); group.add(disk);
  const s = new THREE.SpotLight(0xffe6cc, intensity * 1.3, 0, Math.PI / 3.2, 0.85, 2); s.position.set(x, H - 0.03, z); s.target.position.set(x, 0, z);
  s.castShadow = shadow; if (shadow) { s.shadow.mapSize.set(1024, 1024); s.shadow.bias = -0.0004; s.shadow.radius = 4; s.shadow.camera.near = 0.1; }
  group.add(s, s.target);
}

async function place(group, name, o = {}) {
  const src = await loadModel(name); const m = src.clone(true);
  const wrap = new THREE.Group(); wrap.add(m);
  m.rotation.set(o.rx || 0, o.ry || 0, 0, 'YXZ'); m.updateMatrixWorld(true);
  let bb = new THREE.Box3().setFromObject(m); const sz = bb.getSize(new THREE.Vector3());
  let s = o.s || 1;
  if (o.fitH) s = o.fitH / sz.y; if (o.fitW) s = o.fitW / Math.max(sz.x, sz.z);
  m.scale.setScalar(s); m.updateMatrixWorld(true); bb = new THREE.Box3().setFromObject(m);
  const c = bb.getCenter(new THREE.Vector3());
  m.position.set(-c.x, -bb.min.y, -c.z);
  wrap.position.set(o.x || 0, o.y || 0, o.z || 0); group.add(wrap);
  wrap.userData.size = bb.getSize(new THREE.Vector3());
  return wrap;
}

function buildFloor(group, R) {
  const mat = tileMaterial(state.style, true);
  floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(R.W, R.D), mat); floorMesh.rotation.x = -Math.PI / 2; floorMesh.receiveShadow = true; group.add(floorMesh);
  if (quality === 'high') {
    floorReflector = new Reflector(new THREE.PlaneGeometry(R.W, R.D), { textureWidth: Math.round(innerWidth * 0.6), textureHeight: Math.round(innerHeight * 0.6), clipBias: 0.003 });
    floorReflector.rotation.x = -Math.PI / 2; floorReflector.position.y = 0.0005; floorReflector.renderOrder = -10;
    floorReflector.material.colorWrite = false; floorReflector.material.depthWrite = false;
    let lastFrame = -1; const orig = floorReflector.onBeforeRender;
    floorReflector.onBeforeRender = function (r, s, c) { if (lastFrame === frameNo || c !== camera) return; lastFrame = frameNo; orig.call(this, r, s, c); };
    group.add(floorReflector);
    const inv = new THREE.Matrix4();
    floorMesh.onBeforeRender = () => { floorReflector.updateMatrixWorld(); inv.copy(floorReflector.matrixWorld).invert(); mat.userData.u.reflMat.value.multiplyMatrices(floorReflector.material.uniforms.textureMatrix.value, inv); };
    mat.userData.u.tReflect.value = floorReflector.getRenderTarget().texture;
  } else floorReflector = null;
  applyFloor();
}
function applyFloor() {
  const R = ROOMS[roomKey]; const st = STYLES[state.style];
  const t = bakeTiles(R.W, R.D, state.style, state.pattern, state.groutMM, state.groutHex, 1);
  const m = floorMesh.material; setBaked(m, t);
  m.roughness = state.rough ?? st.rough;
  m.clearcoat = state.polished && m.roughness < 0.3 ? 0.6 : 0; m.clearcoatRoughness = 0.08;
  m.userData.u.uRefl.value = (floorReflector && state.polished) ? 1.0 : 0.0;
  m.normalScale.set(1, 1); { const sig = (m.clearcoat > 0) + '|' + m.userData.u.uRefl.value; if (m.userData.sig !== sig) { m.userData.sig = sig; m.needsUpdate = true; } }
  for (const wm of wallTileMeshes) {
    const wd = wm.userData.wdef; const tt = bakeTiles(wd.len, R.H, state.wallStyle, R.wallPattern, state.groutMM, '#d9d6d0', wd.seed);
    const mm = wm.material; setBaked(mm, tt); if (!mm.userData.sig) { mm.userData.sig = 1; mm.needsUpdate = true; }
  }
  // perf: tile textures don't affect the depth-only shadow maps
}

let sun;
async function buildRoom(key) {
  roomKey = key; const R = ROOMS[key];
  if (room) { scene.remove(room); room.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.userData && o.material.userData.bk) setBaked(o.material, null); }); }
  room = new THREE.Group(); scene.add(room); wallTileMeshes = [];
  state.wallStyle = R.wallTile || null; state.style = R.floor; state.pattern = R.pattern; state.groutHex = R.grout; state.groutMM = R.groutMM; state.rough = null; state.polished = !!STYLES[R.floor].polished;
  syncUI();
  const { W, D, H } = R;
  const wm = () => plasterMat(R.wall || 0xeeeeee);
  let wallCfg;
  if (key === 'living') wallCfg = [
    { pos: [0, 0, -D / 2], ry: 0, len: W, mat: wm(), holes: [{ x0: -1.75, x1: 0.35, y0: 0.45, y1: 2.45 }], windows: [{ x0: -1.75, x1: 0.35, y0: 0.45, y1: 2.45, mull: 1 }], skirting: true },
    { pos: [0, 0, D / 2], ry: Math.PI, len: W, mat: wm(), skirting: true },
    { pos: [-W / 2, 0, 0], ry: Math.PI / 2, len: D, mat: wm(), skirting: true },
    { pos: [W / 2, 0, 0], ry: -Math.PI / 2, len: D, mat: wm(), skirting: true }];
  else if (key === 'garage') wallCfg = [
    { pos: [0, 0, -D / 2], ry: 0, len: W, mat: wm(), holes: [{ x0: 0.9, x1: 2.1, y0: 1.5, y1: 2.4 }], windows: [{ x0: 0.9, x1: 2.1, y0: 1.5, y1: 2.4, mull: 1 }] },
    { pos: [0, 0, D / 2], ry: Math.PI, len: W, mat: wm() },
    { pos: [-W / 2, 0, 0], ry: Math.PI / 2, len: D, mat: wm() },
    { pos: [W / 2, 0, 0], ry: -Math.PI / 2, len: D, mat: wm() }];
  else wallCfg = [
    { pos: [0, 0, -D / 2], ry: 0, len: W, seed: 2 },
    { pos: [0, 0, D / 2], ry: Math.PI, len: W, seed: 3 },
    { pos: [-W / 2, 0, 0], ry: Math.PI / 2, len: D, seed: 4, holes: [{ x0: -0.75, x1: -0.05, y0: 1.7, y1: 2.15 }], windows: [{ x0: -0.75, x1: -0.05, y0: 1.7, y1: 2.15, mull: 0 }] },
    { pos: [W / 2, 0, 0], ry: -Math.PI / 2, len: D, seed: 5 }].map(w => ({ ...w, mat: (() => { const m = tileMaterial('wall3060', false); m.shadowSide = THREE.DoubleSide; return m; })() }));
  const walls = makeWalls(R, wallCfg, room);
  if (key === 'bath') walls.forEach(w => wallTileMeshes.push(w.mesh));
  buildFloor(room, R);

  // sun through window
  sun = new THREE.DirectionalLight(0xfff0dc, key === 'bath' ? 2.0 : 3.2);
  const sp = key === 'bath' ? [-6, 6, -1.5] : key === 'garage' ? [3.5, 5.5, -7] : [-2.5, 4.5, -7];
  sun.position.set(...sp); sun.target.position.set(0, 0, 0);
  sun.castShadow = true; const ms = quality === 'high' ? 2048 : 1024; sun.shadow.mapSize.set(ms, ms);
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 20 }); sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.02; sun.shadow.radius = 3;
  room.add(sun, sun.target);
  room.add(new THREE.HemisphereLight(0xfff6ec, 0x857766, 0.18));

  const jobs = [];
  if (key === 'living') {
    [[-1.2, -0.9], [-1.2, 0.9], [0.9, -0.9], [0.9, 0.9]].forEach(([x, z], i) => downlight(room, x, z, H, 5, i === 1));
    // rug
    box(2.1, 0.012, 1.55, M.rug, -1.0, 0.006, 0, room, { cast: false });
    jobs.push(place(room, 'sofa_02', { x: -2.1 + 0.48, z: 0, ry: Math.PI / 2, fitW: 2.2 }));
    jobs.push(place(room, 'throw_pillows_01', { x: -1.75, z: -0.65, y: 0.42, ry: Math.PI / 2, s: 0.75 }));
    jobs.push(place(room, 'modern_coffee_table_01', { x: -0.75, z: 0 }));
    jobs.push(place(room, 'side_table_01', { x: -1.83, z: 1.4 }).then(st => place(room, 'ceramic_vase_01', { x: -1.83, z: 1.4, y: st.userData.size.y })));
    jobs.push(place(room, 'potted_plant_02', { x: -1.8, z: -1.45, fitH: 1.1 }));
    jobs.push(place(room, 'round_wooden_table_01', { x: 0.6, z: -0.75, fitW: 0.95 }));
    jobs.push(place(room, 'dining_chair_02', { x: 0.6, z: -0.05, ry: Math.PI }));
    jobs.push(place(room, 'dining_chair_02', { x: 0.6, z: -1.45, ry: 0 }));
    jobs.push(place(room, 'potted_plant_04', { x: 1.75, z: 1.5, fitH: 0.9 }));
    // open kitchen along right wall
    const k = new THREE.Group(); room.add(k); const kx = W / 2 - 0.3, z0 = -D / 2, z1 = 0.15, len = z1 - z0, kz = (z0 + z1) / 2;
    box(0.56, 0.1, len, M.black, kx + 0.02, 0.05, kz, k); // plinth
    const nDoors = 4; for (let i = 0; i < nDoors; i++) { const dz = z0 + len * (i + 0.5) / nDoors; box(0.02, 0.74, len / nDoors - 0.004, M.cabinet, kx - 0.29, 0.1 + 0.37, dz, k, { r: 0.004 }); box(0.012, 0.012, 0.28, M.steel, kx - 0.305, 0.78, dz, k); }
    box(0.58, 0.74, len, M.cabinet, kx, 0.47, kz, k);
    box(0.62, 0.03, len + 0.01, M.counter, kx - 0.01, 0.855, kz, k);
    // sink + faucet
    box(0.42, 0.005, 0.5, M.steel, kx - 0.02, 0.872, kz - 0.25, k, { cast: false });
    const fau = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.3, 0), new THREE.Vector3(-0.08, 0.36, 0), new THREE.Vector3(-0.18, 0.3, 0)]), 32, 0.012, 12), M.chrome);
    fau.position.set(kx + 0.2, 0.87, kz - 0.25); fau.castShadow = true; k.add(fau);
    // cooktop
    box(0.5, 0.006, 0.56, new THREE.MeshPhysicalMaterial({ color: 0x0a0a0a, roughness: 0.05, clearcoat: 1 }), kx - 0.02, 0.873, kz + 0.45, k, { cast: false });
    // upper cabinets
    for (let i = 0; i < 3; i++) { const dz = z0 + 0.05 + (len - 0.6) * (i + 0.5) / 3; box(0.35, 0.7, (len - 0.6) / 3 - 0.004, M.cabinet, W / 2 - 0.175, 1.85, dz, k, { r: 0.004 }); }
    box(0.4, 0.12, 0.6, M.steel, W / 2 - 0.2, 1.62, kz + 0.45, k);
    // backsplash
    box(0.012, 0.6, len, M.counter, W / 2 - 0.006, 1.17, kz, k, { cast: false });
    // tall fridge column
    box(0.62, 2.2, 0.7, M.cabinet, kx - 0.01, 1.1, z1 + 0.37, k, { r: 0.004 });
    box(0.015, 0.9, 0.015, M.steel, kx - 0.33, 1.2, z1 + 0.06, k);
  } else if (key === 'bath') {
    downlight(room, -0.5, -0.2, H, 4, true); downlight(room, 0.95, -0.2, H, 3);
    // vanity
    const vx = -0.65, vz = -D / 2 + 0.25;
    box(0.82, 0.5, 0.48, M.oak, vx, 0.55, vz, room, { r: 0.01 });
    box(0.84, 0.03, 0.5, M.counter, vx, 0.815, vz + 0.005, room, { r: 0.005 });
    box(0.3, 0.012, 0.012, M.steel, vx, 0.72, vz + 0.245, room);
    const bowl = new THREE.Mesh(new THREE.LatheGeometry([[0, 0.0], [0.1, 0.0], [0.17, 0.03], [0.2, 0.12], [0.195, 0.125], [0.165, 0.035], [0.0, 0.012]].map(p => new THREE.Vector2(...p)), 48), M.ceramic);
    bowl.position.set(vx, 0.83, vz + 0.03); bowl.castShadow = bowl.receiveShadow = true; room.add(bowl);
    const fau = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.25, 0), new THREE.Vector3(0, 0.3, 0.05), new THREE.Vector3(0, 0.26, 0.15)]), 32, 0.011, 12), M.chrome);
    fau.position.set(vx, 0.83, vz - 0.19); fau.castShadow = true; room.add(fau);
    // mirror
    const mw = 0.7, mh = 0.85, my = 1.5;
    if (quality === 'high') { const mir = new Reflector(new THREE.PlaneGeometry(mw, mh), { textureWidth: 768, textureHeight: 768, color: 0xb8bcbe, clipBias: 0.003 }); mir.position.set(vx, my, -D / 2 + 0.012); room.add(mir); }
    else { const mir = new THREE.Mesh(new THREE.PlaneGeometry(mw, mh), new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.02 })); mir.position.set(vx, my, -D / 2 + 0.012); room.add(mir); }
    box(mw + 0.02, mh + 0.02, 0.01, M.frame, vx, my, -D / 2 + 0.005, room);
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(mw - 0.1, 0.02), M.emit); strip.position.set(vx, my + mh / 2 - 0.03, -D / 2 + 0.013); room.add(strip);
    // toilet
    const tx = 0.18, tz = -D / 2;
    const ped = new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [0.13, 0], [0.12, 0.1], [0.1, 0.25], [0.0, 0.25]].map(p => new THREE.Vector2(...p)), 40), M.ceramic);
    ped.scale.set(1, 1, 1.3); ped.position.set(tx, 0, tz + 0.42); room.add(ped);
    const bw = new THREE.Mesh(new THREE.LatheGeometry([[0.0, 0.22], [0.1, 0.22], [0.17, 0.27], [0.19, 0.36], [0.19, 0.39], [0.17, 0.39], [0.15, 0.32], [0.05, 0.28], [0.0, 0.28]].map(p => new THREE.Vector2(...p)), 48), M.ceramic);
    bw.scale.set(1, 1, 1.3); bw.position.set(tx, 0, tz + 0.45); room.add(bw);
    const seat = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.022, 16, 48), M.ceramic); seat.rotation.x = Math.PI / 2; seat.scale.set(1, 1.3, 0.6); seat.position.set(tx, 0.405, tz + 0.45); room.add(seat);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 48), M.ceramic); lid.scale.set(1, 1, 1.3); lid.position.set(tx, 0.425, tz + 0.45); room.add(lid);
    box(0.38, 0.36, 0.16, M.ceramic, tx, 0.6, tz + 0.1, room, { r: 0.03 });
    box(0.06, 0.01, 0.03, M.chrome, tx, 0.785, tz + 0.1, room);
    [ped, bw, seat, lid].forEach(m => { m.castShadow = m.receiveShadow = true; });
    // shower glass screen + fittings
    const gx = 0.62;
    const gl = new THREE.Mesh(new THREE.BoxGeometry(0.008, 2.0, 1.1), M.glass); gl.position.set(gx, 1.0, -D / 2 + 0.55); room.add(gl);
    box(0.02, 2.0, 0.02, M.chrome, gx, 1.0, -D / 2 + 0.01, room); box(0.02, 0.02, 1.1, M.chrome, gx, 2.0, -D / 2 + 0.55, room);
    box(0.02, 0.02, 0.6, M.chrome, gx + 0.34, 2.0, 0.0, room, { ry: Math.PI / 2 });
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.012, 48), M.chrome); head.position.set(1.0, 2.05, -0.55); room.add(head);
    box(0.02, 0.02, 0.3, M.chrome, 1.0, 2.15, -0.55, room, { ry: Math.PI / 2 }); box(0.02, 0.1, 0.02, M.chrome, 1.0, 2.1, -0.55, room);
    const mixer = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 32), M.chrome); mixer.rotation.z = Math.PI / 2; mixer.position.set(W / 2 - 0.025, 1.1, -0.55); room.add(mixer);
    box(0.08, 0.004, 0.6, M.steel, 1.05, 0.002, 0.2, room, { cast: false }); // linear drain
    // towel rail + towel on left wall
    box(0.02, 0.02, 0.6, M.chrome, -W / 2 + 0.07, 1.25, 0.45, room);
    [0.17, 0.73].forEach(z => box(0.07, 0.02, 0.02, M.chrome, -W / 2 + 0.035, 1.25, z, room));
    const towelG = new RoundedBoxGeometry(0.06, 0.62, 0.5, 4, 0.02); const tp = towelG.attributes.position;
    for (let i = 0; i < tp.count; i++) { const y = tp.getY(i), z = tp.getZ(i); tp.setX(i, tp.getX(i) + 0.008 * Math.sin(z * 30) + (0.31 - y) * 0.02); }
    towelG.computeVertexNormals(); const towel = new THREE.Mesh(towelG, M.towel); towel.position.set(-W / 2 + 0.075, 0.95, 0.45); towel.castShadow = towel.receiveShadow = true; room.add(towel);
    jobs.push(place(room, 'potted_plant_04', { x: -0.95, z: -D / 2 + 0.3, y: 0.83, fitH: 0.3 }));
  } else {
    // garage: fluorescent tubes
    [-1, 1].forEach(x => { box(1.25, 0.04, 0.08, M.white, x, H - 0.02, 0, room, { cast: false }); box(1.2, 0.025, 0.04, M.tube, x, H - 0.055, 0, room, { cast: false });
      const ra = new THREE.RectAreaLight(0xf2f6ff, 9, 1.2, 0.15); ra.position.set(x, H - 0.07, 0); ra.lookAt(x, 0, 0); room.add(ra); });
    downlight(room, 0, 0.3, H, 6, true);
    jobs.push(place(room, 'covered_car', { x: -0.35, z: 0.45, ry: Math.PI / 2 }));
    jobs.push(place(room, 'steel_frame_shelves_01', { x: -1.3, z: -D / 2 + 0.3, fitH: 1.9 }).then(async sh => {
      sh.updateMatrixWorld(true); const sz = sh.userData.size, rc = new THREE.Raycaster(), levels = [];
      for (const dx of [-0.25, 0.0, 0.25]) { rc.set(new THREE.Vector3(-1.3 + dx * sz.x, 3, -D / 2 + 0.3), new THREE.Vector3(0, -1, 0));
        for (const h of rc.intersectObject(sh, true)) if (!levels.some(l => Math.abs(l - h.point.y) < 0.08)) levels.push(h.point.y); }
      levels.sort((a, b) => a - b);
      const items = [['cardboard_box_01', 0.75, Math.PI / 2], ['metal_toolbox', 1, 0], ['multi_cleaner_5_litre', 1, 0.3], ['spray_paint_bottles', 1, 0], ['cleaner_tin_01', 1, 0], ['cardboard_box_01', 0.7, Math.PI / 2 + 0.1], ['plastic_jerrycan', 0.8, 0.2], ['metal_toolbox', 1, 0.1]];
      let k = 0; const xs = [-1.3 - sz.x * 0.27, -1.3 + sz.x * 0.22];
      for (const ly of levels.filter(l => l < 1.8)) for (const x of xs) { const [nm, sc, ry] = items[k++ % items.length]; await place(room, nm, { x, z: -D / 2 + 0.3, y: ly + 0.003, s: sc, ry }); }
      await place(room, 'cardboard_box_01', { x: -0.3, z: -D / 2 + 0.3, ry: 0.3 });
      await place(room, 'cardboard_box_01', { x: -0.3, z: -D / 2 + 0.3, y: 0.34, ry: -0.2, s: 0.85 }); }));
    jobs.push(place(room, 'metal_tool_chest', { x: 1.95, z: -D / 2 + 0.3, s: 1.3 }));
    jobs.push(place(room, 'plastic_jerrycan', { x: 1.35, z: -D / 2 + 0.25 }));
    for (let i = 0; i < 3; i++) jobs.push(place(room, 'old_tyre', { x: -2.05, z: 1.4, y: i * 0.165, rx: Math.PI / 2, ry: i * 0.7 }));
    // painted parking lines / wall bumper
    box(0.6, 0.15, 0.03, new THREE.MeshStandardMaterial({ color: 0xd1a12a, roughness: 0.6 }), 0.1, 0.5, -D / 2 + 0.015, room);
  }
  await Promise.all(jobs);
  // tyres lie flat: rotate whole tyre wrapper
  room.traverse(o => { if (o.isMesh && o.material && o.material.isMeshStandardMaterial) o.material.envMapIntensity = o.material.envMapIntensity ?? 1; });
  $('roomName').textContent = R.name;
  resetView();
  renderer.shadowMap.needsUpdate = true;
}

function resetView() { const R = ROOMS[roomKey]; camera.position.set(...R.cam); controls.target.set(...R.target); controls.maxDistance = Math.max(R.W, R.D) * 1.6; camera.fov = camera.aspect < 1 ? 80 : 58; camera.updateProjectionMatrix(); controls.update(); }
function topView() { const R = ROOMS[roomKey]; controls.target.set(0, 0, 0); camera.position.set(0, R.H * 2.4 + Math.max(R.W, R.D), 0.01); camera.fov = 45; camera.updateProjectionMatrix(); controls.update(); }

// ---------- UI ----------
function syncUI() {
  const sel = $('style'); sel.value = state.style; $('pattern').value = state.pattern;
  $('groutC').value = state.groutHex; $('groutW').value = state.groutMM; $('groutWv').textContent = state.groutMM + ' mm';
  const r = state.rough ?? STYLES[state.style].rough; $('rough').value = r; $('roughV').textContent = (+r).toFixed(2);
  $('polished').checked = state.polished;
  document.querySelectorAll('.roomBtn').forEach(b => b.classList.toggle('on', b.dataset.room === roomKey));
  $('quality').value = quality;
  $('wallRow').style.display = state.wallStyle ? '' : 'none'; if (state.wallStyle) $('wallStyle').value = state.wallStyle;
}
function initUI() {
  const sel = $('style');
  const groups = [['PDF 郭怡華案（實際磁磚照片）', k => STYLES[k].kind === 'photo'], ['通用材質', k => STYLES[k].kind !== 'photo']];
  for (const target of [sel, $('wallStyle')]) for (const [label, f] of groups) { const og = document.createElement('optgroup'); og.label = label;
    for (const [k, v] of Object.entries(STYLES)) if (f(k)) { const o = document.createElement('option'); o.value = k; o.textContent = v.name + (v.page ? `（PDF p.${v.page}）` : ''); og.appendChild(o); } target.appendChild(og); }
  $('wallStyle').onchange = e => { state.wallStyle = e.target.value; applyFloor(); };
  $('toggle').onclick = () => $('panel').classList.toggle('collapsed');
  if (isMobile || params.has('shot')) $('panel').classList.add('collapsed');
  document.querySelectorAll('.roomBtn').forEach(b => b.onclick = () => buildRoom(b.dataset.room));
  sel.onchange = () => { state.style = sel.value; state.rough = null; state.polished = !!STYLES[sel.value].polished; syncUI(); applyFloor(); };
  $('pattern').onchange = e => { state.pattern = e.target.value; applyFloor(); };
  $('groutC').onchange = e => { state.groutHex = e.target.value; applyFloor(); };
  $('groutW').oninput = e => { $('groutWv').textContent = e.target.value + ' mm'; };
  $('groutW').onchange = e => { state.groutMM = +e.target.value; applyFloor(); };
  $('rough').oninput = e => { state.rough = +e.target.value; $('roughV').textContent = state.rough.toFixed(2); floorMesh.material.roughness = state.rough; floorMesh.material.clearcoat = state.polished && state.rough < 0.3 ? 0.6 : 0; };
  $('polished').onchange = e => { state.polished = e.target.checked; applyFloor(); };
  $('top').onclick = topView; $('reset').onclick = resetView;
  $('quality').onchange = e => { const u = new URL(location.href); u.searchParams.set('q', e.target.value); u.searchParams.set('room', roomKey); location.href = u.toString(); };
}

let frameNo = 0;
function animate() {
  requestAnimationFrame(animate); frameNo++;
  controls.update();
  composer.render();
}
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; if (camera.fov !== 45) camera.fov = camera.aspect < 1 ? 80 : 58; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); });

(async function main() {
  try {
    totalCount = 0;
    initMaterials(); setupPipeline();
    const [hdrBuf, presets] = await Promise.all([fetchB64('lebombo_1k.hdr'), Promise.all(['tiles_w1', 'tiles_w2'].map(n => fetch('assets/' + n + '.json?v=' + VER).then(r => r.json()))).then(([p, q]) => ({ ...p, ...q }))]);
    const photoStyles = {};
    await Promise.all(Object.entries(presets).map(async ([k, p]) => {
      const imgs = await Promise.all(p.data.map(async u => { const im = new Image(); im.src = u; await im.decode(); return im; }));
      photoStyles[k] = { name: p.name, page: p.page, size: p.size, rough: p.rough, slip: p.slip, kind: 'photo', polished: p.polished, bump: p.bump, imgs };
    }));
    for (const k of Object.keys(STYLES)) { const v = STYLES[k]; delete STYLES[k]; photoStyles[k] = v; }
    Object.assign(STYLES, photoStyles);
    initUI();
    const hdr = new RGBELoader().parse(hdrBuf); const tex = new THREE.DataTexture(hdr.data, hdr.width, hdr.height, THREE.RGBAFormat, hdr.type);
    tex.colorSpace = THREE.LinearSRGBColorSpace; tex.mapping = THREE.EquirectangularReflectionMapping; tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.needsUpdate = true; tex.flipY = true;
    const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromEquirectangular(tex).texture; scene.environmentIntensity = 0.45;
    await buildRoom(roomKey);
    $('loading').style.display = 'none';
    window.__ready = true;
    animate();
  } catch (e) { console.error(e); $('loadtxt').textContent = '載入失敗：' + e.message; }
})();
window.__api = { camera, controls,  buildRoom, topView, resetView, state, applyFloor };
