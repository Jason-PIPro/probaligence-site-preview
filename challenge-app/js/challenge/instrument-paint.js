// instrument-paint.js, the paint LAB for the "Beat Stochos" challenge.
//
// V3 (CHALLENGE-V3-PLAN.md A5): the score is now genuinely N-dimensional, so
// EVERY input is a live control. The schema has NINE inputs in two `group`s:
// six FORMULATION knobs (TiO2, binder, filler, additive package, thickener,
// water) and three PROCESS knobs (dry film thickness, cure temperature, number
// of coats). ALL of them move the result, so all nine must be tunable, or the
// hidden ones cap the player and the challenge is unwinnable. Controls are split
// by the JSON `group` tag, so the layout stays correct if the schema changes.
//
//   LEFT  panel  = FORMULATION sliders ("the can / the recipe") + a clearly
//                  separate PROCESS section ("Application & cure"): film
//                  thickness + cure temp sliders, number_of_coats as a discrete
//                  1..3 stepper (integer, not a smooth slider).
//   CENTRE bench  = the beaker you MIX. On run() it plays a ~1.2s mixing +
//                   measurement animation (stir vortex, droplets, measure sweep).
//   RIGHT panel  = the result readout: the big canonical SCORE, the key outputs,
//                  and the best-so-far, with the score reveal kept intact.
//
// SCORING: the big score is the canonical score from score.js (scoreOf), the SAME
// function the HUD and showdown use, computed over ALL nine inputs. Displayed
// outputs (contrast, gloss, scrub, viscosity, cost) come from
// surrogate.predictFull(name, params).mean. onAttempt(cb) passes the FULL params
// object (all nine) so challenge.js recomputes the identical score.
//
// HONESTY: every numeric value shown is real DIM-GP / analytic-response surrogate
// output. The beaker drawing (paint fill, stir blade, droplets, measure sweep),
// the "recipe balance" chip, and the coat swatch (film thickness -> opacity,
// coats -> stripe count) are illustrative motion only; the shell adds the global
// "synthetic data / illustrative animation" disclaimer.
//
// Contract: mountInstrument(host, surrogate, opts) -> controller
//   { getState(), run(), onAttempt(cb), reset(), resize(), destroy() }.

import { scoreOf } from './score.js';

const NS = 'pl';                       // scope class prefix
const ACCENT = '#ffb006';
const STYLE_ID = 'instrument-paint-style';

