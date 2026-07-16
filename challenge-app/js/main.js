// Router + landing hub for the STOCHOS live demonstrator.
// Two routes: the Beat STOCHOS challenge (the flagship) and the Build-it-yourself
// studio (the builder the challenge hands off to). The studio was briefly removed
// on 2026-07-13 and restored the same day at Jason's request. The earlier retired
// demos (flow, standalone paint, chemistry, engineering) live in
// _backups/app-pre-trim-2026-07-12 and 06_website-build/_archive. Both surviving
// demos are noData mounts, so nothing (not even surrogate.js) is parsed until a
// route needs it; each lazy-imports its own dependency graph at mount time.

const app = document.getElementById('app');
const boot = document.getElementById('boot');

// Teardown seam: a demo's mount(root) MAY return a teardown (a function, or an
// object with .destroy()). We run it on the next route change BEFORE the DOM is
// swapped, so renderers can stop their rAF loop, disconnect observers, remove
// window listeners and release their WebGL context.
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

// Lazy-import wrappers. The dynamic import() is cached by the browser's module
// registry after the first call, so subsequent route visits are instant.
const DOMAINS = {
  challenge: { tag: 'The challenge', title: 'Think you can beat STOCHOS?',
    blurb: 'Pick a use case, find the best settings by hand over a few tries, then let STOCHOS take the same problem. Closest to optimal wins, then you build the workflow that did it.',
    mount: async (root) => { const { mountChallenge } = await import('./demos/challenge.js'); return mountChallenge(root); } },
  studio: { tag: 'Stochos Flow Web', title: 'Build your own workflow, see it think',
    blurb: 'Pick your industry, then build a STOCHOS workflow node by node. Make a real decision at every step and watch the model, its uncertainty and the next experiment update live.',
    mount: async (root) => { const { mountStudio } = await import('./demos/studio.js'); return mountStudio(root); } },
};

function hideBoot() { boot.classList.add('hidden'); }

function setNav(active) {
  document.querySelectorAll('#domnav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.domain === active);
  });
  // Keep the active tab visible on narrow viewports, where #domnav scrolls
  // horizontally with its scrollbar hidden (a11y pass, item 9): without this
  // the active tab (e.g. "Beat STOCHOS", third of four) can load scrolled
  // off-screen to the right. block:'nearest' avoids any vertical page scroll;
  // inline:'nearest' only nudges the nav's own horizontal scroll if needed.
  if (active) {
    const activeEl = domnav.querySelector(`a[data-domain="${active}"]`);
    if (activeEl && activeEl.scrollIntoView) {
      activeEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }
}

// The three use cases that live inside the challenge. The chips deep-link to
// #/challenge and the visitor lands on the use-case picker. Labels stay honest:
// they tease the cases, they do not promise an auto-jump.
const CHALLENGE_CASES = [
  { label: 'Paint &amp; coatings' },
  { label: 'Chemistry' },
  { label: 'Engineering' },
];

function renderHub() {
  setNav(null);
  // The challenge leads as the hero; the builder follows as the one secondary
  // feature (it is also where the challenge sends winners and losers alike).
  const st = DOMAINS.studio;
  app.innerHTML = `
    <div class="hub fade-in">
      <section class="hero" aria-label="Beat STOCHOS challenge">
        <div class="hero-inner">
          <div class="hero-body">
            <span class="hero-kicker">The live demonstrator</span>
            <h1 class="hero-title">Don't just read about STOCHOS.<br><span class="hero-hot">Try to beat it.</span></h1>
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
          <div class="hero-illus" aria-hidden="true">
            <span class="hero-illus-label">Illustrative</span>
            <div class="hi-grid">
              <div class="hi-row">
                <span class="hi-row-label">You</span>
                <span class="hi-bar-track"><span class="hi-you"></span></span>
                <span class="hi-row-val">71</span>
              </div>
              <div class="hi-row">
                <span class="hi-row-label">STOCHOS</span>
                <span class="hi-bar-track"><span class="hi-st"></span></span>
                <span class="hi-row-val hot">94</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="hub-builder" aria-label="Build it yourself">
        <div class="hub-builder-body">
          <div class="hub-builder-text">
            <span class="hub-builder-tag">${st.tag}</span>
            <h2 class="hub-builder-title">${st.title}</h2>
            <p class="hub-builder-pitch">${st.blurb}</p>
            <a class="hub-builder-cta" href="#/studio">Open the builder &rarr;</a>
          </div>
          <div class="hub-builder-visual" aria-hidden="true">
            <div class="hbv-chain">
              <div class="hbv-node">
                <span class="hbv-node-icon"><img src="vendor/node-icons/excel_reader.svg" alt="" /></span>
                <span class="hbv-node-label">Excel Reader</span>
              </div>
              <span class="hbv-link"><span class="hbv-port"></span><span class="hbv-line"></span><span class="hbv-port"></span></span>
              <div class="hbv-node">
                <span class="hbv-node-icon"><img src="vendor/node-icons/dimgp_fit.svg" alt="" /></span>
                <span class="hbv-node-label">DIM-GP Fit</span>
              </div>
              <span class="hbv-link"><span class="hbv-port"></span><span class="hbv-line"></span><span class="hbv-port"></span></span>
              <div class="hbv-node">
                <span class="hbv-node-icon"><img src="vendor/node-icons/bo_optimize.svg" alt="" /></span>
                <span class="hbv-node-label">Optimize</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>`;
  hideBoot();
}

async function renderDomain(name) {
  const d = DOMAINS[name];
  if (!d) {
    // unknown or retired route (old #/paint etc. bookmarks): show the hub and
    // canonicalize the URL so the dead hash does not linger in the address bar
    try { history.replaceState(null, '', '#/'); } catch (e) { /* noop */ }
    return renderHub();
  }
  setNav(name);
  try {
    boot.classList.remove('hidden');
    // Both mounts are async and load their own data; await so the teardown
    // returned by the inner mount is stored correctly.
    activeTeardown = await d.mount(app);
    hideBoot();
  } catch (e) {
    app.innerHTML = `<div class="placeholder"><div><div class="big">Could not load ${name}</div><p>${e.message}</p></div></div>`;
    hideBoot();
  }
}

function route() {
  runTeardown();   // tear down the outgoing demo before swapping the DOM
  const h = location.hash.replace(/^#\//, '');
  if (!h) return renderHub();
  renderDomain(h);
}

// Nav overflow affordance: on narrow screens the nav scrolls horizontally with a
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
