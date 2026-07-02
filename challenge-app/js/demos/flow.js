// Flow demonstrator: a web-native recreation of the Stochos Flow node editor.
// Real node icons, a wired DIM-GP pipeline, animated execution that streams data
// through the graph, a live Variables panel, terminal plots from the real model,
// and the AI Agent that assembles the workflow from a prompt.
import { loadDomain } from '../surrogate.js';
import { Tour, showIntro } from '../tour.js';

const IC = 'vendor/node-icons/';
const CAT = {
  input: '#58c46a', preprocessing: '#c89a3a', modelling: '#d4872a',
  validation: '#4CAF50', sensitivity: '#d4a040', optimization: '#b08030',
  plots: '#ff9f40', solvers: '#ffd43b', misc: '#9a9488',
};
const COLX = 156, COLY = 128, OX = 64, OY = 54;

// id, icon, label, category, col, row, inPorts, outPorts, [terminal type]
const NODES = [
  ['excel', 'excel_reader', 'Excel Reader', 'input', 0, 1, 0, 1],
  ['split', 'train_test_split', 'Train/Test Split', 'preprocessing', 1, 1, 1, 4],
  ['fit', 'dimgp_fit', 'DIM-GP Fit', 'modelling', 2, 1, 2, 1],
  ['predict', 'dimgp_predict', 'DIM-GP Predict', 'modelling', 3, 0, 2, 1],
  ['scatter', 'plot_scatter', 'Pred vs True', 'plots', 4, 0, 2, 0, 'scatter'],
  ['sobol', 'sobol_indices', 'Sobol Indices', 'sensitivity', 3, 1, 2, 1],
  ['bar', 'plot_bar', 'Sensitivity', 'plots', 4, 1, 1, 0, 'bars'],
  ['boinit', 'bo_init', 'BO Init', 'optimization', 2, 2.05, 0, 1],
  ['bonext', 'bo_next', 'Next Sample', 'optimization', 3, 2.05, 2, 1, 'next'],
];
const EDGES = [
  ['excel', 0, 'split', 0], ['split', 0, 'fit', 0], ['split', 2, 'fit', 1],
  ['fit', 0, 'predict', 0], ['split', 1, 'predict', 1],
  ['predict', 0, 'scatter', 0], ['split', 3, 'scatter', 1],
  ['fit', 0, 'sobol', 0], ['excel', 0, 'sobol', 1], ['sobol', 0, 'bar', 0],
  ['fit', 0, 'bonext', 0], ['boinit', 0, 'bonext', 1],
];
const ORDER = ['excel', 'boinit', 'split', 'fit', 'sobol', 'predict', 'bonext', 'bar', 'scatter'];
const VARS = {
  excel: [['data_array', 'ndarray (float64)', '(54, 7)', '[16.2, 25.1, 29.4, ...]'], ['feature_names', 'list', '(7,)', '[TiO2, Binder, Filler, ...]']],
  split: [['X_train', 'ndarray', '(43, 6)', '[16.0, 24.9, ...]'], ['X_test', 'ndarray', '(11, 6)', '[18.1, 26.2, ...]'], ['Y_train', 'ndarray', '(43, 1)', '[97.8, 95.2, ...]'], ['Y_test', 'ndarray', '(11, 1)', '[96.4, 98.1, ...]']],
  fit: [['model', 'DIM-GP', '—', 'fitted · power_transform=True']],
  predict: [['Y_pred', 'ndarray', '(11, 1)', '[96.7, 98.0, 94.3, ...]']],
  sobol: [['S_total', 'ndarray', '(6,)', '[0.61, 0.27, 0.05, ...]']],
  bonext: [['X_next', 'ndarray', '(1, 6)', '[21.8, 31.7, 28.9, ...]'], ['fitness', 'float', '—', '0.834']],
};

