// Visible city life: every pedestrian and most vehicles are tied to a real simulated
// citizen. Cars, taxis and buses commute, delivery trucks haul goods, and emergency
// services drive to real incidents: fire engines to fires, ambulances to the sick,
// police on patrol. Wheels spin with distance travelled and people walk with a gait.

import * as THREE from '../vendor/three.module.js';
import { T, tkey } from './terrain.js';
import { G, DEFS, findPath, hourOfDay, isRoad, occupationOf } from './sim.js';
import { RigBatch } from './assets.js';

const MAX_CARS = 240;
const MAX_PEDS = 220;
const TILE_M = T * 5; // metres per tile

const CAR_COLORS = [0xb8141e, 0x1c3f8f, 0xe8e8e8, 0x1b1b1f, 0x8a8f96, 0x2d5f3a, 0xc7c2b4, 0x5a1f6b, 0x0f5c78, 0xd2691e, 0x31343a, 0xf0f0f0];
const CASUAL_SHIRTS = [0xc0392b, 0x2e86c1, 0x27ae60, 0xf1c40f, 0x8e44ad, 0xe67e22, 0x16a085, 0xecf0f1, 0x34495e, 0xd35400, 0x7f8c8d, 0xff8fab];
const CASUAL_PANTS = [0x1f2a44, 0x2c3e50, 0x4a3b2a, 0x5d6d7e, 0x17202a, 0x7b6c55];

const VEHICLES = {
  car: { speed: 1.25, wheel: 0.33 }, hatch: { speed: 1.25, wheel: 0.33 }, suv: { speed: 1.2, wheel: 0.38 }, taxi: { speed: 1.3, wheel: 0.33 },
  bus: { speed: 0.95, wheel: 0.5 }, truck: { speed: 1.0, wheel: 0.5 }, policecar: { speed: 1.35, wheel: 0.33 },
  ambulance: { speed: 1.7, wheel: 0.38 }, firetruck: { speed: 1.5, wheel: 0.5 },
};

