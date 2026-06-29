# probaligence-site-final (deployable static build)

This is the deployable, fully static version of the "Website Final" design. It keeps
that design exactly (same look, copy, schema, and guardrails) but removes the build-tool
runtime so it ships as plain HTML, CSS, and a little vanilla JS. Nothing here calls an
external service.

## Why this folder exists

The source in `../Website Final/` is authored as Design Components (`.dc.html`). Those
files render client-side with React plus Babel pulled from `unpkg.com` at load time, so
they are an authoring format, not a shippable site: they break SEO and GEO (the page
HTML is built by JavaScript), call a third-party CDN on every load (against PI's own
self-hosted, local-first discipline), and will not render offline. This build fixes that
while preserving the design.

## What was done

1. Rendered each `.dc.html` page once at desktop width so the component bindings resolve,
   then captured the final DOM.
2. Removed the runtime: no `support.js`, no React, no Babel, no `unpkg` calls. Each page
   is now plain static HTML with the design CSS inlined (as the design intended) plus one
   shared stylesheet and script.
3. Re-authored the shared chrome (header, footer, partner-logo marquee) as a static,
   responsive nav in `site.css` and `site.js`: dropdowns open on hover and on click,
   `aria-expanded` is kept in sync for screen readers, Escape and outside-click close them,
   and the mobile menu is a proper hamburger panel.
4. Rewrote internal links from `*.dc.html` to clean URLs (`/stochos/`, etc.) and asset
   paths to root-absolute (`/assets/...`). Output is `folder/index.html` per page.
5. Fixed the open issues (see below).

## Issues fixed in this build

- **Draft legal pages are no longer indexable.** `/datenschutz/` and `/cookies/` (the
  draft policy text) are set to `noindex, follow` and excluded from `sitemap.xml` and via
  `robots.txt`. The Impressum stays indexable (it is complete; only the VAT ID is a
  placeholder).
- **Accessible navigation.** Dropdown state is real (`aria-expanded` toggled in JS), not
  CSS-only, so assistive tech gets the true expanded state.
- **Cookie consent has a reset control.** The footer "Cookie settings" link reopens the
  banner so a choice can be changed; the banner defaults to essential-only and stores
  nothing non-essential until accepted.
- **Demo form is honestly staged.** Submitting validates the fields and shows a clear
  message that sending is not yet connected, with the `info@probaligence.com` fallback.
  No copy implies a lead was captured. Routing is a team input (see below).
- **House style.** Zero em or en dashes: the decorative em-dash list bullets became
  drawn amber bars and the eyebrow separators became " / ".
- **Favicons and theme-color** are wired (the DC head omitted them, so `/favicon.ico`
  would have 404'd).
- Added `sitemap.xml`, `robots.txt`, and a root `favicon.ico`.

## Verified

20 pages. Zero em or en dashes. Zero external or runtime references (no unpkg, React, or
Babel). 24 JSON-LD blocks, all valid. All internal page links resolve. All 30 referenced
assets exist. Renders fully offline in a headless browser with no console errors; desktop
and mobile checked.

## Files

- `index.html` and one `folder/index.html` per page; `404.html`.
- Root-level `site.css`, `site.js` (shared chrome and behaviour) and `scrollfx.js` (the
  signature-diagram motion, dependency-free). Each page also inlines its own design CSS
  in a `<style>` block in the head (kept from the source), so the build is heavy on inline
  styles by design.
- `assets/` (self-hosted fonts, media, brand and partner logos, icons). Unreferenced
  assets were pruned.
- `sitemap.xml`, `robots.txt`, `favicon.ico`.

## Preview it locally

Easiest: double-click **`PREVIEW (double-click me).bat`**. It starts a tiny local
web server and opens the site in your browser with everything working: styling,
navigation, and animations. Keep that window open while you look; close it when done.

You can also just double-click any page's `index.html` to open it directly. Each page
now renders fully (styled and animated) on its own, but clicking the nav links to other
pages only works through the launcher above (browsers do not resolve clean folder URLs
like `/stochos/` from a local file).

Note: opening pages directly from disk was the reason an earlier version "did nothing",
the shared `site.css`/`site.js` used root-absolute paths that a browser will not load
over `file://`. Those are now relative, so direct-open works.

### Seeing the animations

All motion (hero entrance, scroll reveals, count-ups, the signature chart animations)
respects the operating system's "reduce motion" accessibility setting. If your Windows
has Settings, Accessibility, Visual effects, Animation effects turned OFF, the site loads
fully styled but stays still on purpose. Two ways to see the motion:

- Turn that Windows setting ON, then hard-refresh (Ctrl+F5); or
- Add `?motion=1` to the URL once (for example `http://localhost:8137/?motion=1`). That
  forces motion on and persists across every page until you visit any page with `?motion=0`.
  It is a preview switch only and does not change what real visitors with reduce-motion get.

## Hosting

This build differs from the older `../probaligence-site/` build, so that build's
`HOSTING.md` does NOT apply verbatim. What is the same: the general server, caching, and
security-header advice, and the `.de` to `.com` redirect map in
`../redirect-map-and-technical-seo.md`. What is different here, and what the host must do:

- **Clean URLs (required).** Links and assets are root-absolute (`/stochos/`, `/assets/...`),
  not relative, so the site must be served over HTTP with directory-index routing: a
  request for `/stochos/` serves `/stochos/index.html`. It will not work opened as
  `file://`. Most static hosts (Netlify, Cloudflare Pages, S3+CloudFront, Nginx with
  `try_files`/`index index.html`) do this out of the box.
- **404.** Serve `404.html` as the not-found document.
- **File names.** The shared assets are root-level `site.css`, `site.js`, `scrollfx.js`
  (not `assets/style.css` / `assets/main.js` as in the older build).
- **CSP caveat.** Because each page inlines a `<style>` block and many inline `style`
  attributes, a strict Content-Security-Policy needs `style-src 'self' 'unsafe-inline'`.
  Scripts are all external files, so `script-src 'self'` is fine. There are no third-party
  origins to allow (no CDN, no React, no Babel, fonts are self-hosted).
- **noindex.** `/impressum/`, `/datenschutz/`, `/cookies/` carry `<meta robots noindex>`
  and are intentionally NOT disallowed in `robots.txt` (a crawler must be able to fetch
  them to read the noindex), and they are excluded from `sitemap.xml`.

## Still needed from the team (not agent-doable)

Same open inputs as the other builds: demo-form routing (action endpoint), the analytics
and consent tool choice (then list its cookies on the Cookie page), legally reviewed
Datenschutz and Cookie text, the VAT ID, the real OG image and brand logo, and the live
News-post URLs.

## Reproducing

The build script is `build_static.py` in this folder. It takes two arguments, the folder
of rendered page snapshots and the output folder, and writes this site. Re-render the
source `.dc.html` pages to snapshots (headless browser, desktop width) and re-run it after
any change to the source.
