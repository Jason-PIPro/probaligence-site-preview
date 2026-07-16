// Shared scoring for the "Beat Stochos" challenge: the visitor and STOCHOS are
// judged by the SAME honest function, computed from the real trained surrogate.
//
// V3 (CHALLENGE-V3-PLAN.md A3):
//   scoreFromMean now normalizes over the N-D range (predictFullStats), not the 2D field.
//   scoreOf evaluates predictFull (all inputs matter, not just the two axes).
//   outputsFull(surrogate, params) -> all outputs via predictFull.
//   outputsAt(surrogate,x,y) -> thin wrapper: fills non-axis inputs with defaults, calls outputsFull.
//   stochosRun uses nextSampleFull with per-domain budget/noise tuned for mean ~84-87 STOCHOS score.
//   beatRate: Monte-Carlo over the N-D analytic response.
//
// AUDIT FIXES (2026-07-13):
//   1. Discrete-input fairness: beatRate now snaps discrete inputs (step/choices,
//      see surrogate.js snapInput) onto the SAME grid the player's own control is
//      limited to, so the rarity stat never counts an unreachable fractional design
//      as "beating" or "losing to" STOCHOS. nextSampleFull (surrogate.js) got the
//      matching fix, so STOCHOS's own picks are equally grid-limited.
//   2. Determinism: stochosRun no longer seeds off Date.now(). It derives a fixed
//      seed from the domain name (hashDomainSeed), so the SAME domain always
//      reproduces the SAME STOCHOS run (picks, score, rarity stat). STOCHOS's run
//      does not depend on the player's params, so seeding by domain is sufficient
//      for "a given problem reproduces". No score is clamped or fabricated to make
//      this look good: reliability comes only from the fixed seed + a budget/pool
//      verified (offline, see tools/) to converge near the real field's optimum.

import { snapInput } from '../surrogate.js';

export const PRIMARY = {
  paint:       { out: 'contrast_ratio', goal: 'high' },
  chemistry:   { out: 'yield_pct',      goal: 'high' },
  engineering: { out: 'burst_bar',      goal: 'high' },
};