export function mountInstrument(host, surrogate, opts = {}) {
  const accent = opts.accent || ACCENT;
  injectStyle(accent);

  // ---- resolve inputs / outputs from the surrogate (never invent values) ----
  const axisX = surrogate.axisInput(0);   // tio2_pct  (for the illustrative chip)
  const axisY = surrogate.axisInput(1);   // binder_pct
  const out = surrogate.outputs;
  const primary = out.find((o) => o.name === 'contrast_ratio') || out[0];
  const goal = (primary && primary.goal) || 'high';

  // the readouts to reveal: primary + the key trade-off outputs (in schema order)
  const reveal = [
    primary,
    out.find((o) => o.name === 'gloss'),
    out.find((o) => o.name === 'scrub'),
    out.find((o) => o.name === 'viscosity'),
    out.find((o) => o.name === 'cost'),
  ].filter(Boolean);

  // every input starts at its default; ALL of them are live controls below and
  // ALL of them feed predictFull (the N-D score). No held/inert inputs anymore.
  // Group by the JSON `group` tag so the layout stays correct if the schema changes:
  //   FORMULATION = the can / the recipe (wt% sliders)
  //   PROCESS     = application & cure (film thickness, cure temp, coats)
  const formulation = surrogate.inputs.filter((i) => i.group === 'formulation');
  const process = surrogate.inputs.filter((i) => i.group === 'process');
  // any input without a recognised group still gets a control (under formulation),
  // so a hidden input can never silently cap the player.
  const known = new Set([...formulation, ...process]);
  const ungrouped = surrogate.inputs.filter((i) => !known.has(i));
  const formInputs = formulation.length || process.length
    ? [...formulation, ...ungrouped]
    : surrogate.inputs;
  const procInputs = process;
  const params = {};
  for (const i of surrogate.inputs) params[i.name] = i.default;

  // ---- DOM ----
  host.classList.add(`${NS}-root`);
  host.innerHTML = `
    <div class="${NS}-grid">
      <div class="${NS}-panel ${NS}-controls">
        <div class="${NS}-eyebrow">Formulation &middot; the can</div>
        <div class="${NS}-sliders" data-role="sliders"></div>
        <div class="${NS}-section" data-role="process-section" hidden>
          <div class="${NS}-divider"></div>
          <div class="${NS}-eyebrow ${NS}-eyebrow--proc">Process &middot; application &amp; cure</div>
          <div class="${NS}-sliders" data-role="proc-sliders"></div>
        </div>
        <div class="${NS}-formnote">Every knob, recipe and process alike, moves the result. Tune the whole job, then mix.</div>
      </div>

      <div class="${NS}-panel ${NS}-bench">
        <div class="${NS}-eyebrow">Lab bench</div>
        <canvas class="${NS}-canvas" data-role="canvas"></canvas>
        <button class="${NS}-go" data-role="go">
          <span class="${NS}-go-label">Mix &amp; measure</span>
        </button>
      </div>

      <div class="${NS}-panel ${NS}-readout">
        <div class="${NS}-eyebrow">Measured result</div>
        <div class="${NS}-scorewrap">
          <div class="${NS}-score" data-role="score">--</div>
          <div class="${NS}-score-cap">score</div>
          <div class="${NS}-best" data-role="best">best so far --</div>
        </div>
        <div class="${NS}-outs" data-role="outs"></div>
        <div class="${NS}-hint" data-role="hint">Set the recipe and the process, then mix.</div>
      </div>
    </div>
  `;

  const $ = (sel) => host.querySelector(sel);
  const slidersEl = $(`[data-role="sliders"]`);
  const procSlidersEl = $(`[data-role="proc-sliders"]`);
  const procSectionEl = $(`[data-role="process-section"]`);
  const canvas = $(`[data-role="canvas"]`);
  const goBtn = $(`[data-role="go"]`);
  const scoreEl = $(`[data-role="score"]`);
  const bestEl = $(`[data-role="best"]`);
  const outsEl = $(`[data-role="outs"]`);
  const hintEl = $(`[data-role="hint"]`);

  // ---- LEFT: one control for EVERY input (must-fix winnability) -------------
  // FORMULATION group -> wt% sliders ("the can / the recipe").
  for (const inp of formInputs) buildSlider(slidersEl, inp, params, onParam);
  // PROCESS group -> a clearly separate "Application & cure" section.
  // number_of_coats (integer 1..3) renders as a discrete stepper, not a slider.
  if (procInputs.length) {
    procSectionEl.hidden = false;
    for (const inp of procInputs) {
      if (isStepperInput(inp)) buildStepper(procSlidersEl, inp, params, onParam);
      else buildSlider(procSlidersEl, inp, params, onParam);
    }
  }

  // readout rows (one per revealed output)
  const outRows = {};
  for (const o of reveal) {
    const row = document.createElement('div');
    row.className = `${NS}-outrow`;
    row.innerHTML = `
      <span class="${NS}-out-label">${o.label}</span>
      <span class="${NS}-out-val" data-out="${o.name}">--</span>
      <span class="${NS}-out-unit">${o.unit || ''}</span>`;
    outsEl.appendChild(row);
    outRows[o.name] = row.querySelector(`[data-out="${o.name}"]`);
  }

  // ---- state ----
  let lastState = emptyState();
  let bestScore = -1;
  let running = false;
  const cbs = [];

  function emptyState() {
    const outputs = {};
    for (const o of reveal) outputs[o.name] = null;
    return { params: { ...params }, outputs, score: 0 };
  }

  // canonical score, computed via score.js over ALL inputs (matches HUD + showdown).
  function currentScore() {
    const { score } = scoreOf(surrogate, params, primary.name, goal);
    return clamp100(score);
  }

  // illustrative-only: a process input gently tints the swatch coverage so the
  // bench reacts to process tuning too. Flagged in the formnote / shell disclaimer.
  const filmInput = surrogate.inputs.find((i) => i.name === 'film_thickness_um');
  const coatsInput = surrogate.inputs.find((i) => i.name === 'number_of_coats');
  function processVisual() {
    let cover = 0.5;
    if (filmInput) cover = clamp01((params[filmInput.name] - filmInput.min) / (filmInput.max - filmInput.min || 1));
    let coats = 2;
    if (coatsInput) coats = params[coatsInput.name];
    bench.setCoverage(cover, coats);
  }

  function onParam() {
    // live: settle the bench to "ready" and move the illustrative recipe chip.
    bench.setMix(0);
    bench.markTarget(params[axisX.name], params[axisY.name], axisX, axisY);
    processVisual();
  }

  // ---- the animated bench (canvas) ----
  const bench = new Bench(canvas, accent, host);

  // ---- run() : the GO animation, then real outputs ----
  function run() {
    if (running) return Promise.resolve(lastState);
    running = true;
    goBtn.disabled = true;
    goBtn.classList.add(`${NS}-go--busy`);
    hintEl.textContent = 'Mixing and measuring...';
    // reset readouts to a measuring state
    scoreEl.classList.remove(`${NS}-score--in`);
    for (const o of reveal) outRows[o.name].textContent = '...';

    return bench.play(1200).then(() => {
      // compute REAL outputs from the surrogate over ALL inputs (N-D predictFull)
      const outputs = {};
      for (const o of reveal) {
        const { mean } = surrogate.predictFull(o.name, params);
        outputs[o.name] = Number.isFinite(mean) ? mean : 0;
      }
      const score = currentScore();

      // emit the FULL params (all nine inputs) so challenge.js scores identically.
      lastState = { params: { ...params }, outputs, score };

      // reveal
      animateNumber(scoreEl, score, 600, (v) => Math.round(v).toString());
      scoreEl.classList.add(`${NS}-score--in`);
      for (const o of reveal) {
        const el = outRows[o.name];
        const dec = decimalsFor(o);
        animateNumber(el, outputs[o.name], 600, (v) => v.toFixed(dec));
      }
      if (score > bestScore) {
        bestScore = score;
        bestEl.textContent = `best so far ${Math.round(score)}`;
        bestEl.classList.add(`${NS}-best--up`);
        setTimeout(() => bestEl.classList.remove(`${NS}-best--up`), 700);
      }
      hintEl.textContent = 'Contrast is the score. Every knob counts. Goal: as high as it goes.';
      bench.settle(score / 100);

      goBtn.disabled = false;
      goBtn.classList.remove(`${NS}-go--busy`);
      running = false;
      for (const cb of cbs) { try { cb(lastState); } catch (e) { /* noop */ } }
      return lastState;
    });
  }

  goBtn.addEventListener('click', () => run());

  // initial paint: settle the bench + show where we are
  onParam();
  bench.setMix(0);

  // ---- controller ----
  const controller = {
    getState() {
      return lastState.outputs[primary.name] == null
        ? { ...emptyState(), score: currentScore() }
        : lastState;
    },
    run,
    onAttempt(cb) { if (typeof cb === 'function') cbs.push(cb); },
    reset() {
      bestScore = -1;
      lastState = emptyState();
      bestEl.textContent = 'best so far --';
      scoreEl.textContent = '--';
      scoreEl.classList.remove(`${NS}-score--in`);
      for (const o of reveal) outRows[o.name].textContent = '--';
      hintEl.textContent = 'Set the recipe and the process, then mix.';
      bench.setMix(0);
      processVisual();
    },
    resize() { bench.resize(); },
    destroy() {
      bench.destroy();
      host.classList.remove(`${NS}-root`);
      host.innerHTML = '';
    },
  };

  if (typeof opts.onAttempt === 'function') controller.onAttempt(opts.onAttempt);
  return controller;
}

