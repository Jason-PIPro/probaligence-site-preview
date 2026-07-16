// instrument-reactor.js, the chemistry REACTOR for the "Beat Stochos" challenge.
//
// V3 (CHALLENGE-V3-PLAN.md A5, render-engineer A): the score is now genuinely
// N-dimensional, so EVERY input is a live control.
//
//   LEFT  panel  = FORMULATION (the mix you make up): solvent_ratio + concentration,
//                  as plain sliders.
//   CENTRE bench  = the apparatus you OPERATE. The heated, bubbling flask, with the
//                  PROCESS controls placed on the bench and VARIED in control type so
//                  it feels like running an instrument:
//                    - temperature   -> a ROTARY KNOB (drag to turn) -> heat glow
//                    - residence time -> a +/- STEPPER field         -> stir / dwell
//                    - addition rate  -> a horizontal SLIDER         -> bubble intensity
//                    - catalyst load  -> a small ROTARY KNOB         -> reaction vigor
//   RIGHT panel  = the result readout: the big canonical SCORE, the outputs, and the
//                  best-so-far, with the mixing/score reveal animation kept intact.
//
// SCORING: the big score is the canonical score from score.js (scoreOf), the SAME
// function the HUD and showdown use, computed over ALL six inputs. Displayed outputs
// (yield, selectivity, cost) come from surrogate.predictFull(name, params).mean.
// onAttempt(cb) passes the FULL params object so challenge.js recomputes the same score.
//
// HONESTY: every numeric value shown is real DIM-GP / analytic-response surrogate
// output. The flask drawing (heat glow, bubbles, stir, steam) is illustrative motion
// only; the shell adds the global "synthetic data / illustrative animation" disclaimer.
//
// Contract: mountInstrument(host, surrogate, opts) -> controller
//   { getState(), run(), onAttempt(cb), reset(), resize(), destroy() }.

import { scoreOf, constraintCfg } from './score.js';

const NS = 'rx';
const ACCENT = '#ffb006';
const STYLE_ID = 'instrument-reactor-style';

