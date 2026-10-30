// Loads the Blender-made glTF models and turns them into instancing-friendly templates.

import * as THREE from '../vendor/three.module.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';

export const MODEL_LIST = {
  house: 5, apartment: 3, office: 4, shop: 4, farm: 3, park: 2, oak: 2, pine: 2,
  factory: 1, coal: 1, solar: 1, wind: 1, pump: 1, tower: 1, landfill: 1, school: 1, hospital: 1, police: 1, fire: 1,
  restaurant: 3, bank: 1, university: 1, yard: 1,
  car: 1, hatch: 1, suv: 1, taxi: 1, policecar: 1, ambulance: 1, firetruck: 1, bus: 1, truck: 1,
  person_m: 1, person_f: 1, streetlight: 1,
};

/* Shared materials that the game animates (night lights, power state). */
export const shared = {
  windowLit: new THREE.MeshStandardMaterial({ name: 'WindowLit', color: 0x2b3a48, roughness: 0.08, metalness: 0.6, emissive: 0xffc77a, emissiveIntensity: 0 }),
  windowDark: new THREE.MeshStandardMaterial({ name: 'WindowDark', color: 0x1f2a34, roughness: 0.06, metalness: 0.7 }),
  lamp: new THREE.MeshStandardMaterial({ name: 'Lamp', color: 0xfff3d6, emissive: 0xffd58a, emissiveIntensity: 0, roughness: 0.3 }),
  sirenRed: new THREE.MeshStandardMaterial({ name: 'SirenRed', color: 0xd01010, emissive: 0xff0000, emissiveIntensity: 0 }),
  sirenBlue: new THREE.MeshStandardMaterial({ name: 'SirenBlue', color: 0x1030d0, emissive: 0x0040ff, emissiveIntensity: 0 }),
  headlight: new THREE.MeshStandardMaterial({ name: 'HeadLight', color: 0xfffbea, emissive: 0xfff2cc, emissiveIntensity: 0.4 }),
  taillight: new THREE.MeshStandardMaterial({ name: 'TailLight', color: 0x8a0505, emissive: 0xff1508, emissiveIntensity: 0.5 }),
};

const PART_RE = /^(Rotor|Wheel\d|LegL|LegR|ArmL|ArmR)/;
const templates = new Map();
const materialCache = new Map();
export const getTemplate = (name) => templates.get(name);

/**
 * A template is a list of primitives (geometry already in model space + material),
 * plus named sub-parts (Rotor) and particle emitters (Smoke / Steam).
 */
function buildTemplate(name, gltf, anisotropy) {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const prims = [];
  const parts = {}; // named sub-objects with their own pivot: Rotor, Wheel0.., LegL, ArmR …
  const emitters = [];
  const bbox = new THREE.Box3();
  root.traverse((o) => {
    if (!o.isMesh && /^(Smoke|Steam)/.test(o.name)) emitters.push({ kind: o.name.startsWith('Steam') ? 'steam' : 'smoke', pos: new THREE.Vector3().setFromMatrixPosition(o.matrixWorld) });
    if (!o.isMesh) return;
    let inPart = null;
    for (let p = o; p && p !== root; p = p.parent) if (PART_RE.test(p.name)) inPart = p;
    const geo = o.geometry.clone();
    // every model file loads its own copy of shared materials/textures; keep one per name
    let mat = materialCache.get(o.material.name);
    if (!mat) { mat = o.material; materialCache.set(mat.name, mat); }
    const tex = [mat.map, mat.normalMap];
    tex.forEach((t) => { if (t) t.anisotropy = anisotropy; });
    if (mat.name === 'Leaves' || mat.name === 'Needles') {
      mat.alphaTest = 0.5; mat.transparent = false; mat.side = THREE.DoubleSide; mat.depthWrite = true;
    }
    const key = { Window: 'window', Lamp: 'lamp', SirenRed: 'sirenRed', SirenBlue: 'sirenBlue', HeadLight: 'headlight', TailLight: 'taillight' }[mat.name];
    if (key === 'lamp' || key === 'sirenRed' || key === 'sirenBlue' || key === 'headlight' || key === 'taillight') mat = shared[key];
    const paint = mat.name === 'Paint' || mat.name === 'Shirt', paint2 = mat.name === 'Paint2';
    if (inPart) {
      geo.applyMatrix4(new THREE.Matrix4().copy(inPart.matrixWorld).invert().multiply(o.matrixWorld));
      const part = parts[inPart.name] || (parts[inPart.name] = { name: inPart.name, prims: [], matrix: inPart.matrixWorld.clone() });
      part.prims.push({ geometry: geo, material: mat, name: mat.name, paint, paint2 });
    } else {
      geo.applyMatrix4(o.matrixWorld);
      geo.computeBoundingBox();
      bbox.union(geo.boundingBox);
      prims.push({ geometry: geo, material: mat, name: mat.name, window: key === 'window', paint, paint2 });
    }
  });
  // a "solid" box for physics: only geometry above 2.5 m so lawns, hedges and fences stay walkable
  const solid = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const p of prims) {
    if (p.name === 'Leaves' || p.name === 'Needles') continue;
    const pos = p.geometry.attributes.position;
    for (let k = 0; k < pos.count; k++) { v.fromBufferAttribute(pos, k); if (v.y > 0.5) solid.expandByPoint(v); }
  }
  if (!solid.isEmpty()) solid.min.y = 0;
  templates.set(name, { name, prims, parts, rotor: parts.Rotor || null, emitters, bbox, solid: solid.isEmpty() ? null : solid });
}

