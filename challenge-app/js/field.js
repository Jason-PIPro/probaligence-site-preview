// The Confidence Field, the shared hero interaction.
// Renders a STOCHOS prediction surface with its uncertainty as fog, training
// data as glowing anchors, and a cursor error-halo sized by live uncertainty.

export class ConfidenceField {
  constructor(canvas, surrogate, cmap) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.s = surrogate;
    this.cmap = cmap;
    this.name = surrogate.outputs[0].name;
    this.goal = surrogate.outputs[0].goal;
    this.cursor = { nx: 0.5, ny: 0.5, on: false };
    this.dirty = true;
    this.t = 0;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.moveCb = null;
    this._anim = []; // transient pin-drop animations
    this._dead = false; // set by destroy() to stop the rAF loop

    const nx = surrogate.grid.x.length, ny = surrogate.grid.y.length;
    this.lo = makeCanvas(nx, ny);     // base color (value blended with fog)
    this.mask = makeCanvas(nx, ny);   // fog alpha (grayscale)
    this.noise = makeCanvas(72, 72);
    this.scratch = makeCanvas(nx, ny);

    // Preallocated noise buffer - reused every frame to avoid ~20 KB/s heap churn.
    // Filled in-place; ImageData is constructed from the typed array, not allocated fresh.
    this._noiseBuf = new Uint8ClampedArray(72 * 72 * 4);
    this._noiseFrame = 0; // frame counter for throttling noise regen

    this._resize();
    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
    this._bindPointer();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  // full teardown: drop the window listener and stop the rAF loop
  destroy() {
    this._dead = true;
    window.removeEventListener('resize', this._onResize);
  }

  // drop any in-flight pin-drop animations and their pending after() callbacks
  // (prevents a reset during an animation from re-adding a phantom sample)
  clearAnims() { this._anim.length = 0; }

  setOutput(name, goal) { this.name = name; this.goal = goal; this.dirty = true; }
  onMove(cb) { this.moveCb = cb; }
  invalidate() { this.dirty = true; }
  // drive the cursor programmatically (used by the guided tour)
  setCursor(nx, ny) { this.cursor.nx = nx; this.cursor.ny = ny; this.cursor.on = true; this._emit(); }

