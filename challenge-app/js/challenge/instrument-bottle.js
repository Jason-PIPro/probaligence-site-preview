// instrument-bottle.js, the engineering BOTTLE for the "Beat Stochos" challenge.
// A 3D parametric bottle (Three.js LatheGeometry) that MORPHS live as the visitor
// drags the sliders: height stretches it, diameter widens the body, wall thickness
// shows as a visible wall + inset, and a 3-way material picker (PET / HDPE / glass)
// swaps the look (color, transparency, shininess). Gentle auto-rotate + the
// project's custom azimuth/polar/dist orbit drag. The camera AUTO-FITS the current
// geometry so the bottle never clips, across the whole slider range.
//
// GO = "Run load test". On GO we present the SOLVER-VS-STOCHOS gag as the
// prediction mechanism: "Use Solver" crawls a ~4 h progress bar then offers a
// "Use Stochos instead?" popup; "Use Stochos" spins for 2 s, then plays the LOAD
// TEST: the bottle fills, then PRESSURISES (a pressure gauge needle climbs in bar
// and the walls visibly bulge). It then either HOLDS (survives the rated test) or
// BURSTS at its real burst pressure with a crack + a particle puff. The burst value
// shown is the REAL surrogate output: surrogate.predictFull('burst_bar', params).mean.
//
// Honesty: every numeric value shown is real N-D DIM-GP-backed surrogate output
// (predictFull over ALL inputs; the displayed SCORE is scoreOf(...).score, the same
// canonical score the HUD and showdown use). The 3D animation, the bulge, the gauge,
// the crack/particles and the "~4 h" solver time are ILLUSTRATIVE (the shell shows
// the global disclaimer; we also tag the solver step and the material look inline).
//
// Contract: mountInstrument(host, surrogate, opts) -> controller
//   { getState(), run(), onAttempt(cb), reset(), resize(), destroy() }.
import * as THREE from '../../vendor/three.module.min.js';
import { scoreOf, constraintCfg } from './score.js';

const NS = 'bt';                       // scope class prefix
const ACCENT = '#ffb006';              // single brand amber (was an off-brand deeper orange)
const STYLE_ID = 'instrument-bottle-style';

// Geometry constants shared by the view + the auto-fit so framing always matches
// the rendered envelope (the source of the "clips out of the bottle" bug was the
// fit not accounting for the pad below and the burst puff around the bottle).
const PAD_H = 0.18;                     // pad cylinder height (CylinderGeometry below)
const BURST_HEADROOM = 0.9;            // world units of spray room reserved around the rig

// Material looks keyed by material_idx (0..2). BLACK + warm amber brand: no blue.
// PET = warm clear amber tint, HDPE = warm off-white, "Glass" = warm smoky clear.
// Appearance is illustrative (labelled in the picker).
const MATERIALS = [
  { name: 'PET',  color: 0xe8c79a, opacity: 0.44, rough: 0.12, metal: 0.0, transparent: true,  swatch: '#e8c79a' },
  { name: 'HDPE', color: 0xece6dc, opacity: 0.96, rough: 0.55, metal: 0.0, transparent: false, swatch: '#ece6dc' },
  { name: 'PP',   color: 0xd8c9a6, opacity: 0.40, rough: 0.06, metal: 0.04, transparent: true, swatch: '#d8c9a6' },
];