export function mountInstrument(host, surrogate, opts = {}) {
  const accent = opts.accent || ACCENT;
  injectStyle(accent);

  // ---- resolve inputs / outputs (never invent values) ----------------------
  const byName = (n) => surrogate.inputs.find((i) => i.name === n);
  const out = surrogate.outputs;
  const primary = out.find((o) => o.name === 'yield_pct') || out[0];
  const goal = (primary && primary.goal) || 'high';
  const reveal = [
    primary,
    out.find((o) => o.name === 'selectivity'),
    out.find((o) => o.name === 'cost'),
  ].filter(Boolean);

  // V4: spec bands (selectivity's purity floor), keyed by output name, so the
  // readout can mark it in/out of spec. cost is a MINIMIZE term (no band), so it
  // gets no marker below. Empty on a legacy (non-constrained) domain.
  const specCfg = constraintCfg(surrogate);
  const specByOut = {};
  for (const s of (specCfg && specCfg.spec) || []) specByOut[s.out] = s;

  // group inputs: formulation (left) vs process (centre bench).
  const formulation = surrogate.inputs.filter((i) => i.group === 'formulation');
  const process = surrogate.inputs.filter((i) => i.group !== 'formulation');

  // process knobs we drive the flask from (resolved by name, fall back gracefully)
  const tempInput = byName('temperature') || process[0];
  const resInput = byName('res_time');
  const addInput = byName('addition_rate');
  const catInput = byName('catalyst');

  // every input starts at its default; all six are live controls below.
  const params = {};
  for (const i of surrogate.inputs) params[i.name] = i.default;

  // ---- DOM -----------------------------------------------------------------
  host.classList.add(`${NS}-root`);
  host.innerHTML = `
    <div class="${NS}-grid">
      <div class="${NS}-panel ${NS}-formulation">
        <div class="${NS}-eyebrow">Formulation &middot; the mix</div>
        <div class="${NS}-sliders" data-role="formulation"></div>
        <div class="${NS}-formnote">Make up the recipe, then operate the bench.</div>
      </div>

      <div class="${NS}-panel ${NS}-stage">
        <div class="${NS}-eyebrow">Reactor bench &middot; process</div>
        <div class="${NS}-bench">
          <canvas class="${NS}-canvas" data-role="canvas" role="img" aria-label="Animated illustration of the reactor flask heating and reacting"></canvas>
        </div>
        <div class="${NS}-knobs" data-role="knobs"></div>
        <button class="${NS}-go" data-role="go">
          <span class="${NS}-go-label">Run reaction</span>
        </button>
      </div>

      <div class="${NS}-panel ${NS}-readout">
        <div class="${NS}-eyebrow">Result</div>
        <div class="${NS}-scorewrap">
          <div class="${NS}-score" data-role="score">--</div>
          <div class="${NS}-score-cap">score</div>
          <div class="${NS}-best" data-role="best">best so far --</div>
        </div>
        <div class="${NS}-outs" data-role="outs"></div>
        <div class="${NS}-hint" data-role="hint">Set the recipe and the process, then run.</div>
      </div>
    </div>
  `;

  const $ = (sel) => host.querySelector(sel);
  const formEl = $(`[data-role="formulation"]`);
  const knobsEl = $(`[data-role="knobs"]`);
  const canvas = $(`[data-role="canvas"]`);
  const goBtn = $(`[data-role="go"]`);
  const scoreEl = $(`[data-role="score"]`);
  const bestEl = $(`[data-role="best"]`);
  const outsEl = $(`[data-role="outs"]`);
  const hintEl = $(`[data-role="hint"]`);

  // ---- LEFT: formulation sliders -------------------------------------------
  for (const inp of formulation) buildSlider(formEl, inp, params, onParam);

  // ---- CENTRE bench: process controls, varied in type ----------------------
  // temperature -> rotary knob (big), catalyst -> rotary knob (small),
  // residence time -> +/- stepper, addition rate -> slider.
  // both knobs share ONE size so the 2x2 cluster reads even (a smaller catalyst dial
  // pushed its label out of line with the temperature dial's).
  if (tempInput) buildKnob(knobsEl, tempInput, params, onParam, accent, { size: 'lg' });
  if (catInput) buildKnob(knobsEl, catInput, params, onParam, accent, { size: 'lg' });
  if (resInput) buildStepper(knobsEl, resInput, params, onParam);
  if (addInput) buildBenchSlider(knobsEl, addInput, params, onParam);
  // any process input we did not explicitly place gets a bench slider, so all
  // inputs are always exposed even if the data schema changes.
  for (const inp of process) {
    if (inp === tempInput || inp === catInput || inp === resInput || inp === addInput) continue;
    buildBenchSlider(knobsEl, inp, params, onParam);
  }

  // ---- RIGHT: output rows --------------------------------------------------
  // Outputs with a spec band (selectivity) get an extra mark cell that fills in
  // with a tick/warning after each run.
  const outRows = {};
  for (const o of reveal) {
    const band = specByOut[o.name];
    const row = document.createElement('div');
    row.className = `${NS}-outrow`;
    row.innerHTML = `
      <span class="${NS}-out-label">${o.label}</span>
      <span class="${NS}-out-val" data-out="${o.name}">--</span>
      <span class="${NS}-out-unit">${o.unit || ''}</span>
      ${band ? `<span class="${NS}-spec-mark" data-spec-mark="${o.name}" title="in band ${band.lo}-${band.hi}" aria-hidden="true"></span>` : ''}`;
    outsEl.appendChild(row);
    outRows[o.name] = row.querySelector(`[data-out="${o.name}"]`);
  }

  // ---- state ---------------------------------------------------------------
  let lastState = emptyState();
  let bestScore = -1;
  let running = false;
  const cbs = [];

  function emptyState() {
    const outputs = {};
    for (const o of reveal) outputs[o.name] = null;
    return { params: { ...params }, outputs, score: 0 };
  }

  // canonical score, computed via score.js (matches HUD + showdown exactly).
  function currentScore() {
    const { score } = scoreOf(surrogate, params, primary.name, goal);
    return clamp100(score);
  }

  // V4: mark the spec-banded readout (selectivity) in or out of spec, from the
  // SAME terms array score.js computed for this run's score. No marker on
  // minimize terms (cost) or on a legacy (non-constrained) domain (terms null).
  function markSpecRows(terms) {
    if (!terms) return;
    for (const t of terms) {
      if (t.kind !== 'spec') continue;
      const mark = host.querySelector(`[data-spec-mark="${t.out}"]`);
      if (!mark) continue;
      const ok = t.inSpec !== false;
      mark.textContent = ok ? '✓' : '⚠';
      mark.setAttribute('aria-hidden', 'true'); // decorative: the run's live-region announcement already states in/out of spec
      mark.classList.toggle(`${NS}-spec-mark--ok`, ok);
      mark.classList.toggle(`${NS}-spec-mark--bad`, !ok);
      mark.title = ok ? `in band ${t.lo}-${t.hi}` : `out of spec (band ${t.lo}-${t.hi})`;
    }
  }
  function clearSpecMark(outName) {
    const mark = host.querySelector(`[data-spec-mark="${outName}"]`);
    if (!mark) return;
    mark.textContent = '';
    mark.classList.remove(`${NS}-spec-mark--ok`, `${NS}-spec-mark--bad`);
  }

  const flask = new Flask(canvas, accent, host);

  // map the live process params onto the flask animation.
  function onParam() {
    const tN = norm01(params[tempInput.name], tempInput);
    flask.setHeat(clamp01(tN));
    if (addInput) flask.setAddRate(clamp01(norm01(params[addInput.name], addInput)));
    if (catInput) flask.setCatalyst(clamp01(norm01(params[catInput.name], catInput)));
    if (resInput) flask.setResidence(clamp01(norm01(params[resInput.name], resInput)));
  }

  function run() {
    if (running) return Promise.resolve(lastState);
    running = true;
    goBtn.disabled = true;
    goBtn.classList.add(`${NS}-go--busy`);
    hintEl.textContent = 'Heating and reacting...';
    scoreEl.classList.remove(`${NS}-score--in`);
    for (const o of reveal) {
      outRows[o.name].textContent = '...';
      clearSpecMark(o.name);
    }

    return flask.play(1200).then(() => {
      const outputs = {};
      for (const o of reveal) {
        const { mean } = surrogate.predictFull(o.name, params);
        outputs[o.name] = Number.isFinite(mean) ? mean : 0;
      }
      // V4: the canonical composite result (score.js scoreOf), so the readout can
      // mark selectivity in/out of spec from the SAME terms the showdown uses.
      const scoreResult = scoreOf(surrogate, params, primary.name, goal);
      const score = clamp100(scoreResult.score);
      lastState = { params: { ...params }, outputs, score };

      animateNumber(scoreEl, score, 600, (v) => Math.round(v).toString());
      scoreEl.classList.add(`${NS}-score--in`);
      for (const o of reveal) {
        const dec = decimalsFor(o);
        animateNumber(outRows[o.name], outputs[o.name], 600, (v) => v.toFixed(dec));
      }
      markSpecRows(scoreResult.terms);
      if (score > bestScore) {
        bestScore = score;
        bestEl.textContent = `best so far ${Math.round(score)}`;
        bestEl.classList.add(`${NS}-best--up`);
        setTimeout(() => bestEl.classList.remove(`${NS}-best--up`), 700);
      }
      hintEl.textContent = 'The score rewards the highest yield, keeping selectivity in spec and cost down.';
      flask.settle(score / 100);

      goBtn.disabled = false;
      goBtn.classList.remove(`${NS}-go--busy`);
      running = false;
      for (const cb of cbs) { try { cb(lastState); } catch (e) { /* noop */ } }
      return lastState;
    });
  }

  goBtn.addEventListener('click', () => run());

  onParam();

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
      for (const o of reveal) { outRows[o.name].textContent = '--'; clearSpecMark(o.name); }
      hintEl.textContent = 'Set the recipe and the process, then run.';
      flask.settle(0);
    },
    resize() { flask.resize(); },
    destroy() {
      if (ro) { ro.disconnect(); ro = null; }
      flask.destroy();
      host.classList.remove(`${NS}-root`);
      host.innerHTML = '';
    },
  };

  // Self-heal the canvas backing store on layout changes (same pattern as the
  // bottle instrument's ResizeObserver): without it the buffer is sized once at
  // mount and blurs/stretches after a window resize, since nothing calls the
  // controller's resize().
  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => { if (flask._alive) flask.resize(); });
    ro.observe(flask.cv);
  }

  if (typeof opts.onAttempt === 'function') controller.onAttempt(opts.onAttempt);
  return controller;
}

