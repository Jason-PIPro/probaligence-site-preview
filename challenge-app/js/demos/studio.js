// Stochos Flow Web: the guided, BUILD-IT-YOURSELF demonstrator.
// v4 (2026-07-13, "ungate + agent chat" rework -- Jason's direct feedback on the
// v3 faithful-graph pass, which he liked). Five changes on top of v3, all in this
// file + studio-stories.js + the studio CSS (see STUDIO-CONTRACT.md's v4 section
// for the full spec this implements):
//   1. Port clip bug fixed at the root: ports are positioned with left:0%/100% +
//      top:N% on the CARD's own box, then transform:translate(-50%,-50%) centers
//      each dot exactly on the card edge (CSS). The matching JS edge-routing
//      math (port()) uses CARD_W/CARD_H, the card's real pixel size, instead of
//      the outer .snode footprint it was wrongly using before.
//   2. The right panel is now an AGENT CHAT with preset chips (no free-text
//      input -- scripted answers, not a live LLM): a welcome message, short
//      reactions to placing/wiring nodes (reusing the story's "beat" lines),
//      and RESULT cards (the branch chart, the deployed predictor) posted as
//      agent replies. Copy comes from studio-stories.js's `chat` schema.
//   3. The build is UNGATED: no more Next-gated linear phases. Any currently
//      available node (its upstream is placed) can be dragged/wired at the
//      visitor's own pace. The old per-phase "why" text lives in small
//      anchored, non-blocking popovers on the node/ghost itself.
//   v4.2 (2026-07-13, direct feedback): the train/test ratio chips and the BO
//      explore/exploit kappa slider are REMOVED -- no knobs, no clickable
//      choices anywhere on the canvas. Both defaults (70% train; kappa 1.4,
//      STOCHOS's balanced default) apply silently on wiring, exactly as they
//      already did when a visitor ignored the old popover. The anchored
//      popovers stay and become pure explainer copy: what the node did, plus
//      the default it just applied, stated as fact, never offered as a choice.
//   4. The docked Surface/Web-app viewer is REMOVED. There is no more live
//      Confidence Field canvas; the analyze-branch chart and the deployed
//      predictor both render as result cards in the chat stream, still
//      computed from the real Surrogate. The freed canvas gets a roomier
//      node layout.
//   5. The challenge "See the showdown" banner is GATED: it only appears once
//      the whole 9-node graph is built, not on entry.
//
// The faithful multi-port graph is grounded in Stochos_Flow_examples/*.prompt.txt.
// Every domain: two Excel Readers (Inputs X, Targets Y) -> train_test_split (2
// in-ports) -> dimgp_regr_fit (2 in-ports) -> pam_regr (3 in-ports); the trained
// model plus BOTH readers (not the split) feed web_app_scalar (3 in-ports).
// v4.3 (2026-07-13, ground-truth audit fix batch on the node graph itself, on
// top of the same v4 mechanics): two corrections plus one structural change,
// verified quote-level against the real examples:
//   1. `bayesian_opt_next_sample` and `web_app_scalar` read their X/Y straight
//      from the two Excel Readers, never from train_test_split's held-out
//      subset (3_2_Manual_optimization_simple_interface.prompt.txt: "data_array
//      to X and Y"; 5_1_scalar_to_scalar.prompt.txt: fed by the two readers +
//      fit). Paint's `dist_cor` branch does the same (no split in the real
//      correlation example either). train_test_split now legitimately serves
//      only `dimgp_regr_fit` and `pam_regr` (chemistry's `sobol_indices`
//      branch is the one exception -- it genuinely reads split's X_train per
//      2_1_var_bases_sens_scalar.prompt.txt).
//   2. Engineering and bottle (any domain whose `story.branch.kind ===
//      'pareto'`) use the AUTOMATIC-BO pattern instead of manual Next Sample:
//      `bayesian_opt_init` -> `bayesian_opt_optimize` ("BO Optimize", ins
//      bo_obj + true_evaluator, outs X/Y/models) fed by BO Init and a new
//      `python_solver` source node ("the heat-sink/load-test simulation"),
//      grounded in 3_4_Automatic_optimization_DoE_simple_interface.prompt.txt.
//      The old separate analyze phase (the Pareto chart) merges into optimize
//      (BO Optimize's own payoff IS the front) -- see buildPhases(). Paint and
//      chemistry (lab-data domains, no simulation to call) keep the manual
//      pattern unchanged. Both patterns stay a 9-node, real-multi-port graph;
//      see buildNodeDefs/buildEdgeDefs for the exact per-pattern port lists.
// Placing/wiring mechanics (pointer-drag, not HTML5 DnD; a single drag wires
// every real in-port of a node at once) are unchanged from v2/v3.
import { STORIES } from './studio-stories.js';
import { loadDomain } from '../surrogate.js';
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

// The build PHASES. A phase may place MORE THAN ONE node (data places both
// Excel Readers; optimize places BO Init + Next Sample). v4: PHASES no longer
// drives a gated "current step" state machine -- it is now just grouping
// metadata (which nodes share one narrative beat / result payoff, and the
// build order autobuild follows). The visitor may place or wire ANY
// currently-available node in ANY order at their own pace.
// v4.3 (ground-truth audit fix): a domain's branch shape now decides the
// phase list. `story.branch.kind === 'pareto'` (engineering, bottle) is the
// AUTOMATIC-BO pattern: `bayesian_opt_next_sample` is dropped, a `solver`
// (python_solver) source node is added, and the old separate `analyze` phase
// merges into `optimize` (BO Init + Python Solver + BO Optimize together --
// the Pareto front IS the optimize payoff). Every other domain (paint,
// chemistry) keeps the original 7-phase manual-BO shape with its own
// `analyze` phase. Computed per buildStage call (branch is per-domain), not a
// module-level constant any more.
function buildPhases(branch) {
  if (branch.kind === 'pareto') {
    return [
      { id: 'data',     nodeIds: ['readerX', 'readerY'] },
      { id: 'split',    nodeIds: ['split'] },
      { id: 'fit',      nodeIds: ['fit'] },
      { id: 'validate', nodeIds: ['pam'] },
      { id: 'optimize', nodeIds: ['boInit', 'solver', 'branch'] },
      { id: 'deploy',   nodeIds: ['webapp'] },
    ];
  }
  return [
    { id: 'data',     nodeIds: ['readerX', 'readerY'] },
    { id: 'split',    nodeIds: ['split'] },
    { id: 'fit',      nodeIds: ['fit'] },
    { id: 'validate', nodeIds: ['pam'] },
    { id: 'analyze',  nodeIds: ['branch'] },
    { id: 'optimize', nodeIds: ['boInit', 'boNext'] },
    { id: 'deploy',   nodeIds: ['webapp'] },
  ];
}

// Per-industry Flow project file name shown in the title bar.
const PROJECT_NAME = { paint: 'coating-doe.sfpj', chemistry: 'reaction-doe.sfpj', engineering: 'heat-sink.sfpj', bottle: 'bottle-doe.sfpj' };

// Real train/test split. 70% train is the standard engineering default, applied
// silently on every wire (no ratio picker on canvas any more, see v4.2).
const DEFAULT_RATIO = 0.7;
// Default Bayesian-optimization acquisition weighting (explore <-> exploit),
// applied silently on every wire (no kappa slider on canvas any more, v4.2). A
// mid-range value balances trying promising candidates against probing regions
// STOCHOS is still unsure about, rather than leaning hard either way.
const DEFAULT_KAPPA = 1.4;

const IC = 'vendor/node-icons/';
const NW = 78, NH = 72; // .snode wrapper footprint (matches ghost slot sizing + label spacing)
// PORT FIX (v4): the actual .snode-card visual tile is 66x66 (see .sf-app
// .snode-card in styles.css), centered via margin:auto inside the NW-wide
// .snode wrapper (a (NW-CARD_W)/2 = 6px gutter each side). Ports are CSS-
// positioned at left:0%/100% of the CARD's own box (not the outer .snode), so
// this edge-routing math must use the CARD's real size, not NW/NH, or the SVG
// wire endpoint drifts off the visible dot -- that mismatch (ports positioned
// against the wrong, wider box) was the root cause of the "detached out-port
// dot" / "half-clipped in-port" bug Jason flagged.
const CARD_W = 66, CARD_H = 66;

// Graph layout (v4): with the docked Surface/Web-app viewer removed there is
// nothing left to dodge, so the layout breathes across the freed canvas at the
// 1440px reference width (readers stacked left; split; fit at the spine's
// centre; PAM above-right of fit; the analyze branch below fit; BO Init
// stacked above BO Next further right; Web App Export far right). `.sf-canvas`
// is `overflow: hidden` at this reference width (only a narrow-viewport media
// query in styles.css turns on horizontal scroll), so every node must fit
// inside the canvas's own box here, not rely on scrolling to reach it.
// v4.3: two layouts now share the same trunk (readers/split/fit/pam/webapp
// stay put) AND THE SAME FOOTPRINT for their two remaining slots -- the
// MANUAL-BO domains (paint, chemistry) fill them with the analyze branch
// (below fit) and BO Init/Next Sample (stacked, then webapp); the
// AUTOMATIC-BO domains (engineering, bottle, `branch.kind === 'pareto'`)
// re-use the exact same two slots for `solver` (python_solver, below fit,
// where the analyze branch used to sit -- both are leaf/source nodes with no
// downstream FORWARD dependency on the trunk's x-position) and `branch`
// (bayesian_opt_optimize, the merged optimize+analyze node, where Next
// Sample used to sit -- fed by BO Init directly above it, same stacked
// edge shape boInit->boNext already used, and by solver via a plain
// forward left-to-right edge). Nothing widens the canvas; only which node
// occupies which already-proven-to-fit slot changes.
const POS_MANUAL = {
  readerX: [24, 24],
  readerY: [24, 180],
  split:   [190, 100],
  fit:     [370, 100],
  pam:     [540, 24],
  branch:  [370, 270],
  boInit:  [680, 24],
  boNext:  [680, 170],
  webapp:  [800, 100],
};
const POS_AUTO = {
  readerX: POS_MANUAL.readerX,
  readerY: POS_MANUAL.readerY,
  split:   POS_MANUAL.split,
  fit:     POS_MANUAL.fit,
  pam:     POS_MANUAL.pam,
  solver:  POS_MANUAL.branch,   // python_solver: a source node, reuses the analyze slot
  boInit:  POS_MANUAL.boInit,
  branch:  POS_MANUAL.boNext,   // bayesian_opt_optimize: reuses the Next-Sample slot
  webapp:  POS_MANUAL.webapp,
};
function buildPos(branch) {
  return branch.kind === 'pareto' ? POS_AUTO : POS_MANUAL;
}

// small text badge baked onto a node tile where it reads well. Keyed by node
// INSTANCE id (readerX vs readerY share a node TYPE but need different badges).
const NODE_BADGE = {
  readerX: 'X', readerY: 'Y', split: `${Math.round(DEFAULT_RATIO * 100)}/${100 - Math.round(DEFAULT_RATIO * 100)}`,
  fit: 'FIT', pam: 'PAM', boInit: 'INIT', boNext: 'NEXT', solver: 'SIM', webapp: 'APP',
};

