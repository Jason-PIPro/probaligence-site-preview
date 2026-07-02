// Stochos Flow Web: the guided, BUILD-IT-YOURSELF demonstrator (v2).
// The visitor picks an industry, then ASSEMBLES a Stochos-Flow-style pipeline:
// drag each node from the palette onto its ghost slot, then wire its ports by
// dragging output -> input. Every wired node carries a real DECISION (the
// inspector), drives the live Confidence Field (StudioField) and the Variables
// dock, and fires an industry-specific beat in the story banner. Step 5 BRANCHES
// per industry into a real readout chart (tornado / pareto / correlation).
//
// The visual language (node cards, bezier edges, run packets, vars table) mirrors
// flow.js; the numbers are real DIM-GP output from the Surrogate. Pointer events
// only (no HTML5 drag-and-drop) so the build is testable headless via Playwright.
import { StudioField } from '../studio-field.js';
import { STORIES } from './studio-stories.js';
import { loadDomain } from '../surrogate.js';
import { Tour, showIntro } from '../tour.js';
import { stochosRun } from '../challenge/score.js';
// studio-charts.js is written in parallel to the v2-D signatures. Import it and
// feature-detect each function at call time so a missing module never breaks the
// build (the branch panel degrades to a text readout).
import * as Charts from '../studio-charts.js';

// Node category accents, mirrored from flow.js CAT. Execution edges glow GREEN.
const CAT = {
  input: '#58c46a', preprocessing: '#c89a3a', modelling: '#d4872a',
  validation: '#4CAF50', sensitivity: '#d4a040', optimization: '#b08030',
  plots: '#ff9f40', misc: '#9a9488',
};

// The 7 build steps, fixed for every domain (v2-B). Each entry: step id, the REAL
// Stochos Flow node that drops onto the graph (authentic names/labels/icons from
// v2-A), its category accent, and a default ghost-slot label. Step 5 (`analyze`)
// is the per-industry BRANCH: its node/icon/label come from story.branch.
const STEPS = [
  { id: 'data',     node: 'excel_reader',   label: 'Excel Reader',   icon: 'excel_reader',     cat: 'input',         slot: 'Data source' },
  { id: 'target',   node: 'train_test_split', label: 'Train/Test Split', icon: 'train_test_split', cat: 'preprocessing', slot: 'Split + target' },
  { id: 'fit',      node: 'dimgp_regr_fit', label: 'DIM-GP Fit',     icon: 'dimgp_fit',        cat: 'modelling',     slot: 'Model' },
  { id: 'validate', node: 'pam_regr',       label: 'PAM Validation', icon: 'pam_regr',         cat: 'validation',    slot: 'Validation' },
  { id: 'analyze',  node: null,             label: null,             icon: null,               cat: 'sensitivity',   slot: 'Analysis', branch: true },
  { id: 'optimize', node: 'bayesian_opt',   label: 'Next Sample',    icon: 'bo_next',          cat: 'optimization',  slot: 'Optimizer' },
  { id: 'deploy',   node: 'web_app_scalar', label: 'Web App Export', icon: 'smart_data_loader', cat: 'misc',         slot: 'Web app' },
];

// Per-industry branch fallback (used when story.branch is absent so the build
// still works against the v1 stories.js). kind selects the chart; node/icon/label
// are authentic v2-A names.
const BRANCH_FALLBACK = {
  paint: { node: 'correlation_coefficients', icon: 'sobol_indices', label: 'Correlations', kind: 'correlation',
    title: 'How the properties trade off',
    story: 'Hiding power and cost pull against each other; the model shows by how much.',
    changed: 'Strong pairs flag the trade-offs you cannot dodge.',
    why: 'Correlations across the surface show which goals fight each other.' },
  chemistry: { node: 'sobol_indices', icon: 'sobol_indices', label: 'Sobol Indices', kind: 'tornado',
    title: 'Which factor drives the result',
    story: 'Temperature moves yield far more than catalyst loading does.',
    changed: 'The longest bar is the lever worth turning first.',
    why: 'Sensitivity ranks the inputs by how much they move the target.' },
  engineering: { node: 'bayesian_opt_optimize', icon: 'bo_optimize', label: 'Pareto Optimize', kind: 'pareto',
    title: 'Cooling versus pressure drop',
    story: 'No single design wins both; the front is the set of best compromises.',
    changed: 'Points on the front are the designs nothing else beats outright.',
    why: 'A Pareto front shows the honest trade between two competing goals.' },
};

// Wiring: each node wires from the previous pipeline node's output into its input.
// analyze taps the fit node (sensitivity/correlation/optimize read the model);
// optimize also taps fit. A simple left-to-right chain otherwise.
const FLOW_LINKS = {
  target: ['data'], fit: ['target'], validate: ['fit'],
  analyze: ['fit'], optimize: ['fit'], deploy: ['optimize'],
};

// per-industry Flow project file name shown in the title bar.
const PROJECT_NAME = { paint: 'coating-doe.sfpj', chemistry: 'reaction-doe.sfpj', engineering: 'heat-sink.sfpj' };

// small text badge baked onto a node tile where it reads well.
const NODE_BADGE = {
  dimgp_regr_fit: 'FIT', bayesian_opt_init: 'INIT', bayesian_opt: 'NEXT',
  train_test_split: '70/30', pam_regr: 'PAM', web_app_scalar: 'APP',
};

const IC = 'vendor/node-icons/';
// graph layout: a left-to-right pipeline on row 0, the branch slot on row 1.
const COLX = 150, COLY = 132, OX = 26, OY = 30, NW = 78, NH = 72;
const CI_Z = { 90: 1.645, 95: 1.96, 99: 2.576 };
const ROW = { data: [0, 0], target: [1, 0], fit: [2, 0], validate: [3, 0], analyze: [2, 1], optimize: [4, 0], deploy: [5, 0] };

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (v, d = 2) => (v == null || !isFinite(v)) ? 'n/a' : Number(v).toFixed(d);
const DASH = '';  // size/value placeholder; no em or en dashes per the studio style rule

// Inject studio-scoped CSS overrides once into <head>. Idempotent.
// This avoids touching styles.css (owned by another agent) while keeping
// studio-specific colour fixes local to this module.
(function injectStudioCSS() {
  if (document.getElementById('__studio_injected_css')) return;
  const s = document.createElement('style');
  s.id = '__studio_injected_css';
  s.textContent = `
/* M7: Context button - replace prohibited indigo/purple with a warm neutral */
.sf-abtn.sf-ctx { background: #6b6355; border-color: #524d44; }
.sf-abtn.sf-ctx:hover { background: #7a7265; }
.sf-abtn.sf-ctx.attached { background: #2faf5a; border-color: #279249; }

/* B1: "Use cases" back link in the studio picker */
.studio-pick-back {
  display: inline-flex; align-items: center; gap: 6px;
  background: none; border: none; cursor: pointer;
  color: var(--muted, #9c9890); font-size: 13px; font-weight: 600;
  padding: 0; margin-bottom: 28px;
  transition: color 0.16s;
}
.studio-pick-back:hover { color: var(--warm, #ffb006); }

/* ================================================================
   STUDIO POLISH PASS - all overrides below are high-specificity
   .sf-app ... rules so they never touch styles.css.
   ================================================================ */

/* ---------------------------------------------------------------
   FIX 1: PERSISTENT SITE HEADER
   The studio now lives BELOW the topbar (sf-fullscreen is never
   set). Override the 100vh heights from styles.css so the studio
   fits in the remaining viewport below the 74px topbar (14px*2 padding +
   ~34px pill row + 1px border). Measured: a 58px guess left 16px overflow.
   -------------------------------------------------------------- */
.sf-app,
.studio-stage,
.studio,
.studio-pick {
  height: calc(100vh - 66px) !important;
  min-height: 0 !important;
  max-height: calc(100vh - 66px) !important;
}

/* ---------------------------------------------------------------
   FIX 2: CANVAS CONSTRAINED TO VISIBLE AREA
   .sf-center must be a positioning context so .studio-deploy
   (position:absolute) is clipped to the center column, not the
   full stage width. Without this the deploy panel overflows into
   the agent panel column.
   Also ensure .sf-viewers (position:absolute inside .sf-canvas)
   is clipped by overflow:hidden on .sf-canvas (already set in
   styles.css). Adding overflow:hidden to .sf-center clips
   absolute children that would render behind the agent panel.
   -------------------------------------------------------------- */
.sf-app .sf-center {
  position: relative !important;
  overflow: hidden !important;
  min-width: 0 !important;
}

/* The deploy panel must stay inside .sf-center, fully within the
   canvas column (left side of agent panel). */
.sf-app .studio-deploy {
  position: absolute !important;
  right: 14px !important;
  bottom: 14px !important;
  left: auto !important;
  /* Constrain width so it cannot overflow to the right edge      */
  width: min(380px, calc(100% - 28px)) !important;
  max-width: calc(100% - 28px) !important;
}

/* ---------------------------------------------------------------
   Palette node clipping
   Node labels must not overflow the palette panel width.
   -------------------------------------------------------------- */
.sf-app .sf-palette {
  overflow-x: hidden !important;
  clip-path: inset(0 0 0 0);
}
.sf-app .pal-node {
  box-sizing: border-box !important;
  width: 100% !important;
  max-width: 100% !important;
  min-width: 0 !important;
  white-space: nowrap !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
}
.sf-app .pal-node img { flex-shrink: 0 !important; }
.sf-app .pal-robot,
.sf-app .pal-sub { flex-shrink: 0 !important; }

/* Cancel the global .hint tooltip positioning on palette nodes   */
.sf-app .pal-node.hint {
  position: relative !important;
  pointer-events: auto !important;
  left: auto !important;
  right: auto !important;
  top: auto !important;
  bottom: auto !important;
  transform: none !important;
  animation: sfPalHintInner 1.5s ease-in-out infinite !important;
}
@keyframes sfPalHintInner {
  0%, 100% { box-shadow: inset 0 0 0 0 rgba(57,211,83,0); }
  50%       { box-shadow: inset 0 0 0 2px rgba(57,211,83,0.35), inset 0 0 8px rgba(57,211,83,0.18); }
}

/* ---------------------------------------------------------------
   Alignment sweep
   -------------------------------------------------------------- */
.sf-app .sf-toolbar {
  display: flex; align-items: center; gap: 4px;
  padding: 0 10px; height: 36px; box-sizing: border-box;
  border-bottom: 1px solid var(--sf-border, #2e2e32);
  background: var(--sf-chrome-2, #1e1e22); flex-shrink: 0;
}
.sf-app .sf-tool {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 6px; flex-shrink: 0;
}
.sf-app .sf-drag-handle { flex: 1; max-width: 8px; }

.sf-app .snode-label {
  margin-top: 6px; font-size: 11px; line-height: 1.25;
  white-space: nowrap; text-align: center;
  overflow: hidden; text-overflow: ellipsis; max-width: 90px;
}

.sf-app .sf-canvas { min-height: 260px; }

.sf-app .sf-viewers { padding: 12px; gap: 10px; }
#viewerField { width: min(400px, 55%); max-width: 55%; }

.sf-app .sf-back-btn {
  display: inline-flex; align-items: center;
  padding: 0 10px; height: 100%;
  background: none; border: none;
  border-right: 1px solid var(--sf-border, #2e2e32);
  color: var(--sf-muted, #888); font-size: 12px; font-weight: 600;
  cursor: pointer; flex-shrink: 0; transition: color 0.14s; margin-right: 6px;
}
.sf-app .sf-back-btn:hover { color: var(--sf-ink, #e8e8ea); }

.sf-app .sf-titlebar {
  display: flex; align-items: center; height: 36px; padding: 0;
  flex-shrink: 0; border-bottom: 1px solid var(--sf-border, #2e2e32);
  background: var(--sf-chrome-2, #1e1e22);
}
.sf-app .sf-logo {
  font-size: 11px; font-weight: 800; letter-spacing: 0.1em;
  color: var(--sf-orange, #f59e0b); padding: 0 8px; flex-shrink: 0;
}
.sf-app .sf-title {
  font-size: 12px; color: var(--sf-muted, #888);
  flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.sf-app .sf-dot {
  display: inline-block; width: 7px; height: 7px; border-radius: 50%;
  background: var(--sf-green, #39d353); margin-right: 5px; vertical-align: middle;
}
.sf-app .sf-winctl {
  display: flex; align-items: center; gap: 6px; padding: 0 10px; flex-shrink: 0;
}
.sf-app .sf-menubar {
  display: flex; align-items: center; gap: 0; height: 28px; padding: 0 8px;
  flex-shrink: 0; border-bottom: 1px solid var(--sf-border, #2e2e32);
}
.sf-app .sf-menubar > span {
  padding: 0 10px; height: 100%; display: inline-flex; align-items: center;
  font-size: 12px; cursor: default;
}

/* ---------------------------------------------------------------
   FIX 3 + 4: AGENT PANEL - one message at a time, calm
   -------------------------------------------------------------- */

/* Guide message: one clear block */
.sf-app #guideMsg {
  padding: 12px 13px; margin: 0;
  border-radius: 10px 10px 0 0;
  background: var(--sf-chrome-2, #1e1e22);
  border: 1px solid var(--sf-border, #2e2e32);
  border-bottom: none; animation: none;
}
/* Decision block: joins seamlessly below guide */
.sf-app #decisionMsg {
  padding: 10px 13px 12px; margin: 0;
  border-radius: 0 0 10px 10px;
  background: var(--sf-chrome-2, #1e1e22);
  border: 1px solid var(--sf-border, #2e2e32);
  border-top: 1px solid rgba(255,255,255,0.05); animation: none;
}
/* Single story beat bubble: compact, clearly secondary */
.sf-app .sf-beat-single {
  padding: 9px 13px; margin: 0; border-radius: 8px;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);
  color: #b8b8bc; font-size: 12px; line-height: 1.5;
  animation: sfMsgIn 0.28s ease both;
}
@keyframes sfMsgIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }

/* Auto-build end guide: a distinct calm card with a green accent */
.sf-app .sf-autobuild-guide {
  padding: 12px 13px; margin: 0; border-radius: 8px;
  background: rgba(57,211,83,0.06);
  border: 1px solid rgba(57,211,83,0.22);
  color: var(--sf-ink, #e6e6e6); font-size: 12.5px; line-height: 1.6;
  animation: sfMsgIn 0.35s ease both;
}
.sf-app .sf-autobuild-guide strong { color: #8ee79c; font-weight: 600; }

/* Suppress any old-style .sf-beat accumulations */
.sf-app .sf-beat { display: none !important; }

/* Chat: tight gap so guide+decision read as one unit */
.sf-app .sf-chat { gap: 8px; padding: 10px 10px 8px; }

/* Actions: tighter row */
.sf-app .sf-agent-actions { margin-top: 10px; gap: 6px; }

/* Agent head: no extra decoration */
.sf-app .sf-agent-head {
  padding: 9px 12px 8px;
  border-bottom: 1px solid var(--sf-border, #2e2e32);
  background: var(--sf-chrome-2, #1e1e22);
}
.sf-app .sf-agent-title { font-size: 12px; font-weight: 700; letter-spacing: 0.06em; }

/* pal-node search input: keep focus ring amber, not blue */
.sf-app .sf-search-input:focus {
  border-color: rgba(255, 176, 6, 0.55) !important;
  outline: none;
}
`;
  document.head.appendChild(s);
}());