  _resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2); // recompute so zoom/HiDPI stays crisp
    const r = this.cv.getBoundingClientRect();
    this.w = Math.max(2, r.width); this.h = Math.max(2, r.height);
    this.cv.width = this.w * this.dpr; this.cv.height = this.h * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  // ---- coordinate helpers (axis value <-> screen px) ----
  ax0() { return this.s.axisInput(0); }
  ax1() { return this.s.axisInput(1); }
  valX(nx) { const a = this.ax0(); return a.min + nx * (a.max - a.min); }
  valY(ny) { const a = this.ax1(); return a.min + ny * (a.max - a.min); }
  pxX(nx) { return nx * this.w; }
  pxY(ny) { return (1 - ny) * this.h; }

  _bindPointer() {
    const set = (e) => {
      const r = this.cv.getBoundingClientRect();
      this.cursor.nx = clamp01((e.clientX - r.left) / r.width);
      this.cursor.ny = clamp01(1 - (e.clientY - r.top) / r.height);
      this.cursor.on = true;
      this._emit();
    };
    this.cv.addEventListener('pointermove', set);
    this.cv.addEventListener('pointerdown', set);
    this.cv.addEventListener('pointerleave', () => { this.cursor.on = false; });
  }

  _emit() {
    if (!this.moveCb) return;
    const x = this.valX(this.cursor.nx), y = this.valY(this.cursor.ny);
    this.moveCb({ x, y, ...this.s.predict(this.name, x, y) });
  }

  // ---- bake base color + fog mask (only when something changed) ----
  _bake() {
    const nx = this.s.grid.x.length, ny = this.s.grid.y.length;
    const st = this.s.stats(this.name);
    const base = this.lo.ctx.createImageData(nx, ny);
    const mk = this.mask.ctx.createImageData(nx, ny);
    for (let r = 0; r < ny; r++) {
      const j = ny - 1 - r; // screen top = high y
      for (let i = 0; i < nx; i++) {
        const x = this.s.grid.x[i], y = this.s.grid.y[j];
        const { mean, std } = this.s.predict(this.name, x, y);
        const t = (mean - st.mn) / (st.mx - st.mn || 1);
        let [cr, cg, cb] = this.cmap(t);
        const fog = smoothstep(0.12, 0.95, (std) / (st.smx || 1));
        // blend toward a warm neutral grey + darken where uncertain
        const fc = 0.62 * fog;
        cr = cr * (1 - fc) + 168 * fc; cg = cg * (1 - fc) + 160 * fc; cb = cb * (1 - fc) + 148 * fc;
        const dk = 1 - 0.34 * fog;
        const k = (r * nx + i) * 4;
        base.data[k] = cr * dk; base.data[k + 1] = cg * dk; base.data[k + 2] = cb * dk; base.data[k + 3] = 255;
        // mask encodes fog in the ALPHA channel (destination-in uses source alpha)
        mk.data[k] = 255; mk.data[k + 1] = 255; mk.data[k + 2] = 255; mk.data[k + 3] = Math.round(255 * fog);
      }
    }
    this.lo.ctx.putImageData(base, 0, 0);
    this.mask.ctx.putImageData(mk, 0, 0);
    this.dirty = false;
  }

  _genNoise() {
    const n = this.noise.cv.width; // 72
    const buf = this._noiseBuf;
    for (let i = 0; i < n * n; i++) {
      const v = 120 + (Math.random() * 135 + 0.5) | 0;
      buf[i * 4] = buf[i * 4 + 1] = buf[i * 4 + 2] = v;
      buf[i * 4 + 3] = 255;
    }
    // Construct ImageData from the preallocated buffer (no heap allocation).
    this.noise.ctx.putImageData(new ImageData(buf, n, n), 0, 0);
  }

  dropSample(x, y, after) {
    this._anim.push({ x, y, t: 0, after });
  }

  _loop(ts) {
    if (this._dead || !this.cv.isConnected) return; // stop the rAF loop on destroy or navigation
    if (document.hidden) { requestAnimationFrame(this._loop); return; } // page-visibility guard
    this.t = ts * 0.001;
    if (this.dirty) this._bake();
    // Throttle noise regen: every 9th frame (~150 ms at 60 fps) instead of the
    // old broken (ts|0)%5 which fired several times/sec and allocated a new ImageData each call.
    this._noiseFrame = (this._noiseFrame + 1) | 0;
    if (this._noiseFrame % 9 === 0) this._genNoise();
    this._draw();
    requestAnimationFrame(this._loop);
  }

  _draw() {
    const ctx = this.ctx, w = this.w, h = this.h;
    ctx.clearRect(0, 0, w, h);

    // base color (smooth upscaled)
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.lo.cv, 0, 0, w, h);

    // animated grain only where foggy: noise ∩ mask, screened on
    const sc = this.scratch;
    sc.ctx.clearRect(0, 0, sc.cv.width, sc.cv.height);
    sc.ctx.globalCompositeOperation = 'source-over';
    sc.ctx.save();
    const off = (this.t * 14) % 24;
    sc.ctx.translate(-off, off * 0.6);
    sc.ctx.imageSmoothingEnabled = true;
    sc.ctx.drawImage(this.noise.cv, 0, 0, sc.cv.width + 24, sc.cv.height + 24);
    sc.ctx.restore();
    sc.ctx.globalCompositeOperation = 'destination-in';
    sc.ctx.drawImage(this.mask.cv, 0, 0);
    sc.ctx.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.globalAlpha = 0.16 + 0.05 * Math.sin(this.t * 2);
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(sc.cv, 0, 0, w, h);
    ctx.restore();

    // subtle grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
    for (let i = 1; i < 6; i++) {
      const gx = (i / 6) * w, gy = (i / 6) * h;
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
    }

    // training points (glowing anchors of certainty)
    for (const p of this.s.trainPoints) {
      const nx = (p.x - this.ax0().min) / (this.ax0().max - this.ax0().min);
      const ny = (p.y - this.ax1().min) / (this.ax1().max - this.ax1().min);
      this._glowDot(this.pxX(nx), this.pxY(ny), 3.0, 'rgba(245,238,224,0.95)', 9);
    }

    // best-so-far marker. a 'window' goal has no single best to ring, so skip it
    // (bestSoFar would just return the global max, which is misleading for a target band).
    const best = this.goal === 'window' ? null : this.s.bestSoFar(this.name, this.goal);
    if (best) {
      const bx = this.pxX((best.x - this.ax0().min) / (this.ax0().max - this.ax0().min));
      const by = this.pxY((best.y - this.ax1().min) / (this.ax1().max - this.ax1().min));
      ctx.save(); ctx.translate(bx, by);
      ctx.strokeStyle = 'rgba(255,176,6,0.95)'; ctx.lineWidth = 1.6;
      const rr = 9 + Math.sin(this.t * 3) * 1.5;
      ctx.beginPath(); ctx.arc(0, 0, rr, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-rr - 4, 0); ctx.lineTo(rr + 4, 0); ctx.moveTo(0, -rr - 4); ctx.lineTo(0, rr + 4); ctx.stroke();
      ctx.restore();
    }

    // pin-drop animations + persisted samples
    for (const p of this.s.samples) {
      const px = this.pxX((p.x - this.ax0().min) / (this.ax0().max - this.ax0().min));
      const py = this.pxY((p.y - this.ax1().min) / (this.ax1().max - this.ax1().min));
      this._pin(px, py, 1, 'rgba(255,180,84,1)');
    }
    for (let i = this._anim.length - 1; i >= 0; i--) {
      const a = this._anim[i]; a.t += 0.045;
      const px = this.pxX((a.x - this.ax0().min) / (this.ax0().max - this.ax0().min));
      const py = this.pxY((a.y - this.ax1().min) / (this.ax1().max - this.ax1().min));
      const e = easeOut(Math.min(1, a.t));
      this._pin(px, py - (1 - e) * 60, e, 'rgba(255,180,84,1)');
      ctx.strokeStyle = `rgba(255,180,84,${(1 - e) * 0.6})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, e * 34, 0, 7); ctx.stroke();
      if (a.t >= 1) { this._anim.splice(i, 1); if (a.after) a.after(); }
    }

    // cursor crosshair + uncertainty halo
    if (this.cursor.on) {
      const cx = this.pxX(this.cursor.nx), cy = this.pxY(this.cursor.ny);
      const { std } = this.s.predict(this.name, this.valX(this.cursor.nx), this.valY(this.cursor.ny));
      const st = this.s.stats(this.name);
      const haloR = 10 + 46 * smoothstep(0, 1, std / (st.smx || 1));
      ctx.save();
      const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, haloR);
      grad.addColorStop(0, 'rgba(255,196,84,0.30)');
      grad.addColorStop(1, 'rgba(255,196,84,0)');
      ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(cx, cy, haloR, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(255,210,120,0.85)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(cx, cy, haloR, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, 4, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx - 12, cy); ctx.lineTo(cx + 12, cy); ctx.moveTo(cx, cy - 12); ctx.lineTo(cx, cy + 12); ctx.stroke();
      ctx.restore();
    }
  }

  _glowDot(x, y, r, color, glow) {
    const ctx = this.ctx;
    ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = glow;
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    ctx.restore();
  }

  _pin(x, y, scale, color) {
    const ctx = this.ctx;
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    ctx.shadowColor = color; ctx.shadowBlur = 14;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(0, 0, 5.5, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.arc(0, 0, 2, 0, 7); ctx.fill();
    ctx.restore();
  }
}

function makeCanvas(w, h) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  return { cv, ctx: cv.getContext('2d') };
}
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function smoothstep(a, b, x) { const t = clamp01((x - a) / (b - a || 1)); return t * t * (3 - 2 * t); }
function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
