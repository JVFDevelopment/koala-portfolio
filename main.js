import * as THREE from "three";

const canvas = document.getElementById("world");
const isMobile = matchMedia("(max-width: 768px)").matches;
const coarse = matchMedia("(pointer: coarse)").matches;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- quality ----------
// Start at a level guessed from the device, then step down whenever the frame
// rate sags, so phones and weak GPUs still get a smooth page. ?q=0-3 pins a level.
const LEVELS = [
  { dpr: 1, post: false, shadows: false },
  { dpr: 1.5, post: false, shadows: false }, // phones start here
  { dpr: 1.25, post: true, shadows: false },
  { dpr: 1.5, post: true, shadows: true }, // capable desktops
];
const forced = new URLSearchParams(location.search).get("q");
const pinned = /^[0-3]$/.test(forced);
let level = pinned ? +forced
  : coarse || isMobile ? 1
  : (navigator.hardwareConcurrency || 8) <= 4 ? 2 : 3;

// Apply fog before tone mapping, as the post-processing path effectively does. Otherwise
// levels that draw straight to the screen fog already-tone-mapped colour, which greys
// out the glowing pieces. Render-target passes skip both steps, so post is unaffected.
for (const shader of Object.values(THREE.ShaderLib)) {
  shader.fragmentShader = shader.fragmentShader.replace(
    /(#include <tonemapping_fragment>\s*#include <colorspace_fragment>)(\s*)(#include <fog_fragment>)/,
    "$3$2$1"
  );
}

// ---------- scene ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060d);
scene.fog = new THREE.FogExp2(0x05060d, 0.018);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 400);

// ---------- lights ----------
scene.add(new THREE.HemisphereLight(0x8a7bff, 0x0a0a1a, 0.9));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
const sunOffset = new THREE.Vector3(20, 30, 10);
// the sun follows the island around, so its shadow camera can stay tight
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.normalBias = 0.02;
Object.assign(sun.shadow.camera, { left: -19, right: 19, top: 19, bottom: -19, near: 10, far: 70 });
scene.add(sun, sun.target);
const coreLight = new THREE.PointLight(0x7cf7c9, 60, 40, 1.6);
scene.add(coreLight);

// ---------- voxel island ----------
const cells = new Map(); // "x,y,z" -> hex
const add = (x, y, z, hex) => cells.set(`${x},${y},${z}`, hex);
const R = isMobile ? 11 : 14;
const height = (x, z) => Math.round(1.6 * Math.sin(x * 0.35) * Math.cos(z * 0.3) + Math.sin((x + z) * 0.18) * 1.2);

for (let x = -R; x <= R; x++) {
  for (let z = -R; z <= R; z++) {
    const d = Math.hypot(x, z) + Math.sin(x * 1.7 + z) * 0.9;
    if (d > R) continue;
    const top = height(x, z);
    // tapering underside: deeper toward the centre
    const depth = Math.floor((1 - d / R) * 11) + 2;
    for (let y = top; y > top - depth; y--) {
      let c;
      if (y === top) c = (x * 7 + z * 13) % 5 === 0 ? 0x6ee08f : 0x4fc77a;
      else if (y > top - 3) c = 0x8a5a3c;
      else c = (x + y + z) % 3 === 0 ? 0x4a4d63 : 0x5b5f78;
      add(x, y, z, c);
    }
  }
}
// trees
const rand = mulberry(7);
for (let i = 0; i < (isMobile ? 6 : 10); i++) {
  const a = rand() * Math.PI * 2, r = rand() * (R - 4) + 2;
  const tx = Math.round(Math.cos(a) * r), tz = Math.round(Math.sin(a) * r);
  const base = height(tx, tz) + 1, h = 3 + Math.floor(rand() * 3);
  for (let y = 0; y < h; y++) add(tx, base + y, tz, 0x6b4428);
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) for (let y = 0; y < 3; y++) {
    if (Math.abs(x) + Math.abs(z) + y > 3) continue;
    add(tx + x, base + h + y - 1, tz + z, y === 2 ? 0x9cf0a8 : 0x3fae6b);
  }
}

// skip voxels buried on all six sides: they can never be seen once assembled
const voxels = []; // { target: Vector3, color: Color }
const filled = (x, y, z) => cells.has(`${x},${y},${z}`);
for (const [key, hex] of cells) {
  const [x, y, z] = key.split(",").map(Number);
  if (filled(x + 1, y, z) && filled(x - 1, y, z) && filled(x, y + 1, z) &&
      filled(x, y - 1, z) && filled(x, y, z + 1) && filled(x, y, z - 1)) continue;
  voxels.push({ target: new THREE.Vector3(x, y, z), color: new THREE.Color(hex) });
}

