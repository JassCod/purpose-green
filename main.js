import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { RoundedBoxGeometry } from './vendor/RoundedBoxGeometry.js';

/* ------------------------------------------------------------------ */
/*  Palette                                                            */
/* ------------------------------------------------------------------ */
const C = {
  grass: 0x7fd36b,
  grassDark: 0x58b85a,
  soil: 0xc98a5a,
  soilDark: 0xa86d45,
  rock: 0x8c7a6b,
  trunk: 0x9a6a44,
  leaf1: 0x3fbf6a,
  leaf2: 0x8bdc5a,
  leaf3: 0x2a9a5c,
  white: 0xfbfaf5,
  cream: 0xfff3dc,
  roof: 0x2f9e63,
  panel: 0x23427a,
  water: 0x5ac8f2,
  cloud: 0xffffff,
  sun: 0xffd35c,
  pink: 0xff8fab,
  yellow: 0xffd35c,
  stone: 0xd9d4c7,
  window: 0x9fdcff,
};

const matCache = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...opts }));
  }
  return matCache.get(key);
}

function mesh(geo, material, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

/* ------------------------------------------------------------------ */
/*  Renderer / scene / camera                                          */
/* ------------------------------------------------------------------ */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
camera.position.set(11, 7.5, 13);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.6, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.enableZoom = false;
controls.enablePan = false;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.7;
controls.minPolarAngle = 0.75;
controls.maxPolarAngle = 1.4;

/* lights */
scene.add(new THREE.HemisphereLight(0xffffff, 0x9ed69a, 1.6));
const sunLight = new THREE.DirectionalLight(0xfff1d6, 2.6);
sunLight.position.set(-6, 11, 6);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.left = -7;
sunLight.shadow.camera.right = 7;
sunLight.shadow.camera.top = 7;
sunLight.shadow.camera.bottom = -7;
sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 30;
sunLight.shadow.bias = -0.0004;
sunLight.shadow.normalBias = 0.02;
sunLight.shadow.radius = 4;
scene.add(sunLight);
const fill = new THREE.DirectionalLight(0xd8f5ff, 0.6);
fill.position.set(8, 3, -6);
scene.add(fill);

/* ------------------------------------------------------------------ */
/*  World root (receives pointer parallax + float)                     */
/* ------------------------------------------------------------------ */
const world = new THREE.Group();
scene.add(world);

const island = new THREE.Group();
world.add(island);

const pops = []; // objects that pop in during the intro
function addPop(obj, delay) {
  obj.userData.targetScale = obj.scale.clone();
  obj.scale.setScalar(0.0001);
  pops.push({ obj, delay });
  return obj;
}

const TOP = 0.3; // y of grass surface

/* ---------- island body (lathe profiles) ---------- */
function lathe(points, segments, material, flat = false) {
  // profiles are authored top-down; Lathe wants bottom-up for outward-facing normals
  const geo = new THREE.LatheGeometry(points.slice().reverse().map(([x, y]) => new THREE.Vector2(x, y)), segments);
  if (flat) {
    const m = material.clone();
    m.flatShading = true;
    return mesh(geo, m);
  }
  return mesh(geo, material);
}

function buildIslandBody(r = 4) {
  const g = new THREE.Group();
  // grass cap with a soft rounded rim
  const grassPts = [[0, TOP]];
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * (Math.PI / 2);
    grassPts.push([r - 0.32 + Math.sin(a) * 0.32, TOP - 0.32 + Math.cos(a) * 0.32]);
  }
  grassPts.push([r, -0.18]);
  g.add(lathe(grassPts, 72, mat(C.grass)));

  // soil band
  g.add(lathe([[r * 0.995, -0.18], [r * 0.985, -0.55], [r * 0.95, -0.85], [r * 0.86, -1.05], [0, -1.05]], 72, mat(C.soil)));

  // faceted rock underside
  const rock = lathe(
    [[r * 0.87, -1.0], [r * 0.78, -1.5], [r * 0.6, -2.2], [r * 0.38, -2.9], [r * 0.16, -3.5], [0, -3.85]],
    11, mat(C.soilDark), true,
  );
  rock.rotation.y = 0.3;
  g.add(rock);
  return g;
}

const body = buildIslandBody();
island.add(body);
addPop(island, 0);

