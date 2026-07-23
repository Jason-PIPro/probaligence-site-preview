// "Beat Stochos" challenge: a demo-game that hands off to the Flow studio.
// Acts: pick industry -> intro (story + dataset peek) -> YOUR TURN (an animated
// instrument you play, lock your best) -> STOCHOS TURN (build its workflow in the
// studio, or watch it optimize live) -> SHOWDOWN (you vs Stochos). PI website brand.
import { loadDomain } from '../surrogate.js';
import { PRIMARY, scoreOf, outputsFull, beatRate, stochosRun, constraintCfg } from '../challenge/score.js';

// industry -> { data json, instrument module, copy }
// Single amber accent per brand rule (was 3 distinct hexes, 2 off-brand);
// all three challenge domains now share the one accent, #ffb006.
const CH = {
  paint: {
    data: 'paint', instrument: '../challenge/instrument-paint.js', accent: '#ffb006',
    img: 'assets/cases/paint-roller.webp',
    tag: 'Paint & coatings', title: 'Formulate the best coating', verb: 'Mix a paint',
    blurb: 'Formulate an interior wall paint for the highest hiding power. Beat the model that learned from the lab data.',
    story: 'You are formulating an interior wall paint. Set the recipe, run it, and read the hiding power. Can you beat the model that learned from the lab data?',
    task: 'Tune the formulation for the highest hiding power.',
  },
  chemistry: {
    data: 'chemistry', instrument: '../challenge/instrument-reactor.js', accent: '#ffb006',
    img: 'assets/cases/chemistry-flask.webp',
    tag: 'Chemistry', title: 'Push a reaction to higher yield', verb: 'Run the reaction',
    blurb: 'You run a reaction that makes a specialty pharma intermediate. Too much is wasted. Tune the conditions to lift the yield and beat STOCHOS.',
    story: 'You are a process chemist making a specialty pharma intermediate, the building block that goes into the final drug. Right now the reaction wastes too much: low yield means starting material burned off as by-products and less product in the flask, so higher cost and more waste per batch. Your job is to lift the yield by tuning the PROCESS (temperature, catalyst loading, residence time, addition rate) and the FORMULATION (solvent ratio, concentration, cosolvent, base equivalents), while keeping selectivity in spec and cost down. Run the reaction, read the yield, and see if you can beat STOCHOS.',
    task: 'Tune the conditions for the highest yield.',
  },
  engineering: {
    data: 'bottle', instrument: '../challenge/instrument-bottle.js', accent: '#ffb006',
    img: 'assets/cases/bottle-rig.webp',
    tag: 'Engineering', title: 'Design a bottle that survives', verb: 'Run a load test',
    blurb: 'Design a plastic bottle that passes a 26 bar pressure test with the least material. Reshape it, pick a material, and beat STOCHOS.',
    story: 'You are designing a plastic bottle that must pass a 26 bar rated pressure test. The win is not the highest burst pressure: it is the lightest, cheapest bottle that still holds. Reshape it, pick a material, and test it. Can you beat STOCHOS?',
    task: 'Shape the bottle to hold 26 bar at the lowest weight and cost.',
  },
};

// the real trade-off behind each primary objective, spelled out so the goal is
// concrete (not just "maximise the primary output"). Used on the STOCHOS screen.
const OBJECTIVE_LEAD = {
  paint: 'Goal: maximise hiding power, keeping gloss and viscosity in spec and cost down.',
  chemistry: 'Goal: maximise yield, keeping selectivity in spec and raw-material cost down. Higher yield means less waste and more product per batch.',
  engineering: 'Goal: pass the 26 bar rated pressure test with the lightest, cheapest bottle. Bursting well above 26 bar wastes material for no extra score.',
};

// Quiet identity marks for the picker cards: minimal geometric line art, single
// amber accent, aria-hidden. Replaces the old blurred-glow blob at card bottom.
const CH_MARK = {
  paint: `<svg viewBox="0 0 28 28" fill="none" stroke="rgba(255,176,6,.55)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="6" width="15" height="7" rx="2"/><line x1="11.5" y1="13" x2="11.5" y2="18"/><line x1="11.5" y1="18" x2="20" y2="24"/></svg>`,
  chemistry: `<svg viewBox="0 0 28 28" fill="none" stroke="rgba(255,176,6,.55)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4h6"/><path d="M12 4v7l-6.2 10.8c-.9 1.6.2 3.6 2 3.6h10.4c1.8 0 2.9-2 2-3.6L14 11V4"/><path d="M9.2 17.5h9.6"/></svg>`,
  // the challenge's "engineering" case is the pressure-test bottle: a bottle
  // outline with inward pressure arrows.
  engineering: `<svg viewBox="0 0 28 28" fill="none" stroke="rgba(255,176,6,.55)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 3h6v4l2 3v13a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2V10l2-3V3z"/><line x1="2.5" y1="8" x2="7.5" y2="8"/><polyline points="5.5,5.7 7.7,8 5.5,10.3"/><line x1="25.5" y1="8" x2="20.5" y2="8"/><polyline points="22.3,5.7 20.1,8 22.3,10.3"/></svg>`,
};

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (v, d = 1) => (v == null || !isFinite(v)) ? '--' : Number(v).toFixed(d);
// Treat data- and storage-derived strings as untrusted before they enter innerHTML.
// esc() HTML-escapes; sc() coerces a score to a safe integer (0 if not finite). The
// challengeShowdown / challengeCtx restore path is attacker-writable via sessionStorage,
// so every score/label that reaches innerHTML on that path is run through these.
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
// clamped to 0..100 (adversarial audit: a forged sessionStorage score otherwise
// rendered as "1000000000000/100"; legitimate paths are always 0..100 already).
function sc(v) { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0; }
// decimals per output unit, kept consistent with the instruments' readouts
function decFor(o) {
  const u = (o.unit || '').toLowerCase();
  if (u === 'g' || u === 'cycles' || u.indexOf('mpa') === 0) return 0;
  if (u === '%' || u === 'bar' || u === 'gu') return 1;
  return 2; // rel, EUR/kg, etc.
}

// V4: compact one-line constraint-compliance readout, built straight from a
// scoreOf() / stochosRun() terms array (score.js compositeObjective). This is
// the honest "did the win actually hold the promises" readout: spec terms
// (viscosity/gloss/selectivity bands) show a quiet tick when in band or a
// muted warning when out; minimize terms (cost/weight, no band) show plainly
// with no marker, since there is nothing to pass or fail. terms is null on a
// legacy (non-constrained) domain, in which case this renders nothing.
export function complianceChipsHTML(surrogate, terms) {
  // adversarial audit: a tampered sessionStorage breakdown (non-array, or an
  // array holding null) threw here, and the catch in mountChallenge silently
  // dropped the whole showdown to the picker; malformed terms now just render
  // no chips instead.
  if (!Array.isArray(terms)) return '';
  terms = terms.filter((t) => t && typeof t === 'object');
  if (!terms.length) return '';
  const chips = terms.map((t) => {
    const o = surrogate.outputs.find((oo) => oo.name === t.out);
    const label = esc(o ? (o.label || o.name) : t.out);
    const unit = o && o.unit ? ` ${esc(o.unit)}` : '';
    const dec = o ? decFor(o) : 1;
    const val = fmt(t.value, dec);
    if (t.kind === 'spec') {
      const ok = t.inSpec !== false;
      // band bounds are the plain config numbers (900, 2100, 24, 42, ...); show
      // them without a synthetic ".0" when both ends are whole, even if the
      // measured value itself carries a decimal (e.g. gloss 25.6 in band 24-42).
      const bandDec = (Number.isInteger(t.lo) && Number.isInteger(t.hi)) ? 0 : dec;
      const band = `${fmt(t.lo, bandDec)}-${fmt(t.hi, bandDec)}`;
      return `<span class="ch-comp-chip ${ok ? 'ok' : 'bad'}">` +
        `<span class="ch-comp-mark" aria-hidden="true">${ok ? '&#10003;' : '&#9888;'}</span>` +
        `${label} ${val}${unit}, ${ok ? `in band ${band}` : `out of spec (band ${band})`}</span>`;
    }
    return `<span class="ch-comp-chip quiet">${label} ${val}${unit}</span>`;
  }).join('');
  return `<div class="ch-comp-row">${chips}</div>`;
}

