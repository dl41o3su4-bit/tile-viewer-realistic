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
  const r = await fetch(`../assets/${path}.b64?v=${VER}`);
  if (!r.ok) throw new Error('fetch ' + path + ' ' + r.status);
  const s = (await r.text()).replace(/\s+/g, '');
  const bin = atob(s); const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  loadedCount++; progress();
  return u8.buffer;
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
    const c = document.createElement('canvas'); c.width = pw; c.height = ph; const ctx = c.getContext('2d');
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

function bakeTiles(W, H, styleKey, pattern, groutMM, groutHex, seed = 1) {
  const st = STYLES[styleKey];
  let ppm = quality === 'high' ? 600 : 340; ppm = Math.min(ppm, 4096 / Math.max(W, H));
  const cw = Math.round(W * ppm), ch = Math.round(H * ppm);
  const [tw, th] = st.size; const g = groutMM / 1000 * ppm;
  const pw = Math.round(tw * ppm), ph = Math.round(th * ppm);
  const vars = getVariants(styleKey, pw, ph);
  const albedo = document.createElement('canvas'); albedo.width = cw; albedo.height = ch;
  const actx = albedo.getContext('2d'); actx.fillStyle = groutHex; actx.fillRect(0, 0, cw, ch);
  const hc = document.createElement('canvas'); hc.width = cw; hc.height = ch; const hctx = hc.getContext('2d');
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
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const i = y * cw + x, j = i * 4;
    let h = Hh[i];
    const hx = Hh[y * cw + Math.min(cw - 1, x + 1)] - Hh[y * cw + Math.max(0, x - 1)];
    const hy = Hh[Math.max(0, y - 1) * cw + x] - Hh[Math.min(ch - 1, y + 1) * cw + x];
    let nx = -hx * depth, ny = -hy * depth;
    if (bump && h > 0.9) { nx -= (Lum[y * cw + Math.min(cw - 1, x + 1)] - Lum[y * cw + Math.max(0, x - 1)]) * bump * 2.0; ny -= (Lum[Math.max(0, y - 1) * cw + x] - Lum[Math.min(ch - 1, y + 1) * cw + x]) * bump * 2.0; }
    if (slip && h > 0.9) { const mx = x / ppm * 300, my = y / ppm * 300; nx += (n(mx, my) - n(mx + 1, my)) * 0.6; ny += (n(mx, my) - n(mx, my + 1)) * 0.6; }
    const l = Math.hypot(nx, ny, 1);
    Nd[j] = (nx / l * 0.5 + 0.5) * 255; Nd[j + 1] = (ny / l * 0.5 + 0.5) * 255; Nd[j + 2] = (1 / l * 0.5 + 0.5) * 255; Nd[j + 3] = 255;
    const groutMask = 1 - Math.min(1, h * 1.05);
    const ao = 0.62 + 0.38 * Math.min(1, h * 1.3);
    A[j] *= ao; A[j + 1] *= ao; A[j + 2] *= ao;
    Rd[j] = 255; Rd[j + 1] = groutMask * 255; Rd[j + 2] = hd[j + 1]; Rd[j + 3] = 255;
  }
  actx.putImageData(ad, 0, 0);
  const nc = document.createElement('canvas'); nc.width = cw; nc.height = ch; nc.getContext('2d').putImageData(N, 0, 0);
  const rc = document.createElement('canvas'); rc.width = cw; rc.height = ch; rc.getContext('2d').putImageData(Rr, 0, 0);
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


// ======================= 謝雲卿案 下營598-3 1F =======================
// plan units: cm. x: grid①=0 → grid②=460 (left→right, looking from street). z: grid Ⓐ(rear)=0, Ⓑ=620, Ⓒ=950, front line ≈1160.
const W = x => (x - 230) / 100, Zw = z => (z - 500) / 100; // local coords inside `house`
// v3: the house group is mirrored in X so that, seen from the street, grid ① is on the RIGHT and ② on the LEFT — exactly as p.3 is drawn (① left on paper with Ⓐ at the bottom).
const WX = x => (230 - x) / 100; // world x of a plan x
const house = new THREE.Group(); house.scale.x = -1; scene.add(house);
const ceilings = new THREE.Group(); house.add(ceilings);
const colliders = []; // {x0,x1,z0,z1} world
const zones = {}; // key -> {style, pattern, groutMM, groutHex, meshes:[{mesh,w,d,seed}]}
const ZONES = {
  park:   { label: '停車空間 F1（30×60 止滑石英磚）', style: 'oak', pattern: 'half', groutMM: 3, groutHex: '#6b6863' },
  living: { label: '客廳／廚房 F1（30×60 止滑石英磚）', style: 'jl3682', pattern: 'half', groutMM: 2, groutHex: '#a9a49c' },
  bath:   { label: '浴廁 F2（30×60 止滑石英磚）', style: 'jl3662', pattern: 'grid', groutMM: 2, groutHex: '#8f8a83' },
  bathwall: { label: '浴廁壁 W2（30×60 石英磚）', style: 'jl3632', pattern: 'half', groutMM: 2, groutHex: '#d9d6d0' },
  stair:  { label: '樓梯 F3（20×20，踏階 20×26）', style: 'nt3201_20', pattern: 'grid', groutMM: 2, groutHex: '#9a958e' },
  yard:   { label: '後院（PDF 未列，暫用 歐克石灰）', style: 'oak', pattern: 'grid', groutMM: 3, groutHex: '#6b6863' },
  terrace: { label: '3F 露臺 F2（30×60 止滑石英磚）', style: 'jl3662', pattern: 'grid', groutMM: 3, groutHex: '#8f8a83' },
  room2:  { label: '2F／3F 室內 F1（30×60 石英磚）', style: 'jl3682', pattern: 'half', groutMM: 2, groutHex: '#a9a49c' },
  bath2:  { label: '2F／3F 浴廁 F2（30×60 止滑石英磚）', style: 'jl3662', pattern: 'grid', groutMM: 2, groutHex: '#8f8a83' },
  bath2wall: { label: '2F／3F 浴廁壁 W2（30×60 石英磚）', style: 'jl3632', pattern: 'half', groutMM: 2, groutHex: '#d9d6d0' },
  balcony: { label: '2F 陽台 F2（30×60 止滑石英磚）', style: 'jl3662', pattern: 'grid', groutMM: 3, groutHex: '#8f8a83' },
};
for (const k in ZONES) zones[k] = { ...ZONES[k], meshes: [] };