/* little dangling roots / rocks under the island */
for (let i = 0; i < 9; i++) {
  const a = (i / 9) * Math.PI * 2 + 0.4;
  const rr = 2.2 + Math.random() * 0.9;
  const s = 0.25 + Math.random() * 0.25;
  const pebble = mesh(new THREE.DodecahedronGeometry(s, 0), mat(C.soil, { flatShading: true }));
  pebble.position.set(Math.cos(a) * rr, -1.3 - Math.random() * 0.8, Math.sin(a) * rr);
  pebble.rotation.set(Math.random() * 3, Math.random() * 3, 0);
  island.add(pebble);
}

/* ---------- trees ---------- */
function roundTree(scale = 1, color = C.leaf1) {
  const t = new THREE.Group();
  const trunk = mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.7, 10), mat(C.trunk));
  trunk.position.y = 0.35;
  t.add(trunk);
  const crown = mesh(new THREE.IcosahedronGeometry(0.48, 2), mat(color));
  crown.position.y = 0.95;
  crown.scale.set(1, 1.12, 1);
  t.add(crown);
  const crown2 = mesh(new THREE.IcosahedronGeometry(0.3, 2), mat(color));
  crown2.position.set(0.25, 0.78, 0.18);
  t.add(crown2);
  t.scale.setScalar(scale);
  return t;
}

function pineTree(scale = 1, color = C.leaf3) {
  const t = new THREE.Group();
  const trunk = mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.4, 8), mat(C.trunk));
  trunk.position.y = 0.2;
  t.add(trunk);
  [[0.5, 0.65, 0.55], [0.4, 0.55, 0.9], [0.28, 0.45, 1.22]].forEach(([r, h, y]) => {
    const cone = mesh(new THREE.ConeGeometry(r, h, 18), mat(color));
    cone.position.y = y;
    t.add(cone);
  });
  t.scale.setScalar(scale);
  return t;
}

function bush(scale = 1, color = C.leaf2) {
  const b = new THREE.Group();
  [[0, 0.16, 0, 0.22], [0.2, 0.12, 0.05, 0.16], [-0.17, 0.11, 0.06, 0.15]].forEach(([x, y, z, r]) => {
    const s = mesh(new THREE.IcosahedronGeometry(r, 2), mat(color));
    s.position.set(x, y, z);
    b.add(s);
  });
  b.scale.setScalar(scale);
  return b;
}

const trees = [
  ['r', -2.9, 0.2, 1.1, C.leaf1], ['p', -2.4, -1.6, 1.15, C.leaf3], ['r', -0.4, -2.9, 0.95, C.leaf2],
  ['p', -1.3, -2.6, 0.9, C.leaf3], ['r', 2.9, -0.4, 0.85, C.leaf2], ['p', 3.1, 0.7, 0.8, C.leaf3],
  ['r', -0.2, 2.9, 0.8, C.leaf1], ['p', -1.4, 2.6, 0.95, C.leaf3], ['r', 1.8, 2.6, 0.7, C.leaf2],
  ['p', -3.2, -0.6, 0.75, C.leaf3], ['r', 1.1, -2.9, 0.7, C.leaf1],
];
trees.forEach(([kind, x, z, s, color], i) => {
  const t = kind === 'r' ? roundTree(s, color) : pineTree(s, color);
  t.position.set(x, TOP, z);
  t.rotation.y = Math.random() * Math.PI;
  island.add(t);
  addPop(t, 0.5 + i * 0.05);
});

[[-2.0, 2.0], [2.6, 1.6], [0.3, 2.2], [-3.0, 1.9], [2.2, -2.5], [-1.9, -0.6]].forEach(([x, z], i) => {
  const b = bush(0.9 + Math.random() * 0.4, i % 2 ? C.leaf2 : C.leaf1);
  b.position.set(x, TOP, z);
  island.add(b);
  addPop(b, 0.7 + i * 0.04);
});

/* flowers */
const flowerGeo = new THREE.IcosahedronGeometry(0.05, 1);
const stemGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.14, 4);
for (let i = 0; i < 40; i++) {
  const a = Math.random() * Math.PI * 2;
  const r = 1.0 + Math.random() * 2.7;
  const x = Math.cos(a) * r, z = Math.sin(a) * r;
  if (Math.hypot(x + 1.2, z + 0.5) < 1.2) continue; // keep house plot clear
  if (Math.hypot(x - 1.4, z - 0.9) < 1.1) continue; // solar plot
  if (Math.hypot(x - 0.8, z + 1.4) < 0.9) continue; // pond
  const f = new THREE.Group();
  const stem = mesh(stemGeo, mat(C.grassDark), { cast: false });
  stem.position.y = 0.07;
  const head = mesh(flowerGeo, mat([C.pink, C.yellow, C.white][i % 3]), { cast: false });
  head.position.y = 0.15;
  f.add(stem, head);
  f.position.set(x, TOP, z);
  island.add(f);
  addPop(f, 1.1 + Math.random() * 0.4);
}

