import * as THREE from '../vendor/three.module.js';
import { makeNoise2D, fbm, hash2 } from './noise.js';
import { Batch, getTemplate } from './assets.js';

export const T = 2;          // world units per tile (1 unit = 5 m, so a tile is 10 m)
export const CHUNK = 16;     // tiles per chunk side
export const WATER = 0;      // sea level
export const METERS = 5;     // metres per world unit
const VIEW_CHUNKS = 4;       // chunk radius kept loaded around the camera

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const tkey = (i, j) => `${i},${j}`;

/* ------------------------------------------------------------------ */
/*  Seasons: snow on anything facing up                                */
/* ------------------------------------------------------------------ */
export const seasonUniforms = { uSnow: { value: 0 } };
export function addSnow(material) {
  if (material.userData.snow) return material;
  material.userData.snow = true;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, r) => {
    if (prev) prev(shader, r);
    shader.uniforms.uSnow = seasonUniforms.uSnow;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSnow;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float snowAmt = uSnow * smoothstep(0.5, 0.85, dot(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz)));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.93, 0.98), snowAmt);
        roughnessFactor = mix(roughnessFactor, 0.6, snowAmt);`);
  };
  material.customProgramCacheKey = () => 'snow' + material.name;
  material.needsUpdate = true;
  return material;
}

/* ------------------------------------------------------------------ */
/*  Materials                                                          */
/* ------------------------------------------------------------------ */
const texLoader = new THREE.TextureLoader();
function tex(name, srgb = true) {
  const t = texLoader.load(`assets/textures/${name}`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const terrainMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
{
  const u = { tGrass: { value: tex('grass.jpg') }, tRock: { value: tex('rock.jpg') }, tSand: { value: tex('sand.jpg') }, tSnow: { value: tex('snow.jpg') }, tDirt: { value: tex('dirt.jpg') } };
  terrainMaterial.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u, { uSnow: seasonUniforms.uSnow });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * normal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tGrass, tRock, tSand, tSnow, tDirt;
        uniform float uSnow;
        varying vec3 vWPos;
        varying vec3 vWNrm;
        // two scales of the same texture hide tiling over large areas
        vec3 sampleT(sampler2D t, vec2 p) { return mix(texture2D(t, p).rgb, texture2D(t, p * 0.21 + 0.37).rgb, 0.45); }`)
      .replace('#include <map_fragment>', `
        vec2 tp = vWPos.xz * 0.34;
        float h = vWPos.y;
        float ny = normalize(vWNrm).y;
        vec3 cg = sampleT(tGrass, tp);
        vec3 cd = texture2D(tDirt, tp * 0.8).rgb;
        vec3 cr = sampleT(tRock, tp * 0.6);
        vec3 cs = texture2D(tSand, tp).rgb;
        vec3 cw = texture2D(tSnow, tp).rgb;
        float patchy = texture2D(tDirt, tp * 0.05).r;
        vec3 col = mix(cg, cd, smoothstep(0.55, 0.7, patchy) * 0.35);
        col = mix(col, cs, 1.0 - smoothstep(0.35, 0.95, h));
        col = mix(col, cr, clamp(max(smoothstep(0.86, 0.62, ny), smoothstep(11.0, 15.0, h)), 0.0, 1.0));
        col = mix(col, cw, clamp(max(smoothstep(20.0, 24.0, h) * smoothstep(0.5, 0.75, ny), uSnow * smoothstep(0.55, 0.85, ny) * step(0.1, h)), 0.0, 1.0));
        diffuseColor.rgb *= col * 1.3;`);
  };
  terrainMaterial.customProgramCacheKey = () => 'terrain';
}

