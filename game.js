import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { RoundedBoxGeometry } from './vendor/RoundedBoxGeometry.js';

/* ================================================================== */
/*  Constants & palette                                                */
/* ================================================================== */
const ISLAND_R = 6;
const TOP = 0.3;
const SAVE_KEY = 'purpose-green-island-v1';

const C = {
  grass: new THREE.Color(0x7fd36b),
  grassDead: new THREE.Color(0xa8a27a),
  soil: 0xc98a5a,
  soilDark: 0xa86d45,
  trunk: 0x9a6a44,
  leaf1: 0x3fbf6a,
  leaf2: 0x8bdc5a,
  leaf3: 0x2a9a5c,
  white: 0xfbfaf5,
  cream: 0xfff3dc,
  roof: 0x2f9e63,
  water: 0x5ac8f2,
  stone: 0xd9d4c7,
  pink: 0xff8fab,
  yellow: 0xffd35c,
  purple: 0xb48cff,
  coal: 0x7d8590,
};

const clock = new THREE.Clock();
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;

const matCache = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...opts }));
  return matCache.get(key);
}
function mesh(geo, material, cast = true, receive = true) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

/* ================================================================== */
/*  Renderer, scene, camera                                            */
/* ================================================================== */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 300);
camera.position.set(17, 13, 19);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.5, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.enablePan = false;
controls.minDistance = 9;
controls.maxDistance = 42;
controls.maxPolarAngle = 1.5;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.8;

/* ---------- sky dome ---------- */
const skyUniforms = { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } };
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(140, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: skyUniforms,
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying vec3 vP;
      void main(){ float h = smoothstep(-0.45, 0.45, vP.y); gl_FragColor = vec4(mix(bottom, top, h), 1.0);
      #include <colorspace_fragment>
      }`,
  }),
);
scene.add(sky);

/* stars */
const starGeo = new THREE.BufferGeometry();
{
  const p = [];
  for (let i = 0; i < 900; i++) {
    const th = Math.random() * Math.PI * 2, ph = Math.acos(rand(0.05, 1));
    p.push(Math.cos(th) * Math.sin(ph) * 120, Math.cos(ph) * 120, Math.sin(th) * Math.sin(ph) * 120);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
}
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.9, transparent: true, opacity: 0, depthWrite: false, fog: false }));
scene.add(stars);

/* ---------- lights ---------- */
const hemi = new THREE.HemisphereLight(0xffffff, 0x9ed69a, 1.4);
scene.add(hemi);
const sunLight = new THREE.DirectionalLight(0xfff1d6, 2.6);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
Object.assign(sunLight.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 70 });
sunLight.shadow.bias = -0.0004;
sunLight.shadow.normalBias = 0.03;
scene.add(sunLight, sunLight.target);
const moonLight = new THREE.DirectionalLight(0x9db8ff, 0.3);
scene.add(moonLight);

/* visible sun & moon */
function glowTexture(rgb) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 8, 64, 64, 64);
  grd.addColorStop(0, `rgba(${rgb},0.8)`);
  grd.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
const sunOrb = new THREE.Group();
sunOrb.add(new THREE.Mesh(new THREE.SphereGeometry(2.2, 32, 20), new THREE.MeshBasicMaterial({ color: 0xffd35c, fog: false })));
const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('255,214,92'), transparent: true, depthWrite: false, fog: false }));
sunGlow.scale.setScalar(14);
sunOrb.add(sunGlow);
scene.add(sunOrb);
const moonOrb = new THREE.Group();
moonOrb.add(new THREE.Mesh(new THREE.SphereGeometry(1.4, 24, 16), new THREE.MeshBasicMaterial({ color: 0xeef2ff, fog: false })));
const moonGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('200,215,255'), transparent: true, depthWrite: false, fog: false }));
moonGlow.scale.setScalar(8);
moonOrb.add(moonGlow);
scene.add(moonOrb);

scene.fog = new THREE.Fog(0xbfe9ff, 60, 140);

/* ================================================================== */
/*  Island                                                             */
/* ================================================================== */
const world = new THREE.Group();
scene.add(world);

const grassMat = new THREE.MeshStandardMaterial({ color: C.grass.clone(), roughness: 0.9 });

function lathe(points, segments, material) {
  // profiles are authored top-down; Lathe wants bottom-up for outward-facing normals
  const geo = new THREE.LatheGeometry(points.slice().reverse().map(([x, y]) => new THREE.Vector2(x, y)), segments);
  return mesh(geo, material);
}

function islandBody(r, grass = grassMat) {
  const g = new THREE.Group();
  const pts = [[0, TOP]];
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * (Math.PI / 2);
    pts.push([r - 0.35 + Math.sin(a) * 0.35, TOP - 0.35 + Math.cos(a) * 0.35]);
  }
  pts.push([r, -0.2]);
  const cap = lathe(pts, 80, grass);
  g.add(cap);
  g.add(lathe([[r * 0.995, -0.2], [r * 0.985, -0.6], [r * 0.95, -0.95], [r * 0.86, -1.15], [0, -1.15]], 80, mat(C.soil)));
  const rock = lathe(
    [[r * 0.87, -1.1], [r * 0.78, -1.7], [r * 0.6, -2.5], [r * 0.38, -3.3], [r * 0.16, -4.0], [0, -4.4]],
    12, mat(C.soilDark, { flatShading: true }),
  );
  rock.rotation.y = 0.3;
  g.add(rock);
  g.userData.cap = cap;
  return g;
}

const island = islandBody(ISLAND_R);
world.add(island);
const ground = island.userData.cap;

for (let i = 0; i < 12; i++) {
  const a = (i / 12) * Math.PI * 2 + 0.4;
  const rr = rand(3, 4.4);
  const p = mesh(new THREE.DodecahedronGeometry(rand(0.3, 0.6), 0), mat(C.soil, { flatShading: true }));
  p.position.set(Math.cos(a) * rr, rand(-1.4, -2.4), Math.sin(a) * rr);
  p.rotation.set(rand(0, 3), rand(0, 3), 0);
  island.add(p);
}

/* waterfall off the rim */
const fallGeo = new THREE.PlaneGeometry(0.9, 7, 1, 20);
fallGeo.translate(0, -3.5, 0);
const fallTex = (() => {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#7fd8ff';
  g.fillRect(0, 0, 32, 128);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(255,255,255,${rand(0.3, 0.8)})`;
    g.fillRect(rand(0, 30), rand(0, 128), 2, rand(8, 22));
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
})();
const fallMat = new THREE.MeshBasicMaterial({ map: fallTex, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
const waterfall = new THREE.Mesh(fallGeo, fallMat);
waterfall.position.set(0, TOP - 0.05, ISLAND_R + 0.02);
const fallAlpha = (() => {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 64);
  grd.addColorStop(0, '#fff');
  grd.addColorStop(1, '#000');
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 64);
  return new THREE.CanvasTexture(c);
})();
fallMat.alphaMap = fallAlpha;
const fallPivot = new THREE.Group();
fallPivot.add(waterfall);
fallPivot.rotation.y = -0.9;
world.add(fallPivot);
const streamGeo = new THREE.PlaneGeometry(0.9, 2.2);
streamGeo.rotateX(-Math.PI / 2);
const stream = new THREE.Mesh(streamGeo, new THREE.MeshStandardMaterial({ color: C.water, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.9 }));
stream.position.set(0, TOP + 0.012, ISLAND_R - 1.1);
stream.receiveShadow = true;
fallPivot.add(stream);

/* soft shadow far below */
const blob = new THREE.Mesh(
  new THREE.PlaneGeometry(16, 16),
  new THREE.MeshBasicMaterial({ map: glowTexture('20,70,40'), transparent: true, opacity: 0.5, depthWrite: false }),
);
blob.rotation.x = -Math.PI / 2;
blob.position.y = -9;
scene.add(blob);