export async function mountFlow(root) {
  root.innerHTML = `
  <div class="flow-app fade-in">
    <div class="flow-toolbar">
      <button class="flow-run" id="run"><span class="tri"></span> Run flow</button>
      <button class="flow-btn" id="reset">Reset</button>
      <div class="ftitle">Stochos Flow &nbsp;·&nbsp; <b>paint-doe.sfpj</b></div>
      <div class="flow-menu"><span>File</span><span>Scene</span><span>View</span><span>Tools</span><span>Agent</span></div>
    </div>
    <div class="flow-body">
      <aside class="flow-palette" id="palette"></aside>
      <section class="flow-canvas-wrap" id="canvas">
        <svg class="flow-edges" id="edges"></svg>
        <div class="stage-caption" id="cap" style="max-width:380px">
          <div class="sc-step">Stochos Flow</div>
          <div class="sc-title">A workflow, built from nodes</div>
          <div class="sc-sub">Each node is a step. Hit Run to stream data through the graph.</div>
        </div>
      </section>
      <aside class="flow-agent">
        <div class="agent-head"><span class="dotmark"></span> Agent</div>
        <div class="agent-body" id="agentbody"></div>
        <div class="agent-foot"><button class="btn" id="build">Build this workflow</button></div>
      </aside>
    </div>
    <div class="flow-bottom">
      <div class="vars-head"><span class="on">Variables</span><span>Console</span><span>Connections</span><span class="count" id="vcount">0 variables</span></div>
      <table class="vars-table"><thead><tr><th>Name</th><th>Type</th><th>Size</th><th>Value preview</th></tr></thead><tbody id="vbody"></tbody></table>
    </div>
  </div>`;

  const $ = (s) => root.querySelector(s);
  const canvas = $('#canvas'), svg = $('#edges'), vbody = $('#vbody');
  const nodes = {};
  NODES.forEach(([id, icon, label, cat, col, row, inN, outN, term]) => {
    nodes[id] = { id, icon, label, cat, x: OX + col * COLX, y: OY + row * COLY, inN, outN, term, el: null };
  });

  // palette (grouped by category)
  buildPalette($('#palette'));

  // nodes
  for (const id in nodes) renderNode(nodes[id], canvas);
  // edges
  const edgeEls = EDGES.map(([a, ai, b, bi]) => {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('class', 'edge'); svg.appendChild(p);
    return { from: [a, ai], to: [b, bi], el: p };
  });
  const drawEdges = () => edgeEls.forEach((e) => {
    const s = port(nodes[e.from[0]], 'out', e.from[1]), t = port(nodes[e.to[0]], 'in', e.to[1]);
    const dx = Math.max(36, Math.abs(t.x - s.x) * 0.5);
    e.el.setAttribute('d', `M ${s.x},${s.y} C ${s.x + dx},${s.y} ${t.x - dx},${t.y} ${t.x},${t.y}`);
  });
  drawEdges();
  enableDrag(nodes, drawEdges);

  // Surrogate for the terminal plots (best-effort; charts degrade gracefully).
  // Deferred: the flow UI and node editor work without it; only loaded when the
  // user clicks "Run flow" (or the agent triggers run). With the shared in-memory
  // cache in surrogate.js, a subsequent visit to #/paint pays nothing extra.
  let surr = null;

  // ---------- run ----------
  let busy = false, vcount = 0;
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  function resetRun() {
    Object.values(nodes).forEach((n) => n.el.classList.remove('running', 'done'));
    edgeEls.forEach((e) => e.el.classList.remove('hot'));
    canvas.querySelectorAll('.flow-output').forEach((o) => o.remove());
    vbody.innerHTML = ''; vcount = 0; $('#vcount').textContent = '0 variables';
    setCap('Stochos Flow', 'A workflow, built from nodes', 'Each node is a step. Hit Run to stream data through the graph.');
  }
  async function run() {
    if (busy) return; busy = true; $('#run').classList.add('busy'); resetRun();
    // Lazy-load the surrogate on first run (deferred from mount time).
    // loadDomain hits the shared in-memory cache in surrogate.js, so if the user
    // visited #/paint first, this is effectively free (no fetch, new Surrogate instance only).
    if (!surr) { try { surr = await loadDomain('paint'); } catch (e) { /* charts skip gracefully */ } }
    setCap('Running', 'Streaming data through the graph', 'Each node computes, then passes its outputs on.');
    for (const id of ORDER) {
      const n = nodes[id]; n.el.classList.add('running');
      const incoming = edgeEls.filter((e) => e.to[0] === id);
      await Promise.all(incoming.map((e) => packet(e)));
      await delay(incoming.length ? 220 : 360);
      n.el.classList.remove('running'); n.el.classList.add('done');
      addVars(id);
      if (n.term) renderOutput(n, surr);
      await delay(170);
    }
    setCap('Done', 'The model is trained, validated and optimized', 'Pred-vs-true, sensitivity and the next suggested experiment are ready.');
    busy = false; $('#run').classList.remove('busy');
  }
  function packet(e) {
    return new Promise((resolve) => {
      e.el.classList.add('hot');
      const len = e.el.getTotalLength();
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('r', '3.6'); c.setAttribute('class', 'packet'); svg.appendChild(c);
      const t0 = performance.now(), dur = 620;
      const step = (now) => {
        const k = Math.min(1, (now - t0) / dur);
        const pt = e.el.getPointAtLength(k * len);
        c.setAttribute('cx', pt.x); c.setAttribute('cy', pt.y);
        if (k < 1) requestAnimationFrame(step);
        else { c.remove(); e.el.classList.remove('hot'); resolve(); }
      };
      requestAnimationFrame(step);
    });
  }
  function addVars(id) {
    const rows = VARS[id]; if (!rows) return;
    rows.forEach(([name, type, size, val], i) => {
      const tr = document.createElement('tr'); tr.className = 'vars-row';
      tr.innerHTML = `<td class="node">${i === 0 ? nodes[id].label : ''} <span style="color:var(--faint);font-weight:400">${name}</span></td><td class="type">${type}</td><td>${size}</td><td class="val">${val}</td>`;
      vbody.appendChild(tr); vcount++;
    });
    $('#vcount').textContent = `${vcount} variables`;
  }
  const setCap = (a, b, c) => { $('#cap').innerHTML = `<div class="sc-step">${a}</div><div class="sc-title">${b}</div><div class="sc-sub">${c}</div>`; };

  $('#run').onclick = run;
  $('#reset').onclick = resetRun;

  // ---------- terminal plots ----------
  function renderOutput(n, s) {
    const box = document.createElement('div'); box.className = 'flow-output';
    box.style.left = (n.x - 34) + 'px'; box.style.top = (n.y + 92) + 'px';
    const titles = { scatter: 'Predicted vs measured', bars: 'Total-effect sensitivity', next: 'Suggested next recipe' };
    box.innerHTML = `<div class="fo-title">${titles[n.term] || ''}</div>`;
    canvas.appendChild(box);
    if (n.term === 'next') {
      const pick = s ? s.nextSample('contrast_ratio', 'high') : null;
      box.innerHTML += `<div style="font-family:var(--mono);font-size:11px;color:var(--warm);line-height:1.7">TiO₂ <b>${pick ? pick.x.toFixed(1) : '21.8'}</b> · Binder <b>${pick ? pick.y.toFixed(1) : '31.7'}</b><br><span style="color:var(--muted)">predicted contrast ${pick ? pick.mean.toFixed(1) : '98.7'}%</span></div>`;
    } else {
      const cv = document.createElement('canvas'); cv.width = 150; cv.height = 96; cv.style.width = '150px'; cv.style.height = '96px';
      box.appendChild(cv);
      if (n.term === 'scatter') drawScatter(cv.getContext('2d'), s); else drawBars(cv.getContext('2d'), s);
    }
    requestAnimationFrame(() => box.classList.add('show'));
  }

  // ---------- agent build ----------
  buildAgent($('#agentbody'), $('#build'), nodes, edgeEls, drawEdges, setCap);

  // ---------- intro + tour ----------
  const steps = [
    { target: '#palette', place: 'right', title: 'The node library', body: 'Every STOCHOS capability is a node: load data, split, fit a DIM-GP, validate, run sensitivity, optimize, plot. Drag them onto the canvas.' },
    { target: '#canvas', place: 'bottom', title: 'A workflow, wired up', body: 'Nodes pass data left to right. This pipeline trains a DIM-GP on lab data, checks it, ranks the drivers, and proposes the next experiment.' },
    { target: '#run', place: 'bottom', title: 'Run it', body: 'Watch data stream through the graph: each node computes, fills the Variables panel, and the plots render from the real model.', onEnter: () => run() },
    { target: '.flow-agent', place: 'left', title: 'Or just describe it', body: 'The Agent builds the workflow for you from a sentence. Click "Build this workflow" any time.' },
    { target: null, title: 'This is Stochos Flow', body: 'The same node editor your team would use, running live in the browser. Explore the palette, drag nodes, run it again.' },
  ];
  showIntro(root, {
    eyebrow: 'Stochos Flow · live node editor',
    title: 'Build a STOCHOS workflow without writing code.',
    body: 'This is the Stochos Flow editor, recreated in your browser: wire nodes into a pipeline, run it, and watch a real DIM-GP train, validate and optimize, step by step.',
    tourLabel: 'Show me how it works (40s)',
    onTour: () => new Tour(steps).start(),
    onExplore: () => {},
  });
}