/* ---------- eco house ---------- */
function house() {
  const h = new THREE.Group();
  const base = mesh(new RoundedBoxGeometry(1.5, 1.0, 1.25, 4, 0.08), mat(C.cream));
  base.position.y = 0.5;
  h.add(base);

  // gable roof via extruded triangle
  const shape = new THREE.Shape();
  shape.moveTo(-0.95, 0);
  shape.lineTo(0, 0.72);
  shape.lineTo(0.95, 0);
  shape.lineTo(-0.95, 0);
  const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: 1.45, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 3 });
  roofGeo.translate(0, 0, -0.725);
  const roof = mesh(roofGeo, mat(C.roof));
  roof.position.y = 0.98;
  h.add(roof);

  // solar panels on the roof slope
  const slope = Math.atan2(0.72, 0.95);
  const rp = mesh(new RoundedBoxGeometry(0.75, 0.04, 1.1, 2, 0.015), panelMaterial());
  rp.position.set(-0.47, 1.36, 0);
  rp.rotation.z = slope;
  h.add(rp);

  // chimney
  const ch = mesh(new RoundedBoxGeometry(0.2, 0.45, 0.2, 2, 0.03), mat(C.stone));
  ch.position.set(0.5, 1.45, -0.3);
  h.add(ch);

  // door + windows
  const door = mesh(new RoundedBoxGeometry(0.32, 0.55, 0.06, 2, 0.03), mat(C.trunk));
  door.position.set(0.25, 0.3, 0.64);
  h.add(door);
  const winMat = mat(C.window, { emissive: 0x6fc6ff, emissiveIntensity: 0.25, roughness: 0.3 });
  const w1 = mesh(new RoundedBoxGeometry(0.34, 0.3, 0.05, 2, 0.03), winMat);
  w1.position.set(-0.38, 0.58, 0.64);
  h.add(w1);
  const w2 = w1.clone();
  w2.rotation.y = Math.PI / 2;
  w2.position.set(0.77, 0.58, 0);
  h.add(w2);

  // green wall planter
  const planter = mesh(new RoundedBoxGeometry(0.5, 0.12, 0.14, 2, 0.03), mat(C.trunk));
  planter.position.set(-0.38, 0.36, 0.7);
  h.add(planter);
  const leaves = bush(0.45, C.leaf1);
  leaves.position.set(-0.38, 0.38, 0.7);
  h.add(leaves);
  return h;
}

function panelTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 256, 256);
  grd.addColorStop(0, '#3a6fd1');
  grd.addColorStop(1, '#1d3a78');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(220,235,255,0.75)';
  g.lineWidth = 5;
  for (let i = 0; i <= 4; i++) {
    g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, 256); g.stroke();
    g.beginPath(); g.moveTo(0, i * 64); g.lineTo(256, i * 64); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
let _panelMat;
function panelMaterial() {
  if (!_panelMat) {
    _panelMat = new THREE.MeshStandardMaterial({ map: panelTexture(), roughness: 0.25, metalness: 0.35 });
  }
  return _panelMat;
}

const home = house();
home.position.set(-1.1, TOP, -0.4);
home.rotation.y = 0.35;
island.add(home);
addPop(home, 0.3);

/* stepping-stone path from the door */
for (let i = 0; i < 6; i++) {
  const st = mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.05, 14), mat(C.stone), { cast: false });
  const t = i / 5;
  st.position.set(-0.65 + t * 0.9 + Math.sin(t * 4) * 0.15, TOP + 0.01, 0.4 + t * 2.4);
  st.scale.set(1 + Math.random() * 0.3, 1, 0.8 + Math.random() * 0.2);
  island.add(st);
  addPop(st, 0.9 + i * 0.05);
}