// ---------------------------------------------------------------------------
// Flask: a round-bottom flask over a heater, with rising bubbles, a heat glow
// that tracks temperature, addition-rate-driven bubble intensity, catalyst-driven
// vigor and residence-time-driven stir. Illustrative motion only. Warm palette,
// no blue anywhere.
// ---------------------------------------------------------------------------
class Flask {
  constructor(canvas, accent, host) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.accent = accent;
    this.host = host;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.t = 0;
    this.heat = 0.4;        // 0..1 resting heat (from temperature)
    this.boil = 0;          // 0..1 reaction intensity (animates during play)
    this.addRate = 0.5;     // 0..1 addition rate -> bubble spawn rate
    this.catalyst = 0.4;    // 0..1 catalyst -> bubble vigor / rise speed
    this.residence = 0.5;   // 0..1 residence time -> stir speed / wave amplitude
    this.fill = 0.55;       // liquid level
    this.bubbles = [];
    this._anim = null;
    this._alive = true;
    // prefers-reduced-motion: freeze the idle ambient motion (continuous bubble
    // spawning/rising, surface drift) so the flask settles on a static frame; a
    // run() still plays through (a brief, user-triggered action, not a
    // continuous loop). Live-updates if the OS setting changes mid-session,
    // matching the pattern in studio-field.js.
    this._reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    this._mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    this._onReducedMotionChange = (e) => { this._reducedMotion = e.matches; };
    if (this._mq) {
      if (this._mq.addEventListener) this._mq.addEventListener('change', this._onReducedMotionChange);
      else if (this._mq.addListener) this._mq.addListener(this._onReducedMotionChange);
    }
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

  setHeat(v) { this.heat = clamp01(safe(v, 0.4)); }
  setAddRate(v) { this.addRate = clamp01(safe(v, 0.5)); }
  setCatalyst(v) { this.catalyst = clamp01(safe(v, 0.4)); }
  setResidence(v) { this.residence = clamp01(safe(v, 0.5)); }

  play(ms = 1200) {
    return new Promise((resolve) => {
      let done = false;
      const fin = () => { if (done) return; done = true; this._anim = null; resolve(); };
      this._anim = { start: performance.now(), ms, resolve: fin };
      setTimeout(fin, ms + 80);   // headless rAF is throttled; resolve via timeout
    });
  }

  settle(scoreN) {
    this.boil = 0;
    // a bit of residual warmth tinted to the achieved score
    this.heat = Math.max(this.heat, 0.25 + 0.4 * clamp01(safe(scoreN, 0)));
  }

  destroy() {
    this._alive = false;
    if (this._mq) {
      if (this._mq.removeEventListener) this._mq.removeEventListener('change', this._onReducedMotionChange);
      else if (this._mq.removeListener) this._mq.removeListener(this._onReducedMotionChange);
    }
  }

