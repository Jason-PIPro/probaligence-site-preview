// Router + landing hub for the STOCHOS live demonstrators.
// All demo modules are lazy-loaded via dynamic import() at route time so that
// Three.js (655 KB) and the studio/challenge bundles are never parsed on routes
// that don't need them. Only surrogate.js (no Three.js) is imported eagerly
// because it is needed by renderDomain before any module is loaded.
import { loadDomain } from './surrogate.js';

const app = document.getElementById('app');
const boot = document.getElementById('boot');
// main.js in-session data cache (keyed by domain name). With the shared
// _dataCache in surrogate.js this is now just a convenience so we don't
// await loadDomain repeatedly on the same route revisit.
const cache = {};

// Teardown seam: a demo's mount(root, ...) MAY return a teardown (a function, or
// an object with .destroy()). We run it on the next route change BEFORE the DOM is
// swapped, so renderers can stop their rAF loop, disconnect observers, remove window
// listeners and release their WebGL context. Without this, app.innerHTML leaks the
// outgoing demo (the chemistry/engineering WebGL-context exhaustion + zombie loops).
let activeTeardown = null;
function runTeardown() {
  const t = activeTeardown;
  activeTeardown = null;
  if (!t) return;
  try {
    if (typeof t === 'function') t();
    else if (t && typeof t.destroy === 'function') t.destroy();
  } catch (e) { console.warn('demo teardown failed', e); }
}

// Lazy-import wrappers. Each returns an async function that mirrors the
// original mount signature. The dynamic import() is cached by the browser's
// module registry after the first call, so subsequent route visits are instant.
// NOTE: all wrappers are async so renderDomain can await them uniformly.
const DOMAINS = {
  challenge: { tag: 'Challenge', title: 'Think you can beat STOCHOS?',
    blurb: 'A demo-game: pick a use case, find the best settings by hand over a few tries, then let STOCHOS take the same problem. Closest to optimal wins, then you build the workflow that did it.', glow: 'var(--warm)',
    mount: async (root) => { const { mountChallenge } = await import('./demos/challenge.js'); return mountChallenge(root); },
    ready: true, noData: true },
  studio: { tag: 'Stochos Flow Web', title: 'Build your own workflow, see it think',
    blurb: 'Pick your industry, then build a STOCHOS workflow node by node. Make a real decision at every step and watch the model, its uncertainty and the next experiment update live.', glow: 'var(--accent)',
    mount: async (root) => { const { mountStudio } = await import('./demos/studio.js'); return mountStudio(root); },
    ready: true, noData: true },
  flow: { tag: 'Stochos Flow', title: 'Build the workflow, node by node',
    blurb: 'The Stochos Flow editor in your browser: wire real nodes into a pipeline, hit run, and watch a DIM-GP train, validate and optimize, step by step.', glow: 'var(--accent)',
    mount: async (root) => { const { mountFlow } = await import('./demos/flow.js'); return mountFlow(root); },
    ready: true, noData: true },
  paint: { tag: 'Paint & coatings', title: 'Formulate a coating, see the doubt',
    blurb: 'Tune pigment and binder and watch hiding power, gloss and scrub resistance respond, with the model confidence drawn as fog.', glow: 'var(--accent)',
    mount: async (root, s) => { const { mountPaint } = await import('./demos/paint.js'); return mountPaint(root, s); },
    ready: true },
  chemistry: { tag: 'Chemistry', title: 'Optimize a reaction in 3D',
    blurb: 'A yield landscape you can fly over, with STOCHOS climbing toward the best conditions and showing where it is still guessing.', glow: 'var(--warm)',
    mount: async (root, s) => { const { mountChemistry } = await import('./demos/chemistry.js'); return mountChemistry(root, s); },
    ready: true },
  engineering: { tag: 'Engineering', title: 'Reshape a part, predict the physics',
    blurb: 'A pin-fin heat sink that rebuilds as you reshape it, a predicted temperature field, and the Pareto front trading cooling against pressure drop.', glow: 'var(--accent-2)',
    mount: async (root, s) => { const { mountEngineering } = await import('./demos/engineering.js'); return mountEngineering(root, s); },
    ready: true },
};

function hideBoot() { boot.classList.add('hidden'); }

function setNav(active) {
  document.querySelectorAll('#domnav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.domain === active);
  });
}

// The three use cases that live inside the challenge. The challenge picker does
// not (yet) read a hash parameter, so these chips deep-link to #/challenge and
// the visitor lands on the use-case picker. Labels stay honest: they tease the
// cases, they do not promise an auto-jump.
const CHALLENGE_CASES = [
  { label: 'Paint &amp; coatings' },
  { label: 'Chemistry' },
  { label: 'Engineering' },
];

