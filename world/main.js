import * as THREE from '../vendor/three.module.js';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { Terrain, T, WATER, tkey, seasonUniforms, treeMaterial } from './terrain.js';
import { makeBuildingMesh, windowMaterial, darkWindowMaterial, lightMaterial } from './models.js';
import {
  G, DEFS, TOOLS, ALL_TOOLS, CATS, hooks, bindTerrain, canPlace, placeRoad, placeBuilding, plantTree, bulldoze,
  removeBuilding, advance, tileAt, isRoad, hourOfDay, day, season, serialize, restore, initialTick, pollutionAt, isAdult,
  sunFactor, DAYS_PER_SEASON,
} from './sim.js';
import { Agents } from './agents.js';

const SAVE_KEY = 'purpose-green-world-v1';
const NEW_SEED_KEY = 'purpose-green-new-seed';
const HOURS_PER_SECOND = 0.1; // 1 game hour = 10 real seconds at 1×

const $ = (id) => document.getElementById(id);
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const fmtMoney = (v) => (v < 0 ? '−$' : '$') + Math.abs(Math.round(v)).toLocaleString('en-US');

/* ================================================================== */
/*  Renderer, scene, camera                                            */
/* ================================================================== */
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfe9f7, 120, 300);
const camera = new THREE.PerspectiveCamera(45, 1, 0.3, 1200);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = false;
controls.minDistance = 8;
controls.maxDistance = 210;
controls.minPolarAngle = 0.15;
controls.maxPolarAngle = 1.38;
controls.zoomToCursor = true;
controls.zoomSpeed = 1.2;
controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
function setMouseMode(building) {
  controls.mouseButtons = building
    ? { LEFT: -1, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN }
    : { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
}
setMouseMode(false);

/* ---------- sky ---------- */
const skyU = { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } };
const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
  vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying vec3 vP;
    void main(){ float h = smoothstep(-0.05, 0.55, vP.y); gl_FragColor = vec4(mix(bottom, top, h), 1.0);
    #include <colorspace_fragment>
    }`,
}));
sky.renderOrder = -1;
scene.add(sky);

const starGeo = new THREE.BufferGeometry();
{
  const p = [];
  for (let k = 0; k < 1200; k++) {
    const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 0.95 + 0.05);
    p.push(Math.cos(th) * Math.sin(ph) * 800, Math.cos(ph) * 800, Math.sin(th) * Math.sin(ph) * 800);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
}
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
scene.add(stars);

function glowTex(rgb, inner = 0.8) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grd.addColorStop(0, `rgba(${rgb},${inner})`);
  grd.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex('255,220,120', 1), fog: false, depthWrite: false, transparent: true }));
sunSprite.scale.setScalar(160);
const moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex('225,232,255', 1), fog: false, depthWrite: false, transparent: true }));
moonSprite.scale.setScalar(70);
scene.add(sunSprite, moonSprite);

/* ---------- lights ---------- */
const hemi = new THREE.HemisphereLight(0xffffff, 0x8fbf8a, 1.3);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 400 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);
const moon = new THREE.DirectionalLight(0x9db4ff, 0.3);
scene.add(moon, moon.target);

/* ---------- water ---------- */
const water = new THREE.Mesh(
  new THREE.PlaneGeometry(1400, 1400).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x3a9ed6, roughness: 0.12, metalness: 0.15, transparent: true, opacity: 0.84 }),
);
water.position.y = WATER;
water.receiveShadow = true;
scene.add(water);

/* ================================================================== */
/*  World                                                              */
/* ================================================================== */
let terrain = null, agents = null;
const meshes = new Map(); // building id -> { group, icon, height }

hooks.onAdd = (b) => {
  const d = DEFS[b.type];
  const g = makeBuildingMesh(b.type, b.variant);
  g.position.set((b.i + b.size / 2) * T, b.level, (b.j + b.size / 2) * T);
  g.rotation.y = b.rot;
  scene.add(g);
  const box = new THREE.Box3().setFromObject(g);
  const entry = { group: g, icon: null, height: box.max.y - b.level, bornAt: performance.now() };
  if (b.progress < 1) {
    const fence = new THREE.Mesh(new THREE.BoxGeometry(d.size * T * 0.92, 0.5, d.size * T * 0.92), scaffoldMat);
    fence.position.set(g.position.x, b.level + 0.25, g.position.z);
    scene.add(fence);
    entry.fence = fence;
  }
  meshes.set(b.id, entry);
};
hooks.onRemove = (b, reason) => {
  const e = meshes.get(b.id);
  if (!e) return;
  scene.remove(e.group);
  if (e.icon) scene.remove(e.icon);
  if (e.fence) scene.remove(e.fence);
  meshes.delete(b.id);
  const p = e.group.position;
  for (let k = 0; k < (reason === 'fire' ? 14 : 8); k++) puff(new THREE.Vector3(p.x + (Math.random() - 0.5) * b.size * T, p.y + 0.5, p.z + (Math.random() - 0.5) * b.size * T), reason === 'fire' ? 0x333333 : 0xbfae90, 2.2, 1.5);
  if (inspected?.kind === 'building' && inspected.id === b.id) closeInspector();
};
hooks.onEvent = (text, kind) => feed(text, kind);
hooks.onFire = (b, started) => { if (started) toast(`🔥 Fire! Click to see it.`, 'bad', () => flyTo(b.i * T, b.j * T)); };
const scaffoldMat = new THREE.MeshBasicMaterial({ color: 0xffa53a, transparent: true, opacity: 0.35, depthWrite: false });

/* ---------- emoji problem icons ---------- */
const iconMats = new Map();
function iconMat(emoji) {
  if (!iconMats.has(emoji)) {
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    const g = c.getContext('2d');
    g.fillStyle = emoji === '🚧' ? '#ffffffcc' : '#ffffff';
    g.beginPath(); g.arc(48, 48, 40, 0, Math.PI * 2); g.fill();
    g.lineWidth = 6; g.strokeStyle = emoji === '🚧' ? '#ffa53a' : '#e0434f'; g.stroke();
    g.font = '48px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(emoji, 48, 52);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    iconMats.set(emoji, new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  }
  return iconMats.get(emoji);
}

/* ---------- smoke, flames, dust ---------- */
const smokeTex = glowTex('255,255,255', 0.9);
const puffs = [];
function puff(pos, color = 0x9a9a9a, size = 1, life = 4, rise = 1.2) {
  if (puffs.length > 420) { const old = puffs.shift(); scene.remove(old.s); old.s.material.dispose(); }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color, transparent: true, depthWrite: false, opacity: 0.6 }));
  s.position.copy(pos);
  s.scale.setScalar(size * 0.6);
  scene.add(s);
  puffs.push({ s, life: 0, max: life * (0.8 + Math.random() * 0.4), size, rise });
}

/* ---------- precipitation ---------- */
const RAIN_N = 2600;
const rainGeo = new THREE.BufferGeometry();
rainGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RAIN_N * 6), 3));
const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xbcdcff, transparent: true, opacity: 0.5 }));
rain.frustumCulled = false;
scene.add(rain);
const snowGeo = new THREE.BufferGeometry();
snowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RAIN_N * 3), 3));
const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.35, map: smokeTex, transparent: true, depthWrite: false }));
snow.frustumCulled = false;
scene.add(snow);
function seedPrecip() {
  const r = rainGeo.attributes.position.array, s = snowGeo.attributes.position.array;
  for (let k = 0; k < RAIN_N; k++) {
    const x = (Math.random() - 0.5) * 140, y = Math.random() * 60, z = (Math.random() - 0.5) * 140;
    r.set([x, y, z, x, y - 0.9, z], k * 6);
    s.set([x, y, z], k * 3);
  }
}
seedPrecip();

/* ---------- previews ---------- */
const previewMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
const preview = new THREE.InstancedMesh(new THREE.BoxGeometry(T * 0.96, 0.14, T * 0.96), previewMat, 600);
preview.count = 0;
preview.frustumCulled = false;
preview.setColorAt(0, new THREE.Color());
scene.add(preview);
const ghostOk = new THREE.MeshBasicMaterial({ color: 0x5cff9d, transparent: true, opacity: 0.5, depthWrite: false });
const ghostBad = new THREE.MeshBasicMaterial({ color: 0xff5d6c, transparent: true, opacity: 0.5, depthWrite: false });
const radiusRing = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthTest: false }));
radiusRing.visible = false;
radiusRing.renderOrder = 10;
scene.add(radiusRing);
const radiusDisc = new THREE.Mesh(new THREE.CircleGeometry(1, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x5cff9d, transparent: true, opacity: 0.08, depthTest: false }));
radiusRing.add(radiusDisc);
let ghost = null;

/* ================================================================== */
/*  Tools & input                                                      */
/* ================================================================== */
const LINE_TOOLS = new Set(['road', 'bulldoze', 'tree']);
let tool = 'inspect';
let rotManual = null;
let currentCat = 'roads';
let hover = null; // { i, j, x, z }
let dragStart = null, touchStart = null;
let downAt = null;
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function pickGround(cx, cy) {
  ndc.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(terrain.pickables, false)[0];
  if (!hit) return null;
  return { x: hit.point.x, z: hit.point.z, i: Math.floor(hit.point.x / T), j: Math.floor(hit.point.z / T) };
}

function originFor(type, h) {
  const size = DEFS[type]?.size || 1;
  if (size === 1) return [h.i, h.j];
  return [Math.round(h.x / T - size / 2), Math.round(h.z / T - size / 2)];
}

function autoRot(type, i, j) {
  const s = DEFS[type].size;
  for (let k = 0; k < s; k++) {
    if (isRoad(i + k, j + s)) return 0;
    if (isRoad(i + s, j + k)) return Math.PI / 2;
    if (isRoad(i - 1, j + k)) return -Math.PI / 2;
    if (isRoad(i + k, j - 1)) return Math.PI;
  }
  return 0;
}

function lineTiles(a, b) {
  const out = [];
  const di = Math.sign(b.i - a.i), dj = Math.sign(b.j - a.j);
  const horizFirst = Math.abs(b.i - a.i) >= Math.abs(b.j - a.j);
  let i = a.i, j = a.j;
  out.push([i, j]);
  const stepI = () => { while (i !== b.i) { i += di; out.push([i, j]); } };
  const stepJ = () => { while (j !== b.j) { j += dj; out.push([i, j]); } };
  if (horizFirst) { stepI(); stepJ(); } else { stepJ(); stepI(); }
  return out.slice(0, 600);
}

function selectTool(t) {
  tool = t;
  rotManual = null;
  dragStart = touchStart = null;
  setMouseMode(t !== 'inspect');
  document.querySelectorAll('.tool').forEach((el) => el.classList.toggle('on', el.dataset.tool === t));
  if (ghost) { scene.remove(ghost); ghost = null; }
  if (DEFS[t] && t !== 'road') {
    ghost = makeBuildingMesh(t, 0);
    ghost.traverse((o) => { if (o.isMesh) { o.material = ghostOk; o.castShadow = false; } });
    ghost.visible = false;
    scene.add(ghost);
  }
  const d = ALL_TOOLS[t];
  $('tip').textContent = d ? `${d.icon} ${d.name}${d.cost ? ` · $${d.cost.toLocaleString()}` : ''} — ${d.desc}${LINE_TOOLS.has(t) ? ' Drag to draw a line.' : ''}${DEFS[t] && DEFS[t].size ? ' R to rotate.' : ''}` : '';
  updatePreview();
}

function updatePreview() {
  preview.count = 0;
  radiusRing.visible = false;
  if (ghost) ghost.visible = false;
  setLabel('');
  if (!hover || tool === 'inspect' || walking) return;
  const col = new THREE.Color(), m = new THREE.Matrix4();
  if (LINE_TOOLS.has(tool)) {
    const start = dragStart || touchStart;
    const tiles = start ? lineTiles(start, hover) : [[hover.i, hover.j]];
    let n = 0, valid = 0, cost = 0;
    for (const [i, j] of tiles) {
      let ok;
      if (tool === 'road') ok = isRoad(i, j) || canPlace('road', i, j).ok;
      else if (tool === 'tree') ok = canPlace('tree', i, j).ok;
      else ok = !!(tileAt(i, j) || terrain.hasTree(i, j));
      if (tool === 'road' && !isRoad(i, j) && ok) { valid++; cost += DEFS.road.cost; }
      if (tool === 'tree' && ok) { valid++; cost += TOOLS.tree.cost; }
      if (tool === 'bulldoze' && ok) valid++;
      const h = terrain.tileStats(i, j).max;
      m.makeTranslation((i + 0.5) * T, Math.max(h, WATER) + 0.12, (j + 0.5) * T);
      preview.setMatrixAt(n, m);
      preview.setColorAt(n, col.set(tool === 'bulldoze' ? (ok ? 0xff5d6c : 0xffffff) : ok ? 0x5cff9d : 0xff5d6c));
      n++;
    }
    preview.count = n;
    preview.instanceMatrix.needsUpdate = true;
    preview.instanceColor.needsUpdate = true;
    if (tool === 'bulldoze') setLabel(valid ? `Remove ${valid}` : '');
    else setLabel(valid ? `${valid} × · $${cost.toLocaleString()}${cost > G.money ? ' — not enough money' : ''}` : (start ? '' : canPlace(tool, hover.i, hover.j).reason || ''), cost > G.money || !valid);
    return;
  }
  if (DEFS[tool]) {
    const [i, j] = originFor(tool, hover);
    const d = DEFS[tool];
    const chk = canPlace(tool, i, j);
    let level = 0, n = 0;
    for (let a = 0; a <= d.size; a++) for (let b = 0; b <= d.size; b++) { level += terrain.cornerH(i + a, j + b); n++; }
    level /= n;
    ghost.visible = true;
    ghost.position.set((i + d.size / 2) * T, level, (j + d.size / 2) * T);
    ghost.rotation.y = rotManual ?? autoRot(tool, i, j);
    ghost.traverse((o) => { if (o.isMesh) o.material = chk.ok ? ghostOk : ghostBad; });
    if (d.radius) {
      radiusRing.visible = true;
      radiusRing.position.set(ghost.position.x, level + 0.4, ghost.position.z);
      radiusRing.scale.setScalar(d.radius * T);
    }
    setLabel(chk.ok ? `${d.name} · $${d.cost.toLocaleString()}` : chk.reason, !chk.ok);
  }
}

let mouseX = 0, mouseY = 0;
function setLabel(text, bad = false) {
  const el = $('cursor-label');
  el.textContent = text;
  el.classList.toggle('bad', bad);
  el.style.left = mouseX + 'px';
  el.style.top = mouseY + 'px';
}

function applyAt(h) {
  if (DEFS[tool] && tool !== 'road') {
    const [i, j] = originFor(tool, h);
    const chk = canPlace(tool, i, j);
    if (!chk.ok) { toast(chk.reason, 'bad'); return; }
    const b = placeBuilding(tool, i, j, rotManual ?? autoRot(tool, i, j));
    if (b) {
      const p = meshes.get(b.id).group.position;
      for (let k = 0; k < 6; k++) puff(new THREE.Vector3(p.x + (Math.random() - 0.5) * 2, p.y + 0.3, p.z + (Math.random() - 0.5) * 2), 0xd9c9a8, 1.3, 1.2, 0.6);
      if (!b.road && !findRoadAdj(b)) toast('Tip: connect it to a road so it can work', '');
    }
  }
}
const findRoadAdj = (b) => {
  for (let a = b.i - 1; a <= b.i + b.size; a++) for (let c = b.j - 1; c <= b.j + b.size; c++) if (isRoad(a, c)) return true;
  return false;
};

function applyLine(a, b) {
  const tiles = lineTiles(a, b);
  let n = 0;
  for (const [i, j] of tiles) {
    if (tool === 'road') { if (!isRoad(i, j) && placeRoad(i, j)) n++; }
    else if (tool === 'tree') { if (plantTree(i, j)) n++; }
    else if (tool === 'bulldoze') { if (bulldoze(i, j)) n++; }
  }
  if (!n && tool === 'road') toast(canPlace('road', b.i, b.j).reason || 'Nothing to build', 'bad');
}

canvas.addEventListener('pointerdown', (e) => {
  downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
  if (!started || walking) return;
  if (e.button === 0 && e.pointerType === 'mouse' && LINE_TOOLS.has(tool)) {
    const h = pickGround(e.clientX, e.clientY);
    if (h) dragStart = h;
  }
});
canvas.addEventListener('pointermove', (e) => {
  mouseX = e.clientX; mouseY = e.clientY;
  if (!started || walking) return;
  const h = pickGround(e.clientX, e.clientY);
  if (h && (!hover || h.i !== hover.i || h.j !== hover.j || DEFS[tool]?.size === 2)) { hover = h; updatePreview(); }
  else if (!h) { hover = null; updatePreview(); }
  else setLabel($('cursor-label').textContent, $('cursor-label').classList.contains('bad'));
});
canvas.addEventListener('pointerleave', () => { hover = null; updatePreview(); });
canvas.addEventListener('pointerup', (e) => {
  if (!started || walking || !downAt) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  const h = pickGround(e.clientX, e.clientY);
  if (dragStart && e.button === 0) {
    if (h) applyLine(dragStart, h);
    dragStart = null;
    hover = h;
    updatePreview();
    downAt = null;
    return;
  }
  if (moved > 7 || e.button !== 0) { downAt = null; return; }
  downAt = null;
  if (tool === 'inspect') { inspectAt(e.clientX, e.clientY, h); return; }
  if (!h) return;
  if (LINE_TOOLS.has(tool)) {
    // touch: first tap sets the start, second tap builds the line
    if (e.pointerType !== 'mouse') {
      if (!touchStart) { touchStart = h; hover = h; updatePreview(); toast('Tap the end point', ''); return; }
      applyLine(touchStart, h);
      touchStart = null;
    } else applyLine(h, h);
  } else applyAt(h);
  hover = h;
  updatePreview();
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

/* ---------- keyboard ---------- */
const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  keys.add(k);
  if (!started) return;
  if (k === 'escape' && !walking) { if (tool !== 'inspect') selectTool('inspect'); else closeInspector(); }
  if (walking) return;
  if (k === ' ') { e.preventDefault(); setSpeed(G.speed ? 0 : lastSpeed || 1); }
  if (k === 'r' && ghost) { rotManual = ((rotManual ?? ghost.rotation.y) + Math.PI / 2) % (Math.PI * 2); updatePreview(); }
  if (k === 'f') enterWalk();
  if (k === 'b' || k === 'delete') selectTool('bulldoze');
  if (k === 'h') $('hud').classList.toggle('off');
  if (/^[1-9]$/.test(k)) { const list = toolsInCat(currentCat); if (list[+k - 1]) selectTool(list[+k - 1]); }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());

/* ================================================================== */
/*  Walk mode                                                          */
/* ================================================================== */
let walking = false, yaw = 0, pitch = 0;
const walkPos = new THREE.Vector3();
function enterWalk() {
  if (!canvas.requestPointerLock || matchMedia('(pointer: coarse)').matches) { toast('Walk mode needs a mouse and keyboard', 'bad'); return; }
  walking = true;
  walkPos.copy(controls.target);
  const off = camera.position.clone().sub(controls.target);
  yaw = Math.atan2(-off.x, -off.z);
  pitch = -0.08;
  // start a few steps back so the city is in front of you
  walkPos.x -= Math.sin(yaw) * 14;
  walkPos.z -= Math.cos(yaw) * 14;
  controls.enabled = false;
  $('hud').classList.add('walking');
  $('walk-hint').classList.remove('hidden');
  hover = null; updatePreview();
  canvas.requestPointerLock();
}
function exitWalk() {
  if (!walking) return;
  walking = false;
  controls.enabled = true;
  $('hud').classList.remove('walking');
  $('walk-hint').classList.add('hidden');
  const ground = Math.max(WATER, terrain.surfaceH(walkPos.x, walkPos.z));
  controls.target.set(walkPos.x, ground, walkPos.z);
  camera.position.set(walkPos.x - Math.sin(yaw) * 30, ground + 28, walkPos.z - Math.cos(yaw) * 30);
}
document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement !== canvas) exitWalk(); });
document.addEventListener('mousemove', (e) => {
  if (!walking || document.pointerLockElement !== canvas) return;
  yaw -= e.movementX * 0.0022;
  pitch = clamp(pitch - e.movementY * 0.0022, -1.4, 1.4);
});
$('b-walk').addEventListener('click', enterWalk);

/* ================================================================== */
/*  Camera helpers                                                     */
/* ================================================================== */
let flyTarget = null;
function flyTo(x, z) { flyTarget = new THREE.Vector3(x, 0, z); }
$('b-home').addEventListener('click', () => {
  let sx = 0, sz = 0, n = 0;
  for (const b of G.buildings.values()) { sx += b.i; sz += b.j; n++; }
  flyTo(n ? (sx / n) * T : spawn.x, n ? (sz / n) * T : spawn.z);
});

function updateCamera(dt) {
  if (walking) {
    const speed = (keys.has('shift') ? 14 : 5) * dt;
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    if (keys.has('w') || keys.has('arrowup')) walkPos.addScaledVector(fwd, speed);
    if (keys.has('s') || keys.has('arrowdown')) walkPos.addScaledVector(fwd, -speed);
    if (keys.has('a') || keys.has('arrowleft')) walkPos.addScaledVector(right, -speed);
    if (keys.has('d') || keys.has('arrowright')) walkPos.addScaledVector(right, speed);
    const ground = Math.max(WATER + 0.4, terrain.surfaceH(walkPos.x, walkPos.z));
    camera.position.set(walkPos.x, ground + 1.7, walkPos.z);
    camera.lookAt(walkPos.x + Math.sin(yaw) * Math.cos(pitch), ground + 1.7 + Math.sin(pitch), walkPos.z + Math.cos(yaw) * Math.cos(pitch));
    return;
  }
  const t = controls.target;
  const off = camera.position.clone().sub(t);
  const dist = off.length();
  // keyboard panning & rotation
  const fwd = new THREE.Vector3(-off.x, 0, -off.z).normalize(), right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const pan = new THREE.Vector3();
  if (started) {
    if (keys.has('w') || keys.has('arrowup')) pan.add(fwd);
    if (keys.has('s') || keys.has('arrowdown')) pan.sub(fwd);
    if (keys.has('a') || keys.has('arrowleft')) pan.sub(right);
    if (keys.has('d') || keys.has('arrowright')) pan.add(right);
  }
  if (pan.lengthSq()) {
    pan.normalize().multiplyScalar(dt * (20 + dist * 1.2) * (keys.has('shift') ? 2.5 : 1));
    t.add(pan); camera.position.add(pan);
  }
  const rot = (keys.has('q') ? 1 : 0) - (keys.has('e') ? 1 : 0);
  if (rot && started) {
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), rot * dt * 1.6);
    camera.position.copy(t).add(off);
  }
  if (flyTarget) {
    const d = new THREE.Vector3(flyTarget.x - t.x, 0, flyTarget.z - t.z);
    const step = d.clone().multiplyScalar(Math.min(1, dt * 3));
    t.add(step); camera.position.add(step);
    if (d.length() < 0.5) flyTarget = null;
  }
  if (following) {
    const a = following;
    if (![...agents.cars, ...agents.peds].includes(a)) following = null;
    else { const d = a.pos.clone().sub(t); d.y = 0; d.multiplyScalar(Math.min(1, dt * 4)); t.add(d); camera.position.add(d); }
  }
  // keep the orbit centre on the ground so the camera glides over hills
  const ground = Math.max(WATER, terrain.surfaceH(t.x, t.z));
  const dy = (ground - t.y) * Math.min(1, dt * 4);
  t.y += dy; camera.position.y += dy;
  const minY = Math.max(WATER, terrain.surfaceH(camera.position.x, camera.position.z)) + 2;
  if (camera.position.y < minY) camera.position.y = minY;
  if (!started) {
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), dt * 0.05);
    camera.position.copy(t).add(off);
  }
  controls.update();
}
let following = null;

/* ================================================================== */
/*  Environment (sky, light, weather, seasons)                         */
/* ================================================================== */
const SKY = [
  [0, 0x08122b, 0x18264a], [5, 0x141f45, 0x34396a], [6, 0x5a6fb0, 0xffa987], [7.5, 0x79c2ee, 0xffe1bd],
  [12, 0x4aa9ea, 0xd6efff], [17, 0x6aaee4, 0xffd7a3], [18.8, 0x474c8c, 0xff8c66], [20, 0x172350, 0x37335f], [24, 0x08122b, 0x18264a],
];
const cA = new THREE.Color(), cB = new THREE.Color(), cC = new THREE.Color(), gray = new THREE.Color(0x6b7684), haze = new THREE.Color(0xa59a7d);
const TREE_TINT = { Spring: new THREE.Color(1.05, 1.08, 1.0), Summer: new THREE.Color(1, 1, 1), Autumn: new THREE.Color(1.55, 0.92, 0.45), Winter: new THREE.Color(0.85, 0.9, 0.95) };
let gloom = 0, wet = 0, flash = 0, snowCover = 0;

function updateEnvironment(dt) {
  const h = hourOfDay();
  const ang = ((h - 6) / 12) * Math.PI;
  const sunH = Math.sin(ang);
  const dayK = clamp(sunH * 3 + 0.3, 0, 1);
  const kind = G.weather.kind;
  gloom = lerp(gloom, kind === 'storm' ? 1 : kind === 'rain' || kind === 'snow' ? 0.6 : kind === 'cloudy' ? 0.35 : 0, dt * 0.6);
  wet = lerp(wet, kind === 'rain' || kind === 'storm' ? 1 : 0, dt * 0.8);

  for (let k = 0; k < SKY.length - 1; k++) {
    const [h0, t0, b0] = SKY[k], [h1, t1, b1] = SKY[k + 1];
    if (h >= h0 && h <= h1) { const f = (h - h0) / (h1 - h0); cA.set(t0).lerp(cC.set(t1), f); cB.set(b0).lerp(cC.set(b1), f); break; }
  }
  let poll = 0;
  if (terrain) poll = clamp(pollutionAt(Math.floor(controls.target.x / T), Math.floor(controls.target.z / T)) / 14, 0, 1);
  cA.lerp(gray, gloom * 0.65 * dayK).lerp(haze, poll * 0.4 * dayK);
  cB.lerp(gray, gloom * 0.55 * dayK).lerp(haze, poll * 0.5 * dayK);
  skyU.top.value.copy(cA);
  skyU.bottom.value.copy(cB);
  scene.fog.color.copy(cB);

  const t = controls.target;
  const sd = new THREE.Vector3(-Math.cos(ang) * 0.8, Math.max(0.08, sunH), 0.45).normalize();
  sun.position.copy(t).addScaledVector(sd, 160);
  sun.target.position.copy(t);
  sun.intensity = 2.6 * clamp(sunH * 2.5, 0, 1) * (1 - gloom * 0.65);
  sun.color.setHSL(0.09, 0.8, lerp(0.62, 0.93, clamp(sunH * 2, 0, 1)));
  moon.position.copy(t).add(new THREE.Vector3(Math.cos(ang) * 100, Math.max(20, -sunH * 140), -40));
  moon.target.position.copy(t);
  moon.intensity = 0.5 * (1 - dayK);
  hemi.intensity = lerp(0.3, 1.35, dayK) * (1 - gloom * 0.35) + flash;
  flash = Math.max(0, flash - dt * 6);
  if (kind === 'storm' && Math.random() < dt * 0.25) flash = 2.5;

  const cp = camera.position;
  sky.position.copy(cp); stars.position.copy(cp);
  sunSprite.position.set(cp.x - Math.cos(ang) * 600, cp.y + sunH * 500, cp.z + 300);
  moonSprite.position.set(cp.x + Math.cos(ang) * 600, cp.y - sunH * 500, cp.z + 300);
  sunSprite.material.opacity = (1 - gloom) * clamp(sunH * 4 + 0.3, 0, 1);
  moonSprite.material.opacity = (1 - gloom) * clamp(-sunH * 4 + 0.3, 0, 1);
  stars.material.opacity = (1 - dayK) * (1 - gloom * 0.9);

  const lit = 1 - dayK * 0.85;
  windowMaterial.emissiveIntensity = lit * 1.4;
  lightMaterial.emissiveIntensity = (1 - dayK) * 3 * (Math.sin(performance.now() / 300) > 0.4 ? 1 : 0.1);

  // seasons
  const se = season();
  const winterSnow = se.name === 'Winter' ? (kind === 'snow' ? 1 : 0.75) : 0;
  snowCover = lerp(snowCover, winterSnow, dt * 0.3);
  seasonUniforms.uSnow.value = snowCover;
  treeMaterial.color.lerp(TREE_TINT[se.name], dt * 0.3);

  // fog depends on zoom and weather
  const dist = walking ? 20 : cp.distanceTo(t);
  scene.fog.near = (dist * 0.7 + 40) * (1 - gloom * 0.45);
  scene.fog.far = (dist + 170) * (1 - gloom * 0.3);
  water.position.x = Math.round(t.x / 50) * 50;
  water.position.z = Math.round(t.z / 50) * 50;
  water.material.color.setHSL(0.56, 0.6, lerp(0.15, 0.48, dayK) * (1 - gloom * 0.3));

  // precipitation follows the camera target
  const raining = (kind === 'rain' || kind === 'storm') && !walking ? 1 : walking && (kind === 'rain' || kind === 'storm') ? 1 : 0;
  rain.visible = raining > 0;
  snow.visible = kind === 'snow';
  const base = walking ? walkPos : t;
  if (rain.visible) {
    rain.position.set(base.x, base.y, base.z);
    const a = rainGeo.attributes.position.array, fall = dt * (kind === 'storm' ? 55 : 38), slant = G.weather.wind * dt * 10;
    for (let k = 0; k < RAIN_N; k++) {
      const o = k * 6;
      a[o + 1] -= fall; a[o + 4] -= fall; a[o] += slant; a[o + 3] += slant;
      if (a[o + 1] < -5) { const x = (Math.random() - 0.5) * 140, z = (Math.random() - 0.5) * 140; a[o] = x; a[o + 1] = 55; a[o + 2] = z; a[o + 3] = x - G.weather.wind * 0.3; a[o + 4] = 54.1; a[o + 5] = z; }
    }
    rainGeo.attributes.position.needsUpdate = true;
  }
  if (snow.visible) {
    snow.position.set(base.x, base.y, base.z);
    const a = snowGeo.attributes.position.array, tt = performance.now() / 1000;
    for (let k = 0; k < RAIN_N; k++) {
      const o = k * 3;
      a[o + 1] -= dt * 3.5;
      a[o] += Math.sin(tt + k) * dt * 0.6 + G.weather.wind * dt * 2;
      if (a[o + 1] < -5) { a[o] = (Math.random() - 0.5) * 140; a[o + 1] = 55; a[o + 2] = (Math.random() - 0.5) * 140; }
    }
    snowGeo.attributes.position.needsUpdate = true;
  }
}

/* ================================================================== */
/*  Per-frame building visuals                                         */
/* ================================================================== */
let visTimer = 0;
const tmpV = new THREE.Vector3();
function updateBuildings(dt, gameDt) {
  visTimer += dt;
  const slow = visTimer > 0.4;
  if (slow) visTimer = 0;
  const cam = controls.target;
  for (const b of G.buildings.values()) {
    const e = meshes.get(b.id);
    if (!e) continue;
    const g = e.group;
    const near = Math.abs(g.position.x - cam.x) < 260 && Math.abs(g.position.z - cam.z) < 260;
    g.visible = near;
    if (!near) { if (e.icon) e.icon.visible = false; continue; }
    // construction grows the building out of the ground
    const k = b.progress;
    g.scale.set(1, k < 1 ? 0.08 + 0.92 * (1 - Math.pow(1 - k, 3)) : 1, 1);
    if (e.fence && k >= 1) { scene.remove(e.fence); e.fence = null; }
    if (g.userData.rotor) g.userData.rotor.rotation.z -= dt * (b.working ? 0.5 + G.weather.wind * 6 : 0.1) * Math.min(3, Math.max(G.speed, 0.2));
    if (slow) {
      if (g.userData.windows) g.userData.windows.material = b.powered && b.progress >= 1 ? windowMaterial : darkWindowMaterial;
      const issue = b.issues[0];
      if (issue) {
        if (!e.icon) { e.icon = new THREE.Sprite(iconMat(issue)); e.icon.scale.setScalar(1.5); e.icon.renderOrder = 20; scene.add(e.icon); }
        e.icon.material = iconMat(issue);
        e.icon.visible = true;
      } else if (e.icon) e.icon.visible = false;
    }
    if (e.icon && e.icon.visible) e.icon.position.set(g.position.x, b.level + e.height * g.scale.y + 1 + Math.sin(performance.now() / 300 + b.id) * 0.15, g.position.z);
    // smoke & fire
    if (!G.speed) continue;
    const chim = g.userData.chimneys;
    if (chim.length && b.working && Math.random() < dt * 3 * Math.min(G.speed, 3)) {
      for (const c of chim) puff(g.localToWorld(tmpV.copy(c)), b.type === 'coal' ? 0x8c8c8c : 0xa7a7a7, 1.2, 5, 1.4);
    }
    if (b.fire && Math.random() < dt * 14) {
      const p = g.position;
      puff(new THREE.Vector3(p.x + (Math.random() - 0.5) * b.size * 1.6, p.y + e.height * 0.6, p.z + (Math.random() - 0.5) * b.size * 1.6), Math.random() < 0.5 ? 0xff7a1a : 0xffc23d, 1.1, 0.8, 3);
      if (Math.random() < 0.4) puff(new THREE.Vector3(p.x, p.y + e.height + 0.5, p.z), 0x333333, 2, 4, 1.6);
    }
  }
  for (let n = puffs.length - 1; n >= 0; n--) {
    const p = puffs[n];
    p.life += dt;
    const f = p.life / p.max;
    p.s.position.y += dt * p.rise;
    p.s.position.x += dt * G.weather.wind * 2;
    p.s.scale.setScalar(p.size * (0.6 + f * 2.4));
    p.s.material.opacity = 0.6 * (1 - f);
    if (f >= 1) { scene.remove(p.s); p.s.material.dispose(); puffs.splice(n, 1); }
  }
}

/* ================================================================== */
/*  UI                                                                 */
/* ================================================================== */
const toolsInCat = (cat) => Object.keys(ALL_TOOLS).filter((k) => ALL_TOOLS[k].cat === cat);
function renderBuildBar() {
  $('cats').innerHTML = CATS.map((c) => `<button data-cat="${c.id}" class="${c.id === currentCat ? 'on' : ''}">${c.icon} ${c.name}</button>`).join('');
  const fixed = ['inspect', 'bulldoze'].map((k) => toolBtn(k, true)).join('');
  $('tools').innerHTML = fixed + toolsInCat(currentCat).map((k, n) => toolBtn(k, false, n + 1)).join('');
  document.querySelectorAll('.tool').forEach((el) => el.classList.toggle('on', el.dataset.tool === tool));
  refreshAffordability();
}
function toolBtn(k, fixed, n) {
  const d = ALL_TOOLS[k];
  return `<button class="tool ${fixed ? 'fixed' : ''}" data-tool="${k}" title="${d.name}${n ? ` (${n})` : ''} — ${d.desc}">${d.cost ? `<span class="cost">$${d.cost >= 1000 ? (d.cost / 1000) + 'k' : d.cost}</span>` : ''}<span class="em">${d.icon}</span><span class="nm">${d.name}</span></button>`;
}
function refreshAffordability() {
  document.querySelectorAll('.tool').forEach((el) => { const c = ALL_TOOLS[el.dataset.tool].cost || 0; el.classList.toggle('poor', c > G.money); });
}
$('cats').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; currentCat = b.dataset.cat; renderBuildBar(); const first = toolsInCat(currentCat)[0]; if (first) selectTool(first); });
$('tools').addEventListener('click', (e) => { const b = e.target.closest('.tool'); if (b) selectTool(b.dataset.tool); });

let lastSpeed = 1;
function setSpeed(s) {
  if (s) lastSpeed = s;
  G.speed = s;
  document.querySelectorAll('#speeds button').forEach((b) => b.classList.toggle('on', +b.dataset.speed === s));
}
$('speeds').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setSpeed(+b.dataset.speed); });

function feed(text, kind = '') {
  const el = document.createElement('div');
  el.className = kind;
  el.textContent = text;
  const f = $('feed');
  f.appendChild(el);
  while (f.children.length > 6) f.firstChild.remove();
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 1000); }, 9000);
}
function toast(text, kind = '', onClick) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  if (onClick) { el.style.pointerEvents = 'auto'; el.style.cursor = 'pointer'; el.onclick = onClick; }
  $('toasts').appendChild(el);
  while ($('toasts').children.length > 3) $('toasts').firstChild.remove();
  setTimeout(() => el.remove(), 2900);
}

function wxIcon() {
  const night = hourOfDay() < 6 || hourOfDay() > 19.5;
  return { sun: night ? '🌙' : '☀️', cloudy: '☁️', rain: '🌧️', storm: '⛈️', snow: '🌨️' }[G.weather.kind];
}

function renderHUD() {
  const s = G.stats;
  if (!s || s.pop === undefined) return;
  $('s-money').textContent = fmtMoney(G.money);
  const net = G.lastDay ? G.lastDay.net : null;
  $('s-net').textContent = net === null ? 'first payday at midnight' : `${net >= 0 ? '+' : '−'}$${Math.abs(Math.round(net)).toLocaleString()} / day`;
  $('s-money').parentElement.parentElement.classList.toggle('bad', G.money < 0);
  $('s-pop').textContent = s.pop.toLocaleString();
  $('s-jobs').textContent = `${s.employed} employed · ${s.unemployed} jobless`;
  $('s-happy').textContent = s.pop ? `${Math.round(s.happy)}% happy` : '—';
  $('s-health').textContent = s.pop ? `${Math.round(s.health)}% health · ${s.sick} sick` : 'no residents yet';
  $('s-mood-i').textContent = !s.pop ? '🙂' : s.happy > 70 ? '😄' : s.happy > 50 ? '🙂' : s.happy > 35 ? '😐' : '😟';
  $('s-power').textContent = `${s.pSup.toFixed(0)}/${s.pDem.toFixed(0)}`;
  $('s-power2').textContent = `MW${s.unpowered ? ` · ${s.unpowered} off` : ''}`;
  $('c-power').classList.toggle('bad', s.unpowered > 0);
  $('c-power').classList.toggle('warn', !s.unpowered && s.pDem > 0 && s.pSup < s.pDem * 1.1);
  $('s-water').textContent = `${s.wSup.toFixed(0)}/${s.wDem.toFixed(0)}`;
  $('s-water2').textContent = `units${s.unwatered ? ` · ${s.unwatered} dry` : ''}`;
  $('c-water').classList.toggle('bad', s.unwatered > 0);
  $('s-food').textContent = Math.round(G.food).toLocaleString();
  $('s-food2').textContent = `${(G.foodRate ?? 0) >= 0 ? '+' : ''}${Math.round(G.foodRate ?? 0)}/day${G.hungry ? ' · STARVING' : ''}`;
  $('c-food').classList.toggle('bad', !!G.hungry);
  $('c-food').classList.toggle('warn', (G.foodRate ?? 0) < 0 && !G.hungry);
  const h = hourOfDay();
  $('s-time').textContent = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
  const se = season();
  $('s-date').textContent = `Day ${day()} · ${se.icon} ${se.name} · day ${((day() - 1) % DAYS_PER_SEASON) + 1}/${DAYS_PER_SEASON}`;
  $('s-weather').textContent = wxIcon();
  $('s-weather').title = `${G.weather.kind} · wind ${Math.round(G.weather.wind * 60)} km/h`;
  const bar = (el, v) => { el.style.left = v >= 0 ? '50%' : `${50 + v * 50}%`; el.style.width = `${Math.abs(v) * 50}%`; el.style.background = v >= 0 ? '#2fbf71' : '#e0434f'; };
  bar($('d-r'), s.demR); bar($('d-c'), s.demC); bar($('d-i'), s.demI);
  const alerts = G.alerts.slice(0, 8);
  $('alerts').innerHTML = alerts.length
    ? alerts.map((a) => `<li class="s${a.sev}"><span>${a.icon}</span><span>${a.text}</span></li>`).join('')
    : '<li class="ok"><span>✅</span><span>Everything is running smoothly. Keep growing!</span></li>';
  refreshAffordability();
  drawSpark();
  $('coords').textContent = `${Math.round(controls.target.x / T)}, ${Math.round(controls.target.z / T)}`;
}

function drawSpark() {
  const c = $('spark'), g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  const hst = G.history;
  if (hst.length < 2) { g.fillStyle = '#9db3a5'; g.font = '700 11px Nunito, sans-serif'; g.fillText('History appears after day 2', 6, 26); return; }
  const line = (key, color) => {
    const vals = hst.map((x) => x[key]);
    const mn = Math.min(...vals), mx = Math.max(...vals), span = mx - mn || 1;
    g.beginPath();
    vals.forEach((v, n) => { const x = (n / (vals.length - 1)) * (c.width - 4) + 2, y = c.height - 4 - ((v - mn) / span) * (c.height - 8); n ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.strokeStyle = color; g.lineWidth = 2.5; g.stroke();
  };
  line('money', '#f0a92a');
  line('pop', '#2fbf71');
}

/* ---------- inspector ---------- */
let inspected = null;
function closeInspector() { inspected = null; $('inspector').classList.add('hidden'); }
function inspectAt(cx, cy, h) {
  ndc.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const a = agents.pick(raycaster);
  if (a && a.cid != null) { inspected = { kind: 'citizen', id: a.cid, agent: a }; renderInspector(); return; }
  if (a && a.kind === 'truck') { inspected = { kind: 'truck' }; renderInspector(); return; }
  // buildings: ray against meshes first so tall buildings are easy to click
  const groups = [...meshes.entries()].filter(([, e]) => e.group.visible);
  const hit = raycaster.intersectObjects(groups.map(([, e]) => e.group), true)[0];
  if (hit) {
    let o = hit.object; while (o.parent && o.parent.type !== 'Scene') o = o.parent;
    const entry = groups.find(([, e]) => e.group === o);
    if (entry) { inspected = { kind: 'building', id: entry[0] }; renderInspector(); return; }
  }
  if (!h) { closeInspector(); return; }
  const t = tileAt(h.i, h.j);
  if (t?.b) inspected = { kind: 'building', id: t.b };
  else inspected = { kind: 'tile', i: h.i, j: h.j };
  renderInspector();
}

const pct = (v) => `${Math.round(v)}%`;
const meter = (v, color) => `<div class="meter"><i style="width:${clamp(v, 0, 100)}%;background:${color || (v > 60 ? '#2fbf71' : v > 35 ? '#f0a92a' : '#e0434f')}"></i></div>`;
function personRow(c) {
  const job = c.job != null ? G.buildings.get(c.job) : null;
  const role = c.age < 6 ? 'Toddler' : c.age < 18 ? 'Student' : c.age >= 66 ? 'Retired' : job ? DEFS[job.type].name : 'Unemployed';
  const face = c.sick ? '🤒' : c.happy > 70 ? '😄' : c.happy > 50 ? '🙂' : c.happy > 30 ? '😐' : '😟';
  return `<div class="person" data-cid="${c.id}"><span>${face}</span><div><b>${c.name}</b><small>${Math.floor(c.age)} · ${role}</small></div><small>${Math.round(c.happy)}%</small></div>`;
}

function citizenNeeds(c) {
  const home = G.buildings.get(c.home);
  if (!home) return ['<span class="tag bad">Homeless</span>'];
  const t = [];
  const tag = (ok, good, bad) => t.push(`<span class="tag ${ok ? 'good' : 'bad'}">${ok ? good : bad}</span>`);
  tag(home.powered, '⚡ Power', '⚡ No power');
  tag(home.watered, '💧 Water', '💧 No water');
  tag(!G.hungry, '🍞 Fed', '🍞 Hungry');
  if (isAdult(c)) tag(c.job != null, '💼 Has job', '💼 Needs job');
  if (c.age >= 6 && c.age < 18) tag(home.cov.school, '🏫 School', '🏫 No school');
  tag(home.cov.hospital, '🏥 Healthcare', '🏥 No hospital');
  tag(home.cov.police, '🚓 Safe', '🚓 Unsafe');
  tag(home.cov.shop && !G.shopsStarved, '🛒 Shops', '🛒 No shops');
  if (home.cov.park) t.push('<span class="tag good">⛲ Park nearby</span>');
  const p = pollutionAt(home.i, home.j);
  if (p > 4) t.push(`<span class="tag bad">😷 Polluted air</span>`);
  if (c.sick) t.push('<span class="tag bad">🤒 Sick</span>');
  return t;
}

function renderInspector() {
  const el = $('inspector');
  if (!inspected) { el.classList.add('hidden'); return; }
  let html = '';
  if (inspected.kind === 'citizen') {
    const c = G.citizens.get(inspected.id);
    if (!c) { closeInspector(); return; }
    const home = G.buildings.get(c.home), job = c.job != null ? G.buildings.get(c.job) : null;
    const stage = c.age < 6 ? 'Toddler' : c.age < 18 ? 'Student' : c.age >= 66 ? 'Retired' : 'Adult';
    html = `<header><h3>${c.sick ? '🤒' : '🧑'} ${c.name}</h3><button class="mini" data-act="close">✕</button></header>
      <div class="sub">${stage}, ${Math.floor(c.age)} years old · lived here since day ${c.born}</div>
      <div class="kv"><span>Home</span><b>${home ? DEFS[home.type].name : 'None'}</b>
      <span>Work</span><b>${job ? DEFS[job.type].name + (job.working ? '' : ' (closed)') : c.age < 18 ? 'School' : c.age >= 66 ? 'Retired' : '<b class="bad">Looking for work</b>'}</b>
      <span>Education</span><b>${c.edu >= 10 ? '🎓 Educated' : `${c.edu}/12 years`}</b></div>
      <div class="kv"><span>Happiness ${pct(c.happy)}</span><span></span></div>${meter(c.happy)}
      <div class="kv" style="margin-top:8px"><span>Health ${pct(c.health)}</span><span></span></div>${meter(c.health)}
      <div class="sub" style="margin-top:10px">What they need</div><div class="tags">${citizenNeeds(c).join('')}</div>
      <div class="ibtns">${home ? `<button class="btn" data-act="goto" data-x="${home.i}" data-z="${home.j}">🏠 Home</button>` : ''}${job ? `<button class="btn" data-act="goto" data-x="${job.i}" data-z="${job.j}">💼 Work</button>` : ''}${inspected.agent ? `<button class="btn primary" data-act="follow">🎥 Follow</button>` : ''}</div>`;
  } else if (inspected.kind === 'truck') {
    html = `<header><h3>🚚 Delivery truck</h3><button class="mini" data-act="close">✕</button></header><div class="sub">Moving food, goods and garbage between farms, factories, shops, homes and landfills.</div>`;
  } else if (inspected.kind === 'building') {
    const b = G.buildings.get(inspected.id);
    if (!b) { closeInspector(); return; }
    const d = DEFS[b.type];
    const status = b.progress < 1 ? `🚧 Under construction · ${Math.round(b.progress * 100)}%`
      : b.fire ? '🔥 ON FIRE' : b.comp == null ? '🛣️ Not connected to a road' : !b.working ? (d.power && !b.powered ? '⚡ No power' : '💧 No water') : '✅ Working';
    const kv = [];
    if (d.homes) kv.push(['Residents', `${b.residents.size} / ${d.homes}`]);
    if (d.jobs) kv.push(['Workers', `${b.workers.size} / ${d.jobs}${d.educated ? ' (educated)' : ''}`]);
    if (d.powerOut) kv.push(['Power output', `${(b.output || 0).toFixed(1)} / ${d.powerOut} MW`]);
    if (d.waterOut) kv.push(['Water output', `${(b.powered ? b.output || 0 : 0).toFixed(0)} / ${d.waterOut}`]);
    if (d.food) kv.push(['Food', `${Math.round(d.food * b.eff * season().farm)} / day`]);
    if (d.goods) kv.push(['Goods', `${Math.round(d.goods * b.eff)} / day`]);
    if (d.power) kv.push(['Power use', `${(b.pNeed || d.power).toFixed(1)} MW ${b.powered ? '✅' : '❌'}`]);
    if (d.water) kv.push(['Water use', `${(b.wNeed || d.water).toFixed(1)} ${b.watered ? '✅' : '❌'}`]);
    if (d.upkeep) kv.push(['Upkeep', `$${d.upkeep}/day`]);
    if (b.type === 'landfill') kv.push(['Filled', `${Math.round((b.fill / d.capacity) * 100)}%`]);
    kv.push(['Air pollution', pollutionAt(b.i, b.j).toFixed(1)]);
    const people = [...(d.homes ? b.residents : b.workers)].map((id) => G.citizens.get(id)).filter(Boolean);
    const cov = d.homes ? ['school', 'hospital', 'police', 'fire', 'shop', 'park'].map((k) => `<span class="tag ${b.cov[k] ? 'good' : k === 'park' ? '' : 'bad'}">${{ school: '🏫', hospital: '🏥', police: '🚓', fire: '🚒', shop: '🛒', park: '⛲' }[k]} ${k}</span>`).join('') : '';
    html = `<header><h3>${d.icon} ${d.name}</h3><button class="mini" data-act="close">✕</button></header>
      <div class="sub">${status}</div>
      <div class="kv">${kv.map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('')}</div>
      ${cov ? `<div class="tags">${cov}</div>` : ''}
      ${people.length ? `<div class="sub">${d.homes ? 'Who lives here' : 'Who works here'}</div><div class="people">${people.slice(0, 14).map(personRow).join('')}</div>` : ''}
      <div class="sub">${d.desc}</div>
      <div class="ibtns"><button class="btn danger" data-act="demolish">🚜 Demolish (+$${Math.round(d.cost * 0.25 * b.progress).toLocaleString()})</button></div>`;
  } else {
    const { i, j } = inspected;
    const s = terrain.tileStats(i, j);
    const t = tileAt(i, j);
    html = `<header><h3>${t?.road ? '🛣️ Road' : s.avg < 0.1 ? '🌊 Water' : terrain.hasTree(i, j) ? '🌲 Forest' : s.avg > 18 ? '⛰️ Mountain' : '🌱 Open land'}</h3><button class="mini" data-act="close">✕</button></header>
      <div class="kv"><span>Tile</span><b>${i}, ${j}</b><span>Elevation</span><b>${(s.avg * 10).toFixed(0)} m</b>${t?.road ? '' : `<span>Slope</span><b>${s.max - s.min > 1.25 ? 'Too steep to build' : 'Buildable'}</b>`}<span>Air pollution</span><b>${pollutionAt(i, j).toFixed(1)}</b>
      ${t?.road ? `<span>Traffic</span><b>${agents.traffic.get(tkey(i, j)) || 0} cars</b>` : ''}</div>`;
  }
  el.innerHTML = html;
  el.classList.remove('hidden');
}
$('inspector').addEventListener('click', (e) => {
  const p = e.target.closest('.person');
  if (p) { inspected = { kind: 'citizen', id: +p.dataset.cid }; renderInspector(); return; }
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'close') closeInspector();
  if (act === 'goto') flyTo(+b.dataset.x * T, +b.dataset.z * T);
  if (act === 'follow') { following = inspected.agent; toast('🎥 Following — drag the map to stop'); }
  if (act === 'demolish') { const bb = G.buildings.get(inspected.id); if (bb) { G.money += DEFS[bb.type].cost * 0.25 * bb.progress; removeBuilding(bb); } closeInspector(); }
});
controls.addEventListener('start', () => { following = null; flyTarget = null; });

$('needs-toggle').addEventListener('click', (e) => {
  const n = $('needs');
  n.classList.toggle(innerWidth < 860 ? 'open' : 'collapsed');
  e.currentTarget.textContent = (n.classList.contains('collapsed') || (innerWidth < 860 && !n.classList.contains('open'))) ? '+' : '–';
});

/* ---------- settings ---------- */
$('b-settings').addEventListener('click', () => { renderBudget(); $('settings').classList.remove('hidden'); });
$('settings-close').addEventListener('click', () => $('settings').classList.add('hidden'));
$('settings').addEventListener('click', (e) => { if (e.target.id === 'settings') $('settings').classList.add('hidden'); });
$('tax').addEventListener('input', (e) => { G.tax = +e.target.value; $('v-tax').textContent = `${G.tax}%`; });
$('imports').addEventListener('change', (e) => { G.imports = e.target.checked; });
$('b-save').addEventListener('click', () => { save(true); });
$('b-new').addEventListener('click', () => {
  if (!confirm('Start a brand-new world? Your current city will be deleted.')) return;
  try { localStorage.removeItem(SAVE_KEY); sessionStorage.setItem(NEW_SEED_KEY, String(Math.floor(Math.random() * 1e9))); } catch { /* storage unavailable */ }
  location.reload();
});
function renderBudget() {
  $('tax').value = G.tax; $('v-tax').textContent = `${G.tax}%`; $('imports').checked = G.imports;
  const L = G.lastDay;
  const row = (k, v, bad) => `<span>${k}</span><b class="${bad ? 'bad' : ''}">${v}</b>`;
  $('budget').innerHTML = L
    ? row('Taxes (yesterday)', fmtMoney(L.taxes)) + row('Upkeep', '−' + fmtMoney(L.upkeep), true) + row('Imports', '−' + fmtMoney(L.imports), true) + row('Net', fmtMoney(L.net), L.net < 0) + row('Treasury', fmtMoney(G.money), G.money < 0)
    : row('Treasury', fmtMoney(G.money)) + row('First budget', 'at midnight');
}

/* ---------- minimap ---------- */
const mm = $('minimap'), mg = mm.getContext('2d');
const MM_SPAN = 420; // world units across
let mmTimer = 9;
const mmImg = mg.createImageData(90, 90);
function drawMinimap(dt) {
  mmTimer += dt;
  if (mmTimer < 1) { drawMinimapMarker(); return; }
  mmTimer = 0;
  const cx = controls.target.x, cz = controls.target.z, px = MM_SPAN / 90;
  const d = mmImg.data;
  for (let y = 0; y < 90; y++) {
    for (let x = 0; x < 90; x++) {
      const wx = cx + (x - 45) * px, wz = cz + (y - 45) * px;
      const h = terrain.cornerH(Math.round(wx / T), Math.round(wz / T));
      let r, g, b;
      if (h < WATER) { const k = clamp(-h / 10, 0, 1); r = 70 - k * 40; g = 160 - k * 60; b = 220 - k * 40; }
      else if (h < 0.55) { r = 230; g = 215; b = 160; }
      else if (h > 21) { r = 240; g = 242; b = 246; }
      else if (h > 12) { r = 150; g = 142; b = 134; }
      else { r = 110 - h * 2; g = 180 - h * 3; b = 90 - h * 2; }
      const o = (y * 90 + x) * 4;
      d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
    }
  }
  mmBase = mmImg;
  drawMinimapMarker();
}
let mmBase = null;
const mmCanvas = document.createElement('canvas');
mmCanvas.width = mmCanvas.height = 90;
function drawMinimapMarker() {
  if (!mmBase) return;
  const cx = controls.target.x, cz = controls.target.z;
  mmCanvas.getContext('2d').putImageData(mmBase, 0, 0);
  mg.imageSmoothingEnabled = false;
  mg.drawImage(mmCanvas, 0, 0, 180, 180);
  const s = 180 / MM_SPAN;
  for (const [k, t] of G.tiles) {
    const [i, j] = k.split(',').map(Number);
    const x = (i * T - cx) * s + 90, y = (j * T - cz) * s + 90;
    if (x < 0 || y < 0 || x > 180 || y > 180) continue;
    if (t.road) { mg.fillStyle = '#4b4f58'; mg.fillRect(x, y, Math.max(1, T * s), Math.max(1, T * s)); }
  }
  for (const b of G.buildings.values()) {
    const x = (b.i * T - cx) * s + 90, y = (b.j * T - cz) * s + 90, w = b.size * T * s;
    if (x < -w || y < -w || x > 180 || y > 180) continue;
    const cat = DEFS[b.type].cat;
    mg.fillStyle = b.fire ? '#ff3b1f' : { homes: '#7fd36b', work: '#3a7bd5', power: '#ffc23d', water: '#4dd0e1', services: '#ff8fab', nature: '#2e9e4f' }[cat];
    mg.fillRect(x, y, Math.max(2, w), Math.max(2, w));
  }
  const off = camera.position.clone().sub(controls.target);
  const ang = Math.atan2(-off.x, -off.z);
  mg.save();
  mg.translate(90, 90);
  mg.rotate(-ang + Math.PI);
  mg.fillStyle = 'rgba(255,255,255,0.95)';
  mg.strokeStyle = 'rgba(0,0,0,0.5)';
  mg.beginPath(); mg.moveTo(0, -9); mg.lineTo(6, 6); mg.lineTo(0, 3); mg.lineTo(-6, 6); mg.closePath(); mg.fill(); mg.stroke();
  mg.restore();
}
mm.addEventListener('click', (e) => {
  const r = mm.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
  flyTo(controls.target.x + x * MM_SPAN, controls.target.z + y * MM_SPAN);
});

/* ================================================================== */
/*  Save / load / start                                                */
/* ================================================================== */
function save(manual = false) {
  if (!started) return;
  try {
    const data = serialize();
    data.cam = { tx: controls.target.x, tz: controls.target.z, px: camera.position.x, py: camera.position.y, pz: camera.position.z };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    if (manual) toast('💾 Saved');
  } catch (err) {
    if (manual) toast('Could not save in this browser', 'bad');
  }
}
setInterval(() => save(false), 30000);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(false); });

let saved = null;
try { saved = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { saved = null; }
let pendingSeed = null;
try { pendingSeed = sessionStorage.getItem(NEW_SEED_KEY); sessionStorage.removeItem(NEW_SEED_KEY); } catch { /* storage unavailable */ }

const spawn = new THREE.Vector3();
let started = false;
function boot(seed) {
  G.seed = seed;
  terrain = new Terrain(scene, seed, { isRoad, isBlocked: (i, j) => !!tileAt(i, j) });
  bindTerrain(terrain);
  agents = new Agents(scene, terrain);
  // find dry, flat land near the origin to start on
  let best = null;
  for (let r = 0; r < 60 && !best; r += 2) {
    for (let a = 0; a < 16; a++) {
      const i = Math.round(Math.cos((a / 16) * Math.PI * 2) * r), j = Math.round(Math.sin((a / 16) * Math.PI * 2) * r);
      const s = terrain.tileStats(i, j);
      if (s.min > 0.8 && s.max - s.min < 0.6 && s.avg < 8) { best = [i, j]; break; }
    }
  }
  const [si, sj] = best || [0, 0];
  spawn.set((si + 0.5) * T, Math.max(WATER, terrain.surfaceH((si + 0.5) * T, (sj + 0.5) * T)), (sj + 0.5) * T);
  controls.target.copy(spawn);
  camera.position.set(spawn.x + 40, spawn.y + 46, spawn.z + 52);
  $('seed-label').textContent = `World #${seed}`;
  $('t-seed').value = seed;
  for (let k = 0; k < 40; k++) terrain.update(spawn.x, spawn.z, 4);
}

