// Chemistry demonstrator skin: 3D reaction-yield terrain.
import { TerrainField } from '../terrain.js';
import { CMAP_HEAT, cssRamp } from '../colormap.js';
import { Tour, showIntro } from '../tour.js';

const Z = 1.96;

export function mountChemistry(root, s) {
  s.reset();
  const a0 = s.axisInput(0), a1 = s.axisInput(1);
  const held = s.inputs.filter((i) => i.name !== a0.name && i.name !== a1.name);

  root.innerHTML = `
  <div class="demo fade-in">
    <aside class="panel">
      <div class="eyebrow">Chemistry · live STOCHOS model</div>
      <h2>${s.data.title}</h2>
      <p class="sub">Predict reaction yield <b>before you run the experiment</b>. The hill is predicted
        yield across temperature and catalyst loading; the <b>amber whiskers are the model's doubt</b>,
        tall where it has not run a reaction yet.</p>

      <div class="rxn"><b>A</b> + <b>B</b> <span class="arrow">cat, &Delta;</span> <b class="prod">P</b></div>

      <div class="section-label">Predict</div>
      <div class="chips" id="outchips"></div>

      <div class="readout" id="readout">
        <div class="lbl" id="ro-label">Yield</div>
        <div><span class="big" id="ro-val">&middot;</span><span class="unit" id="ro-unit"></span></div>
        <div class="band" id="ro-band">orbit, then hover the surface</div>
        <div class="bandbar"><div class="fill" id="ro-fill" style="left:50%;width:0"></div></div>
      </div>

      <div class="section-label">Where to run next</div>
      <button class="btn" id="btn-next"><span class="dot"></span> Ask STOCHOS to pick the next run</button>
      <button class="btn ghost" id="btn-reset">Reset exploration</button>
      <p class="sub" id="iter" style="margin-top:12px"></p>

      <div class="section-label">Held constant</div>
      <div class="chips">${held.map((i) => `<span class="chip">${i.label} ${fmt(i.default)} ${cleanUnit(i.unit)}</span>`).join('')}</div>

      <p class="demo-note">Illustrative demonstrator on synthetic data. The model and its uncertainty are real STOCHOS output; the dataset is not a benchmark or a performance claim.</p>
    </aside>

    <section class="stage">
      <div class="terrain-wrap" id="terrain"></div>
      <div class="stage-caption" id="cap">
        <div class="sc-step">Live model</div>
        <div class="sc-title">Drag to orbit the reaction space</div>
        <div class="sc-sub">Each axis is a reaction condition. The hill is the predicted yield for those conditions.</div>
        <div class="decode-key">
          <div class="dk"><span class="dk-sw color"></span><b>Height &amp; colour</b> = predicted yield (%)</div>
          <div class="dk"><span class="dk-sw fog"></span><b>Whiskers</b> = 95% uncertainty</div>
          <div class="dk"><span class="dk-sw pin"></span><b>Markers</b> = real reactions run</div>
        </div>
      </div>
      <div class="legend">
        <div class="lr"><span id="lg-name">Yield</span><span id="lg-goal"></span></div>
        <div class="ramp" id="lg-ramp"></div>
        <div class="scale"><span id="lg-lo"></span><span id="lg-hi"></span></div>
        <div class="fog-key"><span class="fog-swatch" style="background:linear-gradient(90deg,transparent,#ffb006)"></span> whiskers = 95% confidence</div>
      </div>
      <div class="axis-label x">${a0.label} (${a0.min} to ${a0.max} ${cleanUnit(a0.unit)}) &rarr;</div>
      <div class="axis-label y">${a1.label} (${a1.min} to ${a1.max} ${cleanUnit(a1.unit)}) &rarr;</div>
    </section>
  </div>`;

  const $ = (id) => root.querySelector(id);

  // The 3D view needs WebGL; if it is unavailable, TerrainField throws. Keep the
  // rest of the demo (panel + intro) alive and swap the stage for an honest note.
  let terrain = null;
  try {
    terrain = new TerrainField($('#terrain'), s, CMAP_HEAT);
  } catch (err) {
    const stage = root.querySelector('.stage');
    if (stage) stage.innerHTML = `<div class="demo-note" style="margin:auto;max-width:32ch;text-align:center">This 3D view needs WebGL, which is not available in this browser. The live STOCHOS model and its predictions still run; the readout and the next-run planner on the left work without the 3D surface.</div>`;
    const btn = $('#btn-next'); if (btn) btn.disabled = true;
  }
  let current = s.outputs[0];
  let iter = 0;

  const chipBox = $('#outchips');
  s.outputs.forEach((o, idx) => {
    const c = document.createElement('div');
    c.className = 'chip' + (idx === 0 ? ' on' : '');
    c.textContent = o.label;
    c.onclick = () => {
      chipBox.querySelectorAll('.chip').forEach((x) => x.classList.remove('on'));
      c.classList.add('on'); current = o; terrain?.setOutput(o.name, o.goal); updateLegend();
    };
    chipBox.appendChild(c);
  });

  function updateLegend() {
    const st = s.stats(current.name);
    $('#lg-name').textContent = current.label;
    $('#lg-goal').textContent = current.goal === 'high' ? '↑ maximize' : current.goal === 'low' ? '↓ minimize' : '◇ window';
    $('#lg-ramp').style.background = cssRamp(CMAP_HEAT);
    $('#lg-lo').textContent = fmt(st.mn); $('#lg-hi').textContent = fmt(st.mx);
    $('#ro-label').textContent = current.label; $('#ro-unit').textContent = ' ' + cleanUnit(current.unit);
  }
  updateLegend();

  terrain?.onMove((d) => {
    if (!d) return;
    $('#cap') && ($('#cap').style.opacity = '1');
    $('#ro-val').textContent = fmt(d.mean);
    const band = Z * d.std;
    $('#ro-band').innerHTML = `± ${fmt(band)} <span class="conf">(95% confidence)</span>`;
    const st = s.stats(current.name);
    const span = st.mx - st.mn || 1;
    const wpct = Math.min(100, (2 * band) / span * 100);
    // Clamp the bar's left edge so a low value with a wide band cannot slide off
    // the left of the track (or run past the right).
    const left = clampPct((d.mean - st.mn) / span * 100 - wpct / 2, 0, 100 - wpct);
    $('#ro-fill').style.width = wpct + '%';
    $('#ro-fill').style.left = left + '%';
  });

  // Keep the optimize button disabled while a probe is mid-flight, so rapid
  // clicks cannot all read the same argmax (the sample lands ~1.3s later).
  terrain?.onLand(() => { const b = $('#btn-next'); if (b) b.disabled = false; });

  $('#btn-next').onclick = () => {
    if (!terrain || terrain.busy) return;
    const pick = terrain.pickNext();
    if (!pick) return;
    $('#btn-next').disabled = true;   // re-enabled by terrain.onLand when the probe settles
    iter++;
    const b = s.bestSoFar(current.name, current.goal);
    $('#iter').innerHTML = `Run ${iter}: STOCHOS chose <b>${a0.label} ${fmt(pick.x)} ${cleanUnit(a0.unit)}</b>, <b>${a1.label} ${fmt(pick.y)} ${cleanUnit(a1.unit)}</b>. STOCHOS's predicted optimum &asymp; <b>${fmt(b.mean)} ${cleanUnit(current.unit)}</b>.`;
  };
  $('#btn-reset').onclick = () => { terrain?.resetSamples(); iter = 0; $('#btn-next') && ($('#btn-next').disabled = false); $('#iter').textContent = ''; };

  // ---- guided tour ----
  // The decode key (height / whiskers / markers) persists through every step.
  const cap = $('#cap');
  const DECODE = `<div class="decode-key">
      <div class="dk"><span class="dk-sw color"></span><b>Height &amp; colour</b> = predicted yield (%)</div>
      <div class="dk"><span class="dk-sw fog"></span><b>Whiskers</b> = 95% uncertainty</div>
      <div class="dk"><span class="dk-sw pin"></span><b>Markers</b> = real reactions run</div>
    </div>`;
  const setCap = (step, title, sub) => { cap.innerHTML = `<div class="sc-step">${step}</div><div class="sc-title">${title}</div><div class="sc-sub">${sub}</div>${DECODE}`; };
  const explore = () => setCap('Explore', 'Your turn', 'Orbit, hover any conditions, switch the target, ask for the next run.');
  const steps = [
    { target: '#terrain', place: 'right', title: 'A reaction you can fly over',
      body: 'Drag to orbit. The height and colour are predicted yield (%) across temperature and catalyst loading, learned from just a handful of real runs.',
      onEnter: () => setCap('Predict', 'The hill is predicted yield', 'Taller and brighter = more product.') },
    { target: '#terrain', place: 'right', title: 'The whiskers are doubt',
      body: 'Each amber whisker is the 95% confidence interval on the yield. They stretch tall where the model has not run a reaction, and shrink to nothing on top of real data.',
      onEnter: () => setCap('Uncertainty', 'Whiskers are the confidence interval', 'A tall whisker means the model is guessing there.') },
    { target: '#btn-next', place: 'right', title: 'It plans the next reaction',
      body: 'One click and STOCHOS names the most valuable reaction to run next, balancing high predicted yield against where it is least sure. Watch it climb the hill.',
      onEnter: (t) => { setCap('Suggest', 'STOCHOS chooses the next run', 'Toward high yield, into the unknown.'); [1, 2, 3, 4].forEach((k) => t.after(k * 1200, () => $('#btn-next').click())); } },
    { target: null, title: 'Now it is yours',
      body: 'Switch the target between yield, selectivity and raw-material cost (they pull against each other), and keep asking for the next run.',
      onEnter: () => explore() },
  ];
  const startTour = () => new Tour(steps, { onEnd: explore }).start();

  showIntro(root, {
    eyebrow: 'Chemistry · live STOCHOS model',
    title: 'Predict reaction yield, before you run the experiment.',
    body: 'A DIM-GP trained on synthetic reaction data, running in your browser. It predicts yield, selectivity and cost with honest confidence, and tells you which reaction to run next.',
    whatLine: 'A 3D surface of predicted <b>reaction yield</b> (%) across temperature and catalyst loading. Height and colour = the prediction, amber whiskers = how unsure the model is.',
    tryLine: 'Drag to orbit, then hit <b>"Ask STOCHOS to pick the next run"</b> and watch it choose the reaction that climbs toward high yield where it is least certain.',
    tourLabel: 'Show me how it works (40s)',
    onTour: startTour, onExplore: explore,
  });

  // Teardown: main.js runs this before swapping the DOM. Releases the WebGL
  // context + GPU memory and removes the window pointerup listener (without it,
  // ~16 navigations exhaust the browser's WebGL contexts).
  return () => terrain?.dispose();
}

function clampPct(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function cleanUnit(u) { return (u || '').replace('rel', ''); }
function fmt(v) {
  const a = Math.abs(v);
  if (a >= 1000) return (v / 1000).toFixed(2) + 'k';
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  return v.toFixed(2);
}
