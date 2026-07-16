// Surrogate: loads an exported STOCHOS DIM-GP field and serves predictions.
// The mean + std grids ARE the real model's output (sampled offline); here we
// just bilinearly read them and run acquisition logic on top, the same logic
// STOCHOS uses to choose the next experiment.
//
// V3 additions (CHALLENGE-V3-PLAN.md A1-A2):
//   predictFull(name, params) -> {mean,std}  N-D analytic response
//   predictFullStats(name) -> {mn,mx}         N-D range for score normalization
//   nextSampleFull(name, goal, opts) -> {params,mean}  budgeted N-D acquisition

// Module-level in-memory cache: stores the parsed JSON data (NOT the Surrogate
// instance). Each call gets a FRESH Surrogate so per-session mutable state
// (samples, _fullStats) is never shared between callers. The fetch + JSON.parse
// cost is paid at most once per page load per domain.
const _dataCache = {};

export async function loadDomain(name) {
  if (!_dataCache[name]) {
    // Store the in-flight promise so concurrent calls await the same fetch
    // instead of issuing duplicate requests.
    _dataCache[name] = fetch(`data/${name}.json`)
      .then((res) => { if (!res.ok) throw new Error(`missing data/${name}.json`); return res.json(); })
      .catch((e) => { delete _dataCache[name]; throw e; }); // evict on error so retry works
  }
  return new Surrogate(await _dataCache[name]);
}

function bilinear(grid, gx, gy, x, y) {
  const nx = gx.length, ny = gy.length;
  let ix = 0; while (ix < nx - 2 && gx[ix + 1] < x) ix++;
  let iy = 0; while (iy < ny - 2 && gy[iy + 1] < y) iy++;
  const tx = Math.max(0, Math.min(1, (x - gx[ix]) / (gx[ix + 1] - gx[ix])));
  const ty = Math.max(0, Math.min(1, (y - gy[iy]) / (gy[iy + 1] - gy[iy])));
  const a = grid[iy][ix] * (1 - tx) + grid[iy][ix + 1] * tx;
  const b = grid[iy + 1][ix] * (1 - tx) + grid[iy + 1][ix + 1] * tx;
  return a * (1 - ty) + b * ty;
}

// ---- V3: canonical evaluator for the analytic N-D response (A1) ----
// All math in normalized input space u = (value-min)/(max-min), clamped [0,1].
// block = { const, terms:[{k,vars,pow}], gauss:[{amp,at,sigma}], clamp:[lo,hi] }
function evalResponseBlock(block, u) {
  let mean = block.const;
  for (const t of (block.terms || [])) {
    let prod = t.k;
    for (let j = 0; j < t.vars.length; j++) prod *= Math.pow(u[t.vars[j]], t.pow[j]);
    mean += prod;
  }
  for (const g of (block.gauss || [])) {
    let d2 = 0;
    for (const v of Object.keys(g.at)) {
      const diff = (u[v] - g.at[v]) / g.sigma[v];
      d2 += diff * diff;
    }
    mean += g.amp * Math.exp(-0.5 * d2);
  }
  if (block.clamp) mean = Math.max(block.clamp[0], Math.min(block.clamp[1], mean));
  return mean;
}

