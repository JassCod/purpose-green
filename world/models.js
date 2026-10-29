import * as THREE from '../vendor/three.module.js';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';
import { part, M, addSnow } from './terrain.js';

export const bodyMaterial = addSnow(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }));
export const windowMaterial = new THREE.MeshStandardMaterial({ color: 0x9fd3ff, emissive: 0xffcf73, emissiveIntensity: 0, roughness: 0.25, metalness: 0.2 });
export const darkWindowMaterial = new THREE.MeshStandardMaterial({ color: 0x55606b, roughness: 0.35, metalness: 0.2 });
export const lightMaterial =new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0 });

const box = (w, h, d, color, x = 0, y = 0, z = 0, ry = 0) => part(new THREE.BoxGeometry(w, h, d), color, M(x, y + h / 2, z, ry));
const cyl = (rt, rb, h, color, x = 0, y = 0, z = 0, seg = 12) => part(new THREE.CylinderGeometry(rt, rb, h, seg), color, M(x, y + h / 2, z));
function prism(w, h, d, color, x = 0, y = 0, z = 0, ry = 0) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.lineTo(-w / 2, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  return part(g, color, M(x, y, z, ry));
}

/** Windows on the four faces of a box (w × d footprint, rows starting at y0). */
function windowGrid(list, w, d, rows, cols, y0, rowH, ww = 0.22, wh = 0.26, sides = 'nsew') {
  const t = 0.04;
  for (let r = 0; r < rows; r++) {
    const y = y0 + r * rowH;
    for (let c = 0; c < cols; c++) {
      const fx = -w / 2 + (w / cols) * (c + 0.5), fz = -d / 2 + (d / cols) * (c + 0.5);
      if (sides.includes('s')) list.push(box(ww, wh, t, 0, fx, y, d / 2 + 0.01));
      if (sides.includes('n')) list.push(box(ww, wh, t, 0, fx, y, -d / 2 - 0.01));
      if (sides.includes('e')) list.push(box(t, wh, ww, 0, w / 2 + 0.01, y, fz));
      if (sides.includes('w')) list.push(box(t, wh, ww, 0, -w / 2 - 0.01, y, fz));
    }
  }
}

const pick = (arr, v) => arr[v % arr.length];