const boxGeo = new THREE.BoxGeometry(0.96, 0.96, 0.96);
const boxMat = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.05 });
const island = new THREE.InstancedMesh(boxGeo, boxMat, voxels.length);
island.castShadow = true;
island.frustumCulled = false; // always in view, and its bounds change while it assembles
const dummy = new THREE.Object3D();
voxels.forEach((v, i) => {
  island.setColorAt(i, v.color);
  // scattered start position, assembled by distance from centre
  v.start = v.target.clone().add(new THREE.Vector3((rand() - .5) * 60, 30 + rand() * 40, (rand() - .5) * 60));
  v.delay = v.target.length() * 0.03 + (v.target.y + 15) * 0.02 + rand() * 0.4;
  v.spin = new THREE.Euler(rand() * 6, rand() * 6, rand() * 6);
});
const world = new THREE.Group();
world.add(island);
scene.add(world);

// ---------- glow sprites (stand in for bloom on the lighter levels) ----------
const glowMap = (() => {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.2, "rgba(255,255,255,.6)");
  grad.addColorStop(0.5, "rgba(255,255,255,.15)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const halos = [];
function addHalo(parent, color, size, opacity) {
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    // fog would grey the glow out; bloom isn't fogged either
    map: glowMap, color, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  halo.scale.setScalar(size);
  parent.add(halo);
  halos.push(halo);
}

// ---------- glowing core + orbiting crystals ----------
const core = new THREE.Mesh(
  new THREE.IcosahedronGeometry(1.4, 0),
  new THREE.MeshStandardMaterial({ color: 0x7cf7c9, emissive: 0x7cf7c9, emissiveIntensity: 3, flatShading: true })
);
core.position.y = 9;
coreLight.position.copy(core.position);
addHalo(core, 0x7cf7c9, 7, 0.9);
addHalo(core, 0x7cf7c9, 22, 0.35); // wide wash, like bloom spilling over the island
world.add(core);

const crystals = [];
const crystalGeo = new THREE.BoxGeometry(0.7, 0.7, 0.7);
const crystalColors = [0x8a7bff, 0xff6fb5, 0x7cf7c9];
const crystalMats = crystalColors.map((hex) =>
  new THREE.MeshStandardMaterial({ color: 0x000000, emissive: hex, emissiveIntensity: 2.5 }));
for (let i = 0; i < 14; i++) {
  const c = new THREE.Mesh(crystalGeo, crystalMats[i % 3]);
  c.userData = { r: 6 + rand() * 14, a: rand() * Math.PI * 2, s: 0.15 + rand() * 0.3, y: 2 + rand() * 12, b: rand() * 6 };
  addHalo(c, crystalColors[i % 3], 3.5, 0.9);
  crystals.push(c);
  world.add(c);
}

// ---------- star field ----------
const starCount = isMobile ? 1500 : 4000;
const starPos = new Float32Array(starCount * 3);
for (let i = 0; i < starCount; i++) {
  const r = 80 + rand() * 120, t = rand() * Math.PI * 2, p = Math.acos(2 * rand() - 1);
  starPos.set([r * Math.sin(p) * Math.cos(t), r * Math.cos(p), r * Math.sin(p) * Math.sin(t)], i * 3);
}
const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 0.5, color: 0xc9ccff, transparent: true, opacity: 0.85, fog: false }));
scene.add(stars);

// ---------- floating dust ----------
const dustCount = 600;
const dustPos = new Float32Array(dustCount * 3);
for (let i = 0; i < dustCount; i++) dustPos.set([(rand() - .5) * 60, (rand() - .5) * 40, (rand() - .5) * 60], i * 3);
const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: 0.12, color: 0x7cf7c9, transparent: true, opacity: 0.6 }));
scene.add(dust);

// ---------- renderer ----------
let renderer = null;
try {
  // levels with post-processing render into their own buffers, so canvas MSAA would be wasted there
  renderer = new THREE.WebGLRenderer({ canvas, antialias: !LEVELS[level].post, stencil: false, powerPreference: "high-performance" });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
} catch (err) {
  console.warn("WebGL unavailable; showing the page without the 3D world.", err);
}

// post-processing is only downloaded on levels that use it
let composer = null;
async function createComposer() {
  const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
    import("three/addons/postprocessing/EffectComposer.js"),
    import("three/addons/postprocessing/RenderPass.js"),
    import("three/addons/postprocessing/UnrealBloomPass.js"),
    import("three/addons/postprocessing/OutputPass.js"),
  ]);
  const c = new EffectComposer(renderer);
  c.addPass(new RenderPass(scene, camera));
  c.addPass(new UnrealBloomPass(new THREE.Vector2(size.w, size.h), 0.9, 0.6, 0.82));
  c.addPass(new OutputPass());
  return c;
}

async function applyLevel(next) {
  if (LEVELS[next].post && !composer) {
    try { composer = await createComposer(); } catch { next = 1; } // addons failed to load
  }
  level = next;
  const q = LEVELS[level];
  renderer.setPixelRatio(Math.min(devicePixelRatio, q.dpr));
  composer?.setPixelRatio(renderer.getPixelRatio());
  sun.castShadow = island.receiveShadow = q.shadows;
  halos.forEach((h) => (h.visible = !q.post));
  document.documentElement.classList.toggle("lite", !q.post);
  settleUntil = performance.now() + 1000;
}