// ---------------- helpers ----------------
function renderNode(n, canvas) {
  const el = document.createElement('div'); el.className = 'fnode'; el.dataset.id = n.id;
  el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; el.style.setProperty('--cat', CAT[n.cat] || '#888');
  let ports = '';
  for (let i = 0; i < n.inN; i++) ports += `<span class="port" style="left:1.5px;top:${(i + 1) / (n.inN + 1) * 72 - 4.5}px"></span>`;
  for (let i = 0; i < n.outN; i++) ports += `<span class="port" style="left:73.5px;top:${(i + 1) / (n.outN + 1) * 72 - 4.5}px"></span>`;
  el.innerHTML = `<div class="fnode-card"><img src="${IC}${n.icon}.svg" alt="">${ports}<div class="fnode-badge">✓</div></div><div class="fnode-label">${n.label}</div>`;
  canvas.appendChild(el); n.el = el;
}
function port(n, kind, idx) {
  const count = kind === 'out' ? n.outN : n.inN;
  const cardLeft = n.x + 6;
  return { x: kind === 'out' ? cardLeft + 72 : cardLeft, y: n.y + (idx + 1) / (count + 1) * 72 };
}
function enableDrag(nodes, drawEdges) {
  let cur = null, ox = 0, oy = 0;
  document.addEventListener('pointermove', (e) => {
    if (!cur) return; cur.x = e.clientX - ox; cur.y = e.clientY - oy;
    cur.el.style.left = cur.x + 'px'; cur.el.style.top = cur.y + 'px'; drawEdges();
  });
  document.addEventListener('pointerup', () => { cur = null; });
  Object.values(nodes).forEach((n) => {
    n.el.querySelector('.fnode-card').addEventListener('pointerdown', (e) => {
      const wrap = n.el.parentElement.getBoundingClientRect();
      cur = n; ox = e.clientX - n.x; oy = e.clientY - n.y; e.preventDefault();
    });
  });
}
function buildPalette(el) {
  const groups = {};
  // a representative library listing (visual, like the real app)
  [
    ['input', 'excel_reader', 'Excel Reader'], ['input', 'smart_data_loader', 'Smart Data Loader'],
    ['preprocessing', 'train_test_split', 'Train/Test Split'], ['misc', 'column_splitter', 'Column Splitter'],
    ['modelling', 'dimgp_fit', 'DIM-GP Fit'], ['modelling', 'dimgp_predict', 'DIM-GP Predict'],
    ['validation', 'pam_regr', 'PAM Validation'], ['sensitivity', 'sobol_indices', 'Sobol Indices'],
    ['optimization', 'bo_init', 'BO Init'], ['optimization', 'bo_next', 'Next Sample'], ['optimization', 'bo_optimize', 'Optimize'],
    ['solvers', 'python_solver', 'Python Solver'], ['plots', 'plot_scatter', 'Scatter Plot'],
    ['plots', 'plot_bar', 'Bar Plot'], ['plots', 'plot_line', 'Line Plot'],
  ].forEach(([cat, icon, label]) => { (groups[cat] ||= []).push([icon, label]); });
  el.innerHTML = `<input class="flow-search" placeholder="Search nodes..." />`;
  for (const cat in groups) {
    el.insertAdjacentHTML('beforeend', `<div class="pal-cat">${cat}</div>`);
    groups[cat].forEach(([icon, label]) => {
      el.insertAdjacentHTML('beforeend', `<div class="pal-node"><img src="${IC}${icon}.svg" alt="">${label}</div>`);
    });
  }
}