const BUILDERS = {
  house(v) {
    const wall = pick([0xfff3dc, 0xfde2e4, 0xe2f0ff, 0xfff8c9, 0xe8f6e1], v), roof = pick([0xd9654f, 0x3f8f5f, 0x5a6fd0, 0x8a5a3a], v);
    const b = [
      box(1.7, 0.08, 1.6, 0xbfb6a6),
      box(1.3, 0.9, 1.1, wall, 0, 0.05),
      prism(1.5, 0.62, 1.3, roof, 0, 0.95, 0),
      box(0.22, 0.45, 0.22, 0xcfc8bd, 0.4, 1.05, -0.2),
      box(0.3, 0.5, 0.05, 0x8a5a3a, 0.3, 0.05, 0.56),
      box(0.5, 0.3, 0.35, 0x6fbf5a, -0.55, 0.05, 0.7),
    ];
    const w = [];
    windowGrid(w, 1.3, 1.1, 1, 2, 0.4, 0, 0.26, 0.26, 's');
    windowGrid(w, 1.3, 1.1, 1, 1, 0.4, 0, 0.3, 0.26, 'ew');
    return { body: b, windows: w };
  },
  apartment(v) {
    const wall = pick([0xe9e1d3, 0xd7e4ef, 0xf1d9c9], v), h = 4.2 + (v % 3) * 0.9;
    const b = [box(3.6, 0.1, 3.6, 0xbfb6a6), box(3.0, h, 2.6, wall, 0, 0.1), box(3.1, 0.18, 2.7, 0x8f8a83, 0, h + 0.1), box(0.8, 0.5, 0.8, 0xa7a19a, 0.7, h + 0.28, -0.4)];
    for (let y = 1.0; y < h; y += 1.0) b.push(box(3.08, 0.06, 2.68, 0xffffff, 0, y));
    const w = [];
    windowGrid(w, 3.0, 2.6, Math.floor(h / 1.0), 5, 0.45, 1.0, 0.34, 0.42);
    return { body: b, windows: w };
  },
  farm(v) {
    const b = [box(3.8, 0.06, 3.8, 0x9a7b4f)];
    const crop = pick([[0x8bc34a, 0x6aa63a], [0xe8c547, 0xd4ad2f], [0x7cb342, 0xc5d86d]], v);
    for (let r = 0; r < 6; r++) b.push(box(2.3, 0.18, 0.32, crop[r % 2], -0.6, 0.06, -1.5 + r * 0.6));
    b.push(box(1.1, 0.9, 1.3, 0xb5413b, 1.25, 0.06, -0.6), prism(1.25, 0.55, 1.4, 0x6b3a2a, 1.25, 0.96, -0.6, Math.PI / 2));
    b.push(box(0.36, 0.5, 0.04, 0xffffff, 1.25, 0.06, 0.06));
    b.push(cyl(0.33, 0.33, 1.7, 0xd9d4c7, 1.3, 0.06, 1.0), part(new THREE.SphereGeometry(0.33, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0x9aa3ab, M(1.3, 1.76, 1.0)));
    return { body: b, windows: [] };
  },
  shop(v) {
    const wall = pick([0xffe3b3, 0xd4f1f4, 0xf9d1e0, 0xe0f5d0], v), awn = pick([0xe0434f, 0x2fbf71, 0x3a7bd5, 0xff9f1c], v);
    const b = [box(1.9, 0.08, 1.9, 0xc9c4b8), box(1.6, 0.95, 1.3, wall, 0, 0.08, -0.1), box(1.66, 0.1, 1.36, 0xffffff, 0, 1.03, -0.1)];
    b.push(part(new THREE.BoxGeometry(1.6, 0.05, 0.5), awn, new THREE.Matrix4().makeRotationX(0.35).premultiply(M(0, 0.85, 0.75))));
    b.push(box(0.9, 0.25, 0.06, 0xffffff, 0, 1.13, 0.5));
    const w = [box(1.1, 0.5, 0.04, 0, -0.1, 0.2, 0.56)];
    return { body: b, windows: w };
  },
  office(v) {
    const h = 3.2 + (v % 4) * 0.8, glass = pick([0x6f8fae, 0x5d7f9b, 0x7d93a8], v);
    const b = [box(1.9, 0.08, 1.9, 0xc9c4b8), box(1.4, h, 1.4, glass, 0, 0.08), box(1.48, 0.12, 1.48, 0xdfe6ee, 0, h + 0.08), box(0.5, 0.35, 0.5, 0xb6c0ca, 0.2, h + 0.2, 0.2)];
    const w = [];
    windowGrid(w, 1.4, 1.4, Math.floor(h / 0.5) - 1, 3, 0.45, 0.5, 0.3, 0.28);
    return { body: b, windows: w };
  },
  factory() {
    const b = [box(3.8, 0.08, 3.8, 0x9b968e), box(3.2, 1.4, 2.4, 0x9aa3ab, 0, 0.08, 0.3)];
    for (let k = 0; k < 4; k++) b.push(prism(0.8, 0.5, 2.4, 0x7d858e, -1.2 + k * 0.8, 1.48, 0.3, 0));
    b.push(cyl(0.2, 0.26, 2.8, 0xbf5b4a, -1.1, 0.08, -1.3), cyl(0.2, 0.26, 2.4, 0xbf5b4a, -0.4, 0.08, -1.3));
    b.push(box(1.0, 0.9, 0.05, 0xe6b84d, 0.8, 0.08, 1.52), box(0.6, 0.6, 0.6, 0x8a5a3a, 1.5, 0.08, -1.3), box(0.6, 0.4, 0.6, 0x8a5a3a, 1.5, 0.68, -1.3));
    const w = [];
    windowGrid(w, 3.2, 2.4, 1, 6, 0.9, 0, 0.3, 0.25, 'ew');
    return { body: b, windows: w, chimneys: [new THREE.Vector3(-1.1, 2.9, -1.3), new THREE.Vector3(-0.4, 2.5, -1.3)] };
  },
  coal() {
    const b = [box(3.8, 0.08, 3.8, 0x8f8a83), box(1.8, 1.2, 1.6, 0x8d949c, -0.8, 0.08, 0.6), box(1.9, 0.1, 1.7, 0x6b7178, -0.8, 1.28, 0.6)];
    const pts = [];
    for (let k = 0; k <= 10; k++) { const t = k / 10; pts.push(new THREE.Vector2(0.95 - Math.sin(t * Math.PI) * 0.35 - t * 0.1, t * 2.6)); }
    b.push(part(new THREE.LatheGeometry(pts, 18), 0xd6d1c9, M(0.9, 0.08, -0.7)));
    b.push(cyl(0.16, 0.24, 3.6, 0xe7e2dc, -1.4, 0.08, -1.2), cyl(0.17, 0.17, 0.3, 0xe0434f, -1.4, 3.3, -1.2));
    b.push(part(new THREE.ConeGeometry(0.45, 0.35, 7), 0x2b2b30, M(0.8, 0.25, 1.2)));
    return { body: b, windows: [], chimneys: [new THREE.Vector3(-1.4, 3.8, -1.2), new THREE.Vector3(0.9, 2.7, -0.7)] };
  },
  solar() {
    const b = [box(3.8, 0.05, 3.8, 0xb8b09a)];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 2; c++) {
        const x = -0.9 + c * 1.8, z = -1.2 + r * 1.2;
        b.push(cyl(0.04, 0.04, 0.35, 0xb8c2c8, x, 0.05, z, 6));
        b.push(part(new THREE.BoxGeometry(1.6, 0.05, 0.9), 0x2b4f9a, new THREE.Matrix4().makeRotationX(-0.5).premultiply(M(x, 0.45, z))));
      }
    }
    return { body: b, windows: [] };
  },
  wind() {
    const b = [box(1.2, 0.08, 1.2, 0xc9c4b8), cyl(0.07, 0.15, 4.4, 0xf6f6f2, 0, 0.08), box(0.22, 0.22, 0.5, 0xf6f6f2, 0, 4.4, -0.05)];
    return { body: b, windows: [], rotor: { y: 4.51, z: 0.25 } };
  },
  pump() {
    const b = [box(1.9, 0.08, 1.9, 0xc9c4b8), box(1.0, 0.75, 1.0, 0xe3eef6, -0.3, 0.08, -0.3), prism(1.1, 0.35, 1.1, 0x3a7bd5, -0.3, 0.83, -0.3)];
    b.push(cyl(0.32, 0.32, 0.7, 0x5ab0e6, 0.5, 0.08, 0.45));
    b.push(part(new THREE.CylinderGeometry(0.08, 0.08, 1.2, 8), 0x8fa3b0, new THREE.Matrix4().makeRotationZ(Math.PI / 2).premultiply(M(0.2, 0.3, 0.6))));
    return { body: b, windows: [box(0.3, 0.25, 0.04, 0, -0.3, 0.45, 0.21)] };
  },
  tower() {
    const b = [box(1.6, 0.08, 1.6, 0xc9c4b8)];
    [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]].forEach(([x, z]) => b.push(cyl(0.05, 0.07, 2.1, 0x8fa3b0, x, 0.08, z, 6)));
    b.push(cyl(0.65, 0.65, 0.9, 0x5ab0e6, 0, 2.1), part(new THREE.ConeGeometry(0.7, 0.4, 14), 0x3a7bd5, M(0, 3.2, 0)));
    return { body: b, windows: [] };
  },
  landfill() {
    const b = [box(3.8, 0.05, 3.8, 0x8a7356)];
    [[-0.8, -0.6, 1.0], [0.7, 0.5, 0.8], [0.6, -1.0, 0.6], [-0.9, 1.0, 0.7]].forEach(([x, z, s], k) =>
      b.push(part(new THREE.IcosahedronGeometry(s, 0), k % 2 ? 0x7a6a55 : 0x6d7a5a, M(x, 0.05, z, k, 1, 0.45, 1))));
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      b.push(cyl(0.03, 0.03, 0.5, 0x9a8a70, Math.cos(a) * 1.8, 0.05, Math.sin(a) * 1.8, 4));
    }
    b.push(box(0.6, 0.5, 0.5, 0x5f8f5f, 1.3, 0.05, 1.3));
    return { body: b, windows: [] };
  },
  school() {
    const b = [box(3.8, 0.08, 3.8, 0x8fcf6a), box(3.0, 1.1, 1.2, 0xf3d36b, 0, 0.08, -1.1), box(1.1, 1.1, 1.4, 0xf3d36b, 1.0, 0.08, 0.2)];
    b.push(prism(3.2, 0.5, 1.4, 0xc2523f, 0, 1.18, -1.1), prism(1.3, 0.5, 1.6, 0xc2523f, 1.0, 1.18, 0.2));
    b.push(box(1.8, 0.02, 1.2, 0x7fbf5a, -0.7, 0.09, 0.9), box(1.8, 0.03, 0.04, 0xffffff, -0.7, 0.1, 0.9));
    b.push(cyl(0.025, 0.025, 2.2, 0xdddddd, -1.6, 0.08, 1.6, 6), box(0.4, 0.25, 0.02, 0x2fbf71, -1.4, 2.0, 1.6));
    const w = [];
    windowGrid(w, 3.0, 1.2, 1, 6, 0.5, 0, 0.3, 0.3, 's');
    return { body: b, windows: w.map((g) => g.translate(0, 0, -1.1) && g) };
  },
  hospital() {
    const b = [box(3.8, 0.08, 3.8, 0xc9c4b8), box(2.8, 2.2, 2.2, 0xf5f7f8, 0, 0.08, -0.3), box(2.9, 0.12, 2.3, 0xd5dde2, 0, 2.28, -0.3)];
    b.push(box(0.6, 0.18, 0.04, 0xe0434f, 0, 1.6, 0.83), box(0.18, 0.6, 0.04, 0xe0434f, 0, 1.39, 0.83));
    b.push(cyl(0.7, 0.7, 0.04, 0x3d4450, 0, 2.4, -0.3, 20), box(0.5, 0.05, 0.1, 0xffffff, 0, 2.43, -0.3), box(0.1, 0.05, 0.5, 0xffffff, -0.2, 2.43, -0.3), box(0.1, 0.05, 0.5, 0xffffff, 0.2, 2.43, -0.3));
    b.push(box(1.0, 0.6, 0.8, 0xe8edf0, -1.2, 0.08, 1.2), box(0.9, 0.05, 0.6, 0xe0434f, -1.2, 0.68, 1.4));
    const w = [];
    windowGrid(w, 2.8, 2.2, 3, 5, 0.35, 0.6, 0.3, 0.3, 'ew');
    windowGrid(w, 2.8, 2.2, 1, 5, 0.35, 0, 0.3, 0.3, 'n');
    return { body: b, windows: w.map((g) => g.translate(0, 0, -0.3) && g) };
  },
  police() {
    const b = [box(1.9, 0.08, 1.9, 0xc9c4b8), box(1.6, 1.0, 1.3, 0xe8eef7, 0, 0.08, -0.15), box(1.65, 0.25, 1.35, 0x2f5fb3, 0, 1.08, -0.15)];
    b.push(box(0.8, 0.18, 0.05, 0x2f5fb3, 0, 0.8, 0.52));
    const w = [];
    windowGrid(w, 1.6, 1.3, 1, 3, 0.35, 0, 0.28, 0.3, 'sew');
    return { body: b, windows: w.map((g) => g.translate(0, 0, -0.15) && g), lights: [[-0.2, 1.42, -0.15], [0.2, 1.42, -0.15]] };
  },
  fire() {
    const b = [box(1.9, 0.08, 1.9, 0xc9c4b8), box(1.6, 1.1, 1.3, 0xc8382f, 0, 0.08, -0.15), box(1.66, 0.12, 1.36, 0xf2efe9, 0, 1.18, -0.15)];
    b.push(box(0.55, 0.7, 0.05, 0xf2efe9, -0.35, 0.08, 0.52), box(0.55, 0.7, 0.05, 0xf2efe9, 0.35, 0.08, 0.52));
    b.push(box(0.4, 1.9, 0.4, 0xa82d25, 0.55, 0.08, -0.55));
    return { body: b, windows: [box(0.25, 0.25, 0.04, 0, 0.55, 1.5, -0.34)] };
  },
  park(v) {
    const b = [box(1.96, 0.08, 1.96, 0x7fcf5f)];
    b.push(box(1.96, 0.02, 0.35, 0xe3d6b0, 0, 0.08, 0));
    b.push(cyl(0.3, 0.35, 0.2, 0xd9d4c7, 0, 0.08, 0, 14), cyl(0.24, 0.24, 0.05, 0x5ac8f2, 0, 0.26, 0, 14), cyl(0.04, 0.04, 0.3, 0xd9d4c7, 0, 0.28, 0, 6));
    [[-0.6, -0.6], [0.6, 0.55], [0.6, -0.6]].forEach(([x, z], k) => {
      b.push(cyl(0.05, 0.07, 0.45, 0x8a5a3a, x, 0.08, z, 6));
      b.push(part(new THREE.IcosahedronGeometry(0.35 + (k + v) % 2 * 0.08, 1), pick([0x4fb35a, 0x6fcc57, 0x3f9f4a], k + v), M(x, 0.7, z)));
    });
    b.push(box(0.5, 0.06, 0.16, 0x8a5a3a, -0.55, 0.25, 0.55), box(0.5, 0.2, 0.04, 0x8a5a3a, -0.55, 0.25, 0.62));
    return { body: b, windows: [] };
  },
};