export function mountInstrument(host, surrogate, opts = {}) {
  const accent = opts.accent || ACCENT;       // HEX only (never a CSS var)
  injectStyle(accent);

  // ---- resolve inputs / outputs from the surrogate (never invent values) ----
  const axisX = surrogate.axisInput(0);        // height_mm
  const axisY = surrogate.axisInput(1);        // diameter_mm
  const out = surrogate.outputs;
  const primary = out.find((o) => o.name === 'burst_bar') || out[0];
  const GOAL = primary.goal || 'high';
  const reveal = [
    primary,
    out.find((o) => o.name === 'weight_g'),
    out.find((o) => o.name === 'cost_rel'),
  ].filter(Boolean);

  const wallInput = surrogate.inputs.find((i) => i.name === 'wall_mm');
  const matInput = surrogate.inputs.find((i) => i.name === 'material_idx');
  const fillInput = surrogate.inputs.find((i) => i.name === 'fill_pct');

  // all 5 inputs start at default; ALL of them feed predictFull (N-D score),
  // and ALL of them shape the visual + load test. Nothing is held inert.
  const params = {};
  for (const i of surrogate.inputs) params[i.name] = i.default;

  // RATED test pressure the bottle is loaded against (illustrative spec, in bar).
  // V4: when the domain scores against a target band (CONSTRAINTS.bottle.primary
  // .scoreRange, the B1 objective: hit the target, then lightest wins), the rated
  // test IS that target, so the verdict and the score agree about what "enough"
  // means. Legacy fallback: placed low in the N-D burst range so the verdict is
  // meaningful (a decent design survives, a weak one bursts on the rig).
  const fullStats = surrogate.predictFullStats(primary.name);   // {mn,mx} over N-D
  const _ccfg = constraintCfg(surrogate);
  const _target = _ccfg && _ccfg.primary && _ccfg.primary.out === primary.name && _ccfg.primary.scoreRange;
  const TEST_PRESSURE = _target
    ? round1(_target[1])
    : round1(fullStats.mn + 0.34 * (fullStats.mx - fullStats.mn));
  // gauge sweep: a bit above the realistic N-D max so the needle keeps headroom.
  const GAUGE_MAX = Math.max(round1(fullStats.mx * 1.12), TEST_PRESSURE * 1.4) || 50;

  // ---- DOM ----
  host.classList.add(`${NS}-root`);
  host.innerHTML = `
    <div class="${NS}-grid">
      <div class="${NS}-panel ${NS}-controls">
        <div class="${NS}-eyebrow">Bottle design</div>
        <div class="${NS}-sliders" data-role="sliders"></div>

        <div class="${NS}-matblock">
          <div class="${NS}-matblock-head">Material <span class="${NS}-illus">look is illustrative</span></div>
          <div class="${NS}-swatches" data-role="swatches"></div>
        </div>
      </div>

      <div class="${NS}-panel ${NS}-stage">
        <div class="${NS}-eyebrow">Load test rig</div>
        <div class="${NS}-canvaswrap" data-role="canvaswrap">
          <div class="${NS}-verdict" data-role="verdict"></div>
          <div class="${NS}-stamp" data-role="stamp"></div>
        </div>
        <!-- pressure gauge sits in its own panel BELOW the bottle (was an overlay that
             cut a translucent rectangle across the 3D rig). Matches the reactor's
             canvas + instrument-panel layout. -->
        <div class="${NS}-gauge" data-role="gauge">
          <canvas class="${NS}-gauge-dial" data-role="gaugecv" aria-hidden="true"></canvas>
          <div class="${NS}-gauge-side">
            <div class="${NS}-gauge-title">Pressure gauge</div>
            <div class="${NS}-gauge-read"><span class="${NS}-gauge-read-cap">measured</span><b data-role="gaugeval">0.0</b><span class="${NS}-gauge-read-unit">bar</span></div>
            <div class="${NS}-gauge-rated"><span class="${NS}-gauge-rated-dot"></span>rated test <b data-role="ratedval">--</b> bar</div>
          </div>
        </div>
        <button class="${NS}-go" data-role="go">
          <span class="${NS}-go-label">Run load test</span>
        </button>
        <div class="${NS}-gagslot" data-role="gagslot"></div>
      </div>

      <div class="${NS}-panel ${NS}-readout">
        <div class="${NS}-eyebrow">Predicted result</div>
        <div class="${NS}-scorewrap">
          <div class="${NS}-score" data-role="score">--</div>
          <div class="${NS}-score-cap">score</div>
          <div class="${NS}-best" data-role="best">best so far --</div>
        </div>
        <div class="${NS}-outs" data-role="outs"></div>
        <div class="${NS}-hint" data-role="hint">Shape the bottle, then run the load test.</div>
      </div>
    </div>
  `;

  const $ = (sel) => host.querySelector(sel);
  const slidersEl = $(`[data-role="sliders"]`);
  const swatchesEl = $(`[data-role="swatches"]`);
  const canvasWrap = $(`[data-role="canvaswrap"]`);
  const gaugeCv = $(`[data-role="gaugecv"]`);
  const gaugeCtx = gaugeCv ? gaugeCv.getContext('2d') : null;
  const gaugeValEl = $(`[data-role="gaugeval"]`);
  const verdictEl = $(`[data-role="verdict"]`);
  const ratedValEl = $(`[data-role="ratedval"]`);
  const stampEl = $(`[data-role="stamp"]`);
  const goBtn = $(`[data-role="go"]`);
  const gagSlot = $(`[data-role="gagslot"]`);
  const scoreEl = $(`[data-role="score"]`);
  const bestEl = $(`[data-role="best"]`);
  const outsEl = $(`[data-role="outs"]`);
  const hintEl = $(`[data-role="hint"]`);

  // ---- gauge dial, drawn as ONE canvas (arc + ticks + numbers + red rated-test
  // threshold + needle in a single piece, so nothing clips and the needle animates
  // as one unit). The rated VALUE also shows as a label beside the dial.
  const GW = 152, GH = 92;                 // css px size of the gauge canvas
  if (gaugeCv && gaugeCtx) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    gaugeCv.width = Math.round(GW * dpr);
    gaugeCv.height = Math.round(GH * dpr);
    gaugeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  // draw the whole gauge with the needle at `bar`. Pure function of bar + the consts.
  function drawGauge(bar) {
    if (!gaugeCtx) return;
    const ctx = gaugeCtx, cx = GW / 2, cy = GH - 10, R = 60;
    const ang = (f) => Math.PI * (1 + clamp01(f));           // 0 -> left, 1 -> right
    const pt = (f, r) => [cx + Math.cos(ang(f)) * r, cy + Math.sin(ang(f)) * r];
    ctx.clearRect(0, 0, GW, GH);
    ctx.lineCap = 'round';
    // background arc
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(cx, cy, R, Math.PI, 2 * Math.PI); ctx.stroke();
    // ticks + numbers (neutral grey, matches the other instruments)
    const step = niceStep(GAUGE_MAX);
    ctx.font = '9px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let v = 0; v <= GAUGE_MAX + 1e-6; v += step) {
      const f = v / GAUGE_MAX;
      const [x1, y1] = pt(f, R + 2), [x2, y2] = pt(f, R - 6);
      ctx.strokeStyle = 'rgba(255,255,255,0.42)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      const [nx, ny] = pt(f, R - 15);
      ctx.fillStyle = 'rgba(176,176,168,0.9)';
      ctx.fillText(String(Number.isInteger(step) ? v : round1(v)), nx, ny);
    }
    // red rated-test threshold mark
    const tf = clamp01(TEST_PRESSURE / GAUGE_MAX);
    const [rx1, ry1] = pt(tf, R + 4), [rx2, ry2] = pt(tf, R - 8);
    ctx.save(); ctx.strokeStyle = '#ff7a5c'; ctx.lineWidth = 3;
    ctx.shadowColor = 'rgba(255,122,92,0.85)'; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.moveTo(rx1, ry1); ctx.lineTo(rx2, ry2); ctx.stroke(); ctx.restore();
    // needle + hub (amber)
    const f = clamp01((Number.isFinite(bar) ? bar : 0) / GAUGE_MAX);
    const [tx, ty] = pt(f, R - 5);
    ctx.save(); ctx.strokeStyle = accent; ctx.lineWidth = 3;
    ctx.shadowColor = hexA(accent, 0.8); ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx, ty); ctx.stroke(); ctx.restore();
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(cx, cy, 5, 0, 7); ctx.fill();
  }
  if (ratedValEl) ratedValEl.textContent = round1(TEST_PRESSURE);
  drawGauge(0);

  // ---- the 3D bottle (Three.js) ----
  const bottle = new BottleView(canvasWrap, accent);
  syncBottle();

  // ALL 5 inputs as sliders (height, diameter, wall, fill) + material as swatches.
  buildSlider(slidersEl, axisX, params, onParam);
  buildSlider(slidersEl, axisY, params, onParam);
  if (wallInput) buildSlider(slidersEl, wallInput, params, onParam);
  if (fillInput) buildSlider(slidersEl, fillInput, params, onParam);

  buildSwatches(swatchesEl, MATERIALS, () => params[matInput ? matInput.name : 'material_idx'], (idx) => {
    if (matInput) params[matInput.name] = idx;
    onParam();
  });

  // readout rows
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

  // canonical score from the FULL N-D params (matches challenge.js + showdown).
  function currentScore() {
    return scoreOf(surrogate, params, primary.name, GOAL).score;
  }

  function syncBottle() {
    bottle.setDesign({
      heightFrac: frac(params[axisX.name], axisX),
      diameterFrac: frac(params[axisY.name], axisY),
      wallFrac: wallInput ? frac(params[wallInput.name], wallInput) : 0.4,
      materialIdx: matInput ? Math.round(clamp(params[matInput.name], 0, MATERIALS.length - 1)) : 1,
      fillFrac: fillInput ? frac(params[fillInput.name], fillInput) : 0.8,
    });
    const mi = matInput ? Math.round(params[matInput.name]) : 1;
    swatchesEl.querySelectorAll(`.${NS}-swatch`).forEach((el, i) => {
      el.classList.toggle(`${NS}-swatch--on`, i === mi);
    });
  }

  function onParam() {
    syncBottle();
    // editing any param settles the rig back to "ready" (no pressure, clear verdict)
    bottle.setPressure(0);
    bottle.setBurst(false);
    bottle.setFillAnim(fillInput ? frac(params[fillInput.name], fillInput) : 0.8);
    setNeedle(0);
    verdictEl.className = `${NS}-verdict`;
    verdictEl.textContent = '';
    stampEl.className = `${NS}-stamp`;
    stampEl.textContent = '';
  }

  // ---- gauge needle helper: redraw the whole dial with the needle at `bar`. Called
  // every frame of the pressurise phase, so the needle sweeps as one canvas piece.
  function setNeedle(bar) {
    const b = Number.isFinite(bar) ? Math.max(0, bar) : 0;
    drawGauge(b);
    if (gaugeValEl) gaugeValEl.textContent = b.toFixed(1);
  }

  // ---------------------------------------------------------------------------
  // run(): present the gag, then play the load test, then reveal real outputs.
  // The whole chain is timer-backed so a run always completes even with rAF
  // throttled in a hidden/headless tab.
  // ---------------------------------------------------------------------------
  function run() {
    if (running) return Promise.resolve(lastState);
    running = true;
    goBtn.disabled = true;
    goBtn.classList.add(`${NS}-go--busy`);
    scoreEl.classList.remove(`${NS}-score--in`);
    for (const o of reveal) outRows[o.name].textContent = '...';
    hintEl.textContent = 'Choose how to predict the burst pressure.';
    verdictEl.className = `${NS}-verdict`;
    verdictEl.textContent = '';
    stampEl.className = `${NS}-stamp`;
    stampEl.textContent = '';
    bottle.setBurst(false);
    bottle.setPressure(0);
    setNeedle(0);

    return new Promise((resolve) => {
      showGag(() => {
        runStochos().then((state) => {
          running = false;
          goBtn.disabled = false;
          goBtn.classList.remove(`${NS}-go--busy`);
          resolve(state);
        });
      });
    });
  }

  // The two-button gag. onStochos() is called when the visitor (eventually)
  // chooses Stochos by any path. Resolves a Promise inside run().
  function showGag(onStochos) {
    let settled = false;
    const choose = () => {
      if (settled) return; settled = true;
      gagSlot.innerHTML = '';
      onStochos();
    };

    gagSlot.innerHTML = `
      <div class="${NS}-gag">
        <div class="${NS}-gag-q">How should we compute the burst pressure?</div>
        <div class="${NS}-gag-btns">
          <button class="${NS}-gagbtn ${NS}-gagbtn--solver" data-g="solver">
            <span class="${NS}-gagbtn-main">Use Solver</span>
            <span class="${NS}-gagbtn-time ${NS}-gagbtn-time--slow">~4 h per run</span>
          </button>
          <button class="${NS}-gagbtn ${NS}-gagbtn--stochos" data-g="stochos">
            <span class="${NS}-gagbtn-main">Use Stochos</span>
            <span class="${NS}-gagbtn-time ${NS}-gagbtn-time--fast">~2 s per run</span>
          </button>
        </div>
        <div class="${NS}-gag-pitch">Once a STOCHOS model is trained, it stands in for the solver everywhere: switch <b>all</b> your simulation runs to it and get predictions in <b>seconds</b>, not hours.</div>
        <div class="${NS}-gag-note">The ~4 h solver time is illustrative: it dramatizes that the trained surrogate predicts in real time what a full physics solver takes hours to compute.</div>
      </div>`;

    const solverBtn = gagSlot.querySelector('[data-g="solver"]');
    const stochosBtn = gagSlot.querySelector('[data-g="stochos"]');
    stochosBtn.addEventListener('click', choose);
    solverBtn.addEventListener('click', () => startSolverCrawl(gagSlot, choose));
  }

  // Solver path: a slow crawling progress bar + a "Use Stochos instead?" popup
  // after ~1.5 s. Either route funnels into onStochos via choose().
  function startSolverCrawl(slot, choose) {
    slot.innerHTML = `
      <div class="${NS}-solver">
        <div class="${NS}-solver-head">
          <span>Running physics solver</span>
          <span class="${NS}-solver-eta">Estimated computation time ~4 h</span>
        </div>
        <div class="${NS}-solver-bar"><div class="${NS}-solver-fill" data-role="solverfill"></div></div>
        <div class="${NS}-solver-sub">meshing geometry, solving nonlinear shell buckling...</div>
        <div class="${NS}-popup" data-role="popup">
          <div class="${NS}-popup-msg">This will take about 4 hours. Use STOCHOS instead?</div>
          <button class="${NS}-popup-btn" data-role="popupbtn">Use STOCHOS</button>
        </div>
      </div>`;
    const fill = slot.querySelector('[data-role="solverfill"]');
    requestAnimationFrame(() => { if (fill && fill.isConnected) fill.style.width = '7%'; });
    const popup = slot.querySelector('[data-role="popup"]');
    const popupBtn = slot.querySelector('[data-role="popupbtn"]');
    popupBtn.addEventListener('click', choose);
    setTimeout(() => { if (popup && popup.isConnected) popup.classList.add(`${NS}-popup--in`); }, 1500);
  }

  // Stochos path: a 2 s spinner labelled "Prediction time: 2 s", then play the
  // load test animation and reveal the real outputs.
  function runStochos() {
    // V4.1 (adversarial audit fix): snapshot the design at run start. The
    // controls stay live during the ~4.6 s test, so without this a slider moved
    // mid-run made the verdict/gauge describe the launched design while the
    // readouts and score described the mutated one (PASS stamp next to a
    // failing burst readout). Every artifact of this run now reads `snap`.
    const snap = { ...params };
    gagSlot.innerHTML = `
      <div class="${NS}-spin">
        <div class="${NS}-spin-ring"></div>
        <div class="${NS}-spin-label">Prediction time: 2 s</div>
      </div>`;

    return wait(2000).then(() => {
      gagSlot.innerHTML = '';
      // burst pressure is the REAL surrogate prediction; everything else is theatre.
      const burst = surrogate.predictFull(primary.name, snap).mean;
      const burstBar = Number.isFinite(burst) ? Math.max(0, burst) : 0;
      const holds = burstBar >= TEST_PRESSURE;
      return playLoadTest(burstBar, holds, snap).then(() => reveal_(burstBar, holds, snap));
    });
  }

  // The centrepiece animation. Two phases, both timer-backed so they always finish:
  //   1) FILL: liquid rises to fill_pct (~0.7 s).
  //   2) PRESSURISE: the gauge needle climbs and the walls bulge. The needle ALWAYS
  //      climbs to the design's REAL burst pressure (the surrogate score), so a strong
  //      bottle visibly sweeps PAST the rated mark and a weak one stops short of it.
  //      It HOLDS (survives) when the real burst >= the rated test, else it BURSTS
  //      (crack + particle puff). The needle's final resting value equals the real
  //      burst pressure in both cases, so the gauge reflects the actual result.
  function playLoadTest(burstBar, holds, snap) {
    const p0 = snap || params;
    const targetFill = fillInput ? frac(p0[fillInput.name], fillInput) : 0.8;
    // the needle climbs to the REAL burst value (clamped to the dial range), in both
    // the hold and the burst case. This is the user-requested fix: the needle must
    // land where the design actually scores, not stop at the fixed rated test.
    const climbTo = clamp(burstBar, 0, GAUGE_MAX);

    hintEl.textContent = 'Filling the bottle...';

    return runPhase(700, (p) => {
      // FILL phase
      bottle.setFillAnim(targetFill * easeOut(p));
    }).then(() => {
      hintEl.textContent = holds
        ? `Pressurising past the ${TEST_PRESSURE} bar test...`
        : 'Pressurising the bottle...';
      // PRESSURISE phase: needle + bulge ramp up together toward the real burst.
      const dur = holds ? 1500 : 1700;
      return runPhase(dur, (p) => {
        const e = easeOutQuad(p);
        setNeedle(climbTo * e);
        // bulge intensity grows toward the burst; a fragile bottle that bursts low
        // still visibly strains. Normalised so the bulge reads full near rupture.
        bottle.setPressure(e);
        // late tremor when about to fail
        if (!holds && p > 0.7) bottle.setTremor((p - 0.7) / 0.3);
      });
    }).then(() => {
      if (holds) {
        // HOLD: settle the needle on the design's real burst value (above the mark).
        setNeedle(climbTo);
        bottle.setTremor(0);
        hintEl.textContent = `Held past ${TEST_PRESSURE} bar. Burst pressure ${round1(burstBar)} bar.`;
        return runPhase(420, () => {});   // brief beat before reveal
      }
      // BURST: needle rests on the real burst value, crack + particle puff.
      setNeedle(climbTo);
      bottle.burstNow();
      hintEl.textContent = `Burst at ${round1(burstBar)} bar (below the ${TEST_PRESSURE} bar test).`;
      return runPhase(820, () => {});     // let the rupture play
    });
  }

  // Compute REAL outputs from the surrogate (N-D predictFull), reveal, score,
  // verdict, callbacks. burstBar/holds are already computed for the animation.
  function reveal_(burstBar, holds, snap) {
    const p0 = snap || params;
    const outputs = {};
    for (const o of reveal) {
      const { mean } = surrogate.predictFull(o.name, p0);
      outputs[o.name] = Number.isFinite(mean) ? mean : 0;
    }
    // canonical scoreOf(...).score, computed from the SNAPSHOT the verdict and
    // gauge describe, never from controls mutated mid-animation.
    const score = scoreOf(surrogate, p0, primary.name, GOAL).score;
    lastState = { params: { ...p0 }, outputs, score };

    animateNumber(scoreEl, score, 600, (v) => Math.round(v).toString());
    scoreEl.classList.add(`${NS}-score--in`);
    for (const o of reveal) {
      animateNumber(outRows[o.name], outputs[o.name], 600, (v) => v.toFixed(decimalsFor(o)));
    }

    // verdict + result stamp on the rig. Both states name the REAL burst value so the
    // verdict matches the gauge needle and the readout (no fixed-number mismatch).
    verdictEl.textContent = holds
      ? `HELD, burst ${round1(burstBar)} bar`
      : `BURST at ${round1(burstBar)} bar`;
    verdictEl.className = `${NS}-verdict ${NS}-verdict--in ${holds ? `${NS}-verdict--ok` : `${NS}-verdict--bad`}`;
    stampEl.textContent = holds ? 'PASS' : 'FAIL';
    stampEl.className = `${NS}-stamp ${NS}-stamp--in ${holds ? `${NS}-stamp--pass` : `${NS}-stamp--fail`}`;

    if (score > bestScore) {
      bestScore = score;
      bestEl.textContent = `best so far ${Math.round(score)}`;
      bestEl.classList.add(`${NS}-best--up`);
      setTimeout(() => bestEl.classList.remove(`${NS}-best--up`), 700);
    }
    // V4: the score rewards hitting the rated test, then the lightest, cheapest
    // design that does (bottle's objective is a TARGET BAND on burst pressure,
    // not "higher is always better", plus weight/cost held down; see score.js
    // CONSTRAINTS.bottle).
    hintEl.innerHTML = `The score rewards hitting the ${TEST_PRESSURE} bar rated test, then the lightest, cheapest bottle that holds it.<br><span class="${NS}-hint-pitch">Predicted by the trained STOCHOS model in ~2 s, not a ~4 h solver run.</span>`;

    for (const cb of cbs) { try { cb(lastState); } catch (e) { /* noop */ } }
    return lastState;
  }

  goBtn.addEventListener('click', () => run());

  // initial frame
  onParam();
  setNeedle(0);

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
      hintEl.textContent = 'Shape the bottle, then run the load test.';
      gagSlot.innerHTML = '';
      onParam();
    },
    resize() { bottle.resize(); },
    destroy() {
      bottle.destroy();
      host.classList.remove(`${NS}-root`);
      host.innerHTML = '';
    },
  };

  if (typeof opts.onAttempt === 'function') controller.onAttempt(opts.onAttempt);
  return controller;
}