/* ================================================================== */
/*  Builders                                                           */
/* ================================================================== */
function roundTree(color = pick([C.leaf1, C.leaf2])) {
  const t = new THREE.Group();
  const trunk = mesh(new THREE.CylinderGeometry(0.07, 0.11, 0.75, 10), mat(C.trunk));
  trunk.position.y = 0.37;
  const sway = new THREE.Group();
  sway.position.y = 0.6;
  const crown = mesh(new THREE.IcosahedronGeometry(0.5, 2), mat(color));
  crown.position.y = 0.38;
  crown.scale.set(1, 1.12, 1);
  const crown2 = mesh(new THREE.IcosahedronGeometry(0.3, 2), mat(color));
  crown2.position.set(0.27, 0.2, 0.18);
  sway.add(crown, crown2);
  t.add(trunk, sway);
  t.userData.sway = sway;
  t.scale.setScalar(rand(0.85, 1.2));
  return t;
}
function pineTree() {
  const t = new THREE.Group();
  const trunk = mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.4, 8), mat(C.trunk));
  trunk.position.y = 0.2;
  const sway = new THREE.Group();
  sway.position.y = 0.3;
  [[0.5, 0.65, 0.25], [0.4, 0.55, 0.6], [0.28, 0.45, 0.92]].forEach(([r, h, y]) => {
    const c = mesh(new THREE.ConeGeometry(r, h, 18), mat(C.leaf3));
    c.position.y = y;
    sway.add(c);
  });
  t.add(trunk, sway);
  t.userData.sway = sway;
  t.scale.setScalar(rand(0.85, 1.25));
  return t;
}
function bush() {
  const b = new THREE.Group();
  const color = pick([C.leaf1, C.leaf2]);
  [[0, 0.17, 0, 0.24], [0.22, 0.12, 0.05, 0.17], [-0.18, 0.11, 0.07, 0.16]].forEach(([x, y, z, r]) => {
    const s = mesh(new THREE.IcosahedronGeometry(r, 2), mat(color));
    s.position.set(x, y, z);
    b.add(s);
  });
  if (Math.random() < 0.6) {
    for (let i = 0; i < 4; i++) {
      const berry = mesh(new THREE.SphereGeometry(0.035, 8, 6), mat(C.pink), false);
      berry.position.set(rand(-0.25, 0.25), rand(0.15, 0.35), rand(0.05, 0.2));
      b.add(berry);
    }
  }
  return b;
}
const flowerHead = new THREE.IcosahedronGeometry(0.055, 1);
const flowerStem = new THREE.CylinderGeometry(0.012, 0.012, 0.16, 4);
function flowers() {
  const g = new THREE.Group();
  const color = pick([C.pink, C.yellow, C.white, C.purple]);
  for (let i = 0; i < 9; i++) {
    const f = new THREE.Group();
    const s = mesh(flowerStem, mat(0x58b85a), false);
    s.position.y = 0.08;
    const h = mesh(flowerHead, mat(i % 3 ? color : C.white), false);
    h.position.y = 0.17;
    f.add(s, h);
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.32;
    f.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    g.add(f);
  }
  return g;
}

function panelTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
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
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const panelMat = new THREE.MeshStandardMaterial({ map: panelTexture(), roughness: 0.25, metalness: 0.35, emissive: 0x2a5cff, emissiveIntensity: 0 });

function solar() {
  const g = new THREE.Group();
  for (let i = 0; i < 2; i++) {
    const post = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.34, 8), mat(0xb8c2c8, { metalness: 0.4, roughness: 0.4 }));
    post.position.set(i * 0.6 - 0.3, 0.17, 0);
    g.add(post);
  }
  const p = mesh(new RoundedBoxGeometry(1.25, 0.05, 0.75, 2, 0.02), panelMat);
  p.position.y = 0.38;
  p.rotation.x = -0.5;
  g.add(p);
  g.userData.panel = p;
  return g;
}

const turbineWhite = mat(C.white, { roughness: 0.45 });
const bladeGeo = (() => {
  const s = new THREE.Shape();
  s.moveTo(-0.05, 0);
  s.quadraticCurveTo(-0.11, 0.45, -0.03, 1.7);
  s.lineTo(0.02, 1.75);
  s.quadraticCurveTo(0.08, 0.45, 0.05, 0);
  return new THREE.ExtrudeGeometry(s, { depth: 0.025, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2 });
})();
function turbine() {
  const t = new THREE.Group();
  const h = rand(3.4, 4.2);
  const tower = mesh(new THREE.CylinderGeometry(0.06, 0.13, h, 16), turbineWhite);
  tower.position.y = h / 2;
  const base = mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.08, 20), mat(C.stone));
  base.position.y = 0.04;
  const nacelle = mesh(new RoundedBoxGeometry(0.2, 0.2, 0.46, 3, 0.07), turbineWhite);
  nacelle.position.set(0, h + 0.02, -0.05);
  const rotor = new THREE.Group();
  rotor.position.set(0, h + 0.02, 0.22);
  const hub = mesh(new THREE.SphereGeometry(0.11, 20, 14), turbineWhite);
  hub.scale.z = 1.4;
  rotor.add(hub);
  for (let i = 0; i < 3; i++) {
    const b = mesh(bladeGeo, turbineWhite);
    b.rotation.z = (i / 3) * Math.PI * 2;
    rotor.add(b);
  }
  const tip = mesh(new THREE.SphereGeometry(0.05, 10, 8), mat(0xff5d6c, { emissive: 0xff2030, emissiveIntensity: 0 }), false);
  tip.position.set(0, h + 0.15, -0.1);
  t.add(tower, base, nacelle, rotor, tip);
  t.userData.rotor = rotor;
  t.userData.beacon = tip;
  return t;
}

const windowMat = new THREE.MeshStandardMaterial({ color: 0x9fdcff, emissive: 0xffc96b, emissiveIntensity: 0, roughness: 0.3 });
function house() {
  const h = new THREE.Group();
  const base = mesh(new RoundedBoxGeometry(1.5, 1.0, 1.25, 4, 0.08), mat(pick([C.cream, 0xfde2e4, 0xe2f0ff, 0xfff8c9])));
  base.position.y = 0.5;
  const shape = new THREE.Shape();
  shape.moveTo(-0.95, 0); shape.lineTo(0, 0.72); shape.lineTo(0.95, 0); shape.lineTo(-0.95, 0);
  const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: 1.45, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 3 });
  roofGeo.translate(0, 0, -0.725);
  const roof = mesh(roofGeo, mat(pick([C.roof, 0xe8735a, 0x5a7de8])));
  roof.position.y = 0.98;
  const ch = mesh(new RoundedBoxGeometry(0.2, 0.45, 0.2, 2, 0.03), mat(C.stone));
  ch.position.set(0.5, 1.45, -0.3);
  const door = mesh(new RoundedBoxGeometry(0.32, 0.55, 0.06, 2, 0.03), mat(C.trunk));
  door.position.set(0.25, 0.3, 0.64);
  const w1 = mesh(new RoundedBoxGeometry(0.34, 0.3, 0.05, 2, 0.03), windowMat);
  w1.position.set(-0.38, 0.58, 0.64);
  const w2 = w1.clone();
  w2.rotation.y = Math.PI / 2;
  w2.position.set(0.77, 0.58, 0);
  const w3 = w1.clone();
  w3.position.z = -0.64;
  h.add(base, roof, ch, door, w1, w2, w3);
  return h;
}