// ---------------------------------------------------------------------------
// Bench: a canvas drawing of a beaker that fills + a stir blade that spins,
// plus a measurement sweep. Illustrative motion only; numbers come from the API.
// All glass / hardware tones are warm neutral (no blue).
// ---------------------------------------------------------------------------
const GLASS = '255,236,205';   // warm off-white for glass strokes (was cold blue)
class Bench {
  constructor(canvas, accent, host) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.accent = accent;
    this.host = host;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.t = 0;
    this.mix = 0;          // 0 idle .. animates to 1 during play, back to fill level
    this.fill = 0.16;      // resting paint level
    this.spin = 0;
    this.stir = 0;         // 0..1 stir intensity (animates during play)
    this.sweep = -1;       // measurement sweep position, -1 = off
    this.target = { nx: 0.5, ny: 0.5 };
    this.coverage = 0.5;   // illustrative: film-thickness coverage 0..1 (opacity of swatch)
    this.coats = 2;        // illustrative: number of coats (1..3) -> swatch stripe count
    this._anim = null;     // active play tween
    this._alive = true;
    this.resize();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  resize() {
    const r = this.cv.getBoundingClientRect();
    this.w = Math.max(2, r.width); this.h = Math.max(2, r.height);
    this.cv.width = Math.round(this.w * this.dpr);
    this.cv.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  markTarget(x, y, ax, ay) {
    const nx = (x - ax.min) / (ax.max - ax.min || 1);
    const ny = (y - ay.min) / (ay.max - ay.min || 1);
    this.target = { nx: clamp01(nx), ny: clamp01(ny) };
    // resting fill scales gently with how "rich" the formulation reads
    this.fill = 0.14 + 0.10 * clamp01((nx + ny) / 2);
  }

  setMix(v) { this.stir = v; this.sweep = -1; }

  // illustrative only: film thickness -> swatch opacity, coats -> swatch stripe count.
  setCoverage(cover, coats) {
    this.coverage = clamp01(Number.isFinite(cover) ? cover : 0.5);
    this.coats = Math.max(1, Math.round(Number.isFinite(coats) ? coats : 2));
  }

  // play the GO animation for ~ms; resolves when the sweep completes OR after a
  // timer (so the run always finishes even if rAF is throttled in a hidden tab).
  play(ms = 1200) {
    return new Promise((resolve) => {
      const start = performance.now();
      let done = false;
      const fin = () => { if (done) return; done = true; this._anim = null; this.sweep = -1; resolve(); };
      this._anim = { start, ms, resolve: fin };
      setTimeout(fin, ms + 80);   // rAF-throttle-proof fallback
    });
  }

  settle(scoreN) {
    // raise the resting fill toward the achieved score for a satisfying "full can"
    this.fill = 0.16 + 0.62 * clamp01(scoreN);
    this.stir = 0;
    this.sweep = -1;
  }

  destroy() { this._alive = false; }

  _loop(ts) {
    if (!this.host.isConnected || !this._alive) return; // stop on disconnect/destroy
    const dt = Math.min(0.05, (ts - (this._last || ts)) / 1000 || 0);
    this._last = ts;
    this.t = ts * 0.001;

    // advance the play tween
    if (this._anim) {
      const p = clamp01((ts - this._anim.start) / this._anim.ms);
      // stir ramps up then the sweep runs across the back half
      this.stir = Math.sin(Math.min(1, p / 0.55) * Math.PI / 2);
      this.fill = 0.16 + 0.5 * easeOut(Math.min(1, p / 0.7));
      this.sweep = p > 0.55 ? (p - 0.55) / 0.45 : -1;
      if (p >= 1) {
        const r = this._anim.resolve; this._anim = null; this.sweep = -1;
        if (r) r();
      }
    }
    this.spin += dt * (3 + this.stir * 22);

    this._draw();
    requestAnimationFrame(this._loop);
  }

  _draw() {
    const ctx = this.ctx, w = this.w, h = this.h;
    if (!Number.isFinite(w) || !Number.isFinite(h)) return;
    ctx.clearRect(0, 0, w, h);

    // soft amber glow behind the beaker
    const cx = w * 0.5, baseY = h * 0.86;
    const bw = Math.min(w * 0.42, h * 0.5), bh = h * 0.62;
    const g = ctx.createRadialGradient(cx, baseY - bh * 0.4, 6, cx, baseY - bh * 0.4, bw * 1.4);
    g.addColorStop(0, hexA(this.accent, 0.10 + 0.05 * this.stir));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

    const left = cx - bw / 2, right = cx + bw / 2, top = baseY - bh;
    const rad = Math.min(16, bw * 0.12);

    // ---- paint inside the beaker (clipped) ----
    ctx.save();
    roundedBeakerPath(ctx, left, top, bw, bh, rad);
    ctx.clip();

    const level = baseY - bh * clamp01(this.fill);
    // paint gradient (amber, a touch hotter when stirring)
    const pg = ctx.createLinearGradient(0, level, 0, baseY);
    pg.addColorStop(0, hexA(this.accent, 0.95));
    pg.addColorStop(1, '#c47c0e');
    ctx.fillStyle = pg;
    // wavy surface
    ctx.beginPath();
    ctx.moveTo(left, baseY);
    ctx.lineTo(left, level);
    const amp = 3 + this.stir * 7;
    for (let x = left; x <= right; x += 6) {
      const yy = level + Math.sin((x * 0.05) + this.t * 6 + this.spin) * amp * (0.4 + this.stir);
      ctx.lineTo(x, yy);
    }
    ctx.lineTo(right, baseY);
    ctx.closePath();
    ctx.fill();

    // stir vortex highlight
    if (this.stir > 0.05) {
      ctx.globalAlpha = 0.18 * this.stir;
      ctx.strokeStyle = '#ffe29e';
      ctx.lineWidth = 2;
      for (let k = 0; k < 3; k++) {
        const rr = (bw * 0.12) + k * (bw * 0.1);
        ctx.beginPath();
        ctx.ellipse(cx, level + bh * 0.16, rr, rr * 0.32, this.spin * 0.4, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // droplets thrown up while stirring
      for (let k = 0; k < 5; k++) {
        const ph = (this.t * 2 + k * 1.3) % 1;
        const dx = cx + Math.sin(k * 2 + this.spin) * bw * 0.28;
        const dy = level - ph * 40 * this.stir;
        ctx.fillStyle = hexA('#ffe29e', (1 - ph) * 0.7 * this.stir);
        ctx.beginPath(); ctx.arc(dx, dy, 2.4, 0, 7); ctx.fill();
      }
    }
    ctx.restore();

    // ---- beaker glass outline + spec highlight (warm neutral, no blue) ----
    roundedBeakerPath(ctx, left, top, bw, bh, rad);
    ctx.strokeStyle = `rgba(${GLASS},0.50)`;
    ctx.lineWidth = 2;
    ctx.stroke();
    // graduation ticks
    ctx.strokeStyle = `rgba(${GLASS},0.20)`;
    ctx.lineWidth = 1;
    for (let m = 1; m <= 4; m++) {
      const ty = baseY - (bh * 0.84) * (m / 5);
      ctx.beginPath(); ctx.moveTo(right - bw * 0.18, ty); ctx.lineTo(right - bw * 0.04, ty); ctx.stroke();
    }
    // glass highlight streak
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(left + bw * 0.2, top + 10); ctx.lineTo(left + bw * 0.2, baseY - 12); ctx.stroke();

    // ---- stir rod + blade (warm neutral) ----
    const rodX = cx;
    ctx.strokeStyle = `rgba(${GLASS},0.65)`; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(rodX, top - 18); ctx.lineTo(rodX, level + bh * 0.16); ctx.stroke();
    ctx.save();
    ctx.translate(rodX, level + bh * 0.16);
    const bladeW = bw * 0.22;
    ctx.rotate(this.spin);
    ctx.strokeStyle = `rgba(${GLASS},0.85)`; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-bladeW, 0); ctx.lineTo(bladeW, 0); ctx.stroke();
    // perspective tilt so it reads as 3D
    ctx.scale(1, 0.34);
    ctx.beginPath(); ctx.arc(0, 0, bladeW, 0, 7); ctx.strokeStyle = `rgba(${GLASS},0.28)`; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();

    // ---- measurement sweep (the "measure" beam) ----
    if (this.sweep >= 0) {
      const sy = top + (baseY - top) * this.sweep;
      const lg = ctx.createLinearGradient(left, sy, right, sy);
      lg.addColorStop(0, 'rgba(0,0,0,0)');
      lg.addColorStop(0.5, hexA('#ffe29e', 0.85));
      lg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.strokeStyle = lg; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(left - 8, sy); ctx.lineTo(right + 8, sy); ctx.stroke();
      ctx.fillStyle = hexA('#ffe29e', 0.10);
      ctx.fillRect(left, sy - 6, bw, 12);
    }

    // ---- recipe balance chip (illustrative: where TiO2/binder sit) ----
    const pad = 14, plotW = Math.min(86, w * 0.2), plotH = plotW;
    const px0 = w - plotW - pad, py0 = pad;
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    roundRect(ctx, px0, py0, plotW, plotH, 8); ctx.fill(); ctx.stroke();
    const mx = px0 + 8 + (plotW - 16) * this.target.nx;
    const my = py0 + 8 + (plotH - 16) * (1 - this.target.ny);
    ctx.fillStyle = this.accent;
    ctx.shadowColor = this.accent; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(mx, my, 3.6, 0, 7); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '9px ui-monospace, monospace';
    ctx.fillText('recipe', px0 + 6, py0 + plotH + 12);

    // ---- coat swatch (illustrative: film thickness -> opacity, coats -> stripes) ----
    const swW = plotW, swH = Math.min(34, h * 0.09);
    const sx0 = px0, sy0 = py0 + plotH + 22;
    // substrate (so coverage reads as "how well it hides")
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    roundRect(ctx, sx0, sy0, swW, swH, 6); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    for (let s = 0; s < 4; s++) {
      ctx.fillRect(sx0 + s * (swW / 4), sy0, swW / 8, swH);
    }
    // painted coats: each coat adds opacity, capped; more coats -> more even hide
    ctx.save();
    roundRect(ctx, sx0, sy0, swW, swH, 6); ctx.clip();
    const perCoat = (0.22 + 0.5 * this.coverage);
    for (let c = 0; c < this.coats; c++) {
      ctx.fillStyle = hexA(this.accent, Math.min(0.92, perCoat));
      ctx.fillRect(sx0, sy0, swW, swH);
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
    roundRect(ctx, sx0, sy0, swW, swH, 6); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '9px ui-monospace, monospace';
    ctx.fillText(`${this.coats} coat${this.coats > 1 ? 's' : ''}`, sx0 + 6, sy0 + swH + 12);
  }
}

// ---------------------------------------------------------------------------
// DOM builders
// ---------------------------------------------------------------------------
// An input is rendered as a discrete stepper when it is small-integer valued
// (e.g. number_of_coats, 1..3): integer bounds and a span of <= 5 steps.
function isStepperInput(input) {
  if (input.name === 'number_of_coats') return true;
  const span = input.max - input.min;
  return Number.isInteger(input.min) && Number.isInteger(input.max) && span > 0 && span <= 5;
}

// a -/value/+ stepper for small integer inputs (no smooth slider).
function buildStepper(parent, input, params, onChange) {
  const wrap = document.createElement('div');
  wrap.className = `${NS}-slider ${NS}-stepper`;
  const min = input.min, max = input.max;
  wrap.innerHTML = `
    <span class="${NS}-s-top">
      <span class="${NS}-s-label">${input.label}</span>
      <span class="${NS}-s-val"><b data-v></b> <i>${input.unit || ''}</i></span>
    </span>
    <div class="${NS}-step-row">
      <button type="button" class="${NS}-step-btn" data-step="-1" aria-label="decrease">&minus;</button>
      <div class="${NS}-step-track" data-track></div>
      <button type="button" class="${NS}-step-btn" data-step="1" aria-label="increase">+</button>
    </div>
  `;
  const valEl = wrap.querySelector('[data-v]');
  const trackEl = wrap.querySelector('[data-track]');
  const minus = wrap.querySelector('[data-step="-1"]');
  const plus = wrap.querySelector('[data-step="1"]');

  // discrete pips, one per integer value, the active one lit
  const pips = [];
  for (let v = min; v <= max; v++) {
    const pip = document.createElement('span');
    pip.className = `${NS}-pip`;
    pip.dataset.val = String(v);
    trackEl.appendChild(pip);
    pips.push(pip);
  }
  function render() {
    const v = params[input.name];
    valEl.textContent = String(Math.round(v));
    for (const p of pips) p.classList.toggle(`${NS}-pip--on`, +p.dataset.val <= v);
    minus.disabled = v <= min;
    plus.disabled = v >= max;
  }
  function bump(delta) {
    const next = Math.max(min, Math.min(max, Math.round(params[input.name]) + delta));
    if (next === params[input.name]) return;
    params[input.name] = next;
    render();
    onChange();
  }
  minus.addEventListener('click', () => bump(-1));
  plus.addEventListener('click', () => bump(1));
  for (const pip of pips) pip.addEventListener('click', () => {
    params[input.name] = +pip.dataset.val; render(); onChange();
  });
  params[input.name] = Math.round(params[input.name]);
  render();
  parent.appendChild(wrap);
}

function buildSlider(parent, input, params, onChange) {
  const wrap = document.createElement('label');
  wrap.className = `${NS}-slider`;
  const dec = stepDecimals(input);
  wrap.innerHTML = `
    <span class="${NS}-s-top">
      <span class="${NS}-s-label">${input.label}</span>
      <span class="${NS}-s-val"><b data-v></b> <i>${input.unit || ''}</i></span>
    </span>
    <input type="range" min="${input.min}" max="${input.max}" step="${stepOf(input)}" value="${params[input.name]}">
  `;
  const range = wrap.querySelector('input');
  const valEl = wrap.querySelector('[data-v]');
  valEl.textContent = (+params[input.name]).toFixed(dec);
  range.addEventListener('input', () => {
    params[input.name] = +range.value;
    valEl.textContent = (+range.value).toFixed(dec);
    onChange();
  });
  parent.appendChild(wrap);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function clamp100(v) { return Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0)); }
function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
function hexA(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
function stepOf(input) {
  const span = input.max - input.min;
  if (span <= 2) return 0.01;
  if (span <= 4) return 0.05;
  if (span <= 20) return 0.1;
  return 0.5;
}
function stepDecimals(input) { const s = stepOf(input); return s < 0.05 ? 2 : s < 0.1 ? 2 : s < 1 ? 1 : 0; }
function decimalsFor(o) {
  if (o.unit === '%' || o.unit === 'GU') return 1;
  if (o.unit === '€/kg' || o.unit === 'rel') return 2;
  if (o.unit === 'cycles' || o.unit === 'mPa·s') return 0;
  return 1;
}
function animateNumber(el, to, ms, fmt) {
  const from = parseFloat((el.textContent || '0').replace(/[^0-9.-]/g, '')) || 0;
  const start = performance.now();
  function step(ts) {
    const p = clamp01((ts - start) / ms);
    const e = easeOut(p);
    el.textContent = fmt(from + (to - from) * e);
    if (p < 1 && el.isConnected) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function roundedBeakerPath(ctx, left, top, bw, bh, rad) {
  // a beaker: straight sides, rounded bottom, slightly flared lip
  const baseY = top + bh, right = left + bw;
  ctx.beginPath();
  ctx.moveTo(left - 3, top);
  ctx.lineTo(left, top + 6);
  ctx.lineTo(left, baseY - rad);
  ctx.arcTo(left, baseY, left + rad, baseY, rad);
  ctx.lineTo(right - rad, baseY);
  ctx.arcTo(right, baseY, right, baseY - rad, rad);
  ctx.lineTo(right, top + 6);
  ctx.lineTo(right + 3, top);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// scoped style (BLACK + warm amber only; no blue)
// ---------------------------------------------------------------------------
function injectStyle(accent) {
  if (document.getElementById(STYLE_ID)) return;
  const css = `
.${NS}-root { color:#f5f5f7; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif; }
.${NS}-grid { display:grid; grid-template-columns: minmax(240px,1fr) minmax(300px,1.4fr) minmax(220px,1fr); gap:14px; align-items:stretch; }
@media (max-width: 860px){ .${NS}-grid{ grid-template-columns:1fr; } }
.${NS}-panel { background:#0c0c0e; border:1px solid rgba(255,255,255,0.10); border-radius:16px; padding:16px; display:flex; flex-direction:column; min-width:0; }
.${NS}-eyebrow { font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:#9a9a92; margin-bottom:12px; }
.${NS}-sliders { display:flex; flex-direction:column; gap:13px; }
.${NS}-slider { display:flex; flex-direction:column; gap:6px; }
.${NS}-s-top { display:flex; justify-content:space-between; align-items:baseline; font-size:13px; }
.${NS}-s-label { color:#f5f5f7; }
.${NS}-s-val { font-family:ui-monospace,"SF Mono",Consolas,monospace; color:${accent}; }
.${NS}-s-val i { color:#8a8a82; font-style:normal; font-size:11px; }
.${NS}-root input[type=range]{ -webkit-appearance:none; appearance:none; width:100%; height:4px; border-radius:3px; background:rgba(255,255,255,0.13); outline:none; }
.${NS}-root input[type=range]::-webkit-slider-thumb{ -webkit-appearance:none; width:16px; height:16px; border-radius:50%; background:${accent}; cursor:pointer; box-shadow:0 0 0 4px ${hexA(accent,0.18)}; }
.${NS}-root input[type=range]::-moz-range-thumb{ width:16px; height:16px; border:none; border-radius:50%; background:${accent}; cursor:pointer; }
.${NS}-section[hidden]{ display:none; }
.${NS}-divider { height:1px; background:linear-gradient(90deg, rgba(255,255,255,0.02), rgba(255,255,255,0.14), rgba(255,255,255,0.02)); margin:16px 0 13px; }
.${NS}-eyebrow--proc { color:${accent}; margin-bottom:13px; }
/* discrete integer stepper (e.g. number of coats) */
.${NS}-step-row { display:flex; align-items:center; gap:10px; }
.${NS}-step-btn { appearance:none; cursor:pointer; width:30px; height:30px; flex:0 0 auto; border-radius:8px; border:1px solid rgba(255,255,255,0.16); background:rgba(255,255,255,0.04); color:#f5f5f7; font-size:18px; line-height:1; display:flex; align-items:center; justify-content:center; transition:background .15s ease, border-color .15s ease, transform .1s ease; }
.${NS}-step-btn:hover:not(:disabled){ background:${hexA(accent,0.16)}; border-color:${hexA(accent,0.5)}; }
.${NS}-step-btn:active:not(:disabled){ transform:translateY(1px); }
.${NS}-step-btn:disabled{ opacity:.35; cursor:default; }
.${NS}-step-track { display:flex; gap:7px; flex:1; align-items:center; justify-content:center; }
.${NS}-pip { width:100%; max-width:46px; height:7px; border-radius:4px; background:rgba(255,255,255,0.10); cursor:pointer; transition:background .15s ease, box-shadow .15s ease; }
.${NS}-pip--on { background:${accent}; box-shadow:0 0 0 3px ${hexA(accent,0.16)}; }
.${NS}-formnote { margin-top:14px; padding-top:13px; border-top:1px solid rgba(255,255,255,0.07); font-size:11px; color:#8a8a82; line-height:1.5; }
.${NS}-bench { position:relative; }
.${NS}-canvas { width:100%; flex:1; min-height:240px; display:block; }
.${NS}-go { margin-top:12px; appearance:none; border:none; cursor:pointer; border-radius:999px; padding:13px 20px; font-size:14px; font-weight:650; letter-spacing:.01em; color:#1a1205; background:linear-gradient(180deg, #ffc23a, ${accent}); box-shadow:0 8px 24px ${hexA(accent,0.28)}; transition:transform .12s ease, box-shadow .2s ease, filter .2s ease; }
.${NS}-go:hover{ filter:brightness(1.06); transform:translateY(-1px); }
.${NS}-go:active{ transform:translateY(1px); }
.${NS}-go:disabled{ cursor:default; filter:grayscale(.3) brightness(.85); }
.${NS}-go--busy{ animation:${NS}-pulse 1.2s ease-in-out infinite; }
@keyframes ${NS}-pulse{ 0%,100%{ box-shadow:0 8px 24px ${hexA(accent,0.28)};} 50%{ box-shadow:0 8px 34px ${hexA(accent,0.55)};} }
.${NS}-readout { gap:0; }
.${NS}-scorewrap { display:flex; flex-direction:column; align-items:center; padding:6px 0 14px; border-bottom:1px solid rgba(255,255,255,0.07); margin-bottom:12px; position:relative; }
.${NS}-score { font-family:ui-monospace,monospace; font-size:58px; line-height:1; font-weight:700; color:#3a3a36; transition:color .3s ease; }
.${NS}-score--in { color:${accent}; text-shadow:0 0 24px ${hexA(accent,0.45)}; }
.${NS}-score-cap { font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:#9a9a92; margin-top:4px; }
.${NS}-best { font-size:11px; color:#b0b0a8; margin-top:8px; font-family:ui-monospace,monospace; }
.${NS}-best--up { color:${accent}; }
.${NS}-outs { display:flex; flex-direction:column; gap:9px; }
.${NS}-outrow { display:grid; grid-template-columns: 1fr auto auto; align-items:baseline; gap:6px; font-size:13px; }
.${NS}-out-label { color:#b0b0a8; }
.${NS}-out-val { font-family:ui-monospace,monospace; font-size:17px; color:#f5f5f7; text-align:right; }
.${NS}-out-unit { color:#8a8a82; font-size:11px; }
.${NS}-hint { margin-top:auto; padding-top:14px; font-size:11px; color:#8a8a82; line-height:1.5; }
`;
  const tag = document.createElement('style');
  tag.id = STYLE_ID;
  tag.textContent = css;
  document.head.appendChild(tag);
}