// Shared aria-live region (one per route, per the a11y pass): announces the
// per-run score, the STOCHOS convergence completion, and the showdown verdict.
// Lives as a sibling of #chStage (mountChallenge renders it once per mount), so
// it survives the stage's innerHTML swaps between acts. Deliberately NOT used
// for per-frame convergence updates (that would spam the region every tick);
// only the settled outcomes above are announced.
function announce(msg) {
  const el = document.getElementById('chLive');
  if (el) el.textContent = msg;
}
// One-line "did it hold spec" summary for the live region, from a scoreOf()/
// stochosRun() terms array (same shape complianceChipsHTML reads). '' when the
// domain has no spec terms (legacy, non-constrained domain, or minimize-only).
function complianceSummaryText(terms) {
  // same tamper guard as complianceChipsHTML: storage-derived terms may be malformed
  if (!Array.isArray(terms)) return '';
  terms = terms.filter((t) => t && typeof t === 'object');
  if (!terms.length) return '';
  const specs = terms.filter((t) => t.kind === 'spec');
  if (!specs.length) return '';
  const bad = specs.filter((t) => t.inSpec === false).length;
  return bad === 0 ? ', all specs in band' : `, ${bad} spec${bad > 1 ? 's' : ''} out of band`;
}

// the currently mounted instrument controller, so it can be torn down on ANY exit
// (nav link, browser back, industry switch), not just on Lock.
let activeCtrl = null;
function setActiveCtrl(c) {
  if (activeCtrl && activeCtrl !== c && activeCtrl.destroy) { try { activeCtrl.destroy(); } catch (e) { /* noop */ } }
  activeCtrl = c;
}
function teardownActive() {
  if (activeCtrl && activeCtrl.destroy) { try { activeCtrl.destroy(); } catch (e) { /* noop */ } }
  activeCtrl = null;
}

// Persistent "back to the use-case picker" affordance, shown in the header of
// every screen (intro / play / stochos / showdown). Tears down any live
// instrument first, then returns to the pick menu.
function backBarHTML() {
  return `<div class="ch-topbar"><button class="ch-back" id="chBackPick">&larr; Use cases</button></div>`;
}
function wireBack(stage) {
  const b = stage.querySelector('#chBackPick');
  if (b) b.onclick = () => { teardownActive(); renderPick(stage); };
}

// humanize a row/cells key for table headers: drop unit suffixes, title-case.
function humanizeKey(k) {
  let s = String(k)
    .replace(/_pct$/, ' %')
    .replace(/_mm$/, ' (mm)')
    .replace(/_g$/, ' (g)')
    .replace(/_bar$/, ' (bar)')
    .replace(/_rel$/, ' (rel)')
    .replace(/_idx$/, '')
    .replace(/_/g, ' ')
    .trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function fmtCell(v) {
  if (v == null) return '--';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return esc(String(v));
}

// Build the intro DATA TABLE from surrogate.data.preview_rows. Columns are
// derived from the FIRST row's `cells` keys (humanized); `label` is column 1.
// For engineering these rows are bottle archetypes (Slim PET, Wide HDPE, ...).
function previewTableHTML(surrogate) {
  const rows = (surrogate.data && surrogate.data.preview_rows) || [];
  if (!rows.length) return '';
  const keys = Object.keys(rows[0].cells || {});
  const head = `<th class="ch-tbl-lbl">Example</th>` + keys.map((k) => `<th>${esc(humanizeKey(k))}</th>`).join('');
  const body = rows.map((r) => {
    const cells = keys.map((k) => `<td>${fmtCell(r.cells ? r.cells[k] : null)}</td>`).join('');
    return `<tr><td class="ch-tbl-lbl">${esc(r.label || '')}</td>${cells}</tr>`;
  }).join('');
  return `<div class="ch-tbl-wrap"><div class="ch-tbl-cap">A few real runs from the data</div>
    <div class="ch-tbl-scroll"><table class="ch-tbl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></div>`;
}

// Short, dismissible START GUIDE coachmark. Skippable; remembers dismissal for
// the session so it only shows once per visit. on-brand, non-blocking.
function maybeShowGuide(stage) {
  try { if (sessionStorage.getItem('ch_guide_seen') === '1') return; } catch (e) { /* noop */ }
  // remove a stale guide if one is lingering
  const old = stage.querySelector('.ch-guide'); if (old) old.remove();
  const g = document.createElement('div');
  g.className = 'ch-guide';
  g.innerHTML = `
    <div class="ch-guide-card" role="dialog" aria-label="How the challenge works">
      <button class="ch-guide-x" id="chGuideX" aria-label="Dismiss">&times;</button>
      <div class="ch-guide-eyebrow">How it works</div>
      <ol class="ch-guide-steps">
        <li><b>Set</b> the recipe / conditions.</li>
        <li><b>Run it</b> and read the score.</li>
        <li><b>Lock</b> your best result.</li>
        <li>Then <b>build STOCHOS's workflow</b> and see the showdown.</li>
      </ol>
      <button class="ch-btn primary ch-guide-go" id="chGuideGo">Got it &rarr;</button>
    </div>`;
  stage.appendChild(g);
  const dismiss = () => {
    try { sessionStorage.setItem('ch_guide_seen', '1'); } catch (e) { /* noop */ }
    g.classList.add('out');
    setTimeout(() => g.remove(), 220);
  };
  g.querySelector('#chGuideX').onclick = dismiss;
  g.querySelector('#chGuideGo').onclick = dismiss;
  // auto-dismiss once the visitor starts acting: the fixed card sits bottom-right
  // and on short viewports it can cover the Lock CTA, so it must never outlive
  // the first real interaction (capture phase, so stopPropagation cannot keep it alive)
  const auto = (e) => {
    if (g.contains(e.target)) return;
    if (e.target.closest && e.target.closest('button')) {
      document.removeEventListener('click', auto, true);
      dismiss();
    }
  };
  document.addEventListener('click', auto, true);
}

export async function mountChallenge(root) {
  injectStyles();
  // tear the instrument down (window listeners, WebGL context) when we leave #/challenge
  const onLeave = () => {
    if (location.hash.replace(/^#\//, '') !== 'challenge') {
      teardownActive();
      window.removeEventListener('hashchange', onLeave);
    }
  };
  window.removeEventListener('hashchange', onLeave);
  window.addEventListener('hashchange', onLeave);
  root.innerHTML = `<div class="challenge fade-in"><div class="ch-stage" id="chStage"></div>
    <div class="ch-disclaimer">Illustrative demo. Synthetic data, response surfaces fitted offline from DIM-GP models.</div>
    <div id="chLive" class="sr-only" aria-live="polite" aria-atomic="true"></div></div>`;
  const stage = root.querySelector('#chStage');
  // returning from the studio build with Stochos's result -> jump straight to the showdown
  let sd = null;
  try { sd = JSON.parse(sessionStorage.getItem('challengeShowdown') || 'null'); } catch (e) { sd = null; }
  if (sd && CH[sd.domain]) {
    sessionStorage.removeItem('challengeShowdown');
    try {
      const surrogate = await loadDomain(CH[sd.domain].data);
      renderShowdown(stage, sd.domain, surrogate, sd.userBest, sd.stochos);
      return;
    } catch (e) { /* fall through to the picker */ }
  }
  // deep link from a solution page: /challenge-app/?case=engineering#/challenge opens
  // that use case directly instead of the picker. Unknown values fall through to the
  // picker. The param is consumed once (stripped from the URL) so the back-to-picker
  // affordance and a reload land on the picker rather than bouncing back in.
  let preset = null;
  try { preset = new URLSearchParams(location.search).get('case'); } catch (e) { preset = null; }
  if (preset && CH[preset]) {
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* noop */ }
    return startDomain(stage, preset);
  }
  renderPick(stage);
}

// ----------------------------------------------------------------- pick ----
function renderPick(stage) {
  stage.innerHTML = `
    <div class="ch-pick">
      <div class="ch-eyebrow">Challenge</div>
      <h1>Think you can beat <span class="grad">STOCHOS</span>?</h1>
      <p class="ch-lead">Pick a use case. You get a few tries to find the best settings by hand. Then STOCHOS takes the same problem. Closest to optimal wins.</p>
      <div class="ch-cards">
        ${Object.entries(CH).map(([k, d]) => `
          <button class="ch-card" data-domain="${k}">
            ${d.img
              ? `<img class="ch-card-img" src="${d.img}" alt="" loading="lazy" aria-hidden="true">`
              : `<span class="ch-mark" aria-hidden="true">${CH_MARK[k] || ''}</span>`}
            <span class="ch-tag">${d.tag}</span>
            <h3>${d.title}</h3>
            <p>${d.blurb || d.story}</p>
            <span class="ch-go">Take the challenge &rarr;</span>
          </button>`).join('')}
      </div>
      <div class="ch-hiw">
        <span class="ch-hiw-step">01 Set</span><span class="ch-hiw-sep">&middot;</span>
        <span class="ch-hiw-step">02 Run</span><span class="ch-hiw-sep">&middot;</span>
        <span class="ch-hiw-step">03 Lock</span><span class="ch-hiw-sep">&middot;</span>
        <span class="ch-hiw-step">04 Build the workflow</span>
      </div>
    </div>`;
  stage.querySelectorAll('.ch-card').forEach((c) => {
    c.onclick = () => startDomain(stage, c.dataset.domain);
  });
}

async function startDomain(stage, domain) {
  const cfg = CH[domain];
  let surrogate;
  try { surrogate = await loadDomain(cfg.data); }
  catch (e) { stage.innerHTML = `<div class="ch-pick"><h1>Could not load ${cfg.data}</h1><p>${e.message}</p></div>`; return; }
  renderIntro(stage, domain, surrogate);
}

// ---------------------------------------------------------------- intro ----
function renderIntro(stage, domain, surrogate) {
  const cfg = CH[domain];
  const ax = surrogate.axisInput(0), ay = surrogate.axisInput(1);
  stage.innerHTML = `
    <div class="ch-intro">
      ${backBarHTML()}
      <div class="ch-eyebrow">${cfg.tag} &middot; the challenge</div>
      <h1>${cfg.title}</h1>
      <p class="ch-lead">${cfg.story}</p>
      <div class="ch-peek-row">
        <div class="ch-peek">
          <div class="ch-peek-head">What STOCHOS learned from: ${surrogate.trainPoints.length} measured runs</div>
          <canvas class="ch-peek-cv" width="520" height="240" role="img" aria-label="Scatter plot of the ${surrogate.trainPoints.length} measured training runs, plotted by ${esc(ax.label || ax.name)} versus ${esc(ay.label || ay.name)}"></canvas>
          <div class="ch-peek-axes"><span>${ax.label || ax.name}</span><span>${ay.label || ay.name}</span></div>
        </div>
        ${previewTableHTML(surrogate)}
      </div>
      <div class="ch-intro-actions">
        <button class="ch-btn primary" id="chStart">${cfg.task} &rarr;</button>
      </div>
    </div>`;
  wireBack(stage);
  drawPeek(stage.querySelector('.ch-peek-cv'), surrogate);
  stage.querySelector('#chStart').onclick = () => renderPlay(stage, domain, surrogate);
  maybeShowGuide(stage);
}

// scatter of the training data over the two axes (honest: the data Stochos learns from)
function drawPeek(cv, surrogate) {
  if (!cv) return;
  const ctx = cv.getContext('2d'), w = cv.width, h = cv.height, pad = 26;
  ctx.clearRect(0, 0, w, h);
  const ax = surrogate.axisInput(0), ay = surrogate.axisInput(1);
  ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const gx = pad + i / 4 * (w - pad * 1.5), gy = pad + i / 4 * (h - pad * 1.5);
    ctx.beginPath(); ctx.moveTo(gx, pad); ctx.lineTo(gx, h - pad); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(pad, gy); ctx.lineTo(w - pad / 2, gy); ctx.stroke();
  }
  const sx = (x) => pad + (x - ax.min) / (ax.max - ax.min) * (w - pad * 1.5);
  const sy = (y) => h - pad - (y - ay.min) / (ay.max - ay.min) * (h - pad * 1.5);
  for (const p of surrogate.trainPoints) {
    ctx.save(); ctx.shadowColor = '#ffb006'; ctx.shadowBlur = 8;
    ctx.fillStyle = 'rgba(255,200,90,0.95)';
    ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), 3, 0, 7); ctx.fill(); ctx.restore();
  }
}