function pond() {
  const g = new THREE.Group();
  const water = mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.04, 40), mat(C.water, { roughness: 0.12, metalness: 0.1, emissive: 0x1a7fb0, emissiveIntensity: 0.15 }), false);
  water.scale.set(1.15, 1, 0.8);
  water.position.y = 0.02;
  g.add(water);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const s = mesh(new THREE.DodecahedronGeometry(rand(0.09, 0.15), 0), mat(C.stone, { flatShading: true }));
    s.position.set(Math.cos(a) * 1.0, 0.04, Math.sin(a) * 0.72);
    s.scale.y = 0.6;
    g.add(s);
  }
  const lilies = [];
  for (let i = 0; i < 3; i++) {
    const l = mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.015, 16, 1, false, 0, Math.PI * 1.75), mat(C.leaf1), false);
    l.position.set(rand(-0.4, 0.4), 0.05, rand(-0.25, 0.25));
    g.add(l);
    lilies.push(l);
  }
  // a little duck
  const duck = new THREE.Group();
  const body = mesh(new THREE.SphereGeometry(0.11, 14, 10), mat(0xffe066));
  body.scale.set(1.3, 0.8, 1);
  const head = mesh(new THREE.SphereGeometry(0.07, 12, 8), mat(0xffe066));
  head.position.set(0.11, 0.1, 0);
  const beak = mesh(new THREE.ConeGeometry(0.025, 0.07, 8), mat(0xff8a3d));
  beak.rotation.z = -Math.PI / 2;
  beak.position.set(0.19, 0.09, 0);
  duck.add(body, head, beak);
  duck.position.y = 0.07;
  g.add(duck);
  g.userData.lilies = lilies;
  g.userData.duck = duck;
  g.userData.water = water;
  return g;
}

function coalPlant() {
  const g = new THREE.Group();
  const base = mesh(new RoundedBoxGeometry(1.6, 0.8, 1.1, 3, 0.08), mat(0x8d949c));
  base.position.y = 0.4;
  const roof = mesh(new RoundedBoxGeometry(1.0, 0.35, 0.8, 3, 0.06), mat(0x6b7178));
  roof.position.set(-0.2, 0.95, 0);
  g.add(base, roof);
  const chimneys = [];
  [[0.45, 0.25], [0.45, -0.25]].forEach(([x, z]) => {
    const c = mesh(new THREE.CylinderGeometry(0.13, 0.18, 1.9, 16), mat(0xe7e2dc));
    c.position.set(x, 1.3, z);
    const band = mesh(new THREE.CylinderGeometry(0.135, 0.14, 0.22, 16), mat(0xe0434f));
    band.position.set(x, 2.05, z);
    g.add(c, band);
    chimneys.push(new THREE.Vector3(x, 2.3, z));
  });
  const pile = mesh(new THREE.ConeGeometry(0.35, 0.3, 7), mat(0x2b2b30, { flatShading: true }));
  pile.position.set(-0.55, 0.15, 0.75);
  g.add(pile);
  g.userData.chimneys = chimneys;
  return g;
}

/* ================================================================== */
/*  Catalog                                                            */
/* ================================================================== */
const TYPES = {
  tree:    { name: 'Oak tree',    icon: '🌳', key: '1', cost: 5,  r: 0.5,  build: () => roundTree(), co2: -1.2, desc: 'Absorbs CO₂, sways in the wind.' },
  pine:    { name: 'Pine',        icon: '🌲', key: '2', cost: 5,  r: 0.45, build: pineTree, co2: -1.0, desc: 'Hardy evergreen. Loves storms.' },
  bush:    { name: 'Berry bush',  icon: '🌿', key: '3', cost: 3,  r: 0.35, build: bush, co2: -0.4, desc: 'Small, cheap greenery.' },
  flowers: { name: 'Flowers',     icon: '🌸', key: '4', cost: 2,  r: 0.35, build: flowers, co2: -0.1, eco: 1, desc: 'Pure joy. +eco score.' },
  solar:   { name: 'Solar panel', icon: '☀️', key: '5', cost: 25, r: 0.7,  build: solar, desc: 'Up to 4 kW — only when the sun is up.' },
  turbine: { name: 'Wind turbine',icon: '🌬️', key: '6', cost: 40, r: 0.55, build: turbine, desc: 'Up to 12 kW — depends on wind speed.' },
  house:   { name: 'Eco house',   icon: '🏡', key: '7', cost: 30, r: 0.95, build: house, co2: 1.5, demand: 3, pop: 4, desc: 'Needs 3 kW. Powered homes pay coins.' },
  pond:    { name: 'Pond',        icon: '🦆', key: '8', cost: 20, r: 1.05, build: pond, co2: -0.5, eco: 3, desc: 'Cools the island. Comes with a duck.' },
  coal:    { name: 'Coal plant',  icon: '🏭', key: '9', cost: 50, r: 1.05, build: coalPlant, co2: 14, desc: '20 kW always on… but very dirty.' },
};
const TOOLS = {
  seed:    { name: 'Seed bomb',   icon: '💣', key: '0', cost: 3, desc: 'Throw seeds anywhere — a random plant grows where it lands.' },
  remove:  { name: 'Bulldozer',   icon: '🚜', key: 'X', cost: 0, desc: 'Remove things. Refunds half the cost.' },
};
const SLOT_ORDER = ['tree', 'pine', 'bush', 'flowers', 'solar', 'turbine', 'house', 'pond', 'coal', 'seed', 'remove'];
const ALL = { ...TYPES, ...TOOLS };

/* ================================================================== */
/*  Game state                                                         */
/* ================================================================== */
const state = {
  coins: 150,
  entities: [],
  time: 11,
  cycle: false,
  wind: 45,
  rain: false,
  storm: false,
  grow: 1,
  sound: true,
  missionsDone: [],
  tool: null,
  rot: 0,
  started: false,
  stats: { solar: 0, wind: 0, coal: 0, prod: 0, demand: 0, co2: 0, pop: 0, eco: 50, income: 0, trees: 0, powered: true },
};

const entityRoot = new THREE.Group();
world.add(entityRoot);

function spawn(type, x, z, rot = Math.random() * Math.PI * 2, animate = true) {
  const def = TYPES[type];
  const obj = def.build();
  obj.position.set(x, TOP, z);
  obj.rotation.y = type === 'turbine' ? Math.PI / 2 : rot;
  obj.traverse((o) => { if (o.isMesh) o.userData.entityRoot = obj; });
  const e = { type, obj, x, z, rot, r: def.r, born: animate ? clock.elapsedTime : -10, baseScale: obj.scale.x, dying: 0 };
  obj.userData.entity = e;
  obj.scale.setScalar(animate ? 0.001 : e.baseScale);
  entityRoot.add(obj);
  state.entities.push(e);
  return e;
}

function despawn(e) {
  e.dying = clock.elapsedTime;
  state.entities = state.entities.filter((x) => x !== e);
}

function canPlace(type, x, z) {
  const r = TYPES[type].r;
  if (Math.hypot(x, z) > ISLAND_R - 0.35 - r * 0.6) return false;
  // keep the stream clear
  const sp = new THREE.Vector3(x, 0, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.9);
  if (Math.abs(sp.x) < 0.45 + r * 0.7 && sp.z > ISLAND_R - 2.4 - r) return false;
  for (const e of state.entities) {
    if (Math.hypot(e.x - x, e.z - z) < (e.r + r) * 0.82) return false;
  }
  return true;
}

/* ================================================================== */
/*  Particles: dust bursts, confetti, smoke, rain, seed bombs          */
/* ================================================================== */
const bits = [];
const bitGeo = new THREE.IcosahedronGeometry(0.06, 0);
const bitMats = {};
function bitMat(color) {
  if (!bitMats[color]) bitMats[color] = new THREE.MeshBasicMaterial({ color, transparent: true });
  return bitMats[color];
}
function burst(pos, colors, n = 14, speed = 3, gravity = 9, size = 1) {
  for (let i = 0; i < n; i++) {
    if (bits.length > 400) bits.shift().mesh.removeFromParent();
    const m = new THREE.Mesh(bitGeo, bitMat(pick(colors)));
    m.position.copy(pos);
    m.scale.setScalar(size * rand(0.6, 1.4));
    world.add(m);
    const a = Math.random() * Math.PI * 2;
    bits.push({
      mesh: m,
      vel: new THREE.Vector3(Math.cos(a) * rand(0.3, 1) * speed, rand(0.6, 1.4) * speed, Math.sin(a) * rand(0.3, 1) * speed),
      life: 0, max: rand(0.7, 1.3), gravity,
    });
  }
}

