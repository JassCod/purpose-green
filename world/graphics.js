// Rendering quality: post-processing (bloom, ambient occlusion, SMAA), shadow
// resolution and a sky full of clouds that respond to weather and time of day.

import * as THREE from '../vendor/three.module.js';
import { EffectComposer } from '../vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from '../vendor/jsm/postprocessing/SMAAPass.js';
import { SSAOPass } from '../vendor/jsm/postprocessing/SSAOPass.js';
import { makeNoise2D } from './noise.js';

export const QUALITY = {
  low: { label: 'Low', pixelRatio: 1, shadow: 1024, post: false, ao: false, clouds: 14 },
  high: { label: 'High', pixelRatio: 1.5, shadow: 2048, post: true, ao: false, clouds: 26 },
  ultra: { label: 'Ultra', pixelRatio: 2, shadow: 4096, post: true, ao: true, clouds: 40 },
};

export class Graphics {
  constructor(renderer, scene, camera, sun) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.sun = sun;
    this.composer = null;
    this.level = 'high';
    this.clouds = new CloudLayer(scene);
  }

  setQuality(level) {
    const q = QUALITY[level] || QUALITY.high;
    this.level = level in QUALITY ? level : 'high';
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    if (this.sun.shadow.mapSize.x !== q.shadow) {
      this.sun.shadow.mapSize.set(q.shadow, q.shadow);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    if (this.composer) { this.composer.dispose(); this.composer = null; }
    if (q.post) {
      const size = r.getSize(new THREE.Vector2());
      const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 0 });
      const c = new EffectComposer(r, target);
      c.addPass(new RenderPass(this.scene, this.camera));
      if (q.ao) {
        const ao = new SSAOPass(this.scene, this.camera, size.x, size.y);
        ao.kernelRadius = 0.6;
        ao.minDistance = 0.0004;
        ao.maxDistance = 0.02;
        c.addPass(ao);
        this.ao = ao;
      } else this.ao = null;
      // only genuinely bright things glow: lamps, lit windows, the sun's disc, fire
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.35, 0.45, 0.92);
      c.addPass(this.bloom);
      c.addPass(new OutputPass());
      c.addPass(new SMAAPass(size.x * r.getPixelRatio(), size.y * r.getPixelRatio()));
      this.composer = c;
      this.resize(size.x, size.y);
    }
    this.clouds.setCount(q.clouds);
  }

  resize(w, h) {
    this.renderer.setSize(w, h, false);
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
  }

  /** night: 0..1, glows get stronger after dark */
  update(dt, { night = 0 } = {}) {
    if (this.bloom) {
      this.bloom.strength = 0.18 + night * 0.3;
      this.bloom.threshold = 0.96 - night * 0.1;
    }
  }

  render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}

/* ------------------------------------------------------------------ */
/*  Clouds: soft billboards drifting with the wind at ~800–1200 m      */
/* ------------------------------------------------------------------ */
function cloudTexture(seed) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const n = makeNoise2D(seed);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S - 0.5, v = y / S - 0.5;
      // flat-bottomed cumulus: round on top, cut off below the middle
      const r = Math.hypot(u * 1.15, (v < 0.05 ? v * 1.6 : v * 3.2));
      let d = 0, amp = 1, f = 3;
      for (let o = 0; o < 5; o++) { d += n(x / S * f + seed, y / S * f) * amp; amp *= 0.5; f *= 2; }
      const a = Math.max(0, Math.min(1, (0.46 - r) * 4 + d * 0.45));
      const shade = 0.72 + 0.28 * Math.max(0, Math.min(1, 0.5 - v * 1.6 + d * 0.3));
      const o4 = (y * S + x) * 4;
      img.data[o4] = img.data[o4 + 1] = 255 * shade;
      img.data[o4 + 2] = 255 * Math.min(1, shade * 1.03);
      img.data[o4 + 3] = 255 * a * a;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class CloudLayer {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.textures = [cloudTexture(3), cloudTexture(7), cloudTexture(11)];
    this.sprites = [];
    this.target = 20;
    this.cover = 0.3;
  }
  setCount(n) {
    while (this.sprites.length < n) {
      const m = new THREE.SpriteMaterial({ map: this.textures[this.sprites.length % 3], transparent: true, depthWrite: false, fog: false, opacity: 0 });
      const s = new THREE.Sprite(m);
      s.userData = { x: (Math.random() - 0.5) * 900, z: (Math.random() - 0.5) * 900, y: 160 + Math.random() * 80, w: 90 + Math.random() * 120, rank: Math.random() };
      s.renderOrder = -1;
      this.group.add(s);
      this.sprites.push(s);
    }
    while (this.sprites.length > n) this.group.remove(this.sprites.pop());
  }
  /** cover 0..1 (fraction of sky), wind m/s-ish 0..1, light colour of the sky */
  update(dt, center, { cover, wind, windDir, light, gloom }) {
    this.cover += (cover - this.cover) * Math.min(1, dt * 0.2);
    const dx = Math.cos(windDir) * (4 + wind * 30) * dt, dz = Math.sin(windDir) * (4 + wind * 30) * dt;
    for (const s of this.sprites) {
      const u = s.userData;
      u.x += dx; u.z += dz;
      // wrap around the viewer so the sky never empties
      if (u.x - center.x > 450) u.x -= 900; if (u.x - center.x < -450) u.x += 900;
      if (u.z - center.z > 450) u.z -= 900; if (u.z - center.z < -450) u.z += 900;
      s.position.set(u.x, center.y + u.y, u.z);
      s.scale.set(u.w * (1 + this.cover * 0.6), u.w * 0.45 * (1 + this.cover * 0.6), 1);
      const visible = u.rank < this.cover * 1.15;
      s.material.opacity += ((visible ? 0.92 : 0) - s.material.opacity) * Math.min(1, dt * 0.5);
      s.material.color.copy(light).lerp(new THREE.Color(0.45, 0.47, 0.5), gloom * 0.8);
    }
  }
}
