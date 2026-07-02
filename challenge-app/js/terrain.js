// 3D reaction-space terrain (Three.js). The surface is the DIM-GP mean; amber
// whiskers are the +/-1.96 sigma confidence interval (they grow where the model
// is unsure); spheres are real runs; the optimizer drops probes and climbs.
import * as THREE from '../vendor/three.module.min.js';

const W = 10, D = 10, HSCALE = 3.4;

export class TerrainField {
  constructor(container, surrogate, cmap) {
    this.el = container;
    this.s = surrogate;
    this.cmap = cmap;
    this.name = surrogate.outputs[0].name;
    this.goal = surrogate.outputs[0].goal;
    this.moveCb = null;
    this.t = 0;
    this.azimuth = -0.6; this.polar = 1.02; this.dist = 17.5;
    this.userInteracting = false; this.lastInput = 0;
    this._anim = [];
    this._dead = false;
    this.landCb = null;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.el.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    this.scene.add(new THREE.AmbientLight(0xc8c2b8, 0.85));
    const key = new THREE.DirectionalLight(0xffd9a0, 1.5); key.position.set(8, 14, 6); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffb006, 0.5); rim.position.set(-9, 5, -7); this.scene.add(rim);

    this.group = new THREE.Group(); this.scene.add(this.group);
    this._buildSurface();
    this._buildWhiskers();
    this._buildTrainPoints();
    this.sampleGroup = new THREE.Group(); this.group.add(this.sampleGroup);
    this.pathPts = [];

    this.raycaster = new THREE.Raycaster();
    this._bind();
    this._resize();
    this._ro = new ResizeObserver(() => this._resize()); this._ro.observe(this.el);
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  // ---- geometry helpers ----
  _grid() { return { nx: this.s.grid.x.length, ny: this.s.grid.y.length }; }
  _heightAt(ix, iy) {
    const m = this.s.fields[this.name].mean[iy][ix];
    return this.s.norm(this.name, m) * HSCALE;
  }
  _fx(nx) { return (nx - 0.5) * W; }
  _fz(ny) { return (ny - 0.5) * D; }

  _color(ix, iy) {
    const f = this.s.fields[this.name];
    const t = this.s.norm(this.name, f.mean[iy][ix]);
    let [r, g, b] = this.cmap(t);
    const sd = f.std[iy][ix] * this.s._shrink(this.s.grid.x[ix], this.s.grid.y[iy]);
    const fog = Math.min(1, Math.max(0, this.s.normStd(this.name, sd))) * 0.6;
    r = r * (1 - fog) + 168 * fog; g = g * (1 - fog) + 160 * fog; b = b * (1 - fog) + 148 * fog;
    return [r / 255, g / 255, b / 255];
  }

