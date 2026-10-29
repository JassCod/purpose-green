// Visible citizens: cars commuting along roads and pedestrians on the sidewalks.
// Every agent is tied to a real simulated citizen, so clicking one shows who they are.

import * as THREE from '../vendor/three.module.js';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';
import { T, part, M, tkey } from './terrain.js';
import { G, DEFS, findPath, hourOfDay, isRoad } from './sim.js';

const MAX_CARS = 260;
const MAX_PEDS = 320;

const carGeo = mergeGeometries([
  part(new THREE.BoxGeometry(0.46, 0.2, 0.92), 0xffffff, M(0, 0.17, 0)),
  part(new THREE.BoxGeometry(0.4, 0.17, 0.48), 0x39424f, M(0, 0.35, -0.04)),
  ...[[-0.21, 0.3], [0.21, 0.3], [-0.21, -0.3], [0.21, -0.3]].map(([x, z]) =>
    part(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 8), 0x1c1c22, new THREE.Matrix4().makeRotationZ(Math.PI / 2).premultiply(M(x, 0.08, z)))),
  part(new THREE.BoxGeometry(0.1, 0.05, 0.02), 0xfff3b0, M(-0.14, 0.2, 0.47)),
  part(new THREE.BoxGeometry(0.1, 0.05, 0.02), 0xfff3b0, M(0.14, 0.2, 0.47)),
]);
const pedGeo = mergeGeometries([
  part(new THREE.CylinderGeometry(0.06, 0.08, 0.3, 6), 0xffffff, M(0, 0.15, 0)),
  part(new THREE.SphereGeometry(0.065, 8, 6), 0xf1c9a5, M(0, 0.38, 0)),
]);
const agentMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.1 });

const CAR_COLORS = [0xe0434f, 0x3a7bd5, 0xf2f2f2, 0x2b2b30, 0xffc23d, 0x2fbf71, 0x8a5cf6, 0x9aa3ab, 0xff8a3d];
const PED_COLORS = [0xe0434f, 0x3a7bd5, 0x2fbf71, 0xffc23d, 0x8a5cf6, 0xff8fab, 0x4dd0e1, 0x795548, 0x37474f];
const TRUCK = 0xff8a3d;

export class Agents {
  constructor(scene, terrain) {
    this.terrain = terrain;
    this.cars = [];
    this.peds = [];
    this.carMesh = new THREE.InstancedMesh(carGeo, agentMat, MAX_CARS);
    this.pedMesh = new THREE.InstancedMesh(pedGeo, agentMat, MAX_PEDS);
    for (const m of [this.carMesh, this.pedMesh]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.castShadow = true;
      m.frustumCulled = false;
      scene.add(m);
    }
    this.carMesh.setColorAt(0, new THREE.Color());
    this.pedMesh.setColorAt(0, new THREE.Color());
    this.spawnAcc = 0;
    this.pedAcc = 0;
    this.pool = [];
    this.poolAge = 99;
    this.traffic = new Map();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._c = new THREE.Color();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  clear() { this.cars.length = 0; this.peds.length = 0; }

  /** Citizens list refreshed every couple of seconds for cheap random picks. */
  citizens() {
    if (this.poolAge > 2) { this.pool = [...G.citizens.values()]; this.poolAge = 0; }
    return this.pool;
  }

  spawnTrip(kind) {
    const pool = this.citizens();
    if (!pool.length) return;
    const hour = hourOfDay();
    for (let attempt = 0; attempt < 4; attempt++) {
      const c = pool[Math.floor(Math.random() * pool.length)];
      const home = G.buildings.get(c.home);
      if (!home || !home.road) continue;
      let from = home, to = null;
      if (kind === 'commute' && c.job != null) {
        const job = G.buildings.get(c.job);
        if (!job || !job.road) continue;
        if (hour >= 12) { from = job; to = home; } else to = job;
      } else if (kind === 'errand') {
        const opts = [...G.buildings.values()].filter((b) => b.road && b.comp === home.comp && b.working && ['shop', 'park', 'hospital', 'office', 'school'].includes(b.type));
        if (!opts.length) continue;
        to = opts[Math.floor(Math.random() * opts.length)];
        if (Math.random() < 0.5) [from, to] = [to, from];
      } else if (kind === 'truck') {
        const src = [...G.buildings.values()].filter((b) => b.road && b.working && (b.type === 'farm' || b.type === 'factory' || b.type === 'landfill'));
        const dst = [...G.buildings.values()].filter((b) => b.road && b.working && (b.type === 'shop' || DEFS[b.type].homes));
        if (!src.length || !dst.length) return;
        from = src[Math.floor(Math.random() * src.length)];
        to = dst[Math.floor(Math.random() * dst.length)];
        if (from.comp !== to.comp) continue;
      }
      if (!to || to === from || from.comp !== to.comp) continue;
      const path = findPath(from.road, to.road);
      if (!path || path.length < 2) continue;
      this.cars.push({
        path, seg: 0, t: 0, cid: kind === 'truck' ? null : c.id, kind,
        color: kind === 'truck' ? TRUCK : CAR_COLORS[c.id % CAR_COLORS.length], pos: new THREE.Vector3(), yaw: 0,
      });
      return;
    }
  }

  spawnWalker() {
    const pool = this.citizens();
    if (!pool.length) return;
    const c = pool[Math.floor(Math.random() * pool.length)];
    const home = G.buildings.get(c.home);
    if (!home || !home.road) return;
    // a short random stroll along the roads
    const path = [home.road];
    let [i, j] = home.road, pi = null, pj = null;
    const len = 3 + Math.floor(Math.random() * 8);
    for (let k = 0; k < len; k++) {
      const opts = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => [i + a, j + b]).filter(([a, b]) => isRoad(a, b) && !(a === pi && b === pj));
      if (!opts.length) break;
      const [ni, nj] = opts[Math.floor(Math.random() * opts.length)];
      pi = i; pj = j; i = ni; j = nj;
      path.push([i, j]);
    }
    if (path.length < 2) return;
    this.peds.push({ path, seg: 0, t: 0, cid: c.id, side: Math.random() < 0.5 ? 1 : -1, color: PED_COLORS[c.id % PED_COLORS.length], pos: new THREE.Vector3(), yaw: 0, kind: 'walk' });
  }

