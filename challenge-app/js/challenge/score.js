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

export const PRIMARY = {
  paint:       { out: 'contrast_ratio', goal: 'high' },
  chemistry:   { out: 'yield_pct',      goal: 'high' },
  engineering: { out: 'burst_bar',      goal: 'high' },
};

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
const DOMAIN_RUN_CFG = {
  // paint 9-D: wide Gaussian peak; budget=5, large pool=40 for thorough coverage
  paint:      { budget: 5,  pool: 40, noise: 0.06, localRadius: 0.22, globalFrac: 0.50 },
  // chemistry 8-D: narrow yield ridge; higher budget=9 needed to coordinate 8 dims
  //   (irreducible tension: mean>=84 and p10>=72 keep skilled-beats at 15-17%)
  chemistry:  { budget: 9,  pool: 16, noise: 0.06, localRadius: 0.20, globalFrac: 0.50 },
  // bottle/engineering: unchanged (architecture unchanged from V3)
  bottle:     { budget: 5,  pool: 20, noise: 0.11, localRadius: 0.14, globalFrac: 0.60 },
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

// score a parameter set (params keyed by input name).
// V3: evaluates predictFull (N-D analytic response), so every input matters.
export function scoreOf(surrogate, params, primaryOut, goal) {
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
  let above = 0;
  // deterministic LCG so the stat is stable across calls
  let seed = 0xdeadbeef;
  const rand = () => { seed = (seed * 1664525 + 1013904223) & 0xffffffff; return (seed >>> 0) / 4294967296; };
  for (let s = 0; s < N; s++) {
    const params = {};
    for (const inp of surrogate.inputs) params[inp.name] = inp.min + rand() * (inp.max - inp.min);
    const { mean } = surrogate.predictFull(primaryOut, params);
    if (scoreFromMean(surrogate, primaryOut, goal, mean) > thresholdScore) above++;
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

// STOCHOS under a small EXPERIMENT BUDGET: N-D budgeted optimizer using nextSampleFull.
// Budget and noise are tuned per domain so STOCHOS typically lands ~85-92 (beatable).
// Returns {params, outputs, score, mean, picks:[scores]}.
// SAME signature shape as before so studio.js keeps working.
export function stochosRun(surrogate, primaryOut, goal, budgetOverride, kappaIgnored) {
  // Resolve the domain from the data or fall back to the primaryOut for lookup
  const domainKey = (surrogate.data && surrogate.data.domain) || 'paint';
  // look up by domain name; fall back to engineering cfg for bottle domain
  const cfg = DOMAIN_RUN_CFG[domainKey] || DOMAIN_RUN_CFG['engineering'];
  const budget = (budgetOverride != null) ? budgetOverride : cfg.budget;

  let bestParams = null, bestMean = null, bestScore = -Infinity;
  let currentBest = null;   // for local radius shrinking
  const picks = [];

  for (let i = 0; i < budget; i++) {
    // Step 0 is always global random (no local bias); later steps use local_radius.
    // global_frac controls what fraction of later steps' pool remains global.
    const localRadius = i < 1 ? null : cfg.localRadius * Math.pow(0.85, i - 1);
    const pick = surrogate.nextSampleFull(primaryOut, goal, {
      pool_size:    cfg.pool,
      noise:        cfg.noise,
      local_radius: localRadius,
      global_frac:  cfg.globalFrac != null ? cfg.globalFrac : 0.5,
      best_so_far:  currentBest,
      seed:         (i * 0x9e3779b9) ^ (Date.now() & 0xffffff),
    });
    const score = scoreFromMean(surrogate, primaryOut, goal, pick.mean);
    picks.push(score);
    if (score > bestScore) {
      bestScore  = score;
      bestParams = pick.params;
      bestMean   = pick.mean;
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
    mean:    bestMean,
    score:   bestScore,
    picks,
  };
}