// ---- V4: constrained / composite objective --------------------------------
// The challenge copy promises "maximize <primary>, keep <secondaries> in spec
// and cost down." V4 makes the SCORE match that promise: the player and STOCHOS
// are both judged by compositeObjective() below, and STOCHOS's optimiser
// (stochosRun -> nextSampleFull with an `objective` hook) searches the SAME
// composite, so it can no longer "win" by wrecking a secondary the copy said it
// was holding in spec.
//
// A domain is scored composite ONLY when it has an entry here (keyed by the data
// file's `domain`). A domain absent from CONSTRAINTS falls back to the legacy
// primary-only path (scoreFromMean). Bands and weights come from the verified
// constraint-design doc (06_website-build/challenge-constraint-design-2026-07-13.md,
// kept OUTSIDE the app folder so the public demo mirror never ships it).
//
// Shape per domain:
//   primary:  { out, goal:'high'|'low', scoreRange?:[mn,mx] }
//             scoreRange pins the primary's normalization range (else predictFullStats).
//             Bottle uses a TARGET BAND [2,26]: burst >= 26 bar earns full primary
//             credit, because over-designing past the target only wastes material.
//   spec:     [ { out, lo?, hi?, w, range?:[mn,mx] } ]  keep-in-band; penalty ramps
//             linearly outside [lo,hi], normalized by `range` (else predictFullStats).
//   minimize: [ { out, w, range?:[mn,mx] } ]  lower-is-better soft pressure
//             (cost/weight), penalty = w * (v-mn)/(mx-mn).
// The three challenge cases map to data domains paint / chemistry / bottle (the
// "engineering" use case loads bottle.json).
//
// Bands, weights, and pinned ranges are the verified design in
// the constraint-design doc above (700k-sample dense scans + staged local
// refinement per domain). Pinned ranges are the REACHABLE output ranges from
// those scans; they are pinned here (not read from the JSON score_range) because
// the shipped score_range maxima are narrower than reachable (paint 97.38 vs
// 100.0, chemistry 72.38 vs 81.38), which would saturate primaryNorm and erase
// the very trade-off this objective exists to show.
// Design targets (see the doc): best composite ~90-92 per domain; the naive
// primary-max design scores 3.8 / 4.0 / 9.7 points lower on paint / chemistry /
// bottle, so honoring the constraints is what wins.
//
// compositeMax: the best achievable composite per domain (from the design doc's
// dense-scan optima). Displayed scores are rescaled by it, so 100 means "the
// best achievable design under the stated objective" (the same normalization
// idea scoreFromMean already applies to the primary range). Without it the
// scale's ceiling would be invisible: the raw composite can never reach 1.0
// because even the best design pays some cost penalty, and an excellent run
// would display as a mediocre-looking 72/100.
// V4.1 hardening (2026-07-14, from the adversarial audit):
//   - infeasiblePenalty: a flat composite penalty whenever ANY spec band is
//     broken. The linear ramps alone are too weak near the ceiling: paint's
//     best out-of-spec design otherwise outscored its best in-spec design, and
//     a bottle bursting at 25.95 bar (verdict FAIL) otherwise scored 99 and
//     beat STOCHOS. In-spec must win; a failed rated test must not medal.
//   - the bottle's 26 bar rated test is now a real spec term (w:0, the flat
//     penalty carries the cost), so it shows as a compliance chip, flips
//     feasible, and stays perfectly aligned with the instrument's HELD/BURST
//     verdict (which reads the same scoreRange target).
//   - compositeMax re-anchored to the best FEASIBLE design on the PLAYER'S
//     UI grid (inputs now declare their slider/knob step in the data schema,
//     so STOCHOS, beatRate, and the player all search the same grid). 100 =
//     the best in-spec design a player could actually dial in.
export const CONSTRAINTS = {
  paint: {
    compositeMax: 0.8918,     // best feasible design on the player UI grid (anchor scan 2026-07-14)
    infeasiblePenalty: 0.02,
    primary: { out: 'contrast_ratio', goal: 'high', scoreRange: [76.12, 100.0] },
    spec: [
      { out: 'viscosity', lo: 900, hi: 2100, w: 0.5,  range: [400, 3000] },     // application band, mPa.s
      { out: 'gloss',     lo: 24,  hi: 42,   w: 0.5,  range: [5.0, 57.41] },    // interior satin sheen, GU
    ],
    minimize: [ { out: 'cost', w: 0.09, range: [0.582, 2.5] } ],
  },
  chemistry: {
    compositeMax: 0.9165,     // best feasible design on the player UI grid (anchor scan 2026-07-14)
    infeasiblePenalty: 0.02,
    primary: { out: 'yield_pct', goal: 'high', scoreRange: [10.0, 81.38] },
    spec: [
      { out: 'selectivity', lo: 78, hi: 99, w: 0.9, range: [55.0, 97.34] },     // purity floor (hi never binds)
    ],
    minimize: [ { out: 'cost', w: 0.08, range: [0.589, 2.5] } ],
  },
  bottle: {
    compositeMax: 0.9084,     // best feasible design on the player UI grid (anchor scan 2026-07-14)
    infeasiblePenalty: 0.05,
    // B1 target band: hit >= 26 bar, then the lightest, cheapest geometry wins.
    primary: { out: 'burst_bar', goal: 'high', scoreRange: [2, 26] },
    spec: [
      // the rated test as a compliance term: w 0 (the infeasiblePenalty is the
      // cost), hi at the reachable max so only the 26 bar floor ever binds.
      { out: 'burst_bar', lo: 26, hi: 44, w: 0, range: [2, 43.88] },
    ],
    minimize: [
      { out: 'weight_g', w: 0.28, range: [15.02, 153.86] },
      { out: 'cost_rel', w: 0.24, range: [0.523, 3.0] },
    ],
  },
};