export async function mountStudio(root) {
  // Lifecycle: a full rebuild on every mount. Tear down any prior renderer.
  if (root._studioField && root._studioField.destroy) {
    try { root._studioField.destroy(); } catch (e) { /* already gone */ }
  }
  root._studioField = null;

  // Track the resize listener added inside buildStage so we can remove it on
  // teardown (M3 fix: prevent listener accumulation across studio visits).
  let _onResize = null;

  root.innerHTML = `
  <div class="studio fade-in">
    <div class="studio-pick">
      <div class="pick-head">
        <button class="studio-pick-back" id="studioPickBack">&#8592; Use cases</button>
        <h1>Build it yourself</h1>
        <div class="lead">Pick an industry. You will assemble a Stochos Flow workflow by dragging nodes and wiring their ports, make a real decision at each step, and watch a live DIM-GP model respond.</div>
      </div>
      <div class="pick-cards" id="pickcards"></div>
    </div>
  </div>`;

  const pickWrap = root.querySelector('.studio');
  const cards = root.querySelector('#pickcards');

  // B1: wire the persistent "Use cases" back button in the picker screen.
  // Navigating to #/challenge (or the hub when no challenge route exists) lets
  // the user escape the picker without using browser-back.
  const pickBackBtn = root.querySelector('#studioPickBack');
  if (pickBackBtn) {
    pickBackBtn.onclick = () => { location.hash = '#/challenge'; };
  }

  const order = ['paint', 'chemistry', 'engineering'];
  for (const key of order) {
    const s = STORIES[key];
    if (!s) continue;
    const card = document.createElement('div');
    card.className = 'pick-card';
    card.dataset.domain = key;
    card.style.setProperty('--glow', s.accent || 'var(--accent)');
    card.innerHTML = `
      <span class="glow" style="background:${s.accent || 'var(--accent)'}"></span>
      <span class="tag">${s.tag || key}</span>
      <h3>${s.outcome || ''}</h3>
      <p>${s.pitch || ''}</p>
      <span class="go">Build this workflow</span>`;
    card.onclick = () => pickDomain(key);
    cards.appendChild(card);
  }

  // ---- "Beat Stochos" hand-off: if we arrived from the challenge game, skip the
  // picker, build that case directly, and offer a return-to-showdown banner. ----
  // M4 fix: consume challengeCtx immediately (one-shot). Clearing it here ensures
  // that a later plain #/studio visit (entered via nav, not from the challenge)
  // shows the normal picker rather than auto-skipping to the old challenge domain.
  let challengeCtx = null;
  try { challengeCtx = JSON.parse(sessionStorage.getItem('challengeCtx') || 'null'); } catch (e) { challengeCtx = null; }
  if (challengeCtx) {
    try { sessionStorage.removeItem('challengeCtx'); } catch (_e) { /* storage blocked */ }
  }

  function finishChallenge(surrogate) {
    if (!challengeCtx) return;
    const prim = challengeCtx.primary || { out: surrogate.outputs[0].name, goal: 'high' };
    // budget-limited best (same as the challenge's compact path), so the game is winnable
    const r = stochosRun(surrogate, prim.out, prim.goal, 7);
    try {
      sessionStorage.setItem('challengeShowdown', JSON.stringify({
        domain: challengeCtx.domain, userBest: challengeCtx.userBest,
        stochos: { score: r.score, params: r.params, outputs: r.outputs },
      }));
      sessionStorage.removeItem('challengeCtx');
    } catch (e) { /* noop */ }
    location.hash = '#/challenge';
  }

  function addChallengeBanner(surrogate) {
    const b = document.createElement('div');
    b.className = 'sf-challenge-banner';
    b.innerHTML = `<span>Challenge: build the workflow, then settle the score.</span><button class="sf-ch-return" id="chReturn">See the showdown</button>`;
    root.appendChild(b);
    b.querySelector('#chReturn').onclick = () => finishChallenge(surrogate);
  }

  if (challengeCtx && STORIES[challengeCtx.dataDomain]) pickDomain(challengeCtx.dataDomain);

  // ---- picking an industry: tear down picker, build the stage, load domain ----
  async function pickDomain(domain) {
    const story = STORIES[domain];
    if (!story) return;
    const pick = root.querySelector('.studio-pick');
    if (pick) pick.remove();

    let surrogate;
    try {
      surrogate = await loadDomain(domain);
    } catch (e) {
      pickWrap.innerHTML = `<div class="placeholder"><div><div class="big">Could not load ${domain}</div><p>${e.message}</p></div></div>`;
      return;
    }
    buildStage(domain, story, surrogate);
    if (challengeCtx) addChallengeBanner(surrogate);
  }

  // ---------------------------------------------------------------- stage ----
  function buildStage(domain, story, surrogate) {
    // resolve the per-industry branch node (story-supplied, else fallback)
    const branch = resolveBranch(story, domain);
    // bind the branch node identity onto the analyze step so the rest of the code
    // treats it like any other node.
    const steps = STEPS.map((s) => s.branch
      ? { ...s, node: branch.node, label: branch.label, icon: branch.icon, slot: slotFor(story, s.id, s.slot) }
      : { ...s, slot: slotFor(story, s.id, s.slot) });

    // per-industry Flow project name shown in the title bar + Working Dir.
    const project = PROJECT_NAME[domain] || 'workflow.sfpj';
    const ctxDocs = `${domain}_docs`;
    const workDir = `C:\\Users\\you\\StochosFlow\\${project.replace('.sfpj', '')}`;

    // the title-bar viewer for the per-industry branch ("Sensitivity"/"Pareto"/"Correlations")
    const branchViewer = { tornado: 'Sensitivity', pareto: 'Pareto', correlation: 'Correlations' }[branch.kind] || 'Analysis';

    const stage = document.createElement('div');
    stage.className = 'sf-app studio-stage';
    stage.innerHTML = `
      <div class="sf-titlebar">
        <button class="sf-back-btn" id="btnBack" title="Back to domain picker">&#8592; Back</button>
        <span class="sf-logo">SF</span>
        <span class="sf-title"><span class="sf-dot"></span> Stochos Flow - ${project}</span>
        <span class="sf-winctl"><i class="sf-min"></i><i class="sf-max"></i><i class="sf-close"></i></span>
      </div>
      <div class="sf-menubar">
        <span>File</span><span>Scene</span><span>View</span><span>Tools</span><span>Help</span><span class="sf-menu-agent">Agent</span>
      </div>
      <div class="sf-toolbar">
        <span class="sf-drag-handle"></span>
        <button class="sf-tool sf-play" id="btnRun" title="Run">&#9654;</button>
        <button class="sf-tool sf-stop" id="btnStop" title="Stop">&#9632;</button>
        <button class="sf-tool sf-save" id="btnSave" title="Save">&#128190;</button>
        <button class="sf-tool sf-export" id="btnExport" title="Export">&#11123;</button>
      </div>
      <div class="sf-main">
        <aside class="sf-palette" id="palette"></aside>
        <section class="sf-center">
          <div class="sf-canvas" id="graph">
            <svg class="sf-edges studio-edges" id="edges"></svg>
            <div class="sf-viewers" id="viewers">
              <div class="sf-viewer" id="viewerField">
                <div class="sf-viewer-bar">
                  <span class="sf-viewer-title">DIM-GP Surface</span>
                  <button class="sf-viewer-toggle" id="btnToggleField" title="Collapse / expand preview"><span class="sf-viewer-toggle-icon">&#8963;</span></button>
                </div>
                <div class="sf-viewer-body studio-result" id="result"></div>
              </div>
              <div class="sf-viewer" id="viewerBranch" hidden>
                <div class="sf-viewer-bar">
                  <span class="sf-viewer-title" id="branchViewerTitle">${branchViewer}</span>
                  <button class="sf-viewer-toggle" id="btnToggleBranch" title="Collapse / expand"><span class="sf-viewer-toggle-icon">&#8963;</span></button>
                </div>
                <div class="sf-viewer-body studio-branch" id="branch">
                  <div class="branch-head"><span class="branch-title" id="branchTitle"></span></div>
                  <canvas class="branch-chart" id="branchChart" width="300" height="170"></canvas>
                  <div class="branch-legend" id="branchLegend"></div>
                </div>
              </div>
            </div>
          </div>
          <div class="sf-dock" id="dock">
            <div class="sf-dock-head">
              <span class="sf-dock-title">Enhanced Python Console</span>
              <span class="sf-workdir">Working Dir: <b>${workDir}</b></span>
              <span class="sf-dock-actions"><button class="sf-dock-btn" id="conClear">Clear</button><button class="sf-dock-btn" id="conSave">Save</button></span>
            </div>
            <div class="sf-console studio-console" id="console"></div>
            <div class="sf-prompt"><span class="sf-prompt-mark">&gt;&gt;&gt;</span><input class="sf-prompt-input" placeholder="" readonly></div>
            <table class="vars-table sf-vars" id="varsTable" hidden><thead><tr><th>Name</th><th>Type</th><th>Size</th><th>Value preview</th></tr></thead><tbody id="vbody"></tbody></table>
            <div class="sf-dock-tabs vars-head">
              <span class="sf-tab on" data-tab="console">Console</span>
              <span class="sf-tab" data-tab="vars">Variables <span class="count" id="vcount">0 variables</span></span>
              <span class="sf-tab" data-tab="connections">Connections</span>
              <span class="sf-tab" data-tab="notes">Notes</span>
              <span class="sf-toggle-console" id="toggleConsole">Toggle Console</span>
            </div>
          </div>
        </section>
        <aside class="sf-agent" id="agent">
          <div class="sf-agent-head"><span class="sf-agent-title">Agent</span><span class="sf-agent-ctl"><i class="sf-max"></i><i class="sf-close"></i></span></div>
          <div class="sf-chat" id="chat">
            <div class="sf-msg sf-msg-agent" id="guideMsg">
              <div class="insp-kicker" id="inspKicker"></div>
              <div class="insp-title" id="inspTitle"></div>
              <div class="insp-why" id="inspWhy"></div>
            </div>
            <div class="sf-msg sf-msg-agent sf-msg-decision" id="decisionMsg">
              <div class="insp-decision" id="inspDecision"></div>
              <div class="insp-changed" id="inspChanged"></div>
              <div class="sf-agent-actions">
                <button class="btn-connect-for-me sf-chip-btn" id="btnConnect">Connect for me</button>
                <button class="btn-autobuild sf-chip-btn" id="btnAutobuild">Auto-build rest</button>
                <button class="insp-next sf-chip-btn" id="inspNext">Next</button>
              </div>
            </div>
          </div>
          <div class="sf-agent-foot">
            <div class="sf-ctx-chip">Context: ${ctxDocs}</div>
            <textarea class="sf-agent-input" id="agentInput" placeholder="Describe what you want to build... (Ctrl+Enter to send)"></textarea>
            <div class="sf-agent-btns">
              <button class="sf-abtn sf-ctx" id="btnContext">Context</button>
              <button class="sf-abtn sf-send" id="btnSend">Send</button>
              <button class="sf-abtn sf-clear" id="btnClearChat">Clear</button>
            </div>
          </div>
        </aside>
      </div>`;
    pickWrap.appendChild(stage);

    const $ = (s) => stage.querySelector(s);
    const graph = $('#graph'), svg = $('#edges'), resultHost = $('#result');
    const vbody = $('#vbody'), vcountEl = $('#vcount'), consoleEl = $('#console');
    const branchPanel = $('#viewerBranch');
    const chatEl = $('#chat'), varsTable = $('#varsTable');

    // ---- Back button: return to the domain picker (B1 / M3) ----
    // Uses the shared studioTeardown() helper (defined after onResize is created)
    // so the same cleanup path works here AND from main.js's route teardown.
    $('#btnBack').onclick = () => {
      studioTeardown();
      // re-mount: this rebuilds the pick screen from scratch
      mountStudio(root);
    };

    // ---- Collapsible Model Preview (DIM-GP Surface viewer) ----
    // Persist collapsed state per session. Default to collapsed on narrow viewports
    // where the viewer would cover the canvas (<=900px wide).
    const FIELD_COLLAPSE_KEY = 'sf_field_collapsed';
    const fieldViewer = $('#viewerField');
    const shouldDefaultCollapse = window.innerWidth <= 900;
    const savedCollapse = sessionStorage.getItem(FIELD_COLLAPSE_KEY);
    const initCollapsed = savedCollapse !== null ? savedCollapse === '1' : shouldDefaultCollapse;
    if (initCollapsed) fieldViewer.classList.add('collapsed');

    const applyToggle = (viewer, btn, key) => {
      const isCollapsed = viewer.classList.toggle('collapsed');
      try { sessionStorage.setItem(key, isCollapsed ? '1' : '0'); } catch (_e) {}
      // when expanding the field viewer, trigger a resize so StudioField repaints
      if (!isCollapsed && key === FIELD_COLLAPSE_KEY && field.resize) {
        requestAnimationFrame(() => { if (resultHost.isConnected) field.resize(); });
      }
    };

    $('#btnToggleField').onclick = (e) => {
      e.stopPropagation();
      applyToggle(fieldViewer, $('#btnToggleField'), FIELD_COLLAPSE_KEY);
    };
    // also allow clicking the viewer bar itself to toggle
    fieldViewer.querySelector('.sf-viewer-bar').addEventListener('click', (e) => {
      if (e.target.classList.contains('sf-viewer-toggle') || e.target.classList.contains('sf-viewer-toggle-icon')) return;
      applyToggle(fieldViewer, $('#btnToggleField'), FIELD_COLLAPSE_KEY);
    });

    // Branch viewer also gets a collapse toggle (no persistent state needed)
    // (branchPanel already holds the same #viewerBranch reference from line above)
    $('#btnToggleBranch').onclick = (e) => {
      e.stopPropagation();
      branchPanel.classList.toggle('collapsed');
    };
    branchPanel.querySelector('.sf-viewer-bar').addEventListener('click', (e) => {
      if (e.target.classList.contains('sf-viewer-toggle') || e.target.classList.contains('sf-viewer-toggle-icon')) return;
      branchPanel.classList.toggle('collapsed');
    });

    // dock tabs (Console / Variables / Connections / Notes). Variables shows the
    // tree table; the other tabs share the console body (visual parity with Flow).
    stage.querySelectorAll('.sf-dock-tabs [data-tab]').forEach((tab) => {
      tab.onclick = () => {
        stage.querySelectorAll('.sf-dock-tabs [data-tab]').forEach((t) => t.classList.toggle('on', t === tab));
        const showVars = tab.dataset.tab === 'vars';
        varsTable.hidden = !showVars;
        consoleEl.hidden = showVars;
        stage.querySelector('.sf-prompt').hidden = showVars;
      };
    });
    // Toggle Console: collapse/expand the whole dock.
    $('#toggleConsole').onclick = () => { $('#dock').classList.toggle('collapsed'); };
    // console Clear/Save (Save is illustrative)
    $('#conClear').onclick = () => { consoleEl.innerHTML = ''; };
    $('#conSave').onclick = (e) => { e.preventDefault(); };
    // toolbar Run triggers the same auto-build the agent uses; stop/save/export visual
    $('#btnRun').onclick = () => { if (!placing) autobuild(); };
    $('#btnStop').onclick = (e) => { e.preventDefault(); };
    $('#btnSave').onclick = (e) => { e.preventDefault(); };
    $('#btnExport').onclick = (e) => { e.preventDefault(); };
    $('#btnContext').onclick = () => { $('#btnContext').classList.add('attached'); };
    $('#btnClearChat').onclick = () => { resetGuide(); };
    // Send / Ctrl+Enter in the agent input runs Auto-build (the agent "builds it")
    const agentInput = $('#agentInput');
    $('#btnSend').onclick = () => { if (!placing) autobuild(); };
    agentInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (!placing) autobuild(); }
    });

    // ---- the renderer: fills #result with its own canvas. We hold the ref. ----
    const axisLabels = (story.axes || []).map((a) => {
      const inp = surrogate.inputs.find((i) => i.name === a);
      return inp ? (inp.label || inp.name) : a;
    });
    const field = new StudioField(resultHost, surrogate, {
      colormap: 'amber',
      axisLabels,
      accent: story.accent || 'var(--accent)',
    });
    root._studioField = field;
    if (field.setStage) field.setStage('empty');
    if (field.resize) requestAnimationFrame(() => field.resize());
    // M3 fix: track the resize listener in the outer-scoped _onResize so the
    // returned teardown (and btnBack) can always remove the exact same function.
    const onResize = () => {
      if (!resultHost.isConnected) { window.removeEventListener('resize', onResize); return; }
      if (field.resize) field.resize();
      drawEdges();
    };
    _onResize = onResize;
    window.addEventListener('resize', onResize);

    // Shared cleanup: remove the resize listener and destroy the field renderer.
    // Called by btnBack (navigate back to picker) AND by the teardown returned to
    // main.js (navigate away from #/studio entirely).
    function studioTeardown() {
      if (_onResize) { window.removeEventListener('resize', _onResize); _onResize = null; }
      if (root._studioField && root._studioField.destroy) {
        try { root._studioField.destroy(); } catch (_e) {}
        root._studioField = null;
      }
    }

    // ---- node model: positions + port counts (cards render on placement) ----
    const nodes = {};
    steps.forEach((s) => {
      const [c, r] = ROW[s.id] || [0, 0];
      nodes[s.id] = {
        ...s, x: OX + c * COLX, y: OY + r * COLY,
        inN: FLOW_LINKS[s.id] ? FLOW_LINKS[s.id].length : 0,
        outN: s.id === 'deploy' ? 0 : 1,
        el: null, placed: false,
      };
    });

    // ---- ghost slots: a dashed blueprint of what to build, laid out by ROW ----
    steps.forEach((s) => {
      const n = nodes[s.id];
      const g = document.createElement('div');
      g.className = 'studio-ghost';
      g.dataset.id = s.id;
      g.style.left = n.x + 'px';
      g.style.top = n.y + 'px';
      g.style.width = NW + 'px';
      g.style.height = NH + 'px';
      g.innerHTML = `<span class="ghost-label">${s.slot || s.id}</span>`;
      graph.appendChild(g);
      n.ghost = g;
    });

    // ---- edges (svg paths created up-front; drawn only once both ends exist) ----
    const edgeEls = [];
    for (const id in FLOW_LINKS) {
      FLOW_LINKS[id].forEach((from, i) => {
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('class', 'edge');
        svg.appendChild(p);
        edgeEls.push({ from, to: id, toPort: i, el: p, live: false });
      });
    }
    // rubber-band wire shown while the user drags from a port
    const dragWire = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    dragWire.setAttribute('class', 'wire-drag');
    dragWire.style.display = 'none';
    svg.appendChild(dragWire);

    const drawEdges = () => edgeEls.forEach((e) => {
      const a = nodes[e.from], b = nodes[e.to];
      if (!a || !b || !a.el || !b.el) { e.el.setAttribute('d', ''); return; }
      const s = port(a, 'out', 0), t = port(b, 'in', e.toPort);
      const dx = Math.max(40, Math.abs(t.x - s.x) * 0.5);
      e.el.setAttribute('d', `M ${s.x},${s.y} C ${s.x + dx},${s.y} ${t.x - dx},${t.y} ${t.x},${t.y}`);
    });

    // ----------------------------------------------------- state machine ----
    let vcount = 0;
    let lastChoice = {};    // remembers each step's chosen value
    let stepSeq = 0;        // bumped on each step entry; cancels an in-flight optimize run
    let current = 0;        // current step index
    let idleTimer = null;   // 6s idle hint per step
    let placing = false;    // a drag/auto-build animation is in flight

    // Enhanced Python Console: timestamped lines, Flow-style. A leading ✓ / [Tools]
    // token in the message renders with its own accent (design-polish styles them).
    function log(msg) {
      const line = document.createElement('div');
      line.className = 'console-line';
      const t = new Date();
      const hh = String(t.getHours()).padStart(2, '0');
      const mm = String(t.getMinutes()).padStart(2, '0');
      const ss = String(t.getSeconds()).padStart(2, '0');
      const stamp = document.createElement('span');
      stamp.className = 'con-time';
      stamp.textContent = `[${hh}:${mm}:${ss}] `;
      line.appendChild(stamp);
      line.appendChild(document.createTextNode(msg));
      consoleEl.appendChild(line);
      consoleEl.scrollTop = consoleEl.scrollHeight;
    }
    // seed the console with a couple of authentic Flow boot lines
    log('✓ Stochos license verified successfully');
    log('[Tools] Registry built: 30 tools from 22 modules');

    // post a guidance/story line as a SINGLE story beat in the Agent chat.
    // Rather than appending a new bubble every time (which creates a wall of
    // messages), we maintain exactly ONE .sf-beat-single element and replace
    // its text. The guide+decision block is always visible above it.
    function beat(msg) {
      if (!msg) return;
      let m = chatEl.querySelector('.sf-beat-single');
      if (!m) {
        m = document.createElement('div');
        m.className = 'sf-msg sf-beat-single';
        chatEl.appendChild(m);
      }
      m.textContent = msg;
      // briefly re-trigger the fade-in by toggling the animation
      m.style.animation = 'none';
      void m.offsetWidth;
      m.style.animation = '';
      chatEl.scrollTop = chatEl.scrollHeight;
    }
    // Clear Chat: remove the beat block, keep guide + decision visible.
    function resetGuide() {
      const b = chatEl.querySelector('.sf-beat-single');
      if (b) b.remove();
      chatEl.scrollTop = 0;
    }
    function addVar(label, name, type, size, val) {
      const cells = `<td class="node">${label || ''} <span style="color:var(--faint);font-weight:400">${name}</span></td><td class="type">${type}</td><td>${size}</td><td class="val">${val}</td>`;
      // dedupe: re-deciding a step updates that node's variable in place rather than
      // stacking a duplicate row (bo_next rows carry a #i label so they stay distinct).
      const key = `${label || ''} ${name}`;
      const existing = Array.from(vbody.children).find((tr) => tr.dataset.key === key);
      if (existing) { existing.innerHTML = cells; flash(existing); return; }
      const tr = document.createElement('tr');
      tr.className = 'vars-row'; tr.dataset.key = key; tr.innerHTML = cells;
      vbody.appendChild(tr);
      vcount++;
      vcountEl.textContent = `${vcount} variable${vcount === 1 ? '' : 's'}`;
    }
    function flash(el) { el.classList.remove('var-flash'); void el.offsetWidth; el.classList.add('var-flash'); }

    // -------------------------------------------------- place + wire core ----
    // Render the real node card into its slot with the drop-in animation, mark the
    // ghost filled. Idempotent: a second call is a no-op.
    function placeNode(stepId) {
      const n = nodes[stepId];
      if (n.placed) return;
      renderNode(n, graph);
      n.placed = true;
      if (n.ghost) n.ghost.classList.add('filled');
      n.el.classList.add('placing');
      void n.el.offsetWidth;
      // the drop-in is a transient animation; clear it so the card settles cleanly
      setTimeout(() => { if (n.el) n.el.classList.remove('placing'); }, 360);
      bindNodeDrag(n);
      bindPorts(n);
      drawEdges();
    }

    // Wire the incoming edges of a placed node: animate a packet down each, glow the
    // edge green, run the step effect, fire the beat, and complete the step.
    // silent=true suppresses the beat (used by autobuild to avoid a flood of messages).
    async function wireNode(stepId, withBeat = true, silent = false) {
      const n = nodes[stepId];
      if (!n.placed) placeNode(stepId);
      n.el.classList.add('running');
      drawEdges();
      const incoming = edgeEls.filter((e) => e.to === stepId);
      await Promise.all(incoming.map((e) => packet(e, svg)));
      await delay(120);
      n.el.classList.remove('running');
      n.el.classList.add('done');
      incoming.forEach((e) => { e.el.classList.add('hot'); e.live = true; });
      runEffect(stepId);
      if (withBeat && !silent) beat(beatFor(story, stepId, branch));
      completeStep(stepId);
    }

    // -------- per-step decision controls, from STORIES + fixed vocabulary -----
    function renderDecision(stepId, decision) {
      const host = $('#inspDecision');
      host.innerHTML = '';
      if (!decision || !decision.key) return; // pure-confirm step (deploy)
      const key = decision.key;
      if (decision.label) {
        const lab = document.createElement('div');
        lab.className = 'decision-label';
        lab.textContent = decision.label;
        host.appendChild(lab);
      }
      if (key === 'strategy') { renderStrategy(host, stepId, decision); return; }
      if (key === 'transform') { renderToggle(host, stepId, decision); return; }
      // budget / output / ci / goal => choice chips
      const chipRow = document.createElement('div');
      chipRow.className = 'chip-row';
      const opts = decision.options || [];
      opts.forEach((opt) => {
        const chip = document.createElement('button');
        chip.className = 'choice-chip';
        chip.dataset.value = opt.value;
        chip.innerHTML = `<span class="chip-label">${opt.label}</span>${opt.hint ? `<span class="chip-hint">${opt.hint}</span>` : ''}`;
        chip.onclick = () => {
          chipRow.querySelectorAll('.choice-chip').forEach((c) => c.classList.toggle('on', c === chip));
          applyChoice(stepId, key, opt.value, opt);
        };
        chipRow.appendChild(chip);
      });
      host.appendChild(chipRow);
      const def = pickDefault(stepId, key, opts, story);
      const defChip = chipRow.querySelector(`.choice-chip[data-value="${def}"]`) || chipRow.querySelector('.choice-chip');
      if (defChip) defChip.click();
    }

    function renderToggle(host, stepId, decision) {
      const opts = decision.options || [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }];
      const row = document.createElement('div');
      row.className = 'toggle-row';
      opts.forEach((opt) => {
        const b = document.createElement('button');
        b.className = 'toggle-opt';
        b.dataset.value = opt.value;
        b.textContent = opt.label;
        b.onclick = () => {
          row.querySelectorAll('.toggle-opt').forEach((o) => o.classList.toggle('on', o === b));
          applyChoice(stepId, 'transform', opt.value, opt);
        };
        row.appendChild(b);
      });
      host.appendChild(row);
      (row.querySelector('.toggle-opt[data-value="on"]') || row.firstChild).click();
    }

    function renderStrategy(host, stepId, decision) {
      // goal (direction) + kappa slider (explore <-> exploit) + a "Run N" action
      const out = lastChoice.output || story.defaultOutput;
      const goalOpts = (decision.goalOptions) || goalChips(story, out);
      const wrap = document.createElement('div');
      wrap.className = 'strategy-ctl';
      wrap.innerHTML = `
        <div class="goal-row" id="goalRow"></div>
        <div class="kappa-row">
          <span class="kappa-end">Exploit</span>
          <input class="kappa-slider" id="kappa" type="range" min="0.2" max="3" step="0.1" value="1.4">
          <span class="kappa-end">Explore</span>
        </div>
        <div class="kappa-readout" id="kappaVal">kappa <b>1.4</b></div>
        <div class="opt-actions">
          <label class="iter-label">Iterations <input class="iter-input" id="iterN" type="number" min="1" max="12" value="6"></label>
          <button class="run-iter" id="runIter">Run iterations</button>
        </div>
        <div class="opt-readout" id="optReadout">No samples yet. Run a few iterations and the best result updates as STOCHOS picks each next point.</div>`;
      host.appendChild(wrap);

      // goal chips: set the objective direction (drives the field marker)
      const goalRow = wrap.querySelector('#goalRow');
      goalOpts.forEach((opt) => {
        const c = document.createElement('button');
        c.className = 'choice-chip goal-chip';
        c.dataset.value = opt.value;
        c.innerHTML = `<span class="chip-label">${opt.label}</span>`;
        c.onclick = () => {
          goalRow.querySelectorAll('.goal-chip').forEach((g) => g.classList.toggle('on', g === c));
          lastChoice.goal = opt.value;
          if (field.setGoal) field.setGoal(opt.value);
          addVar('bayesian_opt_init', 'goal', 'str', DASH, opt.value);
          log(`bayesian_opt_init: objective goal = ${opt.value}`);
        };
        goalRow.appendChild(c);
      });
      const gdef = goalFor(story, out);
      (goalRow.querySelector(`.goal-chip[data-value="${gdef}"]`) || goalRow.firstChild).click();

      const slider = wrap.querySelector('#kappa');
      const kVal = wrap.querySelector('#kappaVal');
      const setK = () => {
        const k = parseFloat(slider.value);
        kVal.innerHTML = `kappa <b>${k.toFixed(1)}</b>`;
        lastChoice.strategy = k;
        if (field.setStrategy) field.setStrategy(k);
      };
      slider.oninput = setK;
      setK();

      let running = false;
      wrap.querySelector('#runIter').onclick = async () => {
        if (running) return;
        running = true;
        const mySeq = stepSeq;   // cancel the run if the user leaves this step
        const btn = wrap.querySelector('#runIter');
        btn.disabled = true; btn.classList.add('busy');
        const n = Math.max(1, Math.min(12, parseInt(wrap.querySelector('#iterN').value || '6', 10)));
        const out2 = lastChoice.output || story.defaultOutput;
        const outLabel = labelFor(surrogate, out2);
        const goal = lastChoice.goal || goalFor(story, out2);
        const readout = wrap.querySelector('#optReadout');
        let best = null;
        for (let i = 0; i < n; i++) {
          if (mySeq !== stepSeq || !resultHost.isConnected) break;  // left the step / unmounted
          let r = null;
          if (field.step) r = await field.step();
          if (r && (best == null || better(r, best, goal))) best = r;
          if (r) {
            addVar(`bayesian_opt #${i + 1}`, 'X_next', 'ndarray', `(1, ${surrogate.inputs.length})`,
              `[${fmt(r.x, 2)}, ${fmt(r.y, 2)}, ...]`);
            const confTxt = r.conf != null ? `${fmt(r.conf, 0)}%` : 'n/a';
            readout.innerHTML = `Iteration <b>${i + 1}</b> of ${n} &nbsp; best ${outLabel} <b>${fmt((best || r).mean, 2)}</b> &nbsp; confidence <b>${confTxt}</b>`;
            log(`bayesian_opt: sampled ${out2}=${fmt(r.mean, 2)} at (${fmt(r.x, 2)}, ${fmt(r.y, 2)}), conf ${confTxt}`);
          }
          await delay(450);
        }
        if (best && mySeq === stepSeq) {
          readout.innerHTML = `Run complete. Best ${outLabel} so far <b>${fmt(best.mean, 2)}</b> at (${fmt(best.x, 2)}, ${fmt(best.y, 2)}). The uncertainty fog has thinned around the points it sampled.`;
        }
        btn.disabled = false; btn.classList.remove('busy');
        running = false;
      };
    }

    // -------- map a decision to the renderer + the Variables dock ----
    function applyChoice(stepId, key, value, opt) {
      lastChoice[key] = value;
      const meta = stepMeta(story, stepId);
      const out = lastChoice.output || story.defaultOutput;

      if (key === 'budget') {
        const n = resolveBudget(story, value);
        if (field.setBudget) field.setBudget(n);
        const shown = n === 0 ? (surrogate.trainPoints.length) : n;
        addVar('excel_reader', 'data_array', 'ndarray (float64)',
          `(${shown}, ${surrogate.inputs.length + surrogate.outputs.length})`,
          `${shown} runs loaded`);
        log(`excel_reader: loaded ${shown} training runs (budget=${value})`);
      } else if (key === 'output') {
        if (field.setOutput) field.setOutput(value);
        const o = surrogate.outputs.find((x) => x.name === value);
        addVar('train_test_split', 'Y_target', 'column', '(1,)',
          `${o ? (o.label || o.name) : value}${o && o.unit ? ' [' + o.unit + ']' : ''}`);
        log(`train_test_split: target = ${value}`);
      } else if (key === 'transform') {
        // cosmetic, honestly labeled: the same trained surface either way.
        if (field.setStage) field.setStage('field');
        addVar('dimgp_regr_fit', 'model', 'DIM-GP', DASH,
          `fitted, power_transform=${value === 'on'}`);
        log(`dimgp_regr_fit: surface revealed (power_transform=${value === 'on'})`);
      } else if (key === 'ci') {
        const z = CI_Z[value] || 1.96;
        if (field.setCI) field.setCI(z);
        const { r2, rmse } = scoreFit(surrogate, out);
        addVar('pam_regr', 'pam_r2', 'float', DASH, fmt(r2, 3));
        addVar('', 'rmse', 'float', DASH, fmt(rmse, 3));
        const sc = $('#inspDecision').querySelector('.fit-score');
        const html = `<span>R&sup2; <b>${fmt(r2, 3)}</b></span><span>RMSE <b>${fmt(rmse, 3)}</b></span><span>CI <b>${value}%</b> (z ${z})</span>`;
        if (sc) sc.innerHTML = html;
        else {
          const div = document.createElement('div');
          div.className = 'fit-score';
          div.innerHTML = html;
          $('#inspDecision').appendChild(div);
        }
        // pred-vs-true mini scatter (real: predict at each measured run)
        const vhost = $('#inspDecision');
        let viz = vhost.querySelector('.validate-viz');
        if (!viz) {
          viz = document.createElement('div');
          viz.className = 'validate-viz';
          viz.innerHTML = '<div class="vv-title">Predicted vs measured</div><canvas class="validate-scatter" width="252" height="120"></canvas>';
          vhost.appendChild(viz);
        }
        drawPredTrue(viz.querySelector('canvas'), surrogate, out);
        log(`pam_regr: R2=${fmt(r2, 3)}, RMSE=${fmt(rmse, 3)} at ${value}% CI (z=${z})`);
      }
      // surface the "what changed" copy for this step
      if (meta.changed) $('#inspChanged').textContent = meta.changed;
    }

    // -------- the analyze branch: a real readout chart, per industry ----
    function renderBranchDecision(host, br) {
      host.innerHTML = '';
      const lab = document.createElement('div');
      lab.className = 'decision-label';
      lab.textContent = (br.decision && br.decision.label) || `Read the ${br.kind}`;
      host.appendChild(lab);
      const opts = (br.decision && br.decision.options) || branchControl(br.kind, story, surrogate);
      if (opts && opts.length) {
        const chipRow = document.createElement('div');
        chipRow.className = 'chip-row';
        opts.forEach((opt) => {
          const chip = document.createElement('button');
          chip.className = 'choice-chip';
          chip.dataset.value = opt.value;
          chip.innerHTML = `<span class="chip-label">${opt.label}</span>${opt.hint ? `<span class="chip-hint">${opt.hint}</span>` : ''}`;
          chip.onclick = () => {
            chipRow.querySelectorAll('.choice-chip').forEach((c) => c.classList.toggle('on', c === chip));
            lastChoice.branch = opt.value;
            drawBranch(br, opt.value);
          };
          chipRow.appendChild(chip);
        });
        host.appendChild(chipRow);
        const firstChip = chipRow.querySelector('.choice-chip');
        if (firstChip) firstChip.click();
      } else {
        drawBranch(br, null);
      }
      if (br.changed) $('#inspChanged').textContent = br.changed;
    }

    // Render the branch chart into .studio-branch from REAL surrogate numbers.
    function drawBranch(br, controlValue) {
      branchPanel.hidden = false;
      $('#branchTitle').textContent = br.title || br.label || 'Analysis';
      const cv = $('#branchChart');
      const legend = $('#branchLegend');
      legend.innerHTML = '';
      const out = lastChoice.output || story.defaultOutput;
      try {
        if (br.kind === 'tornado') {
          const items = tornadoItems(surrogate, story, controlValue || out);
          if (Charts.drawTornado) Charts.drawTornado(cv, items);
          else fallbackBars(cv, items.map((i) => ({ label: i.label, v: i.importance })));
          legend.innerHTML = items.map((i) => `<span class="lg-row"><b>${i.label}</b> ${fmt(i.importance * 100, 0)}%</span>`).join('');
          log(`${br.node}: ranked axis influence on ${controlValue || out}`);
        } else if (br.kind === 'pareto') {
          const pair = paretoPair(story, controlValue);
          const points = paretoPoints(surrogate, pair);
          if (Charts.drawPareto) Charts.drawPareto(cv, points, {
            aLabel: labelFor(surrogate, pair[0]), bLabel: labelFor(surrogate, pair[1]),
            aGoal: goalFor(story, pair[0]), bGoal: goalFor(story, pair[1]),
          });
          else fallbackScatter(cv, points);
          legend.innerHTML = `<span class="lg-row"><b>${labelFor(surrogate, pair[0])}</b> vs <b>${labelFor(surrogate, pair[1])}</b>, front highlighted</span>`;
          log(`${br.node}: Pareto front of ${pair[0]} vs ${pair[1]} (${points.length} grid samples)`);
        } else { // correlation
          const pairs = correlationPairs(surrogate, story);
          if (Charts.drawCorrelation) Charts.drawCorrelation(cv, pairs);
          else fallbackBars(cv, pairs.map((p) => ({ label: p.label, v: Math.abs(p.r) })));
          legend.innerHTML = pairs.map((p) => `<span class="lg-row"><b>${p.label}</b> r ${fmt(p.r, 2)}</span>`).join('');
          log(`${br.node}: Pearson r across ${pairs.length} output pairs`);
        }
      } catch (e) {
        legend.innerHTML = `<span class="lg-row">Chart unavailable (${e.message})</span>`;
      }
    }

    // -------- run a step's model effect (shared by drag + escape hatches) ----
    function runEffect(stepId) {
      const step = steps.find((s) => s.id === stepId);
      const meta = stepMeta(story, stepId);
      if (stepId === 'analyze') {
        renderBranchDecision($('#inspDecision'), branch);
      } else if (stepId === 'deploy') {
        $('#inspDecision').innerHTML = '';
        $('#inspChanged').textContent = meta.changed || '';
        revealDeploy(story, surrogate, field);
      } else {
        renderDecision(stepId, meta.decision);
      }
    }

    // ---------------------------------------------------- step transitions ----
    // The v2 progress rail is gone; the Agent chat is the guide. setActiveStep is
    // kept as a stub so the autobuild path and enterStep can call it unchanged.
    function setActiveStep(i) { /* rail removed; guidance lives in the Agent chat */ }

    async function enterStep(i) {
      stepSeq++;   // cancels any in-flight optimize run from the step we are leaving
      current = i;
      clearTimeout(idleTimer);
      const step = steps[i];
      const meta = stepMeta(story, step.id);
      const nextBtn = $('#inspNext');
      if (nextBtn) nextBtn.disabled = true;       // locked until this node is wired

      // advance the renderer stage per the contract progression (analyze == objective)
      const stageFor = { data: 'data', target: 'data', fit: 'field', validate: 'validate', analyze: 'objective', optimize: 'optimize', deploy: 'optimize' };
      if (field.setStage) field.setStage(stageFor[step.id]);

      setActiveStep(i);

      // inspector copy (branch step pulls its copy from story.branch)
      const isBranch = step.id === 'analyze';
      $('#inspKicker').textContent = meta.kicker || `Step ${i + 1} of ${steps.length}`;
      $('#inspTitle').textContent = (isBranch ? (branch.title || branch.label) : meta.title) || step.id;
      $('#inspChanged').textContent = '';
      $('#inspWhy').textContent = (isBranch ? branch.why : meta.why) || '';
      $('#inspDecision').innerHTML = '';

      // the branch chart is the analyze step's payoff; hide it elsewhere so the
      // optimize step's acquisition view and the deploy preview are not crowded
      if (step.id !== 'analyze') branchPanel.hidden = true;

      // light the palette node this step wants, prime the slot, arm the idle hint
      hintPalette(step.id);
      armIdle(step.id);

      // Clear any prior guide card so only one message is shown at a time (Fix 4 + 5)
      chatEl.querySelectorAll('.sf-autobuild-guide').forEach((el) => el.remove());
      // Story beat: one clear instruction - what to do right now (Fix 5)
      beat(`Now: drag the ${step.label} node from the palette onto the "${step.slot}" slot. Then wire its input port.`);

      // escape hatch: per-step "connect for me"
      const connectBtn = $('#btnConnect');
      connectBtn.style.display = (i >= steps.length) ? 'none' : '';
      connectBtn.disabled = false;
      connectBtn.onclick = () => connectForMe(step.id);

      // Next button wiring (disabled until the node is wired; see completeStep)
      const next = $('#inspNext');
      if (i >= steps.length - 1) {
        next.textContent = 'Restart workflow';
        next.onclick = () => { mountStudio(root); };
      } else {
        next.textContent = 'Next';
        next.onclick = () => { if (!placing) enterStep(i + 1); };
      }

      // If this node was already built (revisiting), reflect completion immediately.
      if (nodes[step.id].placed && nodes[step.id].el.classList.contains('done')) {
        runEffect(step.id);
        completeStep(step.id);
      }
    }

    // called once a node is placed + wired: unlock Next, clear the per-step hint
    function completeStep(stepId) {
      const i = indexOfStep(stepId);
      if (i !== current) return; // only the active step controls Next
      clearTimeout(idleTimer);
      clearHints();
      const next = $('#inspNext');
      if (next) next.disabled = false;
    }

    // ----- pulse the palette node the current step wants; prime its slot -----
    function hintPalette(stepId) {
      clearHints();
      const n = nodes[stepId];
      const pn = stage.querySelector(`.pal-node[data-node="${n.node}"]`);
      if (pn) {
        pn.classList.add('hint');
        // Defensive: a generic global ".hint" rule (a floating tooltip) sets
        // position:absolute + pointer-events:none, which would rip the palette
        // node out of its column. Pin it in flow inline so it stays grabbable
        // until design-polish ships the specific .pal-node.hint rule (which wins
        // by specificity and animates the pulse). Inline beats the generic rule.
        pn.style.position = 'relative';
        pn.style.pointerEvents = 'auto';
      }
      if (n.ghost && !n.placed) n.ghost.classList.add('want');
    }
    function clearHints() {
      stage.querySelectorAll('.pal-node.hint').forEach((p) => {
        p.classList.remove('hint');
        p.style.position = '';
        p.style.pointerEvents = '';
      });
      stage.querySelectorAll('.studio-ghost.want').forEach((g) => g.classList.remove('want'));
    }
    function armIdle(stepId) {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (indexOfStep(stepId) !== current) return;
        const n = nodes[stepId];
        // Update the single beat bubble with a nudge, then stop (no re-arm):
        // one reminder per step is enough; the palette pulse is the persistent hint.
        if (!n.placed) beat(`Stuck? Grab the pulsing ${n.label} node from the palette and drop it on the "${n.slot}" slot. Or tap "Connect for me."`)
        else if (!n.el.classList.contains('done')) beat(`Node placed. Now wire it: drag from the green output port of the upstream node into the ${n.label} input port.`);
      }, 8000);
    }

    // ------------------------------ palette drag ------------------------------
    // Pointer-drag a node from the palette. A floating ghost follows the cursor;
    // dropping it over the CURRENT step's matching slot snaps the node in. A wrong
    // node or wrong slot springs back with a one-line hint.
    function buildPaletteDrag() {
      stage.querySelectorAll('.pal-node').forEach((pn) => {
        pn.addEventListener('pointerdown', (e) => startPaletteDrag(e, pn));
      });
    }
    function startPaletteDrag(e, pn) {
      if (placing) return;
      e.preventDefault();
      const nodeName = pn.dataset.node;
      pn.classList.add('dragging');
      const fly = pn.cloneNode(true);
      fly.classList.add('pal-fly');
      fly.classList.remove('hint', 'dragging');
      Object.assign(fly.style, { position: 'fixed', pointerEvents: 'none', zIndex: 9999, opacity: '0.92', width: pn.offsetWidth + 'px' });
      document.body.appendChild(fly);
      const move = (ev) => {
        fly.style.left = (ev.clientX - 30) + 'px';
        fly.style.top = (ev.clientY - 22) + 'px';
        // glow the current step's slot if we hover it with the right node
        const slot = nodes[steps[current].id].ghost;
        const over = slot && hitGhost(slot, ev.clientX, ev.clientY);
        stage.querySelectorAll('.studio-ghost.target').forEach((g) => g.classList.remove('target'));
        if (over && nodeName === steps[current].node) slot.classList.add('target');
      };
      const up = (ev) => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        pn.classList.remove('dragging');
        fly.remove();
        stage.querySelectorAll('.studio-ghost.target').forEach((g) => g.classList.remove('target'));
        const step = steps[current];
        const slot = nodes[step.id].ghost;
        const over = slot && hitGhost(slot, ev.clientX, ev.clientY);
        if (over && nodeName === step.node && !nodes[step.id].placed) {
          placeNode(step.id);
          clearHints();
          if (nodes[step.id].inN === 0) {
            // a source node (Excel Reader) has no input to wire: complete it on place
            wireNode(step.id);
          } else {
            beat(`${step.label} placed. Now wire its input: drag from the upstream output port.`);
          }
        } else if (over && nodeName !== step.node) {
          beat(`That slot wants the ${step.label} node. Grab the pulsing one in the palette.`);
        } else if (nodeName === step.node && !over) {
          beat(`Drop the ${step.label} node onto its ${step.slot} slot (the dashed outline that is glowing).`);
        }
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    }
    function hitGhost(g, cx, cy) {
      const r = g.getBoundingClientRect();
      const pad = 40;
      return cx >= r.left - pad && cx <= r.right + pad && cy >= r.top - pad && cy <= r.bottom + pad;
    }

    // ------------------------------ port wiring -------------------------------
    // Drag from a placed node's OUTPUT port to a compatible INPUT port. While
    // dragging, a rubber-band wire follows the cursor and compatible input ports
    // glow. Releasing near one connects + wires the downstream node.
    function bindPorts(n) {
      if (!n.el) return;
      const ports = n.el.querySelectorAll('.port');
      ports.forEach((p, idx) => {
        // outputs are the right-side ports (index >= inN)
        const isOut = idx >= n.inN;
        if (!isOut) return;
        p.dataset.role = 'out';
        p.addEventListener('pointerdown', (e) => startWire(e, n));
      });
    }
    function startWire(e, fromNode) {
      if (placing) return;
      e.preventDefault();
      e.stopPropagation();
      // which downstream node consumes fromNode and is the CURRENT step?
      const target = downstreamTarget(fromNode.id);
      // glow every compatible input port (the current step's node, if placed)
      const compatible = [];
      if (target && nodes[target.id].el) {
        const ins = nodes[target.id].el.querySelectorAll('.port');
        const ip = ins[target.port];
        if (ip) { ip.classList.add('compatible'); compatible.push(ip); }
      }
      dragWire.style.display = '';
      const s = port(fromNode, 'out', 0);
      const move = (ev) => {
        const pt = toGraph(ev.clientX, ev.clientY);
        const dx = Math.max(40, Math.abs(pt.x - s.x) * 0.5);
        dragWire.setAttribute('d', `M ${s.x},${s.y} C ${s.x + dx},${s.y} ${pt.x - dx},${pt.y} ${pt.x},${pt.y}`);
      };
      const up = (ev) => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        dragWire.style.display = 'none';
        dragWire.setAttribute('d', '');
        compatible.forEach((c) => c.classList.remove('compatible'));
        // did we release near a compatible input port?
        let hit = null;
        compatible.forEach((c) => {
          const r = c.getBoundingClientRect();
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          if (Math.hypot(ev.clientX - cx, ev.clientY - cy) < 46) hit = c;
        });
        if (hit && target && !nodes[target.id].el.classList.contains('done')) {
          wireNode(target.id);
        } else if (target && nodes[target.id].placed) {
          beat(`Release on the ${nodes[target.id].label} input port to connect the wire.`);
        }
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
      move(e);
    }
    // which node should consume fromNode's output as the CURRENT step?
    function downstreamTarget(fromId) {
      const step = steps[current];
      const links = FLOW_LINKS[step.id] || [];
      const idx = links.indexOf(fromId);
      if (idx >= 0 && nodes[step.id].placed) return { id: step.id, port: idx };
      return null;
    }
    function toGraph(cx, cy) {
      const r = graph.getBoundingClientRect();
      return { x: cx - r.left, y: cy - r.top };
    }

    // move a placed node (mirror flow.js enableDrag, scoped to the graph)
    function bindNodeDrag(n) {
      const card = n.el.querySelector('.snode-card');
      if (!card) return;
      card.addEventListener('pointerdown', (e) => {
        if (e.target.classList.contains('port')) return; // ports start wires
        const r = graph.getBoundingClientRect();
        let ox = e.clientX - r.left - n.x, oy = e.clientY - r.top - n.y;
        const move = (ev) => {
          const rr = graph.getBoundingClientRect();
          n.x = ev.clientX - rr.left - ox; n.y = ev.clientY - rr.top - oy;
          n.el.style.left = n.x + 'px'; n.el.style.top = n.y + 'px';
          drawEdges();
        };
        const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
        e.preventDefault();
      });
    }

    // --------------------------- escape hatches -------------------------------
    // Per-step: auto-place + auto-wire the CURRENT node via the same code paths.
    async function connectForMe(stepId) {
      if (placing) return;
      placing = true;
      $('#inspNext').disabled = true;
      $('#btnConnect').disabled = true;
      const n = nodes[stepId];
      if (!n.placed) { placeNode(stepId); beat(`Placing ${n.label}.`); await delay(220); }
      if (!n.el.classList.contains('done')) await wireNode(stepId);
      placing = false;
      $('#btnConnect').disabled = false;
    }

    // Global: finish ALL remaining nodes, agent-style (place, then wire, ~220ms
    // apart, streaming a short line to the Console). Runs silently (no per-step
    // beat messages) then shows ONE concise end-guide in the Agent chat.
    async function autobuild() {
      if (placing) return;
      placing = true;
      const btn = $('#btnAutobuild');
      btn.disabled = true; btn.classList.add('busy');
      // Clear any existing beat bubble so the chat is quiet during assembly
      resetGuide();
      log('agent: auto-assembling workflow...');
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        const n = nodes[s.id];
        if (n.el && n.el.classList.contains('done')) continue;
        current = i; setActiveStep(i);
        const stageFor = { data: 'data', target: 'data', fit: 'field', validate: 'validate', analyze: 'objective', optimize: 'optimize', deploy: 'optimize' };
        if (field.setStage) field.setStage(stageFor[s.id]);
        const meta = stepMeta(story, s.id);
        const isBranch = s.id === 'analyze';
        $('#inspKicker').textContent = meta.kicker || `Step ${i + 1} of ${steps.length}`;
        $('#inspTitle').textContent = (isBranch ? (branch.title || branch.label) : meta.title) || s.id;
        $('#inspWhy').textContent = (isBranch ? branch.why : meta.why) || '';
        if (!n.placed) { placeNode(s.id); log(`agent: placed ${s.node}`); await delay(180); }
        log(`agent: wired ${s.node}`);
        await wireNode(s.id, true, true);  // silent=true suppresses per-step beats
        await delay(180);
      }
      current = steps.length - 1;
      setActiveStep(current);
      completeStep(steps[current].id);
      const next = $('#inspNext');
      next.textContent = 'Restart workflow';
      next.onclick = () => { mountStudio(root); };
      next.disabled = false;
      btn.disabled = false; btn.classList.remove('busy');
      // ONE concise end-guide: what was built and what to explore next
      const branchLabel = branch.label || 'Analysis';
      showAutobuildGuide(
        `<strong>Workflow assembled.</strong> Here is what you can explore now:<br>` +
        `<br>` +
        `<strong>DIM-GP Surface</strong> (top-right viewer) - the trained response surface for the target you selected. Color is the predicted value; the fog is model uncertainty.<br>` +
        `<br>` +
        `<strong>${branchLabel}</strong> (second viewer) - the per-industry readout: ${branch.story || 'see how the inputs and outputs relate.'}<br>` +
        `<br>` +
        `<strong>Variables / Console</strong> (bottom dock) - every decision your workflow made, logged. Switch the tab to see the variable table.<br>` +
        `<br>` +
        `Use the <em>kappa</em> slider in the Optimizer step to balance exploration vs exploitation, then run more iterations to watch the fog thin.`
      );
      placing = false;
    }

    // Show a single auto-build end-guide card in the chat, replacing any prior beat.
    function showAutobuildGuide(html) {
      // Remove old beat and any prior guide
      chatEl.querySelectorAll('.sf-beat-single, .sf-autobuild-guide').forEach((el) => el.remove());
      const card = document.createElement('div');
      card.className = 'sf-msg sf-autobuild-guide';
      card.innerHTML = html;
      chatEl.appendChild(card);
      chatEl.scrollTop = chatEl.scrollHeight;
    }

    // ------------------------------ wire up UI --------------------------------
    buildPalette($('#palette'), story, steps);
    buildPaletteDrag();
    $('#btnAutobuild').onclick = autobuild;

    // reset interaction on any pointer activity in the stage (idle hint)
    stage.addEventListener('pointerdown', () => { if (!placing) armIdle(steps[current].id); });

    // kick off the state machine at step 0
    enterStep(0);

    // -------- intro + tour (AFTER the industry is picked) ----
    const tourSteps = [
      { target: '#palette', place: 'right', title: 'The node library', body: 'Every STOCHOS capability is a node. The one the current step needs pulses. Drag it onto its slot on the canvas.' },
      { target: '#graph', place: 'bottom', title: 'Build the workflow', body: 'Dashed slots are a blueprint. Drag each node into its slot, then drag a wire from the upstream output port to the new input port. Edges glow green as data flows.' },
      { target: '#result', place: 'top', title: 'The live model', body: 'This DIM-GP Surface is real output. Color is the prediction, the fog is the model uncertainty. It updates with every node you wire.' },
      { target: '#agent', place: 'left', title: 'Make the call', body: 'The Agent guides each step and asks you the real decision here, and you can let it connect a node or build the rest for you any time.' },
      { target: '.sf-toolbar', place: 'bottom', title: 'Seven steps to a deployed app', body: 'From raw runs to a deployable web app, with a per-industry analysis at step five. Press the green Run to let the agent assemble it.' },
    ];
    // M5 fix: skip the intro modal when arriving from a challenge build.
    // When challengeCtx was present, the user already knows how the builder works
    // (they came from the challenge flow). The intro-modal covers the entire stage
    // including the challenge "See the showdown" return banner (#chReturn).
    // Only show the intro for plain (non-challenge) studio visits.
    if (!challengeCtx) {
      showIntro(root, {
        eyebrow: 'Stochos Flow · build it yourself',
        title: `Build a ${(story.tag || domain).toLowerCase()} workflow, node by node.`,
        body: 'You will drag each node into place and wire its ports, then make a real decision. The Confidence Field and Variables dock are live DIM-GP output, not a canned animation.',
        tourLabel: 'Show me how it works (40s)',
        onTour: () => new Tour(tourSteps).start(),
        onExplore: () => {},
      });
    }
  }

  // M3 fix: return a teardown to main.js so it can remove the resize listener and
  // destroy the field when the user navigates away from #/studio via the site nav.
  // The teardown uses _onResize (outer-scoped) so it always targets the live listener
  // from the most recent buildStage call. If the user is still on the picker (no
  // buildStage called yet), _onResize is null and the teardown is a safe no-op.
  return {
    destroy() {
      if (_onResize) { window.removeEventListener('resize', _onResize); _onResize = null; }
      if (root._studioField && root._studioField.destroy) {
        try { root._studioField.destroy(); } catch (_e) {}
        root._studioField = null;
      }
    },
  };
}