// ---------- input / sizing ----------
const mouse = new THREE.Vector2(), smoothMouse = new THREE.Vector2();
let smoothScroll = 0, maxScroll = 1, resizeQueued = false;
const size = { w: 0, h: 0 };
addEventListener("pointermove", (e) => {
  mouse.set(e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5);
});
const measure = () => { maxScroll = Math.max(1, document.documentElement.scrollHeight - innerHeight); };
new ResizeObserver(measure).observe(document.body);
addEventListener("resize", () => { measure(); resizeQueued = true; });
document.addEventListener("visibilitychange", () => { settleUntil = performance.now() + 1000; });

// The canvas is sized in CSS to the large viewport, so a phone's URL bar
// sliding in and out doesn't change it and doesn't reallocate any buffers.
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h || (w === size.w && h === size.h)) return; // hidden, or unchanged
  size.w = w; size.h = h;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  composer?.setSize(w, h);
}

// ---------- adaptive quality ----------
let settleUntil = 0, sampleFrom = 0, sampleFrames = 0, frameCap = 0;
function govern(now, gap) {
  if (pinned || frameCap) return;
  // skip warm-up after a level change, and long stalls (tab switches, one-off hitches)
  if (now < settleUntil || gap > 1000) { sampleFrom = 0; return; }
  if (!sampleFrom) { sampleFrom = now; sampleFrames = 0; return; }
  sampleFrames++;
  if (now - sampleFrom < 2000) return;
  const fps = (sampleFrames * 1000) / (now - sampleFrom);
  sampleFrom = 0;
  if (fps >= 48) return;
  if (level > 0) applyLevel(Math.max(0, level - (fps < 24 ? 2 : 1))); // far off the pace: skip a level
  else if (fps < 40) frameCap = 1000 / 30; // even the lightest level struggles: hold a steady 30
}

// ---------- loop ----------
const ease = (t) => 1 - Math.pow(1 - t, 4);
let t0 = 0, last = 0, pending = voxels.length;

function tick(now) {
  requestAnimationFrame(tick);
  if (frameCap && now - last < frameCap - 2) return;
  const gap = now - last;
  last = now;
  govern(now, gap);
  if (resizeQueued) { resizeQueued = false; resize(); }

  const t = (now - t0) / 1000;
  const f = Math.min(gap, 100) / (1000 / 60); // elapsed time in 60fps frames, so smoothing is frame-rate independent
  smoothMouse.lerp(mouse, 1 - Math.pow(0.95, f));
  smoothScroll += (scrollY / maxScroll - smoothScroll) * (1 - Math.pow(0.94, f));

  // assemble voxels
  if (pending) {
    for (let i = 0; i < voxels.length; i++) {
      const v = voxels[i];
      if (v.done) continue;
      const p = reduceMotion ? 1 : Math.min(1, Math.max(0, (t - v.delay) / 1.6));
      if (p === 1) { v.done = true; pending--; }
      const e = ease(p);
      dummy.position.lerpVectors(v.start, v.target, e);
      dummy.rotation.set(v.spin.x * (1 - e), v.spin.y * (1 - e), v.spin.z * (1 - e));
      dummy.scale.setScalar(0.2 + 0.8 * e);
      dummy.updateMatrix();
      island.setMatrixAt(i, dummy.matrix);
    }
    island.instanceMatrix.needsUpdate = true;
  }

  // world motion
  world.rotation.y = t * 0.05 + smoothScroll * Math.PI * 1.5;
  world.position.y = Math.sin(t * 0.6) * 0.4;
  // keep the island clear of the headline on wide screens, centre it as you scroll
  world.position.x = (camera.aspect > 1.2 ? 10 : 0) * (1 - Math.min(1, smoothScroll * 3));
  sun.position.copy(world.position).add(sunOffset);
  sun.target.position.copy(world.position);
  core.rotation.set(t * 0.4, t * 0.6, 0);
  core.scale.setScalar(1 + Math.sin(t * 2) * 0.08);
  coreLight.intensity = 50 + Math.sin(t * 2) * 15;
  crystals.forEach((c) => {
    const u = c.userData;
    c.position.set(Math.cos(u.a + t * u.s) * u.r, u.y + Math.sin(t + u.b) * 1.2, Math.sin(u.a + t * u.s) * u.r);
    c.rotation.set(t + u.b, t * 0.7, 0);
  });
  stars.rotation.y = t * 0.005;
  dust.rotation.y = -t * 0.02;
  dust.position.y = Math.sin(t * 0.3) * 1.5;

  // camera: dolly in + drop as you scroll, parallax with mouse
  const dist = (isMobile ? 52 : 42) - smoothScroll * 16;
  const camY = 14 - smoothScroll * 20;
  camera.position.set(smoothMouse.x * 6 + dist * 0.35, camY - smoothMouse.y * 4, dist);
  camera.lookAt(0, 3 - smoothScroll * 6, 0);

  if (LEVELS[level].post) composer.render();
  else renderer.render(scene, camera);
}

function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- start ----------
if (renderer) {
  resize();
  await applyLevel(level);
  t0 = last = performance.now();
  tick(t0);
} else {
  canvas.remove();
}
dispatchEvent(new Event("worldready"));