function renderHub() {
  setNav(null);
  // The challenge is the flagship interactive, so it leads the hub as a hero.
  // The remaining demonstrators sit below as a secondary grid (same routes).
  const rest = Object.entries(DOMAINS).filter(([k]) => k !== 'challenge');
  app.innerHTML = `
    <div class="hub fade-in">
      <section class="hero" aria-label="Beat STOCHOS challenge">
        <span class="hero-glow"></span>
        <div class="hero-body">
          <span class="hero-kicker">The heart of the live demo</span>
          <h1 class="hero-title">Don't just read about STOCHOS.<br><span class="grad">Try to beat it.</span></h1>
          <p class="hero-pitch">Pick a use case, find the best settings by hand over a few tries, then
            let STOCHOS take the same problem. Closest to optimal wins, then you build the workflow that did it.</p>
          <div class="hero-actions">
            <a class="hero-cta" href="#/challenge">Can you beat STOCHOS? &rarr;</a>
            <span class="hero-sub">3 use cases &middot; a few tries each &middot; about 2 minutes</span>
          </div>
          <div class="hero-cases">
            ${CHALLENGE_CASES.map((c) => `<a class="hero-chip" href="#/challenge">${c.label}</a>`).join('')}
          </div>
        </div>
        <span class="hero-illus" aria-hidden="true">
          <span class="hero-illus-label">Illustrative</span>
          <span class="hi-track"><span class="hi-you"></span><span class="hi-st"></span></span>
          <span class="hi-cap"><span>You</span><span>STOCHOS</span></span>
        </span>
      </section>

      <div class="hub-rest">
        <p class="hub-rest-lead">Or explore the other demonstrators. Each one runs a real DIM-GP model in
          your browser: it predicts, shows its own uncertainty, and tells you which experiment to run next.</p>
        <div class="cards">
          ${rest.map(([k, d]) => `
            <a class="card" href="#/${k}">
              <span class="glow" style="background:${d.glow}"></span>
              <span class="tag">${d.tag}</span>
              <h2>${d.title}</h2>
              <p>${d.blurb}</p>
              <span class="go">${d.ready ? 'Open demonstrator &rarr;' : 'Preview soon &rarr;'}</span>
            </a>`).join('')}
        </div>
      </div>
    </div>`;
  hideBoot();
}

async function renderDomain(name) {
  const d = DOMAINS[name];
  if (!d) return renderHub();
  setNav(name);
  if (!d.ready) {
    app.innerHTML = `<div class="placeholder fade-in"><div><div class="big">${d.title}</div>
      <p>${d.blurb}</p><p style="margin-top:18px;color:var(--accent)">Wiring the live model. Coming next.</p></div></div>`;
    hideBoot();
    return;
  }
  try {
    boot.classList.remove('hidden');
    if (d.noData) {
      // noData mounts (flow, studio, challenge) are async; await so the teardown
      // returned by the inner mount is stored correctly.
      activeTeardown = await d.mount(app);
      hideBoot();
      return;
    }
    if (!cache[name]) cache[name] = await loadDomain(name);
    // All mount wrappers are now async; await so teardown is captured correctly.
    activeTeardown = await d.mount(app, cache[name]);
    hideBoot();
  } catch (e) {
    app.innerHTML = `<div class="placeholder"><div><div class="big">Could not load ${name}</div><p>${e.message}</p></div></div>`;
    hideBoot();
  }
}

function route() {
  runTeardown();   // tear down the outgoing demo before swapping the DOM
  const h = location.hash.replace(/^#\//, '');
  // The site top nav is always visible (sf-fullscreen is never set on #/studio).
  // The studio sizes itself below the topbar via injected CSS in studio.js.
  document.body.classList.remove('sf-fullscreen');
  if (!h) return renderHub();
  renderDomain(h);
}

// Nav overflow affordance: on narrow screens the pill nav scrolls horizontally with a
// hidden scrollbar, which reads as clipped. While more tabs sit off-screen, styles.css
// fades the right edge (.can-scroll without .at-end); the fade drops at the end.
const domnav = document.getElementById('domnav');
function navFade() {
  const more = domnav.scrollWidth - domnav.clientWidth > 4;
  const atEnd = domnav.scrollLeft + domnav.clientWidth >= domnav.scrollWidth - 4;
  domnav.classList.toggle('can-scroll', more);
  domnav.classList.toggle('at-end', !more || atEnd);
}
domnav.addEventListener('scroll', navFade, { passive: true });
window.addEventListener('resize', navFade);
navFade();

window.addEventListener('hashchange', route);
route();