  _loop(ts) {
    if (!this.host.isConnected || !this._alive) return; // stop on disconnect/destroy
    const dt = Math.min(0.05, (ts - (this._last || ts)) / 1000 || 0);
    this._last = ts;
    // idle ambient motion (continuous bubbling + surface drift) is the
    // "continuous canvas loop" prefers-reduced-motion targets; frozen only
    // while idle, so a run's own brief reaction animation still plays through
    // and the post-run boil decay still settles (never gets stuck mid-boil).
    const idleFrozen = this._reducedMotion && !this._anim;
    if (!idleFrozen) this.t = ts * 0.001;

    if (this._anim) {
      const p = clamp01((ts - this._anim.start) / this._anim.ms);
      this.boil = Math.sin(Math.min(1, p / 0.5) * Math.PI / 2);
      if (p >= 1) { const r = this._anim.resolve; this._anim = null; if (r) r(); }
    } else {
      this.boil *= 0.94; // decay
    }

    if (!idleFrozen) {
      // bubble spawning: rate scales with heat + addition rate + boil; catalyst adds vigor.
      const rate = (0.25 + this.heat * 0.7 + this.addRate * 1.6 + this.boil * 3) * dt * 60;
      if (Math.random() < rate * 0.12) this._spawnBubble();
      const stir = 3 + this.residence * 4;     // residence time -> stir speed
      for (const b of this.bubbles) {
        b.y -= b.v * dt * 60;
        b.life -= dt;
        b.x += Math.sin(this.t * stir + b.seed) * 0.4;
      }
      this.bubbles = this.bubbles.filter((b) => b.life > 0 && b.y > 0);
    }

    this._draw();
    requestAnimationFrame(this._loop);
  }

  _spawnBubble() {
    const cx = this.w * 0.5;
    const spread = Math.min(this.w * 0.16, this.h * 0.16);
    this.bubbles.push({
      x: cx + (Math.random() - 0.5) * spread * 2,
      y: this.h * 0.78,
      r: 1.5 + Math.random() * 3.5,
      v: 0.6 + Math.random() * 1.0 + this.catalyst * 1.6 + this.boil,
      life: 1.4 + Math.random(),
      seed: Math.random() * 6,
    });
  }

  _draw() {
    const ctx = this.ctx, w = this.w, h = this.h;
    ctx.clearRect(0, 0, w, h);

    const cx = w * 0.5;
    const bulbR = Math.min(w * 0.22, h * 0.24);
    const bulbCy = h * 0.62;
    const neckTop = bulbCy - bulbR - h * 0.22;
    const neckW = bulbR * 0.5;

    // ---- heat glow under the flask ----
    const heatN = clamp01(this.heat + this.boil * 0.4);
    const hg = ctx.createRadialGradient(cx, bulbCy + bulbR * 0.4, 4, cx, bulbCy + bulbR * 0.4, bulbR * 2.2);
    hg.addColorStop(0, hexA(heatColor(heatN), 0.30 + 0.25 * this.boil));
    hg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = hg; ctx.fillRect(0, 0, w, h);

    // ---- liquid inside the bulb (clipped to bulb) ----
    ctx.save();
    flaskPath(ctx, cx, bulbCy, bulbR, neckTop, neckW);
    ctx.clip();

    const liqTop = (bulbCy + bulbR) - (1.7 * bulbR) * clamp01(this.fill);
    const lg = ctx.createLinearGradient(0, liqTop, 0, bulbCy + bulbR);
    const lc = heatColor(heatN);
    lg.addColorStop(0, hexA(lc, 0.92));
    lg.addColorStop(1, hexA(shade(lc, 0.6), 0.96));
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.moveTo(cx - bulbR * 1.2, liqTop);
    // wave amplitude scales with boil and stir (residence time)
    const amp = 2 + this.boil * 5 + this.residence * 1.5;
    const waveSpeed = 5 + this.residence * 4;
    for (let x = cx - bulbR * 1.2; x <= cx + bulbR * 1.2; x += 5) {
      const yy = liqTop + Math.sin(x * 0.06 + this.t * waveSpeed) * amp;
      ctx.lineTo(x, yy);
    }
    ctx.lineTo(cx + bulbR * 1.2, bulbCy + bulbR * 1.2);
    ctx.lineTo(cx - bulbR * 1.2, bulbCy + bulbR * 1.2);
    ctx.closePath();
    ctx.fill();

    // bubbles (warm cream, no blue)
    for (const b of this.bubbles) {
      const a = clamp01(b.life) * 0.7;
      ctx.fillStyle = hexA('#fff3d6', a);
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.fill();
    }
    ctx.restore();

    // ---- glass outline (warm neutral grey, not blue) ----
    flaskPath(ctx, cx, bulbCy, bulbR, neckTop, neckW);
    ctx.strokeStyle = 'rgba(245,242,236,0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // glass highlight (warm white)
    ctx.strokeStyle = 'rgba(255,250,240,0.14)'; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx - bulbR * 0.4, bulbCy - bulbR * 0.2, bulbR * 0.7, Math.PI * 0.9, Math.PI * 1.35);
    ctx.stroke();

    // ---- vapor / steam above the neck when reacting (warm grey, not blue) ----
    if (this.boil > 0.05 || heatN > 0.7) {
      const inten = Math.max(this.boil, (heatN - 0.7) / 0.3);
      for (let k = 0; k < 4; k++) {
        const ph = (this.t * 0.6 + k * 0.25) % 1;
        const sx = cx + Math.sin(this.t * 2 + k) * neckW * 0.8;
        const sy = neckTop - ph * h * 0.16;
        ctx.fillStyle = hexA('#f5f2ec', (1 - ph) * 0.18 * inten);
        ctx.beginPath(); ctx.arc(sx, sy, 4 + ph * 8, 0, 7); ctx.fill();
      }
    }