// FIX (discrete-input fairness): snap a value onto an input's allowed grid, so
// the acquisition/rarity samplers can never reach a value the player's own
// control cannot. An input declares its granularity via the SAME optional,
// backward-compatible fields the data contract allows:
//   "choices": [v1,v2,...]  an explicit discrete set (e.g. a swatch picker) ->
//              snap to the nearest listed choice.
//   "step": n                a grid spacing anchored at `min` (e.g. an integer
//              stepper) -> snap to the nearest min + k*step, clamped to range.
// Inputs with neither field are untouched (still fully continuous).
export function snapInput(inp, v) {
  if (!Number.isFinite(v)) return v;
  if (Array.isArray(inp.choices) && inp.choices.length) {
    let best = inp.choices[0], bestD = Math.abs(v - best);
    for (const c of inp.choices) {
      const d = Math.abs(v - c);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }
  if (inp.step > 0) {
    const snapped = inp.min + Math.round((v - inp.min) / inp.step) * inp.step;
    return Math.max(inp.min, Math.min(inp.max, snapped));
  }
  return v;
}

// Compute the normalized u for every input, given a partial params object.
// Missing keys fall back to the input's default.
// FIX m8: any non-finite (NaN, Infinity, -Infinity) resolved value is coerced to
// that input's default before normalization so predictFull never returns NaN.
function makeU(inputs, params) {
  const u = {};
  for (const inp of inputs) {
    let v = (params != null && params[inp.name] != null) ? params[inp.name] : inp.default;
    // coerce non-finite to default (covers NaN, Infinity, -Infinity)
    if (!isFinite(v)) v = inp.default;
    const range = inp.max - inp.min;
    u[inp.name] = range > 0 ? Math.max(0, Math.min(1, (v - inp.min) / range)) : 0;
  }
  return u;
}

export class Surrogate {
  constructor(data) {
    this.data = data;
    this.inputs = data.inputs;
    this.outputs = data.outputs;
    this.axes = data.axes;
    this.grid = data.grid;
    this.fields = data.fields;
    this.trainPoints = data.train_points || [];
    this.response = data.response || null;    // V3 analytic response blocks
    this._sanitizeStrings();                  // F8: strip tag chars from data labels/units
    this._stats = {};
    for (const o of this.outputs) this._stats[o.name] = this._statsFor(o.name);
    // active-learning state: virtual samples that locally shrink uncertainty
    this.samples = [];
    // V3: cached N-D stats (lazy, computed once per output)
    this._fullStats = {};
  }

  // F8 hardening: the data is same-origin + synthetic, but treat its human-facing
  // strings as untrusted - strip HTML tag/quote chars from labels/units/title/preview
  // so a tampered data file (CDN/MITM) can never inject markup at any render site.
  // Invisible for legitimate data (labels contain none of these chars) and safe for
  // both innerHTML and canvas text (it strips, it does not entity-encode).
  _sanitizeStrings() {
    const clean = (s) => (typeof s === 'string' ? s.replace(/[<>"'`]/g, '') : s);
    if (this.data && typeof this.data.title === 'string') this.data.title = clean(this.data.title);
    for (const i of (this.inputs || [])) { i.label = clean(i.label); i.unit = clean(i.unit); }
    for (const o of (this.outputs || [])) { o.label = clean(o.label); o.unit = clean(o.unit); }
    for (const r of (this.data.preview_rows || [])) {
      r.label = clean(r.label);
      if (r.cells) for (const k of Object.keys(r.cells)) r.cells[k] = clean(r.cells[k]);
    }
  }

  axisInput(k) { return this.inputs.find((i) => i.name === this.axes[k]); }

  _statsFor(name) {
    const f = this.fields[name];
    let mn = Infinity, mx = -Infinity, smn = Infinity, smx = -Infinity;
    for (let j = 0; j < f.mean.length; j++)
      for (let i = 0; i < f.mean[0].length; i++) {
        const m = f.mean[j][i], s = f.std[j][i];
        if (m < mn) mn = m; if (m > mx) mx = m;
        if (s < smn) smn = s; if (s > smx) smx = s;
      }
    return { mn, mx, smn, smx };
  }

  stats(name) { return this._stats[name]; }

  // raw value-space x,y (axis units). returns mean & std with active-learning shrink.
  predict(name, x, y) {
    const f = this.fields[name];
    const mean = bilinear(f.mean, this.grid.x, this.grid.y, x, y);
    let std = bilinear(f.std, this.grid.x, this.grid.y, x, y);
    std *= this._shrink(x, y);
    return { mean, std };
  }

  // multiplicative variance reduction from nearby virtual samples (GP-like)
  _shrink(x, y) {
    if (!this.samples.length) return 1;
    const ax = this.axisInput(0), ay = this.axisInput(1);
    const nx = (x - ax.min) / (ax.max - ax.min);
    const ny = (y - ay.min) / (ay.max - ay.min);
    let s = 1;
    const L = 0.11; // correlation length in normalized axis units
    for (const p of this.samples) {
      const px = (p.x - ax.min) / (ax.max - ax.min);
      const py = (p.y - ay.min) / (ay.max - ay.min);
      const d2 = (nx - px) ** 2 + (ny - py) ** 2;
      s *= 1 - 0.93 * Math.exp(-d2 / (2 * L * L));
    }
    return s;
  }

  norm(name, m) { const s = this.stats(name); return (m - s.mn) / (s.mx - s.mn || 1); }
  normStd(name, sd) { const s = this.stats(name); return (sd - s.smn) / (s.smx - s.smn || 1); }

  // ---- V3: N-D analytic prediction ----------------------------------------
  // predictFull(name, params) -> {mean, std}
  // mean: from the analytic response block (all inputs matter).
  // std:  from the 2D field at the axis location (cheap; fine for readouts).
  // Falls back to the 2D field predict() if no response block exists for name.
  predictFull(name, params) {
    // FIX m8: resolve axis values, coercing non-finite to default
    const _resolveAxis = (ax) => {
      const v = (params && params[ax.name] != null) ? params[ax.name] : ax.default;
      return isFinite(v) ? v : ax.default;
    };
    if (!this.response || !this.response[name]) {
      // back-compat: use the 2D field
      const ax = this.axisInput(0), ay = this.axisInput(1);
      return this.predict(name, _resolveAxis(ax), _resolveAxis(ay));
    }
    // makeU already coerces non-finite values (FIX m8 in makeU above)
    const u = makeU(this.inputs, params);
    const mean = evalResponseBlock(this.response[name], u);
    // std from the 2D field at the axis location
    const ax = this.axisInput(0), ay = this.axisInput(1);
    const { std } = this.predict(name, _resolveAxis(ax), _resolveAxis(ay));
    return { mean, std };
  }

  // predictFullStats(name) -> {mn,mx}
  // FAST PATH (V3b): if the JSON ships a precomputed score_range[name] (computed from a
  // dense 200k+ offline scan), use it directly and skip the runtime Monte-Carlo entirely.
  // FALLBACK: runtime LCG Monte-Carlo (24000 samples) for domains without score_range.
  // Both paths cache after first call.
  predictFullStats(name) {
    if (this._fullStats[name]) return this._fullStats[name];
    // V3b fast path: precomputed dense-scan range in the JSON
    if (this.data.score_range && this.data.score_range[name] != null) {
      const [mn, mx] = this.data.score_range[name];
      return (this._fullStats[name] = { mn, mx });
    }
    if (!this.response || !this.response[name]) {
      // back-compat: use the 2D field range
      const s = this.stats(name);
      return (this._fullStats[name] = { mn: s.mn, mx: s.mx });
    }
    const N = 24000;
    let mn = Infinity, mx = -Infinity;
    // Simple LCG-based pseudo-random (deterministic, no external dependency)
    let seed = 0x12345678;
    const rand = () => { seed = (seed * 1664525 + 1013904223) & 0xffffffff; return (seed >>> 0) / 4294967296; };
    for (let s = 0; s < N; s++) {
      const params = {};
      // snap discrete inputs (step/choices) so the range reflects the reachable
      // design space, not a continuous relaxation of it (see snapInput above).
      for (const inp of this.inputs) params[inp.name] = snapInput(inp, inp.min + rand() * (inp.max - inp.min));
      const { mean } = this.predictFull(name, params);
      if (mean < mn) mn = mean;
      if (mean > mx) mx = mean;
    }
    return (this._fullStats[name] = { mn, mx });
  }

  // ---- V3: N-D acquisition -------------------------------------------------
  // nextSampleFull(name, goal, opts) -> { params, mean }
  // A budgeted candidate-pool optimizer over ALL inputs:
  //   - pool_size:    total candidates per call
  //   - local_radius: Gaussian sampling width around best_so_far (in normalized space)
  //   - global_frac:  fraction of pool that is always global-random even in local steps
  //                   (0 = pure local in later steps; 0.5 = half global always)
  //                   Default 0.5. Prevents locking into a bad starting basin.
  //   - noise:        std of Gaussian noise added to acquisition (in normalized output units)
  //   - best_so_far:  {params} for local sampling centre
  // Returns a full params object (all inputs) + the response mean.
  nextSampleFull(name, goal, opts) {
    opts = opts || {};
    const poolSize    = opts.pool_size    || 10;
    const localRadius = opts.local_radius || null;    // normalized 0..1, null = pure global
    const globalFrac  = opts.global_frac  != null ? opts.global_frac : 0.5;
    const noise       = opts.noise        || 0;        // std in normalized output units (0..1)
    const bestSoFar   = opts.best_so_far  || null;
    // V4: optional composite objective. When supplied, STOCHOS optimizes THIS
    // scalar (a 0..1 "higher is better" value computed from all relevant outputs,
    // e.g. the constrained challenge score) instead of the single primary mean,
    // so its search matches exactly what the challenge scores. null = legacy.
    const objective   = opts.objective    || null;

    // Deterministic seeded random for reproducibility within a run
    let seed = opts.seed != null ? opts.seed : (Date.now() & 0xffffffff);
    const rand = () => { seed = (seed * 1664525 + 1013904223) & 0xffffffff; return (seed >>> 0) / 4294967296; };
    const randN = () => {
      // Box-Muller for N(0,1)
      const u1 = Math.max(1e-10, rand()), u2 = rand();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    };

    // How many candidates are always global-random (not influenced by local_radius)
    const nGlobal = Math.round(poolSize * globalFrac);

    let best = null;
    for (let s = 0; s < poolSize; s++) {
      // Candidates s < nGlobal are always global random; the rest use local sampling
      // when localRadius and bestSoFar are available.
      const isGlobal = (s < nGlobal) || !localRadius || !bestSoFar;
      const params = {};
      for (const inp of this.inputs) {
        let v;
        if (!isGlobal && bestSoFar[inp.name] != null) {
          // local sampling: N(best, radius) in normalized space, mapped back
          const uBest = (bestSoFar[inp.name] - inp.min) / (inp.max - inp.min);
          const uNew  = Math.max(0, Math.min(1, uBest + randN() * localRadius));
          v = inp.min + uNew * (inp.max - inp.min);
        } else {
          v = inp.min + rand() * (inp.max - inp.min);
        }
        // FIX (discrete-input fairness): STOCHOS may only propose a value the
        // player's own control could reach (integer stepper, swatch picker, ...).
        params[inp.name] = snapInput(inp, v);
      }
      const { mean } = this.predictFull(name, params);
      // acquisition value (exploit only; exploration handled by candidate diversity)
      let acq;
      if (objective) {
        // V4 constrained path: maximize the composite objective (0..1). Noise is
        // already in score units here, so it is NOT rescaled by an output range.
        acq = objective(params);
        if (noise > 0) acq += randN() * noise;
      } else {
        acq = goal === 'low' ? -mean : mean;
        if (noise > 0) {
          // add noise in output units (noise * range)
          const st = this.predictFullStats(name);
          const range = (st.mx - st.mn) || 1;
          acq += randN() * noise * range;
        }
      }
      if (!best || acq > best.acq) best = { params, mean, acq };
    }
    return { params: best.params, mean: best.mean };
  }

  // Acquisition: where should STOCHOS run the next experiment?
  // goal: 'high' | 'low' | 'explore' (window handled as explore here)
  // kappa trades exploitation vs exploration (UCB-style on the real mean/std field)
  nextSample(name, goal, kappa = 1.4) {
    const gx = this.grid.x, gy = this.grid.y;
    let best = null;
    for (let j = 1; j < gy.length - 1; j += 1) {
      for (let i = 1; i < gx.length - 1; i += 1) {
        const x = gx[i], y = gy[j];
        const { mean, std } = this.predict(name, x, y);
        const mN = this.norm(name, mean);
        const sN = Math.max(0, std / (this.stats(name).smx || 1));
        // 'window' has no single max to chase: drive it like 'explore' (pure info gain)
        // so we never silently maximize a target-band property. Matches studio-field.js.
        let exploit = goal === 'low' ? 1 - mN : (goal === 'explore' || goal === 'window') ? 0 : mN;
        const score = exploit + kappa * sN;
        if (!best || score > best.score) best = { x, y, mean, std, score };
      }
    }
    return best;
  }

  addSample(x, y) { this.samples.push({ x, y }); }
  reset() { this.samples = []; }

  // current best (exploited) location on the field
  bestSoFar(name, goal) {
    const gx = this.grid.x, gy = this.grid.y;
    let best = null;
    for (let j = 0; j < gy.length; j++)
      for (let i = 0; i < gx.length; i++) {
        const m = this.fields[name].mean[j][i];
        const v = goal === 'low' ? -m : m;
        if (!best || v > best.v) best = { x: gx[i], y: gy[j], mean: m, v };
      }
    return best;
  }
}