/* ---------- solar farm ---------- */
const solar = new THREE.Group();
for (let row = 0; row < 2; row++) {
  for (let col = 0; col < 3; col++) {
    const p = new THREE.Group();
    const post = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8), mat(0xb8c2c8, { metalness: 0.4, roughness: 0.4 }));
    post.position.y = 0.15;
    p.add(post);
    const panel = mesh(new RoundedBoxGeometry(0.62, 0.04, 0.48, 2, 0.015), panelMaterial());
    panel.position.y = 0.32;
    panel.rotation.x = -0.55;
    p.add(panel);
    p.position.set(col * 0.72 - 0.72, 0, row * 0.7 - 0.35);
    solar.add(p);
  }
}
solar.position.set(1.45, TOP, 0.95);
solar.rotation.y = -0.6;
island.add(solar);
addPop(solar, 0.6);

/* ---------- pond ---------- */
const pond = new THREE.Group();
const water = mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.04, 40), mat(C.water, { roughness: 0.15, metalness: 0.1, emissive: 0x1a7fb0, emissiveIntensity: 0.15 }), { cast: false });
water.scale.set(1.15, 1, 0.8);
water.position.y = 0.02;
pond.add(water);
for (let i = 0; i < 14; i++) {
  const a = (i / 14) * Math.PI * 2;
  const s = mesh(new THREE.DodecahedronGeometry(0.1 + Math.random() * 0.05, 0), mat(C.stone, { flatShading: true }));
  s.position.set(Math.cos(a) * 0.95, 0.04, Math.sin(a) * 0.68);
  s.scale.y = 0.6;
  pond.add(s);
}
const lilies = [];
[[0.2, 0.15], [-0.3, -0.1], [0.35, -0.25]].forEach(([x, z]) => {
  const l = mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.015, 16, 1, false, 0, Math.PI * 1.75), mat(C.leaf1), { cast: false });
  l.position.set(x, 0.05, z);
  pond.add(l);
  lilies.push(l);
});
pond.position.set(0.85, TOP, -1.55);
island.add(pond);
addPop(pond, 0.45);

/* ---------- wind turbines ---------- */
const rotors = [];
function turbine(height = 3.6) {
  const t = new THREE.Group();
  const white = mat(C.white, { roughness: 0.45 });
  const tower = mesh(new THREE.CylinderGeometry(0.05, 0.12, height, 16), white);
  tower.position.y = height / 2;
  t.add(tower);
  const base = mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.08, 20), mat(C.stone));
  base.position.y = 0.04;
  t.add(base);
  const nacelle = mesh(new RoundedBoxGeometry(0.18, 0.18, 0.42, 3, 0.07), white);
  nacelle.position.set(0, height + 0.02, -0.05);
  t.add(nacelle);

  const rotor = new THREE.Group();
  rotor.position.set(0, height + 0.02, 0.2);
  const hub = mesh(new THREE.SphereGeometry(0.1, 20, 14), white);
  hub.scale.z = 1.4;
  rotor.add(hub);

  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(-0.05, 0);
  bladeShape.quadraticCurveTo(-0.1, 0.4, -0.03, 1.55);
  bladeShape.lineTo(0.02, 1.6);
  bladeShape.quadraticCurveTo(0.07, 0.4, 0.05, 0);
  const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.025, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2 });
  for (let i = 0; i < 3; i++) {
    const b = mesh(bladeGeo, white);
    b.rotation.z = (i / 3) * Math.PI * 2;
    b.position.z = 0.02;
    rotor.add(b);
  }
  // green tip accent
  t.add(rotor);
  rotors.push(rotor);
  return t;
}

const t1 = turbine(3.8);
t1.position.set(-2.2, TOP, 1.35);
t1.rotation.y = 0.75;
island.add(t1);
addPop(t1, 0.35);

const t2 = turbine(3.1);
t2.position.set(2.1, TOP, -1.9);
t2.rotation.y = 0.75;
island.add(t2);
addPop(t2, 0.45);

const t3 = turbine(2.6);
t3.position.set(-0.4, TOP, -3.0);
t3.rotation.y = 0.75;
island.add(t3);
addPop(t3, 0.55);

/* ---------- soft contact shadow under the island ---------- */
function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, 'rgba(30,90,50,0.35)');
  grd.addColorStop(0.55, 'rgba(30,90,50,0.12)');
  grd.addColorStop(1, 'rgba(30,90,50,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}
const blob = new THREE.Mesh(
  new THREE.PlaneGeometry(9, 9),
  new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }),
);
blob.rotation.x = -Math.PI / 2;
blob.position.y = -5.2;
scene.add(blob);

