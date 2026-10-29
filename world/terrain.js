import * as THREE from '../vendor/three.module.js';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';
import { makeNoise2D, fbm, hash2 } from './noise.js';

export const T = 2;          // world units per tile
export const CHUNK = 16;     // tiles per chunk side
export const WATER = 0;      // sea level
const VIEW_CHUNKS = 5;       // chunk radius kept loaded around the camera

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const tkey = (i, j) => `${i},${j}`;

/* ------------------------------------------------------------------ */
/*  Snow / season shader patch shared by terrain, trees and buildings  */
/* ------------------------------------------------------------------ */
export const seasonUniforms = { uSnow: { value: 0 } };
export function addSnow(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSnow = seasonUniforms.uSnow;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSnow;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float snowAmt = uSnow * smoothstep(0.45, 0.8, dot(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz)));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 1.0), snowAmt);`);
  };
  return material;
}

/* ------------------------------------------------------------------ */
/*  Geometry helpers                                                   */
/* ------------------------------------------------------------------ */
/** Non-indexed geometry with a flat vertex colour, ready for merging. */
export function part(geo, color, matrix) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (matrix) g.applyMatrix4(matrix);
  g.deleteAttribute('uv');
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) { col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
export const M = (x = 0, y = 0, z = 0, ry = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(sx, sy, sz));

const pineGeo = mergeGeometries([
  part(new THREE.CylinderGeometry(0.08, 0.12, 0.6, 6), 0x8a5a3a, M(0, 0.3, 0)),
  part(new THREE.ConeGeometry(0.62, 1.0, 7), 0x2e8b4f, M(0, 0.95, 0)),
  part(new THREE.ConeGeometry(0.46, 0.8, 7), 0x35a05a, M(0, 1.45, 0)),
  part(new THREE.ConeGeometry(0.3, 0.6, 7), 0x3fb066, M(0, 1.88, 0)),
]);
const oakGeo = mergeGeometries([
  part(new THREE.CylinderGeometry(0.09, 0.13, 0.8, 6), 0x8a5a3a, M(0, 0.4, 0)),
  part(new THREE.IcosahedronGeometry(0.62, 1), 0x5cbf4f, M(0, 1.15, 0, 0, 1, 0.95, 1)),
  part(new THREE.IcosahedronGeometry(0.4, 1), 0x6fcc57, M(0.32, 0.95, 0.2)),
]);

export const treeMaterial = addSnow(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }));
const terrainMaterial = addSnow(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }));
const roadMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

const COL = {
  seabed: new THREE.Color(0xbfae7f), sand: new THREE.Color(0xe6d79f), dry: new THREE.Color(0xa6cf68),
  lush: new THREE.Color(0x63b357), forest: new THREE.Color(0x4f9a4b), rock: new THREE.Color(0x9a9088),
  snow: new THREE.Color(0xf2f4f8), asphalt: new THREE.Color(0x4b4f58), line: new THREE.Color(0xf3e9c6), curb: new THREE.Color(0xcfcabd),
};

/* ------------------------------------------------------------------ */
/*  Terrain                                                            */
/* ------------------------------------------------------------------ */
export class Terrain {
  constructor(scene, seed, { isRoad, isBlocked }) {
    this.scene = scene;
    this.seed = seed;
    this.n1 = makeNoise2D(seed);
    this.n2 = makeNoise2D(seed + 1);
    this.n3 = makeNoise2D(seed + 2);
    this.n4 = makeNoise2D(seed + 3);
    this.n5 = makeNoise2D(seed + 4);
    this.isRoad = isRoad;
    this.isBlocked = isBlocked;
    this.overrides = new Map();   // corner key -> height (flattened for buildings)
    this.cleared = new Set();     // tiles whose natural trees were removed
    this.planted = new Set();     // tiles where the player planted a tree
    this.chunks = new Map();
    this.dirty = new Set();
    this.cache = new Map();
    this.group = new THREE.Group();
    scene.add(this.group);
    this.pickables = [];
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
  /** 0 = none, 1 = oak, 2 = pine */
  naturalTree(i, j) {
    const x = (i + 0.5) * T, z = (j + 0.5) * T;
    const s = this.tileStats(i, j);
    if (s.min < WATER + 0.4 || s.max - s.min > 2.2 || s.avg > 22) return 0;
    const m = this.moisture(x, z);
    const r = hash2(i, j, this.seed);
    const density = m > 0.12 ? Math.min(0.75, (m - 0.12) * 2.4) : 0.025;
    if (r > density) return 0;
    return s.avg > 9 || hash2(i, j, this.seed + 7) > 0.55 ? 2 : 1;
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
      if (dx * dx + dz * dz > (VIEW_CHUNKS + 2) ** 2) { this.disposeChunk(ch); this.chunks.delete(k); continue; }
      // only nearby forests cast shadows; distant ones would be lost in the shadow map anyway
      const near = Math.abs(dx) <= 2 && Math.abs(dz) <= 2;
      if (ch.pines) ch.pines.castShadow = near;
      if (ch.oaks) ch.oaks.castShadow = near;
    }
    return want.length;
  }

  disposeChunk(ch) {
    for (const m of [ch.terrain, ch.pines, ch.oaks, ch.roads]) {
      if (!m) continue;
      this.group.remove(m);
      m.geometry.dispose();
      if (m.isInstancedMesh) m.dispose();
    }
    this.pickables = this.pickables.filter((p) => p !== ch.terrain);
  }

  buildChunk(ci, cj) {
    const i0 = ci * CHUNK, j0 = cj * CHUNK, N = CHUNK + 1;
    const pos = new Float32Array(N * N * 3), col = new Float32Array(N * N * 3);
    const tmp = new THREE.Color();
    for (let a = 0; a < N; a++) {
      for (let b = 0; b < N; b++) {
        const gi = i0 + a, gj = j0 + b, x = gi * T, z = gj * T;
        const h = this.cornerH(gi, gj);
        const o = (a * N + b) * 3;
        pos[o] = x; pos[o + 1] = h; pos[o + 2] = z;
        this.colorAt(x, z, h, tmp, hash2(gi, gj, 99));
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
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const terrain = new THREE.Mesh(geo, terrainMaterial);
    terrain.receiveShadow = true;
    this.group.add(terrain);
    this.pickables.push(terrain);

    // trees
    const pines = [], oaks = [];
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (let a = 0; a < CHUNK; a++) {
      for (let b = 0; b < CHUNK; b++) {
        const gi = i0 + a, gj = j0 + b;
        if (!this.hasTree(gi, gj)) continue;
        const kind = this.planted.has(tkey(gi, gj)) ? 1 + (hash2(gi, gj, 5) > 0.5 ? 1 : 0) : this.naturalTree(gi, gj);
        const x = (gi + 0.25 + hash2(gi, gj, 1) * 0.5) * T, z = (gj + 0.25 + hash2(gi, gj, 2) * 0.5) * T;
        p.set(x, this.surfaceH(x, z) - 0.05, z);
        q.setFromAxisAngle(up, hash2(gi, gj, 3) * 6.28);
        const sc = 0.8 + hash2(gi, gj, 4) * 0.7;
        s.set(sc, sc * (0.9 + hash2(gi, gj, 6) * 0.3), sc);
        mtx.compose(p, q, s);
        (kind === 2 ? pines : oaks).push(mtx.clone());
      }
    }
    const mk = (geoT, list) => {
      if (!list.length) return null;
      const im = new THREE.InstancedMesh(geoT, treeMaterial, list.length);
      list.forEach((m, n) => im.setMatrixAt(n, m));
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      this.group.add(im);
      return im;
    };

    const ch = { ci, cj, terrain, pines: mk(pineGeo, pines), oaks: mk(oakGeo, oaks), roads: this.buildRoads(i0, j0) };
    this.chunks.set(tkey(ci, cj), ch);
  }

  colorAt(x, z, h, out, jitter) {
    if (h < -0.3) out.copy(COL.seabed);
    else if (h < 0.55) out.copy(COL.sand);
    else {
      const m = this.moisture(x, z);
      out.copy(COL.dry).lerp(COL.lush, smooth(-0.3, 0.2, m));
      if (m > 0.12) out.lerp(COL.forest, smooth(0.12, 0.4, m));
      out.lerp(COL.rock, smooth(11, 15, h));
      out.lerp(COL.snow, smooth(21, 24, h));
    }
    out.offsetHSL(0, 0, (jitter - 0.5) * 0.04);
    return out;
  }

  /* ---------- roads (merged per chunk) ---------- */
  buildRoads(i0, j0) {
    const pos = [], col = [];
    const lift = 0.06;
    const push = (x, y, z, c) => { pos.push(x, y + lift, z); col.push(c.r, c.g, c.b); };
    const quad = (p1, p2, p3, p4, c) => { // counter-clockwise from above: p1,p2,p3 / p1,p3,p4
      push(...p1, c); push(...p2, c); push(...p3, c);
      push(...p1, c); push(...p3, c); push(...p4, c);
    };
    const P = (x, z, extra = 0) => [x, this.surfaceH(x, z) + extra, z];
    for (let a = 0; a < CHUNK; a++) {
      for (let b = 0; b < CHUNK; b++) {
        const i = i0 + a, j = j0 + b;
        if (!this.isRoad(i, j)) continue;
        const x0 = i * T, z0 = j * T, x1 = x0 + T, z1 = z0 + T, cx = x0 + T / 2, cz = z0 + T / 2;
        const ha = this.cornerH(i, j), hb = this.cornerH(i + 1, j), hc = this.cornerH(i, j + 1), hd = this.cornerH(i + 1, j + 1);
        // same diagonal as the terrain so the road hugs it exactly
        push(x0, ha, z0, COL.asphalt); push(x0, hc, z1, COL.asphalt); push(x1, hb, z0, COL.asphalt);
        push(x1, hb, z0, COL.asphalt); push(x0, hc, z1, COL.asphalt); push(x1, hd, z1, COL.asphalt);

        const nb = { e: this.isRoad(i + 1, j), w: this.isRoad(i - 1, j), s: this.isRoad(i, j + 1), n: this.isRoad(i, j - 1) };
        const w = 0.06, e2 = 0.02;
        const dash = (ax, az, bx, bz) => {
          const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz), nx = -dz / len * w, nz = dx / len * w;
          quad(P(ax - nx, az - nz, e2), P(ax + nx, az + nz, e2), P(bx + nx, bz + nz, e2), P(bx - nx, bz - nz, e2), COL.line);
        };
        const count = nb.e + nb.w + nb.s + nb.n;
        if (count <= 2) {
          if (nb.e) dash(cx + 0.25, cz, x1 - 0.15, cz);
          if (nb.w) dash(x0 + 0.15, cz, cx - 0.25, cz);
          if (nb.s) dash(cx, cz + 0.25, cx, z1 - 0.15);
          if (nb.n) dash(cx, z0 + 0.15, cx, cz - 0.25);
        }
        // curbs on edges without a neighbouring road
        const cw = 0.22, ch = 0.05;
        if (!nb.n) quad(P(x0, z0, ch), P(x0, z0 + cw, ch), P(x1, z0 + cw, ch), P(x1, z0, ch), COL.curb);
        if (!nb.s) quad(P(x0, z1 - cw, ch), P(x0, z1, ch), P(x1, z1, ch), P(x1, z1 - cw, ch), COL.curb);
        if (!nb.w) quad(P(x0, z0, ch), P(x0, z1, ch), P(x0 + cw, z1, ch), P(x0 + cw, z0, ch), COL.curb);
        if (!nb.e) quad(P(x1 - cw, z0, ch), P(x1 - cw, z1, ch), P(x1, z1, ch), P(x1, z0, ch), COL.curb);
      }
    }
    if (!pos.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, roadMaterial);
    m.receiveShadow = true;
    this.group.add(m);
    return m;
  }
}