  _buildSurface() {
    const { nx, ny } = this._grid();
    const geo = new THREE.PlaneGeometry(W, D, nx - 1, ny - 1);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const ix = i % nx, iy = (i / nx) | 0;
      pos.setXYZ(i, this._fx(ix / (nx - 1)), this._heightAt(ix, iy), this._fz(iy / (ny - 1)));
      const [r, g, b] = this._color(ix, iy);
      col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    this.surfGeo = geo;
    this.surf = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.04, side: THREE.DoubleSide }));
    this.group.add(this.surf);
  }

  _buildWhiskers() {
    const { nx, ny } = this._grid();
    const step = 3;
    const verts = [];
    const Z = 1.96, st = this.s.stats(this.name);
    const hPer = HSCALE / (st.mx - st.mn || 1);
    for (let iy = 0; iy < ny; iy += step) for (let ix = 0; ix < nx; ix += step) {
      const x = this._fx(ix / (nx - 1)), z = this._fz(iy / (ny - 1)), h = this._heightAt(ix, iy);
      const sd = this.s.fields[this.name].std[iy][ix] * this.s._shrink(this.s.grid.x[ix], this.s.grid.y[iy]);
      const half = Z * sd * hPer;
      verts.push(x, h - half, z, x, h + half, z);
    }
    this.whGeo = new THREE.BufferGeometry();
    this.whGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    this.whiskers = new THREE.LineSegments(this.whGeo, new THREE.LineBasicMaterial({ color: 0xffb006, transparent: true, opacity: 0.55 }));
    this.group.add(this.whiskers);
  }

  _buildTrainPoints() {
    this.trainGroup = new THREE.Group(); this.group.add(this.trainGroup);
    const geo = new THREE.SphereGeometry(0.11, 12, 12);
    const mat = new THREE.MeshStandardMaterial({ color: 0xf5f5f7, emissive: 0x6b6b70, roughness: 0.4 });
    const a0 = this.s.axisInput(0), a1 = this.s.axisInput(1);
    for (const p of this.s.trainPoints) {
      const nx = (p.x - a0.min) / (a0.max - a0.min), ny = (p.y - a1.min) / (a1.max - a1.min);
      const h = this.s.norm(this.name, this.s.predict(this.name, p.x, p.y).mean) * HSCALE;
      const m = new THREE.Mesh(geo, mat); m.position.set(this._fx(nx), h + 0.12, this._fz(ny));
      m.userData = { nx, ny }; this.trainGroup.add(m);
    }
  }

  setOutput(name, goal) {
    // Drop any probe still falling: it was aimed at the old surface height, so
    // landing it on the new target would settle it at the wrong elevation.
    if (this._anim.length) {
      [...this.sampleGroup.children].forEach((c) => this.sampleGroup.remove(c));
      this._anim = [];
      if (this.landCb) this.landCb();
    }
    this.name = name; this.goal = goal; this.rebuild();
  }
  onMove(cb) { this.moveCb = cb; }
  onLand(cb) { this.landCb = cb; }
  get busy() { return this._anim.length > 0; }

  rebuild() {
    const { nx, ny } = this._grid();
    const pos = this.surfGeo.attributes.position, col = this.surfGeo.attributes.color;
    for (let i = 0; i < pos.count; i++) {
      const ix = i % nx, iy = (i / nx) | 0;
      pos.setY(i, this._heightAt(ix, iy));
      const [r, g, b] = this._color(ix, iy); col.setXYZ(i, r, g, b);
    }
    pos.needsUpdate = true; col.needsUpdate = true; this.surfGeo.computeVertexNormals();
    // whiskers
    const wp = this.whGeo.attributes.position; const Z = 1.96, st = this.s.stats(this.name);
    const hPer = HSCALE / (st.mx - st.mn || 1); const step = 3; let k = 0;
    for (let iy = 0; iy < ny; iy += step) for (let ix = 0; ix < nx; ix += step) {
      const h = this._heightAt(ix, iy);
      const sd = this.s.fields[this.name].std[iy][ix] * this.s._shrink(this.s.grid.x[ix], this.s.grid.y[iy]);
      const half = Z * sd * hPer;
      wp.setY(k, h - half); wp.setY(k + 1, h + half); k += 2;
    }
    wp.needsUpdate = true;
    // training spheres heights
    for (const m of this.trainGroup.children) {
      const a0 = this.s.axisInput(0), a1 = this.s.axisInput(1);
      const x = a0.min + m.userData.nx * (a0.max - a0.min), y = a1.min + m.userData.ny * (a1.max - a1.min);
      m.position.y = this.s.norm(this.name, this.s.predict(this.name, x, y).mean) * HSCALE + 0.12;
    }
  }

  pickNext() {
    const pick = this.s.nextSample(this.name, this.goal);
    if (!pick) return null;
    const a0 = this.s.axisInput(0), a1 = this.s.axisInput(1);
    const nx = (pick.x - a0.min) / (a0.max - a0.min), ny = (pick.y - a1.min) / (a1.max - a1.min);
    const h = this.s.norm(this.name, pick.mean) * HSCALE;
    const geo = new THREE.SphereGeometry(0.17, 14, 14);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffb006, emissive: 0xff8a00, emissiveIntensity: 0.7, roughness: 0.3 });
    const mesh = new THREE.Mesh(geo, mat); mesh.position.set(this._fx(nx), h + 6, this._fz(ny));
    this.sampleGroup.add(mesh);
    this._anim.push({ mesh, nx, ny, h, t: 0, pick });
    return pick;
  }

  _rebuildPath() {
    if (this.pathLine) { this.group.remove(this.pathLine); this.pathLine.geometry.dispose(); this.pathLine = null; }
    if (this.pathPts.length < 2) return;
    const g = new THREE.BufferGeometry().setFromPoints(this.pathPts);
    this.pathLine = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffb006, transparent: true, opacity: 0.7 }));
    this.group.add(this.pathLine);
  }

  resetSamples() {
    this.s.reset(); this._anim = [];
    [...this.sampleGroup.children].forEach((c) => this.sampleGroup.remove(c));
    if (this.pathLine) { this.group.remove(this.pathLine); this.pathLine = null; }
    this.pathPts = []; this.rebuild();
  }

  // ---- interaction ----
  _bind() {
    const dom = this.renderer.domElement;
    let px = 0, py = 0, down = false;
    dom.addEventListener('pointerdown', (e) => { down = true; this.userInteracting = true; px = e.clientX; py = e.clientY; });
    // Stored on `this` so dispose() can remove it; an anonymous window listener
    // would otherwise pin this renderer + its GPU context forever.
    this._onPointerUp = () => { down = false; };
    window.addEventListener('pointerup', this._onPointerUp);
    dom.addEventListener('pointermove', (e) => {
      this.lastInput = this.t;
      if (down) {
        this.azimuth -= (e.clientX - px) * 0.006; this.polar = clamp(this.polar - (e.clientY - py) * 0.005, 0.35, 1.4);
        px = e.clientX; py = e.clientY;
      } else { this._hover(e); }
    });
    dom.addEventListener('wheel', (e) => { e.preventDefault(); this.dist = clamp(this.dist + e.deltaY * 0.012, 11, 30); this.lastInput = this.t; }, { passive: false });
    dom.addEventListener('pointerleave', () => { if (this.moveCb) this.moveCb(null); });
  }

  _hover(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(v, this.camera);
    const hit = this.raycaster.intersectObject(this.surf, false)[0];
    if (!hit || !this.moveCb) { if (this.moveCb) this.moveCb(null); return; }
    const nx = clamp(hit.point.x / W + 0.5, 0, 1), ny = clamp(hit.point.z / D + 0.5, 0, 1);
    const a0 = this.s.axisInput(0), a1 = this.s.axisInput(1);
    const x = a0.min + nx * (a0.max - a0.min), y = a1.min + ny * (a1.max - a1.min);
    this.hoverMark = { nx, ny };
    this.moveCb({ x, y, ...this.s.predict(this.name, x, y) });
  }

  _resize() {
    const r = this.el.getBoundingClientRect();
    if (r.width < 2) return;
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height; this.camera.updateProjectionMatrix();
  }

  _loop(ts) {
    if (this._dead || !this.renderer.domElement.isConnected) { this._ro.disconnect(); return; }
    if (document.hidden) { requestAnimationFrame(this._loop); return; } // page-visibility guard
    this.t = ts * 0.001;
    // falling-probe animations: probe drops onto the surface, then fog clears
    for (let i = this._anim.length - 1; i >= 0; i--) {
      const a = this._anim[i]; a.t = Math.min(1, a.t + 0.045);
      const e = 1 - Math.pow(1 - a.t, 3);
      a.mesh.position.y = (a.h + 6) * (1 - e) + (a.h + 0.18) * e;
      if (a.t >= 1) {
        this.s.addSample(a.pick.x, a.pick.y);
        this.pathPts.push(new THREE.Vector3(this._fx(a.nx), a.h + 0.18, this._fz(a.ny)));
        this._rebuildPath(); this.rebuild();
        this._anim.splice(i, 1);
        if (this._anim.length === 0 && this.landCb) this.landCb();   // probe settled -> re-enable optimize
      }
    }
    // idle auto-rotate
    if (this.t - this.lastInput > 2.5) this.azimuth += 0.0016;
    const cx = Math.sin(this.azimuth) * Math.sin(this.polar) * this.dist;
    const cz = Math.cos(this.azimuth) * Math.sin(this.polar) * this.dist;
    const cy = Math.cos(this.polar) * this.dist;
    this.camera.position.set(cx, cy + 2.2, cz);
    this.camera.lookAt(0, 1.1, 0);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this._loop);   // keep animating; the _dead/isConnected guard above stops it
  }

  dispose() {
    this._dead = true;                                   // stops the rAF loop on its next tick
    this._ro?.disconnect();
    window.removeEventListener('pointerup', this._onPointerUp);
    this.renderer.dispose();
    this.renderer.forceContextLoss();                    // release the GPU context now, not at GC
    this.renderer.domElement.remove();
  }
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