function addCollider(x0, x1, z0, z1, y0 = -1, y1 = 20) { colliders.push({ x0: WX(Math.max(x0, x1)), x1: WX(Math.min(x0, x1)), z0: Zw(Math.min(z0, z1)), z1: Zw(Math.max(z0, z1)), y0, y1 }); }
function bx(x0, x1, y0, y1, z0, z1, mat, opts = {}) { // cm in plan, y in m
  const w = Math.abs(x1 - x0) / 100, d = Math.abs(z1 - z0) / 100, h = y1 - y0;
  const m = new THREE.Mesh(opts.r ? new RoundedBoxGeometry(w, h, d, 2, opts.r) : new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(W((x0 + x1) / 2), (y0 + y1) / 2, Zw((z0 + z1) / 2)); m.castShadow = opts.cast !== false; m.receiveShadow = true;
  (opts.parent || house).add(m); if (opts.collide) addCollider(x0, x1, z0, z1, y0, y1); return m;
}
// wall along X at plan z (thickness t), openings [{a,b,sill,head}] in plan x cm, heights m
function wallX(z, x0, x1, t, H, mat, ops = [], y0 = 0) {
  let cur = x0; ops = [...ops].sort((p, q) => p.a - q.a);
  for (const o of ops) { if (o.a > cur) bx(cur, o.a, y0, H, z - t / 2, z + t / 2, mat, { collide: true });
    if (o.sill > y0) bx(o.a, o.b, y0, o.sill, z - t / 2, z + t / 2, mat, { collide: o.sill > 0.5 });
    if (o.head < H) bx(o.a, o.b, o.head, H, z - t / 2, z + t / 2, mat); if (o.sill > 0.3) addCollider(o.a, o.b, z - t / 2, z + t / 2, y0, o.sill); cur = o.b; }
  if (cur < x1) bx(cur, x1, y0, H, z - t / 2, z + t / 2, mat, { collide: true });
}
function wallZ(x, z0, z1, t, H, mat, ops = [], y0 = 0) {
  let cur = z0; ops = [...ops].sort((p, q) => p.a - q.a);
  for (const o of ops) { if (o.a > cur) bx(x - t / 2, x + t / 2, y0, H, cur, o.a, mat, { collide: true });
    if (o.sill > y0) bx(x - t / 2, x + t / 2, y0, o.sill, o.a, o.b, mat);
    if (o.head < H) bx(x - t / 2, x + t / 2, o.head, H, o.a, o.b, mat); if (o.sill > 0.3) addCollider(x - t / 2, x + t / 2, o.a, o.b, y0, o.sill); cur = o.b; }
  if (cur < z1) bx(x - t / 2, x + t / 2, y0, H, cur, z1, mat, { collide: true });
}
function windowAlongX(z, a, b, sill, head, t) { // frame + glass in an X wall opening
  const cx = (a + b) / 2;
  bx(a, b, sill, sill + 0.05, z - 3, z + 3, M.frame); bx(a, b, head - 0.05, head, z - 3, z + 3, M.frame);
  bx(a, a + 5, sill, head, z - 3, z + 3, M.frame); bx(b - 5, b, sill, head, z - 3, z + 3, M.frame); bx(cx - 2, cx + 2, sill, head, z - 3, z + 3, M.frame);
  const g = new THREE.Mesh(new THREE.PlaneGeometry((b - a) / 100, head - sill), M.windowGlass); g.position.set(W(cx), (sill + head) / 2, Zw(z)); house.add(g);
}
function doorPanel(alongX, c, a, b, h, openAng, mat) { // simple leaf, hinged at a
  const len = (b - a) / 100, leaf = new THREE.Mesh(new THREE.BoxGeometry(len, h, 0.04), mat); leaf.castShadow = true;
  const piv = new THREE.Group(); piv.add(leaf); leaf.position.x = len / 2; leaf.position.y = h / 2;
  if (alongX) { piv.position.set(W(a), 0, Zw(c)); } else { piv.position.set(W(c), 0, Zw(a)); piv.rotation.y = -Math.PI / 2; }
  piv.rotation.y += openAng; house.add(piv);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 8), M.chrome); knob.position.set(len - 0.07, 1.0, 0.04); leaf.add(knob); knob.position.y = 1.0 - h / 2;
}
function floorRect(zone, x0, x1, z0, z1, y, seed = 1) {
  const w = (x1 - x0) / 100, d = (z1 - z0) / 100;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), tileMaterial(zones[zone].style, false));
  mesh.rotation.x = -Math.PI / 2; mesh.position.set(W((x0 + x1) / 2), y, Zw((z0 + z1) / 2)); mesh.receiveShadow = true; house.add(mesh);
  zones[zone].meshes.push({ mesh, w, d, seed }); return mesh;
}
function tilePanel(zone, cx, cz, len, h, ry, y0 = 0, seed = 1) { // vertical tiled panel, plan cm, faces local +z rotated by ry
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(len / 100, h), tileMaterial(zones[zone].style, false));
  mesh.position.set(W(cx), y0 + h / 2, Zw(cz)); mesh.rotation.y = ry; mesh.receiveShadow = true; house.add(mesh);
  zones[zone].meshes.push({ mesh, w: len / 100, d: h, seed }); return mesh;
}
function applyZone(k) {
  const z = zones[k], st = STYLES[z.style];
  for (const it of z.meshes) {
    const t = bakeTiles(it.w, it.d, z.style, z.pattern, z.groutMM, z.groutHex, it.seed);
    const m = it.mesh.material; ['map', 'normalMap', 'roughnessMap'].forEach(q => { if (m[q]) m[q].dispose(); m[q] = t[q]; });
    m.roughness = st.rough; m.clearcoat = st.rough < 0.3 ? 0.5 : 0; m.clearcoatRoughness = 0.1; m.needsUpdate = true;
  }
  renderer.shadowMap.needsUpdate = true;
}
function ceilingBoardMat() { // C2 暗架矽酸鈣天花板 60×60
  const s = 512, c = document.createElement('canvas'); c.width = c.height = s; const x = c.getContext('2d');
  x.fillStyle = '#f2f1ee'; x.fillRect(0, 0, s, s); x.strokeStyle = '#d2d0cb'; x.lineWidth = 3; x.strokeRect(1.5, 1.5, s - 3, s - 3);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function ceilingRect(x0, x1, z0, z1, y, kind) {
  const w = (x1 - x0) / 100, d = (z1 - z0) / 100; let mat;
  if (kind === 'C2') { const t = ceilingBoardMat(); t.repeat.set(w / 0.6, d / 0.6); mat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, side: THREE.DoubleSide }); }
  else mat = plasterMat(kind === 'C3' ? 0xe4e0d8 : 0xf6f5f2); 
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat); m.rotation.x = Math.PI / 2; m.position.set(W((x0 + x1) / 2), y, Zw((z0 + z1) / 2)); m.receiveShadow = true; ceilings.add(m);
  // slab above so light doesn't leak
  bx(x0, x1, y + 0.0, y + 0.15, z0, z1, M.concreteSlab, { parent: ceilings });
}
function dl(x, z, y, I = 5, sh = false) {
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.01, 24), M.white); ring.position.set(W(x), y - 0.005, Zw(z)); ceilings.add(ring);
  const disk = new THREE.Mesh(new THREE.CircleGeometry(0.04, 24), M.emit); disk.rotation.x = Math.PI / 2; disk.position.set(W(x), y - 0.011, Zw(z)); ceilings.add(disk);
  const s = new THREE.SpotLight(0xffe6cc, I * 1.3, 0, Math.PI / 3.2, 0.85, 2); s.position.set(W(x), y - 0.03, Zw(z)); s.target.position.set(W(x), 0, Zw(z));
  s.castShadow = sh; if (sh) { s.shadow.mapSize.set(1024, 1024); s.shadow.bias = -0.0004; s.shadow.radius = 4; }
  house.add(s, s.target);
}
async function put(name, x, z, o = {}) { return place(house, name, { ...o, x: W(x), z: Zw(z) }); }