export class Agents {
  constructor(scene, terrain, { maxCars = MAX_CARS, maxPeds = MAX_PEDS } = {}) {
    this.terrain = terrain;
    this.maxCars = maxCars;
    this.maxPeds = maxPeds;
    this.cars = [];
    this.peds = [];
    this.rigs = {};
    for (const name of Object.keys(VEHICLES)) this.rigs[name] = new RigBatch(scene, name);
    this.rigs.person_m = new RigBatch(scene, 'person_m');
    this.rigs.person_f = new RigBatch(scene, 'person_f');
    this.spawnAcc = 0;
    this.pedAcc = 0;
    this.dispatchTimer = 0;
    this.pool = [];
    this.poolAge = 99;
    this.traffic = new Map();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3(1, 1, 1);
    this._c = new THREE.Color();
    this._c2 = new THREE.Color();
    this._r = new THREE.Matrix4();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  clear() { this.cars.length = 0; this.peds.length = 0; }

  citizens() {
    if (this.poolAge > 2) { this.pool = [...G.citizens.values()]; this.poolAge = 0; }
    return this.pool;
  }

  addVehicle(model, from, to, extra = {}) {
    if (!from?.road || !to?.road || from.comp !== to.comp || this.cars.length >= this.maxCars) return null;
    const path = findPath(from.road, to.road);
    if (!path || path.length < 2) return null;
    const v = { path, seg: 0, t: 0, model, pos: new THREE.Vector3(), yaw: 0, spin: 0, cid: null, color: CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)], kind: model, ...extra };
    this.cars.push(v);
    return v;
  }

  spawnTrip(kind) {
    const pool = this.citizens();
    if (!pool.length) return;
    const hour = hourOfDay();
    const all = [...G.buildings.values()];
    for (let attempt = 0; attempt < 4; attempt++) {
      const c = pool[Math.floor(Math.random() * pool.length)];
      const home = G.buildings.get(c.home);
      if (!home || !home.road) continue;
      let from = home, to = null, model = ['car', 'car', 'hatch', 'suv'][c.id % 4];
      if (kind === 'commute' && c.job != null) {
        const job = G.buildings.get(c.job);
        if (!job || !job.road) continue;
        if (hour >= 12) { from = job; to = home; } else to = job;
        if (Math.random() < 0.08) model = 'taxi';
      } else if (kind === 'errand') {
        const opts = all.filter((b) => b.road && b.comp === home.comp && b.working && ['shop', 'restaurant', 'bank', 'park', 'hospital', 'office', 'school', 'university'].includes(b.type));
        if (!opts.length) continue;
        to = opts[Math.floor(Math.random() * opts.length)];
        if (Math.random() < 0.5) [from, to] = [to, from];
        if (Math.random() < 0.1) model = 'taxi';
      } else if (kind === 'truck') {
        const src = all.filter((b) => b.road && b.working && ['farm', 'factory', 'landfill', 'yard'].includes(b.type));
        const dst = all.filter((b) => b.road && b.working && (b.type === 'shop' || b.type === 'restaurant' || DEFS[b.type].homes));
        if (!src.length || !dst.length) return;
        from = src[Math.floor(Math.random() * src.length)];
        to = dst[Math.floor(Math.random() * dst.length)];
        model = 'truck';
      } else if (kind === 'bus') {
        const stops = all.filter((b) => b.road && (DEFS[b.type].homes || DEFS[b.type].jobs));
        if (stops.length < 2) return;
        from = stops[Math.floor(Math.random() * stops.length)];
        to = stops[Math.floor(Math.random() * stops.length)];
        model = 'bus';
      }
      if (!to || to === from) continue;
      const v = this.addVehicle(model, from, to, { cid: model === 'truck' || model === 'bus' ? null : c.id });
      if (v) {
        if (model === 'taxi') v.color = 0xf2c418;
        if (model === 'bus') v.color = 0x1d6fb8;
        if (model === 'truck') v.color = 0x2f7d4f;
        return;
      }
    }
  }

  /** Emergency services respond to what is actually happening in the simulation. */
  dispatch() {
    const all = [...G.buildings.values()];
    const stations = all.filter((b) => b.type === 'fire' && b.working && b.road);
    for (const b of all) {
      if (!b.fire || this.cars.some((v) => v.target === b.id)) continue;
      const st = stations.find((s) => s.comp === b.comp);
      if (st) this.addVehicle('firetruck', st, b, { color: 0xb3121b, target: b.id, siren: true });
    }
    const hospitals = all.filter((b) => b.type === 'hospital' && b.working && b.road);
    if (hospitals.length && this.cars.filter((v) => v.model === 'ambulance').length < 3) {
      const sick = this.citizens().filter((c) => c.sick && c.health < 55);
      if (sick.length && Math.random() < 0.5) {
        const c = sick[Math.floor(Math.random() * sick.length)];
        const home = G.buildings.get(c.home);
        const h = home && hospitals.find((x) => x.comp === home.comp);
        if (h) this.addVehicle('ambulance', h, home, { color: 0xf4f4f4, siren: true, cid: c.id });
      }
    }
    const police = all.filter((b) => b.type === 'police' && b.working && b.road);
    for (const p of police) {
      if (this.cars.filter((v) => v.model === 'policecar').length >= police.length * 2) break;
      const near = all.filter((b) => b.road && b.comp === p.comp && Math.abs(b.i - p.i) + Math.abs(b.j - p.j) < 40);
      if (near.length && Math.random() < 0.4) this.addVehicle('policecar', p, near[Math.floor(Math.random() * near.length)], { color: 0xf2f2f2 });
    }
  }

  spawnWalker() {
    const pool = this.citizens();
    if (!pool.length) return;
    const c = pool[Math.floor(Math.random() * pool.length)];
    const home = G.buildings.get(c.home);
    if (!home || !home.road) return;
    const path = [home.road];
    let [i, j] = home.road, pi = null, pj = null;
    const len = 3 + Math.floor(Math.random() * 6);
    for (let k = 0; k < len; k++) {
      const opts = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => [i + a, j + b]).filter(([a, b]) => isRoad(a, b) && !(a === pi && b === pj));
      if (!opts.length) break;
      const [ni, nj] = opts[Math.floor(Math.random() * opts.length)];
      pi = i; pj = j; i = ni; j = nj;
      path.push([i, j]);
    }
    if (path.length < 2) return;
    const occ = occupationOf(c);
    this.peds.push({
      path, seg: 0, t: 0, cid: c.id, side: Math.random() < 0.5 ? 1 : -1, pos: new THREE.Vector3(), yaw: 0, kind: 'walk', phase: Math.random() * 6,
      model: c.female ? 'person_f' : 'person_m',
      shirt: occ?.uniform?.[0] ?? CASUAL_SHIRTS[c.id % CASUAL_SHIRTS.length],
      pants: occ?.uniform?.[1] ?? CASUAL_PANTS[(c.id >> 2) % CASUAL_PANTS.length],
      scale: c.age < 6 ? 0.55 : c.age < 13 ? 0.72 : c.age < 17 ? 0.92 : 1,
      speed: 0.13 + (c.age > 65 ? -0.03 : 0) + Math.random() * 0.03,
    });
  }

  update(dt, gameSpeed, paused) {
    this.poolAge += dt;
    const hour = hourOfDay();
    const pop = G.citizens.size;
    if (!paused) {
      const rush = (hour >= 6.5 && hour < 9.5) || (hour >= 16 && hour < 19);
      const day = hour >= 7 && hour < 22;
      this.spawnAcc += pop * (rush ? 0.05 : day ? 0.018 : 0.004) * Math.min(gameSpeed, 3) * dt;
      let n = 0;
      while (this.spawnAcc >= 1 && n < 3) {
        this.spawnAcc -= 1;
        n++;
        if (this.cars.length >= this.maxCars) { this.spawnAcc = 0; break; }
        const r = Math.random();
        this.spawnTrip(rush ? (r < 0.75 ? 'commute' : r < 0.87 ? 'bus' : 'truck') : day ? (r < 0.55 ? 'errand' : r < 0.75 ? 'truck' : r < 0.85 ? 'bus' : 'commute') : 'errand');
      }
      this.spawnAcc = Math.min(this.spawnAcc, 5);
      this.pedAcc += pop * (day ? 0.03 : 0.004) * dt;
      while (this.pedAcc >= 1) {
        this.pedAcc -= 1;
        if (this.peds.length < this.maxPeds) this.spawnWalker();
      }
      this.pedAcc = Math.min(this.pedAcc, 5);
      this.dispatchTimer += dt;
      if (this.dispatchTimer > 2) { this.dispatchTimer = 0; this.dispatch(); }
    }

    this.traffic.clear();
    for (const a of this.cars) {
      const k = tkey(...a.path[Math.min(a.seg + 1, a.path.length - 1)]);
      this.traffic.set(k, (this.traffic.get(k) || 0) + 1);
    }

    for (const r of Object.values(this.rigs)) r.begin();
    const stepAgent = (a, speed) => {
      a.t += dt * speed * (gameSpeed > 1 ? 1.4 : 1);
      while (a.t >= 1 && a.seg < a.path.length - 1) { a.t -= 1; a.seg++; }
      return a.seg >= a.path.length - 1 || !isRoad(...a.path[a.seg]) || !isRoad(...a.path[Math.min(a.seg + 1, a.path.length - 1)]);
    };
    const place = (a, laneOffset, side) => {
      const [i0, j0] = a.path[a.seg], [i1, j1] = a.path[Math.min(a.seg + 1, a.path.length - 1)];
      const dx = i1 - i0, dz = j1 - j0;
      const ox = -dz * laneOffset * side, oz = dx * laneOffset * side;
      const x = ((i0 + 0.5) + dx * a.t) * T + ox, z = ((j0 + 0.5) + dz * a.t) * T + oz;
      a.pos.set(x, this.terrain.surfaceH(x, z) + 0.055, z);
      let dy = Math.atan2(dx, dz) - a.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      a.yaw += dy * Math.min(1, dt * 8);
    };

    for (let idx = this.cars.length - 1; idx >= 0; idx--) {
      const a = this.cars[idx];
      const spec = VEHICLES[a.model];
      let sp = spec.speed;
      if (!a.siren) sp /= 1 + 0.35 * Math.max(0, (this.traffic.get(tkey(...a.path[Math.min(a.seg + 1, a.path.length - 1)])) || 1) - 1);
      if (!paused) {
        const before = a.seg + a.t;
        if (stepAgent(a, sp)) { this.cars.splice(idx, 1); continue; }
        // wheels roll exactly with the distance travelled (no slip)
        a.spin += ((a.seg + a.t - before) * TILE_M) / spec.wheel;
      }
      place(a, 0.46, 1);
      this._q.setFromAxisAngle(this._up, a.yaw);
      this._s.set(1, 1, 1);
      this._m.compose(a.pos, this._q, this._s);
      const spin = a.spin;
      this.rigs[a.model].add(this._m, a, this._c.set(a.color), null, (name) => (name.startsWith('Wheel') ? this._r.makeRotationX(spin) : null));
    }

    for (let idx = this.peds.length - 1; idx >= 0; idx--) {
      const a = this.peds[idx];
      if (!paused) {
        const before = a.seg + a.t;
        if (stepAgent(a, a.speed)) { this.peds.splice(idx, 1); continue; }
        a.phase += ((a.seg + a.t - before) * TILE_M) / (0.75 * a.scale) * Math.PI; // one stride ≈ 0.75 m
      }
      place(a, 0.82, a.side);
      this._q.setFromAxisAngle(this._up, a.yaw);
      this._s.setScalar(a.scale);
      this._m.compose(a.pos, this._q, this._s);
      const swing = Math.sin(a.phase);
      this.rigs[a.model].add(this._m, a, this._c.set(a.shirt), this._c2.set(a.pants), (name) => {
        if (name === 'LegL') return this._r.makeRotationX(swing * 0.45);
        if (name === 'LegR') return this._r.makeRotationX(-swing * 0.45);
        if (name === 'ArmL') return this._r.makeRotationX(-swing * 0.38);
        if (name === 'ArmR') return this._r.makeRotationX(swing * 0.38);
        return null;
      });
    }
    for (const r of Object.values(this.rigs)) r.end();
  }

  pick(raycaster) {
    let best = null;
    for (const rig of Object.values(this.rigs)) {
      if (!rig.n) continue;
      for (const mesh of rig.meshes) {
        if (!mesh.count) continue;
        mesh.computeBoundingSphere();
        const h = raycaster.intersectObject(mesh, false)[0];
        if (h && (!best || h.distance < best.d)) best = { d: h.distance, a: rig.idAt(mesh, h.instanceId) };
      }
    }
    return best?.a || null;
  }
}