export async function loadAssets(renderer, onProgress = () => {}) {
  const loader = new GLTFLoader();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const jobs = [];
  for (const [base, n] of Object.entries(MODEL_LIST)) {
    for (let v = 0; v < n; v++) jobs.push(n > 1 ? `${base}_${v}` : base);
  }
  let done = 0;
  await Promise.all(jobs.map((name) => loader.loadAsync(`assets/models/${name}.gltf`).then((g) => {
    buildTemplate(name, g, aniso);
    onProgress(++done / jobs.length);
  })));
  return templates;
}

/* ------------------------------------------------------------------ */
/*  Instanced batches: one InstancedMesh per template primitive        */
/* ------------------------------------------------------------------ */
export class Batch {
  constructor(parent, prims, { shadows = true, receive = true, filter = null, override = null } = {}) {
    this.parent = parent;
    this.prims = prims.filter((p) => !filter || filter(p));
    this.override = override;
    this.cap = 0;
    this.meshes = [];
    this.ids = [];
    this.n = 0;
    this.shadows = shadows;
    this.receive = receive;
    this.grow(16);
  }

  grow(cap) {
    for (const m of this.meshes) { this.parent.remove(m); m.dispose(); }
    this.cap = cap;
    this.meshes = this.prims.map((p) => {
      const im = new THREE.InstancedMesh(p.geometry, this.override || p.material, cap);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.castShadow = this.shadows;
      im.receiveShadow = this.receive;
      im.frustumCulled = false;
      im.count = 0;
      im.userData.batch = this;
      im.userData.paint = p.paint;
      im.userData.paint2 = p.paint2;
      this.parent.add(im);
      return im;
    });
  }

  begin() { this.n = 0; }

  add(matrix, id = null, color = null, color2 = null) {
    if (this.n >= this.cap) {
      const keep = this.meshes.map((m) => m.instanceMatrix.array.slice(0, this.n * 16));
      const keepC = this.meshes.map((m) => m.instanceColor ? m.instanceColor.array.slice(0, this.n * 3) : null);
      this.grow(this.cap * 2);
      this.meshes.forEach((m, k) => {
        m.instanceMatrix.array.set(keep[k]);
        if (keepC[k]) { m.setColorAt(0, new THREE.Color()); m.instanceColor.array.set(keepC[k]); }
      });
    }
    for (const m of this.meshes) {
      m.setMatrixAt(this.n, matrix);
      if (color && m.userData.paint) m.setColorAt(this.n, color);
      if (color2 && m.userData.paint2) m.setColorAt(this.n, color2);
    }
    this.ids[this.n] = id;
    this.n++;
  }

  end() {
    for (const m of this.meshes) {
      m.count = this.n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  setShadows(on) { for (const m of this.meshes) m.castShadow = on; }

  dispose() { for (const m of this.meshes) { this.parent.remove(m); m.dispose(); } this.meshes = []; }
}

/** A plain (non-instanced) group built from a template, used for ghosts and physics props. */
export function templateGroup(name, materialOverride = null) {
  const t = templates.get(name);
  const g = new THREE.Group();
  for (const p of t.prims) {
    const m = new THREE.Mesh(p.geometry, materialOverride || (p.window ? shared.windowDark : p.material));
    m.castShadow = true;
    g.add(m);
  }
  for (const part of Object.values(t.parts)) {
    const r = new THREE.Group();
    r.name = part.name;
    r.position.setFromMatrixPosition(part.matrix);
    for (const p of part.prims) { const m = new THREE.Mesh(p.geometry, materialOverride || p.material); m.castShadow = true; r.add(m); }
    g.add(r);
    g.userData[part.name] = r;
  }
  return g;
}

/**
 * A rig: an instanced model whose named parts (wheels, limbs, rotors) can each be
 * rotated per instance, e.g. spinning wheels or swinging legs.
 */
export class RigBatch {
  constructor(parent, name, opts = {}) {
    this.t = templates.get(name);
    this.body = new Batch(parent, this.t.prims, opts);
    this.parts = Object.values(this.t.parts).map((p) => ({ part: p, batch: new Batch(parent, p.prims, opts) }));
    this._m = new THREE.Matrix4();
  }
  begin() { this.body.begin(); for (const p of this.parts) p.batch.begin(); }
  /** pose(name) returns a rotation Matrix4 for a part (or null for none) */
  add(matrix, id, color, color2, pose) {
    this.body.add(matrix, id, color, color2);
    for (const { part, batch } of this.parts) {
      this._m.multiplyMatrices(matrix, part.matrix);
      const r = pose && pose(part.name);
      if (r) this._m.multiply(r);
      batch.add(this._m, id, color, color2);
    }
  }
  end() { this.body.end(); for (const p of this.parts) p.batch.end(); }
  get n() { return this.body.n; }
  get meshes() { return [...this.body.meshes, ...this.parts.flatMap((p) => p.batch.meshes)]; }
  idAt(mesh, instanceId) { return mesh.userData.batch.ids[instanceId]; }
}