// stair per p.8 壹層樓梯平面圖: UP17 starts on a landing 91cm from Ⓐ (z 10..91), then risers 1–15 straight (+z, tread 22, x 20..105, 80 wide)
// to a landing (108 deep, z 374..482, h=300 over the bathroom), then risers 16–17 turn right (+x, tread 22) to 2FL (+340).
// v4 re-measure (p.3 1F/2F plans): flight top / landing start at z≈385, landing ends at the 2F bathroom wall (z≈480, '95' on 2F); 17 risers kept → bottom landing 77 (p.8 shows 91)
const RISE = 0.2, ST = { x0: 20, x1: 105, zL: 77, tread: 22, nFlight: 14, landZ0: 385, landZ1: 475 };
// 2F→3F per p.4 參層: UP17 on 2F, risers 1–13 straight (+z, tread 22, first riser at z 111), landing z 375..507, risers 14–17 turn toward ② (x 110..200) to 3FL
const ST2 = { zL: 111, tread: 22, n: 12, landZ0: 375, landZ1: 475, x1: 110 }, R3 = 3.2 / 17;
const F3 = 6.6, F3w = 6.5, RF = 9.8;
function planXZ(xw, zw) { return [230 - xw * 100, zw * 100 + 500]; }
function h1At(x, z) { // 1F + 1F→2F stair
  if (z >= ST.landZ0 && z <= ST.landZ1 && x >= -5 && x <= 149) { if (x <= 105) return 3.0; if (x <= 127) return 3.2; return 3.4; }
  if (x >= -5 && x <= 108 && z >= 10 && z < ST.landZ0) { if (z < ST.zL) return 0; return Math.min(ST.nFlight, Math.floor((z - ST.zL) / ST.tread) + 1) * RISE; }
  if (z < 0 || z > 805 || (z > 620 && x < 300)) return -0.1; return 0;
}
function inBay(x, z) { const s1 = (333 - 152) * (z - 973) - (1035 - 973) * (x - 152), s2 = (383 - 333) * (z - 1035) - (973 - 1035) * (x - 333); return s1 <= 0 && s2 <= 0; }
function h2At(x, z) { // 2F (FL 3.4, wet 3.3) + 2F→3F flight & landing
  if (x < -5 || x > 465 || z < -160 || z > 1035) return null;
  if (z < -10) return 3.3;
  if (z < 10) return 3.4;
  if (x < ST2.x1 && z >= ST2.zL && z < ST2.landZ1) return z < ST2.landZ0 ? 3.4 + (Math.floor((z - ST2.zL) / ST2.tread) + 1) * R3 : 3.4 + 13 * R3;
  if (x >= 105 && x < 149 && z >= 385 && z < 480) return null;
  if (x < 305 && z >= 480 && z < 657) return 3.3;
  if (z >= 973) return inBay(x, z) ? 3.4 : null;
  return 3.4;
}
function h3At(x, z) { // 3F (FL 6.6, bath/terrace 6.5) + turning risers 14–17
  if (x < -5 || x > 465 || z < 10 || z > 1035) return null;
  if (x >= 110 && x < 200 && z >= ST2.landZ0 && z < ST2.landZ1) return 3.4 + (14 + Math.min(3, Math.floor((x - 110) / 22.5))) * R3;
  if (z < 220) return x >= 120 ? F3w : null;           // terrace (bulkhead over the stair on the ① side)
  if (z < 240) return x >= 145 && x <= 385 ? F3 : null; // DW1 threshold
  if (x < ST2.x1 && z < 480) return null;               // stair void
  if (x < 305 && z >= 480 && z < 657) return F3w;
  if (z >= 973) return inBay(x, z) ? F3 : null;
  return F3;
}
function h4At(x, z) { return (x >= 5 && x <= 455 && z >= 245 && z <= 965) ? RF : null; } // roof deck (via 爬梯 on the terrace)
function floorHeightAt(xw, zw, ref) {
  if (ref === undefined) ref = walk.y;
  const [x, z] = planXZ(xw, zw); let best = h1At(x, z);
  for (const h of [h2At(x, z), h3At(x, z), h4At(x, z)]) if (h !== null && Math.abs(h - ref) < Math.abs(best - ref)) best = h;
  return best;
}
// ---------- v3 helpers (door with plan-accurate hinge/swing, slanted walls, polygon floors) ----------
const arcs = new THREE.Group(); house.add(arcs); arcs.visible = false;
const arcMat = new THREE.MeshBasicMaterial({ color: 0xd0302a, side: THREE.DoubleSide });
const doorLog = [];
// hinge (hx,hz), closed leaf tip (cx,cz), fully-open leaf tip direction (ox,oz) — all plan cm; frac = how far open in the walkthrough
function door2(name, hx, hz, cx, cz, ox, oz, frac, h, mat, y0 = 0) {
  const len = Math.hypot(cx - hx, cz - hz) / 100;
  const a0 = Math.atan2(-(cz - hz), cx - hx); let d = Math.atan2(-(oz - hz), ox - hx) - a0;
  while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  const piv = new THREE.Group(); piv.position.set(W(hx), y0, Zw(hz)); piv.rotation.y = a0 + d * frac; house.add(piv);
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(len, h, 0.04), mat); leaf.position.set(len / 2, h / 2, 0); leaf.castShadow = true; leaf.receiveShadow = true; piv.add(leaf);
  for (const s of [1, -1]) { const k = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 8), M.chrome); k.position.set(len / 2 - 0.07, 1.0 - h / 2, 0.035 * s); leaf.add(k); }
  const ring = new THREE.Mesh(new THREE.RingGeometry(len - 0.015, len, 48, 1, d < 0 ? a0 + d : a0, Math.abs(d)), arcMat);
  ring.rotation.x = -Math.PI / 2; ring.position.set(W(hx), y0 + 0.015, Zw(hz)); arcs.add(ring);
  const ol = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.03), arcMat); const op = new THREE.Group(); op.position.set(W(hx), y0 + 0.016, Zw(hz)); op.rotation.y = a0 + d; ol.rotation.x = -Math.PI / 2; ol.position.x = len / 2; op.add(ol); arcs.add(op);
  doorLog.push({ name, hx, hz, cx, cz, ox, oz, y0, r: len * 100 });
}
function windowAlongZ(x, a, b, sill, head, mull = []) {
  const cz = (a + b) / 2;
  bx(x - 3, x + 3, sill, sill + 0.05, a, b, M.frame); bx(x - 3, x + 3, head - 0.05, head, a, b, M.frame);
  bx(x - 3, x + 3, sill, head, a, a + 5, M.frame); bx(x - 3, x + 3, sill, head, b - 5, b, M.frame);
  for (const m of (mull.length ? mull : [cz])) bx(x - 3, x + 3, sill, head, m - 2, m + 2, M.frame);
  const g = new THREE.Mesh(new THREE.PlaneGeometry((b - a) / 100, head - sill), M.windowGlass); g.rotation.y = Math.PI / 2; g.position.set(W(x), (sill + head) / 2, Zw(cz)); house.add(g);
}
function segWall(x0, z0, x1, z1, t, y0, y1, mat, win) {
  const L = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(-(z1 - z0), x1 - x0);
  const g = new THREE.Group(); g.position.set(W(x0), 0, Zw(z0)); g.rotation.y = ang; house.add(g);
  const piece = (s0, s1, a, b, m, dep = t) => { if (s1 - s0 < 0.1 || b - a < 0.001) return; const q = new THREE.Mesh(new THREE.BoxGeometry((s1 - s0) / 100, b - a, dep / 100), m); q.position.set((s0 + s1) / 200, (a + b) / 2, 0); q.castShadow = q.receiveShadow = true; g.add(q); };
  if (!win) piece(0, L, y0, y1, mat);
  else {
    const c = L * win.c, a = c - win.w / 2, b = c + win.w / 2;
    piece(0, a, y0, y1, mat); piece(b, L, y0, y1, mat); piece(a, b, y0, win.sill, mat); piece(a, b, win.head, y1, mat);
    piece(a, b, win.sill, win.sill + 0.05, M.frame, 6); piece(a, b, win.head - 0.05, win.head, M.frame, 6);
    piece(a, a + 5, win.sill, win.head, M.frame, 6); piece(b - 5, b, win.sill, win.head, M.frame, 6);
    for (const m of win.mull || []) piece(a + m - 2, a + m + 2, win.sill, win.head, M.frame, 6);
    if (win.transom) piece(a, b, win.transom - 0.025, win.transom + 0.025, M.frame, 6);
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(win.w / 100, win.head - win.sill), M.windowGlass); gl.position.set(c / 100, (win.sill + win.head) / 2, 0); g.add(gl);
  }
  for (let s = 0; s <= L; s += 12) { const px = x0 + (x1 - x0) * s / L, pz = z0 + (z1 - z0) * s / L; addCollider(px - 7, px + 7, pz - 7, pz + 7, y0, y1); }
}
function floorPoly(zone, pts, y, seed = 1) {
  const xs = pts.map(p => W(p[0])), ys = pts.map(p => -Zw(p[1]));
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys), w = maxX - minX, d = maxY - minY;
  const sh = new THREE.Shape(xs.map((x, i) => new THREE.Vector2(x, ys[i]))), geo = new THREE.ShapeGeometry(sh);
  const p = geo.attributes.position, uv = geo.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) - minX) / w, (p.getY(i) - minY) / d);
  const mesh = new THREE.Mesh(geo, zone ? tileMaterial(zones[zone].style, false) : M.concreteSlab); mesh.rotation.x = -Math.PI / 2; mesh.position.y = y; mesh.receiveShadow = true; house.add(mesh);
  if (zone) zones[zone].meshes.push({ mesh, w, d, seed }); return mesh;
}
function toilet(tx, tz, y, dir) { // tank against wall at tz, bowl toward dir (+1 → +z, −1 → −z)
  const bw = new THREE.Mesh(new THREE.LatheGeometry([[0.0, 0.0], [0.12, 0.0], [0.1, 0.2], [0.17, 0.27], [0.19, 0.38], [0.17, 0.4], [0.05, 0.3], [0, 0.3]].map(p => new THREE.Vector2(...p)), 40), M.ceramic);
  bw.scale.set(0.95, 1, 1.25); bw.position.set(W(tx), y, Zw(tz + 44 * dir)); bw.castShadow = true; house.add(bw);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.02, 40), M.ceramic); lid.scale.set(0.95, 1, 1.25); lid.position.set(W(tx), y + 0.41, Zw(tz + 44 * dir)); house.add(lid);
  bx(tx - 18, tx + 18, y + 0.38, y + 0.76, Math.min(tz, tz + 17 * dir), Math.max(tz, tz + 17 * dir), M.ceramic, { r: 0.03 });
  addCollider(tx - 22, tx + 22, Math.min(tz, tz + 68 * dir), Math.max(tz, tz + 68 * dir), y, y + 0.8);
}
function basinAt(x0, x1, z0, z1, y, bxz) { // counter slab + bowl at (bx,bz)
  bx(x0, x1, y + 0.8, y + 0.83, z0, z1, M.counter, { collide: true });
  const basin = new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [0.08, 0], [0.13, 0.03], [0.15, 0.11], [0.14, 0.115], [0.12, 0.035], [0, 0.012]].map(p => new THREE.Vector2(...p)), 36), M.ceramic);
  basin.position.set(W(bxz[0]), y + 0.83, Zw(bxz[1])); basin.castShadow = true; house.add(basin);
  addCollider(x0, x1, z0, z1, y, y + 0.85);
}
async function buildHouse() {
  scene.updateMatrixWorld(true); // mirrored group must be current before furniture bounding boxes are read
  M.concreteSlab = new THREE.MeshStandardMaterial({ color: 0x9a9690, roughness: 0.95 });
  const paint = plasterMat(0xece7df, 0.9);             // W1 乳膠漆
  const stone = plasterMat(0xb9b1a4, 0.97); stone.normalScale.set(0.9, 0.9); // W3 仿石塗料
  const ext = plasterMat(0xd9d3c8, 0.95);
  const H1 = 3.4, F2 = 3.4, F2w = 3.3, TOP = 6.6, stoneMat = stone; // 1F 340, 2F 320 (2F FL +370, wet areas +360)
  // ================= 1F =================
  floorRect('living', 105, 465, 0, 620, 0, 1);
  floorRect('living', 300, 465, 620, 805, 0, 2);
  floorRect('bath', -5, 105, 384, 620, 0.001, 3);
  floorRect('stair', -5, 105, 10, 77, 0.001, 4);
  floorRect('park', -5, 300, 620, 1160, -0.1, 5);
  floorRect('park', 300, 465, 805, 1160, -0.1, 6);
  floorRect('yard', -5, 465, -300, 0, -0.1, 7);
  bx(105, 465, -0.1, 0, 619, 621, M.counter, { cast: false }); bx(300, 465, -0.1, 0, 804, 806, M.counter, { cast: false }); // step edges
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0xa7a59f, roughness: 1 })); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.12; ground.receiveShadow = true; house.add(ground);
  // ---- party walls: 1F (L-D1 to 鐵皮屋 on the ② side), 2F (L-W1 in hall), balcony parapets ----
  wallZ(-12.5, 0, 1160, 15, H1, ext); wallZ(-12.5, 0, 975, 15, TOP, ext, [], H1);
  wallZ(472.5, 0, 1160, 15, H1, ext, [{ a: 255, b: 345, sill: 0, head: 2.2 }]);
  wallZ(472.5, 0, 975, 15, TOP, ext, [{ a: 520, b: 580, sill: F2 + 1.1, head: F2 + 2.2 }], H1); windowAlongZ(468, 520, 580, F2 + 1.1, F2 + 2.2, [550]);
  for (const x of [-12.5, 472.5]) { wallZ(x, -300, 0, 15, 1.8, ext, [], -0.1); wallZ(x, -160, 0, 15, F2w + 1.1, ext, [], 3.1); }
  door2('L-D1', 465, 345, 465, 255, 555, 345, 0, 2.2, M.darkwood);
  bx(-20, 480, -0.1, 1.8, -307, -300, ext, { collide: true }); // rear boundary wall
  bx(-5.5, -5, -0.1, H1, 620, 1160, stone, { cast: false }); bx(465, 465.5, -0.1, H1, 620, 1160, stone, { cast: false });
  // ---- columns 50×50 at grids, up to roof ----
  for (const x of [5, 455]) for (const z of [0, 620, 950]) bx(x - 25, x + 25, -0.1, TOP, z - 25, z + 25, z === 950 ? stone : paint, { collide: true });
  // ---- A wall (rear): D2 (90) to yard — hinge on ① side, swings OUT; W2 120 window ----
  wallX(0, -5, 465, 20, H1, paint, [{ a: 120, b: 210, sill: 0, head: 2.2 }, { a: 275, b: 395, sill: 1.1, head: 2.3 }]);
  windowAlongX(0, 275, 395, 1.1, 2.3); door2('D2', 120, 0, 210, 0, 120, -90, 0.6, 2.2, M.frame);
  // ---- B wall: W2a (bath 70), W1 (140) ; x 300..465 opens to 玄關 ----
  wallX(620, -5, 300, 15, H1, paint, [{ a: 20, b: 90, sill: 1.1, head: 2.3 }, { a: 150, b: 290, sill: 0.5, head: 2.3 }]);
  windowAlongX(620, 20, 90, 1.1, 2.3); windowAlongX(620, 150, 290, 0.5, 2.3);
  // ---- 玄關 165×185: D1 (100) is in the garage-side wall (z=805), hinge on the ① side, swings IN; shoe cabinet on ② side ----
  wallZ(300, 620, 805, 15, H1, paint);
  wallX(805, 300, 465, 15, H1, paint, [{ a: 313, b: 413, sill: 0, head: 2.2 }]);
  door2('D1', 313, 805, 413, 805, 313, 705, 0.8, 2.2, M.darkwood);
  bx(425, 462, 0, 2.1, 622, 798, M.cabinet, { collide: true }); for (let z = 624; z < 796; z += 44) bx(424, 425, 0.05, 2.08, z, z + 43, M.cabinet, { cast: false });
  // ---- 1F bathroom 115×228: D3 (75) in the living-side wall, hinge at the Ⓑ end, swings IN; basin below the open leaf ----
  wallX(379, -5, 105, 10, 2.55, paint);
  wallZ(110, 379, 475, 10, 3.0, paint); wallZ(110, 475, 620, 10, H1, paint, [{ a: 528, b: 603, sill: 0, head: 2.2 }]);
  door2('D3-1F', 110, 603, 110, 528, 35, 603, 0.85, 2.2, M.cabinet);
  tilePanel('bathwall', 50, 384.5, 110, 2.4, 0, 0, 11); tilePanel('bathwall', 50, 612, 110, 2.4, Math.PI, 0, 12);
  tilePanel('bathwall', -4.5, 498, 228, 2.4, Math.PI / 2, 0, 13);
  toilet(50, 384, 0, 1);
  basinAt(-5, 40, 505, 557, 0, [17, 531]); bx(-5, -4, 1.1, 1.75, 505, 557, new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.03 }));
  // ---- stair 1F→2F (p.8): landing 91, risers 1–15 along +z, landing 108 at +300, risers 16–17 turn toward ② ----
  const stairMat = tileMaterial('nt3201_20', false); zones.stair.meshes.push({ mesh: { material: stairMat }, w: 0.3, d: 0.3, seed: 9 });
  for (let i = 1; i <= ST.nFlight; i++) {
    const z0 = ST.zL + (i - 1) * ST.tread, z1 = z0 + ST.tread, top = i * RISE;
    if (z0 < 379) bx(-5, ST.x1, 0, top - 0.02, z0, Math.min(z1, 379), paint);
    if (z1 > 379) bx(-5, ST.x1, Math.max(2.55, top - 0.25), top - 0.02, Math.max(z0, 379), z1, paint);
    bx(ST.x0, ST.x1, top - 0.02, top, z0 - 1.5, z1, stairMat);
    bx(-5, ST.x0, top - 0.02, top, z0, z1, paint);
    bx(105, 115, 0, Math.min(3.0, top + 0.9), z0, z1, paint, { collide: true });
  }
  bx(105, 115, 3.0, 3.4, ST.zL, ST.landZ0, paint);
  bx(-5, 105, 2.85, 2.98, ST.landZ0, ST.landZ1, M.concreteSlab); bx(-5, 105, 2.98, 3.0, ST.landZ0, ST.landZ1, stairMat);
  bx(105, 127, 2.85, 3.18, ST.landZ0, ST.landZ1, paint); bx(105, 127, 3.18, 3.2, ST.landZ0, ST.landZ1, stairMat);
  bx(127, 149, 2.85, 3.38, ST.landZ0, ST.landZ1, paint); bx(127, 149, 3.38, 3.4, ST.landZ0, ST.landZ1, stairMat);
  { const L = Math.hypot((ST.nFlight * ST.tread) / 100, ST.nFlight * RISE);
    const hr = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, L, 12), M.darkwood);
    hr.position.set(W(110), 0.95 + ST.nFlight * RISE / 2, Zw(ST.zL + ST.nFlight * ST.tread / 2)); hr.rotation.x = Math.atan2(ST.nFlight * ST.tread / 100, ST.nFlight * RISE); house.add(hr); }
  // ---- front facade: SW1 roll-up 345 (open), D5 100 meter-room door — hinge on ① side, swings IN ----
  wallX(1160, 340, 465, 20, H1, stone, [{ a: 360, b: 460, sill: 0, head: 2.5 }]);
  bx(-5, 340, 2.6, H1, 1150, 1170, stone); bx(-5, 340, 2.45, 2.6, 1150, 1162, M.steel);
  door2('D5', 360, 1160, 460, 1160, 360, 1060, 0, 2.5, M.steel);
  // ---- 1F ceilings ----
  ceilingRect(105, 465, 0, 620, 3.0, 'C2'); ceilingRect(300, 465, 620, 805, 3.0, 'C1'); ceilingRect(-5, 105, 384, 620, 2.4, 'C2');
  ceilingRect(-5, 300, 620, 1160, 3.2, 'C3'); ceilingRect(300, 465, 805, 1160, 3.2, 'C3');
  const sk = new THREE.MeshStandardMaterial({ color: 0x9c968d, roughness: 0.9 });
  bx(455, 465, 0, 0.15, 260, 595, sk, { cast: false }); bx(130, 300, 0, 0.15, 607, 612, sk, { cast: false });
  [[200, 120], [330, 120], [200, 470], [380, 470], [380, 300], [380, 700]].forEach(([x, z], i) => dl(x, z, 3.0, 5, i === 2));
  dl(50, 500, 2.4, 3, false);
  { const pl = new THREE.PointLight(0xffe6cc, 4, 6, 2); pl.position.set(W(50), 2.2, Zw(150)); house.add(pl); } dl(150, 850, 3.2, 6, true); dl(150, 1050, 3.2, 5);
  // ---- kitchen: fridge on the A wall beside D2 (as drawn, REF), sink run under W2, L-run on ② wall ending before L-D1 ----
  const plinth = (x0, x1, z0, z1) => bx(x0, x1, 0, 0.1, z0, z1, M.black, { cast: false });
  bx(205, 275, 0, 1.8, 10, 80, new THREE.MeshPhysicalMaterial({ color: 0xd9d9d7, metalness: 0.55, roughness: 0.25 }), { collide: true, r: 0.01 });
  bx(266, 269, 0.9, 1.5, 80, 82, M.steel); bx(205, 275, 1.9, 2.25, 10, 45, M.cabinet); // fridge (hinge on D2 side) + cabinet above
  door2('REF', 205, 80, 275, 80, 205, 150, 0, 1.8, M.steel); // swing marker only (leaf drawn closed inside fridge face)
  plinth(277, 400, 12, 66); bx(275, 400, 0.1, 0.82, 10, 68, M.cabinet, { collide: true }); bx(275, 402, 0.82, 0.85, 10, 70, M.counter);
  for (let x = 277; x < 398; x += 41) bx(x, x + 40, 0.12, 0.8, 68, 69.5, M.cabinet, { cast: false });
  bx(310, 362, 0.85, 0.853, 20, 58, M.steel, { cast: false });
  const fau = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.28, 0), new THREE.Vector3(0, 0.33, 0.07), new THREE.Vector3(0, 0.27, 0.16)]), 24, 0.011, 10), M.chrome);
  fau.position.set(W(336), 0.85, Zw(14)); house.add(fau);
  plinth(407, 463, 72, 253); bx(405, 465, 0.1, 0.82, 70, 255, M.cabinet, { collide: true }); bx(403, 465, 0.82, 0.85, 70, 255, M.counter);
  bx(400, 465, 0.1, 0.85, 10, 70, M.cabinet, { collide: true });
  for (let z = 72; z < 250; z += 46) bx(403.5, 405, 0.12, 0.8, z, z + 45, M.cabinet, { cast: false });
  bx(410, 462, 0.85, 0.856, 82, 142, new THREE.MeshPhysicalMaterial({ color: 0x0a0a0a, roughness: 0.05, clearcoat: 1 }), { cast: false });
  bx(415, 465, 1.55, 1.65, 82, 142, M.steel); bx(440, 465, 1.65, 2.4, 97, 127, M.steel);
  bx(430, 465, 1.45, 2.15, 10, 80, M.cabinet); bx(430, 465, 1.45, 2.15, 144, 255, M.cabinet);
  // dining 110×70 (stools/bar position in the drawing): ≥85 to fridge face, 100 to stair guard, 80 to cooktop run
  const dt = { x0: 220, x1: 330, z0: 200, z1: 270 };
  bx(dt.x0, dt.x1, 0.72, 0.75, dt.z0, dt.z1, M.oak);
  for (const [x, z] of [[dt.x0 + 4, dt.z0 + 4], [dt.x1 - 8, dt.z0 + 4], [dt.x0 + 4, dt.z1 - 8], [dt.x1 - 8, dt.z1 - 8]]) bx(x, x + 4, 0, 0.72, z, z + 4, M.darkwood);
  addCollider(dt.x0, dt.x1, dt.z0, dt.z1, 0, 0.75);
  // living (as drawn): sofa against the bathroom/stair wall facing ②, TV on the ② wall
  bx(205, 375, 0, 0.012, 360, 500, M.rug, { cast: false });
  bx(425, 465, 0, 0.45, 390, 520, M.oak, { collide: true });
  bx(463, 465, 1.0, 1.69, 394, 516, new THREE.MeshPhysicalMaterial({ color: 0x050505, roughness: 0.1, clearcoat: 1 }));
  // yard
  bx(15, 75, -0.1, 0.8, -75, -15, new THREE.MeshPhysicalMaterial({ color: 0xf1f1f1, roughness: 0.3, clearcoat: 0.5 }), { collide: true, r: 0.02 });
  bx(240, 290, -0.1, 0.8, -50, -10, M.ceramic, { collide: true, r: 0.02 });

  // ================= 2F (p.3 貳層平面圖, H=320) =================
  // slab (3.21–3.39) except stair void x −5..105 z 91..507 and the turning risers x 105..149 z 399..507
  const slab = (x0, x1, z0, z1, y0 = 3.21, y1 = 3.39) => bx(x0, x1, y0, y1, z0, z1, M.concreteSlab, { cast: true });
  slab(-5, 465, 0, 111); slab(110, 465, 111, 385); slab(149, 465, 385, 480); slab(305, 465, 480, 660); slab(-5, 305, 480, 660, 3.12, 3.29); slab(-5, 465, 660, 973);
  slab(-5, 465, -160, 0, 3.1, 3.29);
  floorPoly(null, [[152, 973], [333, 1035], [383, 973]], 3.21).material = M.concreteSlab;
  floorRect('room2', 115, 465, 10, 385, F2, 21); floorRect('room2', 149, 465, 385, 480, F2, 22); floorRect('room2', 305, 465, 480, 660, F2, 23);
  floorRect('room2', -5, 465, 660, 973, F2, 24); floorPoly('room2', [[152, 973], [333, 1035], [383, 973]], F2, 25);
  floorRect('stair', -5, 115, 10, 111, F2 + 0.001, 26);
  floorRect('bath2', -5, 305, 485, 652, F2w, 27); floorRect('balcony', -5, 465, -160, -10, F2w, 28);
  bx(300, 310, F2w, F2, 520, 595, M.counter, { cast: false }); // bath threshold (−10)
  // rear wall: DW1 240×220 (fixed 60 + sliding 90+90) to balcony
  wallX(0, -5, 465, 20, 6.3, paint, [{ a: 150, b: 390, sill: F2, head: F2 + 2.2 }], H1);
  windowAlongX(0, 150, 390, F2 + 0.01, F2 + 2.2); bx(208, 212, F2, F2 + 2.2, -3, 3, M.frame);
  // balcony parapet (1.1 m) + rail cap
  wallX(-160, -20, 480, 15, F2w + 1.1, ext, [], 3.1); bx(-20, 480, F2w + 1.1, F2w + 1.14, -169, -151, M.steel);
  // stair 2F→3F (p.4: 17 risers × 18.8; 1–13 straight above the 1F flight, landing, 14–17 turn toward ②)
  for (let j = 1; j <= ST2.n; j++) {
    const z0 = ST2.zL + (j - 1) * ST2.tread, z1 = z0 + ST2.tread, top = F2 + j * R3;
    bx(-5, 105, Math.max(F2 - 0.15, top - 0.3), top - 0.02, z0, z1, paint);
    bx(ST.x0, 105, top - 0.02, top, z0 - 1.5, z1, stairMat); bx(-5, ST.x0, top - 0.02, top, z0, z1, paint);
    bx(105, 115, F2, top + 0.9, z0, z1, paint, { collide: true });
  }
  { const yl = F2 + 13 * R3; bx(-5, ST2.x1, yl - 0.2, yl - 0.02, ST2.landZ0, ST2.landZ1, M.concreteSlab); bx(-5, ST2.x1, yl - 0.02, yl, ST2.landZ0 - 1.5, ST2.landZ1, stairMat);
    for (let k = 14; k <= 17; k++) { const x0 = 110 + (k - 14) * 22.5, top = F2 + k * R3; bx(x0, x0 + 22.5, top - 0.25, top - 0.02, ST2.landZ0, ST2.landZ1, paint); bx(x0 - 1.5, x0 + 22.5, top - 0.02, top, ST2.landZ0, ST2.landZ1, stairMat); } }
  { const L = Math.hypot((ST2.n * ST2.tread) / 100, ST2.n * R3); const hr = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, L, 12), M.darkwood);
    hr.position.set(W(117), F2 + 0.95 + ST2.n * R3 / 2, Zw(ST2.zL + ST2.n * ST2.tread / 2)); hr.rotation.x = Math.atan2(ST2.n * ST2.tread / 100, ST2.n * R3); house.add(hr); }
  bx(115, 149, F2, F2 + 0.95, 382, 385, M.steel, { collide: true }); // guard at the 1F→2F arrival
  let linen, duvet;
  const bedBath = (F, Fw, tag, y0a) => {
  // 2F bathroom 310×135 (F floor, W2 walls, C2 ceiling): D3 75 in the hall-side wall, hinge at the stair end, swings IN
  wallX(480, -5, 105, 10, (F + 3.2), paint, [], y0a); wallX(480, 105, 305, 10, (F + 3.2), paint, [], Fw);
  wallZ(305, 480, 657, 10, (F + 3.2), paint, [{ a: 520, b: 595, sill: Fw, head: Fw + 2.2 }], Fw);
  door2('D3-' + tag, 305, 520, 305, 595, 230, 520, 0.85, 2.2, M.cabinet, Fw);
  tilePanel('bath2wall', 150, 485.5, 310, 2.4, 0, Fw, 31); tilePanel('bath2wall', 150, 651.5, 310, 2.4, Math.PI, Fw, 32);
  tilePanel('bath2wall', -4.5, 568.5, 167, 2.4, Math.PI / 2, Fw, 33); tilePanel('bath2wall', 299.5, 624, 56, 2.4, -Math.PI / 2, Fw, 34);
  toilet(175, 652, Fw, -1);
  basinAt(232, 288, 607, 652, Fw, [260, 630]); bx(235, 285, Fw + 1.1, Fw + 1.8, 651, 652, new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.03 }));
  bx(108, 110, Fw, Fw + 2.0, 485, 590, M.windowGlass, { collide: true }); bx(-5, 108, Fw, Fw + 0.03, 485, 652, M.counter, { cast: false }); // shower zone + glass
  { const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 24), M.chrome); sh.position.set(W(50), Fw + 2.05, Zw(640)); house.add(sh); bx(48, 52, Fw + 1.0, Fw + 2.1, 650, 652, M.chrome); }
  ceilingRect(-5, 305, 485, 652, Fw + 2.4, 'C2');
  // master bedroom 主臥室 (470 × 315): D4 90×230 hinge on ② side, swings IN; bay W3 165×220 + W4 40×220
  wallX(657, -5, 465, 10, (F + 3.2), paint, [{ a: 330, b: 420, sill: F, head: F + 2.3 }], Fw);
  door2('D4-' + tag, 420, 657, 330, 657, 420, 747, 0.85, 2.3, M.oak, F);
  wallX(973, -5, 152, 20, (F + 3.2), paint, [], F - 0.19); wallX(973, 383, 465, 20, (F + 3.2), paint, [], F - 0.19);
  segWall(152, 973, 333, 1035, 15, F - 0.19, (F + 3.2), paint, { c: 0.5, w: 165, sill: F + 0.1, head: F + 2.2, mull: [55, 110], transom: F + 1.1 });
  segWall(333, 1035, 383, 973, 15, F - 0.19, (F + 3.2), paint, { c: 0.5, w: 40, sill: F + 0.1, head: F + 2.2, transom: F + 1.1 });
  // bedroom furniture: bed 152×188 (5×6.2尺) head to ① wall, wardrobe 60 deep on ② wall, nightstand
  linen = new THREE.MeshStandardMaterial({ color: 0xe9e4da, roughness: 0.95 }); duvet = new THREE.MeshStandardMaterial({ color: 0x8c9aa3, roughness: 0.95 });
  bx(-5, 3, F, F + 1.05, 680, 840, M.darkwood, { collide: true });
  bx(3, 191, F, F + 0.3, 684, 836, M.oak, { collide: true }); bx(5, 189, F + 0.3, F + 0.55, 686, 834, linen, { r: 0.04 });
  bx(70, 192, F + 0.5, F + 0.6, 682, 838, duvet, { r: 0.03 }); bx(10, 50, F + 0.55, F + 0.68, 694, 756, linen, { r: 0.05 }); bx(10, 50, F + 0.55, F + 0.68, 764, 826, linen, { r: 0.05 });
  addCollider(3, 192, 682, 838, F, F + 0.7);
  bx(405, 465, F, F + 2.2, 760, 960, M.cabinet, { collide: true }); for (let z = 762; z < 958; z += 49) bx(404, 405, F + 0.05, F + 2.18, z, z + 48, M.cabinet, { cast: false });
  bx(150, 330, F, F + 0.012, 850, 960, M.rug, { cast: false });
  };
  bedBath(F2, F2w, '2F', 2.85);
  // 2F ceilings (C1 paint 290) + roof slab cap
  ceilingRect(200, 465, 0, 480, 6.3, 'C1'); ceilingRect(115, 200, 0, 375, 6.3, 'C1'); ceilingRect(-5, 110, 0, 111, 6.3, 'C1'); ceilingRect(305, 465, 480, 657, 6.3, 'C1'); ceilingRect(-5, 465, 657, 973, 6.3, 'C1');
  [[220, 120], [360, 120], [220, 300], [380, 300], [380, 580], [120, 780], [330, 780], [220, 920]].forEach(([x, z], i) => dl(x, z, 6.3, 4.5, false));
  dl(150, 585, F2w + 2.4, 3, false); dl(60, 330, 9.5, 7, false); dl(60, 460, 9.5, 5, false); dl(60, 170, 7.8, 4, false);
  { const pl = new THREE.PointLight(0xffe6cc, 3, 6, 2); pl.position.set(W(50), 4.8, Zw(300)); house.add(pl); }
  bx(455, 465, F2, F2 + 0.12, 25, 595, sk, { cast: false });
  // 起居室 (355 × 445): 2-seat sofa against the stair guard facing ②, TV on ② wall, rug
  bx(130, 350, F2, F2 + 0.012, 140, 312, M.rug, { cast: false });
  bx(425, 465, F2, F2 + 0.45, 170, 300, M.oak, { collide: true }); bx(463, 465, F2 + 1.0, F2 + 1.62, 182, 288, new THREE.MeshPhysicalMaterial({ color: 0x050505, roughness: 0.1, clearcoat: 1 }));
  // balcony: washer (left), utility sink (right), as drawn
  bx(75, 140, F2w, F2w + 0.85, -75, -12, new THREE.MeshPhysicalMaterial({ color: 0xf1f1f1, roughness: 0.3, clearcoat: 0.5 }), { collide: true, r: 0.02 });
  bx(420, 462, F2w, F2w + 0.8, -115, -55, M.ceramic, { collide: true, r: 0.02 });

  // ================= 3F (p.4 參層平面圖, H=320; FL +690 → 6.6, bath/terrace +680 → 6.5) =================
  const s3 = (x0, x1, z0, z1, y0 = F3 - 0.19, y1 = F3 - 0.01) => bx(x0, x1, y0, y1, z0, z1, M.concreteSlab);
  s3(110, 465, 230, 375); s3(200, 465, 375, 480); s3(305, 465, 480, 660); s3(-5, 305, 480, 660, F3w - 0.18, F3w - 0.01); s3(-5, 465, 660, 973);
  s3(120, 465, 0, 230, 6.31, F3w - 0.01); floorPoly(null, [[152, 973], [333, 1035], [383, 973]], F3 - 0.19).material = M.concreteSlab;
  floorRect('room2', 110, 465, 240, 375, F3, 41); floorRect('room2', 200, 465, 375, 480, F3, 42); floorRect('room2', 305, 465, 480, 660, F3, 43);
  floorRect('room2', -5, 465, 660, 973, F3, 44); floorPoly('room2', [[152, 973], [333, 1035], [383, 973]], F3, 45);
  floorRect('bath2', -5, 305, 485, 652, F3w, 47); floorRect('terrace', 120, 465, 10, 220, F3w, 48);
  bx(300, 310, F3w, F3, 520, 595, M.counter, { cast: false });
  // shell: party walls up to the roof parapet (+1120 → 10.9), terrace side parapets, rear parapet (W3 仿石塗料 on the terrace side)
  wallZ(-12.5, 230, 975, 15, RF + 1.1, ext, [], TOP); wallZ(-12.5, 0, 230, 15, 7.95, ext, [], TOP);
  wallZ(472.5, 230, 975, 15, RF + 1.1, ext, [{ a: 520, b: 580, sill: F3 + 1.1, head: F3 + 2.2 }], TOP); windowAlongZ(468, 520, 580, F3 + 1.1, F3 + 2.2, [550]);
  wallZ(472.5, 0, 230, 15, F3w + 1.1, ext, [], TOP); bx(464.5, 465, F3w, F3w + 1.1, 10, 220, stoneMat, { cast: false });
  wallX(0, 120, 480, 20, F3w + 1.1, ext, [], 6.3); bx(120, 465, F3w, F3w + 1.1, 10, 10.5, stoneMat, { cast: false }); bx(120, 480, F3w + 1.1, F3w + 1.14, -10, 10, M.steel);
  // stair bulkhead (p.4 "3FL+119"): keeps headroom over the 2F→3F flight
  wallX(0, -20, 120, 20, 7.95, ext, [], 6.3); wallZ(117.5, 10, 230, 5, 7.8, ext, [], F3w); bx(-20, 122, 7.8, 7.95, 0, 240, M.concreteSlab);
  // 3F rear wall on grid Ⓐ' (z 230): DW1 240×220 to the terrace; W3 skin on terrace face
  wallX(230, 110, 465, 20, RF, paint, [{ a: 145, b: 385, sill: F3, head: F3 + 2.2 }], 6.3); windowAlongX(230, 145, 385, F3 + 0.01, F3 + 2.2); bx(203, 207, F3, F3 + 2.2, 227, 233, M.frame);
  wallX(230, -5, 110, 20, RF, paint, [], 7.8); bx(110, 465, F3w, RF, 219.5, 220, stoneMat, { cast: false });
  // 3F guards around the stair void (L-shaped, as drawn)
  bx(110, 114, F3, F3 + 1.0, 240, 377, M.steel, { collide: true }); bx(110, 177, F3, F3 + 1.0, 373, 377, M.steel, { collide: true });
  bx(105, 110, F2 + 13 * R3, F2 + 13 * R3 + 0.9, 240, 375, M.steel, { collide: true });
  // bath / bedroom / hall: same layout as 2F (p.4)
  bedBath(F3, F3w, '3F', 5.6);
  // 家事間 (utility room 355 × 135+): work table 120×60×75 + shelving on ② wall
  bx(345, 465, F3 + 0.72, F3 + 0.75, 245, 305, M.oak); for (const [x, z] of [[347, 247], [461, 247], [347, 301], [461, 301]]) bx(x, x + 3, F3, F3 + 0.72, z, z + 3, M.darkwood); addCollider(345, 465, 245, 305, F3, F3 + 0.75);
  bx(425, 465, F3, F3 + 1.8, 320, 500, M.cabinet, { collide: true });
  // terrace (露臺): washer + utility sink on ② side (as drawn), clothes line, 爬梯 to roof
  bx(395, 460, F3w, F3w + 0.85, 50, 110, new THREE.MeshPhysicalMaterial({ color: 0xf1f1f1, roughness: 0.3, clearcoat: 0.5 }), { collide: true, r: 0.02 });
  bx(422, 462, F3w, F3w + 0.8, 14, 50, M.ceramic, { collide: true, r: 0.02 });
  bx(130, 380, F3w + 1.9, F3w + 1.92, 120, 122, M.steel);
  for (const x of [432, 462]) bx(x, x + 3, F3w, RF + 1.2, 212, 216, M.steel); for (let y = F3w + 0.3; y < RF + 1.1; y += 0.3) bx(432, 465, y, y + 0.025, 213, 215, M.steel);
  // 3F ceilings (C1, 290) + lights
  ceilingRect(-5, 465, 240, 480, F3 + 2.9, 'C1'); ceilingRect(305, 465, 480, 657, F3 + 2.9, 'C1'); ceilingRect(-5, 465, 657, 973, F3 + 2.9, 'C1');
  [[280, 300], [400, 450], [380, 580], [120, 780], [330, 780], [220, 920]].forEach(([x, z]) => dl(x, z, F3 + 2.9, 4.5, false)); dl(150, 585, F3w + 2.4, 3, false);
  // ================= roof (p.4 屋頂層 +1010 → 9.8; parapet H=110; 2噸水塔) =================
  bx(-20, 480, RF - 0.2, RF, 220, 983, M.concreteSlab); floorPoly(null, [[152, 973], [333, 1035], [383, 973]], RF).material = M.concreteSlab;
  bx(-5, 465, RF, RF + 0.02, 240, 963, new THREE.MeshStandardMaterial({ color: 0x8e9295, roughness: 0.85 }), { cast: false });
  wallX(230, -20, 480, 20, RF + 1.1, ext, [], RF); wallX(973, -20, 480, 20, RF + 1.1, ext, [], RF);
  bx(42, 209, RF, RF + 0.4, 309, 451, M.concreteSlab, { collide: true });
  { const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 1.55, 40), new THREE.MeshStandardMaterial({ color: 0xd8dadc, metalness: 0.9, roughness: 0.3 }));
    tank.position.set(W(125), RF + 0.4 + 0.78, Zw(380)); tank.castShadow = true; house.add(tank); addCollider(53, 197, 308, 452, RF, RF + 2.0);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.72, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), tank.material); cap.scale.y = 0.25; cap.position.set(W(125), RF + 0.4 + 1.55, Zw(380)); house.add(cap); }
  // ---- CC0 furniture ----
  const coll = (w, pad = 0) => { w.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(w); addCollider(230 - b.max.x * 100 - pad, 230 - b.min.x * 100 + pad, b.min.z * 100 + 500 - pad, b.max.z * 100 + 500 + pad, b.min.y, b.max.y); return w; };
  const jobs = [
    put('sofa_02', 158, 435, { ry: Math.PI / 2, fitW: 1.8 }).then(coll),
    put('modern_coffee_table_01', 287, 422, { s: 0.8 }).then(coll),
    put('dining_chair_02', 250, 175, { ry: 0, s: 0.95 }).then(coll), put('dining_chair_02', 300, 175, { ry: 0, s: 0.95 }).then(coll),
    put('dining_chair_02', 250, 295, { ry: Math.PI, s: 0.95 }).then(coll), put('dining_chair_02', 300, 295, { ry: Math.PI, s: 0.95 }).then(coll),
    put('covered_car', 140, 880, { y: -0.1 }).then(coll),
    put('potted_plant_02', 420, -250, { fitH: 1.0, y: -0.1 }),
    put('cardboard_box_01', 400, 1100, { y: -0.1 }),
    put('sofa_02', 155, 235, { ry: Math.PI / 2, fitW: 1.5, y: F2 }).then(coll),
    put('modern_coffee_table_01', 260, 235, { s: 0.7, y: F2 }).then(coll),
    put('potted_plant_04', 440, 40, { fitH: 0.9, y: F2 }).then(coll),
    put('side_table_01', 22, 865, { fitH: 0.5, y: F2 }).then(coll),
    put('dining_chair_02', 265, 925, { ry: Math.PI * 0.85, s: 0.95, y: F2 }).then(coll),
    put('potted_plant_02', 30, -120, { fitH: 0.8, y: F2w }),
    put('side_table_01', 22, 865, { fitH: 0.5, y: F3 }).then(coll),
    put('dining_chair_02', 265, 925, { ry: Math.PI * 0.85, s: 0.95, y: F3 }).then(coll),
    put('dining_chair_02', 325, 275, { ry: Math.PI / 2, s: 0.95, y: F3 }).then(coll),
    put('potted_plant_04', 300, 40, { fitH: 1.0, y: F3w }).then(coll), put('potted_plant_02', 200, 40, { fitH: 0.8, y: F3w }).then(coll),
  ];
  await Promise.all(jobs);
  const sun = new THREE.DirectionalLight(0xfff0dc, 3.0); sun.position.set(W(600), 11, Zw(1900)); sun.target.position.set(W(230), 0, Zw(600));
  sun.castShadow = true; sun.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
  Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 35 }); sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.02;
  house.add(sun, sun.target); house.add(new THREE.HemisphereLight(0xf4f6ff, 0x9a8c7a, 0.6));
  for (const k in zones) applyZone(k);
}