// ============================ deploy preview ==============================
// A mini "deployed web app": 2 axis sliders -> live surrogate.predict, shown as
// mean +/- z*std as a labeled band, plus a real-looking (non-functional) Download.
function revealDeploy(story, surrogate, field) {
  const studio = document.querySelector('.sf-app') || document.querySelector('.studio');
  if (!studio) return;
  // Mount the "Web App" output viewer inside the center column so it docks over the
  // black canvas like a real Flow plot window. Falls back to the app root.
  const host = studio.querySelector('.sf-center') || studio;
  let panel = studio.querySelector('.studio-deploy');
  if (panel) panel.remove();
  panel = document.createElement('div');
  panel.className = 'sf-viewer studio-deploy';

  // report the TARGET the user actually chose at step 2 (field.name), not the default
  const out = (field && field.name) || story.defaultOutput;
  const o = surrogate.outputs.find((x) => x.name === out) || surrogate.outputs[0];
  const outName = o ? o.name : out;
  const outLabel = o ? (o.label || o.name) : out;
  const outUnit = o && o.unit ? o.unit : '';
  const z = 1.96;

  const sliders = (story.deploy && story.deploy.sliders) || story.axes || [];
  const inputs = sliders.map((name) => surrogate.inputs.find((i) => i.name === name)).filter(Boolean);

  panel.innerHTML = `
    <div class="sf-viewer-bar"><span class="sf-viewer-title">Web App</span></div>
    <div class="deploy-head">
      <span class="deploy-badge">Deployed web app preview</span>
      <button class="deploy-close" id="depClose" aria-label="Close preview" title="Close preview">×</button>
      <h3>${(story.deploy && story.deploy.appName) || 'STOCHOS Predictor'}</h3>
      <p class="deploy-blurb">${(story.deploy && story.deploy.blurb) || 'Move the inputs, read the prediction with its confidence band.'}</p>
    </div>
    <div class="deploy-body">
      <div class="deploy-controls" id="depCtl"></div>
      <div class="deploy-out">
        <div class="deploy-out-label">${outLabel}${outUnit ? ` (${outUnit})` : ''}</div>
        <div class="deploy-out-val"><b id="depMean">--</b> <span class="deploy-band" id="depBand"></span></div>
        <div class="deploy-bar"><div class="deploy-bar-fill" id="depFill"></div><div class="deploy-bar-band" id="depBarBand"></div></div>
        <div class="deploy-note">Mean and 95% confidence band, live from the trained DIM-GP.</div>
      </div>
    </div>
    <div class="deploy-foot">
      <button class="deploy-download" id="depDl">Download web app</button>
      <span class="deploy-disclaimer">Preview only. The export button is illustrative.</span>
    </div>`;
  host.appendChild(panel);
  requestAnimationFrame(() => panel.classList.add('show'));
  panel.querySelector('#depClose').onclick = () => {
    panel.classList.remove('show'); setTimeout(() => panel.remove(), 240);
  };

  const ctl = panel.querySelector('#depCtl');
  const state = {};
  inputs.forEach((inp) => {
    state[inp.name] = inp.default != null ? inp.default : (inp.min + inp.max) / 2;
    const row = document.createElement('div');
    row.className = 'deploy-slider';
    const step = (inp.max - inp.min) / 100 || 0.01;
    row.innerHTML = `
      <label>${inp.label || inp.name}${inp.unit ? ` (${inp.unit})` : ''}</label>
      <input type="range" min="${inp.min}" max="${inp.max}" step="${step}" value="${state[inp.name]}">
      <output class="deploy-slider-val">${fmt(state[inp.name], 2)}</output>`;
    const slider = row.querySelector('input');
    const valEl = row.querySelector('output');
    slider.oninput = () => {
      state[inp.name] = parseFloat(slider.value);
      valEl.textContent = fmt(state[inp.name], 2);
      recompute();
    };
    ctl.appendChild(row);
  });

  const meanEl = panel.querySelector('#depMean');
  const bandEl = panel.querySelector('#depBand');
  const fillEl = panel.querySelector('#depFill');
  const barBand = panel.querySelector('#depBarBand');
  const ax = story.axes || [];
  function recompute() {
    const x = state[ax[0]] != null ? state[ax[0]] : surrogate.axisInput(0).default;
    const y = state[ax[1]] != null ? state[ax[1]] : surrogate.axisInput(1).default;
    // The deployed app reports the TRAINED model's predictive uncertainty, not the
    // transient acquisition scratch state, so predict against the base field (no
    // active-learning shrink from the optimize step's virtual samples).
    const saved = surrogate.samples;
    surrogate.samples = [];
    const { mean, std } = surrogate.predict(outName, x, y);
    surrogate.samples = saved;
    const band = z * std;
    meanEl.textContent = fmt(mean, 2);
    bandEl.textContent = `+/- ${fmt(band, 2)}${outUnit ? ' ' + outUnit : ''}`;
    const st = surrogate.stats(outName);
    const span = (st.mx - st.mn) || 1;
    const pct = Math.max(0, Math.min(1, (mean - st.mn) / span));
    const bandPct = Math.max(0, Math.min(0.5, band / span));
    fillEl.style.width = `${pct * 100}%`;
    barBand.style.left = `${Math.max(0, (pct - bandPct) * 100)}%`;
    barBand.style.width = `${Math.min(100, bandPct * 200)}%`;
  }
  recompute();
  panel.querySelector('#depDl').onclick = (e) => { e.preventDefault(); };
}