const smokeTex = glowTexture('120,120,125');
const puffs = [];
function puff(worldPos) {
  const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0.7 }));
  m.position.copy(worldPos);
  m.scale.setScalar(0.5);
  scene.add(m);
  puffs.push({ s: m, life: 0, max: rand(3, 4.5) });
}

const RAIN_N = 1400;
const rainGeo = new THREE.BufferGeometry();
const rainPos = new Float32Array(RAIN_N * 6);
for (let i = 0; i < RAIN_N; i++) {
  const x = rand(-12, 12), y = rand(-6, 14), z = rand(-12, 12);
  rainPos.set([x, y, z, x, y - 0.35, z], i * 6);
}
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xaad8ff, transparent: true, opacity: 0 }));
scene.add(rain);

const bombs = [];
function throwSeed(target) {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 1), new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 0.9 }));
  const start = camera.position.clone().lerp(target, 0.15);
  m.position.copy(start);
  m.castShadow = true;
  scene.add(m);
  bombs.push({ m, start, target: target.clone(), t: 0, dur: 0.9 });
  sfx('whoosh');
}

/* pollen floating around */
const POLLEN = 120;
const pollenGeo = new THREE.BufferGeometry();
const pollenPos = new Float32Array(POLLEN * 3);
for (let i = 0; i < POLLEN; i++) {
  const a = Math.random() * Math.PI * 2, r = rand(1, 9);
  pollenPos.set([Math.cos(a) * r, rand(-4, 8), Math.sin(a) * r], i * 3);
}
pollenGeo.setAttribute('position', new THREE.BufferAttribute(pollenPos, 3));
const pollen = new THREE.Points(pollenGeo, new THREE.PointsMaterial({ color: 0xfff2a8, size: 0.12, map: glowTexture('255,255,255'), transparent: true, depthWrite: false }));
world.add(pollen);

/* ---------- clouds ---------- */
const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
const clouds = [];
function makeCloud(s) {
  const g = new THREE.Group();
  [[0, 0, 0, 0.6], [0.6, -0.1, 0.05, 0.45], [-0.6, -0.1, 0, 0.42], [0.2, 0.32, -0.05, 0.45], [-0.25, 0.25, 0.12, 0.38]].forEach(([x, y, z, r]) => {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 3), cloudMat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
  });
  g.scale.set(s, s * 0.85, s);
  return g;
}
for (let i = 0; i < 9; i++) {
  const c = makeCloud(rand(0.9, 1.8));
  c.position.set(rand(-16, 16), rand(6.5, 10), rand(-10, 10));
  c.userData.speed = rand(0.6, 1.3);
  c.userData.bob = rand(0, 6);
  world.add(c);
  clouds.push(c);
}

/* lightning bolt */
let bolt = null;
function lightning() {
  const target = new THREE.Vector3(rand(-ISLAND_R, ISLAND_R) * 0.7, TOP, rand(-ISLAND_R, ISLAND_R) * 0.7);
  const pts = [];
  let p = new THREE.Vector3(target.x + rand(-2, 2), 11, target.z + rand(-2, 2));
  for (let i = 0; i <= 10; i++) {
    const k = i / 10;
    pts.push(new THREE.Vector3(lerp(p.x, target.x, k) + (i && i < 10 ? rand(-0.5, 0.5) : 0), lerp(11, TOP, k), lerp(p.z, target.z, k) + (i && i < 10 ? rand(-0.5, 0.5) : 0)));
  }
  if (bolt) bolt.removeFromParent();
  bolt = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true }));
  bolt.userData.life = 0;
  world.add(bolt);
  flashEl.style.transition = 'none';
  flashEl.style.opacity = '0.55';
  requestAnimationFrame(() => { flashEl.style.transition = 'opacity .5s'; flashEl.style.opacity = '0'; });
  burst(target, [0xffffff, 0xfff2a8, 0xffd35c], 18, 4, 9);
  // lightning sometimes strikes a tree and turns it into a sapling of a different kind!
  const near = state.entities.filter((e) => (e.type === 'tree' || e.type === 'pine') && Math.hypot(e.x - target.x, e.z - target.z) < 1.4);
  if (near.length && Math.random() < 0.5) {
    const e = near[0];
    despawn(e);
    burst(new THREE.Vector3(e.x, 1, e.z), [0xff8a3d, 0xffd35c, 0x555555], 20, 3);
    setTimeout(() => { if (canPlace('bush', e.x, e.z)) spawn('bush', e.x, e.z); }, 1500);
    toast('⚡ Lightning struck a tree!', 'bad');
  }
  setTimeout(() => sfx('thunder'), 250);
}

/* ================================================================== */
/*  Audio (tiny synth, no assets)                                      */
/* ================================================================== */
let actx = null;
function sfx(kind) {
  if (!state.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const now = actx.currentTime;
    const tone = (freq, t0, dur, type = 'sine', vol = 0.15, slide = 0) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, now + t0);
      if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, now + t0 + dur);
      g.gain.setValueAtTime(0.0001, now + t0);
      g.gain.exponentialRampToValueAtTime(vol, now + t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + t0 + dur);
      o.connect(g).connect(actx.destination);
      o.start(now + t0);
      o.stop(now + t0 + dur + 0.05);
    };
    const noise = (dur, vol, freq) => {
      const buf = actx.createBuffer(1, actx.sampleRate * dur, actx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
      const src = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
      src.buffer = buf; f.type = 'lowpass'; f.frequency.value = freq; g.gain.value = vol;
      src.connect(f).connect(g).connect(actx.destination);
      src.start();
    };
    if (kind === 'place') { tone(520, 0, 0.12, 'triangle', 0.18, 1.6); tone(880, 0.06, 0.12, 'sine', 0.1); }
    if (kind === 'remove') tone(300, 0, 0.2, 'square', 0.06, 0.4);
    if (kind === 'error') { tone(160, 0, 0.15, 'square', 0.07); tone(130, 0.12, 0.18, 'square', 0.07); }
    if (kind === 'win') [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.25, 'triangle', 0.16));
    if (kind === 'click') tone(700, 0, 0.05, 'sine', 0.08);
    if (kind === 'whoosh') noise(0.4, 0.25, 1200);
    if (kind === 'thunder') noise(1.6, 0.9, 260);
    if (kind === 'grow') tone(400, 0, 0.3, 'sine', 0.12, 2);
  } catch { /* audio unavailable */ }
}

