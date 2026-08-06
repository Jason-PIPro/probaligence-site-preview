// Phone detection, one definition for the whole demonstrator.
//
// Why it exists (2026-07-29, Jason): there must be no way to reach the Flow
// builder (#/studio) from a phone. The builder is a drag-and-wire node editor,
// so a visitor on a phone cannot use it and should never be offered it. Every
// entry point (the nav tab, the hub band, the two buttons inside the challenge)
// keys off this one query, and main.js also guards the route itself so a
// bookmark or a shared link cannot get in either.
//
// Two clauses on purpose. The width clause is the ordinary portrait phone and
// matches the app's 480px breakpoint. The height clause catches the same phone
// turned sideways, where the viewport is wide (844px on a 390x844 device) but
// only 390px tall: still a phone, still no builder. `pointer: coarse` keeps a
// short desktop window out of it.
export const PHONE_QUERY = '(max-width: 480px), (max-height: 480px) and (pointer: coarse)';

const mq = window.matchMedia ? window.matchMedia(PHONE_QUERY) : null;

export function isPhone() {
  return !!(mq && mq.matches);
}

// CSS hooks off `html.is-phone` rather than repeating the query, so the
// definition above stays the only place the breakpoint is written in the app.
export function syncPhoneClass() {
  document.documentElement.classList.toggle('is-phone', isPhone());
}

// Rotating a phone, or resizing a desktop window down, re-runs the callers'
// decisions. Both listener forms: Safari before 14 has no addEventListener here.
export function onPhoneChange(fn) {
  if (!mq) return;
  if (mq.addEventListener) mq.addEventListener('change', fn);
  else if (mq.addListener) mq.addListener(fn);
}
