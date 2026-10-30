// Trains, ships and aircraft.
// - Trains shuttle between stations on the same railway line, slowing into platforms.
// - Ships sail real water routes out of ports (cargo ships, ferries); sailboats roam lakes.
// - Planes taxi, take off, climb out, return and land on airport runways;
//   airliners cross the sky at cruising altitude.

import * as THREE from '../vendor/three.module.js';
import { T, WATER, tkey } from './terrain.js';
import { G, isRail, findRailPath } from './sim.js';
import { RigBatch } from './assets.js';
import { N } from './nature.js';

const LOCO = 1.8, COACH = 2.1;          // car lengths in tiles (18 m, 21 m)
const TRAIN_SPEED = 2.0;                // tiles/s ≈ 72 km/h
const TRAIN_LEN = LOCO + 3 * (COACH + 0.08);
const UP = new THREE.Vector3(0, 1, 0);

export class Transport {
  constructor(scene, terrain) {
    this.terrain = terrain;
    this.rigs = {};
    for (const n of ['locomotive', 'carriage', 'cargo_ship', 'ferry', 'sailboat', 'plane']) this.rigs[n] = new RigBatch(scene, n);
    this.trains = [];
    this.ships = [];
    this.boats = [];
    this.planes = [];
    this.timer = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._s = new THREE.Vector3(1, 1, 1);
    this._p = new THREE.Vector3();
    this._r = new THREE.Matrix4();
    this._c = new THREE.Color();
    this.time = 0;
  }

  /* ---------------------------------------------------------------- spawning */
  plan(focus) {
    const all = [...G.buildings.values()].filter((b) => b.progress >= 1 && b.working);
    // trains: one per pair of stations on a line
    const lines = new Map();
    for (const b of all) if (b.type === 'station' && b.rail) { if (!lines.has(b.line)) lines.set(b.line, []); lines.get(b.line).push(b); }
    for (const [line, st] of lines) {
      if (st.length < 2) continue;
      const running = this.trains.filter((t) => t.line === line).length;
      if (running >= Math.ceil(st.length / 2)) continue;
      const a = st[Math.floor(Math.random() * st.length)];
      let b = st[Math.floor(Math.random() * st.length)];
      if (a === b) b = st[(st.indexOf(a) + 1) % st.length];
      const path = findRailPath(a.rail, b.rail);
      if (path && path.length > TRAIN_LEN + 3) this.trains.push({ path, s: TRAIN_LEN, v: 0, line, dwell: 4, cars: 4, color: [0xc0392b, 0x1d6fb8, 0x2f7d4f][line % 3], dir: 1, pos: [] });
    }
    // ships: each port keeps a cargo ship and a ferry coming and going
    for (const p of all) {
      if (p.type !== 'port') continue;
      if (this.ships.filter((s) => s.port === p.id).length >= 2 || N.ice > 0.6) continue;
      const route = this.seaRoute(p);
      if (!route) continue;
      const model = this.ships.some((s) => s.port === p.id && s.model === 'cargo_ship') ? 'ferry' : 'cargo_ship';
      // arrive from the open water, dock, then sail away again
      this.ships.push({ port: p.id, model, path: route.slice().reverse(), k: 0, pos: route[route.length - 1].clone(), yaw: 0, speed: model === 'ferry' ? 1.0 : 0.7, state: 'in', wait: 0 });
    }
    // planes: alternate arrivals and departures per airport
    for (const a of all) {
      if (a.type !== 'airport' || this.planes.some((p) => p.airport === a.id)) continue;
      this.planes.push(this.flight(a, Math.random() < 0.5 ? 'arrive' : 'depart'));
    }
    // airliners at cruising altitude now and then
    if (this.planes.filter((p) => p.cruise).length < 2 && Math.random() < 0.3) {
      const a = Math.random() * Math.PI * 2;
      const from = new THREE.Vector3(focus.x + Math.cos(a) * 420, 130 + Math.random() * 40, focus.z + Math.sin(a) * 420);
      const to = new THREE.Vector3(focus.x - Math.cos(a) * 420 + (Math.random() - 0.5) * 200, from.y, focus.z - Math.sin(a) * 420 + (Math.random() - 0.5) * 200);
      this.planes.push({ cruise: true, pos: from, to, speed: 14, pitch: 0, scale: 1.8, prop: 0 });
    }
    // sailboats on any lake or bay near the viewer
    if (this.boats.length < 5 && N.ice < 0.4) {
      const fi = Math.floor(focus.x / T), fj = Math.floor(focus.z / T);
      for (let k = 0; k < 20; k++) {
        const i = fi + Math.floor((Math.random() - 0.5) * 70), j = fj + Math.floor((Math.random() - 0.5) * 70);
        if (this.deep(i, j)) { this.boats.push({ pos: new THREE.Vector3((i + 0.5) * T, WATER, (j + 0.5) * T), target: null, yaw: Math.random() * 6, life: 0 }); break; }
      }
    }
  }