// ---------------- walk / orbit controls ----------------
let mode = params.get('mode') || 'walk';
let orbitLv = -1; const planLv = +(params.get('plan') || 0); let ortho = null;
function setupPlan() { // top-down orthographic, ① left / Ⓐ bottom like the drawing; cut at 1.6 m above the floor
  renderer.clippingPlanes = planLv === 4 ? [] : [new THREE.Plane(new THREE.Vector3(0, -1, 0), [0, 1.6, 3.4 + 1.6, 6.6 + 1.6][planLv])];
  ceilings.visible = false; arcs.visible = true; scene.background = new THREE.Color(0xffffff); ['toggle', 'modeBtn', 'hint', 'panel', 'joy'].forEach(id => { if ($(id)) $(id).style.display = 'none'; });
  const asp = innerWidth / innerHeight, hh = 7.75, hw = hh * asp; ortho = new THREE.OrthographicCamera(-hw, hw, hh, -hh, 0.1, 100);
  ortho.up.set(0, 0, 1); ortho.position.set(0, 40, Zw(430)); ortho.lookAt(0, 0, Zw(430)); ortho.updateProjectionMatrix();
}
const elevV = params.get('elev');
function setupElev() { // orthographic rear (南向) elevation: ① left, ② right; cut off the rear boundary wall
  renderer.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, 0, 1), -Zw(-250))];
  ceilings.visible = true; arcs.visible = false; scene.background = new THREE.Color(0xffffff); ['toggle', 'modeBtn', 'hint', 'panel', 'joy'].forEach(id => { if ($(id)) $(id).style.display = 'none'; });
  const asp = innerWidth / innerHeight, hh = 6.2, hw = hh * asp; ortho = new THREE.OrthographicCamera(-hw, hw, hh, -hh, 0.1, 100);
  ortho.position.set(0, 5.4, Zw(-1500)); ortho.lookAt(0, 5.4, Zw(500)); ortho.updateProjectionMatrix();
}
const walk = { yaw: Math.PI, pitch: -0.05, x: WX(390), z: Zw(1120), keys: {}, move: { x: 0, y: 0 }, look: null, joy: null, eye: 1.55, y: 0 };
const el = renderer.domElement;
function setMode(m) {
  mode = m; $('modeBtn').textContent = m === 'walk' ? '切換：俯瞰環繞' : '切換：第一人稱漫遊';
  controls.enabled = m === 'orbit'; ceilings.visible = m === 'walk' && !planLv; $('joy').style.display = m === 'walk' && ('ontouchstart' in window) ? '' : 'none';
  arcs.visible = m === 'orbit' || !!planLv;
  if (m === 'orbit') { const lv = orbitLv === 0 ? 0 : (orbitLv || (walk.y > 8 ? 4 : walk.y > 5 ? 3 : walk.y > 2 ? 2 : 1)); const by = [0, 0, 3.4, 6.6, 9.8][lv] || 0;
    renderer.clippingPlanes = lv && lv < 4 ? [new THREE.Plane(new THREE.Vector3(0, -1, 0), [0, 3.2, 6.35, 9.45][lv])] : [];
    if (lv === 0) { controls.target.set(0, 4.5, Zw(500)); camera.position.set(WX(-700), 7, Zw(-1300)); }
    else { controls.target.set(0, by + 0.5, Zw(450)); camera.position.set(WX(750), by + 9.5, Zw(1250)); } controls.maxDistance = 30; controls.maxPolarAngle = Math.PI * 0.49; camera.fov = 50; if ($('orbitLv')) $('orbitLv').value = String(lv); }
  else if (!planLv && !elevV) renderer.clippingPlanes = [];
  else camera.fov = camera.aspect < 1 ? 75 : 65;
  camera.updateProjectionMatrix(); renderer.shadowMap.needsUpdate = true;
}
function collide(nx, nz) {
  const r = 0.22;
  for (const c of colliders) {
    if (!(walk.y + 0.3 < c.y1 && walk.y + 1.7 > c.y0)) continue;
    const cx = Math.max(c.x0, Math.min(nx, c.x1)), cz = Math.max(c.z0, Math.min(nz, c.z1));
    const dx = nx - cx, dz = nz - cz, d = Math.hypot(dx, dz);
    if (d < r) { if (d > 1e-6) { nx = cx + dx / d * r; nz = cz + dz / d * r; } }
  }
  return [nx, nz];
}
addEventListener('keydown', e => walk.keys[e.code] = true); addEventListener('keyup', e => walk.keys[e.code] = false);
el.addEventListener('pointerdown', e => { if (mode !== 'walk') return; el.setPointerCapture(e.pointerId);
  const isJoy = e.pointerType === 'touch' && e.clientX < innerWidth * 0.42 && e.clientY > innerHeight * 0.45;
  if (isJoy) { walk.joy = { id: e.pointerId, x: e.clientX, y: e.clientY }; $('joy').style.left = (e.clientX - 50) + 'px'; $('joy').style.top = (e.clientY - 50) + 'px'; }
  else walk.look = { id: e.pointerId, x: e.clientX, y: e.clientY }; });