/* ---------- mini floating islets ---------- */
const islets = [];
function islet(r, withTree) {
  const g = new THREE.Group();
  const b = buildIslandBody(4);
  b.scale.setScalar(r / 4);
  g.add(b);
  if (withTree === 'tree') {
    const t = roundTree(0.8, C.leaf2);
    t.position.y = TOP * (r / 4);
    g.add(t);
  } else if (withTree === 'pine') {
    const t = pineTree(0.7);
    t.position.y = TOP * (r / 4);
    g.add(t);
  } else if (withTree === 'panel') {
    const p = mesh(new RoundedBoxGeometry(0.55, 0.04, 0.4, 2, 0.015), panelMaterial());
    p.position.y = TOP * (r / 4) + 0.22;
    p.rotation.x = -0.5;
    const post = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 8), mat(0xb8c2c8));
    post.position.y = TOP * (r / 4) + 0.1;
    g.add(p, post);
  }
  return g;
}
[
  [0.6, 'tree', 3.7, 1.0, -3.0],
  [0.5, 'pine', -4.6, -0.2, -1.2],
  [0.45, 'panel', 2.6, -1.9, 3.6],
].forEach(([r, kind, x, y, z], i) => {
  const g = islet(r, kind);
  g.position.set(x, y, z);
  g.userData.baseY = y;
  g.userData.phase = i * 2.1;
  world.add(g);
  islets.push(g);
  addPop(g, 1.0 + i * 0.12);
});

/* ---------- clouds ---------- */
const clouds = [];
function cloud(scale) {
  const g = new THREE.Group();
  const m = mat(C.cloud, { roughness: 1 });
  [[0, 0, 0, 0.55], [0.55, -0.08, 0.05, 0.42], [-0.55, -0.1, 0, 0.4], [0.2, 0.3, -0.05, 0.4], [-0.25, 0.22, 0.1, 0.35]].forEach(([x, y, z, r]) => {
    const s = mesh(new THREE.IcosahedronGeometry(r, 3), m, { cast: false, receive: false });
    s.position.set(x, y, z);
    g.add(s);
  });
  g.scale.set(scale, scale * 0.85, scale);
  return g;
}
[[1.0, -4.5, 3.4, 1.5], [0.8, 3.6, 4.0, -2.8], [0.6, 2.8, 2.6, 3.2], [0.7, -3.4, 4.6, -3.2]].forEach(([s, x, y, z], i) => {
  const c = cloud(s);
  c.position.set(x, y, z);
  c.userData.base = c.position.clone();
  c.userData.phase = i * 1.7;
  world.add(c);
  clouds.push(c);
  addPop(c, 1.2 + i * 0.1);
});

/* ---------- sun ---------- */
const sun = new THREE.Group();
const sunCore = new THREE.Mesh(new THREE.SphereGeometry(0.75, 40, 30), new THREE.MeshBasicMaterial({ color: C.sun }));
sun.add(sunCore);
function haloTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 30, 128, 128, 128);
  grd.addColorStop(0, 'rgba(255,214,92,0.65)');
  grd.addColorStop(1, 'rgba(255,214,92,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}
const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture(), transparent: true, depthWrite: false }));
halo.scale.setScalar(4);
sun.add(halo);
sun.position.set(-4.8, 5.6, -4.5);
world.add(sun);
addPop(sun, 0.8);

/* ---------- rising leaf / pollen particles ---------- */
const PCOUNT = 90;
const pGeo = new THREE.BufferGeometry();
const pPos = new Float32Array(PCOUNT * 3);
const pCol = new Float32Array(PCOUNT * 3);
const pSpeed = new Float32Array(PCOUNT);
const palette = [new THREE.Color(0x8bdc5a), new THREE.Color(0xffd35c), new THREE.Color(0xffffff), new THREE.Color(0x3fbf6a)];
for (let i = 0; i < PCOUNT; i++) {
  const a = Math.random() * Math.PI * 2;
  const r = 1.5 + Math.random() * 5;
  pPos.set([Math.cos(a) * r, -3 + Math.random() * 9, Math.sin(a) * r], i * 3);
  const col = palette[i % palette.length];
  pCol.set([col.r, col.g, col.b], i * 3);
  pSpeed[i] = 0.2 + Math.random() * 0.5;
}
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.8)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const particles = new THREE.Points(pGeo, new THREE.PointsMaterial({
  size: 0.14, map: dotTexture(), vertexColors: true, transparent: true, depthWrite: false, opacity: 0.9,
}));
world.add(particles);