  update(dt, gameSpeed, paused) {
    this.poolAge += dt;
    const hour = hourOfDay();
    const pop = G.citizens.size;
    if (!paused) {
      // demand for trips follows the daily rhythm of the city
      const rush = (hour >= 6.5 && hour < 9.5) || (hour >= 16 && hour < 19);
      const day = hour >= 7 && hour < 22;
      const carRate = pop * (rush ? 0.05 : day ? 0.018 : 0.004) * Math.min(gameSpeed, 3);
      this.spawnAcc += carRate * dt;
      let n = 0;
      while (this.spawnAcc >= 1 && n < 3) {
        this.spawnAcc -= 1;
        n++;
        if (this.cars.length >= MAX_CARS) { this.spawnAcc = 0; break; }
        const r = Math.random();
        this.spawnTrip(rush ? (r < 0.85 ? 'commute' : 'truck') : day ? (r < 0.6 ? 'errand' : r < 0.85 ? 'truck' : 'commute') : 'errand');
      }
      this.spawnAcc = Math.min(this.spawnAcc, 5);
      this.pedAcc += pop * (day ? 0.03 : 0.004) * dt;
      while (this.pedAcc >= 1) {
        this.pedAcc -= 1;
        if (this.peds.length < MAX_PEDS) this.spawnWalker();
      }
      this.pedAcc = Math.min(this.pedAcc, 5);
    }

    // traffic density per tile slows cars down
    this.traffic.clear();
    for (const a of this.cars) {
      const k = tkey(...a.path[Math.min(a.seg + 1, a.path.length - 1)]);
      this.traffic.set(k, (this.traffic.get(k) || 0) + 1);
    }

    const move = (list, mesh, speed, laneOffset, pedestrian) => {
      let n = 0;
      for (let idx = list.length - 1; idx >= 0; idx--) {
        const a = list[idx];
        if (!paused) {
          let sp = speed;
          if (!pedestrian) sp /= 1 + 0.35 * Math.max(0, (this.traffic.get(tkey(...a.path[Math.min(a.seg + 1, a.path.length - 1)])) || 1) - 1);
          a.t += dt * sp * (gameSpeed > 1 ? 1.4 : 1);
          while (a.t >= 1 && a.seg < a.path.length - 1) { a.t -= 1; a.seg++; }
          if (a.seg >= a.path.length - 1 || !isRoad(...a.path[a.seg]) || !isRoad(...a.path[Math.min(a.seg + 1, a.path.length - 1)])) { list.splice(idx, 1); continue; }
        }
        const [i0, j0] = a.path[a.seg], [i1, j1] = a.path[Math.min(a.seg + 1, a.path.length - 1)];
        const dx = i1 - i0, dz = j1 - j0;
        const side = pedestrian ? a.side : 1;
        // drive on the right: offset perpendicular to the direction of travel
        const ox = -dz * laneOffset * side, oz = dx * laneOffset * side;
        const x = ((i0 + 0.5) + dx * a.t) * T + ox, z = ((j0 + 0.5) + dz * a.t) * T + oz;
        a.pos.set(x, this.terrain.surfaceH(x, z) + 0.06, z);
        const yaw = Math.atan2(dx, dz);
        let dy = yaw - a.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        a.yaw += dy * Math.min(1, dt * 10);
        if (n >= mesh.instanceMatrix.count) continue;
        this._q.setFromAxisAngle(this._up, a.yaw);
        const sc = a.kind === 'truck' ? 1.25 : 1;
        this._s.set(sc, sc, sc * (a.kind === 'truck' ? 1.2 : 1));
        if (pedestrian) a.pos.y += Math.abs(Math.sin((a.t + a.seg) * 9)) * 0.03;
        this._m.compose(a.pos, this._q, this._s);
        mesh.setMatrixAt(n, this._m);
        mesh.setColorAt(n, this._c.set(a.color));
        a.instance = n;
        n++;
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    move(this.cars, this.carMesh, 2.2, 0.42, false);
    move(this.peds, this.pedMesh, 0.55, 0.78, true);
  }

  pick(raycaster) {
    const hits = [];
    for (const [mesh, list] of [[this.carMesh, this.cars], [this.pedMesh, this.peds]]) {
      if (!mesh.count) continue;
      mesh.computeBoundingSphere();
      const h = raycaster.intersectObject(mesh, false)[0];
      if (h) { const a = list.find((x) => x.instance === h.instanceId); if (a) hits.push({ d: h.distance, a }); }
    }
    hits.sort((p, q) => p.d - q.d);
    return hits[0]?.a || null;
  }
}