el.addEventListener('pointermove', e => { if (mode !== 'walk') return;
  if (walk.joy && e.pointerId === walk.joy.id) { walk.move.x = Math.max(-1, Math.min(1, (e.clientX - walk.joy.x) / 50)); walk.move.y = Math.max(-1, Math.min(1, (e.clientY - walk.joy.y) / 50)); }
  else if (walk.look && e.pointerId === walk.look.id) { walk.yaw -= (e.clientX - walk.look.x) * 0.005; walk.pitch = Math.max(-1.2, Math.min(1.2, walk.pitch - (e.clientY - walk.look.y) * 0.004)); walk.look.x = e.clientX; walk.look.y = e.clientY; } });
const endP = e => { if (walk.joy && e.pointerId === walk.joy.id) { walk.joy = null; walk.move.x = walk.move.y = 0; $('joy').style.left = ''; $('joy').style.top = ''; } if (walk.look && e.pointerId === walk.look.id) walk.look = null; };
el.addEventListener('pointerup', endP); el.addEventListener('pointercancel', endP);
el.addEventListener('wheel', e => { if (mode === 'walk') { camera.fov = Math.max(35, Math.min(85, camera.fov + e.deltaY * 0.02)); camera.updateProjectionMatrix(); } });
let lastT = performance.now();
function stepWalk() {
  const now = performance.now(), dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  if (mode !== 'walk') return;
  const k = walk.keys; let f = -walk.move.y, s = walk.move.x;
  if (k.KeyW || k.ArrowUp) f += 1; if (k.KeyS || k.ArrowDown) f -= 1; if (k.KeyA) s -= 1; if (k.KeyD) s += 1;
  if (k.ArrowLeft) walk.yaw += 1.8 * dt; if (k.ArrowRight) walk.yaw -= 1.8 * dt;
  const sp = 1.4 * dt, fx = -Math.sin(walk.yaw), fz = -Math.cos(walk.yaw);
  let nx = walk.x + (fx * f - fz * s) * sp, nz = walk.z + (fz * f + fx * s) * sp;
  const curH = floorHeightAt(walk.x, walk.z), newH = floorHeightAt(nx, nz);
  if (Math.abs(newH - curH) > 0.45) { nx = walk.x; nz = walk.z; }
  [nx, nz] = collide(nx, nz); walk.x = nx; walk.z = nz;
  const target = floorHeightAt(walk.x, walk.z); walk.y += (target - walk.y) * Math.min(1, dt * 10);
  camera.position.set(walk.x, walk.y + walk.eye, walk.z);
  camera.rotation.order = 'YXZ'; camera.rotation.set(walk.pitch, walk.yaw, 0);
}
let frameNo = 0;
function animate() { requestAnimationFrame(animate); frameNo++; if (ortho) { renderer.render(scene, ortho); return; } stepWalk(); { const ht = mode === 'walk' ? (walk.y > 8 ? '屋頂 RF｜+1010' : walk.y > 5 ? '三樓 3F｜層高 320 cm' : walk.y > 2 ? '二樓 2F｜層高 320 cm' : '一樓 1F｜層高 340 cm') : '俯瞰：紅線＝門扇開啟範圍'; if ($('hint') && $('hint').textContent !== ht) $('hint').textContent = ht; } if (mode === 'orbit') controls.update(); composer.render(); }
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); });