// ============================ branch math (real) ==========================
// tornado: per-axis influence on the target = normalized range of the target along
// that axis, the other axis held at mid (mirrors flow.js drawBars).
function tornadoItems(surrogate, story, outName) {
  const out = (surrogate.outputs.find((o) => o.name === outName)) ? outName : story.defaultOutput;
  const gx = surrogate.grid.x, gy = surrogate.grid.y;
  const mid0 = gx[gx.length >> 1], mid1 = gy[gy.length >> 1];
  const rng = (arr) => Math.max(...arr) - Math.min(...arr);
  const r0 = rng(gx.map((x) => surrogate.predict(out, x, mid1).mean));
  const r1 = rng(gy.map((y) => surrogate.predict(out, mid0, y).mean));
  const a0 = surrogate.axisInput(0), a1 = surrogate.axisInput(1);
  const tot = (r0 + r1) || 1;
  return [
    { label: a0.label || a0.name, importance: r0 / tot },
    { label: a1.label || a1.name, importance: r1 / tot },
  ].sort((p, q) => q.importance - p.importance);
}

// pareto: for each grid node compute (a, b) for the two competing outputs. Real
// trade-off from the two exported fields.
function paretoPoints(surrogate, pair) {
  const [an, bn] = pair;
  const gx = surrogate.grid.x, gy = surrogate.grid.y;
  const pts = [];
  const stepI = Math.max(1, Math.floor(gx.length / 22));
  const stepJ = Math.max(1, Math.floor(gy.length / 22));
  for (let j = 0; j < gy.length; j += stepJ)
    for (let i = 0; i < gx.length; i += stepI) {
      const a = surrogate.predict(an, gx[i], gy[j]).mean;
      const b = surrogate.predict(bn, gx[i], gy[j]).mean;
      pts.push({ a, b });
    }
  // mark the non-dominated (both-minimized) front so a fallback chart can show it too
  pts.forEach((p) => {
    p.front = !pts.some((q) => q !== p && q.a <= p.a && q.b <= p.b && (q.a < p.a || q.b < p.b));
  });
  return pts;
}

