// Reusable guided tour + intro card. Makes a demo self-explanatory:
// a spotlight dims everything except the thing being explained, with an
// animated callout. Steps can trigger actions (move the cursor, run the optimizer).

export function showIntro(root, { eyebrow, title, body, whatLine, tryLine, tourLabel, onTour, onExplore }) {
  const el = document.createElement('div');
  el.className = 'intro-modal';
  // Optional plain-language framing: "What you are looking at" + "Try this".
  // Keeps the abstract headline but grounds the cold visitor before they decide.
  const frame = (whatLine || tryLine) ? `
      <div class="intro-frame">
        ${whatLine ? `<div class="if-row"><span class="if-tag">What you are looking at</span><span class="if-txt">${whatLine}</span></div>` : ''}
        ${tryLine ? `<div class="if-row"><span class="if-tag try">Try this</span><span class="if-txt">${tryLine}</span></div>` : ''}
      </div>` : '';
  el.innerHTML = `
    <div class="intro-card">
      <div class="intro-eyebrow">${eyebrow}</div>
      <h2>${title}</h2>
      <p>${body}</p>
      ${frame}
      <div class="intro-actions">
        <button class="btn" id="i-tour">${tourLabel || 'Take the 40-second tour'}</button>
        <button class="btn ghost" id="i-explore">Skip, let me explore</button>
      </div>
    </div>`;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const close = (cb) => { el.classList.remove('show'); setTimeout(() => { el.remove(); cb && cb(); }, 280); };
  el.querySelector('#i-tour').onclick = () => close(onTour);
  el.querySelector('#i-explore').onclick = () => close(onExplore);
}

export class Tour {
  constructor(steps, { onEnd } = {}) {
    this.steps = steps;
    this.onEnd = onEnd;
    this.i = 0;
    this.veil = div('tour-veil');
    this.spot = div('tour-spot');
    this.card = div('tour-card');
    this.timers = [];
  }

  start() {
    document.body.append(this.veil, this.spot, this.card);
    requestAnimationFrame(() => this._show(0));
    this._onResize = () => this._place();
    window.addEventListener('resize', this._onResize);
    // the tour overlay lives on document.body, so the router's innerHTML swap
    // never reaps it. Self-end on any route change so it can't haunt the next demo.
    this._onHashChange = () => this.end();
    window.addEventListener('hashchange', this._onHashChange);
  }

  _clearTimers() { this.timers.forEach(clearTimeout); this.timers = []; }
  after(ms, fn) { this.timers.push(setTimeout(fn, ms)); }

  _show(i) {
    this._clearTimers();
    this.i = i;
    const s = this.steps[i];
    const target = s.target ? document.querySelector(s.target) : null;

    // spotlight vs full veil
    if (target) {
      this.veil.classList.remove('on');
      const r = target.getBoundingClientRect();
      const pad = s.pad ?? 8;
      Object.assign(this.spot.style, {
        display: 'block',
        left: `${r.left - pad}px`, top: `${r.top - pad}px`,
        width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px`,
        borderRadius: `${s.round ?? 14}px`,
      });
    } else {
      this.spot.style.display = 'none';
      this.veil.classList.add('on');
    }

    const n = this.steps.length;
    this.card.innerHTML = `
      <div class="tour-step">${i + 1} / ${n}</div>
      <h4>${s.title}</h4>
      <p>${s.body}</p>
      <div class="tour-actions">
        <button class="tlink" data-act="skip">Skip tour</button>
        <div class="tour-dots">${this.steps.map((_, k) => `<span class="${k === i ? 'on' : ''}"></span>`).join('')}</div>
        <button class="tbtn" data-act="next">${i === n - 1 ? 'Explore →' : 'Next →'}</button>
      </div>`;
    this.card.querySelector('[data-act=next]').onclick = () => this._next();
    this.card.querySelector('[data-act=skip]').onclick = () => this.end();
    this.card.classList.remove('show'); void this.card.offsetWidth; this.card.classList.add('show');

    this._place();
    if (s.onEnter) s.onEnter(this);
  }

  _place() {
    const s = this.steps[this.i];
    const target = s.target ? document.querySelector(s.target) : null;
    const c = this.card, m = 16;
    const cw = c.offsetWidth, ch = c.offsetHeight;
    if (!target) {
      c.style.left = `${(innerWidth - cw) / 2}px`;
      c.style.top = `${(innerHeight - ch) / 2}px`;
      return;
    }
    const r = target.getBoundingClientRect();
    let place = s.place || 'right';
    const room = { right: innerWidth - r.right, left: r.left, top: r.top, bottom: innerHeight - r.bottom };
    if (place === 'right' && room.right < cw + m) place = room.left > cw + m ? 'left' : 'bottom';
    if (place === 'left' && room.left < cw + m) place = room.right > cw + m ? 'right' : 'bottom';
    let left, top;
    if (place === 'right') { left = r.right + m; top = r.top + r.height / 2 - ch / 2; }
    else if (place === 'left') { left = r.left - cw - m; top = r.top + r.height / 2 - ch / 2; }
    else if (place === 'top') { left = r.left + r.width / 2 - cw / 2; top = r.top - ch - m; }
    else { left = r.left + r.width / 2 - cw / 2; top = r.bottom + m; }
    left = Math.max(m, Math.min(innerWidth - cw - m, left));
    top = Math.max(m, Math.min(innerHeight - ch - m, top));
    c.style.left = `${left}px`; c.style.top = `${top}px`;
  }

  _next() { if (this.i >= this.steps.length - 1) return this.end(); this._show(this.i + 1); }

  end() {
    if (this._ended) return;          // idempotent: route change + button can both fire
    this._ended = true;
    this._clearTimers();
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('hashchange', this._onHashChange);
    [this.veil, this.spot, this.card].forEach((e) => e.remove());
    this.onEnd && this.onEnd();
  }
}

function div(cls) { const d = document.createElement('div'); d.className = cls; return d; }
