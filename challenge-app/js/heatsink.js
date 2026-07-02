// Morphing pin-fin heat sink (Three.js). A base plate plus a pool of pin meshes
// that reposition/rescale/recolor as the design params change. Pins are colored by
// an illustrative thermal field (hotter centre, scaled by predicted peak temperature).
// Uses plain meshes with culling disabled, the same robust approach as the terrain.
import * as THREE from '../vendor/three.module.min.js';

const FOOT = 9;            // world footprint of the plate
const MAX_SIDE = 11;
const MAXN = MAX_SIDE * MAX_SIDE;

export class HeatSink {
  constructor(container) {
    this.el = container;
    this.t = 0; this.azimuth = -0.7; this.polar = 0.95; this.dist = 20;
    this.lastInput = 0;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.el.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 1000);
    this.scene.add(new THREE.AmbientLight(0xc4bcb0, 0.85));
    const key = new THREE.DirectionalLight(0xffe6c0, 1.4); key.position.set(7, 16, 9); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xff7a3c, 0.55); rim.position.set(-8, 5, -6); this.scene.add(rim);

    this.group = new THREE.Group(); this.scene.add(this.group);

    // base plate (heated source)
    this.baseMat = new THREE.MeshStandardMaterial({ color: 0xff8a3c, roughness: 0.5, metalness: 0.15, emissive: 0x551500, emissiveIntensity: 0.5 });
    this.base = new THREE.Mesh(new THREE.BoxGeometry(FOOT + 1.2, 0.7, FOOT + 1.2), this.baseMat);
    this.base.position.y = -0.35; this.base.frustumCulled = false; this.group.add(this.base);

    // shared pin geometry with a subtle base->tip vertical shade (thermal hue is per pin)
    this.pinGeo = new THREE.CylinderGeometry(0.5, 0.62, 1, 16, 1);
    const cnt = this.pinGeo.attributes.position.count;
    const col = new Float32Array(cnt * 3);
    for (let i = 0; i < cnt; i++) {
      const tt = this.pinGeo.attributes.position.getY(i) + 0.5;
      const c = lerp3([0.66, 0.66, 0.68], [1, 1, 1], tt);
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    this.pinGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));

    // pool of individual pin meshes (robust, no instancing)
    this.pins = [];
    for (let i = 0; i < MAXN; i++) {
      const m = new THREE.Mesh(this.pinGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.25 }));
      m.frustumCulled = false; m.visible = false; this.group.add(m); this.pins.push(m);
    }

    this._bind(); this._resize();
    this._ro = new ResizeObserver(() => this._resize()); this._ro.observe(this.el);
    this._loop = this._loop.bind(this);
    this.setParams(0.5, 0.4, 0.5);
    requestAnimationFrame(this._loop);
  }

  // heightFrac/spacingFrac normalized 0..1; tempNorm 0..1 (1 = hot)
  setParams(heightFrac, spacingFrac, tempNorm) {
    const perSide = clampi(Math.round(11 - clamp01(spacingFrac) * 7), 4, MAX_SIDE);
    const sw = FOOT / perSide;
    const r = sw * 0.36;
    const hWorld = 1.0 + clamp01(heightFrac) * 7.6;
    const half = (perSide - 1) / 2;
    let k = 0;
    for (let iz = 0; iz < perSide; iz++) for (let ix = 0; ix < perSide; ix++) {
      const x = (ix - half) * sw, z = (iz - half) * sw;
      const m = this.pins[k];
      m.visible = true;
      m.position.set(x, hWorld / 2, z);
      m.scale.set(r * 2, hWorld, r * 2);
      const rad = Math.hypot(x, z) / (FOOT * 0.72);
      const heat = clamp01((1 - rad) * 0.55 + clamp01(tempNorm) * 0.7);
      const c = lerp3([1.0, 0.82, 0.5], [1.0, 0.28, 0.12], heat);
      m.material.color.setRGB(c[0], c[1], c[2]);
      k++;
    }
    for (; k < MAXN; k++) this.pins[k].visible = false;
    const bc = lerp3([1.0, 0.62, 0.28], [1.0, 0.26, 0.10], clamp01(tempNorm));
    this.baseMat.color.setRGB(bc[0], bc[1], bc[2]);
    this.baseMat.emissiveIntensity = 0.3 + 0.5 * clamp01(tempNorm);
  }

  _bind() {
    const dom = this.renderer.domElement; let px = 0, py = 0, down = false;
    dom.addEventListener('pointerdown', (e) => { down = true; px = e.clientX; py = e.clientY; this.lastInput = this.t; });
    dom.addEventListener('pointermove', (e) => {
      if (!down) return; this.lastInput = this.t;
      this.azimuth -= (e.clientX - px) * 0.006; this.polar = clamp(this.polar - (e.clientY - py) * 0.005, 0.3, 1.25);
      px = e.clientX; py = e.clientY;
    });
    dom.addEventListener('wheel', (e) => { e.preventDefault(); this.dist = clamp(this.dist + e.deltaY * 0.012, 13, 34); this.lastInput = this.t; }, { passive: false });
    // window-level listener: store the bound handler so destroy() can remove it.
    this._onPointerUp = () => { down = false; };
    window.addEventListener('pointerup', this._onPointerUp);
  }

  _resize() {
    const r = this.el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return;
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height; this.camera.updateProjectionMatrix();
  }

  _loop(ts) {
    if (this._dead) return;
    if (!this.renderer.domElement.isConnected) { this.destroy(); return; }
    if (document.hidden) { requestAnimationFrame(this._loop); return; } // page-visibility guard
    this.t = ts * 0.001;
    if (this.t - this.lastInput > 2.5) this.azimuth += 0.0015;
    const s = Math.sin(this.polar) * this.dist;
    this.camera.position.set(Math.sin(this.azimuth) * s, Math.cos(this.polar) * this.dist + 2.5, Math.cos(this.azimuth) * s);
    this.camera.lookAt(0, 1.6, 0);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this._loop);
  }

  // Release everything: stop the loop, drop window listeners, kill the WebGL context.
  // Idempotent and safe to call from the loop (isConnected) or from mountEngineering's teardown.
  destroy() {
    if (this._dead) return;
    this._dead = true;
    if (this._onPointerUp) { window.removeEventListener('pointerup', this._onPointerUp); this._onPointerUp = null; }
    this._ro?.disconnect();
    const dom = this.renderer.domElement;
    try { this.renderer.dispose(); } catch (e) { /* already gone */ }
    try { this.renderer.forceContextLoss(); } catch (e) { /* not all impls expose this */ }
    dom?.remove();
  }
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function clampi(v, a, b) { return Math.max(a, Math.min(b, v | 0)); }
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function lerp3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