// Resolve the composite config for a surrogate (by its data.domain). null => legacy.
// Exported for the UI (instruments / showdown) to read the bands it must display;
// scoring itself always goes through scoreOf / compositeObjective, never raw bands.
export function constraintCfg(surrogate) {
  const key = surrogate && surrogate.data && surrogate.data.domain;
  return (key && CONSTRAINTS[key]) || null;
}

// Per-domain stochosRun tuning.
// V3b recalibration (2026-06-24): dimensionality increased (paint 6->9 inputs,
// chemistry 6->8 inputs). Recalibrated against the JS nextSampleFull simulator
// (accurate replica of the acquisition loop) with N=600 runs per config and a
// hill-climbing skilled-human proxy (budget=3 pool=12 shrink=0.6, approximates
// a player who makes ~8-10 informed runs and keeps their best).
//
// Verified distributions (skill proxy = hill-climb b=3 pool=12; casual = best-of-5 random):
//   paint:     mean ~86.2, p10 ~78.3, p90 ~94.5, skilled-beats ~22.8%, casual ~0.5%
//   chemistry: mean ~84.7, p10 ~73.3, p90 ~100.0, skilled-beats ~15-17%, casual ~0.5%
//              (chemistry's narrow yield ridge creates irreducible tension between p10
//               and skilled-beats at this mean level; 15-17% sb is the achievable range
//               while keeping p10>=72 and mean>=84.)
//   bottle/engineering: unchanged (9 inputs / architecture unchanged).
//
// score_range fast path (V3b): paint.json and chemistry.json now ship a precomputed
// score_range from a 220k-sample dense scan. predictFullStats() reads it directly,
// removing the per-load MC cost and fixing the under-sampling of the chemistry ridge.
//
// globalFrac: fraction of the candidate pool that is always global-random in local steps.
//   Prevents locking into a poor starting basin. Step 0 is always 100% global.
// localRadius: Gaussian sampling width around best_so_far (normalized 0..1),
//   decaying as 0.85^(step-1). Larger for paint (wide Gaussian peak) than chemistry.
// noise: std of noise added to the acquisition value (fraction of output range).
//   Primary lever for skilled-beats variance. At noise=0.06, STOCHOS still finds the
//   ridge consistently while retaining ~20% variance for human wins.
// V4 recalibration (2026-07-13): the composite objective (CONSTRAINTS below)
// reshapes the landscape, so the V3b tuning collapsed on it (paint mean 67,
// chemistry 63 on the display scale). Two changes:
//   - noise is now in COMPOSITE units on constrained domains (nextSampleFull's
//     objective path adds it to the 0..1 composite directly), so the old values
//     injected 6-11 display points of selection error. Reduced to 0.03-0.04.
//   - pools deepened: coordinating the primary AND the spec bands across 8-9
//     dims needs a denser candidate pool per step. budget (the visible
//     "experiments tested" count) is unchanged: 5 / 9 / 5.
// Re-verified with the JS simulator (scratchpad calibrate/tune harness, N=400
// runs per config, display scale = composite/compositeMax):
//   paint:     mean ~82.6, p10 ~77, p90 ~91   (skilled proxy mean 67.5, p90 75)
//   chemistry: mean ~82.1, p10 ~71, p90 ~93   (skilled proxy mean 60.8, p90 69)
//   bottle:    mean ~95.8, p10 ~93, p90 ~98   (V4.1 grid+penalty engine; ship
//              seed at 98 per Jason 2026-07-14, skilled-proxy beats ~4%)
// Paint/chemistry skilled-beats vs the proxy drop to a few percent: honestly
// reflecting that multi-objective trade-offs are where budgeted human search
// loses to the optimizer. Shipping seeds (DOMAIN_SEED) are additionally required
// to be strictly FEASIBLE, so the run every visitor sees holds the spec bands
// the copy promises.
const DOMAIN_RUN_CFG = {
  // paint 9-D composite: hiding vs viscosity/gloss band + cost
  paint:      { budget: 5,  pool: 90, noise: 0.03, localRadius: 0.22, globalFrac: 0.50 },
  // chemistry 8-D composite: narrow yield ridge vs selectivity floor + cost
  chemistry:  { budget: 9,  pool: 48, noise: 0.03, localRadius: 0.20, globalFrac: 0.50 },
  // bottle 5-D composite (B1): hit the 26 bar target with least weight/cost
  bottle:     { budget: 5,  pool: 60, noise: 0.04, localRadius: 0.14, globalFrac: 0.55 },
  // engineering = the studio-only heatsink domain (engineering.json, NO
  // CONSTRAINTS entry), which runs the LEGACY path where noise is a fraction of
  // the output range, so it keeps its V3 tuning. Also the fallback for unknown
  // domains.
  engineering:{ budget: 5,  pool: 20, noise: 0.11, localRadius: 0.14, globalFrac: 0.60 },
};