/* ================================================================== */
/*  Missions                                                           */
/* ================================================================== */
const count = (type) => state.entities.filter((e) => e.type === type).length;
const MISSIONS = [
  { id: 'plant5', title: 'Plant 5 trees', hint: 'Oaks or pines', reward: 30, progress: () => (count('tree') + count('pine')) / 5 },
  { id: 'house1', title: 'Build a home', hint: 'Someone has to live here', reward: 25, progress: () => count('house') / 1 },
  { id: 'wind2', title: 'Raise 2 wind turbines', hint: 'Try cranking the wind slider', reward: 40, progress: () => count('turbine') / 2 },
  { id: 'power', title: 'Power every house', hint: 'Production ≥ demand', reward: 50, progress: () => (state.stats.demand > 0 ? Math.min(1, state.stats.prod / state.stats.demand) : 0) },
  { id: 'night', title: 'Keep the lights on at night', hint: 'Solar sleeps after sunset…', reward: 60, progress: () => (state.stats.demand > 0 && isNight() && state.stats.powered ? 1 : 0) },
  { id: 'clean30', title: 'Make 30 kW of clean energy', hint: 'Sun + wind, no coal', reward: 80, progress: () => (state.stats.solar + state.stats.wind) / 30 },
  { id: 'storm', title: 'Survive a storm', hint: 'Turn on ⛈️ Storm in the Lab', reward: 30, progress: () => (state.storm ? 1 : 0) },
  { id: 'negative', title: 'Go carbon negative', hint: 'Net CO₂ below 0 with 3+ homes', reward: 100, progress: () => (count('house') >= 3 && state.stats.co2 < 0 ? 1 : count('house') / 3 * 0.5) },
  { id: 'pop24', title: 'Grow to 24 residents', hint: '6 happy homes', reward: 100, progress: () => state.stats.pop / 24 },
  { id: 'eco90', title: 'Reach eco score 90', hint: '🏆 Planet Saver', reward: 200, progress: () => state.stats.eco / 90 },
];
const mList = document.getElementById('m-list');
function renderMissions() {
  const next = MISSIONS.find((m) => !state.missionsDone.includes(m.id));
  mList.innerHTML = MISSIONS.map((m) => {
    const done = state.missionsDone.includes(m.id);
    const p = done ? 1 : clamp(m.progress(), 0, 1);
    return `<li class="${done ? 'done' : ''} ${m === next ? 'active' : ''}"><span class="ck">${done ? '✓' : ''}</span>
      <div><b>${m.title}</b><small>${m.hint} · 🪙 ${m.reward}</small>${done ? '' : `<div class="bar"><i style="width:${p * 100}%"></i></div>`}</div></li>`;
  }).join('');
  document.getElementById('m-count').textContent = `${state.missionsDone.length}/${MISSIONS.length}`;
}
function checkMissions() {
  for (const m of MISSIONS) {
    if (state.missionsDone.includes(m.id)) continue;
    if (m.progress() >= 1) {
      state.missionsDone.push(m.id);
      state.coins += m.reward;
      toast(`🎉 Mission complete: ${m.title} · +${m.reward} 🪙`, 'win');
      sfx('win');
      burst(new THREE.Vector3(0, 3, 0), [0x2fbf71, 0xb9f27c, 0xffd35c, 0xff8fab, 0x5ac8f2], 70, 6, 6, 1.4);
      save();
    }
  }
}

/* ================================================================== */
/*  Simulation                                                         */
/* ================================================================== */
const sunFactor = () => Math.max(0, Math.sin(((state.time - 6) / 12) * Math.PI));
const isNight = () => state.time < 5.5 || state.time > 19.5;

function simulate() {
  const s = state.stats;
  const sun = sunFactor() * (state.rain ? 0.35 : 1) * (state.storm ? 0.6 : 1);
  const windEff = clamp(state.wind / 100 * (state.storm ? 1.35 : 1), 0, 1.35);
  s.solar = count('solar') * 4 * sun;
  s.wind = count('turbine') * 12 * Math.min(1, Math.pow(windEff, 1.5));
  s.coal = count('coal') * 20;
  s.prod = s.solar + s.wind + s.coal;
  s.demand = 0; s.co2 = 0; s.pop = 0;
  let eco = 0;
  for (const e of state.entities) {
    const d = TYPES[e.type];
    s.demand += d.demand || 0;
    s.co2 += d.co2 || 0;
    s.pop += d.pop || 0;
    eco += d.eco || 0;
  }
  // clean power displaces household emissions
  const cleanShare = s.prod > 0 ? (s.solar + s.wind) / s.prod : 0;
  s.powered = s.prod >= s.demand - 0.01;
  s.trees = count('tree') + count('pine');
  const green = s.trees * 1.4 + count('bush') * 0.5 + count('flowers') * 0.4 + eco;
  s.eco = Math.round(clamp(30 + Math.min(35, green) + (s.demand ? cleanShare * 25 * Math.min(1, s.prod / s.demand) : 0) + (s.co2 < 0 ? 10 : 0) - Math.max(0, s.co2) * 1.6, 0, 100));
  const houses = count('house');
  const powerRatio = s.demand ? Math.min(1, s.prod / s.demand) : 0;
  s.income = houses * (0.3 + 0.9 * powerRatio) * (s.eco >= 70 ? 1.25 : 1) + count('coal') * 0.6;
}

/* ================================================================== */
/*  HUD                                                                */
/* ================================================================== */
const $ = (id) => document.getElementById(id);
const flashEl = $('flash');
const hud = $('hud');

const hotbar = $('hotbar');
hotbar.innerHTML = SLOT_ORDER.map((k, i) => {
  const d = ALL[k];
  return `<button class="slot ${k === 'seed' ? 'sep' : ''}" data-tool="${k}" title="${d.name}">
    <span class="key">${d.key}</span>${d.cost ? `<span class="cost">${d.cost}</span>` : ''}
    <span class="em">${d.icon}</span><span class="nm">${d.name.split(' ')[0]}</span></button>`;
}).join('');
hotbar.addEventListener('click', (e) => {
  const b = e.target.closest('.slot');
  if (b) selectTool(b.dataset.tool);
});

function selectTool(k) {
  state.tool = state.tool === k ? null : k;
  sfx('click');
  hotbar.querySelectorAll('.slot').forEach((s) => s.classList.toggle('active', s.dataset.tool === state.tool));
  buildGhost();
  renderInfo();
}

function renderInfo() {
  const info = $('info');
  const k = state.tool;
  if (!k) { info.classList.add('empty'); return; }
  const d = ALL[k];
  const tags = [];
  if (d.cost) tags.push(`<span class="tag">🪙 ${d.cost}</span>`);
  if (d.co2) tags.push(`<span class="tag ${d.co2 > 0 ? 'neg' : 'pos'}">${d.co2 > 0 ? '+' : ''}${d.co2} t CO₂</span>`);
  if (d.demand) tags.push(`<span class="tag neg">−${d.demand} kW</span>`);
  if (d.pop) tags.push(`<span class="tag pos">+${d.pop} 👤</span>`);
  if (k === 'solar') tags.push('<span class="tag pos">≤ +4 kW</span>');
  if (k === 'turbine') tags.push('<span class="tag pos">≤ +12 kW</span>');
  if (k === 'coal') tags.push('<span class="tag pos">+20 kW</span>');
  info.innerHTML = `<span style="font-size:1.6rem">${d.icon}</span><div><b>${d.name}</b><div>${d.desc}</div></div><div class="tags">${tags.join('')}</div>`;
  info.classList.remove('empty');
}

let lastCoins = -1;
function renderHUD() {
  const s = state.stats;
  $('v-coins').textContent = Math.floor(state.coins);
  $('v-income').textContent = `+${s.income.toFixed(1)}/s`;
  $('v-energy').textContent = `${s.prod.toFixed(1)} kW`;
  $('v-demand').textContent = `need ${s.demand} kW`;
  $('st-energy').classList.toggle('bad', s.demand > 0 && !s.powered);
  $('st-energy').classList.toggle('good', s.demand > 0 && s.powered);
  $('v-co2').textContent = (s.co2 > 0 ? '+' : '') + s.co2.toFixed(1);
  $('st-co2').classList.toggle('bad', s.co2 > 0);
  $('st-co2').classList.toggle('good', s.co2 < 0);
  $('v-pop').textContent = s.pop;
  $('v-eco').textContent = s.eco;
  const arc = $('eco-arc');
  arc.style.strokeDashoffset = 94.25 * (1 - s.eco / 100);
  arc.style.stroke = s.eco >= 70 ? '#2fbf71' : s.eco >= 40 ? '#ffc23d' : '#e0434f';
  $('v-grade').textContent = s.eco >= 90 ? 'Planet saver' : s.eco >= 70 ? 'Thriving' : s.eco >= 40 ? 'Okay' : 'Polluted';
  if (Math.floor(state.coins) !== lastCoins) {
    lastCoins = Math.floor(state.coins);
    hotbar.querySelectorAll('.slot').forEach((b) => {
      const c = ALL[b.dataset.tool].cost;
      b.classList.toggle('poor', c > state.coins);
    });
  }
  const h = Math.floor(state.time), m = Math.floor((state.time % 1) * 60);
  $('readout').innerHTML =
    `☀️ solar <b>${s.solar.toFixed(1)} kW</b> (${Math.round(sunFactor() * 100)}% sun)<br>` +
    `🌬️ wind  <b>${s.wind.toFixed(1)} kW</b><br>` +
    `🏭 coal  <b>${s.coal.toFixed(0)} kW</b><br>` +
    `⚖️ balance <b>${(s.prod - s.demand).toFixed(1)} kW</b> ${s.demand ? (s.powered ? '✅' : '⚠️ blackout') : ''}`;
  $('v-time').textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// toasts play one after another so a burst of events stays readable
const toastQueue = [];
let toastBusy = false;
function toast(text, kind = '') {
  toastQueue.push([text, kind]);
  if (!toastBusy) nextToast();
}
function nextToast() {
  const item = toastQueue.shift();
  if (!item) { toastBusy = false; return; }
  toastBusy = true;
  const el = document.createElement('div');
  el.className = `toast ${item[1]}`;
  el.textContent = item[0];
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3100);
  setTimeout(nextToast, toastQueue.length > 2 ? 700 : 1300);
}