// ----------------------------------------------------------------- play ----
async function renderPlay(stage, domain, surrogate) {
  const cfg = CH[domain], prim = PRIMARY[domain];
  stage.innerHTML = `
    <div class="ch-play">
      ${backBarHTML()}
      <div class="ch-play-head">
        <div><div class="ch-eyebrow">${cfg.tag} &middot; your turn</div><h2>${cfg.task}</h2></div>
        <div class="ch-hud">
          <div class="ch-hud-score"><span class="ch-hud-lbl">Best score</span><b id="chBest"></b></div>
          <div class="ch-attempts" id="chAttempts"></div>
        </div>
      </div>
      <div class="ch-instrument" id="chInstrument"></div>
      <div class="ch-play-foot">
        <span class="ch-hint" id="chHint">Set the controls, then run it. Try a few times.</span>
        <button class="ch-btn primary" id="chLock" disabled>Lock my best, face STOCHOS &rarr;</button>
      </div>
    </div>`;
  wireBack(stage);
  maybeShowGuide(stage);
  const host = stage.querySelector('#chInstrument');
  let best = null, attempts = 0;
  let ctrl = null;
  try {
    const mod = await import(cfg.instrument);
    ctrl = mod.mountInstrument(host, surrogate, { accent: cfg.accent });
    setActiveCtrl(ctrl);
  } catch (e) {
    // honest fallback: the instrument exists, the browser lacks WebGL (or the
    // module failed to load). Never imply the feature is unbuilt.
    host.innerHTML = `<div class="ch-missing">This instrument needs WebGL, which this browser has disabled or does not support. The other use cases run without it.</div>`;
    console.warn('challenge instrument failed to mount:', e);
  }
  const bestEl = stage.querySelector('#chBest'), attEl = stage.querySelector('#chAttempts');
  const lockBtn = stage.querySelector('#chLock');
  function onAttempt(state) {
    attempts++;
    // canonical score (shared with Stochos), recomputed from the instrument params
    const { mean, score, terms } = scoreOf(surrogate, state.params || {}, prim.out, prim.goal);
    // full output set over ALL the player's inputs (not just the 2 field axes), so
    // the showdown You-vs-STOCHOS cards both read from the complete param set.
    const outputs = outputsFull(surrogate, state.params || {});
    const rec = { params: state.params, outputs, mean, score };
    if (!best || score > best.score) best = rec;
    bestEl.textContent = best.score;
    const dot = document.createElement('span');
    dot.className = 'ch-att' + (rec === best ? ' best' : '');
    dot.textContent = score;
    attEl.appendChild(dot);
    lockBtn.disabled = false;
    stage.querySelector('#chHint').textContent = `Attempt ${attempts}. Your best so far: ${best.score} / 100.`;
    announce(`Run scored ${sc(score)} of 100${complianceSummaryText(terms)}.`);
  }
  if (ctrl && ctrl.onAttempt) ctrl.onAttempt(onAttempt);
  // one-shot: a fast double-click would otherwise re-render the STOCHOS screen twice
  // (the second click lands on the now-detached button).
  let locked = false;
  lockBtn.onclick = () => { if (locked) return; locked = true; teardownActive(); renderStochos(stage, domain, surrogate, best); };
}