// 0..100 score for a primary output mean, normalizing over the N-D range
// (predictFullStats), not the narrower 2D field range.
export function scoreFromMean(surrogate, primaryOut, goal, mean) {
  const { mn, mx } = surrogate.predictFullStats(primaryOut);
  const range = mx - mn || 1;
  const n = Math.max(0, Math.min(1, (mean - mn) / range));
  const s = goal === 'low' ? 1 - n : n;
  return Math.max(0, Math.min(100, Math.round(s * 100)));
}

// V4 composite objective for a param set: normalized primary MINUS spec/cost
// penalties, in 0..1. The SINGLE function the player's score and STOCHOS's
// acquisition both use, so "same score judges both" holds under constraints too.
// Returns the 0..1 composite plus a per-term breakdown for the showdown UI.
// Caller must have confirmed the surrogate has a CONSTRAINTS entry.
export function compositeObjective(surrogate, params) {
  const cfg = constraintCfg(surrogate);
  const prim = cfg.primary;
  // pinned normalization range when the config ships one (see the CONSTRAINTS
  // comment: the JSON score_range is narrower than reachable for paint/chemistry,
  // and bottle's is a deliberate target band), else the surrogate's own stats.
  const _range = (out, pinned) => {
    if (pinned) return { mn: pinned[0], mx: pinned[1] };
    const s = surrogate.predictFullStats(out);
    return { mn: s.mn, mx: s.mx };
  };
  const primMean = surrogate.predictFull(prim.out, params).mean;
  const pr = _range(prim.out, prim.scoreRange);
  const pn = Math.max(0, Math.min(1, (primMean - pr.mn) / ((pr.mx - pr.mn) || 1)));
  const primaryNorm = prim.goal === 'low' ? 1 - pn : pn;

  let penalty = 0;
  const terms = [];
  for (const c of (cfg.spec || [])) {
    const v = surrogate.predictFull(c.out, params).mean;
    const r = _range(c.out, c.range);
    const range = (r.mx - r.mn) || 1;
    const over = Math.max(0, c.lo != null ? c.lo - v : 0, c.hi != null ? v - c.hi : 0);
    const p = (c.w || 0) * (over / range);
    penalty += p;
    terms.push({ out: c.out, value: v, kind: 'spec', lo: c.lo, hi: c.hi, penalty: p, inSpec: over <= 1e-9 });
  }
  for (const m of (cfg.minimize || [])) {
    const v = surrogate.predictFull(m.out, params).mean;
    const r = _range(m.out, m.range);
    const range = (r.mx - r.mn) || 1;
    const frac = Math.max(0, Math.min(1, (v - r.mn) / range));
    const p = (m.w || 0) * frac;
    penalty += p;
    terms.push({ out: m.out, value: v, kind: 'minimize', frac, penalty: p });
  }
  // V4.1: breaking any spec band costs a flat penalty on top of the linear
  // ramps, so out-of-spec designs can never outscore the best in-spec design
  // and a failed rated test cannot medal (see the CONSTRAINTS comment).
  const feasible = terms.every((t) => t.inSpec !== false);
  if (!feasible) penalty += (cfg.infeasiblePenalty || 0);
  const composite = Math.max(0, Math.min(1, primaryNorm - penalty));
  // display: 0..100 where 100 = the best achievable design under this objective
  // (compositeMax), the ONE conversion every caller must use so player, STOCHOS,
  // and the rarity stat stay on the same scale.
  const display = Math.round(100 * Math.min(1, composite / (cfg.compositeMax || 1)));
  return {
    composite, display, primaryMean: primMean, primaryNorm, penalty, terms,
    feasible,
  };
}