/* ------------------------------------------------------------------ */
/*  Resize                                                             */
/* ------------------------------------------------------------------ */
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // pull the camera back on narrow viewports so the island always fits
  const dist = camera.aspect < 0.9 ? 23 : camera.aspect < 1.2 ? 20 : 18.5;
  const dir = camera.position.clone().sub(controls.target).normalize();
  camera.position.copy(controls.target).addScaledVector(dir, dist);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);
resize();

/* ------------------------------------------------------------------ */
/*  Pointer parallax                                                   */
/* ------------------------------------------------------------------ */
const pointer = { x: 0, y: 0 };
window.addEventListener('pointermove', (e) => {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
});

/* ------------------------------------------------------------------ */
/*  Animation loop                                                     */
/* ------------------------------------------------------------------ */
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (reduceMotion) controls.autoRotate = false;

const easeOutBack = (t) => {
  const c1 = 1.6, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

let visible = true;
new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);

const clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  if (!visible) { clock.getDelta(); return; }
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  // intro pop-in
  for (const p of pops) {
    const k = THREE.MathUtils.clamp((t - p.delay) / 0.7, 0, 1);
    const s = reduceMotion ? 1 : easeOutBack(k);
    p.obj.scale.copy(p.obj.userData.targetScale).multiplyScalar(Math.max(s, 0.0001));
  }

  // float + parallax
  world.position.y = Math.sin(t * 0.8) * 0.15;
  world.rotation.x += ((pointer.y * 0.08) - world.rotation.x) * 0.05;
  world.rotation.z += ((-pointer.x * 0.06) - world.rotation.z) * 0.05;
  blob.scale.setScalar(1 - Math.sin(t * 0.8) * 0.04);

  rotors.forEach((r, i) => { r.rotation.z -= dt * (2.2 + i * 0.4); });
  lilies.forEach((l, i) => { l.rotation.y += dt * 0.2 * (i % 2 ? 1 : -1); });

  islets.forEach((g) => {
    g.position.y = g.userData.baseY + Math.sin(t * 1.1 + g.userData.phase) * 0.25;
    g.rotation.y += dt * 0.15;
  });
  clouds.forEach((c) => {
    c.position.x = c.userData.base.x + Math.sin(t * 0.25 + c.userData.phase) * 0.5;
    c.position.y = c.userData.base.y + Math.sin(t * 0.6 + c.userData.phase) * 0.12;
  });
  halo.material.rotation = t * 0.1;
  halo.scale.setScalar(4 + Math.sin(t * 1.5) * 0.25);

  const pos = pGeo.attributes.position;
  for (let i = 0; i < PCOUNT; i++) {
    let y = pos.getY(i) + dt * pSpeed[i];
    if (y > 6) y = -3;
    pos.setY(i, y);
    pos.setX(i, pos.getX(i) + Math.sin(t + i) * dt * 0.08);
  }
  pos.needsUpdate = true;

  controls.update();
  renderer.render(scene, camera);
}
tick();

/* ------------------------------------------------------------------ */
/*  Page UI: counters + scroll reveal                                  */
/* ------------------------------------------------------------------ */
function countUp(el) {
  const target = parseFloat(el.dataset.count);
  const dec = parseInt(el.dataset.dec || '0', 10);
  const start = performance.now();
  const dur = 1800;
  (function step(now) {
    const k = Math.min((now - start) / dur, 1);
    const v = target * (1 - Math.pow(1 - k, 3));
    el.textContent = v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    if (k < 1) requestAnimationFrame(step);
  })(start);
}

const io = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (!e.isIntersecting) return;
    e.target.classList.add('in');
    e.target.querySelectorAll('[data-count]').forEach(countUp);
    if (e.target.matches('[data-count]')) countUp(e.target);
    io.unobserve(e.target);
  });
}, { threshold: 0.2 });

document.querySelectorAll('.stats, .card, .projects, .join, .section-head').forEach((el) => {
  el.classList.add('reveal');
  io.observe(el);
});
document.querySelectorAll('.float-card [data-count]').forEach((el) => setTimeout(() => countUp(el), 900));
