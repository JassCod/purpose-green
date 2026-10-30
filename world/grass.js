// Real 3D grass near the viewer: instanced clumps of tapered blades that bend in
// the wind, get greener in spring, brown in a drought and disappear under snow.

import * as THREE from '../vendor/three.module.js';
import { T, WATER } from './terrain.js';
import { hash2 } from './noise.js';

const CELL = 0.13; // world units between clumps (~65 cm)

function bladeClump() {
  const pos = [], col = [], hgt = [];
  const base = new THREE.Color(0x2c4a17), tip = new THREE.Color(0x9fc25a);
  for (let b = 0; b < 9; b++) {
    const a = (b / 9) * Math.PI * 2 + Math.random() * 0.6;
    const r = Math.random() * 0.03;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = 0.03 + Math.random() * 0.045;          // 15–40 cm
    const w = 0.004 + Math.random() * 0.003;          // 2–3.5 cm wide
    const lean = (Math.random() - 0.5) * 0.5;
    const dx = Math.cos(a + Math.PI / 2) * w, dz = Math.sin(a + Math.PI / 2) * w;
    const lx = Math.cos(a) * lean * h, lz = Math.sin(a) * lean * h;
    // three segments tapering to a point
    const pts = [];
    for (let s = 0; s <= 3; s++) {
      const t = s / 3, k = 1 - t;
      pts.push([x + lx * t * t - dx * k, h * t, z + lz * t * t - dz * k], [x + lx * t * t + dx * k, h * t, z + lz * t * t + dz * k]);
    }
    for (let s = 0; s < 3; s++) {
      const [a0, a1, b0, b1] = [pts[s * 2], pts[s * 2 + 1], pts[s * 2 + 2], pts[s * 2 + 3]];
      for (const p of [a0, b0, a1, a1, b0, b1]) {
        pos.push(...p);
        const t = p[1] / h;
        const c = base.clone().lerp(tip, t);
        col.push(c.r, c.g, c.b);
        hgt.push(p[1] / 0.075);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('bend', new THREE.Float32BufferAttribute(hgt, 1));
  g.computeVertexNormals();
  // blades are lit as if their normal points up, which reads far better than thin-sheet normals
  const n = g.attributes.normal;
  for (let k = 0; k < n.count; k++) n.setXYZ(k, 0, 1, 0);
  return g;
}

export class Grass {
  constructor(scene, terrain, isFree) {
    this.scene = scene;
    this.terrain = terrain;
    this.isFree = isFree;
    this.uniforms = { uTime: { value: 0 }, uWind: { value: 0.3 }, uWindDir: { value: new THREE.Vector2(1, 0) }, uDry: { value: 0 }, uSnow: { value: 0 } };
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float bend;\nuniform float uTime, uWind;\nuniform vec2 uWindDir;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float gust = sin(uTime * 1.7 + wp.x * 0.9 + wp.z * 0.7) * 0.5 + sin(uTime * 3.1 + wp.x * 2.3) * 0.25 + 0.6;
          float b = bend * bend * (0.012 + uWind * 0.05) * gust;
          transformed.x += uWindDir.x * b;
          transformed.z += uWindDir.y * b;
          transformed.y -= b * 0.35;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uDry, uSnow;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.45, 1.15, 0.55), uDry);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.92, 0.96), uSnow);`);
    };
    mat.customProgramCacheKey = () => 'grass';
    this.mesh = new THREE.InstancedMesh(bladeClump(), mat, 1);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.center = new THREE.Vector2(1e9, 1e9);
    this.max = 0;
    this.radius = 14;
  }

  setBudget(max, radius = 14) {
    if (max === this.max) return;
    this.max = max;
    this.radius = radius;
    const geo = this.mesh.geometry, mat = this.mesh.material;
    this.scene.remove(this.mesh);
    this.mesh.dispose();
    this.mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, max));
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.count = 0;
    this.scene.add(this.mesh);
    this.center.set(1e9, 1e9);
  }

  rebuild(x, z) {
    this.center.set(x, z);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const R = this.radius, n0 = Math.floor((x - R) / CELL), n1 = Math.floor((x + R) / CELL), m0 = Math.floor((z - R) / CELL), m1 = Math.floor((z + R) / CELL);
    let n = 0;
    const tr = this.terrain;
    for (let a = n0; a <= n1 && n < this.max; a++) {
      for (let b = m0; b <= m1 && n < this.max; b++) {
        const px = (a + hash2(a, b, 41)) * CELL, pz = (b + hash2(a, b, 42)) * CELL;
        const d2 = (px - x) ** 2 + (pz - z) ** 2;
        if (d2 > R * R) continue;
        // thin out towards the edge so the patch has no hard border
        if (hash2(a, b, 43) > 1.15 - Math.sqrt(d2) / R) continue;
        const i = Math.floor(px / T), j = Math.floor(pz / T);
        if (!this.isFree(i, j)) continue;
        const st = tr.tileStats(i, j);
        if (st.min < WATER + 0.55 || st.avg > 12 || st.max - st.min > 1.3) continue;
        p.set(px, tr.surfaceH(px, pz) - 0.004, pz);
        q.setFromAxisAngle(up, hash2(a, b, 44) * 6.28);
        const sc = 0.7 + hash2(a, b, 45) * 0.7;
        s.set(sc, sc * (0.8 + hash2(a, b, 46) * 0.6), sc);
        this.mesh.setMatrixAt(n++, m.compose(p, q, s));
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt, focus, { wind, windDir, dryness, snow, visible }) {
    this.mesh.visible = visible && this.max > 0;
    this.uniforms.uTime.value += dt;
    this.uniforms.uWind.value = wind;
    this.uniforms.uWindDir.value.set(Math.cos(windDir), Math.sin(windDir));
    this.uniforms.uDry.value = dryness;
    this.uniforms.uSnow.value = snow;
    if (!this.mesh.visible) return;
    if (Math.hypot(focus.x - this.center.x, focus.z - this.center.y) > this.radius * 0.3) this.rebuild(focus.x, focus.z);
  }
}