// score a parameter set (params keyed by input name).
// V3: evaluates predictFull (N-D analytic response), so every input matters.
// V4: when the domain has a CONSTRAINTS entry, the score IS the composite
// objective (primary held in spec, cost down); otherwise legacy primary-only.
// Signature is unchanged so the instruments and challenge call it as before.
export function scoreOf(surrogate, params, primaryOut, goal) {
  if (constraintCfg(surrogate)) {
    const r = compositeObjective(surrogate, params);
    return {
      mean: r.primaryMean, score: r.display,
      primaryNorm: r.primaryNorm, penalty: r.penalty, terms: r.terms, feasible: r.feasible,
    };
  }
  const { mean } = surrogate.predictFull(primaryOut, params);
  return { mean, score: scoreFromMean(surrogate, primaryOut, goal, mean) };
}

// All outputs via predictFull (N-D response). Missing params fall back to input defaults.
export function outputsFull(surrogate, params) {
  const out = {};
  for (const o of surrogate.outputs) out[o.name] = surrogate.predictFull(o.name, params).mean;
  return out;
}

// outputsAt(surrogate, x, y) -> kept for legacy callers (the showdown table etc.).
// Fills the two field axes from x,y; fills remaining inputs with their defaults.
export function outputsAt(surrogate, x, y) {
  const params = {};
  for (const inp of surrogate.inputs) params[inp.name] = inp.default;
  const ax = surrogate.axisInput(0), ay = surrogate.axisInput(1);
  if (ax) params[ax.name] = x;
  if (ay) params[ay.name] = y;
  return outputsFull(surrogate, params);
}

// beatRate: Monte-Carlo over the N-D analytic response (>=20000 samples).
// Returns % of random designs that score strictly above thresholdScore.
// This is the honest "how hard is this to beat" rarity stat.
export function beatRate(surrogate, primaryOut, goal, thresholdScore) {
  const N = 22000;
  const cfg = constraintCfg(surrogate);   // V4: score candidates by the composite when constrained
  let above = 0;
  // deterministic LCG so the stat is stable across calls
  let seed = 0xdeadbeef;
  const rand = () => { seed = (seed * 1664525 + 1013904223) & 0xffffffff; return (seed >>> 0) / 4294967296; };
  for (let s = 0; s < N; s++) {
    const params = {};
    // snap discrete inputs (integer stepper, swatch picker, ...) onto the same
    // grid the player's own control is limited to (FIX 1: discrete fairness),
    // so the rarity stat is computed over the space a human could actually reach.
    for (const inp of surrogate.inputs) params[inp.name] = snapInput(inp, inp.min + rand() * (inp.max - inp.min));
    const sc = cfg
      ? compositeObjective(surrogate, params).display
      : scoreFromMean(surrogate, primaryOut, goal, surrogate.predictFull(primaryOut, params).mean);
    if (sc > thresholdScore) above++;
  }
  return (100 * above) / N;
}

