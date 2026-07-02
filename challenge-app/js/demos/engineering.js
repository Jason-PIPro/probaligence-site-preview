// Engineering demonstrator skin: morphing pin-fin heat sink + Pareto trade-off.
import { HeatSink } from '../heatsink.js';
import { Tour, showIntro } from '../tour.js';

const Z = 1.96;

export function mountEngineering(root, s) {
  const a0 = s.axisInput(0), a1 = s.axisInput(1);   // pin_height, pin_spacing
  const held = s.inputs.filter((i) => i.name !== a0.name && i.name !== a1.name);
  const oT = s.outputs.find((o) => o.name === 'peak_temp');
  const oP = s.outputs.find((o) => o.name === 'pressure_drop');
  const oM = s.outputs.find((o) => o.name === 'mass');

  root.innerHTML = `
  <div class="demo fade-in">
    <aside class="panel">
      <div class="eyebrow">Engineering · live STOCHOS model</div>
      <h2>${s.data.title}</h2>
      <p class="sub">Predict a heat sink's temperature <b>in milliseconds</b>, instead of a multi-hour
        simulation. Taller, denser pins cool better but cost pressure drop, so STOCHOS predicts both
        from the geometry, with confidence, and maps the <b>trade-off you cannot beat</b>.</p>

      <div class="section-label">Design</div>
      <div id="sliders"></div>

      <div class="readout compact" style="margin-top:14px">
        <div class="lbl">${oT.label}</div>
        <div><span class="big" id="t-val">&middot;</span><span class="unit">°C</span></div>
        <div class="band" id="t-band"></div>
      </div>
      <div class="readout compact" style="margin-top:10px">
        <div class="lbl">${oP.label}</div>
        <div><span class="big" id="p-val">&middot;</span><span class="unit">Pa</span></div>
        <div class="band" id="p-band"></div>
      </div>
      <div class="chips" style="margin-top:10px"><span class="chip" id="m-chip">Mass &middot;</span></div>

      <div class="section-label">Trade-off (Pareto front)</div>
      <canvas id="pareto" class="pareto"></canvas>
      <p class="sub" style="margin-top:2px">Each dot is a design. The amber line is the front: click it to jump to a design.</p>

      <button class="btn" id="btn-next" style="margin-top:12px"><span class="dot"></span> Let STOCHOS choose the best balance</button>
      <p class="sub" id="iter" style="margin-top:12px"></p>

      <div class="section-label">Held constant</div>
      <div class="chips">${held.map((i) => `<span class="chip">${i.label} ${fmt(i.default)} ${i.unit}</span>`).join('')}</div>

      <p class="demo-note">Illustrative demonstrator on synthetic data. The predictions, uncertainty and Pareto front are real STOCHOS output; the thermal coloring on the part is illustrative.</p>
    </aside>

    <section class="stage">
      <div class="terrain-wrap" id="sink"></div>
      <div class="stage-caption" id="cap">
        <div class="sc-step">Live model</div>
        <div class="sc-title">Reshape the heat sink with the sliders</div>
        <div class="sc-sub">The part rebuilds live and its colour is the predicted peak temperature.</div>
        <div class="decode-key">
          <div class="dk"><span class="dk-sw color"></span><b>Colour</b> = predicted peak temperature</div>
          <div class="dk"><span class="dk-sw slide"></span><b>Sliders</b> = pin height &amp; spacing</div>
          <div class="dk"><span class="dk-sw pin"></span><b>Pareto dots</b> = the same designs, charted</div>
        </div>
      </div>
      <div class="legend">
        <div class="lr"><span>Temperature</span><span>cool → hot</span></div>
        <div class="ramp" style="background:linear-gradient(90deg,#ffd28c,#ff8a3c,#ff431e)"></div>
        <div class="fog-key">drag the sliders to morph the geometry</div>
      </div>
    </section>
  </div>`;

  const $ = (id) => root.querySelector(id);
  // 3D preview is optional: if WebGL can't init, keep the sliders, readouts and Pareto alive.
  let sink = null;
  try { sink = new HeatSink(root.querySelector('#sink')); }
  catch (e) {
    console.error('heat sink 3D failed (non-fatal):', e);
    const stage = root.querySelector('#sink');
    if (stage) stage.innerHTML = `<p class="demo-note" style="margin:auto;max-width:22ch;text-align:center">This 3D preview needs WebGL. The model, readouts and Pareto front still work.</p>`;
  }
  let hx = a0.default, sy = a1.default;
  let userTouched = false;
  let killed = false;   // tripped by teardown so loops stop even before the DOM is removed

  // sliders
  const slBox = $('#sliders');
  [a0, a1].forEach((inp) => {
    const row = document.createElement('div'); row.className = 'slider';
    row.innerHTML = `<div class="row"><span class="name">${inp.label}</span><span class="v" id="v-${inp.name}"></span></div>
      <input type="range" min="${inp.min}" max="${inp.max}" step="${(inp.max - inp.min) / 100}" value="${inp.default}" id="r-${inp.name}">`;
    slBox.appendChild(row);
    row.querySelector('input').addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      if (inp === a0) hx = v; else sy = v;
      userTouched = true;
      update();
    });
  });

  let pareto = null;
  try { pareto = new ParetoChart($('#pareto'), s, (d) => setDesign(d.hx, d.sy)); }
  catch (e) { console.error('pareto chart failed (non-fatal):', e); }

  function setDesign(nhx, nsy) {
    if (killed || !root.isConnected) return;
    userTouched = true;
    hx = nhx; sy = nsy;
    const r0 = $('#r-' + a0.name), r1 = $('#r-' + a1.name);
    if (r0) r0.value = hx; if (r1) r1.value = sy;
    update();
  }

  function update() {
    // bail if the demo's DOM has been swapped out from under us (route change)
    if (!root.isConnected) return;
    const tVal = $('#t-val'); if (!tVal) return;
    // 1) ALWAYS morph the part first, so nothing downstream can block it
    const hFrac = (hx - a0.min) / (a0.max - a0.min), sFrac = (sy - a1.min) / (a1.max - a1.min);
    let t = null;
    try { t = s.predict('peak_temp', hx, sy); } catch (e) { console.error('predict failed', e); }
    if (sink) sink.setParams(hFrac, sFrac, t ? s.norm('peak_temp', t.mean) : 0.5);
    // 2) readouts + pareto are non-critical; never let them break the morph
    try {
      const p = s.predict('pressure_drop', hx, sy), m = s.predict('mass', hx, sy);
      $('#v-' + a0.name).textContent = `${fmt(hx)} ${a0.unit}`;
      $('#v-' + a1.name).textContent = `${fmt(sy)} ${a1.unit}`;
      if (t) { $('#t-val').textContent = fmt(t.mean); $('#t-band').innerHTML = `± ${fmt(Z * t.std)} <span class="conf">(95%)</span>`; }
      $('#p-val').textContent = fmt(p.mean); $('#p-band').innerHTML = `± ${fmt(Z * p.std)} <span class="conf">(95%)</span>`;
      $('#m-chip').innerHTML = `Mass ${fmt(m.mean)} g`;
      if (pareto && t) pareto.setCurrent(t.mean, p.mean);
    } catch (e) { console.error('engineering readouts failed (non-fatal):', e); }
  }

  $('#btn-next').onclick = () => {
    if (!pareto) return;
    const knee = pareto.knee();
    pareto.setSuggested(knee);
    setDesign(knee.hx, knee.sy);
    $('#iter').innerHTML = `STOCHOS proposes the balanced optimum: <b>${a0.label} ${fmt(knee.hx)} ${a0.unit}</b>, <b>${a1.label} ${fmt(knee.sy)} ${a1.unit}</b> &rarr; ${fmt(knee.tx)} °C at ${fmt(knee.py)} Pa.`;
  };

  update();

  // auto-morph on load so the reshape is self-evident; stops on first interaction
  // OR when the demo is torn down (root detached) so it can't spam update() on other routes.
  (function autoDemo() {
    if (userTouched || killed || !root.isConnected) return;
    const tt = performance.now() * 0.001;
    hx = a0.min + (a0.max - a0.min) * (0.5 + 0.45 * Math.sin(tt * 0.7));
    sy = a1.min + (a1.max - a1.min) * (0.5 + 0.45 * Math.sin(tt * 0.47 + 1.7));
    const r0 = $('#r-' + a0.name), r1 = $('#r-' + a1.name);
    if (r0) r0.value = hx; if (r1) r1.value = sy;
    update();
    requestAnimationFrame(autoDemo);
  })();

  // ---- tour ----
  // The decode key (colour / sliders / Pareto dots) persists through every step.
  const cap = $('#cap');
  const DECODE = `<div class="decode-key">
      <div class="dk"><span class="dk-sw color"></span><b>Colour</b> = predicted peak temperature</div>
      <div class="dk"><span class="dk-sw slide"></span><b>Sliders</b> = pin height &amp; spacing</div>
      <div class="dk"><span class="dk-sw pin"></span><b>Pareto dots</b> = the same designs, charted</div>
    </div>`;
  const setCap = (step, title, sub) => { cap.innerHTML = `<div class="sc-step">${step}</div><div class="sc-title">${title}</div><div class="sc-sub">${sub}</div>${DECODE}`; };
  const explore = () => setCap('Explore', 'Your turn', 'Drag the sliders, read the trade-off, let STOCHOS choose the balance.');
  const steps = [
    { target: '#sink', place: 'right', title: 'A heat sink you can reshape',
      body: 'Use the sliders for pin height and spacing. The part rebuilds live and its colour is the predicted peak temperature (deg C), hotter where it struggles to shed heat. Each prediction is instant, not a multi-hour solve.',
      onEnter: (t) => { setCap('Predict', 'Colour = predicted peak temperature', 'Taller, denser pins run cooler.'); t.after(400, () => setDesign(6, 5.2)); t.after(1500, () => setDesign(18, 2.0)); } },
    { target: '.readout.compact', place: 'right', title: 'Two goals that fight',
      body: 'Cooler running means a higher pressure drop, so the fan works harder. STOCHOS predicts both from the geometry, each with a confidence band you can trust or probe.',
      onEnter: () => setCap('Predict', 'Cooling versus pressure drop', 'You cannot have both for free.') },
    { target: '#pareto', place: 'right', title: 'The trade-off you cannot beat',
      body: 'Every dot here is one heat-sink design, the same designs you reshape on the left. The amber line is the Pareto front: designs where cooling can only improve by paying more pressure drop. Click the line to jump to one.',
      onEnter: () => setCap('Trade-off', 'The Pareto front', 'The edge of what is physically possible.') },
    { target: '#btn-next', place: 'right', title: 'Let STOCHOS choose the balance',
      body: 'One click and it proposes the balanced optimum on the front, the knee where neither cooling nor pressure drop is sacrificed too far.',
      onEnter: (t) => { setCap('Suggest', 'A balanced optimum', 'Picked off the Pareto front.'); t.after(700, () => $('#btn-next').click()); } },
    { target: null, title: 'Now it is yours',
      body: 'Reshape the part, watch the temperature and pressure-drop predictions move, and explore the whole trade-off curve.',
      onEnter: () => explore() },
  ];
  const startTour = () => new Tour(steps, { onEnd: explore }).start();

  showIntro(root, {
    eyebrow: 'Engineering · live STOCHOS model',
    title: 'Predict a heat sink in milliseconds, not a multi-hour simulation.',
    body: 'A DIM-GP trained on synthetic pin-fin cooling data, running in your browser. It predicts peak temperature, pressure drop and mass from the geometry, with confidence, and maps the trade-off between cooling and pressure drop.',
    whatLine: 'A pin-fin heat sink you reshape with sliders. Its colour is the predicted <b>peak temperature</b> (deg C); the chart plots those same designs as cooling vs pressure drop.',
    tryLine: 'Drag the sliders to reshape the part, then hit <b>"Let STOCHOS choose the best balance"</b> to jump to the optimum on the trade-off curve.',
    tourLabel: 'Show me how it works (40s)',
    onTour: startTour, onExplore: explore,
  });

  // Teardown (run by main.js before the DOM is swapped): stop the autoDemo loop,
  // release the WebGL context, and remove the Pareto resize listener.
  return () => {
    killed = true;
    try { sink?.destroy(); } catch (e) { /* already gone */ }
    try { pareto?.destroy(); } catch (e) { /* already gone */ }
  };
}