// correlation: Pearson r between output pairs across grid samples. Real from the
// exported fields. Returns the strongest pairs first.
function correlationPairs(surrogate, story) {
  const outs = (story.outputs || surrogate.outputs.map((o) => o.name)).filter((n) => surrogate.fields[n]);
  const gx = surrogate.grid.x, gy = surrogate.grid.y;
  const stepI = Math.max(1, Math.floor(gx.length / 18));
  const stepJ = Math.max(1, Math.floor(gy.length / 18));
  // collect a value vector per output across the sampled grid
  const vecs = {};
  outs.forEach((n) => { vecs[n] = []; });
  for (let j = 0; j < gy.length; j += stepJ)
    for (let i = 0; i < gx.length; i += stepI)
      outs.forEach((n) => { vecs[n].push(surrogate.predict(n, gx[i], gy[j]).mean); });
  const pairs = [];
  for (let a = 0; a < outs.length; a++)
    for (let b = a + 1; b < outs.length; b++) {
      const r = pearson(vecs[outs[a]], vecs[outs[b]]);
      pairs.push({ label: `${labelFor(surrogate, outs[a])} / ${labelFor(surrogate, outs[b])}`, a: outs[a], b: outs[b], r });
    }
  return pairs.sort((p, q) => Math.abs(q.r) - Math.abs(p.r)).slice(0, 6);
}

