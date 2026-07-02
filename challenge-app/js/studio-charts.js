// Branch readout charts for the Stochos Flow Web guided builder (step 5, per-industry).
// Three small canvas-2D charts, brand amber on near-black, no dependencies.
//   drawTornado     chemistry   Sobol-style importance bars
//   drawPareto      engineering non-dominated front over a cost cloud
//   drawCorrelation paint       diverging correlation bars
// studio.js computes every number from the trained surrogate and passes it in.
// These functions only render: they clear and fully redraw, are safe to call
// repeatedly (re-render on a decision change), and never throw on empty input.
import { CMAP_VALUE } from './colormap.js';

// ---- brand tokens (no new colors) ----
const AMBER = '#ffb006';
const AMBER_SOFT = 'rgba(255,176,6,0.42)';
const AMBER_FAINT = 'rgba(255,176,6,0.16)';
const STEEL = 'rgba(156,152,144,1)';        // negative / secondary tone (warm neutral)
const STEEL_SOFT = 'rgba(156,152,144,0.45)';
const STEEL_FAINT = 'rgba(156,152,144,0.22)';
const GRID = 'rgba(255,255,255,0.10)';
const GRID_SOFT = 'rgba(255,255,255,0.06)';
const AXIS = 'rgba(255,255,255,0.22)';
const LABEL = 'rgba(225,220,210,0.92)';
const LABEL_DIM = 'rgba(156,152,144,0.85)';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