// Per-industry branch node identity, used only if a story is missing `branch`
// (defensive fallback; every story defines its own). Real node names only.
const BRANCH_FALLBACK = {
  paint: { node: 'dist_cor', icon: 'plot_bar', label: 'Correlations', kind: 'correlation', badge: 'COR',
    ins: ['X', 'Y'], outs: ['dist_cor'],
    edges: [{ from: 'readerX', fromPort: 0, to: 'branch', toPort: 0 }, { from: 'readerY', fromPort: 0, to: 'branch', toPort: 1 }],
    title: 'Read the property trade-offs', why: 'dist_cor reads the lab data directly.',
    story: 'The correlations make the trade-off quantitative.', changed: 'The bars show which output pairs move together.' },
  chemistry: { node: 'sobol_indices', icon: 'sobol_indices', label: 'Sobol Indices', kind: 'tornado', badge: 'SOBOL',
    ins: ['X_train', 'models'], outs: ['sobol_indices'],
    edges: [{ from: 'split', fromPort: 0, to: 'branch', toPort: 0 }, { from: 'fit', fromPort: 0, to: 'branch', toPort: 1 }],
    title: 'Rank what drives the result', why: 'Sobol Indices decomposes the variance in the trained surface.',
    story: 'The longest bar is the lever worth turning first.', changed: 'The tornado bars rank each input.' },
  engineering: { node: 'bayesian_opt_optimize', icon: 'bo_optimize', label: 'BO Optimize', kind: 'pareto', badge: 'PARETO',
    ins: ['bo_obj', 'true_evaluator'], outs: ['X', 'Y', 'models'],
    edges: [{ from: 'boInit', fromPort: 0, to: 'branch', toPort: 0 }, { from: 'solver', fromPort: 0, to: 'branch', toPort: 1 }],
    title: 'Map the Pareto trade-off', why: 'BO Optimize runs the automatic loop directly against the connected solver.',
    story: 'The front is the set of best compromises.', changed: 'The front shows every Pareto-optimal design.' },
};

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
/* B1: "Use cases" back link in the studio picker: plain mono text link, no
   pill/border/background, faint until hovered (matches the challenge demo's
   back link). */
