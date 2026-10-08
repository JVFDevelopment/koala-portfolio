import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const canvas = document.getElementById("world");
const isMobile = matchMedia("(max-width: 768px)").matches;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = !isMobile;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060d);
scene.fog = new THREE.FogExp2(0x05060d, 0.018);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 400);

// ---------- lights ----------
scene.add(new THREE.HemisphereLight(0x8a7bff, 0x0a0a1a, 0.9));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
sun.position.set(20, 30, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25 });
scene.add(sun);
const coreLight = new THREE.PointLight(0x7cf7c9, 60, 40, 1.6);
scene.add(coreLight);

// ---------- voxel island ----------
const voxels = []; // { target: Vector3, color: Color }
const add = (x, y, z, hex) => voxels.push({ target: new THREE.Vector3(x, y, z), color: new THREE.Color(hex) });
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

const boxGeo = new THREE.BoxGeometry(0.96, 0.96, 0.96);
const boxMat = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.05 });
const island = new THREE.InstancedMesh(boxGeo, boxMat, voxels.length);
island.castShadow = island.receiveShadow = true;
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

// ---------- glowing core + orbiting crystals ----------
const core = new THREE.Mesh(
  new THREE.IcosahedronGeometry(1.4, 0),
  new THREE.MeshStandardMaterial({ color: 0x7cf7c9, emissive: 0x7cf7c9, emissiveIntensity: 3, flatShading: true })
);
core.position.y = 9;
coreLight.position.copy(core.position);
world.add(core);

const crystals = [];
const crystalColors = [0x8a7bff, 0xff6fb5, 0x7cf7c9];
for (let i = 0; i < 14; i++) {
  const c = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.7, 0.7),
    new THREE.MeshStandardMaterial({ color: 0x000000, emissive: crystalColors[i % 3], emissiveIntensity: 2.5 })
  );
  c.userData = { r: 6 + rand() * 14, a: rand() * Math.PI * 2, s: 0.15 + rand() * 0.3, y: 2 + rand() * 12, b: rand() * 6 };
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

// ---------- post-processing ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.9, 0.6, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------- input ----------
const mouse = new THREE.Vector2(), smoothMouse = new THREE.Vector2();
let scrollT = 0, smoothScroll = 0;
addEventListener("pointermove", (e) => {
  mouse.set(e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5);
});
addEventListener("scroll", () => {
  scrollT = scrollY / Math.max(1, document.body.scrollHeight - innerHeight);
}, { passive: true });
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// ---------- loop ----------
const clock = new THREE.Clock();
let assembled = false;
const ease = (t) => 1 - Math.pow(1 - t, 4);

function tick() {
  const t = clock.getElapsedTime();
  smoothMouse.lerp(mouse, 0.05);
  smoothScroll += (scrollT - smoothScroll) * 0.06;

  // assemble voxels
  if (!assembled) {
    let allDone = true;
    voxels.forEach((v, i) => {
      const p = reduceMotion ? 1 : Math.min(1, Math.max(0, (t - v.delay) / 1.6));
      if (p < 1) allDone = false;
      const e = ease(p);
      dummy.position.lerpVectors(v.start, v.target, e);
      dummy.rotation.set(v.spin.x * (1 - e), v.spin.y * (1 - e), v.spin.z * (1 - e));
      dummy.scale.setScalar(0.2 + 0.8 * e);
      dummy.updateMatrix();
      island.setMatrixAt(i, dummy.matrix);
    });
    island.instanceMatrix.needsUpdate = true;
    assembled = allDone;
  }

  // world motion
  world.rotation.y = t * 0.05 + smoothScroll * Math.PI * 1.5;
  world.position.y = Math.sin(t * 0.6) * 0.4;
  // keep the island clear of the headline on wide screens, centre it as you scroll
  world.position.x = (camera.aspect > 1.2 ? 10 : 0) * (1 - Math.min(1, smoothScroll * 3));
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

  composer.render();
  requestAnimationFrame(tick);
}

// ---------- UI ----------
document.getElementById("yr").textContent = new Date().getFullYear();

const io = new IntersectionObserver((entries) => {
  entries.forEach((e) => e.isIntersecting && e.target.classList.add("in"));
}, { threshold: 0.15 });
document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

const cursor = document.querySelector(".cursor");
let cx = 0, cy = 0, tx = 0, ty = 0;
addEventListener("pointermove", (e) => { tx = e.clientX; ty = e.clientY; });
(function moveCursor() {
  cx += (tx - cx) * 0.2; cy += (ty - cy) * 0.2;
  cursor.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -50%)`;
  requestAnimationFrame(moveCursor);
})();
document.querySelectorAll("a, .card").forEach((el) => {
  el.addEventListener("pointerenter", () => cursor.classList.add("hover"));
  el.addEventListener("pointerleave", () => cursor.classList.remove("hover"));
});

document.querySelectorAll("[data-tilt]").forEach((card) => {
  card.addEventListener("pointermove", (e) => {
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    card.style.transform = `rotateY(${(x - .5) * 12}deg) rotateX(${(.5 - y) * 12}deg)`;
    card.style.setProperty("--mx", `${x * 100}%`);
    card.style.setProperty("--my", `${y * 100}%`);
  });
  card.addEventListener("pointerleave", () => { card.style.transform = ""; });
});

tick();
requestAnimationFrame(() => {
  document.getElementById("loader").classList.add("done");
  document.body.classList.add("loaded");
});

function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