/* ---------- Lab controls ---------- */
const cTime = $('c-time');
cTime.addEventListener('input', () => { state.time = +cTime.value; state.cycle = false; $('c-cycle').classList.remove('on'); });
$('c-cycle').addEventListener('click', (e) => { state.cycle = !state.cycle; e.currentTarget.classList.toggle('on', state.cycle); sfx('click'); });
$('c-night').addEventListener('click', () => { state.time = 23; cTime.value = 23; sfx('click'); });
$('c-noon').addEventListener('click', () => { state.time = 12; cTime.value = 12; sfx('click'); });
const cWind = $('c-wind');
cWind.addEventListener('input', () => { state.wind = +cWind.value; $('v-wind').textContent = `${Math.round(state.wind * 1.2)} km/h`; });
$('c-rain').addEventListener('click', (e) => { state.rain = !state.rain; if (!state.rain) { state.storm = false; $('c-storm').classList.remove('on'); } e.currentTarget.classList.toggle('on', state.rain); sfx('click'); });
$('c-storm').addEventListener('click', (e) => {
  state.storm = !state.storm;
  if (state.storm) { state.rain = true; $('c-rain').classList.add('on'); }
  e.currentTarget.classList.toggle('on', state.storm);
  sfx('click');
});
const cGrow = $('c-grow');
cGrow.addEventListener('input', () => { state.grow = +cGrow.value; $('v-grow').textContent = `${state.grow}×`; });
$('c-random').addEventListener('click', () => { randomIsland(); sfx('grow'); });
$('c-reset').addEventListener('click', () => {
  [...state.entities].forEach(despawn);
  toast('🧹 Island cleared');
  sfx('remove');
  save();
});
$('c-photo').addEventListener('click', togglePhoto);
$('c-sound').addEventListener('click', (e) => { state.sound = !state.sound; e.currentTarget.textContent = state.sound ? '🔊 Sound' : '🔇 Muted'; });
$('lab-toggle').addEventListener('click', (e) => {
  const lab = $('lab');
  lab.classList.toggle('collapsed');
  e.currentTarget.textContent = lab.classList.contains('collapsed') ? '+' : '–';
});
$('missions').addEventListener('click', () => $('missions').classList.toggle('open'));

function togglePhoto() {
  hud.classList.toggle('hidden');
  if (hud.classList.contains('hidden')) toast('📷 Photo mode — press H to return');
}

/* ================================================================== */
/*  Placement: ghost, raycasting, input                                */
/* ================================================================== */
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const ghostOk = new THREE.MeshBasicMaterial({ color: 0x5cff9d, transparent: true, opacity: 0.45, depthWrite: false });
const ghostBad = new THREE.MeshBasicMaterial({ color: 0xff5d6c, transparent: true, opacity: 0.45, depthWrite: false });
const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
ring.rotation.x = -Math.PI / 2;
ring.visible = false;
world.add(ring);
let ghost = null;
let hover = null; // { point, ok, target }

function buildGhost() {
  if (ghost) { ghost.removeFromParent(); ghost = null; }
  const k = state.tool;
  if (!k || !TYPES[k]) return;
  ghost = TYPES[k].build();
  ghost.traverse((o) => { if (o.isMesh) { o.material = ghostOk; o.castShadow = false; } });
  ghost.visible = false;
  world.add(ghost);
}

function updateHover(clientX, clientY) {
  ndc.set((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const k = state.tool;
  hover = null;
  ring.visible = false;
  if (ghost) ghost.visible = false;
  setHighlight(null);
  if (!k) return;

  if (k === 'remove') {
    const hit = raycaster.intersectObjects(entityRoot.children, true)[0];
    const root = hit && hit.object.userData.entityRoot;
    if (root) {
      const e = root.userData.entity;
      hover = { target: e };
      setHighlight(root);
      ring.visible = true;
      ring.material.color.set(0xff5d6c);
      ring.scale.setScalar(e.r);
      ring.position.set(e.x, TOP + 0.02, e.z);
    }
    return;
  }

  const hit = raycaster.intersectObject(ground, false)[0];
  if (!hit) return;
  const p = world.worldToLocal(hit.point.clone());
  if (k === 'seed') {
    hover = { point: p, ok: true };
    ring.visible = true;
    ring.material.color.set(0xffd35c);
    ring.scale.setScalar(0.4);
    ring.position.set(p.x, TOP + 0.02, p.z);
    return;
  }
  const ok = canPlace(k, p.x, p.z) && state.coins >= TYPES[k].cost;
  hover = { point: p, ok };
  ring.visible = true;
  ring.material.color.set(ok ? 0x5cff9d : 0xff5d6c);
  ring.scale.setScalar(TYPES[k].r);
  ring.position.set(p.x, TOP + 0.02, p.z);
  if (ghost) {
    ghost.visible = true;
    ghost.position.set(p.x, TOP, p.z);
    ghost.rotation.y = k === 'turbine' ? Math.PI / 2 : state.rot;
    ghost.traverse((o) => { if (o.isMesh) o.material = ok ? ghostOk : ghostBad; });
  }
}

let highlighted = null;
const highlightMat = new THREE.MeshStandardMaterial({ color: 0xff5d6c, emissive: 0xff2030, emissiveIntensity: 0.4 });
function setHighlight(root) {
  if (highlighted === root) return;
  if (highlighted) highlighted.traverse((o) => { if (o.isMesh && o.userData.origMat) { o.material = o.userData.origMat; delete o.userData.origMat; } });
  highlighted = root;
  if (root) root.traverse((o) => { if (o.isMesh) { o.userData.origMat = o.material; o.material = highlightMat; } });
}

function act() {
  const k = state.tool;
  if (!k || !hover) return;
  if (k === 'remove') {
    const e = hover.target;
    if (!e) return;
    setHighlight(null);
    despawn(e);
    state.coins += Math.floor(TYPES[e.type].cost / 2);
    burst(new THREE.Vector3(e.x, 0.6, e.z), [0xc98a5a, 0xa86d45, 0xd9d4c7], 16, 3);
    sfx('remove');
    save();
    return;
  }
  if (k === 'seed') {
    if (state.coins < TOOLS.seed.cost) return deny(k);
    state.coins -= TOOLS.seed.cost;
    throwSeed(hover.point.clone().setY(TOP));
    return;
  }
  if (!hover.ok) return deny(k);
  state.coins -= TYPES[k].cost;
  spawn(k, hover.point.x, hover.point.z, state.rot);
  burst(new THREE.Vector3(hover.point.x, TOP + 0.2, hover.point.z), [0xb9f27c, 0xffffff, 0x7fd36b], 12, 2.5);
  sfx('place');
  state.rot = Math.random() * Math.PI * 2;
  save();
}

function deny(k) {
  sfx('error');
  const slot = hotbar.querySelector(`[data-tool="${k}"]`);
  slot.classList.remove('shake');
  void slot.offsetWidth;
  slot.classList.add('shake');
  if (ALL[k].cost > state.coins) toast('🪙 Not enough coins — powered homes earn more!', 'bad');
}

let down = null;
canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointermove', (e) => { if (state.started) updateHover(e.clientX, e.clientY); });
canvas.addEventListener('pointerup', (e) => {
  if (!down || !state.started) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  down = null;
  if (moved < 6 && e.button === 0) {
    updateHover(e.clientX, e.clientY);
    act();
    updateHover(e.clientX, e.clientY);
  }
});

window.addEventListener('keydown', (e) => {
  if (!state.started || e.target.tagName === 'INPUT') return;
  const key = e.key.toLowerCase();
  const slot = SLOT_ORDER.find((k) => ALL[k].key.toLowerCase() === key);
  if (slot) selectTool(slot);
  if (key === 'r') { state.rot += Math.PI / 4; if (ghost) ghost.rotation.y = state.rot; }
  if (key === 'h') togglePhoto();
  if (key === 'escape' && state.tool) selectTool(state.tool);
  if (key === 'n') { state.time = isNight() ? 12 : 23; cTime.value = state.time; }
});

/* ================================================================== */
/*  Save / load / generate                                             */
/* ================================================================== */
let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        coins: state.coins,
        missionsDone: state.missionsDone,
        entities: state.entities.map((e) => [e.type, +e.x.toFixed(2), +e.z.toFixed(2), +e.rot.toFixed(2)]),
      }));
    } catch { /* storage unavailable */ }
  }, 300);
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (!d) return false;
    state.coins = d.coins;
    state.missionsDone = d.missionsDone || [];
    d.entities.forEach(([t, x, z, r]) => TYPES[t] && spawn(t, x, z, r, false));
    return true;
  } catch { return false; }
}