// Match field.js's dpr handling: size the backing store to the laid-out box if the
// canvas is in flow, else fall back to its width/height attributes. Returns a 2D
// context already transformed to CSS pixels plus the logical {w,h} to draw in.
function prep(canvas) {
  if (!canvas || !canvas.getContext) return null;
  const dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2);
  const rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { width: 0, height: 0 };
  // clientWidth/Height are 0 until laid out; fall back to the attribute size.
  let w = canvas.clientWidth || rect.width || canvas.width || 320;
  let h = canvas.clientHeight || rect.height || canvas.height || 180;
  w = Math.max(2, Math.round(w));
  h = Math.max(2, Math.round(h));
  const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function amberRamp(t) {
  const [r, g, b] = CMAP_VALUE(Math.max(0, Math.min(1, t)));
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

function emptyNote(ctx, w, h, msg) {
  ctx.fillStyle = LABEL_DIM;
  ctx.font = `10px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(msg, w / 2, h / 2);
  ctx.textAlign = 'left';
}

// crop a label to fit a pixel budget at the current font (no ellipsis char needed)
function fit(ctx, text, maxPx) {
  text = String(text == null ? '' : text);
  if (ctx.measureText(text).width <= maxPx) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + '..').width > maxPx) s = s.slice(0, -1);
  return s + '..';
}

// ============================================================================
// TORNADO  (chemistry): horizontal amber bars, importance 0..1, descending.
// items: [{label, importance}]. Longest on top. Value labels at the bar end.
// Host adds the title; this is title-less.
// ============================================================================
export function drawTornado(canvas, items) {
  const p = prep(canvas);
  if (!p) return;
  const { ctx, w, h } = p;

  const data = (Array.isArray(items) ? items : [])
    .filter((d) => d && isFinite(d.importance))
    .map((d) => ({ label: d.label == null ? '' : String(d.label), v: Math.max(0, +d.importance) }))
    .sort((a, b) => b.v - a.v);

  if (!data.length) { emptyNote(ctx, w, h, 'no factors'); return; }

  const padL = Math.min(96, Math.max(56, w * 0.30)); // room for left labels
  const padR = 38;                                    // room for value text
  const padT = 8, padB = 8;
  const plotW = Math.max(8, w - padL - padR);
  const n = data.length;
  const rowH = (h - padT - padB) / n;
  const barH = Math.max(5, Math.min(20, rowH * 0.62));
  const max = Math.max(...data.map((d) => d.v)) || 1;

  ctx.font = `10px ${MONO}`;
  ctx.textBaseline = 'middle';

  // faint vertical gridlines at 0 / .25 / .5 / .75 / 1 of the max
  for (let g = 0; g <= 4; g++) {
    const gx = padL + (g / 4) * plotW;
    ctx.strokeStyle = g === 0 ? AXIS : GRID_SOFT;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(gx) + 0.5, padT);
    ctx.lineTo(Math.round(gx) + 0.5, h - padB);
    ctx.stroke();
  }

  data.forEach((d, i) => {
    const cy = padT + rowH * (i + 0.5);
    const bw = (d.v / max) * plotW;

    // bar: brighter for the dominant drivers, fading down the rank
    ctx.fillStyle = amberRamp(0.55 + 0.45 * (d.v / max));
    ctx.fillRect(padL, cy - barH / 2, Math.max(1, bw), barH);
    ctx.fillStyle = AMBER_FAINT;
    ctx.fillRect(padL, cy - barH / 2, plotW, 1); // baseline tick under each row

    // left label (factor name)
    ctx.fillStyle = LABEL;
    ctx.textAlign = 'right';
    ctx.fillText(fit(ctx, d.label, padL - 10), padL - 8, cy);

    // value at the bar end
    ctx.fillStyle = LABEL_DIM;
    ctx.textAlign = 'left';
    ctx.fillText(d.v.toFixed(2), padL + Math.max(1, bw) + 5, cy);
  });

  ctx.textAlign = 'left';
}

// ============================================================================
// PARETO  (engineering): scatter the cost cloud muted, highlight the
// non-dominated front in amber (markers + connecting line). Axis labels.
// points: [{a,b}]. opts: {aLabel, bLabel, aGoal:'low'|'high', bGoal}.
// Default both objectives MINIMIZE ('low').
// ============================================================================
export function drawPareto(canvas, points, opts = {}) {
  const p = prep(canvas);
  if (!p) return;
  const { ctx, w, h } = p;

  const pts = (Array.isArray(points) ? points : [])
    .filter((d) => d && isFinite(d.a) && isFinite(d.b))
    .map((d) => ({ a: +d.a, b: +d.b }));

  const aGoal = opts.aGoal === 'high' ? 'high' : 'low';
  const bGoal = opts.bGoal === 'high' ? 'high' : 'low';
  const aLabel = opts.aLabel || 'objective A';
  const bLabel = opts.bLabel || 'objective B';

  const padL = 40, padR = 12, padT = 12, padB = 26;
  const plotW = Math.max(8, w - padL - padR);
  const plotH = Math.max(8, h - padT - padB);

  // axes always drawn (so an empty cloud still reads as a chart, never throws)
  drawParetoAxes(ctx, padL, padT, plotW, plotH, aLabel, bLabel);
  if (!pts.length) { emptyNote(ctx, padL + plotW / 2, padT + plotH / 2, 'no trade-off points'); return; }

  let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
  for (const d of pts) {
    if (d.a < aMin) aMin = d.a; if (d.a > aMax) aMax = d.a;
    if (d.b < bMin) bMin = d.b; if (d.b > bMax) bMax = d.b;
  }
  const aSpan = aMax - aMin || 1, bSpan = bMax - bMin || 1;
  // a on x (left=better), b on y (bottom=better); flip per goal so "better" is
  // always toward the origin corner, which is the intuitive Pareto reading.
  const sx = (v) => padL + (aGoal === 'low' ? (v - aMin) / aSpan : (aMax - v) / aSpan) * plotW;
  const sy = (v) => padT + (bGoal === 'low' ? (v - bMin) / bSpan : (bMax - v) / bSpan) * plotH;

  // ---- non-dominated front ----
  const front = paretoFront(pts, aGoal, bGoal);
  const frontSet = new Set(front);

  // muted cloud first
  for (const d of pts) {
    if (frontSet.has(d)) continue;
    ctx.fillStyle = STEEL_SOFT;
    ctx.beginPath();
    ctx.arc(sx(d.a), sy(d.b), 2.1, 0, 7);
    ctx.fill();
  }

  // connecting line along the sorted front
  const sorted = front.slice().sort((m, n) => sx(m.a) - sx(n.a));
  if (sorted.length > 1) {
    ctx.strokeStyle = AMBER_SOFT;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    sorted.forEach((d, i) => {
      const X = sx(d.a), Y = sy(d.b);
      if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
    });
    ctx.stroke();
  }

  // amber front markers on top
  for (const d of front) {
    const X = sx(d.a), Y = sy(d.b);
    ctx.fillStyle = AMBER;
    ctx.beginPath();
    ctx.arc(X, Y, 3.3, 0, 7);
    ctx.fill();
    ctx.strokeStyle = 'rgba(7,7,7,0.85)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // tiny "better ->" cue toward the origin corner
  ctx.fillStyle = LABEL_DIM;
  ctx.font = `9px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.fillText('better', padL + 3, padT + 9);
}

function drawParetoAxes(ctx, padL, padT, plotW, plotH, aLabel, bLabel) {
  // frame gridlines
  ctx.strokeStyle = GRID_SOFT;
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const gx = padL + (i / 4) * plotW;
    const gy = padT + (i / 4) * plotH;
    ctx.beginPath(); ctx.moveTo(Math.round(gx) + 0.5, padT); ctx.lineTo(Math.round(gx) + 0.5, padT + plotH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(padL, Math.round(gy) + 0.5); ctx.lineTo(padL + plotW, Math.round(gy) + 0.5); ctx.stroke();
  }
  // axis lines
  ctx.strokeStyle = AXIS;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL + 0.5, padT);
  ctx.lineTo(padL + 0.5, padT + plotH + 0.5);
  ctx.lineTo(padL + plotW, padT + plotH + 0.5);
  ctx.stroke();

  // axis labels (mono, dim)
  ctx.fillStyle = LABEL_DIM;
  ctx.font = `9px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(fit(ctx, aLabel, plotW), padL + plotW / 2, padT + plotH + 18);
  // y label, rotated
  ctx.save();
  ctx.translate(padL - 30, padT + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText(fit(ctx, bLabel, plotH), 0, 0);
  ctx.restore();
  ctx.textAlign = 'left';
}

// A point is non-dominated if no OTHER point is better-or-equal on both
// objectives and strictly better on at least one (respecting per-objective goal).
// 'low' = smaller is better (minimize), 'high' = larger is better.
function paretoFront(pts, aGoal, bGoal) {
  const betterEq = (x, y, goal) => (goal === 'low' ? x <= y : x >= y);
  const strictly = (x, y, goal) => (goal === 'low' ? x < y : x > y);
  const front = [];
  for (let i = 0; i < pts.length; i++) {
    const d = pts[i];
    let dominated = false;
    for (let j = 0; j < pts.length; j++) {
      if (i === j) continue;
      const o = pts[j];
      const beA = betterEq(o.a, d.a, aGoal), beB = betterEq(o.b, d.b, bGoal);
      const stA = strictly(o.a, d.a, aGoal), stB = strictly(o.b, d.b, bGoal);
      if (beA && beB && (stA || stB)) { dominated = true; break; }
    }
    if (!dominated) front.push(d);
  }
  return front;
}

// ============================================================================
// CORRELATION  (paint): one diverging bar per pair, r in -1..1. Amber for
// positive, steel for negative. r value printed. Zero axis down the middle.
// pairs: [{label, r}].
// ============================================================================
export function drawCorrelation(canvas, pairs) {
  const p = prep(canvas);
  if (!p) return;
  const { ctx, w, h } = p;

  const data = (Array.isArray(pairs) ? pairs : [])
    .filter((d) => d && isFinite(d.r))
    .map((d) => ({ label: d.label == null ? '' : String(d.label), r: Math.max(-1, Math.min(1, +d.r)) }));

  const padL = Math.min(120, Math.max(64, w * 0.34)); // pair labels on the left
  const padR = 14, padT = 10, padB = 16;
  const plotW = Math.max(8, w - padL - padR);
  const zeroX = padL + plotW / 2;             // r=0 at the center
  const half = plotW / 2;

  // zero axis + faint gridlines at +/-0.5 and +/-1
  ctx.font = `9px ${MONO}`;
  ctx.textBaseline = 'middle';
  for (const g of [-1, -0.5, 0.5, 1]) {
    const gx = zeroX + g * half;
    ctx.strokeStyle = GRID_SOFT;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(gx) + 0.5, padT);
    ctx.lineTo(Math.round(gx) + 0.5, h - padB);
    ctx.stroke();
  }
  // scale ticks
  ctx.fillStyle = LABEL_DIM;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  for (const g of [-1, 0, 1]) {
    ctx.fillText(g === 0 ? '0' : (g > 0 ? '+1' : '-1'), zeroX + g * half, h - 5);
  }

  if (!data.length) {
    // still draw the zero axis, then a note
    drawZeroAxis(ctx, zeroX, padT, h - padB);
    emptyNote(ctx, padL + plotW / 2, padT + (h - padT - padB) / 2, 'no correlations');
    return;
  }

  const n = data.length;
  const rowH = (h - padT - padB) / n;
  const barH = Math.max(5, Math.min(18, rowH * 0.58));

  ctx.textBaseline = 'middle';
  data.forEach((d, i) => {
    const cy = padT + rowH * (i + 0.5);
    const len = Math.abs(d.r) * half;
    const positive = d.r >= 0;
    const x0 = positive ? zeroX : zeroX - len;

    ctx.fillStyle = positive
      ? amberRamp(0.5 + 0.5 * Math.abs(d.r))
      : `rgba(156,152,144,${(0.4 + 0.55 * Math.abs(d.r)).toFixed(3)})`;
    ctx.fillRect(x0, cy - barH / 2, Math.max(1, len), barH);

    // pair label on the left
    ctx.fillStyle = LABEL;
    ctx.font = `10px ${MONO}`;
    ctx.textAlign = 'right';
    ctx.fillText(fit(ctx, d.label, padL - 10), padL - 8, cy);

    // r value just past the bar end (on its sign side)
    ctx.fillStyle = positive ? LABEL_DIM : STEEL;
    ctx.font = `9px ${MONO}`;
    ctx.textAlign = positive ? 'left' : 'right';
    const rTxt = (d.r >= 0 ? '+' : '') + d.r.toFixed(2);
    const tx = positive ? x0 + len + 4 : x0 - 4;
    ctx.fillText(rTxt, tx, cy);
  });

  // zero axis on top of the bars
  drawZeroAxis(ctx, zeroX, padT, h - padB);
  ctx.textAlign = 'left';
}

function drawZeroAxis(ctx, x, y0, y1) {
  ctx.strokeStyle = AXIS;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(Math.round(x) + 0.5, y0);
  ctx.lineTo(Math.round(x) + 0.5, y1);
  ctx.stroke();
}