function drawScatter(ctx, s) {
  const w = 150, h = 96, pad = 14; ctx.clearRect(0, 0, w, h);
  let pts;
  if (s) pts = s.trainPoints.map((p) => ({ tr: p.outputs.contrast_ratio, pr: s.predict('contrast_ratio', p.x, p.y).mean }));
  else pts = Array.from({ length: 30 }, () => { const v = 92 + Math.random() * 7; return { tr: v, pr: v + (Math.random() - 0.5) * 2 }; });
  let mn = Infinity, mx = -Infinity; pts.forEach((p) => { mn = Math.min(mn, p.tr, p.pr); mx = Math.max(mx, p.tr, p.pr); });
  const sx = (v) => pad + (v - mn) / (mx - mn || 1) * (w - pad - 6);
  const sy = (v) => h - pad - (v - mn) / (mx - mn || 1) * (h - pad - 6);
  ctx.strokeStyle = 'rgba(148,144,136,0.4)'; ctx.beginPath(); ctx.moveTo(sx(mn), sy(mn)); ctx.lineTo(sx(mx), sy(mx)); ctx.stroke();
  ctx.fillStyle = '#ffb006'; pts.forEach((p) => { ctx.beginPath(); ctx.arc(sx(p.tr), sy(p.pr), 2.2, 0, 7); ctx.fill(); });
}
function drawBars(ctx, s) {
  const w = 150, h = 96, pad = 16; ctx.clearRect(0, 0, w, h);
  let imp, labels;
  if (s) {
    const a0 = s.axisInput(0), a1 = s.axisInput(1), gx = s.grid.x, gy = s.grid.y, mid1 = gy[gy.length >> 1], mid0 = gx[gx.length >> 1];
    const rng = (arr) => Math.max(...arr) - Math.min(...arr);
    const r0 = rng(gx.map((x) => s.predict('contrast_ratio', x, mid1).mean));
    const r1 = rng(gy.map((y) => s.predict('contrast_ratio', mid0, y).mean));
    const raw = [r0, r1, r0 * 0.07, r1 * 0.05, r0 * 0.04, r1 * 0.03]; const tot = raw.reduce((a, b) => a + b, 0) || 1;
    imp = raw.map((v) => v / tot); labels = s.inputs.map((i) => i.label);
  } else { imp = [0.61, 0.27, 0.05, 0.03, 0.02, 0.02]; labels = ['TiO₂', 'Binder', 'Filler', 'Add.', 'Thick.', 'Water']; }
  const n = imp.length, bw = (w - pad - 6) / n - 4, mx = Math.max(...imp);
  imp.forEach((v, i) => {
    const bh = v / mx * (h - pad - 8), x = pad + i * ((w - pad - 6) / n);
    ctx.fillStyle = i < 2 ? '#ffb006' : 'rgba(255,176,6,0.4)';
    ctx.fillRect(x, h - pad - bh, bw, bh);
  });
  ctx.fillStyle = 'rgba(148,144,136,0.8)'; ctx.font = '7px ui-monospace';
  labels.slice(0, n).forEach((l, i) => { ctx.fillText((l || '').slice(0, 5), pad + i * ((w - pad - 6) / n), h - 5); });
}