.studio-pick-back {
  display: inline-flex; align-items: center; gap: 6px;
  background: none; border: none; cursor: pointer;
  color: var(--faint, #82827C); font: 500 12.5px/1 var(--mono, monospace); letter-spacing: 0.02em;
  padding: 0; margin-bottom: 28px;
  transition: color 0.16s;
}
.studio-pick-back:hover { color: var(--amber, #FFB006); }

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
   .sf-center must be a positioning context so nothing absolutely
   positioned inside it (a node dragged near the edge, a popover)
   can overflow into the agent chat column. -------------------- */
.sf-app .sf-center {
  position: relative !important;
  overflow: hidden !important;
  min-width: 0 !important;
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

.sf-app .sf-canvas { min-height: 300px; }

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
  color: var(--sf-orange, #e8632a); padding: 0 8px; flex-shrink: 0;
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

/* pal-node search input: keep focus ring amber, not blue */
.sf-app .sf-search-input:focus {
  border-color: rgba(255, 176, 6, 0.55) !important;
  outline: none;
}

/* the fixed-objective note under the optimize decision label (no goal chips,
   the direction is read from the modeled property, not chosen). */
.sf-app .goal-note {
  font-size: 11px; line-height: 1.5; color: var(--faint, #82827C);
  margin: -2px 0 4px;
}

/* v4: port hover label, a small dark pill naming the real port (X_train,
   models, bo_obj, ...). Native title= is the accessible fallback; this is the
   styled one. Positioned off the CARD's own edge (left:100%/0) since the port
   itself is now centred exactly there (see the CARD_W/CARD_H port fix). */
.sf-app .snode .port[data-label]:hover::after {
  content: attr(data-label);
  position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
  white-space: nowrap; pointer-events: none; z-index: 6;
  font: 500 10px/1 var(--mono, monospace); letter-spacing: 0.02em;
  color: var(--sf-ink, #e6e6e6);
  background: rgba(10,10,10,0.94); border: 1px solid var(--sf-border, #3a3a3c);
  border-radius: 4px; padding: 3px 6px;
}
.sf-app .snode .port[data-role="out"][data-label]:hover::after { left: auto; right: 12px; }

/* v4: explicit z-order so edges always paint UNDER node cards, ghosts always
   paint under both, and popovers paint above everything on the canvas
   (belt-and-braces on top of the natural DOM order, which already puts the
   once-created <svg> before every node card appended later). */
.sf-app svg.sf-edges { z-index: 1; }
.sf-app .studio-ghost { z-index: 1; }
.sf-app .snode { z-index: 2; }
`;
  document.head.appendChild(s);
}());

// Quiet identity marks for the industry picker cards: minimal geometric line
// art, single amber accent, aria-hidden. Kept faint per house style (no
// gradient washes, no glows); these replace the old blurred-glow blob.
const PICK_MARK = {
  paint: `<svg viewBox="0 0 28 28" fill="none" stroke="rgba(255,176,6,.55)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="6" width="15" height="7" rx="2"/><line x1="11.5" y1="13" x2="11.5" y2="18"/><line x1="11.5" y1="18" x2="20" y2="24"/></svg>`,
  chemistry: `<svg viewBox="0 0 28 28" fill="none" stroke="rgba(255,176,6,.55)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4h6"/><path d="M12 4v7l-6.2 10.8c-.9 1.6.2 3.6 2 3.6h10.4c1.8 0 2.9-2 2-3.6L14 11V4"/><path d="M9.2 17.5h9.6"/></svg>`,
  // the pressure-test bottle, same mark as the challenge picker's engineering
  // card (the two pickers offer the SAME three cases since 2026-07-14).
  bottle: `<svg viewBox="0 0 28 28" fill="none" stroke="rgba(255,176,6,.55)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 3h6v4l2 3v13a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2V10l2-3V3z"/><line x1="2.5" y1="8" x2="7.5" y2="8"/><polyline points="5.5,5.7 7.7,8 5.5,10.3"/><line x1="25.5" y1="8" x2="20.5" y2="8"/><polyline points="22.3,5.7 20.1,8 22.3,10.3"/></svg>`,
  // the retired standalone heat-sink case (STORIES.engineering, no longer in
  // the picker order): fins over a baseplate. Kept so a stray route renders.
  engineering: `<svg viewBox="0 0 28 28" fill="none" stroke="rgba(255,176,6,.55)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="4" x2="6" y2="16"/><line x1="11" y1="4" x2="11" y2="16"/><line x1="16" y1="4" x2="16" y2="16"/><line x1="21" y1="4" x2="21" y2="16"/><rect x="4" y="16" width="19" height="5" rx="1"/></svg>`,
};

// Full-bleed still headers (Jason's brand stills, 2026-07-14), the same three
// the challenge picker uses so the two pickers stay siblings. A case without a
// still falls back to its PICK_MARK corner line art.
const PICK_IMG = {
  paint: 'assets/cases/paint-roller.webp',
  chemistry: 'assets/cases/chemistry-flask.webp',
  bottle: 'assets/cases/bottle-rig.webp',
};

export async function mountStudio(root) {
  // Track the resize listener added inside buildStage so we can remove it on
  // teardown (M3 fix: prevent listener accumulation across studio visits).
  let _onResize = null;
  // AUDIT FIX 5: the idle-nudge timer lives at this outer scope, not as a
  // buildStage-local `let`, so the returned destroy() below can clear it too.
  let idleTimer = null;
  // AUDIT FIX 6: cleanup for whichever pointer-drag (palette drag or wire drag) is
  // currently live, so tearing down mid-drag removes its document listeners and any
  // floating clone / rubber-band wire instead of leaking them.
  let _dragCleanup = null;
  // v4: cleanup for a live anchored popover + its auto-hide timer, same idea.
  let _popoverCleanup = null;
  // v4.1: cleanup for the chat's typing/streaming timers (see the "chat (v4)"
  // block inside buildStage), so navigating away mid-stream cancels every
  // outstanding setTimeout instead of letting it fire after unmount.
  let _streamCleanup = null;

  root.innerHTML = `
  <div class="studio fade-in">
    <div class="studio-pick">
      <div class="pick-head">
        <button class="studio-pick-back" id="studioPickBack">&#8592; Use cases</button>
        <h1>Build it yourself</h1>
        <div class="lead">Pick a use case, the same three the challenge plays. Assemble the real Stochos Flow workflow by dragging nodes and wiring their ports, with the agent explaining every step.</div>
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

  // the SAME three cases the challenge plays (Jason 2026-07-14: "those examples
  // should fit the ones from the challenge"). The old standalone heat-sink case
  // (STORIES.engineering + data/engineering.json) stays in the codebase but is
  // no longer offered.
  const order = ['paint', 'chemistry', 'bottle'];
  for (const key of order) {
    const s = STORIES[key];
    if (!s) continue;
    const card = document.createElement('div');
    card.className = 'pick-card';
    card.dataset.domain = key;
    card.innerHTML = `
      ${PICK_IMG[key]
        ? `<img class="pick-card-img" src="${PICK_IMG[key]}" alt="" loading="lazy" aria-hidden="true">`
        : `<span class="mark" aria-hidden="true">${PICK_MARK[key] || ''}</span>`}
      <span class="tag">${s.tag || key}</span>
      <h3>${s.outcome || ''}</h3>
      <p>${s.pitch || ''}</p>
      <span class="go">Build this workflow</span>`;
    card.onclick = () => pickDomain(key);
    cards.appendChild(card);
  }

  // ---- "Beat Stochos" hand-off: if we arrived from the challenge game, skip the
  // picker, build that case directly, and offer a return-to-showdown banner
  // (v4: the banner is GATED -- it only appears once the graph is fully built,
  // see maybeShowChallengeBanner() inside buildStage). ----
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
    // AUDIT FIX 1: call stochosRun the SAME way the challenge's own "watch it
    // optimize" path does (challenge.js), i.e. with no budget override, so this
    // resolves the per-domain calibrated budget from DOMAIN_RUN_CFG (score.js)
    // instead of a hardcoded one. Both paths are deterministic (fixed per-domain
    // seed), so this keeps the showdown score identical no matter which path the
    // visitor took to get here.
    const r = stochosRun(surrogate, prim.out, prim.goal);
    try {
      sessionStorage.setItem('challengeShowdown', JSON.stringify({
        domain: challengeCtx.domain, userBest: challengeCtx.userBest,
        // V4: carry the per-term spec/cost breakdown too, or the showdown's
        // compliance chips silently drop on this path (QA 2026-07-14 finding).
        stochos: { score: r.score, params: r.params, outputs: r.outputs, breakdown: r.breakdown },
      }));
      sessionStorage.removeItem('challengeCtx');
    } catch (e) { /* noop */ }
    location.hash = '#/challenge';
  }

  function addChallengeBanner(surrogate) {
    const b = document.createElement('div');
    b.className = 'sf-challenge-banner';
    b.innerHTML = `<span>Challenge: the workflow is built.</span><button class="sf-ch-return" id="chReturn">See the showdown</button>`;
    root.appendChild(b);
    b.querySelector('#chReturn').onclick = () => finishChallenge(surrogate);
  }

  // Part 2 funnel: on the standalone "build a workflow yourself" path (no
  // challenge context, so no showdown to return to), the completed build is the
  // hand-off moment. Offer the contact form the same way the challenge banner
  // offers the showdown.
  function addStudioCtaBanner() {
    const b = document.createElement('div');
    b.className = 'sf-challenge-banner';
    b.innerHTML = '<span>You built the workflow end to end.</span><a class="sf-ch-return" href="/contact/" style="text-decoration:none">Talk to us about your data</a>';
    root.appendChild(b);
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
    // v4: no banner here -- it only appears once the graph is fully built
    // (maybeShowChallengeBanner, called from onNodeDone / autobuild).
  }

  // ---------------------------------------------------------------- stage ----
  function buildStage(domain, story, surrogate) {
    // resolve the per-industry branch node (story-supplied, else fallback) and
    // build the full node + edge model (a real multi-port graph, not a chain).
    const branch = resolveBranch(story, domain);
    const nodeDefs = buildNodeDefs(branch);
    const edgeDefs = buildEdgeDefs(branch);
    const POS = buildPos(branch);
    // v4.3: the automatic-BO domains (engineering, bottle) merge the old
    // `analyze` phase into `optimize` and swap Next Sample for a Python
    // Solver source node -- see buildPhases()'s own comment. PHASES/
    // PHASE_FOR_NODE/NODE_ORDER are per-domain now (branch-shape dependent),
    // computed once here and closed over by every helper below.
    const automatic = branch.kind === 'pareto';
    const PHASES = buildPhases(branch);
    const PHASE_FOR_NODE = {};
    PHASES.forEach((p) => p.nodeIds.forEach((id) => { PHASE_FOR_NODE[id] = p.id; }));
    const NODE_ORDER = PHASES.reduce((acc, p) => acc.concat(p.nodeIds), []);

    // per-industry Flow project name shown in the title bar + Working Dir.
    const project = PROJECT_NAME[domain] || 'workflow.sfpj';
    const workDir = `C:\\Users\\you\\StochosFlow\\${project.replace('.sfpj', '')}`;

    const stage = document.createElement('div');
    stage.className = 'sf-app studio-stage';
    stage.innerHTML = `
      <div class="sf-titlebar">
        <button class="sf-back-btn" id="btnBack" title="Back to domain picker">&#8592; Back</button>
        <span class="sf-logo">SF</span>
        <span class="sf-title"><span class="sf-dot"></span> Stochos Flow: ${project}</span>
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
        <aside class="sf-agent" id="guide">
          <div class="sfg-head"><span class="sfg-agent-dot"></span> Agent</div>
          <div class="sfg-chat" id="chatScroll"></div>
          <div class="sfg-presets" id="chatPresets"></div>
        </aside>
      </div>`;
    pickWrap.appendChild(stage);

    const $ = (s) => stage.querySelector(s);
    const graph = $('#graph'), svg = $('#edges');
    const vbody = $('#vbody'), vcountEl = $('#vcount'), consoleEl = $('#console');
    const varsTable = $('#varsTable');

    // ---- Back button: return to the domain picker (B1 / M3) ----
    // Uses the shared studioTeardown() helper (defined after onResize is created)
    // so the same cleanup path works here AND from main.js's route teardown.
    $('#btnBack').onclick = () => {
      studioTeardown();
      // re-mount: this rebuilds the pick screen from scratch
      mountStudio(root);
    };

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

    // M3 fix: track the resize listener in the outer-scoped _onResize so the
    // returned teardown (and btnBack) can always remove the exact same function.
    // v4: no StudioField to resize anymore; just close any open popover (its
    // anchor position is stale after a resize) and redraw edges.
    const onResize = () => {
      if (!stage.isConnected) { window.removeEventListener('resize', onResize); return; }
      closePopover();
      drawEdges();
    };
    _onResize = onResize;
    window.addEventListener('resize', onResize);

    // Shared cleanup: remove the resize listener, close any open popover, and
    // cancel a live drag. Called by btnBack (navigate back to picker) AND by
    // the teardown returned to main.js (navigate away from #/studio entirely).
    function studioTeardown() {
      clearTimeout(idleTimer);  // AUDIT FIX 5
      if (_popoverCleanup) { _popoverCleanup(); _popoverCleanup = null; }
      if (_dragCleanup) { _dragCleanup(); _dragCleanup = null; }  // AUDIT FIX 6
      if (_streamCleanup) { _streamCleanup(); _streamCleanup = null; }  // v4.1: cancel chat typing/streaming timers
      if (_onResize) { window.removeEventListener('resize', _onResize); _onResize = null; }
    }

    // ---- node model: real multi-port nodes. Positions come from POS (a
    // fixed, domain-agnostic branched layout); port counts come from each node's
    // ins/outs arrays (real port names, shown on hover). ----
    const nodes = {};
    Object.keys(nodeDefs).forEach((id) => {
      const d = nodeDefs[id];
      const [x, y] = POS[id];
      nodes[id] = { id, ...d, x, y, inN: d.ins.length, outN: d.outs.length, el: null, ghost: null, placed: false };
    });

    // ---- ghost slots: a dashed blueprint of what to build, laid out by POS,
    // ALL visible from the start (unchanged from v3). ----
    Object.keys(nodes).forEach((id) => {
      const n = nodes[id];
      const g = document.createElement('div');
      g.className = 'studio-ghost';
      g.dataset.id = id;
      g.style.left = n.x + 'px';
      g.style.top = n.y + 'px';
      g.style.width = NW + 'px';
      g.style.height = NH + 'px';
      g.innerHTML = `<span class="ghost-label">${n.slot || id}</span>`;
      graph.appendChild(g);
      n.ghost = g;
    });

    // ---- edges (svg paths created up-front; drawn only once both ends exist).
    // Each edge carries a real fromPort/toPort index into its node's outs/ins
    // array, so multiple wires into one node fan into visibly distinct ports. ----
    const edgeEls = [];
    edgeDefs.forEach((d) => {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('class', 'edge');
      svg.appendChild(p);
      edgeEls.push({ from: d.from, fromPort: d.fromPort, to: d.to, toPort: d.toPort, el: p, live: false });
    });
    // rubber-band wire shown while the user drags from a port
    const dragWire = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    dragWire.setAttribute('class', 'wire-drag');
    dragWire.style.display = 'none';
    svg.appendChild(dragWire);

    const drawEdges = () => edgeEls.forEach((e) => {
      const a = nodes[e.from], b = nodes[e.to];
      if (!a || !b || !a.el || !b.el) { e.el.setAttribute('d', ''); return; }
      const s = port(a, 'out', e.fromPort), t = port(b, 'in', e.toPort);
      e.el.setAttribute('d', edgePath(s, t));
    });

    // -------------------------------------------------------- popovers (v4) --
    // Small, anchored, NON-BLOCKING info popups: the explainer channel for
    // every placed/wired node. One at a time. Only the popover box itself is
    // interactive; everything else on the canvas stays fully clickable/
    // draggable underneath. v4.2: there is no "decision" variant left -- every
    // popover is plain explainer copy, including the two nodes that used to
    // carry a chip/slider (train_test_split, bayesian_opt_init); they now just
    // state what happened, defaults included, same as any other node.
    let activePopover = null, popoverTimer = null;
    function closePopover() {
      if (popoverTimer) { clearTimeout(popoverTimer); popoverTimer = null; }
      if (activePopover) { activePopover.remove(); activePopover = null; }
    }
    _popoverCleanup = closePopover;
    function positionPopover(pop, anchorEl) {
      if (!anchorEl || !anchorEl.isConnected) return;
      const gr = graph.getBoundingClientRect();
      const ar = anchorEl.getBoundingClientRect();
      const left = ar.left - gr.left + ar.width / 2;
      const top = ar.top - gr.top + ar.height + 10;
      pop.style.left = left + 'px';
      pop.style.top = top + 'px';
      requestAnimationFrame(() => {
        if (!pop.isConnected) return;
        const pr = pop.getBoundingClientRect(), grr = graph.getBoundingClientRect();
        if (pr.bottom > grr.bottom - 6) pop.style.top = (ar.top - gr.top - pr.height - 10) + 'px';
        const pr2 = pop.getBoundingClientRect();
        let dx = 0;
        if (pr2.right > grr.right - 6) dx = grr.right - 6 - pr2.right;
        if (pr2.left < grr.left + 6) dx = grr.left + 6 - pr2.left;
        if (dx) pop.style.left = (parseFloat(pop.style.left) + dx) + 'px';
      });
    }
    function showPopover(anchorEl, { title, body, autoHideMs = 3200 } = {}) {
      closePopover();
      if (!anchorEl) return null;
      const pop = document.createElement('div');
      pop.className = 'node-popover';
      if (title) {
        const t = document.createElement('div'); t.className = 'popover-title'; t.textContent = title;
        pop.appendChild(t);
      }
      const b = document.createElement('div'); b.className = 'popover-body';
      if (body) b.textContent = body;
      pop.appendChild(b);
      pop.addEventListener('click', (e) => {
        if (e.target === pop || e.target === b || e.target.classList.contains('popover-title')) closePopover();
      });
      graph.appendChild(pop);
      positionPopover(pop, anchorEl);
      activePopover = pop;
      if (autoHideMs) popoverTimer = setTimeout(closePopover, autoHideMs);
      return pop;
    }

    // ---------------------------------------------------------- chat (v4) ----
    // The agent chat stream + result cards. PRESETS ONLY drive replies (no
    // free-text field): scripted answers must not pretend to be a live LLM.
    function scrollChat() { const s = $('#chatScroll'); if (s) s.scrollTop = s.scrollHeight; }
    // Bubble shell: the title (optional) + an EMPTY body, appended to the
    // stream. Callers (chatUser, chatAgent, chatResult) fill the body in,
    // either instantly (the user echo) or over time (typing + streaming, v4.1).
    function chatShell(kind, title) {
      // Teardown guard: every chat-posting call (chatUser/chatAgent/chatResult)
      // funnels through here, so this one check stops a still-in-flight async
      // chain (autobuild's onNodeDone -> postBeat -> runGroupPayoff, an
      // in-flight runOptimize's own result card, the idle nudge, ...) from
      // creating a NEW bubble on an already-torn-down stage. Those call sites
      // do not each need their own stage.isConnected check. location.hash is
      // the same belt-and-braces addition as trackTimeout's (see its comment):
      // it updates synchronously on navigation, before the async 'hashchange'
      // listener (and therefore teardown) actually runs.
      if (!stage.isConnected || !location.hash.startsWith('#/studio')) return null;
      const streamEl = $('#chatScroll');
      if (!streamEl) return null;
      const el = document.createElement('div');
      el.className = `chat-msg ${kind}`;
      if (title) { const h = document.createElement('div'); h.className = 'chat-msg-title'; h.textContent = title; el.appendChild(h); }
      const body = document.createElement('div');
      body.className = 'chat-msg-body';
      el.appendChild(body);
      streamEl.appendChild(el);
      return { el, body };
    }
    // the visitor's own echoed preset click: always instant, never typed/streamed.
    function chatUser(text) {
      const shell = chatShell('user');
      if (!shell) return null;
      shell.body.textContent = text || '';
      scrollChat();
      return shell.el;
    }

    // ---------------------------------------- typing indicator + word stream --
    // v4.1 (2026-07-13, "give the chat writing animations", Jason's direct
    // feedback on the v4 chat panel): every agent reply -- a plain chat line OR
    // a result card -- first shows a brief pulsing-dot "typing" beat, then
    // either streams the text in word by word (chatAgent) or fades in as ONE
    // unit (chatResult -- a metrics row / chart cannot sensibly stream word by
    // word). Only one message is ever in flight: starting a new one (another
    // preset click, a place/wire reaction, an autobuild line) FAST-FORWARDS
    // whatever is still typing/streaming to its finished state first, so two
    // typing indicators never overlap and nothing is ever queued invisibly.
    // Reduced motion renders every message in its final state immediately (no
    // dots, no streaming), checked once per message (cheap, and honors a
    // mid-session toggle for the next message that posts).
    let activeStream = null;        // { finish() } for the in-flight message, or null
    const streamTimers = new Set(); // every live setTimeout id spawned by streaming (teardown)
    function reducedMotion() {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }
    // AUDIT-FIX-style guard (matches onResize/autobuild's existing idiom):
    // a timer that was still pending at teardown and somehow escaped
    // _streamCleanup's sweep never mutates a detached stage. Belt AND braces:
    // `stage.isConnected` catches teardown via the synchronous "Back" button
    // (studioTeardown runs immediately, no event round-trip); a route change
    // away from #/studio goes through main.js's 'hashchange' listener, which
    // is an async-dispatched event -- location.hash itself, unlike the
    // listener firing, updates SYNCHRONOUSLY the instant it is assigned, so
    // checking it here closes the narrow window where a timer that was
    // already due fires before the hashchange event (and therefore
    // _streamCleanup) has run at all.
    function trackTimeout(fn, ms) {
      const id = setTimeout(() => {
        streamTimers.delete(id);
        if (!stage.isConnected || !location.hash.startsWith('#/studio')) return;
        fn();
      }, ms);
      streamTimers.add(id);
      return id;
    }
    // teardown seam: cancel every outstanding streaming timer. Wired to the
    // outer-scoped _streamCleanup right below, alongside _popoverCleanup/_dragCleanup.
    function clearStreamTimers() { streamTimers.forEach((id) => clearTimeout(id)); streamTimers.clear(); }
    _streamCleanup = () => { clearStreamTimers(); activeStream = null; };
    // interrupt whatever is currently typing/streaming, jumping it straight to
    // its finished state (full text / the revealed card), before any new
    // message starts. A no-op when nothing is in flight.
    function fastForwardActive() {
      if (!activeStream) return;
      const s = activeStream;
      activeStream = null;
      s.finish();
    }
    function typingDots() {
      const d = document.createElement('span');
      d.className = 'chat-typing';
      d.innerHTML = '<i></i><i></i><i></i>';
      return d;
    }

    // Post a streamed agent text reply: dots, then the words reveal one at a
    // time. The per-word delay is derived from the word count so the WHOLE
    // message (typing beat included) always finishes within ~1.2s, however
    // long the text is -- a short reply is not artificially slowed down, a
    // long one is not left crawling.
    function chatAgent(text, title) {
      fastForwardActive();
      const shell = chatShell('agent', title);
      if (!shell) return null;
      const { el, body } = shell;
      const full = text || '';
      if (reducedMotion()) { body.textContent = full; scrollChat(); return el; }

      el.classList.add('typing');
      body.appendChild(typingDots());
      scrollChat();

      const words = full.split(/\s+/).filter(Boolean);
      let settled = false;
      let pendingId = null;
      const schedule = (fn, ms) => { pendingId = trackTimeout(() => { pendingId = null; fn(); }, ms); };
      const handle = {
        finish() {
          if (settled) return;
          settled = true;
          if (pendingId != null) { clearTimeout(pendingId); streamTimers.delete(pendingId); pendingId = null; }
          el.classList.remove('typing');
          body.textContent = full; // exact original text, not the whitespace-normalized word join
          scrollChat();
          if (activeStream === handle) activeStream = null;
        },
      };
      activeStream = handle;

      const typingMs = 350 + Math.random() * 250; // 350-600ms, randomized so it feels alive
      schedule(() => {
        el.classList.remove('typing');
        body.textContent = '';
        if (!words.length) { handle.finish(); return; }
        const budget = Math.max(300, 1200 - typingMs); // remaining ms so the total stays under ~1.2s
        const perWord = Math.min(140, budget / words.length);
        let shown = 0;
        const revealNext = () => {
          shown++;
          if (shown >= words.length) { handle.finish(); return; }
          body.textContent = words.slice(0, shown).join(' ');
          scrollChat();
          schedule(revealNext, perWord);
        };
        schedule(revealNext, perWord);
      }, typingMs);

      return el;
    }

    // result cards: metrics row + optional chart(+legend) + callout, OR a fully
    // custom build(host) callback (used by the deploy predictor). The content
    // is assembled up front (so a chart's draw() runs normally against a plain
    // canvas, visible or not) then revealed as ONE unit -- after the same
    // typing beat as chatAgent -- rather than streamed word by word.
    function chatResult({ title, metrics, chart, callout, build } = {}) {
      fastForwardActive();
      const shell = chatShell('agent result', title);
      if (!shell) return null;
      const { el, body } = shell;

      const content = document.createElement('div');
      content.className = 'result-content';
      if (build) {
        build(content);
      } else {
        if (metrics && metrics.length) {
          const row = document.createElement('div');
          row.className = 'result-metrics';
          row.innerHTML = metrics.map((m) => `<span class="rm"><b>${m.value}</b><i>${m.label}</i></span>`).join('');
          content.appendChild(row);
        }
        if (chart) {
          const cv = document.createElement('canvas');
          cv.className = 'result-chart';
          cv.width = chart.w || 260; cv.height = chart.h || 120;
          content.appendChild(cv);
          const legendHtml = chart.draw(cv);
          if (legendHtml) {
            const lg = document.createElement('div');
            lg.className = 'result-legend';
            lg.innerHTML = legendHtml;
            content.appendChild(lg);
          }
        }
        if (callout) {
          const c = document.createElement('div');
          c.className = 'result-callout';
          c.textContent = callout;
          content.appendChild(c);
        }
      }

      if (reducedMotion()) { body.appendChild(content); scrollChat(); return el; }

      el.classList.add('typing');
      body.appendChild(typingDots());
      scrollChat();

      let settled = false;
      let pendingId = null;
      const handle = {
        finish() {
          if (settled) return;
          settled = true;
          if (pendingId != null) { clearTimeout(pendingId); streamTimers.delete(pendingId); pendingId = null; }
          el.classList.remove('typing');
          body.textContent = '';
          content.classList.add('result-fade-in');
          body.appendChild(content);
          scrollChat();
          if (activeStream === handle) activeStream = null;
        },
      };
      activeStream = handle;
      const typingMs = 350 + Math.random() * 250;
      pendingId = trackTimeout(() => { pendingId = null; handle.finish(); }, typingMs);
      return el;
    }

    // ----------------------------------------------------- build state ----
    let vcount = 0;
    let lastChoice = { ratio: DEFAULT_RATIO };  // remembers the two applied defaults (no longer user-chosen, v4.2)
    let placing = false;     // a drag/auto-build animation is in flight
    let optimizing = false;  // an acquisition run is in flight
    let bannerShown = false; // challenge banner gate (fires once, on completion)
    let studioCtaShown = false; // standalone-studio contact CTA gate (fires once, on completion)

    // Enhanced Python Console: timestamped lines, Flow-style. A leading check-mark
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

    function addVar(label, name, type, size, val) {
      const cells = `<td class="node">${label || ''} <span style="color:var(--faint);font-weight:400">${name}</span></td><td class="type">${type}</td><td>${size}</td><td class="val">${val}</td>`;
      // dedupe: re-deciding a phase updates that node's variable in place rather than
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
    function setBadgeText(nodeId, text) {
      const n = nodes[nodeId];
      const tag = n && n.el && n.el.querySelector('.snode-tag');
      if (tag) tag.textContent = text;
    }

    // ------------------------------------------------ availability (v4) ----
    // "A node becomes available when its upstream exists" (Jason): a node can
    // be placed once every node feeding it (per edgeDefs) is itself placed.
    // Source nodes (no in-edges) are always available. This replaces v3's
    // single-"current phase" gate -- MULTIPLE nodes can be available/hinted at
    // once, and the visitor may act on any of them in any order.
    function upstreamIds(nodeId) {
      return [...new Set(edgeDefs.filter((e) => e.to === nodeId).map((e) => e.from))];
    }
    function isAvailable(nodeId) {
      return upstreamIds(nodeId).every((id) => nodes[id].placed);
    }
    function clearHints() {
      stage.querySelectorAll('.pal-node.hint').forEach((p) => {
        p.classList.remove('hint');
        p.style.position = '';
        p.style.pointerEvents = '';
      });
      stage.querySelectorAll('.studio-ghost.want').forEach((g) => g.classList.remove('want'));
    }
    function refreshAvailability() {
      clearHints();
      Object.keys(nodes).forEach((id) => {
        const n = nodes[id];
        if (n.placed || !isAvailable(id)) return;
        const pn = stage.querySelector(`.pal-node[data-node="${n.node}"]`);
        if (pn) {
          pn.classList.add('hint');
          // Defensive: a generic global ".hint" tooltip rule sets position:absolute
          // + pointer-events:none, which would rip the palette node out of its
          // column. Pin it in flow inline so it stays grabbable.
          pn.style.position = 'relative';
          pn.style.pointerEvents = 'auto';
        }
        if (n.ghost) n.ghost.classList.add('want');
      });
    }
    function groupWired(phaseId) {
      const phase = PHASES.find((p) => p.id === phaseId);
      return phase.nodeIds.every((id) => nodes[id].el && nodes[id].el.classList.contains('done'));
    }
    function buildComplete() { return PHASES.every((p) => groupWired(p.id)); }
    // the next unplaced node (place target), else the next placed-but-unwired
    // node (wire target), else null once the whole graph is built.
    function nextTargetInfo() {
      for (const id of NODE_ORDER) { if (!nodes[id].placed) return { node: nodes[id], mode: 'place' }; }
      for (const id of NODE_ORDER) {
        const n = nodes[id];
        if (n.placed && n.el && !n.el.classList.contains('done')) return { node: n, mode: 'wire' };
      }
      return null;
    }

    // -------------------------------------------------- place + wire core ----
    // Render the real node card into its slot with the drop-in animation, mark the
    // ghost filled. Idempotent: a second call is a no-op.
    function placeNode(nodeId) {
      const n = nodes[nodeId];
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

    // fires right after a node is placed: an anchored "what does this do"
    // popover (manual) or a short chat line (auto/autobuild).
    function onPlaced(nodeId, auto) {
      const n = nodes[nodeId];
      if (auto) {
        chatAgent(`Placed ${n.label}.`);
      } else {
        const text = (story.chat && story.chat.nodeWhat && story.chat.nodeWhat[nodeId]) || '';
        showPopover(n.el, { title: n.label, body: text });
      }
      refreshAvailability();
      renderPresets();
      armIdle();
    }

    // Wire a placed node: animate a packet down EVERY real incoming edge at once
    // (never just the one the user happened to drag from), glow each edge green,
    // run its effect, and advance the build. A source node (0 in-ports, e.g. the
    // Excel Readers or BO Init) wires instantly: Promise.all([]) resolves at once.
    async function wireNode(nodeId, auto = false) {
      const n = nodes[nodeId];
      if (!n.placed) { placeNode(nodeId); onPlaced(nodeId, auto); }
      n.el.classList.add('running');
      drawEdges();
      const incoming = edgeEls.filter((e) => e.to === nodeId);
      await Promise.all(incoming.map((e) => packet(e, svg)));
      await delay(120);
      n.el.classList.remove('running');
      n.el.classList.add('done');
      incoming.forEach((e) => { e.el.classList.add('hot'); e.live = true; });
      await onNodeDone(nodeId, auto);
    }

    // Fires once a node finishes wiring: (a) its small per-node var/log effect,
    // always; (b) the two real node parameters that USED to be chip/slider
    // decisions (train/test ratio at split, BO explore/exploit at boInit) now
    // just apply their default silently and, on a manual wire, surface an
    // anchored explainer popover naming what happened (no choice offered); (c)
    // if this completes its whole phase-group, that group's narrative beat +
    // result payoff; (d) the challenge banner gate check. async + awaited by
    // wireNode so autobuild's sequential loop waits for a group's result card
    // (e.g. the optimize run) to actually post before moving on to the next
    // phase -- otherwise the async optimize loop's card could land in the chat
    // AFTER the (synchronous) deploy card that follows it in build order,
    // reading out of sequence.
    async function onNodeDone(nodeId, auto) {
      nodeEffect(nodeId);
      if (nodeId === 'split') {
        // auto (autobuild): apply + post the usual chat "changed" card, same as
        // before. manual: apply silently and explain it in the popover instead
        // of also posting a chat card, so the visitor is not told twice.
        applyRatio(DEFAULT_RATIO, { silent: !auto });
        if (!auto) showSplitAppliedPopover();
      } else if (nodeId === 'boInit') {
        applyStrategyBase();
        if (!auto) showStrategyAppliedPopover();
      }
      if (auto) chatAgent(`Wired ${nodes[nodeId].label}.`);
      refreshAvailability();
      renderPresets();
      const phaseId = PHASE_FOR_NODE[nodeId];
      if (groupWired(phaseId)) {
        postBeat(phaseId);
        await runGroupPayoff(phaseId);
      }
      maybeShowChallengeBanner();
      maybeShowStudioCta();
      armIdle();
    }

    // Small, always-on console/vars effect for nodes whose real payoff is a
    // pure data-load (the two readers, BO Init). The other nodes' effects are
    // richer and fire once their whole phase-group completes (see runGroupPayoff).
    function nodeEffect(nodeId) {
      if (nodeId === 'readerX') {
        addVar('excel_reader', 'X', 'ndarray (float64)', `(${story.totalRuns}, ${surrogate.inputs.length})`, `Inputs (X), ${story.totalRuns} rows`);
        log(`excel_reader: loaded inputs (X), ${story.totalRuns} rows x ${surrogate.inputs.length} columns`);
      } else if (nodeId === 'readerY') {
        addVar('excel_reader', 'Y', 'ndarray (float64)', `(${story.totalRuns}, ${story.outputs.length})`, `Targets (Y), ${story.totalRuns} rows`);
        log(`excel_reader: loaded targets (Y), ${story.totalRuns} rows x ${story.outputs.length} columns`);
      } else if (nodeId === 'boInit') {
        addVar('bayesian_opt_init', 'bayesian_opt', 'BayesianOpt', DASH, 'search space initialized');
        log('bayesian_opt_init: search space initialized');
      } else if (nodeId === 'solver') {
        // v4.3: the automatic-BO domains' source node -- illustrative of a real
        // simulation hook, not a claimed performance figure (see chat.nodeWhat.solver).
        addVar('python_solver', 'evaluator', 'callable', DASH, 'registered (illustrative)');
        log('python_solver: registered as the automatic optimizer\'s evaluator (illustrative)');
      }
    }

    // the short reaction posted to chat once a whole phase-group is wired,
    // reusing the story's own beat/why copy (the "reactions... reusing the
    // story beats" Jason asked for). v4.3: the automatic-BO domains merge the
    // old separate `analyze` phase into `optimize`, so that completion posts
    // TWO short lines instead of one -- the mechanic (meta.beat: BO Init +
    // Python Solver + BO Optimize) then the Pareto narrative (branch.story) --
    // mirroring what used to be two separate phase completions.
    function postBeat(phaseId) {
      if (phaseId === 'analyze') {
        const text = branch.story || branch.why;
        if (text) chatAgent(text);
        return;
      }
      const meta = phaseMeta(story, phaseId, branch);
      if (phaseId === 'optimize' && automatic) {
        if (meta.beat) chatAgent(meta.beat);
        if (branch.story) chatAgent(branch.story);
        return;
      }
      const text = meta.beat || meta.why;
      if (text) chatAgent(text);
    }

    // -------- phase-group payoff: runs once every node in that group is wired --
    // async + awaits runOptimize specifically (the only genuinely asynchronous
    // payoff, an acquisition loop) so callers that await this (autobuild, via
    // wireNode -> onNodeDone) see result cards post in build order.
    async function runGroupPayoff(phaseId) {
      const meta = phaseMeta(story, phaseId, branch);
      if (phaseId === 'data') {
        chatResult({ title: meta.title, callout: meta.changed });
      } else if (phaseId === 'fit') {
        addVar('dimgp_regr_fit', 'models', 'DIM-GP', DASH, 'fitted');
        log('dimgp_regr_fit: trained on the split training set');
        chatResult({ title: meta.title, callout: meta.changed });
      } else if (phaseId === 'validate') {
        runValidate(meta);
      } else if (phaseId === 'analyze') {
        runAnalyze(meta);
      } else if (phaseId === 'optimize') {
        // v4.3: automatic-BO domains (engineering, bottle) have no Next Sample
        // to run an acquisition loop against; BO Optimize's own payoff IS the
        // Pareto chart (the merged analyze+optimize phase), so reuse the same
        // chart-drawing path runAnalyze uses, titled by the branch itself.
        if (automatic) runAutoOptimize(meta);
        else await runOptimize(meta);
      } else if (phaseId === 'deploy') {
        runDeploy(meta);
      }
      // 'split' has no group-level card here: applyRatio already posts the
      // "changed" card (autobuild) or the applied popover (manual) the moment
      // its default lands.
    }

    function runValidate(meta) {
      const out = story.defaultOutput;
      const z = 1.96;
      const { r2, rmse } = scoreFit(surrogate, out);
      addVar('pam_regr', 'pam_r2', 'float', DASH, fmt(r2, 3));
      addVar('', 'rmse', 'float', DASH, fmt(rmse, 3));
      log(`pam_regr: R2=${fmt(r2, 3)}, RMSE=${fmt(rmse, 3)} at 95% CI (z=${z}), the standard engineering default`);
      chatResult({
        title: meta.title,
        metrics: [
          { label: 'R2', value: fmt(r2, 3) },
          { label: 'RMSE', value: fmt(rmse, 3) },
          { label: 'CI', value: '95% (z 1.96)' },
        ],
        chart: { draw: (cv) => { drawPredTrue(cv, surrogate, out); } },
        callout: meta.changed,
      });
    }

    // The per-industry analyze branch: a real readout chart, computed directly,
    // no decision chip (the chart IS the deliverable).
    function runAnalyze(meta) {
      chatResult({
        title: meta.title,
        chart: {
          w: 260, h: 138,
          draw: (cv) => {
            try {
              if (branch.kind === 'tornado') {
                const items = tornadoItems(surrogate, story, story.defaultOutput);
                if (Charts.drawTornado) Charts.drawTornado(cv, items);
                else fallbackBars(cv, items.map((i) => ({ label: i.label, v: i.importance })));
                log(`${branch.node}: ranked axis influence on ${story.defaultOutput}`);
                return items.map((i) => `<span class="lg-row"><b>${i.label}</b> ${fmt(i.importance * 100, 0)}%</span>`).join('');
              }
              if (branch.kind === 'pareto') {
                const pair = paretoPair(story, null);
                const points = paretoPoints(surrogate, pair);
                if (Charts.drawPareto) Charts.drawPareto(cv, points, {
                  aLabel: labelFor(surrogate, pair[0]), bLabel: labelFor(surrogate, pair[1]),
                  aGoal: goalFor(story, pair[0]), bGoal: goalFor(story, pair[1]),
                });
                else fallbackScatter(cv, points);
                log(`${branch.node}: Pareto front of ${pair[0]} vs ${pair[1]} (${points.length} grid samples)`);
                return `<span class="lg-row"><b>${labelFor(surrogate, pair[0])}</b> vs <b>${labelFor(surrogate, pair[1])}</b>, front highlighted</span>`;
              }
              // correlation (dist_cor)
              const pairs = correlationPairs(surrogate, story);
              if (Charts.drawCorrelation) Charts.drawCorrelation(cv, pairs);
              else fallbackBars(cv, pairs.map((p) => ({ label: p.label, v: Math.abs(p.r) })));
              log(`${branch.node}: distance correlation across ${pairs.length} output pairs`);
              return pairs.map((p) => `<span class="lg-row"><b>${p.label}</b> r ${fmt(p.r, 2)}</span>`).join('');
            } catch (e) {
              return `<span class="lg-row">Chart unavailable (${e.message})</span>`;
            }
          },
        },
        callout: branch.changed || meta.changed,
      });
    }

    // -------- automatic-BO domains only (engineering, bottle): BO Optimize's
    // own payoff once boInit + solver + branch are all wired. Honest console
    // line first (the automatic run against the connected solver), then the
    // SAME Pareto chart runAnalyze draws, titled by the branch itself (the
    // merged phase's chart card reads "Map the Pareto trade-off", matching
    // what used to be the separate analyze phase's card title). ----------
    function runAutoOptimize(meta) {
      addVar('bayesian_opt_optimize', 'models', 'DIM-GP', DASH, 'refit by the automatic loop');
      log(`${branch.node}: ran the automatic loop against the connected solver (bo_obj + true_evaluator), refitting the model each iteration`);
      runAnalyze({ title: branch.title || branch.label || meta.title });
    }

    // -------- train_test_split: real default, explained, no chips (v4.2) -----
    // The 70% default already applied (silently) in onNodeDone right before
    // this runs; this just anchors a small popover on the split node stating
    // what the node does plus the split it just used, matching the console
    // line. No control, nothing to click, only the popover box itself
    // dismisses it -- the canvas underneath stays fully interactive.
    function showSplitAppliedPopover() {
      const pct = Math.round(DEFAULT_RATIO * 100);
      const train = resolveTrainCount(story, DEFAULT_RATIO);
      const test = story.totalRuns - train;
      const what = (story.chat && story.chat.nodeWhat && story.chat.nodeWhat.split) ||
        'Train/Test Split holds back real validation data.';
      showPopover(nodes.split.el, {
        title: 'Train / test split',
        body: `${what} Default applied: ${pct}% train (${train} runs), ${100 - pct}% held out for validation (${test} runs).`,
      });
    }
    function applyRatio(value, opts = {}) {
      lastChoice.ratio = value;
      const train = resolveTrainCount(story, value);
      const test = story.totalRuns - train;
      const pct = Math.round(value * 100);
      addVar('train_test_split', 'X_train', 'ndarray (float64)', `(${train}, ${surrogate.inputs.length})`, `${pct}% train`);
      addVar('', 'Y_train', 'ndarray (float64)', `(${train}, 1)`, `${pct}% train`);
      log(`train_test_split: ${pct}% train (${train} runs), ${100 - pct}% held out for validation (${test} runs)`);
      setBadgeText('split', `${pct}/${100 - pct}`);
      if (!opts.silent) {
        const meta = phaseMeta(story, 'split', branch);
        chatResult({ title: meta.title, callout: meta.changed });
      }
    }

    // -------- bayesian_opt_init: real default, explained, no slider (v4.2) ---
    // Fires on placing/wiring bayesian_opt_init (before Next Sample even
    // exists): the goal (read from the modeled property, never chosen) and the
    // balanced default acquisition weighting both apply immediately and
    // silently. A manual wire also anchors a small popover stating what the
    // node does plus the balance it is using -- nothing to tune, nothing to
    // click but the popover's own dismissal.
    function applyStrategyBase() {
      const goal = goalFor(story, story.defaultOutput);
      lastChoice.goal = goal;
      if (lastChoice.strategy == null) lastChoice.strategy = DEFAULT_KAPPA;
      addVar('bayesian_opt_init', 'goal', 'str', DASH, goal);
      log(`bayesian_opt_init: objective goal = ${goal}, read from ${labelFor(surrogate, story.defaultOutput)}`);
    }
    function showStrategyAppliedPopover() {
      const meta = phaseMeta(story, 'optimize', branch);
      const what = (story.chat && story.chat.nodeWhat && story.chat.nodeWhat.boInit) ||
        'BO Init configures the search space for the next sample.';
      const balance = meta.appliedInfo ||
        'It balances trying promising candidates against probing regions STOCHOS is still unsure about.';
      showPopover(nodes.boInit.el, { title: 'Explore and exploit', body: `${what} ${balance}` });
    }

    // real acquisition loop (Next Sample), run once boInit + boNext are both
    // wired, and replayable via the "Run optimize again" preset. Uses the
    // Surrogate directly (surrogate.nextSample/addSample), the same math
    // StudioField.step() used to wrap -- see ARCHITECTURE.md's honesty rule:
    // conf% = 100*(1 - CI_half_width/|mean|).
    async function runOptimize(meta) {
      if (optimizing) return;
      optimizing = true;
      renderPresets();
      const out = story.defaultOutput;
      const goal = goalFor(story, out);
      const kappa = lastChoice.strategy != null ? lastChoice.strategy : DEFAULT_KAPPA;
      const outLabel = labelFor(surrogate, out);
      const outMeta = surrogate.outputs.find((o) => o.name === out);
      const n = 6;
      let best = null;
      for (let i = 0; i < n; i++) {
        if (!stage.isConnected) { optimizing = false; return; }
        const r = stepAcquisition(surrogate, out, goal, kappa);
        if (!r) break;
        if (!best || better(r, best, goal, outMeta)) best = r;
        const confTxt = r.conf != null ? `${fmt(r.conf, 0)}%` : 'n/a';
        addVar(`bayesian_opt_next_sample #${i + 1}`, 'X_next', 'ndarray', `(1, ${surrogate.inputs.length})`, `[${fmt(r.x, 2)}, ${fmt(r.y, 2)}, ...]`);
        log(`bayesian_opt_next_sample: sampled ${out}=${fmt(r.mean, 2)} at (${fmt(r.x, 2)}, ${fmt(r.y, 2)}), conf ${confTxt}`);
        await delay(380);
      }
      optimizing = false;
      renderPresets();
      if (!stage.isConnected || !best) return;
      chatResult({
        title: meta.title,
        metrics: [
          { label: `Best ${outLabel}`, value: fmt(best.mean, 2) },
          { label: 'At', value: `${fmt(best.x, 2)}, ${fmt(best.y, 2)}` },
          { label: 'Confidence', value: best.conf != null ? `${fmt(best.conf, 0)}%` : 'n/a' },
        ],
        callout: 'The uncertainty has thinned around the points STOCHOS sampled.',
      });
    }

    function runDeploy(meta) {
      chatResult({
        title: meta.title,
        build: (host) => {
          revealDeploy(story, surrogate, host);
          if (meta.changed) {
            const c = document.createElement('div');
            c.className = 'result-callout';
            c.textContent = meta.changed;
            host.appendChild(c);
          }
        },
      });
    }

    // ------------------------------------------------------- challenge gate --
    // Change 5: the "See the showdown" banner only appears once the whole
    // graph is built, never on entry.
    function maybeShowChallengeBanner() {
      if (!challengeCtx || bannerShown || !buildComplete()) return;
      bannerShown = true;
      addChallengeBanner(surrogate);
    }

    // Standalone studio only (challenge mode gets the showdown banner instead).
    function maybeShowStudioCta() {
      if (challengeCtx || studioCtaShown || !buildComplete()) return;
      studioCtaShown = true;
      addStudioCtaBanner();
    }

    // --------------------------------------------------------- idle nudge ----
    function armIdle() {
      clearTimeout(idleTimer);
      if (buildComplete()) return;
      idleTimer = setTimeout(() => {
        if (!stage.isConnected || buildComplete()) return;
        chatAgent('Take your time. Drag any pulsing node from the palette, or tap "Build the workflow for me" below.');
      }, 12000);
    }

    // ------------------------------------------------------- chat presets ----
    function renderPresets() {
      const host = $('#chatPresets');
      if (!host) return;
      host.innerHTML = '';
      const complete = buildComplete();
      const info = nextTargetInfo();
      const whatTarget = info ? info.node : nodes.webapp;
      const chips = [
        { label: `What does ${whatTarget.label} do?`, fn: () => presetWhatDoes(whatTarget.id) },
        { label: 'Explain this workflow', fn: presetExplainWorkflow },
      ];
      if (!complete) {
        chips.push({ label: 'What should I do next?', fn: presetWhatNext });
        chips.push({ label: 'Build the workflow for me', fn: presetBuild });
      } else {
        chips.push({ label: 'Explain the result', fn: presetExplainResult });
      }
      if (nodes.boNext && nodes.boNext.el && nodes.boNext.el.classList.contains('done')) {
        chips.push({ label: 'Run optimize again', fn: presetRunAgain });
      }
      chips.forEach((c) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chat-chip';
        b.textContent = c.label;
        b.onclick = () => { if (!placing && !optimizing) c.fn(); };
        host.appendChild(b);
      });
    }
    function presetWhatDoes(nodeId) {
      const n = nodes[nodeId];
      chatUser(`What does ${n.label} do?`);
      const text = (story.chat && story.chat.nodeWhat && story.chat.nodeWhat[nodeId]) || `${n.label} is part of the Stochos Flow workflow.`;
      chatAgent(text);
      armIdle();
    }
    function presetExplainWorkflow() {
      chatUser('Explain this workflow.');
      chatAgent((story.chat && story.chat.explainWorkflow) || story.pitch || 'This workflow trains a real model on your data, validates it honestly, then proposes the next experiment.');
      armIdle();
    }
    function presetWhatNext() {
      chatUser('What should I do next?');
      const info = nextTargetInfo();
      if (!info) { chatAgent('The workflow is complete. Try "Explain the result."'); armIdle(); return; }
      const { node, mode } = info;
      if (node.ghost) node.ghost.classList.add('want');
      chatAgent(mode === 'place'
        ? `Drag the ${node.label} node from the palette onto the "${node.slot}" slot.`
        : `${node.label} is placed. Wire it: drag from an upstream output port into its input port.`);
      armIdle();
    }
    function presetBuild() {
      chatUser('Build the workflow for me.');
      autobuild();
    }
    function presetExplainResult() {
      chatUser('Explain the result.');
      chatAgent((story.chat && story.chat.explainResult) || 'The workflow is built end to end: a trained model, a validated fit, an analysis chart, a proposed next experiment, and a deployed predictor.');
      armIdle();
    }
    function presetRunAgain() {
      chatUser('Run optimize again.');
      runOptimize(phaseMeta(story, 'optimize', branch));
      armIdle();
    }

    // welcome message: goal + drag hint, plus the challenge context line when
    // handed off from "Beat Stochos" (change 5: the banner itself stays gated,
    // but this short entry line is allowed).
    function postWelcome() {
      const text = (story.chat && story.chat.welcome) ||
        `Pick nodes from the palette and build the ${story.tag} workflow: drag a node onto its dashed slot, then wire it to its upstream source.`;
      chatAgent(text, 'Agent');
      if (challengeCtx) {
        const score = challengeCtx.userBest && isFinite(challengeCtx.userBest.score) ? Math.round(challengeCtx.userBest.score) : null;
        chatAgent(score != null
          ? `You locked ${score}. Build the workflow, then settle the score.`
          : 'Build the workflow, then settle the score.');
      }
    }

    // ------------------------------ palette drag ------------------------------
    // Pointer-drag a node from the palette. A floating ghost follows the cursor;
    // dropping it over ANY unplaced ghost slot that WANTS this node type snaps it
    // in (v4: not gated to a single "current phase" target -- whichever available
    // slot the visitor drops on). A wrong node, or a slot whose upstream is not
    // ready yet, springs back with a one-line popover hint.
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
        stage.querySelectorAll('.studio-ghost.target').forEach((g) => g.classList.remove('target'));
        Object.keys(nodes).forEach((id) => {
          const n = nodes[id];
          if (n.placed || n.node !== nodeName || !n.ghost) return;
          if (hitGhost(n.ghost, ev.clientX, ev.clientY)) n.ghost.classList.add('target');
        });
      };
      // AUDIT FIX 6: cleanup shared by a normal drop AND a mid-drag teardown
      // (studioTeardown / the returned destroy() call this if the user navigates
      // away with the pointer still down, so the clone + document listeners never leak).
      const cleanup = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        pn.classList.remove('dragging');
        fly.remove();
        stage.querySelectorAll('.studio-ghost.target').forEach((g) => g.classList.remove('target'));
      };
      const up = (ev) => {
        cleanup();
        _dragCleanup = null;
        const overId = Object.keys(nodes).find((id) => !nodes[id].placed && nodes[id].ghost && hitGhost(nodes[id].ghost, ev.clientX, ev.clientY));
        if (!overId) return;
        const target = nodes[overId];
        if (target.node !== nodeName) {
          showPopover(target.ghost, { body: `That slot wants the ${target.label} node.` });
          return;
        }
        if (!isAvailable(overId)) {
          const missing = upstreamIds(overId).filter((id) => !nodes[id].placed).map((id) => nodes[id].label);
          showPopover(target.ghost, { body: `Place ${missing.join(' and ')} first.` });
          return;
        }
        placeNode(overId);
        onPlaced(overId, false);
        if (target.inN === 0) wireNode(overId, false);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
      _dragCleanup = cleanup;
    }
    function hitGhost(g, cx, cy) {
      const r = g.getBoundingClientRect();
      const pad = 40;
      return cx >= r.left - pad && cx <= r.right + pad && cy >= r.top - pad && cy <= r.bottom + pad;
    }

    // ------------------------------ port wiring -------------------------------
    // Drag from a placed node's OUTPUT port to a compatible INPUT port. While
    // dragging, a rubber-band wire follows the cursor and every compatible input
    // port (across ALL downstream nodes this output feeds, v4: not just the one
    // "current phase" target) glows. Releasing near one wires the WHOLE
    // downstream node (every real edge into it, not just the one dragged), so
    // one drag is enough regardless of how many in-ports that node has.
    function bindPorts(n) {
      if (!n.el) return;
      const ports = n.el.querySelectorAll('.port');
      ports.forEach((p, idx) => {
        // outputs are the right-side ports (index >= inN)
        const isOut = idx >= n.inN;
        if (!isOut) return;
        p.dataset.role = 'out';
        p.addEventListener('pointerdown', (e) => startWire(e, n, idx - n.inN));
      });
    }
    function candidateTargetsFrom(fromId) {
      const tos = [...new Set(edgeDefs.filter((e) => e.from === fromId).map((e) => e.to))];
      return tos.map((id) => nodes[id]).filter((n) => n.placed && n.el && !n.el.classList.contains('done'));
    }
    function inPortsFed(targetId, fromId) {
      const idxs = edgeDefs.filter((e) => e.to === targetId && e.from === fromId).map((e) => e.toPort);
      const portEls = nodes[targetId].el.querySelectorAll('.port');
      return idxs.map((i) => portEls[i]).filter(Boolean);
    }
    function startWire(e, fromNode, fromPort) {
      if (placing) return;
      e.preventDefault();
      e.stopPropagation();
      const candidates = candidateTargetsFrom(fromNode.id);
      if (!candidates.length) return; // nothing placed yet that this output feeds
      const compatible = [];
      candidates.forEach((c) => {
        inPortsFed(c.id, fromNode.id).forEach((p) => { p.classList.add('compatible'); compatible.push({ el: p, targetId: c.id }); });
      });
      if (!compatible.length) return;
      dragWire.style.display = '';
      const s = port(fromNode, 'out', fromPort);
      const move = (ev) => {
        const pt = toGraph(ev.clientX, ev.clientY);
        dragWire.setAttribute('d', edgePath(s, pt));
      };
      // AUDIT FIX 6: cleanup shared by a normal release AND a mid-drag teardown.
      const cleanup = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        dragWire.style.display = 'none';
        dragWire.setAttribute('d', '');
        compatible.forEach((c) => c.el.classList.remove('compatible'));
      };
      const up = (ev) => {
        cleanup();
        _dragCleanup = null;
        let hit = null;
        compatible.forEach(({ el, targetId }) => {
          const r = el.getBoundingClientRect();
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          if (Math.hypot(ev.clientX - cx, ev.clientY - cy) < 46) hit = targetId;
        });
        if (hit) wireNode(hit, false);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
      _dragCleanup = cleanup;
      move(e);
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
        closePopover(); // avoid a stale-positioned popover while the card moves
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

    // --------------------------- escape hatch: autobuild -----------------------
    // The ONLY escape hatch left (v4 drops the old per-phase "Connect for me" --
    // there is no more "phase" to partially auto-connect once the build is
    // ungated). Triggered by the "Build the workflow for me" preset chip AND the
    // toolbar Run button. Places + wires every remaining node in build order,
    // streaming short agent lines to chat as it goes -- exactly what the real
    // Flow agent does.
    async function autobuild() {
      if (placing) return;
      placing = true;
      closePopover();
      renderPresets();
      chatAgent('Building the workflow now.');
      log('agent: auto-assembling workflow...');
      for (const phase of PHASES) {
        for (const id of phase.nodeIds) {
          const n = nodes[id];
          if (n.el && n.el.classList.contains('done')) continue;
          if (!n.placed) {
            placeNode(id);
            onPlaced(id, true);
            log(`agent: placed ${n.node}`);
            await delay(150);
          }
          if (!stage.isConnected) { placing = false; return; }
          log(`agent: wired ${n.node}`);
          await wireNode(id, true);
          await delay(150);
          if (!stage.isConnected) { placing = false; return; }
        }
      }
      placing = false;
      renderPresets();
    }

    // ------------------------------ wire up UI --------------------------------
    buildPalette($('#palette'), branch);
    buildPaletteDrag();

    // reset the idle timer on any pointer activity in the stage
    stage.addEventListener('pointerdown', () => { if (!placing) armIdle(); });

    refreshAvailability();
    postWelcome();
    renderPresets();
    armIdle();
  }

  // M3 fix: return a teardown to main.js so it can remove the resize listener,
  // close any open popover, and cancel a live drag when the user navigates away
  // from #/studio via the site nav. The teardown uses the outer-scoped bindings
  // so it always targets the live listener/cleanup from the most recent
  // buildStage call. If the user is still on the picker (no buildStage called
  // yet), those bindings are null and the teardown is a safe no-op.
  return {
    destroy() {
      clearTimeout(idleTimer);  // AUDIT FIX 5
      if (_popoverCleanup) { _popoverCleanup(); _popoverCleanup = null; }
      if (_dragCleanup) { _dragCleanup(); _dragCleanup = null; }  // AUDIT FIX 6
      if (_streamCleanup) { _streamCleanup(); _streamCleanup = null; }  // v4.1: cancel chat typing/streaming timers
      if (_onResize) { window.removeEventListener('resize', _onResize); _onResize = null; }
    },
  };
}

// ============================ deploy result card ===========================
// The deployed-web-app preview: 2 axis sliders -> live surrogate.predict, shown
// as mean +/- z*std as a labeled band, plus a real-looking (non-functional)
// Download. v4: renders into a chat result card's body (host) instead of the
// removed docked viewer's "Web app" pane -- same honest content either way.
function revealDeploy(story, surrogate, host) {
  if (!host) return;

  const out = story.defaultOutput;
  const o = surrogate.outputs.find((x) => x.name === out) || surrogate.outputs[0];
  const outName = o ? o.name : out;
  const outLabel = o ? (o.label || o.name) : out;
  const outUnit = o && o.unit ? o.unit : '';
  const z = 1.96;

  const sliders = (story.deploy && story.deploy.sliders) || story.axes || [];
  const inputs = sliders.map((name) => surrogate.inputs.find((i) => i.name === name)).filter(Boolean);

  host.innerHTML = `
    <div class="deploy-head">
      <span class="deploy-badge">Deployed web app preview</span>
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

  const ctl = host.querySelector('#depCtl');
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

  const meanEl = host.querySelector('#depMean');
  const bandEl = host.querySelector('#depBand');
  const fillEl = host.querySelector('#depFill');
  const barBand = host.querySelector('#depBarBand');
  const ax = story.axes || [];
  function recompute() {
    const x = state[ax[0]] != null ? state[ax[0]] : surrogate.axisInput(0).default;
    const y = state[ax[1]] != null ? state[ax[1]] : surrogate.axisInput(1).default;
    // The deployed app reports the TRAINED model's predictive uncertainty, not any
    // transient acquisition scratch state, so predict against the base field (no
    // active-learning shrink from prior optimize-phase samples).
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
  host.querySelector('#depDl').onclick = (e) => { e.preventDefault(); };
}

// ============================ acquisition (v4) =============================
// Direct-Surrogate replacements for what StudioField.step()/confAt() used to
// wrap, now that the docked field renderer is gone. Same math, same honesty
// rule: conf% = 100*(1 - CI_half_width/|mean|), clamped [0,100].
function confAt(surrogate, name, x, y, z = 1.96) {
  const { mean, std } = surrogate.predict(name, x, y);
  const denom = Math.abs(mean) || 1e-9;
  const c = 100 * (1 - (z * std) / denom);
  return Math.max(0, Math.min(100, c));
}
function stepAcquisition(surrogate, name, goal, kappa) {
  const acqGoal = goal === 'window' ? 'explore' : goal;
  const p = surrogate.nextSample(name, acqGoal, kappa);
  if (!p) return null;
  surrogate.addSample(p.x, p.y); // shrink local uncertainty at the chosen location (real GP-like effect)
  return { x: p.x, y: p.y, mean: p.mean, std: p.std, conf: confAt(surrogate, name, p.x, p.y) };
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

// the two competing outputs for the engineering/bottle pareto (defaults to the
// first two 'low'-goal outputs, e.g. peak_temp vs pressure_drop).
function paretoPair(story, controlValue) {
  const outs = story.outputs || [];
  if (controlValue && controlValue.includes('|')) return controlValue.split('|');
  const lows = outs.filter((n) => goalFor(story, n) === 'low');
  if (lows.length >= 2) return [lows[0], lows[1]];
  return [outs[0], outs[1]];
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
// Open Nodes Folder buttons, then amber-triangle category groups, using the REAL
// Flow category names and node names/icons (from vendor/node-icons + flow.md's
// catalog). The pipeline nodes keep their exact data-node so refreshAvailability
// can pulse whichever ones are currently placeable; the per-industry branch node
// is always included even if it is not one of the "core" library rows below.
function buildPalette(el, branch) {
  el.innerHTML = `
    <div class="sf-search"><span class="sf-search-icon">&#128269;</span><input class="flow-search sf-search-input" placeholder="Search nodes..." /></div>
    <div class="sf-palbtns">
      <button class="sf-palbtn">Export Node</button>
      <button class="sf-palbtn">Import Node</button>
    </div>
    <button class="sf-palbtn sf-palbtn-wide"><span class="sf-folder">&#128193;</span> Open Nodes Folder</button>`;

  // amber-triangle categories using the real Flow category names. Each node row is
  // [data-node, label, icon, robot?, sub?]. Only icons that ship as SVGs are used.
  // v4.3 (ground-truth audit fix, palette fidelity): the real GUI's visible
  // palette groups are "Generative / Input / Misc / Modelling" (reference/
  // flow-gui.md) plus the real taxonomy separates Validation/metrics from
  // Model fit/predict -- so `pam_regr` moves out of Modelling into its own
  // Validation group, a one-row Generative group is added (a real distractor
  // node, `gen_model_fit`, reusing the closest shipped icon -- no icon file is
  // fabricated), and the classification distractor's id is fixed to the real
  // `dimgp_clf_fit` (display label unchanged).
  const lib = {
    Generative: [
      ['gen_model_fit', 'Gen Model', 'dimgp_fit', false, true],
    ],
    Input: [
      ['excel_reader', 'Excel Reader', 'excel_reader'],
    ],
    Preprocessing: [
      ['train_test_split', 'Train/Test Split', 'train_test_split'],
      ['column_splitter', 'Column Splitter', 'column_splitter'],
    ],
    Modelling: [
      ['dimgp_regr_fit', 'DIM-GP Fit', 'dimgp_fit'],
      ['dimgp_clf_fit', 'DIM-GP Classification', 'dimgp_predict', false, true],
    ],
    Validation: [
      ['pam_regr', 'PAM Validation', 'pam_regr'],
    ],
    Sensitivity: [
      ['sobol_indices', 'Sobol Indices', 'sobol_indices'],
      ['dist_cor', 'Distance Correlation', 'plot_bar'],
      ['shap_values', 'SHAP Values', 'plot_bar', false, true],
    ],
    Optimization: [
      ['bayesian_opt_init', 'BO Init', 'bo_init'],
      ['bayesian_opt_next_sample', 'Next Sample', 'bo_next'],
      ['bayesian_opt_optimize', 'BO Optimize', 'bo_optimize'],
    ],
    Deploy: [
      ['web_app_scalar', 'Web App Export', 'smart_data_loader'],
    ],
    Agents: [
      ['smart_data_loader', 'Smart Data Loader', 'smart_data_loader', true],
    ],
    Misc: [
      ['python_solver', 'Python Solver', 'python_solver'],
      ['plot_predicted_vs_observed', 'Pred vs Observed', 'plot_scatter'],
    ],
  };

  // make sure the per-industry branch node has a palette row (some branches reuse a
  // node already listed; only inject when it is missing).
  const present = Object.values(lib).some((rows) => rows.some((r) => r[0] === branch.node));
  if (!present) (lib.Sensitivity).push([branch.node, branch.label, branch.icon]);

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
// left (in) / right (out) carrying data-role + data-label (the real port name,
// shown on hover), an optional small text badge (X, Y, FIT, INIT, NEXT, SIM, PAM,
// APP, a live ratio, ...), a green done-check, and the friendly label BELOW the tile.
// PORT FIX (v4): each port is positioned at left:0%/100% + top:N% of the CARD's
// OWN box (not the outer .snode footprint), then CSS centers it exactly on that
// coordinate via transform:translate(-50%,-50%) -- a clean full circle dead on
// the card edge, never clipped, regardless of the card's pixel size.
function renderNode(n, graph) {
  const el = document.createElement('div');
  el.className = 'snode';
  el.dataset.id = n.id;
  el.style.left = n.x + 'px';
  el.style.top = n.y + 'px';
  el.style.setProperty('--cat', CAT[n.cat] || '#888');
  let ports = '';
  n.ins.forEach((label, i) => {
    const topPct = ((i + 1) / (n.ins.length + 1) * 100).toFixed(2);
    ports += `<span class="port" data-role="in" data-label="${label}" title="${label}" style="left:0%;top:${topPct}%"></span>`;
  });
  n.outs.forEach((label, i) => {
    const topPct = ((i + 1) / (n.outs.length + 1) * 100).toFixed(2);
    ports += `<span class="port" data-role="out" data-label="${label}" title="${label}" style="left:100%;top:${topPct}%"></span>`;
  });
  const badge = n.badge;
  const badgeEl = badge ? `<span class="snode-tag">${badge}</span>` : '';
  el.innerHTML = `<div class="snode-card"><img src="${IC}${n.icon}.svg" alt="">${badgeEl}${ports}<div class="snode-badge">&#10003;</div></div><div class="snode-label">${n.label || n.node}</div>`;
  graph.appendChild(el);
  n.el = el;
}

// PORT FIX (v4): matches the CSS above exactly. cardLeft/cardTop are the CARD's
// (not the wrapper's) absolute position: the card is centred inside the NW-wide
// .snode via a (NW-CARD_W)/2 gutter, and flush with the wrapper's top (the label
// sits below it). CARD_W/CARD_H must match .sf-app .snode-card's real size in
// styles.css (currently 66x66) -- see the constant's own comment above.
function port(n, kind, idx) {
  const count = kind === 'out' ? n.outN : n.inN;
  const cardLeft = n.x + (NW - CARD_W) / 2;
  const cardTop = n.y;
  return {
    x: kind === 'out' ? cardLeft + CARD_W : cardLeft,
    y: cardTop + (idx + 1) / (Math.max(1, count) + 1) * CARD_H,
  };
}

// Robust bezier routing (fixes the "wire loops over the node it just left" bug).
// Two cases:
//   - FORWARD (target strictly right of the source, dx>0): a plain horizontal-
//     tangent cubic with an offset capped at dx*0.42. This is geometrically safe
//     for ANY positive dx (the two control points can never cross, since
//     2*(dx*0.42) < dx), so it is always used when the target is to the right,
//     even by a small margin.
//   - BACKWARD/STACKED (target at or left of the source's x, dx<=0 -- same
//     column, or a node the user dragged past its upstream neighbor): a clamped,
//     vertically-bowed S-curve that exits/enters through a FIXED minimum
//     clearance (not a distance-derived one) and bows toward whichever side the
//     target sits on, so it routes around instead of through.
function edgePath(s, t) {
  const dx = t.x - s.x;
  if (dx > 0) {
    const off = Math.max(18, Math.min(150, dx * 0.42));
    return `M ${s.x},${s.y} C ${s.x + off},${s.y} ${t.x - off},${t.y} ${t.x},${t.y}`;
  }
  const MIN_OFF = 30;
  const dy = t.y - s.y;
  const dir = dy === 0 ? 1 : Math.sign(dy);
  const bow = dir * Math.max(46, Math.abs(dy) * 0.5 + 30);
  const c1x = s.x + MIN_OFF, c1y = s.y + bow * 0.5;
  const c2x = t.x - MIN_OFF, c2y = t.y - bow * 0.5;
  return `M ${s.x},${s.y} C ${c1x},${c1y} ${c2x},${c2y} ${t.x},${t.y}`;
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

// graph model: node identities (real Stochos Flow names/labels/icons) and the
// edges between them. Domain-agnostic except the analyze/optimize branch,
// which comes from `branch` (story.branch, resolved via resolveBranch below).
// v4.3 (ground-truth audit fix): `branch.kind === 'pareto'` (engineering,
// bottle) switches the node set onto the AUTOMATIC-BO pattern -- no
// `bayesian_opt_next_sample`, a `solver` (python_solver) source node added,
// and `branch` itself becomes the merged optimize+analyze node
// (bayesian_opt_optimize, ins bo_obj/true_evaluator, outs X/Y/models -- it
// never takes a trained `models` input, it produces its own). Every other
// domain keeps the original manual-BO Next-Sample node.
function buildNodeDefs(branch) {
  const automatic = branch.kind === 'pareto';
  const defs = {
    readerX: { node: 'excel_reader', label: 'Inputs (X)', icon: 'excel_reader', cat: 'input', slot: 'Inputs (X)', badge: NODE_BADGE.readerX, ins: [], outs: ['X'] },
    readerY: { node: 'excel_reader', label: 'Targets (Y)', icon: 'excel_reader', cat: 'input', slot: 'Targets (Y)', badge: NODE_BADGE.readerY, ins: [], outs: ['Y'] },
    split:   { node: 'train_test_split', label: 'Train/Test Split', icon: 'train_test_split', cat: 'preprocessing', slot: 'Split', badge: NODE_BADGE.split, ins: ['X', 'Y'], outs: ['X_train', 'Y_train'] },
    fit:     { node: 'dimgp_regr_fit', label: 'DIM-GP Fit', icon: 'dimgp_fit', cat: 'modelling', slot: 'Model', badge: NODE_BADGE.fit, ins: ['X', 'Y'], outs: ['models'] },
    pam:     { node: 'pam_regr', label: 'PAM Validation', icon: 'pam_regr', cat: 'validation', slot: 'Validation', badge: NODE_BADGE.pam, ins: ['X_train', 'Y_train', 'models'], outs: ['pam_scores'] },
    boInit:  { node: 'bayesian_opt_init', label: 'BO Init', icon: 'bo_init', cat: 'optimization', slot: 'BO Init', badge: NODE_BADGE.boInit, ins: [], outs: ['bayesian_opt'] },
    webapp:  { node: 'web_app_scalar', label: 'Web App Export', icon: 'smart_data_loader', cat: 'misc', slot: 'Web app', badge: NODE_BADGE.webapp, ins: ['models', 'X', 'Y'], outs: [] },
  };
  if (automatic) {
    defs.solver = { node: 'python_solver', label: 'Python Solver', icon: 'python_solver', cat: 'misc', slot: 'Simulation', badge: NODE_BADGE.solver, ins: [], outs: ['evaluator'] };
    defs.branch = { node: branch.node, label: branch.label, icon: branch.icon, cat: 'optimization', slot: branch.label, badge: branch.badge, ins: branch.ins, outs: branch.outs || [] };
  } else {
    defs.branch = { node: branch.node, label: branch.label, icon: branch.icon, cat: 'sensitivity', slot: branch.label, badge: branch.badge, ins: branch.ins, outs: branch.outs || [] };
    defs.boNext = { node: 'bayesian_opt_next_sample', label: 'Next Sample', icon: 'bo_next', cat: 'optimization', slot: 'Optimizer', badge: NODE_BADGE.boNext, ins: ['bo_obj', 'models', 'X', 'Y'], outs: ['X_next', 'Y_next'] };
  }
  return defs;
}
function buildEdgeDefs(branch) {
  const automatic = branch.kind === 'pareto';
  const edges = [
    { from: 'readerX', fromPort: 0, to: 'split', toPort: 0 },
    { from: 'readerY', fromPort: 0, to: 'split', toPort: 1 },
    { from: 'split', fromPort: 0, to: 'fit', toPort: 0 },
    { from: 'split', fromPort: 1, to: 'fit', toPort: 1 },
    { from: 'split', fromPort: 0, to: 'pam', toPort: 0 },
    { from: 'split', fromPort: 1, to: 'pam', toPort: 1 },
    { from: 'fit', fromPort: 0, to: 'pam', toPort: 2 },
    { from: 'fit', fromPort: 0, to: 'webapp', toPort: 0 },
    { from: 'readerX', fromPort: 0, to: 'webapp', toPort: 1 },
    { from: 'readerY', fromPort: 0, to: 'webapp', toPort: 2 },
  ];
  if (automatic) {
    // boInit -> branch (bo_obj) + solver -> branch (true_evaluator), from story.branch.edges.
    edges.push(...(branch.edges || []));
  } else {
    edges.push(
      { from: 'boInit', fromPort: 0, to: 'boNext', toPort: 0 },
      { from: 'fit', fromPort: 0, to: 'boNext', toPort: 1 },
      { from: 'readerX', fromPort: 0, to: 'boNext', toPort: 2 },
      { from: 'readerY', fromPort: 0, to: 'boNext', toPort: 3 },
      ...(branch.edges || []), // the analyze branch's own inbound edges (dist_cor / sobol_indices)
    );
  }
  return edges;
}

// the per-industry branch identity for the analyze phase (story.branch, else the
// real-node fallback keyed by domain).
function resolveBranch(story, domain) {
  const fb = BRANCH_FALLBACK[domain] || BRANCH_FALLBACK.engineering;
  const b = story.branch || {};
  return {
    node: b.node || fb.node, icon: b.icon || fb.icon, label: b.label || fb.label, kind: b.kind || fb.kind,
    badge: b.badge || fb.badge, ins: b.ins || fb.ins, outs: b.outs || fb.outs, edges: b.edges || fb.edges,
    title: b.title || '', why: b.why || '', story: b.story || '', changed: b.changed || '',
  };
}

// phase copy lookup: 'analyze' pulls from the resolved branch; every other phase
// pulls from story.phases[id].
function phaseMeta(story, phaseId, branch) {
  if (phaseId === 'analyze') {
    return { kicker: 'Analyze', title: branch.title || branch.label, why: branch.why, changed: branch.changed };
  }
  return (story.phases && story.phases[phaseId]) || {};
}

function resolveTrainCount(story, ratio) {
  return Math.round((story.totalRuns || 0) * ratio);
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

// AUDIT FIX 7: picks the better of two acquisition candidates for the optimize
// phase's "best so far" readout. 'low' is a real minimize; 'high' is a real
// maximize. 'window' has no single directional max, so the honest readout is the
// candidate CLOSEST to the target band's centre -- but the surrogate JSON's output
// metadata only ever carries {name,label,unit,goal} (see ARCHITECTURE.md's data
// contract), no band bounds, so there is nothing to be closest TO today. outMeta is
// accepted so the day an output DOES carry band bounds (windowMin/windowMax) this
// picks the closest-to-centre candidate automatically; until then 'window' keeps
// the same maximize-confidence approximation as 'high' (documented here, not a
// silent wrong answer).
function better(a, b, goal, outMeta) {
  if (goal === 'low') return a.mean < b.mean;
  if (goal === 'window' && outMeta && outMeta.windowMin != null && outMeta.windowMax != null) {
    const mid = (outMeta.windowMin + outMeta.windowMax) / 2;
    return Math.abs(a.mean - mid) < Math.abs(b.mean - mid);
  }
  return a.mean > b.mean; // 'high' and window-without-band-metadata: maximize-confidence
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