function pearson(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (!n) return 0;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  const d = Math.sqrt(sxx * syy);
  return d ? sxy / d : 0;
}

// the two competing outputs for the engineering pareto (defaults to the first two
// 'low'-goal outputs, e.g. peak_temp vs pressure_drop).
function paretoPair(story, controlValue) {
  const outs = story.outputs || [];
  if (controlValue && controlValue.includes('|')) return controlValue.split('|');
  const lows = outs.filter((n) => goalFor(story, n) === 'low');
  if (lows.length >= 2) return [lows[0], lows[1]];
  return [outs[0], outs[1]];
}

// a small per-branch control list when stories supplies none (keeps the chart
// interactive). For tornado: which target to rank. For pareto: which pair.
function branchControl(kind, story, surrogate) {
  if (kind === 'tornado') {
    return (story.outputs || []).slice(0, 3).map((n) => ({ value: n, label: labelFor(surrogate, n) }));
  }
  if (kind === 'pareto') {
    const outs = story.outputs || [];
    const out = [];
    for (let a = 0; a < outs.length && out.length < 3; a++)
      for (let b = a + 1; b < outs.length && out.length < 3; b++)
        out.push({ value: `${outs[a]}|${outs[b]}`, label: `${labelFor(surrogate, outs[a])} vs ${labelFor(surrogate, outs[b])}` });
    return out;
  }
  return null; // correlation: no control, show the full matrix
}