// A "nice" round tick step that yields ~5-7 major ticks across 0..max.
function niceStep(max) {
  const target = max / 6;                 // aim for ~6 intervals
  const pow = Math.pow(10, Math.floor(Math.log10(target || 1)));
  const candidates = [1, 2, 2.5, 5, 10].map((m) => m * pow);
  let best = candidates[0];
  for (const c of candidates) if (Math.abs(c - target) < Math.abs(best - target)) best = c;
  return best || 5;
}

// A timer-backed animation phase: drives onStep(progress 0..1) on rAF while the
// host is connected, and ALWAYS resolves via a setTimeout fallback (so a run never
// hangs when rAF is throttled headless). onStep gets a final p=1 call on settle.
function runPhase(ms, onStep) {
  return new Promise((resolve) => {
    const start = performance.now();
    let done = false;
    const fin = () => {
      if (done) return; done = true;
      try { onStep(1); } catch (e) { /* noop */ }
      resolve();
    };
    const step = (ts) => {
      if (done) return;
      const p = clamp01((ts - start) / ms);
      try { onStep(p); } catch (e) { /* noop */ }
      if (p < 1) requestAnimationFrame(step);
      else fin();
    };
    requestAnimationFrame(step);
    setTimeout(fin, ms + 120);   // hidden/headless-tab safety net
  });
}