// -------------------------------------------------------------- stochos ----
async function renderStochos(stage, domain, surrogate, userBest) {
  const cfg = CH[domain], prim = PRIMARY[domain];
  const primO = surrogate.outputs.find((o) => o.name === prim.out);
  const objName = primO ? esc(primO.label || primO.name) : 'the objective';
  const verb = prim.goal === 'low' ? 'minimise' : 'maximise';
  const lockedTxt = userBest ? `${sc(userBest.score)}` : '--';
  // domain-aware goal line: spell out the real trade-off, not just the primary
  const goalLine = OBJECTIVE_LEAD[domain] || `Goal: ${verb} ${objName}.`;
  // V4: the player's own compliance readout (did the locked design hold the spec
  // bands?), recomputed fresh from the locked params -- userBest never carries
  // `terms` itself (renderPlay only stores {params, outputs, mean, score}).
  const compCfg = constraintCfg(surrogate);
  const userTerms = (userBest && compCfg) ? scoreOf(surrogate, userBest.params || {}, prim.out, prim.goal).terms : null;
  stage.innerHTML = `
    <div class="ch-stochos">
      ${backBarHTML()}
      <div class="ch-eyebrow">${cfg.tag} &middot; STOCHOS takes the challenge</div>
      <h2>Now STOCHOS solves the same problem</h2>
      <p class="ch-lead"><b>${goalLine}</b> Your locked score: <b>${lockedTxt}</b> / 100. STOCHOS will learn the response and try to beat it.</p>
      ${complianceChipsHTML(surrogate, userTerms)}
      <div class="ch-objective">
        <span class="ch-obj-dot"></span>
        Build STOCHOS's workflow lays out the same pipeline in Stochos Flow: load the data, train the model, run the optimiser, then brings you back here for the showdown. Short on time? Just watch it run.
      </div>
      <div class="ch-sto-readout" id="chStoReadout">Ready.</div>

      <!-- watch-it-optimize result: score appears on top, graph slides down beneath it,
           then the chosen-design mini-row. Hidden until the run starts. -->
      <div class="ch-watch" id="chWatch" hidden>
        <div class="ch-watch-score" id="chWatchScore" hidden>
          <span class="ch-watch-score-lbl">STOCHOS converged on</span>
          <span class="ch-watch-score-val"><b id="chWatchScoreVal">--</b><span class="ch-watch-score-slash"> / 100</span></span>
          <div class="ch-watch-compliance" id="chWatchCompliance"></div>
        </div>
        <div class="ch-converge" id="chConverge" hidden>
          <div class="ch-converge-head">
            <span class="ch-converge-cap" id="chConvCap">STOCHOS is searching</span>
            <span class="ch-converge-best">best so far <b id="chConvBest">--</b><span class="ch-converge-slash"> / 100</span></span>
          </div>
          <canvas class="ch-converge-cv" id="chConvCv" width="760" height="300" role="img" aria-label="Chart of STOCHOS's evaluations: score per evaluation, with a step line climbing to the best score found so far"></canvas>
          <div class="ch-converge-legend">
            <span class="ch-lg-dot"></span> each candidate STOCHOS evaluated
            <span class="ch-lg-line"></span> best so far
          </div>
        </div>
        <div class="ch-design" id="chDesign" hidden></div>
      </div>

      <div class="ch-sto-actions">
        <button class="ch-btn primary" id="chBuild">Build STOCHOS's workflow &rarr;</button>
        <button class="ch-btn ghost" id="chRunStochos">Or just watch it optimize</button>
      </div>
    </div>`;
  wireBack(stage);
  const readout = stage.querySelector('#chStoReadout');
  // hand off to the real Flow studio: build the workflow, then return to the showdown
  stage.querySelector('#chBuild').onclick = () => {
    try {
      sessionStorage.setItem('challengeCtx', JSON.stringify({
        domain, dataDomain: cfg.data, primary: { out: prim.out, goal: prim.goal },
        userBest: userBest ? { score: userBest.score, params: userBest.params, outputs: userBest.outputs } : null,
      }));
    } catch (e) { /* noop */ }
    location.hash = '#/studio';
  };
  stage.querySelector('#chRunStochos').onclick = async (e) => {
    e.target.disabled = true;
    const buildBtn = stage.querySelector('#chBuild'); if (buildBtn) buildBtn.disabled = true;
    // N-D budgeted run over ALL inputs (the same optimiser the built workflow uses),
    // so the watched run and the built-workflow run stay consistent.
    const sResult = stochosRun(surrogate, prim.out, prim.goal);
    const picks = (sResult.picks || []).filter((p) => isFinite(p));
    if (!picks.length) { renderShowdown(stage, domain, surrogate, userBest, sResult); return; }
    readout.innerHTML = `STOCHOS is running the same optimiser the built workflow uses, over all inputs at once. Watch the best score climb as it learns the response.`;
    // reveal the watch container; the score and chosen-design stay hidden until
    // the search finishes, so the optimum is NOT pre-revealed during the climb.
    const watch = stage.querySelector('#chWatch'); if (watch) watch.hidden = false;
    // run the VIZ-CONVERGE device: animate every evaluation as a dot, ratchet the
    // best-so-far line up toward the run's final best. No target line is drawn,
    // so the viewer only learns the answer when the line gets there.
    await runConvergeViz(stage, picks, sResult.score);
    readout.innerHTML = `STOCHOS tested ${picks.length} candidates and converged on <b>${sc(sResult.score)}</b> / 100.`;
    announce(`STOCHOS converged on ${sc(sResult.score)} of 100${complianceSummaryText(sResult.breakdown)}.`);
    // ---- result reveal: score eases in ON TOP, graph eases DOWN, design row below.
    revealWatchResult(stage, domain, surrogate, userBest, sResult);
  };
}

// After the convergence animation settles, restructure the watch result so it reads
// top-to-bottom: [big score] -> [converged graph, slid down] -> [chosen-design mini-row].
// All transitions are CSS-eased; nothing here blocks, so it is headless-safe.
function revealWatchResult(stage, domain, surrogate, userBest, sResult) {
  const prim = PRIMARY[domain];
  // 1) score eases in above the graph
  const scoreWrap = stage.querySelector('#chWatchScore');
  const scoreVal = stage.querySelector('#chWatchScoreVal');
  if (scoreVal) scoreVal.textContent = isFinite(sResult.score) ? sResult.score : '--';
  // V4: STOCHOS's own compliance readout, from the real breakdown the run
  // returns (score.js stochosRun -> compositeObjective terms). null on a
  // legacy (non-constrained) domain, in which case nothing renders.
  const compEl = stage.querySelector('#chWatchCompliance');
  if (compEl) compEl.innerHTML = complianceChipsHTML(surrogate, sResult.breakdown);
  if (scoreWrap) { scoreWrap.hidden = false; requestAnimationFrame(() => scoreWrap.classList.add('in')); }
  // 2) graph slides down (gives the score room above and reads as "settled")
  const conv = stage.querySelector('#chConverge');
  if (conv) requestAnimationFrame(() => conv.classList.add('slid'));
  // 3) chosen-design mini-row eases in beneath the graph
  const designEl = stage.querySelector('#chDesign');
  if (designEl) {
    designEl.innerHTML = chosenDesignHTML(surrogate, sResult, prim);
    designEl.hidden = false;
    setTimeout(() => designEl.classList.add('in'), 220);
  }
  // 4) clear way forward: swap the actions to "See the showdown" + "Play again",
  //    keeping the result on screen rather than auto-jumping.
  const actions = stage.querySelector('.ch-sto-actions');
  if (actions) {
    actions.innerHTML = `
      <button class="ch-btn primary" id="chToShowdown">See the showdown &rarr;</button>
      <button class="ch-btn ghost" id="chWatchAgain">Play again</button>`;
    const toSd = actions.querySelector('#chToShowdown');
    if (toSd) toSd.onclick = () => renderShowdown(stage, domain, surrogate, userBest, sResult);
    const again = actions.querySelector('#chWatchAgain');
    if (again) again.onclick = () => { teardownActive(); renderPick(stage); };
  }
}