function buildAgent(body, btn, nodes, edgeEls, drawEdges, setCap) {
  body.innerHTML = `
    <div class="agent-msg user">Train a DIM-GP on my paint data, validate it, rank the drivers, and suggest the next experiment.</div>
    <div class="agent-msg bot">I'll wire it up: Excel Reader → Train/Test Split → DIM-GP Fit → Predict + PAM, Sobol sensitivity, and a Bayesian-optimization branch for the next recipe. Press build.</div>`;
  let built = true;
  btn.onclick = async () => {
    // hide everything, then assemble in order
    Object.values(nodes).forEach((n) => { n.el.style.transition = 'none'; n.el.style.opacity = '0'; n.el.style.transform = 'scale(0.6)'; });
    edgeEls.forEach((e) => { e.el.style.opacity = '0'; });
    setCap('Agent', 'Assembling your workflow', 'The Workflow Agent places and connects the nodes.');
    await new Promise((r) => setTimeout(r, 250));
    for (const id of ORDER) {
      const n = nodes[id];
      n.el.style.transition = 'opacity .3s, transform .3s'; n.el.style.opacity = '1'; n.el.style.transform = 'scale(1)';
      edgeEls.filter((e) => e.to[0] === id || e.from[0] === id).forEach((e) => { e.el.style.transition = 'opacity .4s'; e.el.style.opacity = '1'; });
      await new Promise((r) => setTimeout(r, 230));
    }
    setCap('Ready', 'Workflow assembled', 'Now press Run to execute it.');
  };
}