// ===========================================================================
// BottleView: a Three.js parametric bottle (LatheGeometry revolved profile) that
// morphs live. Wall shows as an inner shell; material swaps the look; fill draws
// a liquid cylinder; pressure bulges the body; burst cracks + puffs particles.
// Custom azimuth/polar/dist orbit, auto-rotate, AUTO-FIT camera (no clipping),
// frustumCulled=false, rAF guarded by host.isConnected.
// ===========================================================================
class BottleView {
  constructor(el, accent) {
    this.el = el;
    this.accent = new THREE.Color(accent);
    this.t = 0; this.lastInput = 0;
    this.azimuth = -0.5; this.polar = 1.18;
    this.dist = 9.2;          // updated by auto-fit each rebuild
    this.userZoom = 1;        // multiplier the wheel adjusts (around the fitted dist)
    this.fitDist = 9.2;
    this.targetY = 0;         // camera look-at height (auto-fit centres the bottle)

    this.design = { heightFrac: 0.5, diameterFrac: 0.37, wallFrac: 0.4, materialIdx: 1, fillFrac: 0.8 };
    this.fillAnim = 0.8;      // animated liquid level (0..1 of body)
    this.pressure = 0;        // 0..1 bulge intensity
    this.tremor = 0;          // 0..1 pre-burst shake
    this.burst = false;
    this.burstT = -1;         // time the burst fired (for the crack/particle anim)

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.el.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
    this.renderer.domElement.setAttribute('role', 'img');
    this.renderer.domElement.setAttribute('aria-label', '3D animated load-test rig showing the bottle shape, its fill level, and the pressure test');

    this.scene = new THREE.Scene();
    // generous near/far (terrain.js pattern). FOV 40.
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.05, 2000);
    // WARM lights only (no blue rim). Ambient warm-grey, amber key, soft warm fill.
    this.scene.add(new THREE.AmbientLight(0xe8ddca, 0.85));
    const key = new THREE.DirectionalLight(0xffe9cf, 1.30); key.position.set(5, 10, 7); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffcf9a, 0.42); fill.position.set(-6, 3, -5); this.scene.add(fill);

    this.group = new THREE.Group(); this.scene.add(this.group);

    const matSpec = MATERIALS[this.design.materialIdx];
    this.outerMat = new THREE.MeshStandardMaterial({
      color: matSpec.color, roughness: matSpec.rough, metalness: matSpec.metal,
      transparent: matSpec.transparent, opacity: matSpec.opacity, side: THREE.DoubleSide,
    });
    this.innerMat = new THREE.MeshStandardMaterial({
      color: 0x100c06, roughness: 0.6, metalness: 0.0, side: THREE.BackSide,
      transparent: true, opacity: 0.5,
    });
    this.outer = new THREE.Mesh(new THREE.BufferGeometry(), this.outerMat);
    this.inner = new THREE.Mesh(new THREE.BufferGeometry(), this.innerMat);
    this.outer.frustumCulled = false; this.inner.frustumCulled = false;
    this.group.add(this.inner); this.group.add(this.outer);

    // liquid fill (a simple cylinder scaled to the body + fill level), warm amber
    this.fillMat = new THREE.MeshStandardMaterial({ color: this.accent, roughness: 0.25, metalness: 0.0, transparent: true, opacity: 0.80 });
    this.fillMesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 28, 1), this.fillMat);
    this.fillMesh.frustumCulled = false; this.group.add(this.fillMesh);

    // base pad so the bottle reads as standing on the rig
    const padMat = new THREE.MeshStandardMaterial({ color: 0x16130e, roughness: 0.9, metalness: 0.1 });
    this.pad = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.9, 0.18, 40), padMat);
    this.pad.frustumCulled = false; this.group.add(this.pad);

    // crack line (a thin amber/hot strip that appears on burst, illustrative)
    const crackMat = new THREE.MeshBasicMaterial({ color: 0xff5630, transparent: true, opacity: 0 });
    this.crack = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 1), crackMat);
    this.crackMat = crackMat;
    this.crack.frustumCulled = false; this.crack.visible = false; this.group.add(this.crack);

    // particle puff (Points) for the rupture
    this.PCOUNT = 90;
    const pgeo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(this.PCOUNT * 3);
    this.pVel = new Float32Array(this.PCOUNT * 3);
    pgeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    this.pMat = new THREE.PointsMaterial({ color: 0xffb006, size: 0.16, transparent: true, opacity: 0, depthWrite: false });
    this.particles = new THREE.Points(pgeo, this.pMat);
    this.particles.frustumCulled = false; this.particles.visible = false; this.group.add(this.particles);

    this._bind(); this.resize();
    this._ro = new ResizeObserver(() => this.resize()); this._ro.observe(this.el);
    this._alive = true;
    // prefers-reduced-motion: stop the AUTOMATIC idle auto-rotate only (see
    // _loop below); the render loop itself keeps running, since direct-drag
    // orbit and wheel-zoom on this canvas must stay responsive, and the brief
    // load-test / burst sequence is a bounded, user-triggered action, not a
    // continuous ambient loop. Live-updates if the OS setting changes mid-session.
    this._reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    this._mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    this._onReducedMotionChange = (e) => { this._reducedMotion = e.matches; };
    if (this._mq) {
      if (this._mq.addEventListener) this._mq.addEventListener('change', this._onReducedMotionChange);
      else if (this._mq.addListener) this._mq.addListener(this._onReducedMotionChange);
    }
    this._loop = this._loop.bind(this);
    this.rebuild();
    requestAnimationFrame(this._loop);
  }

  setDesign(d) {
    this.design = { ...this.design, ...d };
    this.applyMaterial();
    this.rebuild();
  }

  applyMaterial() {
    const m = MATERIALS[clampi(this.design.materialIdx, 0, MATERIALS.length - 1)];
    this.outerMat.color.set(m.color);
    this.outerMat.roughness = m.rough;
    this.outerMat.metalness = m.metal;
    this.outerMat.transparent = m.transparent;
    this.outerMat.opacity = m.opacity;
    this.outerMat.needsUpdate = true;
  }

  setFillAnim(v) { this.fillAnim = clamp01(v); this.layoutFill(); }
  setPressure(v) { this.pressure = clamp01(v); this.rebuild(); }
  setTremor(v) { this.tremor = clamp01(v); }

  setBurst(b) {
    this.burst = !!b;
    if (!b) {
      this.burstT = -1;
      this.crack.visible = false; this.crackMat.opacity = 0;
      this.particles.visible = false; this.pMat.opacity = 0;
      this.fillMat.color.set(this.accent);
      this.tremor = 0;
    }
  }

  // Fire the rupture: hot fill tint, crack strip on, seed a particle puff.
  burstNow() {
    this.burst = true;
    this.burstT = this.t;
    this.fillMat.color.set(0xff5630);
    // crack: place a vertical strip on the body surface facing the camera-ish side
    const ch = (this._bodyH || 4) * 0.6;
    this.crack.geometry.dispose();
    this.crack.geometry = new THREE.PlaneGeometry(0.1, ch);
    this.crack.position.set((this._bodyR || 1) * 0.92, (this._bodyH || 4) * 0.45, 0);
    this.crack.rotation.set(0, Math.PI / 2, 0.18);
    this.crack.visible = true; this.crackMat.opacity = 0.95;
    // seed particles at mid-body, blowing outward. Speeds are kept modest so the
    // VISIBLE puff stays inside the burst headroom the camera reserves (no off-frame
    // spray). The puff fades in ~1.2 s, so the reach is roughly sp * 0.4 world units.
    const r = this._bodyR || 1, h = (this._bodyH || 4) * 0.5;
    for (let i = 0; i < this.PCOUNT; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = r * (0.9 + Math.random() * 0.2);
      this.pPos[i * 3] = Math.cos(a) * rr;
      this.pPos[i * 3 + 1] = h + (Math.random() - 0.5) * h * 0.9;
      this.pPos[i * 3 + 2] = Math.sin(a) * rr;
      const sp = 1.1 + Math.random() * 1.3;
      this.pVel[i * 3] = Math.cos(a) * sp;
      this.pVel[i * 3 + 1] = (Math.random() * 0.8 + 0.2) * sp * 0.5;
      this.pVel[i * 3 + 2] = Math.sin(a) * sp;
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
    this.particles.visible = true; this.pMat.opacity = 1;
  }

  // Build the lathe profile from the current design and revolve it. Wall thickness
  // insets the body; pressure bulges the mid-body outward. Then AUTO-FIT the camera.
  rebuild() {
    const d = this.design;
    const bodyH = 2.2 + d.heightFrac * 3.4;        // world height of the body
    const bodyR = 0.9 + d.diameterFrac * 1.5;      // world radius of the body
    const neckR = Math.max(0.28, bodyR * 0.34);
    const neckH = 0.55 + d.heightFrac * 0.5;
    const shoulderH = bodyH * 0.22;
    const wall = 0.04 + d.wallFrac * 0.22;         // visual wall thickness
    const bulge = this.pressure * (0.14 + 0.10 * d.diameterFrac);

    const prof = [];
    const push = (r, y) => prof.push(new THREE.Vector2(Math.max(0.001, r), y));
    push(0.0, 0.0);
    push(bodyR * 0.96, 0.0);
    push(bodyR, bodyH * 0.06);
    const seg = 8;
    for (let i = 0; i <= seg; i++) {
      const tt = i / seg;
      const y = bodyH * 0.06 + tt * (bodyH - shoulderH - bodyH * 0.06);
      const mid = 1 - Math.abs(tt - 0.5) * 2;
      push(bodyR + bulge * mid, y);
    }
    push(bodyR, bodyH - shoulderH);
    push(neckR * 1.15, bodyH - shoulderH * 0.35);
    push(neckR, bodyH);
    push(neckR, bodyH + neckH);
    push(neckR * 1.12, bodyH + neckH);
    push(neckR * 1.12, bodyH + neckH + 0.08);
    push(0.0, bodyH + neckH + 0.08);

    const outerGeo = new THREE.LatheGeometry(prof, 64);
    outerGeo.computeVertexNormals();
    this.outer.geometry.dispose(); this.outer.geometry = outerGeo;

    const innerProf = prof.map((p) => new THREE.Vector2(Math.max(0.001, p.x - wall), p.y));
    const innerGeo = new THREE.LatheGeometry(innerProf, 64);
    innerGeo.computeVertexNormals();
    this.inner.geometry.dispose(); this.inner.geometry = innerGeo;

    const totalH = bodyH + neckH + 0.08;
    const maxR = bodyR + bulge;     // widest radius (includes bulge)
    this._bodyH = bodyH; this._bodyR = bodyR; this._neckTop = totalH;
    this._wall = wall;
    // where the straight body ends and the shoulder starts tapering toward the neck.
    // The liquid must never rise above this, or a full-radius cylinder pokes through
    // the tapered shoulder walls (one of the "clips out of the bottle" cases).
    this._shoulderStart = bodyH - shoulderH;

    // recentre the group vertically so it orbits around its middle.
    // The visible envelope runs from the PAD bottom up to the NECK top: the group
    // is offset so this whole envelope is centred on world y=0, which is also the
    // camera look-at. (Previously only the bottle was centred, the pad hung below.)
    const padBottom = -0.09 - PAD_H * 0.5;          // lowest point of the pad in group space (centre -0.09)
    const envTop = totalH;                          // neck top in group space
    const envMid = (envTop + padBottom) * 0.5;      // centre of the full envelope
    this._envHalf = (envTop - padBottom) * 0.5;     // half-height of the full envelope
    this.group.position.y = -envMid;                // put the envelope centre at world 0
    this.pad.position.y = 0 - 0.09;
    this.layoutFill();

    // ---- AUTO-FIT: pull the camera back so the whole rig always fits with margin ----
    this._fitCamera(maxR);
  }

  // Compute the camera distance that frames the FULL rig (pad -> neck top, plus a
  // burst-particle headroom allowance) with margin, in BOTH the vertical and
  // horizontal FOV, so nothing ever clips, static OR mid-burst. The wheel-zoom
  // multiplies this fitted distance (so zoom stays sane at any size).
  //
  // The envelope is centred on the camera look-at (world y=0), so we frame half the
  // envelope height each way. We add a fixed allowance for the burst puff, which can
  // spray a short distance beyond the bottle radius/top at the moment of rupture.
  _fitCamera(maxR) {
    const aspect = (Number.isFinite(this.camera.aspect) && this.camera.aspect > 0) ? this.camera.aspect : 1;
    const vFov = (this.camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const MARGIN = 1.18;                  // 18% breathing room around the rig
    const BURST = BURST_HEADROOM;         // extra room for the rupture puff (both axes)
    // envelope is centred on the look-at, so half-extent each way + burst allowance
    const halfH = (this._envHalf + BURST) * MARGIN;
    const halfW = (maxR + 0.2 + BURST) * MARGIN; // +pad lip + burst spray
    const distV = halfH / Math.tan(vFov / 2);
    const distH = halfW / Math.tan(hFov / 2);
    let dist = Math.max(distV, distH);
    if (!Number.isFinite(dist) || dist <= 0) dist = 9.2;
    this.fitDist = dist;
    this.dist = dist * this.userZoom;
  }

  // place the liquid cylinder inside the body at the current fill level.
  // The fill is a straight cylinder, so it must stay BELOW the shoulder (where the
  // walls taper in) and INSIDE the inner wall radius, at every height/diameter/wall
  // combination. We cap the top at the shoulder start and inset the radius by the
  // wall + a hair, so the liquid never renders past the bottle geometry, even at
  // 100% fill on the tallest/widest bottle.
  layoutFill() {
    if (!this._bodyH) return;
    const r = Math.max(0.05, this._bodyR - this._wall - 0.05);
    // usable straight-body column the liquid can occupy (floor 0.03 -> shoulder start)
    const floor = 0.03;
    const ceil = Math.max(floor + 0.04, (this._shoulderStart || this._bodyH) - 0.05);
    const h = Math.max(0.02, Math.min(this.fillAnim * (ceil - floor), ceil - floor));
    this.fillMesh.scale.set(r, h, r);
    this.fillMesh.position.y = floor + h * 0.5;
    this.fillMesh.visible = this.fillAnim > 0.01;
  }

  _bind() {
    const dom = this.renderer.domElement; let px = 0, py = 0, down = false;
    dom.addEventListener('pointerdown', (e) => { down = true; px = e.clientX; py = e.clientY; this.lastInput = this.t; });
    window.addEventListener('pointerup', this._up = () => { down = false; });
    dom.addEventListener('pointermove', (e) => {
      if (!down) return; this.lastInput = this.t;
      this.azimuth -= (e.clientX - px) * 0.006;
      this.polar = clamp(this.polar - (e.clientY - py) * 0.005, 0.55, 1.55);
      px = e.clientX; py = e.clientY;
    });
    dom.addEventListener('wheel', this._wheel = (e) => {
      e.preventDefault();
      // zoom is a multiplier around the auto-fit distance, clamped to a sane band
      this.userZoom = clamp(this.userZoom + e.deltaY * 0.0011, 0.6, 2.2);
      this.dist = this.fitDist * this.userZoom;
      this.lastInput = this.t;
    }, { passive: false });
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height;
    if (!Number.isFinite(this.camera.aspect) || this.camera.aspect <= 0) this.camera.aspect = 1;
    this.camera.updateProjectionMatrix();
    // re-fit because horizontal framing depends on aspect. Use the live envelope
    // half-height + the widest current radius (incl. any active bulge).
    const maxR = (this._bodyR || 1) + this.pressure * (0.14 + 0.10 * this.design.diameterFrac);
    if (this._envHalf == null) this._envHalf = (this._neckTop || 5) * 0.5;
    this._fitCamera(maxR);
  }

  _loop(ts) {
    if (!this.el.isConnected || !this._alive) { this._ro.disconnect(); return; }
    const dt = this.t ? Math.min(0.05, ts * 0.001 - this.t) : 0.016;
    this.t = ts * 0.001;
    if (!this._reducedMotion && this.t - this.lastInput > 2.5) this.azimuth += 0.0022;   // gentle auto-rotate

    // guard the camera math against NaN
    if (!Number.isFinite(this.azimuth)) this.azimuth = -0.5;
    if (!Number.isFinite(this.polar)) this.polar = 1.18;
    if (!Number.isFinite(this.dist) || this.dist <= 0) this.dist = this.fitDist || 9.2;

    const s = Math.sin(this.polar) * this.dist;
    let px = Math.sin(this.azimuth) * s;
    const py = Math.cos(this.polar) * this.dist;
    let pz = Math.cos(this.azimuth) * s;

    // pre-burst tremor: tiny camera shake (illustrative strain)
    if (this.tremor > 0 && !this.burst) {
      const j = this.tremor * 0.05;
      px += (Math.random() - 0.5) * j;
      pz += (Math.random() - 0.5) * j;
    }

    if (Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(pz)) {
      // Look at world y=0, which rebuild() set to the centre of the full envelope
      // (pad bottom -> neck top). Framing is symmetric, so the auto-fit's half-extent
      // is honoured both ways and nothing clips. No vertical offset here on purpose.
      this.camera.position.set(px, py, pz);
      this.camera.lookAt(0, 0, 0);
    }

    // crack fade + particle integration after a burst
    if (this.burst && this.burstT >= 0) {
      const age = this.t - this.burstT;
      this.crackMat.opacity = clamp01(0.95 - age * 0.55);
      if (this.particles.visible) {
        this.pMat.opacity = clamp01(1 - age * 0.85);
        for (let i = 0; i < this.PCOUNT; i++) {
          this.pVel[i * 3 + 1] -= 6.0 * dt;            // gravity
          this.pPos[i * 3] += this.pVel[i * 3] * dt;
          this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
          this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
        }
        this.particles.geometry.attributes.position.needsUpdate = true;
        if (age > 1.6) { this.particles.visible = false; }
      }
    }

    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this._loop);
  }

  destroy() {
    this._alive = false;
    if (this._ro) this._ro.disconnect();
    if (this._up) window.removeEventListener('pointerup', this._up);
    if (this._mq) {
      if (this._mq.removeEventListener) this._mq.removeEventListener('change', this._onReducedMotionChange);
      else if (this._mq.removeListener) this._mq.removeListener(this._onReducedMotionChange);
    }
    try {
      this.outer.geometry.dispose(); this.inner.geometry.dispose();
      this.fillMesh.geometry.dispose(); this.pad.geometry.dispose();
      this.crack.geometry.dispose(); this.particles.geometry.dispose();
      this.outerMat.dispose(); this.innerMat.dispose(); this.fillMat.dispose();
      this.crackMat.dispose(); this.pMat.dispose();
      this.renderer.dispose();
      // release the GL context immediately; GC on real GPUs can lag mount/unmount
      // cycles and hit the browser's active-context ceiling
      if (this.renderer.forceContextLoss) this.renderer.forceContextLoss();
    } catch (e) { /* noop */ }
    if (this.renderer.domElement.parentNode) this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
  }
}