// fallback charts (only used if studio-charts.js is missing one of its exports)
function fallbackBars(cv, items) {
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const w = cv.width, h = cv.height, pad = 20;
  ctx.clearRect(0, 0, w, h);
  const mx = Math.max(...items.map((i) => Math.abs(i.v)), 1e-9);
  const bh = (h - pad * 2) / items.length - 6;
  items.forEach((it, i) => {
    const y = pad + i * ((h - pad * 2) / items.length);
    ctx.fillStyle = '#ffb006';
    ctx.fillRect(pad, y, Math.abs(it.v) / mx * (w - pad * 2 - 40), bh);
    ctx.fillStyle = 'rgba(244,242,238,0.8)'; ctx.font = '10px ui-monospace';
    ctx.fillText((it.label || '').slice(0, 16), pad, y - 2);
  });
}
function fallbackScatter(cv, pts) {
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const w = cv.width, h = cv.height, pad = 22;
  ctx.clearRect(0, 0, w, h);
  if (!pts.length) return;
  let amn = Infinity, amx = -Infinity, bmn = Infinity, bmx = -Infinity;
  pts.forEach((p) => { amn = Math.min(amn, p.a); amx = Math.max(amx, p.a); bmn = Math.min(bmn, p.b); bmx = Math.max(bmx, p.b); });
  const sx = (v) => pad + (v - amn) / (amx - amn || 1) * (w - pad - 8);
  const sy = (v) => h - pad - (v - bmn) / (bmx - bmn || 1) * (h - pad - 8);
  pts.forEach((p) => {
    ctx.fillStyle = p.front ? '#ffb006' : 'rgba(156,152,144,0.5)';
    ctx.beginPath(); ctx.arc(sx(p.a), sy(p.b), p.front ? 3.4 : 2.2, 0, 7); ctx.fill();
  });
}