// STOCHOS's best: search the real 2D field for the optimum (kept for studio compat).
export function stochosBest(surrogate, primaryOut, goal) {
  const best = surrogate.bestSoFar(primaryOut, goal);
  const ax = surrogate.axisInput(0), ay = surrogate.axisInput(1);
  const params = {};
  for (const inp of surrogate.inputs) params[inp.name] = inp.default;
  params[ax.name] = best.x; params[ay.name] = best.y;
  return {
    params,
    outputs: outputsAt(surrogate, best.x, best.y),
    mean: best.mean,
    score: scoreFromMean(surrogate, primaryOut, goal, best.mean),
  };
}

// one acquisition step for the animated "Stochos is testing" loop (2D field UCB pick).
export function stochosProbe(surrogate, primaryOut, goal, kappa = 1.5) {
  return surrogate.nextSample(primaryOut, goal === 'low' ? 'low' : 'high', kappa);
}

// FNV-1a string hash -> uint32. Used only to derive a fixed, deterministic RNG
// seed for a domain not in DOMAIN_SEED below (no crypto need; must just be
// stable and well-mixed).
function hashDomainSeed(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  // fold in a fixed constant so the seed space differs from a raw string hash
  // used elsewhere, then avoid 0 (a zero LCG seed degenerates on the first step).
  return (h ^ 0x9e3779b9) >>> 0 || 0x1234abcd;
}

// Fixed per-domain seeds (audit fix 2). A plain hash of the domain name is
// ALREADY fully deterministic, but a couple of domains happened to hash to an
// unlucky corner of the acquisition's candidate space (e.g. chemistry's raw
// hash converges on score 100 every time: the literal ceiling of the N-D
// range, i.e. an unbeatable run). These constants were picked with an offline
// sweep (tools/ QA harness) over many equally-valid deterministic seeds for
// the one that lands STOCHOS's run near this domain's ORIGINAL calibration
// target (see the DOMAIN_RUN_CFG comment above: paint mean~86.2, chemistry
// mean~84.7) on the real, noise-free field. This picks WHICH honest fixed seed
// ships, nothing about the resulting score is clamped, floored, or fabricated.
// A domain missing from this table falls back to hashDomainSeed, so nothing is
// ever left non-deterministic even if the schema grows a new domain.
// V4.1 reseed (2026-07-14): the hardened engine (UI-grid snapping via the schema
// steps, infeasiblePenalty, re-anchored compositeMax) changes every run, so the
// seeds were re-swept (scratchpad reseed harness, up to 12000 candidates per
// domain). A shipping seed must satisfy ALL of: display score in the target band
// near the config's verified mean; strictly FEASIBLE (every spec band held,
// including the bottle's 26 bar rated test, so the deterministic run every
// visitor sees keeps the promises in the copy); story-conformant secondaries;
// and a climbing picks curve (the converge viz ends on the run's best). As
// before, this picks WHICH honest fixed seed ships; no score is clamped or
// fabricated. Bottle ships at the hard end on Jason's call (2026-07-14):
// the skilled-proxy beat rate at 98 is ~4%.
const DOMAIN_SEED = {
  paint: 0x6526afd1,        // 86: viscosity 1848 (band 900-2100), gloss 33.3 (band 24-42), cost 2.02
  chemistry: 0x1434f90c,    // 84: selectivity 79.4 (floor 78), cost 1.90
  bottle: 0x2344b7f4,       // 98: burst 27.19 bar HOLDS the 26 bar rated test (the verdict is
                            // binary at the target, so the ship run must clear it, not land at
                            // 26-epsilon), at 37.0 g / cost 1.15 (naive burst-max: 55.5 g)
  engineering: 0x64fc4b5b,  // studio-only heatsink domain, legacy path, V3 seed unchanged
};
function domainSeedFor(domainKey) {
  return DOMAIN_SEED[domainKey] != null ? DOMAIN_SEED[domainKey] : hashDomainSeed(domainKey);
}

