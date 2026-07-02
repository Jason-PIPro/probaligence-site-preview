// Paint & coatings demonstrator skin.
import { ConfidenceField } from '../field.js';
import { CMAP_VALUE, cssRamp } from '../colormap.js';
import { Tour, showIntro } from '../tour.js';

const Z = 1.96; // 95% band

export function mountPaint(root, s) {
  s.reset(); // start each visit with a clean exploration state
  const a0 = s.axisInput(0), a1 = s.axisInput(1);
  const held = s.inputs.filter((i) => i.name !== a0.name && i.name !== a1.name);

  root.innerHTML = `
  <div class="demo fade-in">
    <aside class="panel">
      <div class="eyebrow">Paint &amp; coatings · live model</div>
      <h2>${s.data.title}</h2>
      <p class="sub">Predict how well a paint recipe covers, <b>before you mix it</b>. Every point on
        the map is a real DIM-GP prediction of hiding power, and the <b>fog is what the model is not
        sure about</b> &middot; it lifts around the lab batches it has actually seen.</p>

      <div class="section-label">Predict</div>
      <div class="chips" id="outchips"></div>

      <div class="readout" id="readout">
        <div class="lbl" id="ro-label">Contrast / hiding</div>
        <div><span class="big" id="ro-val">&middot;</span><span class="unit" id="ro-unit"></span></div>
        <div class="band" id="ro-band">hover the map</div>
        <div class="bandbar"><div class="fill" id="ro-fill" style="left:50%;width:0"></div></div>
      </div>

      <div class="swatch-wrap">
        <div class="section-label">Predicted coating</div>
        <div class="swatch">
          <div class="coat" id="sw-coat"></div>
          <div class="sheen" id="sw-sheen"></div>
          <div class="tagline" id="sw-tag">move over the map</div>
        </div>
      </div>

      <div class="section-label">Where to test next</div>
      <button class="btn" id="btn-next"><span class="dot"></span> Ask STOCHOS to pick the next experiment</button>
      <button class="btn ghost" id="btn-reset">Reset exploration</button>
      <p class="sub" id="iter" style="margin-top:12px"></p>

      <div class="section-label">Held constant</div>
      <div class="chips">${held.map((i) => `<span class="chip">${i.label} ${fmt(i.default)}${i.unit ? i.unit.replace('wt%', '%') : ''}</span>`).join('')}</div>

      <p class="demo-note">Illustrative demonstrator on synthetic data. The model and its uncertainty are real STOCHOS output; the dataset is not a benchmark or a performance claim.</p>
    </aside>

    <section class="stage">
      <div class="field-wrap"><canvas class="field" id="cv"></canvas></div>
      <div class="stage-caption" id="cap">
        <div class="sc-step">Live model</div>
        <div class="sc-title">Hover the map to predict any paint recipe</div>
        <div class="sc-sub">Each axis is one ingredient. The colour is the predicted hiding power for that mix.</div>
        <div class="decode-key">
          <div class="dk"><span class="dk-sw color"></span><b>Colour</b> = predicted hiding power (%)</div>
          <div class="dk"><span class="dk-sw fog"></span><b>Fog</b> = model uncertainty</div>
          <div class="dk"><span class="dk-sw pin"></span><b>Glowing dots</b> = real lab batches</div>
        </div>
      </div>
      <div class="legend">
        <div class="lr"><span id="lg-name">Contrast</span><span id="lg-goal"></span></div>
        <div class="ramp" id="lg-ramp"></div>
        <div class="scale"><span id="lg-lo"></span><span id="lg-hi"></span></div>
        <div class="fog-key"><span class="fog-swatch"></span> fog = model uncertainty</div>
      </div>
      <div class="axis-label x">${a0.label} (${a0.min} to ${a0.max} ${cleanUnit(a0.unit)}) &rarr;</div>
      <div class="axis-label y">${a1.label} (${a1.min} to ${a1.max} ${cleanUnit(a1.unit)}) &rarr;</div>
      <div class="hint" id="hint">drag across the map, then watch the cursor halo grow where the model is unsure</div>
    </section>
  </div>`;

  const field = new ConfidenceField(root.querySelector('#cv'), s, CMAP_VALUE);
  let current = s.outputs[0];
  let iter = 0;

  // output chips
  const chipBox = root.querySelector('#outchips');
  s.outputs.forEach((o, idx) => {
    const c = document.createElement('div');
    c.className = 'chip' + (idx === 0 ? ' on' : '');
    c.textContent = o.label;
    c.onclick = () => {
      chipBox.querySelectorAll('.chip').forEach((x) => x.classList.remove('on'));
      c.classList.add('on');
      current = o;
      field.setOutput(o.name, o.goal);
      updateLegend();
    };
    chipBox.appendChild(c);
  });

  const $ = (id) => root.querySelector(id);
  function updateLegend() {
    const st = s.stats(current.name);
    $('#lg-name').textContent = current.label;
    $('#lg-goal').textContent = goalText(current.goal);
    $('#lg-ramp').style.background = cssRamp(CMAP_VALUE);
    $('#lg-lo').textContent = fmt(st.mn);
    $('#lg-hi').textContent = fmt(st.mx);
    $('#ro-label').textContent = current.label;
    $('#ro-unit').textContent = ' ' + cleanUnit(current.unit);
  }
  updateLegend();

  // readout + swatch on hover
  field.onMove(({ x, y, mean, std }) => {
    $('#hint').style.opacity = '0';
    $('#ro-val').textContent = fmt(mean);
    const band = Z * std;
    $('#ro-band').innerHTML = `± ${fmt(band)} <span class="conf">(95% confidence)</span>`;
    const st = s.stats(current.name);
    const wpct = Math.min(100, (2 * band) / (st.mx - st.mn || 1) * 100);
    $('#ro-fill').style.width = wpct + '%';
    $('#ro-fill').style.left = `calc(${(mean - st.mn) / (st.mx - st.mn || 1) * 100}% - ${wpct / 2}%)`;
    // swatch always reflects the coating itself (hiding + gloss) at this recipe
    const c = s.predict('contrast_ratio', x, y).mean;
    const g = s.predict('gloss', x, y).mean;
    paintSwatch($, s, c, g);
  });

  $('#btn-next').onclick = () => {
    const pick = s.nextSample(current.name, current.goal);
    if (!pick) return;
    field.dropSample(pick.x, pick.y, () => {
      s.addSample(pick.x, pick.y);
      field.invalidate();
      iter++;
      const where = `Experiment ${iter}: STOCHOS sampled <b>${a0.label} ${fmt(pick.x)}</b>, <b>${a1.label} ${fmt(pick.y)}</b>, the most informative point.`;
      if (current.goal === 'window') {
        // a target-band property has no single max to chase; we shrink uncertainty across the window
        $('#iter').innerHTML = `${where} It is reducing uncertainty across the ${current.label.toLowerCase()} window.`;
      } else {
        // bestSoFar is the argmax of the predicted mean field, not an experimentally obtained best
        const b = s.bestSoFar(current.name, current.goal);
        $('#iter').innerHTML = `${where} STOCHOS's predicted optimum &asymp; <b>${fmt(b.mean)} ${cleanUnit(current.unit)}</b>.`;
      }
    });
  };
  $('#btn-reset').onclick = () => { field.clearAnims(); s.reset(); iter = 0; field.invalidate(); $('#iter').textContent = ''; };

  // ---- framing: caption + guided tour (makes it self-explanatory) ----
  // The decode key (colour / fog / dots) stays pinned under the caption through every
  // tour step, so the three pieces of the Confidence Field are always named.
  const cap = $('#cap');
  const DECODE = `<div class="decode-key">
      <div class="dk"><span class="dk-sw color"></span><b>Colour</b> = predicted hiding power (%)</div>
      <div class="dk"><span class="dk-sw fog"></span><b>Fog</b> = model uncertainty</div>
      <div class="dk"><span class="dk-sw pin"></span><b>Glowing dots</b> = real lab batches</div>
    </div>`;
  const setCap = (step, title, sub) => {
    cap.innerHTML = `<div class="sc-step">${step}</div><div class="sc-title">${title}</div><div class="sc-sub">${sub}</div>${DECODE}`;
  };
  const explore = () => setCap('Explore', 'Your turn', 'Hover to predict hiding power &middot; switch the target &middot; ask for the next batch.');

  const steps = [
    { target: '#cv', place: 'right', title: 'A model of every paint recipe',
      body: 'You mixed and measured about 50 real batches. STOCHOS filled in every recipe in between, so this whole map is its prediction of hiding power, with no extra lab work.',
      onEnter: () => { setCap('Predict', 'Every point is a recipe', 'Brighter colour = covers better in one coat.'); field.setCursor(0.5, 0.55); } },
    { target: '#cv', place: 'right', title: 'Your real batches glow',
      body: 'Each bright dot is a batch you actually mixed and measured. Right beside them the model is confident, because it has seen the answer there.',
      onEnter: () => setCap('Anchors', 'The glowing dots are real batches', 'Predictions near them are reliable.') },
    { target: '#cv', place: 'right', title: 'It shows what it does not know',
      body: 'The haze is uncertainty. Far from any batch, STOCHOS widens its error bars instead of bluffing. Watch the cursor halo swell in the empty corner.',
      onEnter: (t) => { setCap('Uncertainty', 'The fog is honest doubt', 'A slider app hides this. STOCHOS shows it.'); t.after(250, () => field.setCursor(0.08, 0.92)); } },
    { target: '#btn-next', place: 'right', title: 'It plans your next batch',
      body: 'One click and STOCHOS names the single most valuable recipe to mix next, the biggest payoff where it is least sure. Watch a few land and the fog clear.',
      onEnter: (t) => { setCap('Suggest', 'STOCHOS picks where to test next', 'The most informative batch, every time.'); [1, 2, 3].forEach((k) => t.after(k * 1100, () => $('#btn-next').click())); } },
    { target: '.swatch', place: 'right', title: 'See the coating, not just a number',
      body: 'Every recipe also renders as a real surface, with hiding power and gloss you can read at a glance.',
      onEnter: () => setCap('Result', 'A coating you can see', 'The prediction becomes something tangible.') },
    { target: null, title: 'Now it is yours',
      body: 'Switch the target property, hover anywhere, and keep asking STOCHOS which batch to mix next.',
      onEnter: () => explore() },
  ];

  const startTour = () => new Tour(steps, { onEnd: explore }).start();

  showIntro(root, {
    eyebrow: 'Paint & coatings · live STOCHOS model',
    title: 'Predict how a paint recipe covers, before you mix it.',
    body: 'A DIM-GP trained on about 50 synthetic paint batches, running right here in your browser. It predicts hiding power for any recipe, shows its own uncertainty, and tells you which batch to mix next.',
    whatLine: 'A live map of predicted <b>hiding power</b> (coverage, %) across a paint recipe. Colour = the prediction, fog = how unsure the model is, glowing dots = real lab batches.',
    tryLine: 'Hover the map to read any recipe, then hit <b>"Ask STOCHOS to pick the next experiment"</b> and watch it choose the batch that teaches it the most.',
    tourLabel: 'Show me how it works (40s)',
    onTour: startTour,
    onExplore: explore,
  });

  // teardown: stop the renderer's rAF loop and drop its window listener
  return () => { field.destroy(); };
}

function paintSwatch($, s, contrast, gloss) {
  const hide = clamp01(s.norm('contrast_ratio', contrast));
  const gl = clamp01(s.norm('gloss', gloss));
  const coat = $('#sw-coat');
  coat.style.background = '#f2eeea';
  coat.style.opacity = (0.45 + 0.55 * hide).toFixed(3);
  const sheen = $('#sw-sheen');
  sheen.style.background = `linear-gradient(115deg, rgba(255,255,255,${(0.05 + 0.55 * gl).toFixed(3)}) 0%, rgba(255,255,255,0) 38%, rgba(255,255,255,0) 62%, rgba(255,255,255,${(0.03 + 0.3 * gl).toFixed(3)}) 100%)`;
  $('#sw-tag').textContent = `hiding ${(hide * 100).toFixed(0)}% · gloss ${(gl * 100).toFixed(0)}%`;
}

function goalText(g) { return g === 'high' ? '↑ maximize' : g === 'low' ? '↓ minimize' : '◇ target window'; }
function cleanUnit(u) { return (u || '').replace('wt%', '%'); }
function fmt(v) {
  const a = Math.abs(v);
  if (a >= 1000) return (v / 1000).toFixed(2) + 'k';
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  return v.toFixed(2);
}
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