  deep(i, j) { return this.terrain.tileStats(i, j).avg < WATER - 0.3; } // navigable: tile mostly under water

  /** Breadth-first search over open water from the quay to the farthest reachable water (max ~60 tiles). */
  seaRoute(p) {
    let start = null;
    for (let a = p.i - 2; a <= p.i + p.size + 1 && !start; a++) for (let b = p.j - 2; b <= p.j + p.size + 1 && !start; b++) if (this.deep(a, b)) start = [a, b];
    if (!start) return null;
    const prev = new Map([[tkey(...start), null]]);
    const q = [start];
    let head = 0, far = start;
    while (head < q.length && head < 2500) {
      const [i, j] = q[head++];
      far = [i, j];
      // 8-way: rivers often run diagonally across the tile grid
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const ni = i + di, nj = j + dj, k = tkey(ni, nj);
        if (prev.has(k) || !this.deep(ni, nj) || Math.abs(ni - start[0]) + Math.abs(nj - start[1]) > 60) continue;
        prev.set(k, tkey(i, j));
        q.push([ni, nj]);
      }
    }
    const path = [];
    for (let k = tkey(...far); k; k = prev.get(k)) { const [i, j] = k.split(',').map(Number); path.push(new THREE.Vector3((i + 0.5) * T, WATER, (j + 0.5) * T)); }
    path.reverse();
    // thin the grid path into gentle waypoints
    return path.length > 5 ? path.filter((_, k) => k % 2 === 0 || k === path.length - 1) : null;
  }

  /** Airport frame: runway along local X at z = -3.6, apron at z = +2.4 (game units). */
  flight(a, kind) {
    const c = new THREE.Vector3((a.i + a.size / 2) * T, a.level, (a.j + a.size / 2) * T);
    const L = (x, y, z) => new THREE.Vector3(x, y, z).applyAxisAngle(UP, a.rot).add(c);
    const g = 0.12;
    if (kind === 'depart') {
      return { airport: a.id, legs: [
        { to: L(0, g, 2.4), speed: 0.4, hold: 6 },            // boarding at the gate
        { to: L(6.2, g, 2.4), speed: 0.6 },                   // taxi to the taxiway
        { to: L(6.2, g, -3.6), speed: 0.6 },                  // and to the runway end
        { to: L(-3.5, g, -3.6), speed: 9, accel: 2.6 },       // take-off roll
        { to: L(-60, 16, -3.6), speed: 11, climb: true },     // rotate and climb out
        { to: L(-320, 70, -3.6), speed: 14, climb: true, end: true },
      ], k: 0, pos: L(0, g, 2.4), v: 0, prop: 0, pitch: 0, yaw: a.rot };
    }
    return { airport: a.id, legs: [
      { to: L(6.4, g, -3.6), speed: 9, flare: true },        // final approach on the glide slope
      { to: L(-4.5, g, -3.6), speed: 1.2, brake: 2.2 },      // roll-out
      { to: L(-5.5, g, -3.6), speed: 0.5 },
      { to: L(6.2, g, -3.6), speed: 0.7 },                   // back-taxi
      { to: L(6.2, g, 2.4), speed: 0.6 },
      { to: L(0, g, 2.4), speed: 0.4, hold: 8, end: true },  // at the gate
    ], k: 0, pos: L(260, 46, -3.6), v: 9, prop: 0, pitch: 0, yaw: a.rot - Math.PI / 2 };
  }

  /* ---------------------------------------------------------------- update */
  update(dt, focus, gameSpeed, paused) {
    this.time += dt;
    this.timer += dt;
    if (!paused && this.timer > 3) { this.timer = 0; this.plan(focus); }
    const run = paused ? 0 : dt * (gameSpeed > 1 ? 1.5 : 1);
    for (const r of Object.values(this.rigs)) r.begin();
    this.updateTrains(run);
    this.updateShips(run, dt);
    this.updatePlanes(run);
    for (const r of Object.values(this.rigs)) r.end();
  }

  pointOn(path, s, out) {
    const n = path.length - 1;
    const c = Math.max(0, Math.min(n - 1e-4, s));
    const k = Math.floor(c), f = c - k;
    const [i0, j0] = path[k], [i1, j1] = path[Math.min(k + 1, n)];
    const x = (i0 + 0.5 + (i1 - i0) * f) * T, z = (j0 + 0.5 + (j1 - j0) * f) * T;
    return out.set(x, this.terrain.surfaceH(x, z) + 0.07, z);
  }

  updateTrains(run) {
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (let idx = this.trains.length - 1; idx >= 0; idx--) {
      const t = this.trains[idx];
      const L = t.path.length - 1;
      if (t.path.some(([i, j]) => !isRail(i, j))) { this.trains.splice(idx, 1); continue; }
      if (t.dwell > 0) t.dwell -= run;
      else {
        // accelerate out of a station, brake smoothly into the next one (~0.6 m/s²)
        const toGo = L - t.s;
        const target = Math.min(TRAIN_SPEED, Math.sqrt(Math.max(0, toGo) * 0.25) + 0.15);
        t.v += Math.max(-0.25 * run, Math.min(0.12 * run, target - t.v));
        t.s += t.v * run;
        if (t.s >= L) {
          t.s = TRAIN_LEN; t.v = 0; t.dwell = 6;
          t.path = t.path.slice().reverse();
          if (Math.random() < 0.25) { this.trains.splice(idx, 1); continue; }
        }
      }
      // place locomotive + carriages; each car is aimed from its rear bogie to its front bogie
      let offset = 0;
      for (let k = 0; k < t.cars; k++) {
        const len = k === 0 ? LOCO : COACH;
        const front = t.s - offset, back = front - len * 0.8;
        this.pointOn(t.path, front, a);
        this.pointOn(t.path, back, b);
        const yaw = Math.atan2(a.x - b.x, a.z - b.z);
        const pitch = Math.atan2(a.y - b.y, Math.hypot(a.x - b.x, a.z - b.z) || 1);
        this._p.copy(a).add(b).multiplyScalar(0.5);
        this._e.set(-pitch, yaw, 0);
        this._q.setFromEuler(this._e);
        this._s.set(1, 1, 1);
        this._m.compose(this._p, this._q, this._s);
        this.rigs[k === 0 ? 'locomotive' : 'carriage'].add(this._m, t, this._c.set(t.color));
        offset += len + 0.08;
      }
    }
  }

  updateShips(run, dt) {
    const bob = (p, phase, amp) => p.y = WATER + Math.sin(this.time * 0.9 + phase) * amp;
    for (let idx = this.ships.length - 1; idx >= 0; idx--) {
      const s = this.ships[idx];
      if (!G.buildings.has(s.port)) { this.ships.splice(idx, 1); continue; }
      if (s.wait > 0) s.wait -= run;
      else {
        const target = s.path[s.k];
        const d = new THREE.Vector3(target.x - s.pos.x, 0, target.z - s.pos.z);
        const dist = d.length();
        // ships turn slowly: steer the heading towards the waypoint
        const want = Math.atan2(d.x, d.z);
        let dy = Math.atan2(Math.sin(want - s.yaw), Math.cos(want - s.yaw));
        s.yaw += Math.max(-0.35 * run, Math.min(0.35 * run, dy));
        const slow = s.state === 'in' && s.k >= s.path.length - 2 ? 0.45 : 1;
        s.pos.x += Math.sin(s.yaw) * s.speed * slow * run;
        s.pos.z += Math.cos(s.yaw) * s.speed * slow * run;
        if (dist < 1.6) {
          s.k++;
          if (s.k >= s.path.length) {
            if (s.state === 'in') { s.state = 'out'; s.wait = 14; s.path = s.path.slice().reverse(); s.k = 1; }
            else { this.ships.splice(idx, 1); continue; }
          }
        }
      }
      bob(s.pos, s.port, 0.04);
      this._e.set(Math.sin(this.time * 0.7 + s.port) * 0.015, s.yaw, Math.sin(this.time * 0.55) * 0.02 * (0.5 + N.windSpeed / 15));
      this._q.setFromEuler(this._e);
      this._s.set(1, 1, 1);
      this._m.compose(s.pos, this._q, this._s);
      this.rigs[s.model].add(this._m, s, this._c.set(s.model === 'ferry' ? 0x1d6fb8 : 0x22313f));
    }
    for (let idx = this.boats.length - 1; idx >= 0; idx--) {
      const b = this.boats[idx];
      b.life += run;
      if (!b.target || b.pos.distanceTo(b.target) < 1) {
        const i = Math.floor(b.pos.x / T) + Math.floor((Math.random() - 0.5) * 16), j = Math.floor(b.pos.z / T) + Math.floor((Math.random() - 0.5) * 16);
        b.target = this.deep(i, j) ? new THREE.Vector3((i + 0.5) * T, WATER, (j + 0.5) * T) : null;
      }
      if (b.target) {
        const want = Math.atan2(b.target.x - b.pos.x, b.target.z - b.pos.z);
        b.yaw += Math.atan2(Math.sin(want - b.yaw), Math.cos(want - b.yaw)) * Math.min(1, run * 0.6);
        // sailboats need wind; a beam reach is fastest
        const v = 0.08 + Math.min(0.35, N.windSpeed * 0.035) * (0.6 + 0.4 * Math.abs(Math.sin(b.yaw - N.windDir)));
        const nx = b.pos.x + Math.sin(b.yaw) * v * run, nz = b.pos.z + Math.cos(b.yaw) * v * run;
        if (this.deep(Math.floor(nx / T), Math.floor(nz / T))) { b.pos.x = nx; b.pos.z = nz; } else b.target = null;
      }
      if (b.life > 240 || N.ice > 0.5) { this.boats.splice(idx, 1); continue; }
      bob(b.pos, idx * 2, 0.025);
      // heel away from the wind
      this._e.set(Math.sin(this.time * 1.3 + idx) * 0.03, b.yaw, -Math.sin(N.windDir - b.yaw) * Math.min(0.35, N.windSpeed * 0.025));
      this._q.setFromEuler(this._e);
      this._m.compose(b.pos, this._q, this._s.set(1, 1, 1));
      this.rigs.sailboat.add(this._m, b, this._c.set(0xf4f4f4));
    }
  }

  updatePlanes(run) {
    for (let idx = this.planes.length - 1; idx >= 0; idx--) {
      const p = this.planes[idx];
      if (p.cruise) {
        const d = p.to.clone().sub(p.pos);
        if (d.length() < 5) { this.planes.splice(idx, 1); continue; }
        d.normalize();
        p.pos.addScaledVector(d, p.speed * run);
        p.yaw = Math.atan2(d.x, d.z);
      } else {
        if (!G.buildings.has(p.airport)) { this.planes.splice(idx, 1); continue; }
        const leg = p.legs[p.k];
        if (leg.hold && p.held === undefined) p.held = leg.hold;
        const d = leg.to.clone().sub(p.pos);
        const dist = d.length();
        const flatDist = Math.hypot(d.x, d.z);
        // speed control: take-off acceleration, braking on roll-out, steady elsewhere
        const target = leg.speed;
        const rate = leg.accel || leg.brake || 1.5;
        p.v += Math.max(-rate * run, Math.min(rate * run, target - p.v));
        if (dist < Math.max(0.15, p.v * run * 1.2)) {
          p.pos.copy(leg.to);
          if (p.held > 0) { p.held -= run; }
          else {
            p.held = undefined;
            if (leg.end) { this.planes.splice(idx, 1); continue; }
            p.k++;
          }
        } else {
          d.normalize();
          p.pos.addScaledVector(d, p.v * run);
          if (flatDist > 0.05) p.yaw = Math.atan2(d.x, d.z) + 0 * run;
          p.pitch += ((leg.climb ? 0.22 : leg.flare ? -0.05 : 0) - p.pitch) * Math.min(1, run * 1.5);
        }
      }
      p.prop += run * 40;
      this._e.set(-p.pitch, p.yaw, 0);
      this._q.setFromEuler(this._e);
      this._s.setScalar(p.scale || 1);
      this._m.compose(p.pos, this._q, this._s);
      const spin = p.prop;
      this.rigs.plane.add(this._m, p, this._c.set(p.cruise ? 0x1d4fa0 : 0x1d6fb8), null, (name) => (name.startsWith('Prop') ? this._r.makeRotationZ(spin) : null));
    }
  }

  pick(raycaster) {
    let best = null;
    for (const [name, rig] of Object.entries(this.rigs)) {
      if (!rig.n) continue;
      for (const mesh of rig.meshes) {
        if (!mesh.count) continue;
        mesh.computeBoundingSphere();
        const h = raycaster.intersectObject(mesh, false)[0];
        if (h && (!best || h.distance < best.d)) best = { d: h.distance, obj: rig.idAt(mesh, h.instanceId), kind: name };
      }
    }
    return best;
  }
}