// Build the compact "STOCHOS's design" mini-row: the key INPUT settings STOCHOS
// chose plus the key OUTPUTS (primary + up to two more). Reads only from sResult
// (real optimiser params/outputs) and the surrogate's input/output metadata.
function chosenDesignHTML(surrogate, sResult, prim) {
  const params = sResult.params || {};
  const outs = sResult.outputs || {};
  // pick inputs to show: the two field axes first, then up to two more inputs,
  // so the row stays compact but covers process + formulation levers.
  const ax = surrogate.axisInput(0), ay = surrogate.axisInput(1);
  const axisNames = [ax && ax.name, ay && ay.name].filter(Boolean);
  const inOrder = [];
  for (const n of axisNames) { const inp = surrogate.inputs.find((i) => i.name === n); if (inp) inOrder.push(inp); }
  for (const inp of surrogate.inputs) {
    if (inOrder.length >= 4) break;
    if (!axisNames.includes(inp.name)) inOrder.push(inp);
  }
  const inCells = inOrder.map((inp) => {
    const v = params[inp.name];
    return `<div class="ch-design-cell"><span class="ch-design-k">${esc(inp.label || inp.name)}${inp.unit ? ` (${esc(inp.unit)})` : ''}</span><b>${fmtCell(v)}</b></div>`;
  }).join('');
  // outputs: primary first, then up to two others
  const primO = surrogate.outputs.find((o) => o.name === prim.out);
  const otherO = surrogate.outputs.filter((o) => o.name !== prim.out).slice(0, 2);
  const outList = [primO, ...otherO].filter(Boolean);
  const outCells = outList.map((o, i) => {
    const v = outs[o.name];
    return `<div class="ch-design-cell ${i === 0 ? 'primary' : ''}"><span class="ch-design-k">${esc(o.label || o.name)}${o.unit ? ` (${esc(o.unit)})` : ''}</span><b>${fmt(v, decFor(o))}</b></div>`;
  }).join('');
  return `
    <div class="ch-design-cap">STOCHOS's chosen design</div>
    <div class="ch-design-grid">
      <div class="ch-design-group">
        <div class="ch-design-grp-lbl">Settings it picked</div>
        <div class="ch-design-cells">${inCells}</div>
      </div>
      <div class="ch-design-group">
        <div class="ch-design-grp-lbl">What it gets</div>
        <div class="ch-design-cells">${outCells}</div>
      </div>
    </div>`;
}

// ----------------------------------------------------- VIZ-CONVERGE device --
// Animated convergence chart for the "just watch it optimize" path. Plots every
// evaluation's primary score (0..100) as an eased-in dot on an evaluation# (x)
// vs score (y) chart, and ratchets a rising BEST-SO-FAR step line up to the run's
// final best. The optimum is NEVER pre-drawn: the viewer only learns the answer
// when the line climbs to it, then the score is revealed afterward (see
// revealWatchResult). Caller restructures the result on resolve.
//
// ROBUSTNESS: resolves on a clamped wall-clock schedule, never on a pure-rAF
// counter (headless rAF is throttled and would hang the promise). rAF is used
// only to PAINT; a setTimeout fallback guarantees the promise resolves and the
// loop self-stops on teardown / disconnect. The active loop is registered as the
// activeCtrl so teardownActive() (fired on any exit) cancels it.
function runConvergeViz(stage, picks, finalScore) {
  const wrap = stage.querySelector('#chConverge');
  const cv = stage.querySelector('#chConvCv');
  const capEl = stage.querySelector('#chConvCap');
  const bestEl = stage.querySelector('#chConvBest');
  if (!wrap || !cv) return Promise.resolve();
  wrap.hidden = false;

  const ctx = cv.getContext('2d');
  const K = picks.length;
  // best-so-far series + which evaluations set a NEW best (for the climb motion)
  const bestSeries = []; let run = -Infinity; const newBestAt = [];
  for (let i = 0; i < K; i++) {
    if (picks[i] > run) { run = picks[i]; newBestAt.push(true); } else newBestAt.push(false);
    bestSeries.push(run);
  }
  const finalBest = isFinite(finalScore) ? finalScore : bestSeries[K - 1];

  // per-evaluation cadence (ms). Keep the whole run under ~4.5s even for big K.
  // prefers-reduced-motion: skip the multi-second climb and jump straight to the
  // settled frame (still the real per-evaluation data, just with no eased-in
  // suspense) -- item 8 of the 2026-07-14 a11y pass.
  const reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const stepMs = reducedMotion ? 1 : Math.max(280, Math.min(620, Math.round(3600 / K)));
  const easeMs = reducedMotion ? 1 : Math.min(380, stepMs - 40);          // dot ease-in duration
  const settleMs = reducedMotion ? 0 : 760;                                // hold on the final frame

  const start = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const T_total = K * stepMs + settleMs;

  return new Promise((resolve) => {
    let done = false; let rafId = 0; let fallbackId = 0;
    const finish = () => {
      if (done) return; done = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (fallbackId) clearTimeout(fallbackId);
      try { paint(T_total); } catch (e) { /* noop */ }   // guarantee final frame painted
      resolve();
    };
    // teardown hook: if the user navigates away mid-animation, stop the loop AND
    // resolve so nothing downstream hangs. setActiveCtrl tears down the prior ctrl.
    setActiveCtrl({ destroy: () => { if (done) return; done = true; if (rafId) cancelAnimationFrame(rafId); if (fallbackId) clearTimeout(fallbackId); resolve(); } });
    // HARD fallback: even if rAF never fires (hidden tab), resolve on wall clock.
    fallbackId = setTimeout(finish, T_total + 1200);

    function loop() {
      if (done) return;
      // stop cleanly if the view was torn down / canvas detached
      if (!cv.isConnected) { finish(); return; }
      const t = now() - start;
      paint(t);
      if (t >= T_total) { finish(); return; }
      rafId = requestAnimationFrame(loop);
    }
    rafId = requestAnimationFrame(loop);

    // paint(t): full redraw at wall-clock time t (ms since start). Pure function
    // of t and the precomputed series, so the fallback can render the final frame.
    function paint(t) {
      const w = cv.width, h = cv.height;
      const padL = 46, padR = 18, padT = 18, padB = 34;
      const plotW = w - padL - padR, plotH = h - padT - padB;
      // x for evaluation index i (0..K-1) centered in K slots; y for score 0..100
      const sx = (i) => padL + (K <= 1 ? plotW / 2 : (i / (K - 1)) * plotW);
      const sy = (s) => padT + (1 - Math.max(0, Math.min(100, s)) / 100) * plotH;

      ctx.clearRect(0, 0, w, h);
      // background
      ctx.fillStyle = '#0a0a0c'; ctx.fillRect(0, 0, w, h);

      // gridlines + y labels (0,25,50,75,100)
      ctx.lineWidth = 1; ctx.font = '11px ui-monospace, monospace'; ctx.textBaseline = 'middle';
      for (let g = 0; g <= 100; g += 25) {
        const y = sy(g);
        ctx.strokeStyle = 'rgba(255,255,255,0.07)';
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.34)'; ctx.textAlign = 'right';
        ctx.fillText(String(g), padL - 8, y);
      }
      // axis labels
      ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.textAlign = 'center';
      ctx.fillText('evaluation', padL + plotW / 2, h - 10);
      ctx.save(); ctx.translate(13, padT + plotH / 2); ctx.rotate(-Math.PI / 2);
      ctx.fillText('score', 0, 0); ctx.restore();

      // how many evaluations are "revealed" so far, and the partial progress of
      // the newest one (for ease-in + best-so-far climb motion)
      const revealedF = Math.min(K, t / stepMs);
      const revealed = Math.min(K, Math.floor(revealedF) + (t >= K * stepMs ? 0 : 1));
      const settled = t >= K * stepMs;

      // NO pre-reveal of the optimum. During the search the chart never draws where
      // the final best is, so the answer is unknown until the best-so-far line
      // actually climbs to it. Suspense builds; the score is revealed afterward.

      // BEST-SO-FAR step line: climbs as new bests are found, with a small
      // ease as each step rises (exploitation reading).
      ctx.strokeStyle = '#ffb006'; ctx.lineWidth = 2.4;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      let liveBest = -Infinity;
      for (let i = 0; i < revealed; i++) {
        // ease fraction of THIS evaluation (0..1); the newest one animates in
        const localT = t - i * stepMs;
        const f = Math.max(0, Math.min(1, localT / easeMs));
        const fe = 1 - Math.pow(1 - f, 3);              // easeOutCubic
        // the best-so-far value to draw: if this eval set a new best, climb to it
        const prev = i > 0 ? bestSeries[i - 1] : 0;
        const drawn = newBestAt[i] ? prev + (bestSeries[i] - prev) * fe : bestSeries[i];
        const x = sx(i), y = sy(drawn);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        liveBest = Math.max(liveBest, drawn);
      }
      ctx.stroke();

      // candidate dots: each eases in (radius + alpha grow), scatter shows exploration
      for (let i = 0; i < revealed; i++) {
        const localT = t - i * stepMs;
        const f = Math.max(0, Math.min(1, localT / easeMs));
        const fe = 1 - Math.pow(1 - f, 3);
        const x = sx(i), y = sy(picks[i]);
        if (!isFinite(x) || !isFinite(y)) continue;     // NaN guard
        const r = 2.5 + 3 * fe;
        ctx.globalAlpha = 0.25 + 0.7 * fe;
        if (newBestAt[i]) {
          // a new best: brighter, glowing dot
          ctx.save(); ctx.shadowColor = '#ffb006'; ctx.shadowBlur = 12;
          ctx.fillStyle = '#ffd479';
          ctx.beginPath(); ctx.arc(x, y, r + 0.6, 0, 7); ctx.fill(); ctx.restore();
        } else {
          ctx.fillStyle = 'rgba(255,196,110,0.85)';
          ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // live best marker dot riding the top of the step line
      if (revealed >= 1 && isFinite(liveBest)) {
        const lastIdx = revealed - 1;
        const x = sx(lastIdx), y = sy(liveBest);
        ctx.save(); ctx.shadowColor = '#ffb006'; ctx.shadowBlur = 14;
        ctx.fillStyle = '#ffb006';
        ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 7); ctx.fill(); ctx.restore();
      }

      // captions (live best so far + evaluation k of K)
      const shownIdx = Math.max(0, Math.min(K, revealed));
      const liveBestInt = isFinite(liveBest) ? Math.round(liveBest) : 0;
      if (bestEl) bestEl.textContent = settled ? finalBest : liveBestInt;
      if (capEl) capEl.textContent = settled
        ? `STOCHOS converged on ${finalBest}`
        : `STOCHOS is searching  evaluation ${shownIdx} of ${K}`;
    }
  });
}

