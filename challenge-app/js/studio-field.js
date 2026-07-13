// StudioField, the staged Confidence Field renderer for the "Stochos Flow Web"
// guided builder. A controllable evolution of ConfidenceField (field.js): same
// bake/draw/fog/halo/pin grammar, but gated by a stage and driven entirely from
// the Surrogate. Everything drawn here is real DIM-GP output; nothing illustrative.
//
// Independent of ConfidenceField on purpose (the approved paint demo must stay
// untouched). Logic is copied/adapted, not imported.

import { CMAP_VALUE, CMAP_HEAT } from './colormap.js';

const STAGES = ['empty', 'data', 'field', 'validate', 'objective', 'optimize'];
// what each stage unlocks (cumulative, in order)
function stageRank(stage) { const i = STAGES.indexOf(stage); return i < 0 ? 0 : i; }

export class StudioField {
  // host: a DOM element we fill with our own <canvas> + acquisition inset.
  // surrogate: a Surrogate instance. opts: { colormap?: 'value'|'heat', axisLabels? }
  constructor(host, surrogate, opts = {}) {
    this.host = host;
    this.s = surrogate;
    this.opts = opts;
    this.cmap = opts.colormap === 'heat' ? CMAP_HEAT : CMAP_VALUE;

    this.name = surrogate.outputs[0].name;
    this.goal = surrogate.outputs[0].goal || 'high';
    this.kappa = 1.4;
    this.z = 1.96;              // current CI z (90/95/99 -> 1.645/1.96/2.576)
    this.stage = 'empty';

    this.budgetN = 0;          // how many real points are "shown" (0 = all)
    this._budgetCount = 0;     // number of surrogate.samples that are budget anchors
    this._acqHistory = [];     // {x,y,mean,std,conf} dropped by step()
    this._acqPeaks = [];       // peak acq height per iteration (for the shrink cue)

    this.cursor = { nx: 0.5, ny: 0.5, on: false };
    this.dirty = true;
    this.t = 0;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this._anim = [];           // transient pin-drop animations
    this._alive = true;

    // AUDIT FIX 2: prefers-reduced-motion. When true, _loop() parks itself: no
    // continuous noise drift, no best-marker pulse, no per-frame redraw. State
    // changes (the public setters, step(), pointer moves) still repaint a single
    // static frame via _markDirty() / direct _renderStatic() calls, so nothing
    // shown ever goes stale -- only the CONTINUOUS motion stops.
    this._reducedMotion = false;
    this._mq = (typeof window.matchMedia === 'function') ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    if (this._mq) this._reducedMotion = this._mq.matches;

    // AUDIT FIX 8 (perf): visibility gates for the rAF loop. _ioVisible tracks
    // whether the canvas is actually in the viewport (IntersectionObserver, feature
    // -detected below); _extVisible is the host's own explicit hint via setVisible()
    // (studio.js calls it when its collapsible "DIM-GP Surface" viewer collapses,
    // since a collapsed panel does not reliably report a zero intersection rect
    // across every CSS collapse technique). Either being false parks the loop.
    this._ioVisible = true;
    this._extVisible = true;
    this._parked = false;

    // ---- DOM: a layered host (field canvas + acquisition inset canvas) ----
    // host gets position:relative so children can absolutely overlay.
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'studio-field-canvas';
    Object.assign(this.canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' });
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    // acquisition companion: a small inset pinned bottom-left, hidden until 'optimize'
    this.acq = document.createElement('canvas');
    this.acq.className = 'studio-field-acq';
    Object.assign(this.acq.style, {
      position: 'absolute', left: '12px', bottom: '12px',
      width: '38%', height: '24%', minWidth: '180px', minHeight: '92px',
      display: 'none', borderRadius: '8px',
      background: 'rgba(7,7,7,0.78)', border: '1px solid rgba(255,176,6,0.28)',
      boxShadow: '0 6px 20px rgba(0,0,0,0.45)', pointerEvents: 'none',
    });
    host.appendChild(this.acq);
    this.acqCtx = this.acq.getContext('2d');

    // offscreen bake buffers (grid resolution)
    const nx = surrogate.grid.x.length, ny = surrogate.grid.y.length;
    this.lo = makeCanvas(nx, ny);       // base color (value blended with fog)
    this.mask = makeCanvas(nx, ny);     // fog alpha (grayscale, alpha = fog)
    this.noise = makeCanvas(72, 72);
    this.scratch = makeCanvas(nx, ny);

    this._resize();
    // self-removing: if the canvas has left the DOM (studio navigated away without
    // an explicit destroy), drop the listener instead of resizing a dead field.
    this._onResize = () => {
      if (!this.canvas.isConnected) { window.removeEventListener('resize', this._onResize); return; }
      this.resize();
    };
    window.addEventListener('resize', this._onResize);
    this._bindPointer();

    // AUDIT FIX 8: observe the canvas so the loop can park itself while scrolled
    // out of view. Guarded: IntersectionObserver is broadly supported, but degrade
    // to always-visible (the pre-fix behavior) if it is ever missing.
    this._io = null;
    if (typeof IntersectionObserver === 'function') {
      this._io = new IntersectionObserver((entries) => {
        const hit = entries[entries.length - 1];
        this._ioVisible = !!(hit && hit.isIntersecting);
        if (this._ioVisible) this._wake();
      }, { threshold: 0 });
      this._io.observe(this.canvas);
    }

    // AUDIT FIX 2: react to a LIVE OS-level reduced-motion toggle, not just its
    // value at construction time.
    this._onMotionChange = (e) => {
      this._reducedMotion = e.matches;
      if (this._reducedMotion) this._renderStatic();
      else this._wake();
    };
    if (this._mq) {
      if (this._mq.addEventListener) this._mq.addEventListener('change', this._onMotionChange);
      else if (this._mq.addListener) this._mq.addListener(this._onMotionChange); // older Safari
    }

    // Preallocated noise buffer - reused every frame to avoid ~20 KB/s heap churn.
    this._noiseBuf = new Uint8ClampedArray(72 * 72 * 4);
    this._noiseFrame = 0; // frame counter for throttling noise regen

    this._loop = this._loop.bind(this);
    this._genNoise();
    // draw a sensible default immediately so headless screenshots have content
    this._bake();
    this._draw();
    requestAnimationFrame(this._loop);
  }

  // ============================ public API ============================

  setStage(stage) {
    if (STAGES.indexOf(stage) < 0) return;
    this.stage = stage;
    const showAcq = stage === 'optimize';
    this.acq.style.display = showAcq ? 'block' : 'none';
    // the inset has no layout while display:none, so its canvas buffer was sized to
    // ~0; once shown, re-measure on the next frame so f_acq(x) draws at real size.
    // That single deferred frame is a one-off layout correction, not a continuous
    // animation, so it runs even under reduced motion; it just also has to repaint
    // itself (AUDIT FIX 2) since the loop may be parked and won't do it for us.
    if (showAcq) requestAnimationFrame(() => { this._resize(); if (this._reducedMotion && this._isVisible()) this._renderStatic(); });
    this._markDirty();
  }

  setOutput(name) {
    if (!this.s.fields[name]) return;
    this.name = name;
    const o = this.s.outputs.find((q) => q.name === name);
    if (o && o.goal) this.goal = o.goal;
    this._markDirty();
  }

  // show n real training points (n<=0 = all). Drives the fog honestly: register
  // the shown subset as virtual samples so the surrogate's variance-shrink tightens
  // fog around shown data and leaves gaps foggy. Acquisition pins are preserved.
  setBudget(n) {
    this.budgetN = n | 0;
    const shown = this._budgetSubset(this.budgetN);
    // rebuild surrogate.samples: budget anchors first, then keep acquisition picks
    const acqSamples = this.s.samples.slice(this._budgetCount);
    this.s.reset();
    for (const p of shown) this.s.addSample(p.x, p.y);
    this._budgetCount = shown.length;
    for (const a of acqSamples) this.s.addSample(a.x, a.y);
    this._markDirty();
  }

  setCI(z) {
    this.z = +z || 1.96;
    this._markDirty(); // fog intensity / band scale with z
  }

  setGoal(goal) {
    this.goal = goal;
    this._markDirty();
  }

  setStrategy(kappa) {
    this.kappa = +kappa;
  }

  // AUDIT FIX 8 (perf): explicit visibility hint from the host (e.g. studio.js's
  // collapsible "DIM-GP Surface" viewer). false pauses the loop the same way
  // scrolling the canvas out of view does; true wakes it and repaints immediately.
  // Kept minimal on purpose: one boolean in, no other API surface.
  setVisible(visible) {
    this._extVisible = !!visible;
    if (this._extVisible) this._wake();
  }

  // run ONE acquisition iteration: pick next, drop a pin, shrink local fog.
  step() {
    const acqGoal = this.goal === 'window' ? 'explore' : this.goal;
    const p = this.s.nextSample(this.name, acqGoal, this.kappa);
    if (!p) return null;
    // record the acquisition peak height (for the shrinking-peak cue) BEFORE addSample
    this._acqPeaks.push(this._acqPeakHeight(acqGoal));
    this.s.addSample(p.x, p.y); // shrink local fog at the chosen location
    const rec = { x: p.x, y: p.y, mean: p.mean, std: p.std, conf: this.confAt(p.x, p.y) };
    this._acqHistory.push(rec);
    // AUDIT FIX 2: the pin-drop flourish is a continuous per-frame animation (eased
    // rise + fading ring over ~1s); under reduced motion, skip it entirely and let
    // the persisted-samples draw in _draw() show the settled pin immediately, still
    // fully visible, just without the motion.
    if (!this._reducedMotion) this._anim.push({ x: p.x, y: p.y, t: 0 }); // animate the pin drop
    this._markDirty();
    return rec;
  }

  // clear acquisition samples back to the budget set, refresh
  reset() {
    this._acqHistory = [];
    this._acqPeaks = [];
    this._anim = [];
    // drop everything past the budget anchors
    this.s.samples.length = this._budgetCount;
    this._markDirty();
  }

  resize() { this._resize(); this._markDirty(); }

  destroy() {
    this._alive = false;
    window.removeEventListener('resize', this._onResize);
    if (this._io) { this._io.disconnect(); this._io = null; }  // AUDIT FIX 8
    if (this._mq) {  // AUDIT FIX 2
      if (this._mq.removeEventListener) this._mq.removeEventListener('change', this._onMotionChange);
      else if (this._mq.removeListener) this._mq.removeListener(this._onMotionChange);
      this._mq = null;
    }
    if (this._pointerEl) {
      this._pointerEl.removeEventListener('pointermove', this._setCursor);
      this._pointerEl.removeEventListener('pointerdown', this._setCursor);
      this._pointerEl.removeEventListener('pointerleave', this._leaveCursor);
    }
    if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    if (this.acq && this.acq.parentNode) this.acq.parentNode.removeChild(this.acq);
  }

  // conf% = 100*(1 - z*std/|mean|), the authentic Stochos metric. Clamp [0,100].
  confAt(x, y) {
    const { mean, std } = this.s.predict(this.name, x, y);
    const denom = Math.abs(mean) || 1e-9;
    const c = 100 * (1 - (this.z * std) / denom);
    return Math.max(0, Math.min(100, c));
  }

  // best-so-far for current output + goal, with its conf
  bestReadout() {
    const b = this._bestPoint();
    if (!b) return null;
    return { x: b.x, y: b.y, mean: b.mean, conf: this.confAt(b.x, b.y) };
  }

  // ============================ internals ============================

  // AUDIT FIXES 2 + 8: is the loop allowed to run continuously right now? Both the
  // viewport-intersection signal and the host's explicit setVisible() hint must be
  // true; reduced-motion is checked separately (it parks the loop but is not a
  // "not visible" state -- state changes still repaint via _markDirty()).
  _isVisible() { return this._ioVisible && this._extVisible; }

  // route every "something changed, please repaint" call through here instead of
  // setting `this.dirty = true` directly: when the continuous loop is parked
  // (reduced motion, or not visible), nothing else will ever notice the flag, so
  // this also paints one static frame immediately if the loop is parked and
  // visible (reduced-motion case). If not visible, dirty stays true and _wake()
  // (setVisible(true) / back in viewport) picks it up on the next paint.
  _markDirty() {
    this.dirty = true;
    if (this._reducedMotion && this._isVisible()) this._renderStatic();
  }

  // paint exactly one frame outside the rAF loop: bake if needed, draw, and the
  // acquisition inset if relevant. Used by reduced-motion state changes and by
  // _wake() so a resumed/re-shown field is never a stale frame while it waits for
  // the next requestAnimationFrame tick.
  _renderStatic() {
    if (!this.canvas.isConnected || !this._alive) return;
    if (this.dirty) this._bake();
    this._draw();
    if (this.stage === 'optimize') this._drawAcq();
  }

  // resume the parked loop (AUDIT FIX 8: called by the IntersectionObserver
  // callback and setVisible(true); AUDIT FIX 2: called when reduced-motion is
  // turned back off). Always repaints immediately so there is no visible stale
  // frame while waiting on the next rAF tick. Only actually clears _parked and
  // resumes the continuous rAF loop if reduced motion is NOT active -- otherwise
  // this would wrongly mark the loop "not parked" while reduced motion still
  // means no continuous frame will ever be scheduled again (a real bug: a later
  // motion-re-enabled _wake() would then see _parked=false and never resume it).
  _wake() {
    if (!this._alive || !this.canvas.isConnected) return;
    if (!this._isVisible()) return; // still hidden by the other visibility gate
    this._renderStatic();
    if (this._reducedMotion) return; // stays parked; state-driven repaints only
    if (this._parked) {
      this._parked = false;
      requestAnimationFrame(this._loop);
    }
  }

  // pick best-so-far honoring 'high'|'low'|'window'. surrogate.bestSoFar only knows
  // low vs else, so window is handled here (closest to the mid of the value range).
  _bestPoint() {
    if (this.goal !== 'window') return this.s.bestSoFar(this.name, this.goal);
    const st = this.s.stats(this.name);
    const target = (st.mn + st.mx) / 2;
    const gx = this.s.grid.x, gy = this.s.grid.y, f = this.s.fields[this.name].mean;
    let best = null;
    for (let j = 0; j < gy.length; j++)
      for (let i = 0; i < gx.length; i++) {
        const m = f[j][i], v = -Math.abs(m - target);
        if (!best || v > best.v) best = { x: gx[i], y: gy[j], mean: m, v };
      }
    return best;
  }

  // deterministic spread subset of train points: every k-th so anchors are stable
  // and spatially spread (leaves honest gaps foggy). n<=0 -> all.
  _budgetSubset(n) {
    const tp = this.s.trainPoints;
    if (!n || n <= 0 || n >= tp.length) return tp.map((p) => ({ x: p.x, y: p.y }));
    const out = [];
    const step = tp.length / n;
    for (let k = 0; k < n; k++) out.push({ x: tp[Math.floor(k * step)].x, y: tp[Math.floor(k * step)].y });
    return out;
  }

  // peak height of the (normalized) UCB acquisition over the grid, for the shrink cue
  _acqPeakHeight(goal) {
    const gx = this.s.grid.x, gy = this.s.grid.y;
    let peak = 0;
    for (let j = 1; j < gy.length - 1; j += 2)
      for (let i = 1; i < gx.length - 1; i += 2) {
        const v = this._acqValue(gx[i], gy[j], goal);
        if (v > peak) peak = v;
      }
    return peak;
  }

  // normalized UCB value at a value-space point: mean_norm* + kappa*std_norm
  _acqValue(x, y, goal) {
    const { mean, std } = this.s.predict(this.name, x, y);
    const mN = this.s.norm(this.name, mean);
    const sN = Math.max(0, std / (this.s.stats(this.name).smx || 1));
    const exploit = goal === 'low' ? 1 - mN : goal === 'explore' ? 0 : mN;
    return exploit + this.kappa * sN;
  }

  ax0() { return this.s.axisInput(0); }
  ax1() { return this.s.axisInput(1); }
  valX(nx) { const a = this.ax0(); return a.min + nx * (a.max - a.min); }
  valY(ny) { const a = this.ax1(); return a.min + ny * (a.max - a.min); }
  nxOf(x) { const a = this.ax0(); return (x - a.min) / (a.max - a.min || 1); }
  nyOf(y) { const a = this.ax1(); return (y - a.min) / (a.max - a.min || 1); }
  pxX(nx) { return nx * this.w; }
  pxY(ny) { return (1 - ny) * this.h; }

  _resize() {
    // AUDIT FIX 3: re-read devicePixelRatio here (not just once in the constructor)
    // so browser zoom or dragging the window to a different-DPR display re-sharpens
    // the canvas instead of staying pinned to whatever ratio was true at mount time.
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(2, r.width); this.h = Math.max(2, r.height);
    this.canvas.width = this.w * this.dpr; this.canvas.height = this.h * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const ar = this.acq.getBoundingClientRect();
    this.aw = Math.max(2, ar.width); this.ah = Math.max(2, ar.height);
    this.acq.width = this.aw * this.dpr; this.acq.height = this.ah * this.dpr;
    this.acqCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  _bindPointer() {
    this._pointerEl = this.canvas;
    this._setCursor = (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.cursor.nx = clamp01((e.clientX - r.left) / r.width);
      this.cursor.ny = clamp01(1 - (e.clientY - r.top) / r.height);
      this.cursor.on = true;
      // AUDIT FIX 2: the cursor halo is real information (live uncertainty at the
      // hovered point), not decoration, so it must keep following the pointer even
      // with the continuous loop parked; repaint on the actual input event instead.
      if (this._reducedMotion) this._renderStatic();
    };
    this._leaveCursor = () => {
      this.cursor.on = false;
      if (this._reducedMotion) this._renderStatic();
    };
    this.canvas.addEventListener('pointermove', this._setCursor);
    this.canvas.addEventListener('pointerdown', this._setCursor);
    this.canvas.addEventListener('pointerleave', this._leaveCursor);
  }

  // ---- bake base color + fog mask (only when something changed) ----
  // CI z scales fog intensity: 99% reads visibly foggier than 90%.
  _bake() {
    const nx = this.s.grid.x.length, ny = this.s.grid.y.length;
    const st = this.s.stats(this.name);
    const showColor = stageRank(this.stage) >= stageRank('field'); // surface from 'field' on
    const ziz = this.z / 1.96; // CI fog multiplier (1.645->0.84, 1.96->1.0, 2.576->1.31)
    const base = this.lo.ctx.createImageData(nx, ny);
    const mk = this.mask.ctx.createImageData(nx, ny);
    for (let r = 0; r < ny; r++) {
      const j = ny - 1 - r; // screen top = high y
      for (let i = 0; i < nx; i++) {
        const x = this.s.grid.x[i], y = this.s.grid.y[j];
        const { mean, std } = this.s.predict(this.name, x, y);
        let cr, cg, cb;
        if (showColor) {
          const tt = (mean - st.mn) / (st.mx - st.mn || 1);
          [cr, cg, cb] = this.cmap(tt);
        } else {
          // pre-reveal: neutral near-black grid, no value surface yet
          cr = 20; cg = 20; cb = 20;
        }
        let fog = smoothstep(0.12, 0.95, std / (st.smx || 1)) * ziz;
        fog = clamp01(fog);
        // blend toward a warm neutral haze + darken where uncertain
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

  _loop(ts) {
    if (!this.canvas.isConnected || !this._alive) return; // die on unmount / destroy
    if (document.hidden) { requestAnimationFrame(this._loop); return; } // page-visibility guard (cheap: rAF is already throttled to ~0 in background tabs)
    // AUDIT FIX 8 (perf): not visible (scrolled out / collapsed) -> stop scheduling
    // frames entirely instead of polling. _wake() (IntersectionObserver / setVisible)
    // restarts us the instant it is visible again, with an immediate repaint.
    if (!this._isVisible()) { this._parked = true; return; }
    // AUDIT FIX 2: reduced motion -> park here too. Every state change already
    // repaints a static frame on its own via _markDirty()/_renderStatic(), so the
    // continuous loop has nothing left to do.
    if (this._reducedMotion) { this._parked = true; return; }
    this._parked = false;
    this.t = ts * 0.001;
    if (this.dirty) this._bake();
    // Throttle noise regen: every 9th frame (~150 ms at 60 fps). Only regenerate
    // when the fog is actually shown (rank >= 'data'); noise before that is wasted work.
    this._noiseFrame = (this._noiseFrame + 1) | 0;
    if (this._noiseFrame % 9 === 0 && stageRank(this.stage) >= stageRank('data')) this._genNoise();
    this._draw();
    if (this.stage === 'optimize') this._drawAcq();
    requestAnimationFrame(this._loop);
  }

  _draw() {
    const ctx = this.ctx, w = this.w, h = this.h;
    const rank = stageRank(this.stage);
    ctx.clearRect(0, 0, w, h);

    // base color (smooth upscaled), present from 'data' on (neutral pre-reveal)
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.lo.cv, 0, 0, w, h);

    // animated grain only where foggy: noise ∩ mask, screened on (from 'data' on)
    if (rank >= stageRank('data')) {
      const sc = this.scratch;
      sc.ctx.clearRect(0, 0, sc.cv.width, sc.cv.height);
      sc.ctx.globalCompositeOperation = 'source-over';
      sc.ctx.save();
      // AUDIT FIX 2: freeze the grain drift + shimmer under reduced motion (a fixed
      // offset/alpha instead of a function of this.t) rather than relying on this.t
      // happening to have stopped advancing -- explicit is correct even if reduced
      // motion is toggled on mid-session after this.t has already accumulated.
      const off = this._reducedMotion ? 0 : (this.t * 14) % 24;
      sc.ctx.translate(-off, off * 0.6);
      sc.ctx.imageSmoothingEnabled = true;
      sc.ctx.drawImage(this.noise.cv, 0, 0, sc.cv.width + 24, sc.cv.height + 24);
      sc.ctx.restore();
      sc.ctx.globalCompositeOperation = 'destination-in';
      sc.ctx.drawImage(this.mask.cv, 0, 0);
      sc.ctx.globalCompositeOperation = 'source-over';
      ctx.save();
      ctx.globalAlpha = this._reducedMotion ? 0.16 : (0.16 + 0.05 * Math.sin(this.t * 2));
      ctx.globalCompositeOperation = 'screen';
      ctx.drawImage(sc.cv, 0, 0, w, h);
      ctx.restore();
    }

    // subtle grid (always, including 'empty')
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
    for (let i = 1; i < 6; i++) {
      const gx = (i / 6) * w, gy = (i / 6) * h;
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
    }

    if (rank === stageRank('empty')) return; // empty = blank grid only

    // training points (glowing anchors). Only the shown/budget subset.
    const shown = this._budgetSubset(this.budgetN);
    for (const p of shown) {
      this._glowDot(this.pxX(this.nxOf(p.x)), this.pxY(this.nyOf(p.y)), 3.0, 'rgba(245,238,224,0.95)', 9);
    }

    // ---- validate: CI band emphasis (a ring whose radius scales with z) ----
    if (rank >= stageRank('validate')) this._drawCIBand();

    // ---- objective: best marker + direction cue ----
    if (rank >= stageRank('objective')) this._drawBest();

    // ---- optimize: persisted acquisition pins + drop animations ----
    if (rank >= stageRank('optimize')) {
      // persisted acquisition samples (those past the budget anchors)
      for (let si = this._budgetCount; si < this.s.samples.length; si++) {
        const p = this.s.samples[si];
        this._pin(this.pxX(this.nxOf(p.x)), this.pxY(this.nyOf(p.y)), 1, 'rgba(255,180,84,1)');
      }
      for (let i = this._anim.length - 1; i >= 0; i--) {
        const a = this._anim[i]; a.t += 0.045;
        const px = this.pxX(this.nxOf(a.x)), py = this.pxY(this.nyOf(a.y));
        const e = easeOut(Math.min(1, a.t));
        this._pin(px, py - (1 - e) * 60, e, 'rgba(255,180,84,1)');
        ctx.strokeStyle = `rgba(255,180,84,${(1 - e) * 0.6})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(px, py, e * 34, 0, 7); ctx.stroke();
        if (a.t >= 1) this._anim.splice(i, 1);
      }
    }

    // cursor crosshair + uncertainty halo (radius scales with live std AND z)
    if (this.cursor.on && rank >= stageRank('data')) this._drawCursor();
  }

  _drawCIBand() {
    const b = this._bestPoint();
    if (!b) return;
    const ctx = this.ctx;
    const { std } = this.s.predict(this.name, b.x, b.y);
    const st = this.s.stats(this.name);
    const bx = this.pxX(this.nxOf(b.x)), by = this.pxY(this.nyOf(b.y));
    // band radius grows with z (90<95<99) and local std
    const rr = (16 + 60 * smoothstep(0, 1, std / (st.smx || 1))) * (this.z / 1.96);
    ctx.save();
    const grad = ctx.createRadialGradient(bx, by, rr * 0.35, bx, by, rr);
    grad.addColorStop(0, 'rgba(255,196,84,0.10)');
    grad.addColorStop(1, 'rgba(255,196,84,0)');
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(bx, by, rr, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,196,84,0.45)'; ctx.setLineDash([5, 5]); ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(bx, by, rr, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();
  }

  _drawBest() {
    const b = this._bestPoint();
    if (!b) return;
    const ctx = this.ctx;
    const bx = this.pxX(this.nxOf(b.x)), by = this.pxY(this.nyOf(b.y));
    ctx.save(); ctx.translate(bx, by);
    ctx.strokeStyle = 'rgba(255,176,6,0.95)'; ctx.lineWidth = 1.6;
    // AUDIT FIX 2: a static marker (no pulse) under reduced motion, explicit rather
    // than relying on a possibly-stale this.t landing on sin()=0.
    const rr = this._reducedMotion ? 9 : 9 + Math.sin(this.t * 3) * 1.5;
    ctx.beginPath(); ctx.arc(0, 0, rr, 0, 7); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-rr - 4, 0); ctx.lineTo(rr + 4, 0);
    ctx.moveTo(0, -rr - 4); ctx.lineTo(0, rr + 4); ctx.stroke();
    // direction cue: arrow up (high), down (low), or a centered ring (window)
    ctx.fillStyle = 'rgba(255,176,6,0.95)';
    if (this.goal === 'high' || this.goal === 'low') {
      const dir = this.goal === 'high' ? -1 : 1;
      const ay = dir * (rr + 14);
      ctx.beginPath();
      ctx.moveTo(0, ay);
      ctx.lineTo(-4.5, ay - dir * 7);
      ctx.lineTo(4.5, ay - dir * 7);
      ctx.closePath(); ctx.fill();
    } else {
      ctx.strokeStyle = 'rgba(255,176,6,0.6)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(0, 0, rr + 7, 0, 7); ctx.stroke();
    }
    ctx.restore();
  }

  _drawCursor() {
    const ctx = this.ctx;
    const cx = this.pxX(this.cursor.nx), cy = this.pxY(this.cursor.ny);
    const { std } = this.s.predict(this.name, this.valX(this.cursor.nx), this.valY(this.cursor.ny));
    const st = this.s.stats(this.name);
    const haloR = (10 + 46 * smoothstep(0, 1, std / (st.smx || 1))) * (this.z / 1.96);
    ctx.save();
    const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, haloR);
    grad.addColorStop(0, 'rgba(255,196,84,0.30)');
    grad.addColorStop(1, 'rgba(255,196,84,0)');
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(cx, cy, haloR, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,210,120,0.85)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(cx, cy, haloR, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, 4, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 12, cy); ctx.lineTo(cx + 12, cy);
    ctx.moveTo(cx, cy - 12); ctx.lineTo(cx, cy + 12); ctx.stroke();
    ctx.restore();
  }

  // ---- acquisition companion: 1D UCB slice through the current best ----
  // amber f_acq(x), vertical dashed marker at the chosen next x, peak shrinks
  // across iterations (the honest "converging" cue).
  _drawAcq() {
    const ctx = this.acqCtx, w = this.aw, h = this.ah;
    ctx.clearRect(0, 0, w, h);
    // frame
    ctx.fillStyle = 'rgba(7,7,7,0.0)'; ctx.fillRect(0, 0, w, h);
    const padL = 8, padR = 8, padT = 16, padB = 12;
    const plotW = w - padL - padR, plotH = h - padT - padB;

    // label
    ctx.fillStyle = 'rgba(244,242,238,0.72)';
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textBaseline = 'top';
    ctx.fillText('acquisition  f_acq(x)', padL, 3);

    // 1D slice along axis-0 (x), holding axis-1 at the current best's y.
    const acqGoal = this.goal === 'window' ? 'explore' : this.goal;
    const b = this._bestPoint();
    const sliceY = b ? b.y : this.valY(0.5);
    const N = 80;
    const xs = [], vs = [];
    let vmax = 1e-9, vmin = Infinity, argmaxNx = 0;
    for (let k = 0; k < N; k++) {
      const nx = k / (N - 1);
      const x = this.valX(nx);
      const v = this._acqValue(x, sliceY, acqGoal);
      xs.push(nx); vs.push(v);
      if (v > vmax) { vmax = v; argmaxNx = nx; }
      if (v < vmin) vmin = v;
    }
    // global peak ceiling: lets the curve shrink visibly as steps accumulate.
    // first recorded peak (or current vmax) anchors the top of the y-axis.
    const ceiling = Math.max(vmax, this._acqPeaks.length ? this._acqPeaks[0] : vmax) || 1;
    const yOf = (v) => padT + plotH * (1 - clamp01(v / ceiling));
    const xOf = (nx) => padL + nx * plotW;

    // baseline
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, padT + plotH); ctx.lineTo(padL + plotW, padT + plotH); ctx.stroke();

    // filled amber curve
    ctx.beginPath();
    ctx.moveTo(xOf(xs[0]), padT + plotH);
    for (let k = 0; k < N; k++) ctx.lineTo(xOf(xs[k]), yOf(vs[k]));
    ctx.lineTo(xOf(xs[N - 1]), padT + plotH);
    ctx.closePath();
    const fillG = ctx.createLinearGradient(0, padT, 0, padT + plotH);
    fillG.addColorStop(0, 'rgba(255,176,6,0.40)');
    fillG.addColorStop(1, 'rgba(255,176,6,0.04)');
    ctx.fillStyle = fillG; ctx.fill();
    // stroke
    ctx.beginPath();
    for (let k = 0; k < N; k++) { const X = xOf(xs[k]), Y = yOf(vs[k]); k ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
    ctx.strokeStyle = 'rgba(255,176,6,0.95)'; ctx.lineWidth = 1.6; ctx.stroke();

    // vertical dashed "next sampling loc." marker at argmax of this slice
    const mx = xOf(argmaxNx);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,210,120,0.9)'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(mx, padT - 2); ctx.lineTo(mx, padT + plotH); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,210,120,1)';
    ctx.beginPath(); ctx.arc(mx, yOf(vmax), 2.6, 0, 7); ctx.fill();
    ctx.restore();

    // iteration count, small
    ctx.fillStyle = 'rgba(244,242,238,0.5)';
    ctx.textAlign = 'right';
    ctx.fillText(`iter ${this._acqHistory.length}`, w - padR, 3);
    ctx.textAlign = 'left';
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