function scatter(type, n) {
  for (let i = 0, tries = 0; i < n && tries < 200; tries++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * (ISLAND_R - 0.8);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (canPlace(type, x, z)) { spawn(type, x, z, undefined, true); i++; }
  }
}
function starterIsland() {
  spawn('house', -1.2, -0.4, 0.4, false);
  spawn('turbine', -3.2, 2.0, 0, false);
  spawn('pond', 1.2, -2.2, 0, false);
  spawn('solar', 1.8, 1.4, -0.6, false);
  [[-3.6, -1.6, 'pine'], [-2.2, -3.4, 'tree'], [3.6, -0.4, 'tree'], [0.2, 3.8, 'pine'], [-0.6, -4.2, 'pine'], [3.4, 2.8, 'tree']]
    .forEach(([x, z, t]) => spawn(t, x, z, undefined, false));
  [[-1.6, 1.6], [2.8, -2.8], [-4.4, 0.4]].forEach(([x, z]) => spawn('flowers', x, z, 0, false));
  spawn('bush', 0.4, 1.0, 0, false);
}
function randomIsland() {
  [...state.entities].forEach(despawn);
  setTimeout(() => {
    scatter('pond', 1);
    scatter('house', Math.floor(rand(1, 4)));
    scatter('turbine', Math.floor(rand(1, 4)));
    scatter('solar', Math.floor(rand(1, 4)));
    if (Math.random() < 0.35) scatter('coal', 1);
    scatter('tree', Math.floor(rand(4, 10)));
    scatter('pine', Math.floor(rand(3, 8)));
    scatter('bush', Math.floor(rand(2, 6)));
    scatter('flowers', Math.floor(rand(3, 7)));
    save();
  }, 350);
}

if (!load()) starterIsland();

/* ================================================================== */
/*  Environment update (time, weather)                                 */
/* ================================================================== */
const SKY = [
  [0, 0x0a1530, 0x1b2b52], [5, 0x16224a, 0x3a3f72], [6, 0x5a6fb0, 0xffa987], [7.5, 0x7ec8f0, 0xffe2c0],
  [12, 0x4fb0ef, 0xd8f3ff], [17, 0x6fb3e8, 0xffd9a8], [18.8, 0x4a4f8f, 0xff8f6b], [20, 0x1a2550, 0x3a3566], [24, 0x0a1530, 0x1b2b52],
];
const tmpA = new THREE.Color(), tmpB = new THREE.Color(), tmpC = new THREE.Color(), tmpD = new THREE.Color();
const stormGray = new THREE.Color(0x5d6878), smogBrown = new THREE.Color(0x9a8a6a);
function skyAt(h, outTop, outBot) {
  for (let i = 0; i < SKY.length - 1; i++) {
    const [h0, t0, b0] = SKY[i], [h1, t1, b1] = SKY[i + 1];
    if (h >= h0 && h <= h1) {
      const k = (h - h0) / (h1 - h0);
      outTop.set(t0).lerp(tmpC.set(t1), k);
      outBot.set(b0).lerp(tmpD.set(b1), k);
      return;
    }
  }
}

let wetness = 0, gloom = 0, smog = 0;
function updateEnvironment(dt, t) {
  if (state.cycle) {
    state.time = (state.time + dt * 0.5) % 24;
    cTime.value = state.time;
  }
  const ang = ((state.time - 6) / 12) * Math.PI; // 0 at 6:00, PI at 18:00
  const sunH = Math.sin(ang);
  const day = clamp(sunH * 3 + 0.3, 0, 1);

  sunOrb.position.set(Math.cos(ang) * -55, Math.sin(ang) * 45, -28);
  moonOrb.position.set(Math.cos(ang) * 55, -Math.sin(ang) * 45, -28);
  sunLight.position.set(Math.cos(ang) * -14, Math.max(sunH, 0.05) * 16, 8);
  sunLight.intensity = 2.8 * clamp(sunH * 2.5, 0, 1) * (1 - gloom * 0.6);
  sunLight.color.setHSL(0.1, 0.9, lerp(0.6, 0.92, clamp(sunH * 2, 0, 1)));
  moonLight.position.set(Math.cos(ang) * 14, Math.max(-sunH, 0.1) * 16, 8);
  moonLight.intensity = 0.45 * (1 - day);
  hemi.intensity = lerp(0.35, 1.5, day) * (1 - gloom * 0.35);

  wetness = lerp(wetness, state.rain ? 1 : 0, dt * 1.5);
  gloom = lerp(gloom, state.storm ? 1 : state.rain ? 0.55 : 0, dt * 1.2);
  smog = lerp(smog, clamp(state.stats.co2 / 30, 0, 1), dt * 0.8);

  skyAt(state.time, tmpA, tmpB);
  tmpA.lerp(stormGray, gloom * 0.6 * day).lerp(smogBrown, smog * 0.45 * day);
  tmpB.lerp(stormGray, gloom * 0.5 * day).lerp(smogBrown, smog * 0.55 * day);
  skyUniforms.top.value.copy(tmpA);
  skyUniforms.bottom.value.copy(tmpB);
  scene.fog.color.copy(tmpB);
  scene.fog.near = lerp(60, 18, smog * 0.6 + gloom * 0.3);
  stars.material.opacity = (1 - day) * (1 - gloom * 0.8);
  cloudMat.color.setRGB(1, 1, 1).lerp(stormGray, gloom * 0.8);

  grassMat.color.copy(C.grass).lerp(C.grassDead, smog * 0.85);
  grassMat.color.multiplyScalar(1 - wetness * 0.12);
  grassMat.roughness = lerp(0.9, 0.55, wetness);

  windowMat.emissiveIntensity = lerp(windowMat.emissiveIntensity, (1 - day) * (state.stats.powered ? 1.6 : 0.15), dt * 3);
  panelMat.emissiveIntensity = sunFactor() * 0.15;

  rain.material.opacity = wetness * 0.6;
  rain.visible = wetness > 0.02;
  if (rain.visible) {
    const pos = rainGeo.attributes.position.array;
    const fall = dt * (state.storm ? 22 : 15);
    const slant = (state.wind / 100) * dt * 6;
    for (let i = 0; i < RAIN_N; i++) {
      const o = i * 6;
      pos[o + 1] -= fall; pos[o + 4] -= fall;
      pos[o] += slant; pos[o + 3] += slant;
      if (pos[o + 1] < -6) {
        const x = rand(-12, 12), z = rand(-12, 12), y = rand(10, 14);
        pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
        pos[o + 3] = x - (state.wind / 100) * 0.15; pos[o + 4] = y - 0.35; pos[o + 5] = z;
      }
    }
    rainGeo.attributes.position.needsUpdate = true;
  }

  const windK = state.wind / 100 * (state.storm ? 1.5 : 1);
  clouds.forEach((c) => {
    c.position.x += dt * (0.3 + windK * 2.5) * c.userData.speed;
    if (c.position.x > 18) c.position.x = -18;
    c.position.y += Math.sin(t * 0.5 + c.userData.bob) * dt * 0.1;
  });

  if (state.storm && Math.random() < dt * 0.35) lightning();
  if (bolt) {
    bolt.userData.life += dt;
    bolt.material.opacity = 1 - bolt.userData.life / 0.35;
    if (bolt.userData.life > 0.35) { bolt.removeFromParent(); bolt = null; }
  }
}