function initXieUI() {
  $('toggle').onclick = () => $('panel').classList.toggle('collapsed');
  if (isMobile || params.has('shot')) $('panel').classList.add('collapsed');
  const zs = $('zone'); for (const [k, z] of Object.entries(zones)) { const o = document.createElement('option'); o.value = k; o.textContent = z.label; zs.appendChild(o); }
  const sel = $('style');
  for (const [k, v] of Object.entries(STYLES)) { const o = document.createElement('option'); o.value = k; o.textContent = v.name + (v.page ? `（PDF p.${v.page}）` : ''); sel.appendChild(o); }
  const sync = () => { const z = zones[zs.value]; sel.value = z.style; $('pattern').value = z.pattern; $('groutW').value = z.groutMM; $('groutWv').textContent = z.groutMM + ' mm'; $('groutC').value = z.groutHex; };
  zs.onchange = sync; sync();
  sel.onchange = () => { zones[zs.value].style = sel.value; applyZone(zs.value); };
  $('pattern').onchange = e => { zones[zs.value].pattern = e.target.value; applyZone(zs.value); };
  $('groutW').oninput = e => $('groutWv').textContent = e.target.value + ' mm';
  $('groutW').onchange = e => { zones[zs.value].groutMM = +e.target.value; applyZone(zs.value); };
  $('groutC').onchange = e => { zones[zs.value].groutHex = e.target.value; applyZone(zs.value); };
  $('modeBtn').onclick = () => setMode(mode === 'walk' ? 'orbit' : 'walk');
  document.querySelectorAll('.go').forEach(b => b.onclick = () => { const [x, z, yaw, lv = 1] = b.dataset.p.split(',').map(Number); setMode('walk'); walk.x = WX(x); walk.z = Zw(z); walk.yaw = -yaw; walk.pitch = -0.08; walk.y = floorHeightAt(walk.x, walk.z, [0, 0, 3.4, 6.6, 9.8][lv] || 0); });
  document.querySelectorAll('.ext').forEach(b => b.onclick = () => { orbitLv = 0; setMode('orbit'); });
  if ($('orbitLv')) $('orbitLv').onchange = e => { orbitLv = +e.target.value; setMode('orbit'); };
  $('quality').value = quality; $('quality').onchange = e => { const u = new URL(location.href); u.searchParams.set('q', e.target.value); location.href = u.toString(); };
}
window.__xie = { setMode, walk, W, WX, Zw, camera, controls, doorLog, colliders, floorHeightAt };