    // ---- heater bar / hotplate ----
    const plateY = bulbCy + bulbR + 8;
    const plateW = bulbR * 2.4;
    ctx.fillStyle = 'rgba(245,242,236,0.05)';
    roundRect(ctx, cx - plateW / 2, plateY, plateW, 12, 4); ctx.fill();
    const coil = ctx.createLinearGradient(cx - plateW / 2, 0, cx + plateW / 2, 0);
    coil.addColorStop(0, hexA(heatColor(heatN), 0.1));
    coil.addColorStop(0.5, hexA(heatColor(heatN), 0.6 + 0.3 * this.boil));
    coil.addColorStop(1, hexA(heatColor(heatN), 0.1));
    ctx.strokeStyle = coil; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx - plateW * 0.4, plateY + 6); ctx.lineTo(cx + plateW * 0.4, plateY + 6); ctx.stroke();

    // ---- temperature gauge chip (top-left) ----
    const gx = 14, gy = 14, gw = 10, gh = Math.min(70, h * 0.18);
    ctx.fillStyle = 'rgba(245,242,236,0.06)'; roundRect(ctx, gx, gy, gw, gh, 5); ctx.fill();
    const tg = ctx.createLinearGradient(0, gy + gh, 0, gy);
    tg.addColorStop(0, '#c47c0e'); tg.addColorStop(1, heatColor(1));
    ctx.fillStyle = tg;
    const fillH = gh * heatN;
    roundRect(ctx, gx, gy + gh - fillH, gw, fillH, 5); ctx.fill();
    ctx.fillStyle = 'rgba(245,242,236,0.4)'; ctx.font = '9px ui-monospace, monospace';
    ctx.fillText('temp', gx - 1, gy + gh + 12);
  }
}

// ---------------------------------------------------------------------------
// DOM builders (rx-scoped)
// ---------------------------------------------------------------------------

// Plain vertical slider (formulation panel).
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