/* ================================================================== */
/*  Resize                                                             */
/* ================================================================== */
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.fov = camera.aspect < 0.8 ? 55 : 38;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

/* ================================================================== */
/*  Main loop                                                          */
/* ================================================================== */
const easeOutBack = (k) => 1 + 2.7 * Math.pow(k - 1, 3) + 1.7 * Math.pow(k - 1, 2);
const tmpV = new THREE.Vector3();
let simTimer = 0, smokeTimer = 0;

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  updateEnvironment(dt, t);

  const windK = state.wind / 100 * (state.storm ? 1.5 : 1);
  world.position.y = Math.sin(t * 0.6) * 0.18;
  blob.scale.setScalar(1 - Math.sin(t * 0.6) * 0.03);

  // entities: grow-in, animate
  for (const e of state.entities) {
    const k = clamp((t - e.born) * 1.6 * state.grow, 0, 1);
    e.obj.scale.setScalar(e.baseScale * Math.max(0.001, easeOutBack(k)));
    const u = e.obj.userData;
    if (u.rotor) {
      u.rotor.rotation.z -= dt * (0.2 + Math.min(windK, 1.3) * 9);
      u.beacon.material.emissiveIntensity = isNight() ? (Math.sin(t * 4) > 0.6 ? 3 : 0.2) : 0;
    }
    if (u.sway) {
      const s = Math.sin(t * (1.5 + windK * 3) + e.x * 2) * (0.02 + windK * 0.09);
      u.sway.rotation.z = s;
      u.sway.rotation.x = s * 0.5;
    }
    if (u.duck) {
      const a = t * 0.5 + e.x;
      u.duck.position.set(Math.cos(a) * 0.5, 0.07 + Math.sin(t * 3) * 0.01, Math.sin(a) * 0.32);
      u.duck.rotation.y = -a - Math.PI;
      u.lilies.forEach((l, i) => { l.rotation.y += dt * (i % 2 ? 0.2 : -0.2); });
    }
  }
  // removals: shrink then dispose
  entityRoot.children.forEach((o) => {
    const e = o.userData.entity;
    if (e && e.dying) {
      const k = (t - e.dying) / 0.3;
      o.scale.setScalar(e.baseScale * Math.max(0.001, 1 - k));
      if (k >= 1) o.removeFromParent();
    }
  });

  // smoke from coal plants
  smokeTimer += dt;
  if (smokeTimer > 0.18) {
    smokeTimer = 0;
    for (const e of state.entities) {
      if (e.type !== 'coal' || t - e.born < 0.6) continue;
      for (const c of e.obj.userData.chimneys) puff(e.obj.localToWorld(tmpV.copy(c)));
    }
  }
  for (let i = puffs.length - 1; i >= 0; i--) {
    const p = puffs[i];
    p.life += dt;
    const k = p.life / p.max;
    p.s.position.y += dt * 1.1;
    p.s.position.x += dt * (0.2 + windK * 2.5);
    p.s.scale.setScalar(0.5 + k * 3.2);
    p.s.material.opacity = 0.65 * (1 - k);
    if (k >= 1) { p.s.removeFromParent(); p.s.material.dispose(); puffs.splice(i, 1); }
  }

  // burst particles
  for (let i = bits.length - 1; i >= 0; i--) {
    const b = bits[i];
    b.life += dt;
    b.vel.y -= b.gravity * dt;
    b.mesh.position.addScaledVector(b.vel, dt);
    b.mesh.rotation.x += dt * 5;
    const k = b.life / b.max;
    b.mesh.scale.multiplyScalar(0.985);
    if (k >= 1) { b.mesh.removeFromParent(); bits.splice(i, 1); }
  }

  // seed bombs
  for (let i = bombs.length - 1; i >= 0; i--) {
    const b = bombs[i];
    b.t += dt / b.dur;
    const k = Math.min(b.t, 1);
    const tw = world.localToWorld(tmpV.copy(b.target));
    b.m.position.lerpVectors(b.start, tw, k);
    b.m.position.y += Math.sin(k * Math.PI) * 4;
    b.m.rotation.x += dt * 10;
    if (k >= 1) {
      b.m.removeFromParent();
      bombs.splice(i, 1);
      burst(b.target.clone().setY(TOP + 0.1), [0xc98a5a, 0x7fd36b, 0xb9f27c], 18, 3);
      const type = pick(['tree', 'tree', 'pine', 'bush', 'flowers', 'flowers']);
      if (canPlace(type, b.target.x, b.target.z)) { spawn(type, b.target.x, b.target.z); sfx('grow'); save(); }
      else sfx('error');
    }
  }

  // pollen drift
  const pp = pollenGeo.attributes.position;
  for (let i = 0; i < POLLEN; i++) {
    let y = pp.getY(i) + dt * 0.3;
    if (y > 8) y = -4;
    pp.setY(i, y);
    pp.setX(i, pp.getX(i) + dt * windK * 0.8 + Math.sin(t + i) * dt * 0.1);
    if (pp.getX(i) > 10) pp.setX(i, -10);
  }
  pp.needsUpdate = true;
  pollen.material.opacity = 1 - wetness;

  fallTex.offset.y += dt * 1.2;
  sunGlow.material.rotation = t * 0.05;

  // economy + HUD ticks
  simTimer += dt;
  if (simTimer > 0.25) {
    simulate();
    if (state.started) {
      state.coins += state.stats.income * simTimer;
      checkMissions();
      renderHUD();
      renderMissions();
    }
    simTimer = 0;
  }

  controls.update();
  renderer.render(scene, camera);
}

/* ================================================================== */
/*  Start                                                              */
/* ================================================================== */
$('play').addEventListener('click', () => {
  state.started = true;
  $('title').classList.add('gone');
  hud.classList.remove('hidden');
  controls.autoRotate = false;
  selectTool('tree');
  sfx('win');
  toast('👋 Welcome! Pick a tool below and click the island.');
  setTimeout(() => $('hint').style.opacity = '0', 12000);
});

if (innerWidth < 860) {
  $('lab').classList.add('collapsed');
  $('lab-toggle').textContent = '+';
}

simulate();
renderHUD();
renderMissions();
tick();

// expose for tinkering in the console
window.island = { state, spawn, TYPES, lightning, randomIsland };