(async function main() {
  try {
    initMaterials(); setupPipeline();
    const [hdrBuf, presets] = await Promise.all([fetchB64('lebombo_1k.hdr'), fetch('../assets/tiles.json?v=' + VER).then(r => r.json())]);
    const photo = {};
    await Promise.all(Object.entries(presets).map(async ([k, p]) => {
      const imgs = await Promise.all(p.data.map(async u => { const im = new Image(); im.src = u; await im.decode(); return im; }));
      photo[k] = { name: p.name, page: p.page, size: p.size, rough: p.rough, slip: p.slip, kind: 'photo', polished: p.polished, bump: p.bump, imgs };
    }));
    photo.nt3201_20 = { ...photo.nt3201, size: [0.2, 0.2], name: '止滑石英磚 NT3201 淺灰（以 20×20 呈現，F3 代用）' };
    for (const k of Object.keys(STYLES)) { const v = STYLES[k]; delete STYLES[k]; photo[k] = v; } Object.assign(STYLES, photo);
    const hdr = new RGBELoader().parse(hdrBuf); const tex = new THREE.DataTexture(hdr.data, hdr.width, hdr.height, THREE.RGBAFormat, hdr.type);
    tex.mapping = THREE.EquirectangularReflectionMapping; tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.needsUpdate = true; tex.flipY = true;
    const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromEquirectangular(tex).texture; scene.environmentIntensity = 0.45;
    scene.background = new THREE.Color(0xc9d6e2);
    await buildHouse(); initXieUI();
    let lv0 = 1; const p = params.get('pos'); if (p) { const [x, z, yaw, pitch, lv] = p.split(',').map(Number); walk.x = WX(x); walk.z = Zw(z); walk.yaw = -yaw; if (!isNaN(pitch)) walk.pitch = pitch; if (lv >= 2) lv0 = lv; }
    walk.y = floorHeightAt(walk.x, walk.z, [0, 0, 3.4, 6.6, 9.8][lv0]); if (params.get('olv') !== null) orbitLv = +params.get('olv');
    if (planLv) setupPlan(); else if (elevV) setupElev();
    setMode(mode);
    $('loading').style.display = 'none'; window.__ready = true; animate();
  } catch (e) { console.error(e); $('loadtxt').textContent = '載入失敗：' + e.message; }
})();