// ------------------------------------------------------------- showdown ----
function renderShowdown(stage, domain, surrogate, userBest, stoch) {
  const cfg = CH[domain], prim = PRIMARY[domain];
  const u = userBest || { score: 0, params: {}, outputs: {} };
  const uS = sc(u.score), sS = sc(stoch.score);  // coerce: scores may be storage-derived
  const won = sS > uS;            // STOCHOS strictly ahead
  const tie = sS === uS;
  const primO = surrogate.outputs.find((o) => o.name === prim.out);
  const objName = primO ? esc((primO.label || primO.name).toLowerCase()) : 'the objective';
  // V4: THE point of this screen -- show that the win held the spec bands the
  // copy promised, not just the headline score. The player side has no stored
  // `terms` (renderPlay only keeps {params, outputs, mean, score}), so recompute
  // fresh via scoreOf on the locked params; STOCHOS's side reads its run's real
  // breakdown. Both are null on a legacy (non-constrained) domain.
  const compCfg = constraintCfg(surrogate);
  const uTerms = compCfg ? scoreOf(surrogate, u.params || {}, prim.out, prim.goal).terms : null;
  const sTerms = compCfg ? (stoch.breakdown || null) : null;
  const card = (who, r, win, terms) => `
    <div class="ch-result ${win ? 'win' : ''}">
      <div class="ch-result-who">${who}${win ? ' &middot; winner' : ''}</div>
      <div class="ch-result-score">${sc(r.score)}<span>/100</span></div>
      ${complianceChipsHTML(surrogate, terms)}
      <div class="ch-result-rows">
        ${surrogate.outputs.map((o) => `<div><span>${esc(o.label || o.name)}</span><b>${fmt(r.outputs[o.name], decFor(o))} ${esc(o.unit || '')}</b></div>`).join('')}
      </div>
    </div>`;
  const headline = won ? 'STOCHOS wins this round' : tie ? 'Dead heat with STOCHOS' : 'You beat STOCHOS!';
  const lead = won
    ? `STOCHOS reached <b>${sS}</b> versus your <b>${uS}</b>, in just a handful of smart experiments. With a few more, it pulls further ahead.`
    : tie
      ? `You matched STOCHOS at <b>${uS}</b>. Strong. On a real problem with more inputs, the model finds that sweet spot in far fewer runs.`
      : `Nice. You found <b>${uS}</b> versus STOCHOS at <b>${sS}</b>. On a real problem with more inputs, the model pulls ahead fast.`;
  // rarity: the fraction of the whole design space that scores above STOCHOS's result
  // (the chance a random setting beats it), computed from the trained model field.
  const br = beatRate(surrogate, prim.out, prim.goal, sS);
  const brTxt = br < 0.5 ? 'under 1%' : `${Math.round(br)}%`;
  // only call the score "rare" when the fraction is genuinely small, so a close
  // human win (where a sizeable slice of designs also clears STOCHOS) does not
  // read as "the rare 30%".
  const rare = br < 12;
  const stat = won
    ? `Only <b>${brTxt}</b> of all possible designs would have beaten STOCHOS here.`
    : tie
      ? `Only <b>${brTxt}</b> of designs reach this score at all. You found one.`
      : rare
        ? `You landed in the rare <b>${brTxt}</b> of designs that beat STOCHOS.`
        : `You are in the <b>${brTxt}</b> of designs that clear STOCHOS. Strong hand-tuning.`;
  // Part 2 funnel: hand the showdown off to the contact form. Copy flips on the
  // outcome. If STOCHOS won, invite them to try it on their own data; if they
  // held or beat it, invite a harder problem. Both land on /contact/.
  const contactLabel = won ? 'See it on your own data' : 'Bring us a harder problem';
  stage.innerHTML = `
    <div class="ch-showdown">
      ${backBarHTML()}
      <div class="ch-eyebrow">${cfg.tag} &middot; showdown</div>
      <h1>${headline}</h1>
      <p class="ch-lead">${lead}</p>
      <div class="ch-stat"><span class="ch-stat-dot"></span>${stat}</div>
      <div class="ch-results">
        ${card('You', u, !won && !tie, uTerms)}
        ${card('STOCHOS', stoch, won, sTerms)}
      </div>
      <div class="ch-sto-actions">
        <a class="ch-btn primary" href="/contact/">${contactLabel}</a>
        <a class="ch-btn ghost" href="#/studio">Build it in Stochos Flow</a>
        <button class="ch-btn muted" id="chAgain">Play again</button>
      </div>
    </div>`;
  wireBack(stage);
  stage.querySelector('#chAgain').onclick = () => renderPick(stage);
  announce(`${headline}. You scored ${uS}, STOCHOS scored ${sS} of 100.`);
}

