// Real physics with cannon-es, simulated in metres and seconds (1 world unit = 5 m).
// Terrain becomes heightfields around the focus point, buildings and trees become
// static colliders, and the player, the drivable car, thrown balls, demolition
// debris and felled trees are dynamic bodies under 9.81 m/s² gravity.

import * as CANNON from '../vendor/cannon-es.js';
import * as THREE from '../vendor/three.module.js';
import { T, CHUNK, WATER, METERS, tkey } from './terrain.js';
import { G, DEFS } from './sim.js';
import { getTemplate, templateGroup, shared } from './assets.js';

const P = METERS;
const toW = (v) => new THREE.Vector3(v.x / P, v.y / P, v.z / P);

export class Physics {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    const w = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
    w.broadphase = new CANNON.SAPBroadphase(w);
    w.allowSleep = true;
    w.defaultContactMaterial.friction = 0.4;
    w.defaultContactMaterial.restitution = 0.1;
    this.world = w;
    this.mGround = new CANNON.Material('ground');
    this.mPlayer = new CANNON.Material('player');
    this.mBall = new CANNON.Material('ball');
    w.addContactMaterial(new CANNON.ContactMaterial(this.mGround, this.mPlayer, { friction: 0.0, restitution: 0 }));
    w.addContactMaterial(new CANNON.ContactMaterial(this.mGround, this.mBall, { friction: 0.4, restitution: 0.55 }));
    this.heightfields = new Map();
    this.statics = new Map(); // key -> body (buildings 'b<id>', trees 't<i,j>')
    this.props = [];          // dynamic visual props: { body, mesh, life, max }
    this.player = null;
    this.car = null;
    this.focus = new THREE.Vector3();
    this.refreshTimer = 9;
  }

  /* ---------------------------------------------------------------- world around the focus */
  setFocus(x, z) {
    this.focus.set(x, 0, z);
    const cx = Math.floor(x / (T * CHUNK)), cz = Math.floor(z / (T * CHUNK));
    const want = new Set();
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) want.add(tkey(cx + a, cz + b));
    for (const [k, body] of this.heightfields) if (!want.has(k)) { this.world.removeBody(body); this.heightfields.delete(k); }
    for (const k of want) if (!this.heightfields.has(k)) this.addHeightfield(...k.split(',').map(Number));
  }

  addHeightfield(ci, cj) {
    const i0 = ci * CHUNK, j0 = cj * CHUNK, N = CHUNK + 1;
    const data = [];
    for (let a = 0; a < N; a++) {
      const col = [];
      for (let b = 0; b < N; b++) col.push(this.terrain.cornerH(i0 + a, j0 + CHUNK - b) * P);
      data.push(col);
    }
    const shape = new CANNON.Heightfield(data, { elementSize: T * P });
    const body = new CANNON.Body({ mass: 0, material: this.mGround });
    body.addShape(shape);
    // heightfields live in the XY plane; rotate so +Z (height) becomes world up
    body.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    body.position.set(i0 * T * P, 0, (j0 + CHUNK) * T * P);
    this.world.addBody(body);
    this.heightfields.set(tkey(ci, cj), body);
  }

  /** Terrain edits (flattening for buildings) must refresh the affected heightfield. */
  invalidate() {
    for (const body of this.heightfields.values()) this.world.removeBody(body);
    this.heightfields.clear();
    this.setFocus(this.focus.x, this.focus.z);
    this.refreshTimer = 9;
  }

  refreshStatics() {
    const R = 22 * T;
    const fx = this.focus.x, fz = this.focus.z;
    const keep = new Set();
    for (const b of G.buildings.values()) {
      const cx = (b.i + b.size / 2) * T, cz = (b.j + b.size / 2) * T;
      if (Math.abs(cx - fx) > R || Math.abs(cz - fz) > R || ['park', 'airport', 'port', 'yard', 'farm'].includes(b.type)) continue;
      const key = `b${b.id}:${b.progress >= 1 ? 1 : 0}`;
      keep.add(key);
      if (this.statics.has(key)) continue;
      const t = getTemplate(`${b.type}${variantSuffix(b)}`);
      if (!t || !t.solid) continue;
      const box = t.solid.clone();
      const scaleY = b.progress >= 1 ? 1 : 0.3;
      const half = new CANNON.Vec3((box.max.x - box.min.x) / 2 * P, (box.max.y - box.min.y) / 2 * P * scaleY, (box.max.z - box.min.z) / 2 * P);
      const local = new THREE.Vector3((box.max.x + box.min.x) / 2, (box.max.y - box.min.y) / 2 * scaleY, (box.max.z + box.min.z) / 2).applyAxisAngle(new THREE.Vector3(0, 1, 0), b.rot);
      const body = new CANNON.Body({ mass: 0, material: this.mGround });
      body.addShape(new CANNON.Box(half));
      body.position.set((cx + local.x) * P, (b.level + local.y) * P, (cz + local.z) * P);
      body.quaternion.setFromEuler(0, b.rot, 0);
      this.world.addBody(body);
      this.statics.set(key, body);
    }
    const ti0 = Math.floor((fx - R / 2) / T), ti1 = Math.floor((fx + R / 2) / T);
    const tj0 = Math.floor((fz - R / 2) / T), tj1 = Math.floor((fz + R / 2) / T);
    for (let i = ti0; i <= ti1; i++) {
      for (let j = tj0; j <= tj1; j++) {
        const tr = this.terrain.treeAt(i, j);
        if (!tr) continue;
        const key = `t${i},${j}`;
        keep.add(key);
        if (this.statics.has(key)) continue;
        const r = (tr.kind === 2 ? 0.3 : 0.32) * tr.scale;
        const body = new CANNON.Body({ mass: 0, material: this.mGround });
        body.addShape(new CANNON.Cylinder(r, r, 6, 8));
        body.position.set(tr.x * P, tr.y * P + 3, tr.z * P);
        this.world.addBody(body);
        this.statics.set(key, body);
      }
    }
    for (const [k, body] of this.statics) if (!keep.has(k)) { this.world.removeBody(body); this.statics.delete(k); }
  }

  /* ---------------------------------------------------------------- player (walk mode) */
  spawnPlayer(x, z) {
    this.removePlayer();
    const y = Math.max(WATER, this.terrain.surfaceH(x, z)) * P + 1.2;
    const body = new CANNON.Body({ mass: 75, material: this.mPlayer, fixedRotation: true, linearDamping: 0.05 });
    // a capsule made of two spheres: feet and chest
    body.addShape(new CANNON.Sphere(0.3), new CANNON.Vec3(0, 0.3, 0));
    body.addShape(new CANNON.Sphere(0.3), new CANNON.Vec3(0, 1.3, 0));
    body.position.set(x * P, y, z * P);
    body.allowSleep = false;
    this.world.addBody(body);
    this.player = { body, grounded: false, swim: false };
    this.focus.set(x, 0, z);
    this.setFocus(x, z);
    this.refreshTimer = 9;
  }
  removePlayer() { if (this.player) { this.world.removeBody(this.player.body); this.player = null; } }

  /** input: { fwd, right, run, jump } in -1..1, yaw = facing direction */
  drivePlayer(input, yaw, dt) {
    const p = this.player;
    if (!p) return;
    const b = p.body;
    // ground test straight down from the feet
    const from = new CANNON.Vec3(b.position.x, b.position.y + 0.3, b.position.z);
    const to = new CANNON.Vec3(b.position.x, b.position.y - 0.25, b.position.z);
    const ray = new CANNON.RaycastResult();
    this.world.raycastClosest(from, to, { skipBackfaces: true, collisionFilterMask: -1 }, ray);
    p.grounded = ray.hasHit && ray.body !== b;
    const waterY = WATER * P;
    p.swim = b.position.y + 1.0 < waterY;
    const speed = input.run ? 6.0 : 1.6; // m/s: brisk walk / jog
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const wx = (fx * input.fwd - fz * input.right) * speed, wz = (fz * input.fwd + fx * input.right) * speed;
    const control = p.grounded ? 12 : p.swim ? 3 : 1.5;
    b.velocity.x += (wx - b.velocity.x) * Math.min(1, control * dt);
    b.velocity.z += (wz - b.velocity.z) * Math.min(1, control * dt);
    if (input.jump && p.grounded) b.velocity.y = 4.2; // ~0.9 m jump
    if (p.swim) {
      b.velocity.y += (9.81 * 1.05) * dt; // buoyancy
      b.velocity.y *= 1 - Math.min(1, 2.5 * dt);
      if (input.jump) b.velocity.y = Math.max(b.velocity.y, 1.5);
    }
  }
  playerEye() {
    const b = this.player.body;
    return new THREE.Vector3(b.position.x / P, (b.position.y + 1.62) / P, b.position.z / P);
  }

  /* ---------------------------------------------------------------- drivable car */
  spawnCar(x, z, yaw, color = 0xc81d25) {
    this.removeCar();
    const y = Math.max(WATER, this.terrain.surfaceH(x, z)) * P + 1.2;
    const chassis = new CANNON.Body({ mass: 1300 });
    chassis.addShape(new CANNON.Box(new CANNON.Vec3(0.88, 0.4, 2.15)), new CANNON.Vec3(0, 0.55, 0));
    chassis.addShape(new CANNON.Box(new CANNON.Vec3(0.78, 0.32, 1.1)), new CANNON.Vec3(0, 1.25, 0.1));
    chassis.position.set(x * P, y, z * P);
    chassis.quaternion.setFromEuler(0, yaw, 0);
    chassis.angularDamping = 0.4;
    chassis.allowSleep = false;
    const vehicle = new CANNON.RaycastVehicle({ chassisBody: chassis, indexRightAxis: 0, indexUpAxis: 1, indexForwardAxis: 2 });
    const wheel = {
      radius: 0.34, directionLocal: new CANNON.Vec3(0, -1, 0), suspensionStiffness: 32, suspensionRestLength: 0.35,
      frictionSlip: 3.2, dampingRelaxation: 2.4, dampingCompression: 4.2, maxSuspensionForce: 120000, rollInfluence: 0.05,
      axleLocal: new CANNON.Vec3(-1, 0, 0), maxSuspensionTravel: 0.3, customSlidingRotationalSpeed: -30, useCustomSlidingRotationalSpeed: true,
    };
    for (const [wx, wz] of [[0.8, 1.4], [-0.8, 1.4], [0.8, -1.35], [-0.8, -1.35]]) {
      vehicle.addWheel({ ...wheel, chassisConnectionPointLocal: new CANNON.Vec3(wx, 0.45, wz) });
    }
    vehicle.addToWorld(this.world);
    const mesh = templateGroup('car');
    const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.5 });
    mesh.traverse((o) => { if (o.isMesh && o.material.name === 'Paint') o.material = paint; });
    mesh.scale.setScalar(1);
    this.scene.add(mesh);
    this.car = { vehicle, chassis, mesh, steer: 0 };
    this.focus.set(x, 0, z);
    this.setFocus(x, z);
    this.refreshTimer = 9;
    return this.car;
  }
  removeCar() {
    if (!this.car) return;
    this.car.vehicle.removeFromWorld(this.world);
    this.scene.remove(this.car.mesh);
    this.car = null;
  }
  /** input: { throttle, steer, brake, handbrake } */
  driveCar(input, dt) {
    const c = this.car;
    if (!c) return;
    const v = c.vehicle;
    const kmh = this.carSpeed();
    const forward = this.carForwardSpeed();
    c.steer += ((input.steer * (0.55 - Math.min(0.35, Math.abs(kmh) / 300))) - c.steer) * Math.min(1, dt * 6);
    v.setSteeringValue(c.steer, 0);
    v.setSteeringValue(c.steer, 1);
    let engine = 0, brake = 0;
    // cannon-es pushes the car along -forward for positive engine force
    if (input.throttle > 0) engine = forward < -1 ? 0 : -2600;
    if (input.throttle > 0 && forward < -1) brake = 60;
    if (input.throttle < 0) { if (forward > 1) brake = 60; else engine = 1600; }
    if (kmh > 130) engine = 0;
    if (!input.throttle) brake = 4; // rolling resistance / engine braking
    if (input.handbrake) brake = 120;
    for (const k of [2, 3]) v.applyEngineForce(engine, k);
    for (let k = 0; k < 4; k++) v.setBrake(k >= 2 && input.handbrake ? brake : brake * 0.6, k);
    // water: the engine floods and the car slowly sinks
    if (c.chassis.position.y < WATER * P - 0.4) {
      c.chassis.velocity.scale(1 - Math.min(1, dt * 1.5), c.chassis.velocity);
      c.chassis.applyForce(new CANNON.Vec3(0, 1300 * 9.81 * 0.8, 0), c.chassis.position);
      for (const k of [2, 3]) v.applyEngineForce(0, k);
    }
  }
  carSpeed() { return this.car ? this.car.chassis.velocity.length() * 3.6 : 0; }
  carForwardSpeed() {
    if (!this.car) return 0;
    const f = this.car.chassis.quaternion.vmult(new CANNON.Vec3(0, 0, 1));
    return f.dot(this.car.chassis.velocity) * 3.6;
  }
  carPose() {
    const ch = this.car.chassis;
    return { pos: toW(ch.position), quat: new THREE.Quaternion(ch.quaternion.x, ch.quaternion.y, ch.quaternion.z, ch.quaternion.w) };
  }
  resetCar() {
    if (!this.car) return;
    const ch = this.car.chassis;
    const x = ch.position.x / P, z = ch.position.z / P;
    const fwd = ch.quaternion.vmult(new CANNON.Vec3(0, 0, 1));
    ch.position.y = Math.max(WATER, this.terrain.surfaceH(x, z)) * P + 1.5;
    ch.quaternion.setFromEuler(0, Math.atan2(fwd.x, fwd.z), 0);
    ch.velocity.set(0, 0, 0);
    ch.angularVelocity.set(0, 0, 0);
  }

  /* ---------------------------------------------------------------- props: debris, balls, falling trees */
  addProp(body, mesh, max = 20) {
    this.world.addBody(body);
    this.scene.add(mesh);
    this.props.push({ body, mesh, life: 0, max });
    while (this.props.length > 160) this.killProp(this.props[0]);
  }
  killProp(p) {
    this.world.removeBody(p.body);
    this.scene.remove(p.mesh);
    this.props.splice(this.props.indexOf(p), 1);
  }

  /** Building rubble flying apart under gravity (demolition, fire, collapse). */
  debris(x, y, z, size, count, materials) {
    const dist = Math.hypot(x - this.focus.x, z - this.focus.z);
    if (dist > 40 * T) return;
    if (!this.heightfields.size || dist > 1.4 * CHUNK * T) this.setFocusTemporary(x, z);
    for (let k = 0; k < count; k++) {
      const s = 0.4 + Math.random() * 1.3;
      const half = new CANNON.Vec3(s * (0.5 + Math.random() * 0.6), s * 0.4, s * (0.5 + Math.random() * 0.6));
      const body = new CANNON.Body({ mass: half.x * half.y * half.z * 8 * 1800, material: this.mGround });
      body.addShape(new CANNON.Box(half));
      body.position.set((x + (Math.random() - 0.5) * size) * P, (y + Math.random() * size * 0.6) * P + 1, (z + (Math.random() - 0.5) * size) * P);
      body.velocity.set((Math.random() - 0.5) * 8, 3 + Math.random() * 6, (Math.random() - 0.5) * 8);
      body.angularVelocity.set(Math.random() * 6 - 3, Math.random() * 6 - 3, Math.random() * 6 - 3);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(half.x * 2 / P, half.y * 2 / P, half.z * 2 / P), materials[k % materials.length]);
      mesh.castShadow = true;
      this.addProp(body, mesh, 14 + Math.random() * 6);
    }
  }
  setFocusTemporary(x, z) {
    if (this.player || this.car) return;
    this.setFocus(x, z);
    this.refreshTimer = 9;
  }

  throwBall(origin, dir) {
    const r = 0.11;
    const body = new CANNON.Body({ mass: 0.43, material: this.mBall, linearDamping: 0.05, angularDamping: 0.3 });
    body.addShape(new CANNON.Sphere(r));
    body.position.set(origin.x * P, origin.y * P, origin.z * P);
    body.velocity.set(dir.x * 16, dir.y * 16 + 3, dir.z * 16);
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r / P, 16, 12), ballMat);
    mesh.castShadow = true;
    this.addProp(body, mesh, 45);
  }

  /** A tree that topples over when it is cut down. */
  fellTree(tr) {
    if (!getTemplate(tr.name)) return;
    const mesh = templateGroup(tr.name);
    mesh.scale.setScalar(tr.scale);
    const pivot = new THREE.Group();
    pivot.add(mesh);
    const h = (tr.kind === 2 ? 13 : 8) * tr.scale;
    mesh.position.y = -h / 2 / P;
    const body = new CANNON.Body({ mass: 900 * tr.scale, material: this.mGround, angularDamping: 0.2 });
    body.addShape(new CANNON.Box(new CANNON.Vec3(0.35, h / 2, 0.35)));
    body.position.set(tr.x * P, tr.y * P + h / 2 + 0.05, tr.z * P);
    const a = Math.random() * Math.PI * 2;
    body.angularVelocity.set(Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6);
    this.setFocusTemporary(tr.x, tr.z);
    this.addProp(body, pivot, 10);
  }

  /* ---------------------------------------------------------------- step */
  step(dt) {
    this.refreshTimer += dt;
    if (this.refreshTimer > 1) { this.refreshTimer = 0; this.refreshStatics(); }
    this.world.step(1 / 60, dt, 4);
    for (let k = this.props.length - 1; k >= 0; k--) {
      const p = this.props[k];
      p.life += dt;
      p.mesh.position.set(p.body.position.x / P, p.body.position.y / P, p.body.position.z / P);
      p.mesh.quaternion.set(p.body.quaternion.x, p.body.quaternion.y, p.body.quaternion.z, p.body.quaternion.w);
      if (p.body.position.y < WATER * P - 0.2) { p.body.velocity.scale(0.96, p.body.velocity); p.body.applyForce(new CANNON.Vec3(0, p.body.mass * 6, 0), p.body.position); }
      if (p.life > p.max) { p.mesh.position.y -= (p.life - p.max) * 0.3; if (p.life > p.max + 2) this.killProp(p); }
      if (p.body.position.y < -200) this.killProp(p);
    }
    if (this.car) {
      const { pos, quat } = this.carPose();
      // the car model's origin is at the ground under the wheels; chassis origin sits 0.35 m above
      this.car.mesh.position.copy(pos).add(new THREE.Vector3(0, -0.02, 0).applyQuaternion(quat));
      this.car.mesh.quaternion.copy(quat);
      // wheels roll with the car's forward speed; front wheels show the steering angle
      this.car.spin = (this.car.spin || 0) + (this.carForwardSpeed() / 3.6) * dt / 0.33;
      for (let k = 0; k < 4; k++) {
        const w = this.car.mesh.userData['Wheel' + k];
        if (!w) continue;
        w.rotation.set(this.car.spin, k < 2 ? this.car.steer : 0, 0, 'YXZ');
      }
    }
  }
}

const ballMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
export function variantSuffix(b) {
  const VARIANTS = { house: 5, apartment: 3, farm: 3, shop: 4, office: 4, park: 2, restaurant: 3 };
  return VARIANTS[b.type] ? `_${b.variant % VARIANTS[b.type]}` : '';
}
export { shared, DEFS };