// ===========================================================================
// DOM builders
// ===========================================================================
function buildSlider(parent, input, params, onChange) {
  const wrap = document.createElement('label');
  wrap.className = `${NS}-slider`;
  const dec = stepDecimals(input);
  wrap.innerHTML = `
    <span class="${NS}-s-top">
      <span class="${NS}-s-label">${input.label}</span>
      <span class="${NS}-s-val"><b data-v></b> <i>${input.unit && input.unit !== '-' ? input.unit : ''}</i></span>
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

function buildSwatches(parent, materials, getIdx, onPick) {
  parent.setAttribute('role', 'group');
  parent.setAttribute('aria-label', 'Material');
  materials.forEach((m, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `${NS}-swatch`;
    b.setAttribute('aria-pressed', 'false');
    b.innerHTML = `
      <span class="${NS}-swatch-dot" style="background:${m.swatch}"></span>
      <span class="${NS}-swatch-name">${m.name}</span>
      <span class="${NS}-swatch-check" aria-hidden="true">&#10003;</span>`;
    b.addEventListener('click', () => onPick(i));
    parent.appendChild(b);
  });
  const cur = Math.round(getIdx());
  parent.querySelectorAll(`.${NS}-swatch`).forEach((el, i) => {
    const on = i === cur;
    el.classList.toggle(`${NS}-swatch--on`, on);
    el.setAttribute('aria-pressed', String(on));
  });
}