function start(fromSave) {
  $('loading').classList.remove('hidden');
  setTimeout(() => {
    if (fromSave && saved) {
      restore(saved);
      if (saved.cam) { controls.target.set(saved.cam.tx, 0, saved.cam.tz); camera.position.set(saved.cam.px, saved.cam.py, saved.cam.pz); }
      feed(`👋 Welcome back — day ${day()}, ${G.citizens.size} citizens`, 'good');
    } else {
      initialTick();
      feed('👋 Build a road, then houses, power and water. Your first citizens are waiting!', 'good');
      setTimeout(() => toast('Start with 🛣️ Roads — drag to draw one'), 800);
    }
    started = true;
    $('title').classList.add('gone');
    $('hud').classList.remove('off');
    $('loading').classList.add('hidden');
    renderBuildBar();
    selectTool(fromSave ? 'inspect' : 'road');
    renderHUD();
  }, 30);
}

if (pendingSeed) { boot(+pendingSeed); start(false); }
else {
  boot(saved ? saved.seed : Math.floor(Math.random() * 1e9));
  if (saved) $('t-continue').classList.remove('hidden');
}
$('t-continue').addEventListener('click', () => start(true));
$('t-new').addEventListener('click', () => {
  const seed = parseInt($('t-seed').value, 10) || Math.floor(Math.random() * 1e9);
  if (saved || seed !== G.seed) {
    if (saved && !confirm('Start a new world? Your saved city will be replaced.')) return;
    try { localStorage.removeItem(SAVE_KEY); sessionStorage.setItem(NEW_SEED_KEY, String(seed)); } catch { /* storage unavailable */ }
    location.reload();
    return;
  }
  start(false);
});