// ---------- Pareto chart (peak temp vs pressure drop, both minimized) ----------
class ParetoChart {
  constructor(canvas, s, onPick) {
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.s = s; this.onPick = onPick;
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.pts = []; this.front = [];
    const gx = s.grid.x, gy = s.grid.y, T = s.fields.peak_temp.mean, P = s.fields.pressure_drop.mean;
    for (let j = 0; j < gy.length; j += 1) for (let i = 0; i < gx.length; i += 1)
      this.pts.push({ tx: T[j][i], py: P[j][i], hx: gx[i], sy: gy[j] });
    // Pareto front: minimize both. sort by temp asc, keep running-min pressure drop
    const sorted = [...this.pts].sort((a, b) => a.tx - b.tx);
    let best = Infinity;
    for (const p of sorted) if (p.py < best - 1e-9) { this.front.push(p); best = p.py; }
    this.tStats = s.stats('peak_temp'); this.pStats = s.stats('pressure_drop');
    this.current = null; this.suggested = null;
    // Offscreen canvas for the static background dots (baked once per _size() call).
    // Composited cheaply in _draw() so the O(3136) loop never runs during animation.
    this._baked = document.createElement('canvas');
    this._size(); this._draw();
    canvas.addEventListener('click', (e) => this._click(e));
    // store the handler so the demo teardown can remove this window listener
    this._onResize = () => { this._size(); this._draw(); };
    window.addEventListener('resize', this._onResize);
  }
  destroy() {
    if (this._onResize) { window.removeEventListener('resize', this._onResize); this._onResize = null; }
  }
  _size() {
    const r = this.cv.getBoundingClientRect();
    this.w = r.width || 300; this.h = 168;
    this.cv.width = this.w * this.dpr; this.cv.height = this.h * this.dpr;
    this.cv.style.height = this.h + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Resize and re-bake the static background dots when dimensions change.
    this._baked.width = this.cv.width; this._baked.height = this.cv.height;
    this._bakeDots();
  }