// Bench slider: a horizontal slider laid out as a bench control (label above,
// value to the right). Used for addition rate (and any unplaced process input).
function buildBenchSlider(parent, input, params, onChange) {
  const wrap = document.createElement('div');
  wrap.className = `${NS}-bench-ctl ${NS}-bench-slider`;
  const dec = stepDecimals(input);
  wrap.innerHTML = `
    <div class="${NS}-bc-top">
      <span class="${NS}-bc-label">${input.label}</span>
      <span class="${NS}-bc-val"><b data-v></b> <i>${input.unit || ''}</i></span>
    </div>
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

// +/- Stepper field (residence time). Click or hold to step; arrow keys too.
function buildStepper(parent, input, params, onChange) {
  const wrap = document.createElement('div');
  wrap.className = `${NS}-bench-ctl ${NS}-stepper`;
  const dec = stepDecimals(input);
  const step = stepperStep(input);
  wrap.innerHTML = `
    <div class="${NS}-bc-top">
      <span class="${NS}-bc-label">${input.label}</span>
    </div>
    <div class="${NS}-step-row">
      <button type="button" class="${NS}-step-btn" data-dir="-1" aria-label="decrease">&minus;</button>
      <span class="${NS}-step-val"><b data-v></b> <i>${input.unit || ''}</i></span>
      <button type="button" class="${NS}-step-btn" data-dir="1" aria-label="increase">+</button>
    </div>
  `;
  const valEl = wrap.querySelector('[data-v]');
  const render = () => { valEl.textContent = (+params[input.name]).toFixed(dec); };
  render();
  const bump = (dir) => {
    const next = clampRange(params[input.name] + dir * step, input);
    params[input.name] = round2(next, dec);
    render();
    onChange();
  };
  wrap.querySelectorAll(`.${NS}-step-btn`).forEach((btn) => {
    const dir = +btn.dataset.dir;
    let holdTimer = null, repeatTimer = null;
    const start = (e) => {
      e.preventDefault();
      bump(dir);
      holdTimer = setTimeout(() => { repeatTimer = setInterval(() => bump(dir), 70); }, 380);
    };
    const stop = () => {
      if (holdTimer) clearTimeout(holdTimer);
      if (repeatTimer) clearInterval(repeatTimer);
      holdTimer = repeatTimer = null;
    };
    btn.addEventListener('pointerdown', start);
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointerleave', stop);
    btn.addEventListener('pointercancel', stop);
    // Keyboard activation (Enter/Space) fires a native click with no preceding
    // pointer event, so the pointer-only wiring above never ran bump() for a
    // keyboard user (a11y pass fix). e.detail === 0 identifies a keyboard-
    // triggered click (a real mouse/touch click always has detail >= 1), so
    // this cannot double-fire against the pointerdown/up hold-to-repeat above.
    btn.addEventListener('click', (e) => { if (e.detail === 0) bump(dir); });
  });
  parent.appendChild(wrap);
}

// Rotary KNOB: drag up/down (or horizontally) to turn. Maps a ~270 degree sweep
// across the input range. opts.size = 'lg' | 'sm'.
function buildKnob(parent, input, params, onChange, accent, opts = {}) {
  const size = opts.size === 'sm' ? 'sm' : 'lg';
  const wrap = document.createElement('div');
  wrap.className = `${NS}-bench-ctl ${NS}-knob ${NS}-knob--${size}`;
  const dec = stepDecimals(input);
  // label + value ABOVE the dial, matching the stepper and slider on the bench so all
  // four process controls read "label on top, control below".
  wrap.innerHTML = `
    <div class="${NS}-knob-meta">
      <span class="${NS}-bc-label">${input.label}</span>
      <span class="${NS}-bc-val"><b data-v></b> <i>${input.unit || ''}</i></span>
    </div>
    <div class="${NS}-knob-dial" tabindex="0" role="slider"
         aria-label="${input.label}" aria-valuemin="${input.min}" aria-valuemax="${input.max}">
      <div class="${NS}-knob-arc"></div>
      <div class="${NS}-knob-face">
        <div class="${NS}-knob-ind-rot">
          <span class="${NS}-knob-ind"></span>
        </div>
        <span class="${NS}-knob-dot"></span>
      </div>
    </div>
  `;
  const dial = wrap.querySelector(`.${NS}-knob-dial`);
  const rot = wrap.querySelector(`.${NS}-knob-ind-rot`);
  const arc = wrap.querySelector(`.${NS}-knob-arc`);
  const valEl = wrap.querySelector('[data-v]');
  const SWEEP = 270;            // degrees of total travel
  const START = -135;          // degrees at minimum (straight up = 0deg; min points lower-left)

  const render = () => {
    const u = norm01(params[input.name], input);
    const deg = START + SWEEP * u;
    // Rotate the full-dial wrapper about the knob's TRUE centre (transform-origin
    // 50% 50% in CSS). The needle is a fixed bar inside, so it pivots from centre.
    rot.style.transform = `rotate(${deg}deg)`;
    // Concentric active arc: a conic ring that fills from the start angle (-135deg
    // measured from straight up) clockwise by SWEEP*u. Conic 0deg points up, so we
    // offset by START.
    arc.style.background =
      `conic-gradient(from ${START}deg, ${accent} 0deg, ${accent} ${SWEEP * u}deg, ` +
      `rgba(245,242,236,0.10) ${SWEEP * u}deg, rgba(245,242,236,0.10) ${SWEEP}deg, ` +
      `transparent ${SWEEP}deg)`;
    valEl.textContent = (+params[input.name]).toFixed(dec);
    dial.setAttribute('aria-valuenow', String(params[input.name]));
  };
  render();

  // pointer drag: vertical movement (up = increase) is the primary axis; we also
  // fold in horizontal so a right-drag increases too. ~180px of travel = full range.
  let dragging = false, lastY = 0, lastX = 0, accU = 0;
  const onDown = (e) => {
    dragging = true; lastY = e.clientY; lastX = e.clientX;
    accU = norm01(params[input.name], input);
    dial.setPointerCapture && dial.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onMove = (e) => {
    if (!dragging) return;
    const dy = lastY - e.clientY;        // up is positive
    const dx = e.clientX - lastX;        // right is positive
    lastY = e.clientY; lastX = e.clientX;
    accU = clamp01(accU + (dy + dx) / 180);
    const v = clampRange(input.min + accU * (input.max - input.min), input);
    params[input.name] = round2(v, dec);
    render();
    onChange();
  };
  const onUp = (e) => {
    dragging = false;
    dial.releasePointerCapture && dial.releasePointerCapture(e.pointerId);
  };
  dial.addEventListener('pointerdown', onDown);
  dial.addEventListener('pointermove', onMove);
  dial.addEventListener('pointerup', onUp);
  dial.addEventListener('pointercancel', onUp);
  // keyboard: arrow keys nudge
  dial.addEventListener('keydown', (e) => {
    const step = (input.max - input.min) / 40;
    let d = 0;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') d = step;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') d = -step;
    if (d !== 0) {
      e.preventDefault();
      params[input.name] = round2(clampRange(params[input.name] + d, input), dec);
      render();
      onChange();
    }
  });
  parent.appendChild(wrap);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function clamp01(v) { return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0)); }
function clamp100(v) { return Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0)); }
function safe(v, d) { return Number.isFinite(v) ? v : d; }
function norm01(v, input) {
  const span = input.max - input.min;
  return span > 0 ? clamp01((v - input.min) / span) : 0;
}
function clampRange(v, input) { return Math.max(input.min, Math.min(input.max, v)); }
function round2(v, dec) { const f = Math.pow(10, dec); return Math.round(v * f) / f; }
function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
function hexA(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
// heat color ramp: deep amber (cool) -> hot orange (hot), stays on brand, no blue.
function heatColor(t) {
  t = clamp01(t);
  const cool = [196, 124, 14], hot = [255, 138, 78];
  const r = Math.round(cool[0] + (hot[0] - cool[0]) * t);
  const g = Math.round(cool[1] + (hot[1] - cool[1]) * t);
  const b = Math.round(cool[2] + (hot[2] - cool[2]) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
function shade(hex, f) {
  const h = hex.replace('#', '');
  const r = Math.round(parseInt(h.slice(0, 2), 16) * f);
  const g = Math.round(parseInt(h.slice(2, 4), 16) * f);
  const b = Math.round(parseInt(h.slice(4, 6), 16) * f);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
function stepOf(input) {
  // the schema-declared step is the fairness contract: STOCHOS, beatRate, and
  // this control all snap to the SAME grid (see snapInput in surrogate.js).
  // The span heuristic below is only the fallback for inputs without one.
  if (input.step > 0) return input.step;
  const span = input.max - input.min;
  if (span <= 6) return 0.05;
  if (span <= 30) return 0.5;
  return 1;
}
function stepperStep(input) {
  if (input.step > 0) return input.step;   // schema grid wins (fairness contract)
  const span = input.max - input.min;
  if (span <= 6) return 0.1;
  if (span <= 30) return 1;
  return 5;
}
function stepDecimals(input) { const s = stepOf(input); return s < 0.1 ? 2 : s < 1 ? 1 : 0; }
function decimalsFor(o) {
  if (o.unit === '%') return 1;
  if (o.unit === 'rel') return 2;
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
function flaskPath(ctx, cx, bulbCy, bulbR, neckTop, neckW) {
  // round-bottom flask: a circle bulb with a narrow straight neck up to a flared
  // lip. The neck meets the bulb tangentially so there are no flat seams.
  const a = Math.asin(Math.min(0.999, neckW / bulbR)); // from vertical
  const joinY = bulbCy - bulbR * Math.cos(a);          // y where neck meets bulb
  ctx.beginPath();
  ctx.moveTo(cx - neckW - 4, neckTop - 4);
  ctx.lineTo(cx - neckW, neckTop);
  ctx.lineTo(cx - neckW, joinY);
  const left = Math.PI / 2 + a;   // upper-left
  const right = Math.PI / 2 - a;  // upper-right
  ctx.arc(cx, bulbCy, bulbR, left, right + Math.PI * 2, false);
  ctx.lineTo(cx + neckW, neckTop);
  ctx.lineTo(cx + neckW + 4, neckTop - 4);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// scoped style. Primarily BLACK + warm amber. No blue / slate / indigo.
// ---------------------------------------------------------------------------
function injectStyle(accent) {
  if (document.getElementById(STYLE_ID)) return;
  const css = `
.${NS}-root { color:#f5f2ec; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif; }
.${NS}-grid { display:grid; grid-template-columns: minmax(200px,0.9fr) minmax(320px,1.5fr) minmax(210px,0.95fr); gap:14px; align-items:stretch; }
@media (max-width: 900px){ .${NS}-grid{ grid-template-columns:1fr; } }
.${NS}-panel { background:#0b0b0d; border:1px solid rgba(245,242,236,0.10); border-radius:16px; padding:16px; display:flex; flex-direction:column; min-width:0; }
.${NS}-eyebrow { font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:#8a847a; margin-bottom:12px; }

/* ---- LEFT: formulation ---- */
.${NS}-sliders { display:flex; flex-direction:column; gap:16px; }
.${NS}-slider { display:flex; flex-direction:column; gap:6px; }
.${NS}-s-top { display:flex; justify-content:space-between; align-items:baseline; font-size:13px; }
.${NS}-s-label { color:#f5f2ec; }
.${NS}-s-val { font-family:ui-monospace,"SF Mono",Consolas,monospace; color:${accent}; }
.${NS}-s-val i { color:#8a847a; font-style:normal; font-size:11px; }
.${NS}-formnote { margin-top:16px; padding-top:16px; border-top:1px solid rgba(245,242,236,0.07); font-size:11px; color:#8a847a; line-height:1.5; }

.${NS}-root input[type=range]{ -webkit-appearance:none; appearance:none; width:100%; height:4px; border-radius:3px; background:rgba(245,242,236,0.14); outline:none; }
.${NS}-root input[type=range]::-webkit-slider-thumb{ -webkit-appearance:none; width:16px; height:16px; border-radius:50%; background:${accent}; cursor:pointer; box-shadow:0 0 0 4px ${hexA(accent,0.18)}; }
.${NS}-root input[type=range]::-moz-range-thumb{ width:16px; height:16px; border:none; border-radius:50%; background:${accent}; cursor:pointer; }

/* ---- CENTRE: bench ---- */
.${NS}-stage { position:relative; }
.${NS}-bench { position:relative; flex:1; min-height:230px; display:flex; }
.${NS}-canvas { width:100%; flex:1; min-height:230px; display:block; }
.${NS}-knobs { display:grid; grid-template-columns:repeat(2,1fr); gap:12px 16px; margin-top:12px; padding:14px; border:1px solid rgba(245,242,236,0.10); border-radius:14px; background:linear-gradient(180deg, rgba(255,180,84,0.04), rgba(0,0,0,0)); }
@media (max-width: 480px){ .${NS}-knobs{ grid-template-columns:1fr; } }
.${NS}-bench-ctl { display:flex; min-width:0; }
.${NS}-bc-top { display:flex; justify-content:space-between; align-items:baseline; font-size:12px; gap:8px; }
.${NS}-bc-label { color:#d8d2c7; }
.${NS}-bc-val { font-family:ui-monospace,"SF Mono",Consolas,monospace; color:${accent}; font-size:12px; white-space:nowrap; }
.${NS}-bc-val i { color:#8a847a; font-style:normal; font-size:10px; }

/* bench slider */
.${NS}-bench-slider { flex-direction:column; gap:7px; }

/* stepper */
.${NS}-stepper { flex-direction:column; gap:7px; }
.${NS}-step-row { display:flex; align-items:center; gap:8px; }
.${NS}-step-btn { width:30px; height:30px; flex:0 0 auto; border-radius:8px; border:1px solid rgba(245,242,236,0.16); background:#15140f; color:${accent}; font-size:18px; line-height:1; cursor:pointer; display:flex; align-items:center; justify-content:center; user-select:none; transition:background .12s ease, border-color .12s ease; }
.${NS}-step-btn:hover{ background:#1f1c14; border-color:${hexA(accent,0.5)}; }
.${NS}-step-btn:active{ background:${hexA(accent,0.18)}; }
.${NS}-step-val { flex:1; text-align:center; font-family:ui-monospace,"SF Mono",Consolas,monospace; color:${accent}; font-size:15px; }
.${NS}-step-val i { color:#8a847a; font-style:normal; font-size:10px; }

/* rotary knob ------------------------------------------------------------
   Geometry rule: EVERYTHING that turns pivots about the dial's true centre.
   - .rx-knob-arc      concentric conic ring, masked to an annulus (set in JS).
   - .rx-knob-ind-rot  fills the dial (inset:0) and rotates about 50% 50%.
   - .rx-knob-ind      a fixed bar from the centre pointing UP (bottom at centre).
   - .rx-knob-dot      centre cap, marks the true pivot.
   No translate hacks on the rotated element, so the needle can never drift off
   the knob centre across the full value range. */
.${NS}-knob { flex-direction:column; align-items:center; gap:8px; }
.${NS}-knob-dial { position:relative; border-radius:50%; cursor:grab; touch-action:none; outline:none;
  background:radial-gradient(circle at 38% 32%, #2a261d, #100f0b 70%);
  border:1px solid rgba(245,242,236,0.14); box-shadow:inset 0 2px 6px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4); }
.${NS}-knob-dial:active{ cursor:grabbing; }
.${NS}-knob-dial:focus-visible{ box-shadow:0 0 0 3px ${hexA(accent,0.4)}, inset 0 2px 6px rgba(0,0,0,0.6); }
.${NS}-knob--lg .${NS}-knob-dial { width:74px; height:74px; }
.${NS}-knob--sm .${NS}-knob-dial { width:54px; height:54px; }
/* active arc: a conic-gradient ring, concentric with the dial. The conic fill is
   set in JS; we mask it to a thin annulus just inside the dial edge. */
.${NS}-knob-arc { position:absolute; inset:-4px; border-radius:50%; pointer-events:none;
  -webkit-mask:radial-gradient(circle, transparent 0 58%, #000 60% 72%, transparent 74%);
  mask:radial-gradient(circle, transparent 0 58%, #000 60% 72%, transparent 74%);
  filter:drop-shadow(0 0 4px ${hexA(accent,0.45)}); }
.${NS}-knob-face { position:absolute; inset:0; }
.${NS}-knob-ind-rot { position:absolute; inset:0; transform-origin:50% 50%; transform:rotate(0deg); }
.${NS}-knob-ind { position:absolute; left:50%; bottom:50%; width:3px; height:38%; margin-left:-1.5px;
  background:linear-gradient(0deg, ${hexA(accent,0.2)}, ${accent}); border-radius:2px;
  box-shadow:0 0 6px ${hexA(accent,0.6)}; }
.${NS}-knob-dot { position:absolute; left:50%; top:50%; width:8px; height:8px; margin:-4px 0 0 -4px;
  border-radius:50%; background:radial-gradient(circle at 40% 35%, #4a4334, #15130d);
  box-shadow:0 0 0 1px rgba(245,242,236,0.10); }
.${NS}-knob-meta { display:flex; flex-direction:column; align-items:center; gap:2px; text-align:center; }
.${NS}-knob-meta .${NS}-bc-label { font-size:11px; }

.${NS}-go { margin-top:14px; appearance:none; border:none; cursor:pointer; border-radius:2px; padding:13px 20px; font-size:14px; font-weight:600; color:#08070A; background:${accent}; transition:filter .18s ease, transform .18s ease; }
.${NS}-go:hover{ filter:brightness(1.08); transform:translateY(-1px); }
.${NS}-go:active{ transform:translateY(0); }
.${NS}-go:disabled{ cursor:default; filter:grayscale(.3) brightness(.85); }
.${NS}-go--busy{ animation:${NS}-pulse 1.2s ease-in-out infinite; }
@keyframes ${NS}-pulse{ 0%,100%{ opacity:1;} 50%{ opacity:.72;} }

/* ---- RIGHT: readout ---- */
.${NS}-readout { gap:0; }
/* centre the score+outputs+hint group in the tall panel (see paint note) */
.${NS}-scorewrap { margin-top:auto; display:flex; flex-direction:column; align-items:center; padding:6px 0 14px; border-bottom:1px solid rgba(245,242,236,0.08); margin-bottom:12px; }
.${NS}-score { font-family:ui-monospace,monospace; font-size:58px; line-height:1; font-weight:700; color:#3a362d; transition:color .3s ease; }
.${NS}-score--in { color:${accent}; text-shadow:0 0 24px ${hexA(accent,0.45)}; }
.${NS}-score-cap { font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:#8a847a; margin-top:4px; }
.${NS}-best { font-size:11px; color:#aaa49a; margin-top:8px; font-family:ui-monospace,monospace; }
.${NS}-best--up { color:${accent}; }
.${NS}-outs { display:flex; flex-direction:column; gap:10px; }
.${NS}-outrow { display:grid; grid-template-columns: 1fr auto auto auto; align-items:baseline; gap:6px; font-size:13px; }
.${NS}-out-label { color:#aaa49a; }
.${NS}-out-val { font-family:ui-monospace,monospace; font-size:17px; color:#f5f2ec; text-align:right; }
.${NS}-out-unit { color:#8a847a; font-size:11px; }
/* V4: in/out-of-spec mark for selectivity (the keep-in-band spec term). Empty
   (no glyph) until the first run, and on outputs with no spec band. */
.${NS}-spec-mark { width:14px; text-align:center; font-size:12px; line-height:1; }
.${NS}-spec-mark--ok { color:${accent}; }
.${NS}-spec-mark--bad { color:#ff6b6b; }
.${NS}-hint { margin-bottom:auto; padding-top:14px; font-size:11px; color:#8a847a; line-height:1.5; }
`;
  const tag = document.createElement('style');
  tag.id = STYLE_ID;
  tag.textContent = css;
  document.head.appendChild(tag);
}