// ============================ small helpers ==============================
// The left node palette, in the real Flow shape: a search box, Export/Import Node +
// Open Nodes Folder buttons, then amber-triangle category groups (the real Flow
// category names) each with node rows (real names + icons mirrored from flow.js).
// The pipeline nodes keep their exact data-node so the state machine can pulse the
// one the current step needs; the per-industry branch node is always included.
function buildPalette(el, story, steps) {
  const branchStep = steps.find((s) => s.branch);
  el.innerHTML = `
    <div class="sf-search"><span class="sf-search-icon">&#128269;</span><input class="flow-search sf-search-input" placeholder="Search nodes..." /></div>
    <div class="sf-palbtns">
      <button class="sf-palbtn">Export Node</button>
      <button class="sf-palbtn">Import Node</button>
    </div>
    <button class="sf-palbtn sf-palbtn-wide"><span class="sf-folder">&#128193;</span> Open Nodes Folder</button>`;

  // amber-triangle categories using the real Flow category names. Each node row is
  // [data-node, label, icon, robot?]. Only icons that ship as SVGs are referenced.
  const lib = {
    Agents: [
      ['smart_data_loader', 'Smart Data Loader', 'smart_data_loader', true],
    ],
    Generative: [
      ['gen_model', 'Gen Model', 'python_solver', false, true],
    ],
    Input: [
      ['excel_reader', 'Excel Reader', 'excel_reader'],
      ['column_splitter', 'Column Splitter', 'column_splitter'],
      ['train_test_split', 'Train/Test Split', 'train_test_split'],
    ],
    Modelling: [
      ['dimgp_regr_fit', 'DIM-GP Fit', 'dimgp_fit'],
      ['dimgp_classification', 'DIM-GP Classification', 'dimgp_predict', false, true],
      ['pam_regr', 'PAM Validation', 'pam_regr'],
      ['sobol_indices', 'Sobol Indices', 'sobol_indices'],
      ['shap_values', 'SHAP Values', 'plot_bar'],
      ['bayesian_opt_init', 'BO Init', 'bo_init'],
      ['bayesian_opt', 'Next Sample', 'bo_next'],
      ['bayesian_opt_optimize', 'Optimize', 'bo_optimize'],
    ],
    Misc: [
      ['correlation_coefficients', 'Correlation Coefficients', 'plot_line'],
      ['plot_predicted_vs_observed', 'Pred vs Observed', 'plot_scatter'],
      ['python_solver', 'Python Solver', 'python_solver'],
      ['web_app_scalar', 'Web App Export', 'smart_data_loader'],
    ],
  };

  // make sure the per-industry branch node has a palette row (some branches reuse a
  // node already listed; only inject when it is missing).
  if (branchStep) {
    const present = Object.values(lib).some((rows) => rows.some((r) => r[0] === branchStep.node));
    if (!present) (lib.Misc).push([branchStep.node, branchStep.label, branchStep.icon]);
  }

  for (const cat in lib) {
    el.insertAdjacentHTML('beforeend', `<div class="pal-cat"><span class="pal-tri">&#9656;</span>${cat}</div>`);
    lib[cat].forEach(([node, label, icon, robot, sub]) => {
      const subEl = sub ? `<span class="pal-sub">&rsaquo;</span>` : '';
      const robotEl = robot ? `<span class="pal-robot">&#129302;</span>` : '';
      el.insertAdjacentHTML('beforeend',
        `<div class="pal-node" data-node="${node}">${subEl}<img src="${IC}${icon}.svg" alt="">${label}${robotEl}</div>`);
    });
  }
}

// A Flow node TILE: a rounded .snode-card with the icon filling it, port dots on
// left (in) / right (out) carrying data-role, an optional small text badge (FIT,
// INIT, NEXT, 70/30, ...), a green done-check, and the friendly label BELOW the
// tile. The green "built" border is applied by wireNode adding .done to .snode.
function renderNode(n, graph) {
  const el = document.createElement('div');
  el.className = 'snode';
  el.dataset.id = n.id;
  el.style.left = n.x + 'px';
  el.style.top = n.y + 'px';
  el.style.setProperty('--cat', CAT[n.cat] || '#888');
  let ports = '';
  for (let i = 0; i < n.inN; i++) ports += `<span class="port" data-role="in" style="left:1.5px;top:${(i + 1) / (n.inN + 1) * NH - 4.5}px"></span>`;
  for (let i = 0; i < n.outN; i++) ports += `<span class="port" data-role="out" style="left:${NW - 4.5}px;top:${(i + 1) / (n.outN + 1) * NH - 4.5}px"></span>`;
  const badge = NODE_BADGE[n.node];
  const badgeEl = badge ? `<span class="snode-tag">${badge}</span>` : '';
  el.innerHTML = `<div class="snode-card"><img src="${IC}${n.icon}.svg" alt="">${badgeEl}${ports}<div class="snode-badge">✓</div></div><div class="snode-label">${n.label || n.node}</div>`;
  graph.appendChild(el);
  n.el = el;
}

function port(n, kind, idx) {
  const count = kind === 'out' ? n.outN : n.inN;
  const cardLeft = n.x + 6;
  return { x: kind === 'out' ? cardLeft + NW - 6 : cardLeft, y: n.y + (idx + 1) / (count + 1) * NH };
}

// animated data packet along an edge, then leave the edge glowing green (live)
function packet(e, svg) {
  return new Promise((resolve) => {
    e.el.classList.add('running');
    const len = e.el.getTotalLength ? e.el.getTotalLength() : 0;
    if (!len) { e.el.classList.remove('running'); resolve(); return; }
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('r', '3.6');
    c.setAttribute('class', 'packet');
    svg.appendChild(c);
    const t0 = performance.now(), dur = 560;
    const stepFn = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      const pt = e.el.getPointAtLength(k * len);
      c.setAttribute('cx', pt.x); c.setAttribute('cy', pt.y);
      if (k < 1) requestAnimationFrame(stepFn);
      else { c.remove(); e.el.classList.remove('running'); resolve(); }
    };
    requestAnimationFrame(stepFn);
  });
}

function stepMeta(story, stepId) {
  const s = (story.steps || []).find((x) => x.id === stepId) || {};
  return { ...s, nodeLabel: (STEPS.find((x) => x.id === stepId) || {}).node };
}

// the per-industry branch identity for step 5 (story.branch, else fallback)
function resolveBranch(story, domain) {
  const fb = BRANCH_FALLBACK[domain] || BRANCH_FALLBACK.chemistry;
  const b = story.branch || {};
  return {
    node: b.node || fb.node,
    icon: b.icon || fb.icon,
    label: b.label || fb.label,
    kind: b.kind || fb.kind,
    title: b.title || fb.title,
    decision: b.decision || null,
    story: b.story || fb.story,
    changed: b.changed || fb.changed,
    why: b.why || fb.why,
  };
}

// the story banner beat for a step (industry-specific copy when present)
function beatFor(story, stepId, branch) {
  if (stepId === 'analyze') return branch.story || `Analysis wired: ${branch.label}.`;
  const meta = (story.steps || []).find((x) => x.id === stepId) || {};
  if (meta.beat) return meta.beat;
  // fall back to the per-step "changed" copy so the banner is never empty
  return meta.changed || `${(STEPS.find((s) => s.id === stepId) || {}).label || stepId} connected.`;
}

// ghost-slot label, preferring the per-step story 'slot' override
function slotFor(story, stepId, fallback) {
  const meta = (story.steps || []).find((x) => x.id === stepId) || {};
  return meta.slot || fallback;
}

function indexOfStep(stepId) {
  return STEPS.findIndex((s) => s.id === stepId);
}

function resolveBudget(story, value) {
  const b = story.budgets || {};
  const n = b[value];
  return n == null ? 0 : n; // 0 = all
}

function pickDefault(stepId, key, opts, story) {
  if (key === 'output') return story.defaultOutput || (opts[0] && opts[0].value);
  if (key === 'goal') {
    const out = story.defaultOutput;
    const g = goalFor(story, out);
    if (opts.some((o) => o.value === g)) return g;
  }
  if (key === 'budget') {
    const med = opts.find((o) => o.value === 'medium');
    return med ? med.value : (opts[0] && opts[0].value);
  }
  if (key === 'ci') {
    const c95 = opts.find((o) => o.value === '95' || o.value === 95);
    return c95 ? c95.value : (opts[0] && opts[0].value);
  }
  return opts[0] && opts[0].value;
}

// goal chips for the optimize step (direction options), defaulting from the output
function goalChips(story, out) {
  const g = goalFor(story, out);
  const base = [
    { value: 'high', label: 'Maximize' },
    { value: 'low', label: 'Minimize' },
    { value: 'window', label: 'Hit a band' },
  ];
  // put the recommended direction first
  base.sort((a, b) => (a.value === g ? -1 : b.value === g ? 1 : 0));
  return base;
}

function goalFor(story, outName) {
  if (story.goals && story.goals[outName]) return story.goals[outName];
  return 'high';
}

// friendly label for an output name (e.g. peak_temp -> "Peak temperature")
function labelFor(surrogate, outName) {
  const o = (surrogate.outputs || []).find((x) => x.name === outName);
  return o ? (o.label || o.name) : outName;
}

function better(a, b, goal) {
  if (goal === 'low') return a.mean < b.mean;
  return a.mean > b.mean; // 'high' and 'window' both treated as maximize-confidence here
}

// real R2 / RMSE: predict at each train point's axis location for the active output
function scoreFit(surrogate, outName) {
  const pts = (surrogate.trainPoints || []).filter((p) => p.outputs && p.outputs[outName] != null);
  if (!pts.length) return { r2: NaN, rmse: NaN };
  let sse = 0, sst = 0, mean = 0;
  pts.forEach((p) => { mean += p.outputs[outName]; });
  mean /= pts.length;
  pts.forEach((p) => {
    const { mean: m } = surrogate.predict(outName, p.x, p.y);
    const t = p.outputs[outName];
    sse += (t - m) ** 2;
    sst += (t - mean) ** 2;
  });
  const rmse = Math.sqrt(sse / pts.length);
  const r2 = sst > 0 ? 1 - sse / sst : 0;
  return { r2, rmse };
}

// pred-vs-true scatter from the real model: predict at each measured run's location
function drawPredTrue(cv, surrogate, outName) {
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const w = cv.width, h = cv.height, pad = 24;
  ctx.clearRect(0, 0, w, h);
  const pts = (surrogate.trainPoints || [])
    .filter((p) => p.outputs && p.outputs[outName] != null)
    .map((p) => ({ tr: p.outputs[outName], pr: surrogate.predict(outName, p.x, p.y).mean }));
  if (!pts.length) return;
  let mn = Infinity, mx = -Infinity;
  pts.forEach((p) => { mn = Math.min(mn, p.tr, p.pr); mx = Math.max(mx, p.tr, p.pr); });
  const span = (mx - mn) || 1; mn -= span * 0.06; mx += span * 0.06;
  const sx = (v) => pad + (v - mn) / (mx - mn) * (w - pad - 8);
  const sy = (v) => h - pad - (v - mn) / (mx - mn) * (h - pad - 8);
  ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad, 6); ctx.lineTo(pad, h - pad); ctx.lineTo(w - 6, h - pad); ctx.stroke();
  ctx.strokeStyle = 'rgba(156,152,144,0.5)'; ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(sx(mn), sy(mn)); ctx.lineTo(sx(mx), sy(mx)); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#ffb006';
  pts.forEach((p) => { ctx.beginPath(); ctx.arc(sx(p.tr), sy(p.pr), 2.6, 0, 7); ctx.fill(); });
  ctx.fillStyle = 'rgba(160,156,148,0.85)'; ctx.font = '9px ui-monospace';
  ctx.fillText('measured', w - 58, h - 7);
  ctx.save(); ctx.translate(10, pad + 4); ctx.rotate(-Math.PI / 2); ctx.fillText('predicted', 0, 0); ctx.restore();
}