// ---------------------------------------------------------------- styles ----
function injectStyles() {
  if (document.getElementById('ch-styles')) return;
  const s = document.createElement('style');
  s.id = 'ch-styles';
  s.textContent = `
  .challenge { position: relative; min-height: 60vh; padding: 48px 26px 80px; max-width: 1120px; margin: 0 auto; }
  .ch-disclaimer { position: fixed; right: 14px; bottom: 12px; font: 500 11px/1 var(--mono); color: var(--faint);
    background: rgba(10,10,12,0.7); border: 1px solid var(--line); border-radius: 999px; padding: 5px 11px; z-index: 5; }
  .ch-eyebrow { font: 500 11.5px/1 var(--mono); letter-spacing: 0.16em; text-transform: uppercase; color: var(--accent); margin-bottom: 10px; }
  .challenge h1 { font-family: var(--display); font-weight: 700; font-size: clamp(30px, 4.4vw, 50px); line-height: 1.05; letter-spacing: -0.02em; margin: 0 0 16px; }
  .challenge h2 { font-family: var(--display); font-weight: 700; font-size: 24px; letter-spacing: -0.01em; margin: 2px 0 0; }
  .grad { color: var(--amber); }
  .ch-lead { font-size: 17px; color: var(--muted); line-height: 1.55; max-width: 720px; }
  .ch-btn { display: inline-flex; align-items: center; gap: 8px; padding: 13px 22px; border-radius: 2px; font: 600 14.5px/1 var(--sans); cursor: pointer; border: none; transition: filter 0.18s, transform 0.18s; }
  .ch-btn.primary { background: var(--accent); color: #08070A; }
  .ch-btn.primary:hover { filter: brightness(1.08); transform: translateY(-1px); }
  .ch-btn.primary:disabled {
    background: transparent; color: rgba(255,202,77,0.45); border: 1px solid rgba(255,176,6,0.25);
    opacity: 1; cursor: default; transform: none; filter: none;
  }
  .ch-btn.ghost { background: transparent; color: var(--amber-lt); border: 1px solid rgba(255,176,6,0.5); }
  .ch-btn.ghost:hover { border-color: var(--accent); background: rgba(255,176,6,0.08); }
  .ch-btn.muted { background: transparent; color: var(--muted); border: 1px solid var(--line); }
  .ch-btn.muted:hover { color: var(--txt); border-color: var(--line-2); }
  /* persistent back-to-pick affordance (every screen): plain mono text link */
  .ch-topbar { display: flex; margin-bottom: 14px; }
  .ch-back { display: inline-flex; align-items: center; gap: 6px; font: 500 12.5px/1 var(--mono); letter-spacing: 0.02em; cursor: pointer;
    background: none; border: none; color: var(--faint); padding: 0; transition: color 0.16s; }
  .ch-back:hover { color: var(--accent); }
  /* pick */
  .ch-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 34px; }
  .ch-card { position: relative; overflow: hidden; text-align: left; cursor: pointer; color: var(--txt);
    border: 1px solid var(--line); border-radius: 6px; background: var(--surface); padding: 26px; min-height: 220px;
    display: flex; flex-direction: column; transition: transform 0.2s var(--ease-out), border-color 0.2s, box-shadow 0.2s; font: inherit; }
  .ch-card:hover { transform: translateY(-2px); border-color: rgba(255,176,6,0.5); box-shadow: var(--shadow); }
  .ch-card .ch-mark { position: absolute; top: 22px; right: 22px; width: 26px; height: 26px; pointer-events: none; }
  /* full-bleed still header (Jason's brand stills, 2026-07-14); the card's
     overflow:hidden rounds the top corners. Static image, no motion. */
  .ch-card .ch-card-img { display: block; margin: -26px -26px 18px; width: calc(100% + 52px);
    height: clamp(140px, 12vw, 180px); object-fit: cover; border-bottom: 1px solid var(--line); }
  .ch-tag { font: 500 11.5px/1 var(--mono); text-transform: uppercase; letter-spacing: 0.13em; color: var(--accent); padding-right: 34px; display: block; }
  .ch-card h3 { font-family: var(--display); font-weight: 700; margin: 11px 0 8px; font-size: 20px; }
  .ch-card p { color: var(--muted); font-size: 13.5px; line-height: 1.5; margin: 0; }
  .ch-card .ch-go { margin-top: auto; color: var(--accent); font-size: 13px; font-weight: 600; padding-top: 14px; }
  /* compact one-line "how it works" strip under the cards */
  .ch-hiw { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 30px; padding-top: 18px;
    border-top: 1px solid var(--line); font: 500 12px/1 var(--mono); letter-spacing: 0.04em; text-transform: uppercase; color: var(--faint); }
  .ch-hiw-sep { color: var(--line-2); }
  /* intro: scatter + data table side by side, stack under ~720px. The table
     tends to carry more columns than the scatter needs width for, so it gets
     the larger share of the row (was an even 1:1.05 split, clipping the last
     column at 1440px). */
  .ch-peek-row { display: grid; grid-template-columns: minmax(0, 0.82fr) minmax(0, 1.28fr); gap: 16px; align-items: stretch; margin: 26px 0; min-width: 0; }
  .ch-peek { border: 1px solid var(--line); border-radius: 6px; background: var(--panel); padding: 16px; min-width: 0; }
  .ch-peek-head { font: 500 12px/1 var(--mono); color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 10px; }
  .ch-peek-cv { width: 100%; height: auto; display: block; border-radius: 8px; background: #0a0a0c; }
  .ch-peek-axes { display: flex; justify-content: space-between; font-size: 11px; color: var(--faint); margin-top: 6px; font-family: var(--mono); }
  /* data table (preview_rows): tight column padding so a typical 7 to 9 column
     table fits at 1440px without scrolling; overflow-x still scrolls on
     narrower widths, with a right-edge fade signalling more instead of a
     hard clip. */
  .ch-tbl-wrap { border: 1px solid var(--line); border-radius: 6px; background: var(--panel); padding: 16px; display: flex; flex-direction: column; min-width: 0; overflow: hidden; }
  .ch-tbl-cap { font: 500 12px/1 var(--mono); color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 10px; }
  .ch-tbl-scroll { overflow-x: auto; overflow-y: visible; border-radius: 8px; flex: 1; -webkit-overflow-scrolling: touch;
    -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 18px), transparent);
    mask-image: linear-gradient(90deg, #000 calc(100% - 18px), transparent); }
  .ch-tbl { min-width: max-content; width: 100%; border-collapse: collapse; font-size: 11.5px; }
  .ch-tbl th, .ch-tbl td { padding: 5px 6px; text-align: right; white-space: nowrap; border-bottom: 1px solid var(--line); }
  .ch-tbl thead th { color: var(--accent); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700;
    border-bottom: 1px solid var(--accent-line); background: rgba(255,176,6,0.05); position: sticky; top: 0; }
  .ch-tbl td { font-family: var(--mono); color: var(--txt); }
  .ch-tbl .ch-tbl-lbl { text-align: left; color: var(--txt); font-family: inherit; font-weight: 600; }
  .ch-tbl thead .ch-tbl-lbl { color: var(--accent); }
  .ch-tbl tbody tr:hover td { background: rgba(255,176,6,0.06); }
  .ch-tbl tbody tr:last-child td { border-bottom: none; }
  .ch-intro-actions { margin-top: 8px; }
  /* start guide coachmark (dismissible, non-blocking) */
  .ch-guide { position: fixed; right: 22px; bottom: 56px; z-index: 30; max-width: 320px; animation: chGuideIn 0.28s both; }
  .ch-guide.out { animation: chGuideOut 0.2s both; }
  @keyframes chGuideIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
  @keyframes chGuideOut { to { opacity: 0; transform: translateY(8px); } }
  .ch-guide-card { position: relative; border: 1px solid var(--accent-line); border-radius: 6px; padding: 18px 18px 16px;
    background: var(--panel-2); box-shadow: var(--shadow); }
  .ch-guide-x { position: absolute; top: 10px; right: 12px; background: none; border: none; color: var(--faint); font-size: 20px; line-height: 1; cursor: pointer; }
  .ch-guide-x:hover { color: var(--accent); }
  .ch-guide-eyebrow { font: 500 11px/1 var(--mono); letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent); margin-bottom: 10px; }
  .ch-guide-steps { margin: 0 0 14px; padding-left: 20px; color: var(--txt); font-size: 13.5px; line-height: 1.5; }
  .ch-guide-steps li { margin-bottom: 5px; }
  .ch-guide-steps b { color: var(--accent); }
  .ch-guide-go { padding: 9px 16px; font-size: 13px; }
  /* stochos objective explainer */
  .ch-objective { display: flex; gap: 10px; margin: 16px 0 4px; padding: 12px 16px; border: 1px solid var(--line);
    border-radius: 12px; background: rgba(255,176,6,0.04); font-size: 13.5px; color: var(--muted); line-height: 1.5; max-width: 720px; }
  .ch-obj-dot { flex: none; width: 8px; height: 8px; margin-top: 6px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 10px var(--accent); }
  /* play */
  .ch-play-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; flex-wrap: wrap; }
  .ch-hud { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
  .ch-hud-score { display: flex; align-items: baseline; gap: 10px; }
  .ch-hud-lbl { font: 500 11px/1 var(--mono); color: var(--faint); text-transform: uppercase; letter-spacing: 0.1em; }
  .ch-hud-score b { font-family: var(--mono); font-weight: 600; font-size: 30px; color: var(--accent); }
  /* before the first attempt the readout is a quiet placeholder, not a full-strength number */
  .ch-hud-score b:empty::before { content: "--"; opacity: 0.4; }
  .ch-attempts { display: flex; gap: 5px; flex-wrap: wrap; max-width: 260px; justify-content: flex-end; }
  .ch-att { font-family: var(--mono); font-size: 11px; color: var(--muted); border: 1px solid var(--line); border-radius: 6px; padding: 2px 6px; }
  .ch-att.best { color: #1a0d05; background: var(--accent); border-color: var(--accent); font-weight: 700; }
  .ch-instrument { margin: 20px 0; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); min-height: 320px; overflow: hidden; }
  .ch-missing { padding: 60px; text-align: center; color: var(--muted); }
  .ch-play-foot { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; }
  .ch-hint { font-size: 13.5px; color: var(--muted); }
  /* stochos */
  .ch-stochos, .ch-intro, .ch-showdown { animation: fade 0.4s both; }
  .ch-sto-readout { margin: 22px 0; font-family: var(--mono); font-size: 18px; color: var(--txt); border: 1px solid var(--line); border-radius: 6px; background: var(--panel); padding: 18px 20px; }
  .ch-sto-actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 14px; }
  /* V4 constraint-compliance chips: the one-line "did the win hold the spec bands"
     readout under a score, shared by the stochos screen (player's locked score,
     STOCHOS's watch-run reveal) and the showdown cards. Spec terms get a quiet
     amber tick (in band) or a muted-red warning (out); minimize terms (cost/
     weight, no band) show plainly with no mark. */
  .ch-comp-row { display: flex; flex-wrap: wrap; gap: 7px; margin: 10px 0 2px; }
  .ch-comp-chip { display: inline-flex; align-items: center; gap: 5px; font: 500 11.5px/1.3 var(--mono);
    letter-spacing: 0.01em; padding: 5px 10px; border-radius: 999px; border: 1px solid var(--line);
    background: rgba(255,255,255,0.02); color: var(--muted); }
  .ch-comp-chip.ok { border-color: var(--accent-line); color: var(--txt); background: rgba(255,176,6,0.05); }
  .ch-comp-chip.ok .ch-comp-mark { color: var(--accent); }
  .ch-comp-chip.bad { border-color: rgba(255,107,107,0.4); background: rgba(255,107,107,0.08); color: #ffb3ac; }
  .ch-comp-chip.bad .ch-comp-mark { color: var(--bad); }
  .ch-comp-chip.quiet { color: var(--faint); }
  .ch-comp-mark { font-size: 11px; line-height: 1; }
  /* WATCH-IT-OPTIMIZE result: [score] over [graph slid down] over [chosen design].
     max-height/margin drive this reveal (not transform/opacity alone): the block's
     content height is not fixed ahead of time, so a max-height grow reads correctly
     regardless of content; JS never writes inline height here. Left as-is: converting
     to a transform/grid-rows reveal is a bigger restructure than this visual pass
     warrants, noted for a follow-up. */
  .ch-watch { display: flex; flex-direction: column; margin: 8px 0 4px; }
  .ch-watch-score { display: flex; flex-direction: column; gap: 2px; overflow: hidden;
    max-height: 0; opacity: 0; transform: translateY(-8px);
    transition: max-height 0.5s var(--ease-out), opacity 0.5s var(--ease-out), transform 0.5s var(--ease-out), margin 0.5s var(--ease-out); }
  .ch-watch-score.in { max-height: 220px; opacity: 1; transform: none; margin: 4px 0 14px; }
  .ch-watch-score-lbl { font: 500 12px/1 var(--mono); letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
  .ch-watch-score-val b { font-family: var(--mono); font-weight: 700; font-size: clamp(46px, 7vw, 68px);
    line-height: 1; color: var(--accent); letter-spacing: -0.02em; }
  .ch-watch-score-slash { font-family: var(--mono); font-size: 22px; color: var(--faint); margin-left: 6px; }
  .ch-watch-compliance .ch-comp-row { margin-top: 6px; }
  /* VIZ-CONVERGE: animated convergence chart for "watch it optimize". The .slid
     transition below only animates transform/box-shadow/margin-bottom (a small
     spacing nudge, not a height/width thrash), kept on var(--ease-out). */
  .ch-converge { border: 1px solid var(--accent-line); border-radius: 6px;
    background: var(--panel-2); padding: 14px 16px 12px;
    box-shadow: var(--shadow); animation: fade 0.35s both;
    transition: transform 0.5s var(--ease-out), margin 0.5s var(--ease-out), box-shadow 0.5s var(--ease-out); }
  .ch-converge.slid { transform: translateY(6px); margin-bottom: 8px;
    box-shadow: 0 10px 34px -26px rgba(255,176,6,0.35); }
  .ch-converge-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
  .ch-converge-cap { font-size: 12.5px; letter-spacing: 0.05em; color: var(--muted); text-transform: uppercase; }
  .ch-converge-best { font-size: 13px; color: var(--muted); }
  .ch-converge-best b { font-family: var(--mono); font-size: 22px; color: var(--accent); margin-left: 4px; }
  .ch-converge-slash { color: var(--faint); font-family: var(--mono); }
  .ch-converge-cv { width: 100%; height: auto; display: block; border-radius: 8px; background: #0a0a0c; }
  .ch-converge-legend { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 9px;
    font-size: 11.5px; color: var(--faint); }
  .ch-lg-dot { width: 9px; height: 9px; border-radius: 50%; background: rgba(255,196,110,0.9); box-shadow: 0 0 6px rgba(255,176,6,0.6); }
  .ch-lg-line { width: 18px; height: 0; border-top: 2.4px solid #ffb006; border-radius: 2px; margin-left: 8px; }
  /* chosen-design mini-row (STOCHOS's final settings + key outputs) */
  .ch-design { margin-top: 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel);
    padding: 14px 16px; opacity: 0; transform: translateY(10px);
    transition: opacity 0.45s var(--ease-out), transform 0.45s var(--ease-out); }
  .ch-design.in { opacity: 1; transform: none; }
  .ch-design-cap { font: 500 12px/1 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); margin-bottom: 12px; }
  .ch-design-grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 16px; align-items: start; }
  .ch-design-grp-lbl { font: 500 11px/1 var(--mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); margin-bottom: 8px; }
  .ch-design-cells { display: flex; flex-wrap: wrap; gap: 8px; }
  .ch-design-cell { display: flex; flex-direction: column; gap: 3px; border: 1px solid var(--line); border-radius: 6px;
    padding: 8px 11px; background: rgba(255,255,255,0.015); min-width: 92px; }
  .ch-design-cell.primary { border-color: var(--accent-line); background: rgba(255,176,6,0.06); }
  .ch-design-k { font-size: 10.5px; color: var(--muted); letter-spacing: 0.02em; }
  .ch-design-cell b { font-family: var(--mono); font-size: 16px; color: var(--txt); }
  .ch-design-cell.primary b { color: var(--accent); }
  /* showdown */
  .ch-stat { display: inline-flex; align-items: center; gap: 9px; margin-top: 16px; padding: 9px 16px;
    border: 1px solid var(--accent-line); border-radius: 999px; background: var(--accent-soft);
    font-size: 14px; color: var(--txt); }
  .ch-stat b { color: var(--accent); font-family: var(--mono); }
  .ch-stat-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 10px var(--accent); }
  .ch-results { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 28px 0; }
  .ch-result { border: 1px solid var(--line); border-radius: 6px; background: var(--panel); padding: 26px; }
  .ch-result.win { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent-line); }
  .ch-result-who { font: 500 12px/1 var(--mono); text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); }
  .ch-result.win .ch-result-who { color: var(--accent); }
  .ch-result-score { font-family: var(--mono); font-size: 52px; font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 14px; }
  .ch-result-score span { font-size: 20px; color: var(--faint); margin-left: 4px; }
  .ch-result-rows > div { display: flex; justify-content: space-between; padding: 7px 0; border-top: 1px solid var(--line); font-size: 13.5px; }
  .ch-result-rows span { color: var(--muted); }
  .ch-result-rows b { font-family: var(--mono); }
  @media (max-width: 820px) { .ch-cards, .ch-results { grid-template-columns: 1fr; } .ch-play-head { flex-direction: column; } .ch-hud { align-items: flex-start; } }
  @media (max-width: 640px) { .ch-design-grid { grid-template-columns: 1fr; } }
  @media (max-width: 720px) { .ch-peek-row { grid-template-columns: 1fr; } .ch-guide { left: 16px; right: 16px; bottom: 50px; max-width: none; } }
  @media (max-width: 480px) {
    .challenge { padding: 24px 14px 56px; }
    .challenge h1 { font-size: clamp(22px, 7vw, 32px); }
    .ch-btn { padding: 11px 16px; font-size: 13.5px; }
    .ch-sto-readout { font-size: 15px; padding: 14px 16px; }
    .ch-result-score { font-size: 40px; }
  }
  `;
  document.head.appendChild(s);
}