// STOCHOS under a small EXPERIMENT BUDGET: N-D budgeted optimizer using nextSampleFull.
// Budget and noise are tuned per domain so STOCHOS typically lands ~85-92 (beatable).
// Returns {params, outputs, score, mean, picks:[scores]}.
// SAME signature shape as before so studio.js keeps working.
//
// DETERMINISM (audit fix 2): the run seeds from a FIXED hash of the domain name,
// never Date.now(). STOCHOS's search does not depend on the player's params (this
// function takes none), so a given domain always reproduces the same picks/score/
// rarity stat: "watch it optimize" and "Play again" on the same domain converge
// identically every time. Reliability comes ONLY from this fixed seed plus a
// budget/pool verified to converge near the real field's optimum (see the QA
// harness note above DOMAIN_RUN_CFG) -- the score itself is never clamped, floored,
// or otherwise fabricated.
export function stochosRun(surrogate, primaryOut, goal, budgetOverride, kappaIgnored) {
  // Resolve the domain from the data or fall back to the primaryOut for lookup
  const domainKey = (surrogate.data && surrogate.data.domain) || 'paint';
  // look up by domain name; fall back to engineering cfg for bottle domain
  const runCfg = DOMAIN_RUN_CFG[domainKey] || DOMAIN_RUN_CFG['engineering'];
  const budget = (budgetOverride != null) ? budgetOverride : runCfg.budget;
  const domainSeed = domainSeedFor(domainKey);

  // V4: when the domain is constrained, STOCHOS optimizes AND is scored by the
  // SAME composite objective as the player, so it cannot win by wrecking a
  // secondary the copy said it was holding. null => legacy primary-only.
  const constrained = constraintCfg(surrogate);
  const objective = constrained ? (p) => compositeObjective(surrogate, p).composite : null;
  const scoreParams = constrained
    ? (p) => compositeObjective(surrogate, p).display
    : (p) => scoreFromMean(surrogate, primaryOut, goal, surrogate.predictFull(primaryOut, p).mean);

  let bestParams = null, bestScore = -Infinity;
  let currentBest = null;   // for local radius shrinking
  const picks = [];

  for (let i = 0; i < budget; i++) {
    // Step 0 is always global random (no local bias); later steps use local_radius.
    // global_frac controls what fraction of later steps' pool remains global.
    const localRadius = i < 1 ? null : runCfg.localRadius * Math.pow(0.85, i - 1);
    const pick = surrogate.nextSampleFull(primaryOut, goal, {
      pool_size:    runCfg.pool,
      noise:        runCfg.noise,
      local_radius: localRadius,
      global_frac:  runCfg.globalFrac != null ? runCfg.globalFrac : 0.5,
      best_so_far:  currentBest,
      objective,    // V4: composite objective (null => legacy primary-mean acquisition)
      // deterministic: fixed domain seed mixed with the step index only (no
      // wall-clock input), so the same domain always yields the same run.
      seed:         (domainSeed + i * 0x9e3779b9) >>> 0,
    });
    const score = scoreParams(pick.params);
    picks.push(score);
    if (score > bestScore) {
      bestScore  = score;
      bestParams = pick.params;
      currentBest = pick.params;
    }
  }

  // Fill any missing params with defaults (should not happen but be safe)
  const params = {};
  for (const inp of surrogate.inputs) params[inp.name] = inp.default;
  Object.assign(params, bestParams);

  return {
    params,
    outputs: outputsFull(surrogate, params),
    mean:    surrogate.predictFull(primaryOut, params).mean,
    score:   bestScore,
    picks,
    // V4: per-term spec/cost breakdown of STOCHOS's winning design, for the
    // showdown to show the constraints were actually held. null when legacy.
    breakdown: constrained ? compositeObjective(surrogate, params).terms : null,
  };
}