// ===========================================================================
// helpers
// ===========================================================================
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function clampi(v, a, b) { return Math.max(a, Math.min(b, v | 0)); }
function clamp01(v) { return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0)); }
function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
function easeOutQuad(t) { return 1 - (1 - t) * (1 - t); }
function round1(v) { return Math.round(v * 10) / 10; }
function frac(v, input) {
  const f = (v - input.min) / (input.max - input.min || 1);
  return clamp01(f);
}
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function hexA(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
function stepOf(input) {
  // the schema-declared step is the fairness contract: STOCHOS, beatRate, and
  // this control all snap to the SAME grid (see snapInput in surrogate.js).
  // The span heuristic below is only the fallback for inputs without one.
  if (input.step > 0) return input.step;
  const span = input.max - input.min;
  if (span <= 2.2) return 0.05;
  if (span <= 20) return 0.5;
  return 1;
}
function stepDecimals(input) { const s = stepOf(input); return s < 0.1 ? 2 : s < 1 ? 1 : 0; }
function decimalsFor(o) {
  if (o.unit === 'rel') return 2;
  if (o.unit === 'bar') return 1;
  return 0;
}
function animateNumber(el, to, ms, fmt) {
  const from = parseFloat((el.textContent || '0').replace(/[^0-9.-]/g, '')) || 0;
  const start = performance.now();
  let done = false;
  const settle = () => { if (done) return; done = true; el.textContent = fmt(to); };
  function step(ts) {
    if (done) return;
    const p = clamp01((ts - start) / ms);
    const e = easeOut(p);
    el.textContent = fmt(from + (to - from) * e);
    if (p < 1 && el.isConnected) requestAnimationFrame(step);
    else settle();
  }
  requestAnimationFrame(step);
  setTimeout(settle, ms + 120);   // headless safety net
}

// ===========================================================================
// scoped style
// ===========================================================================
function injectStyle(accent) {
  if (document.getElementById(STYLE_ID)) return;
  const css = `
.${NS}-root { color:#f5f5f7; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif; }
.${NS}-grid { display:grid; grid-template-columns: minmax(220px,1fr) minmax(300px,1.4fr) minmax(220px,1fr); gap:14px; align-items:stretch; }
@media (max-width: 860px){ .${NS}-grid{ grid-template-columns:1fr; } }
.${NS}-panel { background:#0c0c0e; border:1px solid rgba(255,255,255,0.10); border-radius:16px; padding:16px; display:flex; flex-direction:column; min-width:0; }
.${NS}-eyebrow { font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:#8a8a82; margin-bottom:12px; }
.${NS}-sliders { display:flex; flex-direction:column; gap:14px; }
.${NS}-slider { display:flex; flex-direction:column; gap:6px; }
.${NS}-s-top { display:flex; justify-content:space-between; align-items:baseline; font-size:13px; }
.${NS}-s-label { color:#f5f5f7; }
.${NS}-s-val { font-family:ui-monospace,"SF Mono",Consolas,monospace; color:${accent}; }
.${NS}-s-val i { color:#8a8a82; font-style:normal; font-size:11px; }
.${NS}-root input[type=range]{ -webkit-appearance:none; appearance:none; width:100%; height:4px; border-radius:3px; background:rgba(255,255,255,0.12); outline:none; }
.${NS}-root input[type=range]::-webkit-slider-thumb{ -webkit-appearance:none; width:16px; height:16px; border-radius:50%; background:${accent}; cursor:pointer; box-shadow:0 0 0 4px ${hexA(accent, 0.18)}; }
.${NS}-root input[type=range]::-moz-range-thumb{ width:16px; height:16px; border:none; border-radius:50%; background:${accent}; cursor:pointer; }
.${NS}-matblock { margin-top:18px; border-top:1px solid rgba(255,255,255,0.08); padding-top:14px; }
.${NS}-matblock-head { font-size:11px; color:#b0b0a8; margin-bottom:12px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.${NS}-illus { font-size:9px; letter-spacing:.08em; text-transform:uppercase; color:#8a8a82; border:1px solid rgba(255,255,255,0.16); border-radius:999px; padding:1px 7px; }
.${NS}-swatches { display:flex; gap:10px; }
.${NS}-swatch { position:relative; flex:1; appearance:none; cursor:pointer; background:#121214; border:1px solid rgba(255,255,255,0.12); border-radius:12px; padding:10px 6px; display:flex; flex-direction:column; align-items:center; gap:7px; color:#b0b0a8; transition:border-color .15s ease, background .15s ease, color .15s ease; }
.${NS}-swatch:hover { border-color:rgba(255,255,255,0.28); }
.${NS}-swatch--on { border-color:${accent}; background:${hexA(accent, 0.10)}; color:#f5f5f7; box-shadow:0 0 0 1px ${hexA(accent, 0.4)} inset; }
.${NS}-swatch-dot { width:26px; height:26px; border-radius:50%; border:1px solid rgba(0,0,0,0.4); box-shadow:inset 0 2px 5px rgba(255,255,255,0.45), inset 0 -3px 6px rgba(0,0,0,0.4); }
.${NS}-swatch-name { font-size:11px; }
/* selected-state marker that is not color-only (a11y pass): a small badge that
   appears/disappears, on top of the existing border+fill+glow treatment. */
.${NS}-swatch-check { position:absolute; top:6px; right:6px; width:14px; height:14px; border-radius:50%;
  display:flex; align-items:center; justify-content:center; font-size:9px; line-height:1; color:#1a0d05;
  background:${accent}; opacity:0; transform:scale(0.6); transition:opacity .15s ease, transform .15s ease; }
.${NS}-swatch--on .${NS}-swatch-check { opacity:1; transform:scale(1); }
.${NS}-stage { position:relative; }
.${NS}-canvaswrap { position:relative; flex:1; min-height:250px; }
/* ---- pressure gauge: a panel BELOW the bottle (dial + digital read + rated tick),
   styled to match the reactor's bench panel instead of a floating canvas overlay ---- */
.${NS}-gauge { display:flex; align-items:center; gap:18px; margin-top:12px; padding:12px 16px; border:1px solid rgba(255,255,255,0.10); border-radius:14px; background:linear-gradient(180deg, rgba(255,180,84,0.05), rgba(0,0,0,0)); }
.${NS}-gauge-dial { width:152px; height:92px; flex:none; display:block; }
.${NS}-gauge-side { display:flex; flex-direction:column; gap:6px; min-width:0; }
.${NS}-gauge-title { font-size:9px; letter-spacing:.13em; text-transform:uppercase; color:#9a9a92; }
.${NS}-gauge-read { display:flex; align-items:baseline; gap:5px; font-family:ui-monospace,monospace; white-space:nowrap; }
.${NS}-gauge-read-cap { font-size:8px; letter-spacing:.1em; text-transform:uppercase; color:#8a8a82; }
.${NS}-gauge-read b { color:${accent}; font-size:27px; line-height:1; }
.${NS}-gauge-read-unit { font-size:11px; color:#8a8a82; }
.${NS}-gauge-rated { display:flex; align-items:center; gap:7px; font-size:10.5px; font-family:ui-monospace,monospace; color:#b0b0a8; white-space:nowrap; }
.${NS}-gauge-rated b { color:#ff9c84; }
.${NS}-gauge-rated-dot { width:8px; height:8px; border-radius:2px; flex:none; background:#ff7a5c; box-shadow:0 0 6px rgba(255,122,92,0.8); }
.${NS}-verdict { position:absolute; right:12px; top:12px; font-size:12px; font-weight:700; letter-spacing:.04em; font-family:ui-monospace,monospace; padding:6px 12px; border-radius:999px; border:1px solid transparent; opacity:0; transform:translateY(-4px); transition:opacity .25s ease, transform .25s ease; pointer-events:none; z-index:3; }
.${NS}-verdict--in { opacity:1; transform:translateY(0); }
.${NS}-verdict--ok { color:#7be0a3; border-color:rgba(123,224,163,0.4); background:rgba(123,224,163,0.10); }
.${NS}-verdict--bad { color:#ff7a5c; border-color:rgba(255,122,92,0.4); background:rgba(255,122,92,0.10); }
.${NS}-stamp { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%) rotate(-14deg) scale(1.5); font-family:ui-monospace,monospace; font-weight:800; font-size:40px; letter-spacing:.08em; opacity:0; pointer-events:none; z-index:3; }
.${NS}-stamp--in { animation:${NS}-stamp .5s var(--ease-out, cubic-bezier(.16,.84,.32,1)) forwards; }
.${NS}-stamp--pass { color:rgba(123,224,163,0.82); text-shadow:0 0 24px rgba(123,224,163,0.5); border:3px solid rgba(123,224,163,0.6); border-radius:10px; padding:4px 16px; }
.${NS}-stamp--fail { color:rgba(255,122,92,0.86); text-shadow:0 0 24px rgba(255,122,92,0.55); border:3px solid rgba(255,122,92,0.6); border-radius:10px; padding:4px 16px; }
@keyframes ${NS}-stamp{ 0%{ opacity:0; transform:translate(-50%,-50%) rotate(-14deg) scale(1.9);} 100%{ opacity:1; transform:translate(-50%,-50%) rotate(-14deg) scale(1);} }
.${NS}-go { margin-top:12px; appearance:none; border:none; cursor:pointer; border-radius:2px; padding:13px 20px; font-size:14px; font-weight:600; letter-spacing:.01em; color:#08070A; background:${accent}; transition:filter .18s ease, transform .18s ease; }
.${NS}-go:hover{ filter:brightness(1.08); transform:translateY(-1px); }
.${NS}-go:active{ transform:translateY(0); }
.${NS}-go:disabled{ cursor:default; filter:grayscale(.3) brightness(.85); }
.${NS}-go--busy{ animation:${NS}-pulse 1.2s ease-in-out infinite; }
@keyframes ${NS}-pulse{ 0%,100%{ opacity:1;} 50%{ opacity:.72;} }
.${NS}-gagslot { margin-top:10px; }
.${NS}-gag { background:#121214; border:1px solid rgba(255,255,255,0.12); border-radius:12px; padding:12px; }
.${NS}-gag-q { font-size:12px; color:#d2d2cc; margin-bottom:10px; }
.${NS}-gag-btns { display:flex; gap:10px; }
.${NS}-gagbtn { flex:1; appearance:none; cursor:pointer; border-radius:4px; padding:10px 12px; font-size:13px; font-weight:600; border:1px solid rgba(255,255,255,0.18); background:#1a1a1e; color:#e8e8ea; transition:filter .15s ease, transform .12s ease, border-color .15s ease; display:flex; flex-direction:column; align-items:center; gap:4px; }
.${NS}-gagbtn-main { font-size:13px; font-weight:650; }
.${NS}-gagbtn-time { font-size:10px; font-family:ui-monospace,monospace; padding:1px 7px; border-radius:999px; }
.${NS}-gagbtn-time--slow { color:#ff9c84; background:rgba(255,122,92,0.14); }
.${NS}-gagbtn-time--fast { color:#1a1205; background:rgba(26,18,5,0.22); }
.${NS}-gagbtn--solver:hover { border-color:rgba(255,255,255,0.4); }
.${NS}-gagbtn--stochos { border:1px solid ${accent}; color:#08070A; background:${accent}; }
.${NS}-gagbtn:hover { filter:brightness(1.08); transform:translateY(-1px); }
.${NS}-gag-pitch { margin-top:11px; font-size:11px; line-height:1.55; color:#b0b0a8; border:1px solid ${hexA(accent, 0.3)}; background:${hexA(accent, 0.06)}; border-radius:8px; padding:8px 10px; }
.${NS}-gag-pitch b { color:${accent}; font-weight:650; }
.${NS}-gag-note { margin-top:9px; font-size:10px; line-height:1.5; color:#8a8a82; }
.${NS}-solver { background:#121214; border:1px solid rgba(255,255,255,0.12); border-radius:12px; padding:12px; position:relative; }
.${NS}-solver-head { display:flex; justify-content:space-between; align-items:baseline; gap:8px; font-size:12px; color:#d2d2cc; }
.${NS}-solver-eta { font-family:ui-monospace,monospace; font-size:11px; color:#ff7a5c; }
.${NS}-solver-bar { margin-top:10px; height:8px; border-radius:999px; background:rgba(255,255,255,0.10); overflow:hidden; }
/* width-transition kept intentionally: JS sets fill.style.width directly
   (the "~4h solver" crawl), so a transform-based reveal would not track it */
.${NS}-solver-fill { height:100%; width:1%; border-radius:999px; background:linear-gradient(90deg, #ff7a5c, #ffb006); transition:width 3s var(--ease-out, cubic-bezier(.16,.84,.32,1)); }
.${NS}-solver-sub { margin-top:8px; font-size:10px; color:#8a8a82; font-family:ui-monospace,monospace; }
.${NS}-popup { margin-top:12px; background:#1a1a1e; border:1px solid ${hexA(accent, 0.5)}; border-radius:10px; padding:11px 12px; display:flex; align-items:center; gap:10px; justify-content:space-between; opacity:0; transform:translateY(8px); transition:opacity .3s ease, transform .3s ease; }
.${NS}-popup--in { opacity:1; transform:translateY(0); }
.${NS}-popup-msg { font-size:12px; color:#ececee; }
.${NS}-popup-btn { appearance:none; cursor:pointer; border:none; border-radius:2px; padding:8px 14px; font-size:12px; font-weight:600; color:#08070A; background:${accent}; white-space:nowrap; transition:filter .18s ease, transform .18s ease; }
.${NS}-popup-btn:hover { filter:brightness(1.08); transform:translateY(-1px); }
.${NS}-spin { display:flex; align-items:center; gap:12px; background:#121214; border:1px solid rgba(255,255,255,0.12); border-radius:12px; padding:14px; }
.${NS}-spin-ring { width:26px; height:26px; border-radius:50%; border:3px solid ${hexA(accent, 0.25)}; border-top-color:${accent}; animation:${NS}-spin 0.8s linear infinite; }
@keyframes ${NS}-spin{ to{ transform:rotate(360deg);} }
.${NS}-spin-label { font-size:13px; color:#ececee; font-family:ui-monospace,monospace; }
.${NS}-readout { gap:0; }
/* centre the score+outputs+hint group in the tall panel (see paint note) */
.${NS}-scorewrap { margin-top:auto; display:flex; flex-direction:column; align-items:center; padding:6px 0 14px; border-bottom:1px solid rgba(255,255,255,0.08); margin-bottom:12px; position:relative; }
.${NS}-score { font-family:ui-monospace,monospace; font-size:58px; line-height:1; font-weight:700; color:#3a3a36; transition:color .3s ease; }
.${NS}-score--in { color:${accent}; text-shadow:0 0 24px ${hexA(accent, 0.45)}; }
.${NS}-score-cap { font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:#8a8a82; margin-top:4px; }
.${NS}-best { font-size:11px; color:#b0b0a8; margin-top:8px; font-family:ui-monospace,monospace; }
.${NS}-best--up { color:${accent}; }
.${NS}-outs { display:flex; flex-direction:column; gap:10px; }
.${NS}-outrow { display:grid; grid-template-columns: 1fr auto auto; align-items:baseline; gap:6px; font-size:13px; }
.${NS}-out-label { color:#b0b0a8; }
.${NS}-out-val { font-family:ui-monospace,monospace; font-size:17px; color:#f5f5f7; text-align:right; }
.${NS}-out-unit { color:#8a8a82; font-size:11px; }
.${NS}-hint { margin-bottom:auto; padding-top:14px; font-size:11px; color:#8a8a82; line-height:1.5; }
.${NS}-hint-pitch { color:${accent}; opacity:0.92; }
`;
  const tag = document.createElement('style');
  tag.id = STYLE_ID;
  tag.textContent = css;
  document.head.appendChild(tag);
}