/* ================================================================== */
/*  Resize & loop                                                      */
/* ================================================================== */
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.fov = camera.aspect < 0.8 ? 60 : 45;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
let hudTimer = 0, inspTimer = 0;
function tick() {
  requestAnimationFrame(tick);
  const realDt = clock.getDelta();
  const dt = Math.min(realDt, 0.1);
  // game time follows the wall clock, not the frame rate
  if (started && G.speed) advance(Math.min(realDt, 1) * HOURS_PER_SECOND * G.speed);
  updateCamera(dt);
  const focus = walking ? walkPos : controls.target;
  terrain.update(focus.x, focus.z, started ? 2 : 3);
  updateEnvironment(dt);
  updateBuildings(dt);
  agents.update(dt, G.speed, !started || !G.speed);
  if (started) {
    hudTimer += dt;
    if (hudTimer > 0.25) { hudTimer = 0; renderHUD(); }
    inspTimer += dt;
    if (inspTimer > 0.6 && inspected) { inspTimer = 0; renderInspector(); }
    drawMinimap(dt);
  }
  renderer.render(scene, camera);
}
tick();

// handy for tinkering from the dev console
window.world = { renderer, scene, G, DEFS, terrain: () => terrain, flyTo, controls, spawn, agents: () => agents, selectTool };