  // Pre-render the static 3136-point background scatter to an offscreen canvas.
  // This is called only on construction and resize, never during animation.
  _bakeDots() {
    const bc = this._baked.getContext('2d');
    bc.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    bc.clearRect(0, 0, this.w, this.h);
    bc.fillStyle = 'rgba(152,148,140,0.16)';
    for (const p of this.pts) {
      bc.fillRect(this._sx(p.tx) - 1, this._sy(p.py) - 1, 2, 2);
    }
  }
  _sx(t) { const p = 30, s = this.tStats; return p + (t - s.mn) / (s.mx - s.mn || 1) * (this.w - p - 12); }
  _sy(v) { const p = 14, s = this.pStats; return this.h - 22 - (v - s.mn) / (s.mx - s.mn || 1) * (this.h - p - 26); }
  setCurrent(t, p) { this.current = { tx: t, py: p }; this._draw(); }
  setSuggested(k) { this.suggested = k; this._draw(); }
  knee() {
    let best = null;
    for (const p of this.front) {
      const tn = (p.tx - this.tStats.mn) / (this.tStats.mx - this.tStats.mn || 1);
      const pn = (p.py - this.pStats.mn) / (this.pStats.mx - this.pStats.mn || 1);
      const d = tn * tn + pn * pn;
      if (!best || d < best.d) best = { ...p, d };
    }
    return best;
  }
  _draw() {
    const c = this.ctx; c.clearRect(0, 0, this.w, this.h);
    // axes labels
    c.fillStyle = 'rgba(148,144,136,0.8)'; c.font = '10px ui-monospace, monospace';
    c.fillText('cooler →', 30, this.h - 6); c.save(); c.translate(10, this.h - 24); c.rotate(-Math.PI / 2); c.fillText('lower Δp →', 0, 0); c.restore();
    // Blit the pre-baked static background dots (O(1) drawImage instead of O(3136) fillRect).
    c.drawImage(this._baked, 0, 0, this.w, this.h);
    // front line + points (dynamic: changes with data)
    c.beginPath(); this.front.forEach((p, i) => { const x = this._sx(p.tx), y = this._sy(p.py); i ? c.lineTo(x, y) : c.moveTo(x, y); });
    c.strokeStyle = 'rgba(255,176,6,0.8)'; c.lineWidth = 1.6; c.stroke();
    for (const p of this.front) { c.fillStyle = '#ffb006'; c.beginPath(); c.arc(this._sx(p.tx), this._sy(p.py), 2.4, 0, 7); c.fill(); }
    // current marker (changes every autoDemo frame)
    if (this.current) {
      const x = this._sx(this.current.tx), y = this._sy(this.current.py);
      c.strokeStyle = '#f5f5f7'; c.lineWidth = 2; c.beginPath(); c.arc(x, y, 5, 0, 7); c.stroke();
    }
    if (this.suggested) {
      const x = this._sx(this.suggested.tx), y = this._sy(this.suggested.py);
      c.fillStyle = 'rgba(255,176,6,0.9)'; c.beginPath(); c.arc(x, y, 6, 0, 7); c.fill();
    }
  }
  _click(e) {
    const r = this.cv.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top;
    let best = null;
    for (const p of this.front) { const d = (this._sx(p.tx) - mx) ** 2 + (this._sy(p.py) - my) ** 2; if (!best || d < best.d) best = { p, d }; }
    if (best && best.d < 900) this.onPick(best.p);
  }
}

function fmt(v) {
  const a = Math.abs(v);
  if (a >= 1000) return (v / 1000).toFixed(2) + 'k';
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  return v.toFixed(2);
}