const asphaltMat = new THREE.MeshStandardMaterial({ map: tex('asphalt.jpg'), normalMap: tex('asphalt_n.jpg', false), roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
asphaltMat.normalScale.set(0.6, 0.6);
const markMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
export const terrainTextures = { tex };

const COL = { line: new THREE.Color(0xf2ead0), curb: new THREE.Color(0xbdb8ad), yellow: new THREE.Color(0xf0c040), ballast: new THREE.Color(0x7d7468), sleeper: new THREE.Color(0x4a3526), rail: new THREE.Color(0xb9bec4) };
const TINT = { dry: new THREE.Color(1.08, 1.04, 0.84), lush: new THREE.Color(0.86, 1.0, 0.86), forest: new THREE.Color(0.68, 0.8, 0.64), wet: new THREE.Color(0.78, 0.82, 0.84) };

/* ------------------------------------------------------------------ */
/*  Level of detail for distant vegetation                             */
/* ------------------------------------------------------------------ */
const lodCache = new Map();
function lodPrims(name) {
  if (lodCache.has(name)) return lodCache.get(name);
  const t = getTemplate(name);
  if (name === 'streetlight') { lodCache.set(name, t.prims); return t.prims; }
  const bark = t.prims.find((p) => p.name === 'Bark').material;
  const box = t.bbox;
  const h = box.max.y, r = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
  const prims = [{ geometry: new THREE.CylinderGeometry(0.03, 0.06, h * 0.45, 5).translate(0, h * 0.22, 0), material: bark, name: 'Bark' }];
  if (name.startsWith('pine')) {
    const leaf = addSnow(new THREE.MeshStandardMaterial({ name: 'PineLod', color: 0x1f4a2a, roughness: 0.95 }));
    prims.push({ geometry: new THREE.ConeGeometry(r * 0.85, h * 0.86, 7).translate(0, h * 0.55, 0), material: leaf, name: 'PineLod' });
  } else {
    const leaf = addSnow(new THREE.MeshStandardMaterial({ name: 'OakLod', color: 0x3f6e2a, roughness: 0.95, flatShading: true }));
    prims.push({ geometry: new THREE.IcosahedronGeometry(r * 0.8, 1).scale(1, 0.85, 1).translate(0, box.max.y - r * 0.75, 0), material: leaf, name: 'OakLod' });
  }
  lodCache.set(name, prims);
  return prims;
}

/* ------------------------------------------------------------------ */
/*  Terrain                                                            */
/* ------------------------------------------------------------------ */
export class Terrain {
  constructor(scene, seed, { isRoad, isRail = () => false, isBlocked }) {
    this.scene = scene;
    this.seed = seed;
    this.n1 = makeNoise2D(seed);
    this.n2 = makeNoise2D(seed + 1);
    this.n3 = makeNoise2D(seed + 2);
    this.n4 = makeNoise2D(seed + 3);
    this.n5 = makeNoise2D(seed + 4);
    this.isRoad = isRoad;
    this.isRail = isRail;
    this.isBlocked = isBlocked;
    this.overrides = new Map();   // corner key -> height (flattened for buildings)
    this.cleared = new Set();     // tiles whose natural trees were removed
    this.planted = new Set();     // tiles where the player planted a tree
    this.burned = new Map();      // tile -> game hour it burned (scorched ground until it regrows)
    this.growth = () => 1;        // sapling growth factor, provided by the nature module
    this.chunks = new Map();
    this.dirty = new Set();
    this.cache = new Map();
    this.group = new THREE.Group();
    scene.add(this.group);
    this.pickables = [];
    // vegetation & street furniture are drawn as a few global instanced batches
    this.layers = {};
    for (const name of ['oak_0', 'oak_1', 'pine_0', 'pine_1', 'streetlight']) {
      this.layers[name] = {
        near: new Batch(this.group, getTemplate(name).prims, { shadows: true }),
        // distant trees use a light-weight stand-in (a few dozen triangles instead of hundreds)
        far: new Batch(this.group, lodPrims(name), { shadows: false }),
      };
    }
    this.layersDirty = true;
    this.focusChunk = '';
  }

  /* ---------- height & biome ---------- */
  natural(x, z) {
    const c = fbm(this.n1, x * 0.0022, z * 0.0022, 4);
    const hills = fbm(this.n2, x * 0.012, z * 0.012, 3);
    let h = c * 18 + hills * 2.2 + 2.5;
    h += 6 * Math.exp(-(x * x + z * z) / (110 * 110));
    const mask = smooth(0.1, 0.45, c);
    const r = 1 - Math.abs(this.n3(x * 0.007, z * 0.007));
    h += mask * r * r * r * 34;
    const rv = Math.abs(fbm(this.n4, x * 0.0035, z * 0.0035, 2));
    const river = (1 - smooth(0.0, 0.05, rv)) * (1 - mask) * smooth(-0.35, -0.05, c);
    h = h + (Math.min(h, -1.4) - h) * river;
    return h;
  }
  moisture(x, z) { return fbm(this.n5, x * 0.004, z * 0.004, 3); }

  cornerH(ci, cj) {
    const k = tkey(ci, cj);
    const o = this.overrides.get(k);
    if (o !== undefined) return o;
    let h = this.cache.get(k);
    if (h === undefined) {
      if (this.cache.size > 250000) this.cache.clear();
      h = this.natural(ci * T, cj * T);
      this.cache.set(k, h);
    }
    return h;
  }

  /** Exact surface height following the same triangulation as the terrain mesh. */
  surfaceH(x, z) {
    const fx = x / T, fz = z / T;
    const i = Math.floor(fx), j = Math.floor(fz);
    const u = fx - i, v = fz - j;
    const ha = this.cornerH(i, j), hb = this.cornerH(i + 1, j), hc = this.cornerH(i, j + 1), hd = this.cornerH(i + 1, j + 1);
    if (u + v <= 1) return ha + (hb - ha) * u + (hc - ha) * v;
    return hd + (hc - hd) * (1 - u) + (hb - hd) * (1 - v);
  }

  tileStats(i, j) {
    const a = this.cornerH(i, j), b = this.cornerH(i + 1, j), c = this.cornerH(i, j + 1), d = this.cornerH(i + 1, j + 1);
    return { min: Math.min(a, b, c, d), max: Math.max(a, b, c, d), avg: (a + b + c + d) / 4 };
  }
  isWater(i, j) { return this.tileStats(i, j).avg < WATER + 0.1; }

  hasTree(i, j) {
    const k = tkey(i, j);
    if (this.isBlocked(i, j)) return false;
    if (this.planted.has(k)) return true;
    if (this.cleared.has(k)) return false;
    return this.naturalTree(i, j) !== 0;
  }
  /** 0 = none, 1 = broadleaf, 2 = conifer */
  naturalTree(i, j) {
    const x = (i + 0.5) * T, z = (j + 0.5) * T;
    const s = this.tileStats(i, j);
    if (s.min < WATER + 0.4 || s.max - s.min > 2.2 || s.avg > 20) return 0;
    const m = this.moisture(x, z);
    const r = hash2(i, j, this.seed);
    const density = m > 0.12 ? Math.min(0.8, (m - 0.12) * 2.6) : 0.025;
    if (r > density) return 0;
    return s.avg > 8 || hash2(i, j, this.seed + 7) > 0.55 ? 2 : 1;
  }
  /** Where exactly the tree on a tile stands (shared by rendering and physics). */
  treeAt(i, j) {
    if (!this.hasTree(i, j)) return null;
    const kind = this.planted.has(tkey(i, j)) ? 1 + (hash2(i, j, 5) > 0.5 ? 1 : 0) : this.naturalTree(i, j);
    const x = (i + 0.25 + hash2(i, j, 1) * 0.5) * T, z = (j + 0.25 + hash2(i, j, 2) * 0.5) * T;
    const variant = hash2(i, j, 8) > 0.5 ? 1 : 0;
    return { kind, name: (kind === 2 ? 'pine_' : 'oak_') + variant, x, z, y: this.surfaceH(x, z), rot: hash2(i, j, 3) * 6.28, scale: 0.75 + hash2(i, j, 4) * 0.55 };
  }

  /* ---------- editing ---------- */
  flatten(i0, j0, size) {
    let level = null, sum = 0, n = 0;
    for (let ci = i0; ci <= i0 + size; ci++) {
      for (let cj = j0; cj <= j0 + size; cj++) {
        const o = this.overrides.get(tkey(ci, cj));
        if (o !== undefined && level === null) level = o;
        sum += this.cornerH(ci, cj);
        n++;
      }
    }
    if (level === null) level = sum / n;
    for (let ci = i0; ci <= i0 + size; ci++) for (let cj = j0; cj <= j0 + size; cj++) this.overrides.set(tkey(ci, cj), level);
    this.markDirty(i0 - 1, j0 - 1, i0 + size + 1, j0 + size + 1);
    return level;
  }

  markDirty(i0, j0, i1, j1) {
    for (let ci = Math.floor(i0 / CHUNK); ci <= Math.floor(i1 / CHUNK); ci++) {
      for (let cj = Math.floor(j0 / CHUNK); cj <= Math.floor(j1 / CHUNK); cj++) this.dirty.add(tkey(ci, cj));
    }
  }

  /* ---------- streaming ---------- */
  update(x, z, budget = 2) {
    const cx = Math.floor(x / (T * CHUNK)), cz = Math.floor(z / (T * CHUNK));
    const want = [];
    for (let a = -VIEW_CHUNKS; a <= VIEW_CHUNKS; a++) {
      for (let b = -VIEW_CHUNKS; b <= VIEW_CHUNKS; b++) {
        if (a * a + b * b > VIEW_CHUNKS * VIEW_CHUNKS + 2) continue;
        const k = tkey(cx + a, cz + b);
        if (!this.chunks.has(k)) want.push([a * a + b * b, cx + a, cz + b]);
      }
    }
    want.sort((p, q) => p[0] - q[0]);
    for (let n = 0; n < Math.min(budget, want.length); n++) this.buildChunk(want[n][1], want[n][2]);

    let rebuilt = 0;
    for (const k of this.dirty) {
      if (rebuilt >= 6) break;
      this.dirty.delete(k);
      const ch = this.chunks.get(k);
      if (ch) { this.disposeChunk(ch); const [a, b] = k.split(',').map(Number); this.buildChunk(a, b); rebuilt++; }
    }
    for (const [k, ch] of this.chunks) {
      const dx = ch.ci - cx, dz = ch.cj - cz;
      if (dx * dx + dz * dz > (VIEW_CHUNKS + 2) ** 2) { this.disposeChunk(ch); this.chunks.delete(k); this.layersDirty = true; }
    }
    const fk = tkey(cx, cz);
    if (fk !== this.focusChunk) { this.focusChunk = fk; this.layersDirty = true; }
    if (this.layersDirty) this.rebuildLayers(cx, cz);
    return want.length;
  }

  rebuildLayers(cx, cz) {
    this.layersDirty = false;
    for (const l of Object.values(this.layers)) { l.near.begin(); l.far.begin(); }
    for (const ch of this.chunks.values()) {
      const near = Math.abs(ch.ci - cx) <= 1 && Math.abs(ch.cj - cz) <= 1;
      for (const [name, list] of Object.entries(ch.instances)) {
        const b = near ? this.layers[name].near : this.layers[name].far;
        for (const m of list) b.add(m);
      }
    }
    for (const l of Object.values(this.layers)) { l.near.end(); l.far.end(); }
  }

  disposeChunk(ch) {
    for (const m of [ch.terrain, ch.roads, ch.marks]) {
      if (!m) continue;
      this.group.remove(m);
      m.geometry.dispose();
    }
    this.pickables = this.pickables.filter((p) => p !== ch.terrain);
    this.layersDirty = true;
  }

  buildChunk(ci, cj) {
    const i0 = ci * CHUNK, j0 = cj * CHUNK, N = CHUNK + 1;
    const pos = new Float32Array(N * N * 3), col = new Float32Array(N * N * 3), nrm = new Float32Array(N * N * 3);
    const tmp = new THREE.Color();
    const nv = new THREE.Vector3();
    for (let a = 0; a < N; a++) {
      for (let b = 0; b < N; b++) {
        const gi = i0 + a, gj = j0 + b, x = gi * T, z = gj * T;
        const h = this.cornerH(gi, gj);
        const o = (a * N + b) * 3;
        pos[o] = x; pos[o + 1] = h; pos[o + 2] = z;
        // analytic normals from neighbouring corners: no seams between chunks
        nv.set(this.cornerH(gi - 1, gj) - this.cornerH(gi + 1, gj), 2 * T, this.cornerH(gi, gj - 1) - this.cornerH(gi, gj + 1)).normalize();
        nrm[o] = nv.x; nrm[o + 1] = nv.y; nrm[o + 2] = nv.z;
        this.tintAt(x, z, h, tmp, hash2(gi, gj, 99));
        if (this.burned.size && (this.burned.has(tkey(gi, gj)) || this.burned.has(tkey(gi - 1, gj - 1)))) tmp.multiplyScalar(0.32);
        col[o] = tmp.r; col[o + 1] = tmp.g; col[o + 2] = tmp.b;
      }
    }
    const idx = [];
    for (let a = 0; a < CHUNK; a++) {
      for (let b = 0; b < CHUNK; b++) {
        const A = a * N + b, B = (a + 1) * N + b, Cc = a * N + b + 1, D = (a + 1) * N + b + 1;
        idx.push(A, Cc, B, B, Cc, D);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const terrain = new THREE.Mesh(geo, terrainMaterial);
    terrain.receiveShadow = true;
    this.group.add(terrain);
    this.pickables.push(terrain);

    // trees
    const instances = { oak_0: [], oak_1: [], pine_0: [], pine_1: [], streetlight: [] };
    const q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (let a = 0; a < CHUNK; a++) {
      for (let b = 0; b < CHUNK; b++) {
        const t = this.treeAt(i0 + a, j0 + b);
        if (!t) continue;
        p.set(t.x, t.y - 0.05, t.z);
        q.setFromAxisAngle(up, t.rot);
        const g = this.growth(tkey(i0 + a, j0 + b));
        s.set(t.scale * g, t.scale * g * (0.9 + hash2(i0 + a, j0 + b, 6) * 0.25), t.scale * g);
        instances[t.name].push(new THREE.Matrix4().compose(p, q, s));
      }
    }
    const { roads, marks } = this.buildRoads(i0, j0, instances.streetlight);
    this.chunks.set(tkey(ci, cj), { ci, cj, terrain, roads, marks, instances });
    this.layersDirty = true;
  }

  tintAt(x, z, h, out, jitter) {
    const m = this.moisture(x, z);
    out.copy(TINT.dry).lerp(TINT.lush, smooth(-0.3, 0.2, m));
    if (m > 0.12) out.lerp(TINT.forest, smooth(0.12, 0.45, m));
    // sand, rock and snow carry their own colour; fade the grass tint out there
    const k = smooth(0.4, 1.0, h) * (1 - smooth(10, 14, h));
    out.lerp(new THREE.Color(1, 1, 1), 1 - k);
    if (h < 0) out.lerp(TINT.wet, 0.6);
    out.multiplyScalar(0.96 + jitter * 0.08);
    return out;
  }

  /* ---------- roads (merged per chunk) ---------- */
  buildRoads(i0, j0, lights) {
    const apos = [], auv = [], mpos = [], mcol = [];
    const lift = 0.05;
    const P = (x, z, extra = 0) => [x, this.surfaceH(x, z) + lift + extra, z];
    const pushM = (pt, c) => { mpos.push(...pt); mcol.push(c.r, c.g, c.b); };
    const quad = (p1, p2, p3, p4, c) => { pushM(p1, c); pushM(p2, c); pushM(p3, c); pushM(p1, c); pushM(p3, c); pushM(p4, c); };
    const up = new THREE.Vector3(0, 1, 0);
    // railway: ballast bed, timber sleepers every 60 cm and two steel rails (1.435 m gauge)
    const drawRail = (i, j) => {
      const cx = (i + 0.5) * T, cz = (j + 0.5) * T;
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([di, dj]) => this.isRail(i + di, j + dj));
      if (!dirs.length) dirs.push([1, 0], [-1, 0]);
      const onRoad = this.isRoad(i, j);
      for (const [di, dj] of dirs) {
        const ex = cx + di * T / 2, ez = cz + dj * T / 2;
        const nx = -dj, nz = di; // across the track
        const strip = (w, h, c, from = 0, to = 1) => {
          const ax = cx + (ex - cx) * from, az = cz + (ez - cz) * from, bx = cx + (ex - cx) * to, bz = cz + (ez - cz) * to;
          quad(P(ax - nx * w, az - nz * w, h), P(ax + nx * w, az + nz * w, h), P(bx + nx * w, bz + nz * w, h), P(bx - nx * w, bz - nz * w, h), c);
        };
        // keep quads counter-clockwise from above whatever the direction
        const flip = false; // the across-track normal already turns with the direction, so winding stays counter-clockwise
        const q = (w, h, c, f = 0, t = 1) => (flip ? strip(-w, h, c, f, t) : strip(w, h, c, f, t));
        if (!onRoad) q(0.36, 0.0, COL.ballast, -0.36, 1);
        for (let k = 0; k < 9; k++) q(0.27, 0.025, COL.sleeper, k / 9 + 0.01, k / 9 + 0.05);
        for (const side of [-0.1435, 0.1435]) {
          const ox = nx * side, oz = nz * side;
          const ax = cx + ox, az = cz + oz, bx = ex + ox, bz = ez + oz, w = 0.014 * (flip ? -1 : 1);
          quad(P(ax - nx * w, az - nz * w, 0.06), P(ax + nx * w, az + nz * w, 0.06), P(bx + nx * w, bz + nz * w, 0.06), P(bx - nx * w, bz - nz * w, 0.06), COL.rail);
        }
      }
    };
    for (let a = 0; a < CHUNK; a++) {
      for (let b = 0; b < CHUNK; b++) {
        const i = i0 + a, j = j0 + b;
        if (this.isRail(i, j)) drawRail(i, j);
        if (!this.isRoad(i, j)) continue;
        const x0 = i * T, z0 = j * T, x1 = x0 + T, z1 = z0 + T, cx = x0 + T / 2, cz = z0 + T / 2;
        const ha = this.cornerH(i, j) + lift, hb = this.cornerH(i + 1, j) + lift, hc = this.cornerH(i, j + 1) + lift, hd = this.cornerH(i + 1, j + 1) + lift;
        // same diagonal as the terrain so the road hugs it exactly
        apos.push(x0, ha, z0, x0, hc, z1, x1, hb, z0, x1, hb, z0, x0, hc, z1, x1, hd, z1);
        const s = 0.22;
        auv.push(x0 * s, z0 * s, x0 * s, z1 * s, x1 * s, z0 * s, x1 * s, z0 * s, x0 * s, z1 * s, x1 * s, z1 * s);

        const nb = { e: this.isRoad(i + 1, j), w: this.isRoad(i - 1, j), s: this.isRoad(i, j + 1), n: this.isRoad(i, j - 1) };
        const w = 0.035, e2 = 0.01;
        const dash = (ax, az, bx, bz, c = COL.line) => {
          const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz), nx = -dz / len * w, nz = dx / len * w;
          quad(P(ax - nx, az - nz, e2), P(ax + nx, az + nz, e2), P(bx + nx, bz + nz, e2), P(bx - nx, bz - nz, e2), c);
        };
        const count = nb.e + nb.w + nb.s + nb.n;
        if (count <= 2) {
          // dashed centre line
          const seg = (ax, az, bx, bz) => { for (let t = 0; t < 1; t += 0.5) dash(ax + (bx - ax) * t, az + (bz - az) * t, ax + (bx - ax) * (t + 0.28), az + (bz - az) * (t + 0.28), COL.yellow); };
          if (nb.e) seg(cx, cz, x1, cz);
          if (nb.w) seg(x0, cz, cx, cz);
          if (nb.s) seg(cx, cz, cx, z1);
          if (nb.n) seg(cx, z0, cx, cz);
        } else {
          // zebra crossings on each arm of an intersection
          const zebra = (horiz, at) => {
            for (let k = -3; k <= 3; k++) {
              const o = k * 0.22;
              if (horiz) dash(at, cz + o - 0.07, at, cz + o + 0.07); else dash(cx + o - 0.07, at, cx + o + 0.07, at);
            }
          };
          if (nb.e) zebra(true, x1 - 0.25); if (nb.w) zebra(true, x0 + 0.25);
          if (nb.s) zebra(false, z1 - 0.25); if (nb.n) zebra(false, z0 + 0.25);
        }
        // sidewalk curbs on edges without a neighbouring road
        const cw = 0.3, ch = 0.035;
        if (!nb.n) quad(P(x0, z0, ch), P(x0, z0 + cw, ch), P(x1, z0 + cw, ch), P(x1, z0, ch), COL.curb);
        if (!nb.s) quad(P(x0, z1 - cw, ch), P(x0, z1, ch), P(x1, z1, ch), P(x1, z1 - cw, ch), COL.curb);
        if (!nb.w) quad(P(x0, z0, ch), P(x0, z1, ch), P(x0 + cw, z1, ch), P(x0 + cw, z0, ch), COL.curb);
        if (!nb.e) quad(P(x1 - cw, z0, ch), P(x1 - cw, z1, ch), P(x1, z1, ch), P(x1, z0, ch), COL.curb);

        // street lights on every other tile, on a side without a junction
        if ((((i * 7 + j * 13) % 2) + 2) % 2 === 0) {
          const side = !nb.n ? [cx, z0 + 0.15] : !nb.s ? [cx, z1 - 0.15] : !nb.w ? [x0 + 0.15, cz] : !nb.e ? [x1 - 0.15, cz] : null;
          if (side) {
            const [lx, lz] = side;
            const rot = Math.atan2(-(cx - lx), -(cz - lz));
            lights.push(new THREE.Matrix4().compose(new THREE.Vector3(lx, this.surfaceH(lx, lz), lz), new THREE.Quaternion().setFromAxisAngle(up, rot), new THREE.Vector3(1, 1, 1)));
          }
        }
      }
    }
    let roads = null, marks = null;
    if (apos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(apos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(auv, 2));
      g.computeVertexNormals();
      roads = new THREE.Mesh(g, asphaltMat);
      roads.receiveShadow = true;
      this.group.add(roads);
    }
    if (mpos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(mpos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(mcol, 3));
      g.computeVertexNormals();
      marks = new THREE.Mesh(g, markMat);
      marks.receiveShadow = true;
      this.group.add(marks);
    }
    return { roads, marks };
  }
}
