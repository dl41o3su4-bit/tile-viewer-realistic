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
const VER = '4';
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
const W = x => (x - 230) / 100, Zw = z => (z - 500) / 100;
const house = new THREE.Group(); scene.add(house);
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
};
for (const k in ZONES) zones[k] = { ...ZONES[k], meshes: [] };

function addCollider(x0, x1, z0, z1) { colliders.push({ x0: W(Math.min(x0, x1)), x1: W(Math.max(x0, x1)), z0: Zw(Math.min(z0, z1)), z1: Zw(Math.max(z0, z1)) }); }
function bx(x0, x1, y0, y1, z0, z1, mat, opts = {}) { // cm in plan, y in m
  const w = Math.abs(x1 - x0) / 100, d = Math.abs(z1 - z0) / 100, h = y1 - y0;
  const m = new THREE.Mesh(opts.r ? new RoundedBoxGeometry(w, h, d, 2, opts.r) : new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(W((x0 + x1) / 2), (y0 + y1) / 2, Zw((z0 + z1) / 2)); m.castShadow = opts.cast !== false; m.receiveShadow = true;
  (opts.parent || house).add(m); if (opts.collide) addCollider(x0, x1, z0, z1); return m;
}
// wall along X at plan z (thickness t), openings [{a,b,sill,head}] in plan x cm, heights m
function wallX(z, x0, x1, t, H, mat, ops = [], y0 = 0) {
  let cur = x0; ops = [...ops].sort((p, q) => p.a - q.a);
  for (const o of ops) { if (o.a > cur) bx(cur, o.a, y0, H, z - t / 2, z + t / 2, mat, { collide: true });
    if (o.sill > y0) bx(o.a, o.b, y0, o.sill, z - t / 2, z + t / 2, mat, { collide: o.sill > 0.5 });
    if (o.head < H) bx(o.a, o.b, o.head, H, z - t / 2, z + t / 2, mat); if (o.sill > 0.3) addCollider(o.a, o.b, z - t / 2, z + t / 2); cur = o.b; }
  if (cur < x1) bx(cur, x1, y0, H, z - t / 2, z + t / 2, mat, { collide: true });
}
function wallZ(x, z0, z1, t, H, mat, ops = [], y0 = 0) {
  let cur = z0; ops = [...ops].sort((p, q) => p.a - q.a);
  for (const o of ops) { if (o.a > cur) bx(x - t / 2, x + t / 2, y0, H, cur, o.a, mat, { collide: true });
    if (o.sill > y0) bx(x - t / 2, x + t / 2, y0, o.sill, o.a, o.b, mat);
    if (o.head < H) bx(x - t / 2, x + t / 2, o.head, H, o.a, o.b, mat); if (o.sill > 0.3) addCollider(x - t / 2, x + t / 2, o.a, o.b); cur = o.b; }
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
  else mat = plasterMat(kind === 'C3' ? 0xcfc8bd : 0xf3f2ef); 
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

// stair: 17 risers, 1FL→2FL = 340 cm, run 393 cm along +z at x -5..105
const STAIR = { x0: -5, x1: 105, z0: 0, z1: 393, n: 17, rise: 3.4 / 17 };
function stairHeightAt(xw, zw) {
  const x = xw * 100 + 230, z = zw * 100 + 500;
  if (x < STAIR.x0 || x > STAIR.x1 || z < STAIR.z0 || z > STAIR.z1 + 1) return null;
  const i = Math.min(STAIR.n, Math.floor((z - STAIR.z0) / ((STAIR.z1 - STAIR.z0) / STAIR.n)) + 1); return i * STAIR.rise;
}
function floorHeightAt(xw, zw) {
  const s = stairHeightAt(xw, zw); if (s !== null) return s;
  const x = xw * 100 + 230, z = zw * 100 + 500;
  if (z < 0 || z > 805 || (z > 620 && x < 300)) return -0.1; return 0;
}

async function buildHouse() {
  M.concreteSlab = new THREE.MeshStandardMaterial({ color: 0x9a9690, roughness: 0.95 });
  const paint = plasterMat(0xece7df, 0.9);             // W1 乳膠漆
  const stone = plasterMat(0xb9b1a4, 0.97); stone.normalScale.set(0.9, 0.9); // W3 仿石塗料
  const ext = plasterMat(0xd9d3c8, 0.95);
  const H1 = 3.4; // 1F floor-to-floor 340 cm
  // ---- floors ----
  floorRect('living', 105, 465, 0, 620, 0, 1);
  floorRect('living', 300, 465, 620, 805, 0, 2);
  floorRect('bath', -5, 105, 393, 620, 0.001, 3);
  floorRect('stair', -5, 105, 0, 393, 0, 4);
  floorRect('park', -5, 300, 620, 1160, -0.1, 5);
  floorRect('park', 300, 465, 805, 1160, -0.1, 6);
  floorRect('yard', -5, 465, -300, 0, -0.1, 7);
  bx(105, 465, -0.1, 0, 619, 621, M.counter, { cast: false }); bx(300, 302, -0.1, 0, 621, 805, M.counter, { cast: false }); // step edges
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x8d8a85, roughness: 1 })); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.12; ground.receiveShadow = true; house.add(ground);
  // ---- party walls (both sides, row house) ----
  for (const [x, t] of [[-12.5, 15], [472.5, 15]]) {
    wallZ(x, 0, 1160, t, H1, ext); wallZ(x, -300, 0, t, 1.8, ext, [], -0.1);
  }
  bx(-20, 480, -0.1, 1.8, -307, -300, ext, { collide: true }); // rear boundary wall
  // interior face finishes on party walls: paint inside, stone coating in parking
  bx(-5.5, -5, -0.1, H1, 620, 1160, stone, { cast: false }); bx(465, 465.5, -0.1, H1, 620, 1160, stone, { cast: false });
  // ---- columns 50×50 at grids ----
  for (const x of [5, 455]) for (const z of [0, 620, 950]) bx(x - 25, x + 25, -0.1, H1, z - 25, z + 25, z === 950 ? stone : paint, { collide: true });
  // ---- A wall (rear): D2 door to yard, W2 window ----
  wallX(0, -5, 465, 20, H1, paint, [{ a: 120, b: 205, sill: 0, head: 2.2 }, { a: 285, b: 385, sill: 1.05, head: 2.2 }]);
  windowAlongX(0, 285, 385, 1.05, 2.2); doorPanel(true, 0, 120, 205, 2.2, 0.55, M.frame);
  // ---- B wall: W2a (bath), W1 (living→parking) ; x 300..465 opens to 玄關 ----
  wallX(620, -5, 300, 15, H1, paint, [{ a: 20, b: 90, sill: 1.5, head: 2.2 }, { a: 150, b: 290, sill: 0.4, head: 2.2 }]);
  windowAlongX(620, 20, 90, 1.5, 2.2); windowAlongX(620, 150, 290, 0.4, 2.2);
  // ---- 玄關 (vestibule) with D1 main door ----
  wallZ(300, 620, 805, 15, H1, paint, [{ a: 690, b: 790, sill: 0, head: 2.2 }]);
  doorPanel(false, 300, 690, 790, 2.2, -0.35, M.darkwood);
  wallX(805, 300, 465, 15, H1, paint);
  // ---- bathroom 浴廁 (115 × 227) ----
  wallX(393, -5, 105, 10, H1, paint); wallZ(110, 393, 620, 10, H1, paint, [{ a: 528, b: 603, sill: 0, head: 2.2 }]);
  doorPanel(false, 110, 528, 603, 2.2, 1.2, M.cabinet);
  tilePanel('bathwall', 50, 398.5, 110, 2.4, 0, 0, 11); tilePanel('bathwall', 50, 612, 110, 2.4, Math.PI, 0, 12);
  tilePanel('bathwall', -4.5, 506, 227, 2.4, Math.PI / 2, 0, 13); tilePanel('bathwall', 104.5, 506, 227, 2.4, -Math.PI / 2, 0, 14);
  // ---- stair: parapet toward kitchen + 17 steps ----
  wallZ(110, 60, 393, 10, 1.0, paint); bx(108, 112, 1.0, 1.05, 60, 393, M.darkwood);
  const stairMat = tileMaterial('nt3201_20', false); zones.stair.meshes.push({ mesh: { material: stairMat }, w: 0.3, d: 0.3, seed: 9 });
  const run = (STAIR.z1 - STAIR.z0) / STAIR.n;
  for (let i = 1; i <= STAIR.n; i++) {
    const z0 = STAIR.z0 + (i - 1) * run, z1 = z0 + run;
    bx(STAIR.x0, STAIR.x1, (i - 1) * STAIR.rise, i * STAIR.rise - 0.02, z0, z1, paint, { cast: true });
    bx(STAIR.x0, STAIR.x1 + 1, i * STAIR.rise - 0.02, i * STAIR.rise, z0 - 1.5, z1, stairMat);
  }
  // handrail on parapet side, rising
  const hr = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, Math.hypot(3.93, 3.4), 12), M.darkwood);
  hr.position.set(W(100), 1.7 + 0.9 - 0.2, Zw(196)); hr.rotation.x = Math.atan2(3.93, 3.4); house.add(hr);
  // ---- front facade at z≈1160: SW1 roll-up opening 340 wide (open), D5 meter-box door ----
  wallX(1160, 340, 465, 20, H1, stone, [{ a: 360, b: 450, sill: 0, head: 2.2 }]);
  bx(-5, 340, 2.6, H1, 1150, 1170, stone); bx(-5, 340, 2.45, 2.6, 1150, 1162, M.steel); // header + rolled shutter box
  doorPanel(true, 1160, 360, 450, 2.2, 0, M.steel);
  // ---- ceilings ----
  ceilingRect(105, 465, 0, 620, 3.0, 'C2');      // 客廳 C2 矽酸鈣板
  ceilingRect(300, 465, 620, 805, 3.0, 'C1');
  ceilingRect(-5, 105, 393, 620, 2.4, 'C2');     // 浴廁 C2
  ceilingRect(-5, 300, 620, 1160, H1, 'C3'); ceilingRect(300, 465, 805, 1160, H1, 'C3'); // 停車 C3 (同外牆)
  ceilingRect(-5, 105, 393, 620, H1, 'C1');      // slab over stair top / bath
  // skirting T1 (15cm 抗菌防霉水泥漆, darker)
  const sk = new THREE.MeshStandardMaterial({ color: 0x9c968d, roughness: 0.9 });
  bx(455, 465, 0, 0.15, 25, 595, sk, { cast: false }); bx(130, 300, 0, 0.15, 607, 612, sk, { cast: false });
  // ---- lights ----
  [[200, 120], [330, 120], [200, 470], [380, 470], [380, 300], [380, 700]].forEach(([x, z], i) => dl(x, z, 3.0, 5, i === 2));
  dl(50, 506, 2.4, 3, false); dl(150, 850, H1, 6, true); dl(150, 1050, H1, 5);
  // ---- kitchen (廚房) ----
  bx(400, 460, 0, 0.1, 30, 300, M.black); bx(402, 460, 0.1, 0.86, 30, 300, M.cabinet, { collide: true }); bx(398, 462, 0.86, 0.9, 28, 300, M.counter);
  bx(400, 458, 0.9, 0.906, 135, 195, new THREE.MeshPhysicalMaterial({ color: 0x0a0a0a, roughness: 0.05, clearcoat: 1 }), { cast: false });
  bx(425, 465, 1.55, 1.67, 135, 195, M.steel); bx(430, 465, 1.67, 2.3, 145, 185, M.steel);
  for (let z = 30; z < 300; z += 67.5) bx(398, 401, 0.15, 0.82, z + 1, z + 66, M.cabinet, { cast: false });
  bx(205, 390, 0, 0.1, 12, 70, M.black); bx(205, 390, 0.1, 0.86, 10, 68, M.cabinet, { collide: true }); bx(203, 392, 0.86, 0.9, 10, 72, M.counter);
  bx(305, 365, 0.9, 0.905, 22, 60, M.steel, { cast: false });
  const fau = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.3, 0), new THREE.Vector3(0, 0.36, 0.08), new THREE.Vector3(0, 0.3, 0.18)]), 24, 0.012, 10), M.chrome);
  fau.position.set(W(335), 0.9, Zw(14)); house.add(fau);
  bx(140, 200, 0, 1.85, 8, 75, new THREE.MeshPhysicalMaterial({ color: 0xd8d8d6, metalness: 0.6, roughness: 0.25 }), { collide: true, r: 0.01 }); // REF
  bx(120, 260, 0, 0.88, 255, 330, M.cabinet, { collide: true }); bx(116, 264, 0.88, 0.92, 251, 334, M.counter); // bar
  // ---- living (客廳) ----
  bx(140, 340, 0, 0.012, 380, 560, M.rug, { cast: false });
  bx(440, 465, 0, 0.45, 380, 560, M.oak, { collide: true });
  bx(462, 465, 1.0, 1.75, 400, 540, new THREE.MeshPhysicalMaterial({ color: 0x050505, roughness: 0.1, clearcoat: 1 }));
  // ---- bathroom fixtures (procedural) ----
  const tx = 50, tz = 398;
  const bw = new THREE.Mesh(new THREE.LatheGeometry([[0.0, 0.0], [0.12, 0.0], [0.1, 0.2], [0.17, 0.27], [0.19, 0.38], [0.17, 0.4], [0.05, 0.3], [0, 0.3]].map(p => new THREE.Vector2(...p)), 40), M.ceramic);
  bw.scale.set(1, 1, 1.3); bw.position.set(W(tx), 0, Zw(tz + 42)); bw.castShadow = true; house.add(bw);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.02, 40), M.ceramic); lid.scale.set(1, 1, 1.3); lid.position.set(W(tx), 0.41, Zw(tz + 42)); house.add(lid);
  bx(tx - 19, tx + 19, 0.38, 0.78, tz, tz + 17, M.ceramic, { r: 0.03 });
  bx(-5, 45, 0.8, 0.84, 555, 610, M.counter); const basin = new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [0.1, 0], [0.16, 0.03], [0.18, 0.12], [0.17, 0.125], [0.15, 0.035], [0, 0.012]].map(p => new THREE.Vector2(...p)), 36), M.ceramic);
  basin.position.set(W(20), 0.84, Zw(582)); basin.castShadow = true; house.add(basin);
  bx(-5, -4, 1.1, 1.8, 560, 605, new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.03 }));
  addCollider(25, 75, 398, 470);
  // ---- yard (後院): washer, utility sink ----
  bx(15, 75, -0.1, 0.8, -75, -15, new THREE.MeshPhysicalMaterial({ color: 0xf1f1f1, roughness: 0.3, clearcoat: 0.5 }), { collide: true, r: 0.02 });
  bx(240, 290, -0.1, 0.8, -50, -10, M.ceramic, { collide: true, r: 0.02 });
  // ---- CC0 furniture ----
  const jobs = [
    put('sofa_02', 165, 470, { ry: Math.PI / 2, fitW: 2.0 }),
    put('modern_coffee_table_01', 275, 470),
    put('bar_chair_round_01', 160, 360, { fitH: 0.95 }), put('bar_chair_round_01', 225, 360, { fitH: 0.95 }),
    put('potted_plant_02', 445, 595, { fitH: 1.1 }), put('potted_plant_04', 440, 780, { fitH: 0.8 }),
    put('covered_car', 140, 880, { y: -0.1 }),
    put('potted_plant_02', 420, -250, { fitH: 1.0, y: -0.1 }),
    put('cardboard_box_01', 400, 1100, { y: -0.1 }),
  ];
  await Promise.all(jobs);
  // sun from front (street side), ambient
  const sun = new THREE.DirectionalLight(0xfff0dc, 3.0); sun.position.set(W(600), 9, Zw(1900)); sun.target.position.set(W(230), 0, Zw(700));
  sun.castShadow = true; sun.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 30 }); sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.02;
  house.add(sun, sun.target); house.add(new THREE.HemisphereLight(0xeaf2ff, 0x857766, 0.35));
  for (const k in zones) applyZone(k);
}