const rotorGeo = mergeGeometries([
  part(new THREE.SphereGeometry(0.12, 10, 8), 0xf6f6f2),
  ...[0, 1, 2].map((k) => part(new THREE.BoxGeometry(0.12, 1.8, 0.04), 0xf6f6f2, new THREE.Matrix4().makeTranslation(0, 0.9, 0).premultiply(new THREE.Matrix4().makeRotationZ((k / 3) * Math.PI * 2)))),
]);
const beaconGeo = new THREE.SphereGeometry(0.06, 8, 6);

const cache = new Map();
function template(type, variant) {
  const key = `${type}:${variant}`;
  if (!cache.has(key)) {
    const t = BUILDERS[type](variant);
    cache.set(key, {
      body: mergeGeometries(t.body),
      windows: t.windows && t.windows.length ? mergeGeometries(t.windows) : null,
      chimneys: t.chimneys || [],
      rotor: t.rotor || null,
      lights: t.lights || null,
    });
  }
  return cache.get(key);
}

export const VARIANTS = { house: 5, apartment: 3, farm: 3, shop: 4, office: 4, park: 2 };

export function makeBuildingMesh(type, variant = 0) {
  const t = template(type, variant % (VARIANTS[type] || 1));
  const g = new THREE.Group();
  const body = new THREE.Mesh(t.body, bodyMaterial);
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  if (t.windows) {
    const w = new THREE.Mesh(t.windows, windowMaterial);
    g.add(w);
    g.userData.windows = w;
  }
  if (t.rotor) {
    const r = new THREE.Mesh(rotorGeo, bodyMaterial);
    r.position.set(0, t.rotor.y, t.rotor.z);
    r.castShadow = true;
    g.add(r);
    g.userData.rotor = r;
    const beacon = new THREE.Mesh(beaconGeo, lightMaterial);
    beacon.position.set(0, t.rotor.y + 0.16, -0.1);
    g.add(beacon);
  }
  if (t.lights) {
    const red = new THREE.MeshBasicMaterial({ color: 0xff3040 }), blue = new THREE.MeshBasicMaterial({ color: 0x3060ff });
    t.lights.forEach((p, k) => { const m = new THREE.Mesh(beaconGeo, k ? blue : red); m.position.set(...p); g.add(m); });
    g.userData.siren = [red, blue];
  }
  g.userData.chimneys = t.chimneys;
  return g;
}