// ---------------- walk / orbit controls ----------------
let mode = params.get('mode') || 'walk';
const walk = { yaw: Math.PI, pitch: -0.05, x: W(230), z: Zw(1080), keys: {}, move: { x: 0, y: 0 }, look: null, joy: null, eye: 1.55, y: 0 };
const el = renderer.domElement;
function setMode(m) {
  mode = m; $('modeBtn').textContent = m === 'walk' ? '切換：俯瞰環繞' : '切換：第一人稱漫遊';
  controls.enabled = m === 'orbit'; ceilings.visible = m === 'walk'; $('joy').style.display = m === 'walk' && ('ontouchstart' in window) ? '' : 'none';
  if (m === 'orbit') { controls.target.set(W(230), 0.5, Zw(450)); camera.position.set(W(900), 13, Zw(1500)); controls.maxDistance = 30; controls.maxPolarAngle = Math.PI * 0.49; camera.fov = 50; }
  else camera.fov = camera.aspect < 1 ? 75 : 65;
  camera.updateProjectionMatrix(); renderer.shadowMap.needsUpdate = true;
}
function collide(nx, nz) {
  const r = 0.22;
  for (const c of colliders) {
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
  if (newH - curH > 0.45) { nx = walk.x; nz = walk.z; }
  [nx, nz] = collide(nx, nz); walk.x = nx; walk.z = nz;
  const target = floorHeightAt(walk.x, walk.z); walk.y += (target - walk.y) * Math.min(1, dt * 10);
  camera.position.set(walk.x, walk.y + walk.eye, walk.z);
  camera.rotation.order = 'YXZ'; camera.rotation.set(walk.pitch, walk.yaw, 0);
}
let frameNo = 0;
function animate() { requestAnimationFrame(animate); frameNo++; stepWalk(); if (mode === 'orbit') controls.update(); composer.render(); }
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
  document.querySelectorAll('.go').forEach(b => b.onclick = () => { const [x, z, yaw] = b.dataset.p.split(',').map(Number); setMode('walk'); walk.x = W(x); walk.z = Zw(z); walk.yaw = yaw; walk.pitch = -0.08; walk.y = floorHeightAt(walk.x, walk.z); });
  $('quality').value = quality; $('quality').onchange = e => { const u = new URL(location.href); u.searchParams.set('q', e.target.value); location.href = u.toString(); };
}
window.__xie = { setMode, walk, W, Zw, camera, controls };

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
    const p = params.get('pos'); if (p) { const [x, z, yaw, pitch] = p.split(',').map(Number); walk.x = W(x); walk.z = Zw(z); walk.yaw = yaw; if (!isNaN(pitch)) walk.pitch = pitch; }
    walk.y = floorHeightAt(walk.x, walk.z);
    setMode(mode);
    $('loading').style.display = 'none'; window.__ready = true; animate();
  } catch (e) { console.error(e); $('loadtxt').textContent = '載入失敗：' + e.message; }
})();
