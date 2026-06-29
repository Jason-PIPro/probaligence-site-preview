# -*- coding: utf-8 -*-
"""Convert the rendered .dc.html snapshots into a clean, deployable static site.
Strips the React/Babel/unpkg runtime, swaps in static chrome, rewrites links and
asset paths to clean root-absolute URLs, applies the open-issue fixes, and writes
folder/index.html per page. No external resources remain."""
import os, re, sys, io, posixpath

SNAP = sys.argv[1]
OUT  = sys.argv[2]

# slug (snapshot basename) -> production path
URL_MAP = {
    "Home": "/",
    "STOCHOS": "/stochos/",
    "STOCHOS-Flow": "/stochos-flow/",
    "AI-for-Engineering": "/ai-for-engineering/",
    "Paint-Coatings": "/paint-coating/",
    "Chemical-RD": "/ai-for-chemical-process-optimization/",
    "Science": "/science/",
    "How-STOCHOS-Works": "/how-stochos-works/",
    "Surrogate-Modeling": "/surrogate-modeling/",
    "Bayesian-Optimization": "/bayesian-optimization/",
    "Multi-Fidelity-Modeling": "/multi-fidelity-modeling/",
    "Uncertainty-Quantification": "/uncertainty-quantification/",
    "Sensitivity-Analysis": "/sensitivity-analysis/",
    "News": "/news/",
    "About": "/about/",
    "Contact": "/contact/",
    "Impressum": "/impressum/",
    "Datenschutz": "/datenschutz/",
    "Cookies": "/cookies/",
    "404": "/404.html",
}
LEGAL = {"Impressum", "Datenschutz", "Cookies"}  # unfinalized legal pages (draft text / VAT pending): noindex until reviewed
# clean URL -> on-disk file, used to make internal links relative (portable: works on a
# subpath like GitHub Pages /repo/, any root host, and file:// navigation).
URL_TO_FILE = {}
for _slug, _url in URL_MAP.items():
    URL_TO_FILE[_url] = "index.html" if _url == "/" else ("404.html" if _url == "/404.html" else _url.strip("/") + "/index.html")
# German-language pages get <html lang="de">. Only the Impressum is German today
# (statutory labels). Datenschutz and Cookies are English draft templates for now;
# switch them to "de" when the reviewed German legal text replaces the drafts.
GERMAN = {"Impressum"}

NAV_HTML = """<header class="site-header" role="banner">
  <a href="#main" class="skip-link">Skip to content</a>
  <div class="nav-inner">
    <a href="/" class="brand" aria-label="PI Probaligence home">
      <img src="/assets/logos/pi-mark-dark.svg" alt="" aria-hidden="true">
      <span>Probaligence</span>
    </a>
    <button type="button" class="nav-toggle" aria-label="Open menu" aria-controls="mobile-nav" aria-expanded="false">
      <span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span>
    </button>
    <nav class="nav" aria-label="Primary">
      <a class="nav-link" href="/stochos/">STOCHOS</a>
      <a class="nav-link" href="/stochos-flow/">STOCHOS&nbsp;Flow</a>
      <div class="has-menu">
        <button type="button" class="nav-link nav-trigger" aria-haspopup="true" aria-expanded="false">Solutions <span class="caret" aria-hidden="true">&#9662;</span></button>
        <div class="submenu" role="menu">
          <a role="menuitem" href="/ai-for-engineering/"><b>AI for Engineering</b><span>Accelerate CFD, FEM, and CAE</span></a>
          <a role="menuitem" href="/paint-coating/"><b>Paint and Coatings</b><span>Target formulation, fewer trials</span></a>
          <a role="menuitem" href="/ai-for-chemical-process-optimization/"><b>Chemical R&amp;D</b><span>Smarter experiments and scale-up</span></a>
        </div>
      </div>
      <div class="has-menu">
        <button type="button" class="nav-link nav-trigger" aria-haspopup="true" aria-expanded="false">Science <span class="caret" aria-hidden="true">&#9662;</span></button>
        <div class="submenu" role="menu">
          <a role="menuitem" href="/science/"><b>Science overview</b></a>
          <a role="menuitem" href="/how-stochos-works/"><b>How STOCHOS works</b><span>The DIM-GP model</span></a>
          <div class="sep"></div>
          <a role="menuitem" href="/surrogate-modeling/">Surrogate Modeling</a>
          <a role="menuitem" href="/bayesian-optimization/">Bayesian Optimization</a>
          <a role="menuitem" href="/multi-fidelity-modeling/">Multi-Fidelity Modeling</a>
          <a role="menuitem" href="/uncertainty-quantification/">Uncertainty Quantification</a>
          <a role="menuitem" href="/sensitivity-analysis/">Sensitivity Analysis</a>
        </div>
      </div>
      <a class="nav-link" href="/news/">Resources</a>
      <a class="nav-link" href="/about/">About</a>
      <a class="nav-cta" href="/contact/">Request a Demo</a>
    </nav>
  </div>
  <div class="mobile-panel" id="mobile-nav">
    <nav aria-label="Mobile">
      <a class="m-item" href="/stochos/">STOCHOS</a>
      <a class="m-item" href="/stochos-flow/">STOCHOS Flow</a>
      <div class="m-label">Solutions</div>
      <a class="m-sub" href="/ai-for-engineering/">AI for Engineering</a>
      <a class="m-sub" href="/paint-coating/">Paint and Coatings</a>
      <a class="m-sub" href="/ai-for-chemical-process-optimization/">Chemical R&amp;D</a>
      <div class="m-label">Science</div>
      <a class="m-sub" href="/science/">Science overview</a>
      <a class="m-sub" href="/how-stochos-works/">How STOCHOS works</a>
      <a class="m-sub" href="/surrogate-modeling/">Surrogate Modeling</a>
      <a class="m-sub" href="/bayesian-optimization/">Bayesian Optimization</a>
      <a class="m-sub" href="/multi-fidelity-modeling/">Multi-Fidelity Modeling</a>
      <a class="m-sub" href="/uncertainty-quantification/">Uncertainty Quantification</a>
      <a class="m-sub" href="/sensitivity-analysis/">Sensitivity Analysis</a>
      <div class="m-sep"></div>
      <a class="m-item" href="/news/">Resources</a>
      <a class="m-item" href="/about/">About</a>
      <a class="nav-cta" href="/contact/">Request a Demo</a>
    </nav>
  </div>
</header>"""

# partner/customer/collaborator logos (from the LogoMarquee DC source, files verified in assets/partners/)
MARQUEE_LOGOS = [
    ("ansys.svg", "Ansys"), ("cadfem.svg", "CADFEM"), ("simutech-group.png", "SimuTech Group"),
    ("mesco.png", "MESco"), ("tsne.png", "TSNE"), ("bosch.svg", "Bosch"), ("zf.svg", "ZF"),
    ("gemu.svg", "GEMU"), ("dlr.svg", "DLR"), ("adler-lacke.jpg", "Adler Lacke"),
    ("mankiewicz.svg", "Mankiewicz"), ("dulux.png", "Dulux"), ("plixxent.svg", "Plixxent"),
    ("fraunhofer.svg", "Fraunhofer"), ("hochschule-niederrhein.svg", "Hochschule Niederrhein"),
    ("fuell.png", "FUELL Lab Automation"), ("humotion.png", "Humotion"),
    ("uni-hamburg.svg", "Universitaet Hamburg"), ("bmwk.png", "BMWK"),
    ("robert-bosch-stiftung.svg", "Robert Bosch Stiftung"),
]
def _marquee_row(hidden):
    cells = []
    for f, alt in MARQUEE_LOGOS:
        a = "" if hidden else alt
        cells.append('<span class="logo-cell"><img src="/assets/partners/%s" alt="%s" loading="lazy"></span>' % (f, a))
    return '<div class="row"%s>%s</div>' % (' aria-hidden="true"' if hidden else "", "".join(cells))

MARQUEE_HTML = """<section class="logo-marquee" aria-label="Partners, customers and research collaborators">
  <div class="label">Partners, customers, and research collaborators</div>
  <div class="marquee-mask">
    <div class="marquee-track">%s%s</div>
  </div>
</section>""" % (_marquee_row(False), _marquee_row(True))

FOOTER_ONLY = """
<footer class="site-footer" role="contentinfo">
  <div class="footer-inner">
    <div class="footer-grid">
      <div class="footer-brand">
        <a href="/" class="brand"><img src="/assets/logos/pi-mark-dark.svg" alt="" aria-hidden="true"><span>Probaligence</span></a>
        <p>Local, probabilistic AI for engineering and R&amp;D. Fast predictions with quantified uncertainty, run on your own infrastructure.</p>
        <div class="footer-cred">
          <span>Official Ansys Technology Partner</span>
          <span>Part of the CADFEM Group</span>
        </div>
      </div>
      <div>
        <h4>Products</h4>
        <ul><li><a href="/stochos/">STOCHOS</a></li><li><a href="/stochos-flow/">STOCHOS Flow</a></li></ul>
      </div>
      <div>
        <h4>Solutions</h4>
        <ul><li><a href="/ai-for-engineering/">AI for Engineering</a></li><li><a href="/paint-coating/">Paint and Coatings</a></li><li><a href="/ai-for-chemical-process-optimization/">Chemical R&amp;D</a></li></ul>
      </div>
      <div>
        <h4>Science</h4>
        <ul><li><a href="/science/">Science overview</a></li><li><a href="/how-stochos-works/">How STOCHOS works</a></li><li><a href="/surrogate-modeling/">Surrogate Modeling</a></li><li><a href="/bayesian-optimization/">Bayesian Optimization</a></li><li><a href="/uncertainty-quantification/">Uncertainty Quantification</a></li></ul>
      </div>
      <div>
        <h4>Company</h4>
        <ul><li><a href="/about/">About</a></li><li><a href="/news/">News and Guides</a></li><li><a href="/contact/">Contact</a></li><li><a class="amber" href="/contact/">Request a Demo</a></li></ul>
      </div>
    </div>
    <div class="footer-bottom">
      <span class="copy">&copy; <span data-year>2026</span> PI Probaligence GmbH</span>
      <span class="legal">
        <a href="/impressum/">Impressum</a>
        <a href="/datenschutz/">Datenschutz</a>
        <a href="/cookies/">Cookies</a>
        <a href="#" data-consent-reset>Cookie settings</a>
      </span>
    </div>
  </div>
</footer>"""

# Full footer = marquee + footer. Used on pages that do NOT already embed the
# partner marquee in their own content (the home page does, so it gets FOOTER_ONLY
# to avoid showing the marquee twice).
FOOTER_HTML = MARQUEE_HTML + FOOTER_ONLY

SCRIPTS = '<script src="/scrollfx.js" defer></script>\n<script src="/site.js" defer></script>'

def clean_head(head):
    # drop runtime <style> blocks (placeholder shimmer / dc-root / x-dc hide)
    def drop_style(m):
        s = m.group(0)
        if ".sc-placeholder" in s or "#dc-root" in s or "x-dc{display" in s or s == "<style></style>":
            return ""
        return s
    head = re.sub(r"<style[^>]*>.*?</style>", drop_style, head, flags=re.S)
    # drop runtime scripts: support.js and the unpkg react/react-dom/babel
    head = re.sub(r'<script\s+src="\./support\.js"></script>', "", head)
    head = re.sub(r'<script\s+src="https://unpkg\.com/[^"]*"[^>]*></script>', "", head)
    # scrollfx is re-added via SCRIPTS at end of body; remove the head copy
    head = re.sub(r'<script\s+src="scrollfx\.js"[^>]*></script>', "", head)
    return head

def strip_dc_attrs(s):
    s = re.sub(r'\s+data-dc-tpl="[0-9]+"', "", s)
    s = re.sub(r'\s+data-dc-script(="[^"]*")?', "", s)
    s = re.sub(r'\s+data-props="[^"]*"', "", s)
    s = re.sub(r'\s+hint-(?:placeholder-val|placeholder-count|size)="[^"]*"', "", s)
    s = re.sub(r'\s+style-hover="[^"]*"', "", s)
    # leftover runtime classes
    s = s.replace("sc-host", "").replace("sc-interp", "")
    return s

def fix_house_style(s):
    # decorative amber em-dash bullets -> a drawn amber bar (keeps the look, no dash glyph)
    s = re.sub(r'<span style="color: rgb\(255, 176, 6\); flex: 0 0 auto;">—</span>',
               '<span aria-hidden="true" style="flex:0 0 auto;width:13px;height:2px;background:rgb(255,176,6);margin-top:9px"></span>', s)
    # eyebrow / label separators: em dash -> slash
    s = s.replace(" — ", " / ")
    # any stray en/em dash left -> comma (house style: none allowed)
    s = s.replace("—", ", ").replace("–", "-")
    return s

def rewrite_links(s):
    # internal .dc.html links -> clean URLs
    def repl(m):
        slug = m.group(1)
        return URL_MAP.get(slug, "/" + slug.lower() + "/")
    s = re.sub(r'(?:\./)?([A-Za-z0-9\-]+)\.dc\.html', repl, s)
    # asset + script paths -> root-absolute (only relative ones, not https://).
    # Handle plain quotes, parens, HTML-encoded quotes, and url() forms.
    s = re.sub(r'(["\'(])assets/', r'\1/assets/', s)
    s = s.replace('&quot;assets/', '&quot;/assets/')
    s = s.replace('&#39;assets/', '&#39;/assets/')
    s = re.sub(r'url\(assets/', 'url(/assets/', s)
    s = re.sub(r'(["\'])scrollfx\.js', r'\1/scrollfx.js', s)
    s = s.replace('//assets/', '/assets/')  # safety: never double-slash
    return s

def transform(slug, html):
    m_head = re.search(r"<head[^>]*>(.*?)</head>", html, re.S)
    m_main = re.search(r"<main\b.*</main>", html, re.S)
    if not m_head or not m_main:
        raise RuntimeError("missing head/main in " + slug)
    head = clean_head(m_head.group(1))
    head = strip_dc_attrs(head)
    head = fix_house_style(head)
    head = rewrite_links(head)
    # FIX: the DOM snapshot stripped the <style> wrapper inside <noscript>, so the
    # CSS was rendering as literal text with JS off. Restore a valid <style>.
    head = re.sub(r'<noscript>\s*(\[[^<]*\{[^<]*\}[^<]*)</noscript>',
                  r'<noscript><style>\1</style></noscript>', head)
    main = strip_dc_attrs(m_main.group(0))
    main = fix_house_style(main)
    main = rewrite_links(main)

    # Mark the hero (first element child of <main>) so the entrance animation can
    # target it. site.js staggers its content in; CSS hides it pre-paint (no flash).
    main = re.sub(r'(<main\b[^>]*>\s*<[a-z]+)', r'\1 data-hero-in', main, count=1)

    # FIX: restore required attributes on the demo form (the React render dropped
    # them from the snapshot, so the vanilla validator had nothing to check).
    if slug == "Contact":
        for fld in ('name="name"', 'name="email"', 'name="company"'):
            main = main.replace('<input ' + fld, '<input required ' + fld, 1)
        main = main.replace('<textarea name="message"', '<textarea required name="message"', 1)

    # link the shared chrome stylesheet
    if "/site.css" not in head:
        head = head.rstrip() + '\n<link rel="stylesheet" href="/site.css">\n'

    # favicon / app icons (DC head omitted them, so /favicon.ico would 404)
    icons = ('<link rel="icon" href="/assets/favicon.ico" sizes="any">\n'
             '<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png">\n'
             '<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">\n')
    if 'rel="icon"' not in head:
        head = head.rstrip() + "\n" + icons
    if 'name="theme-color"' not in head:
        head = head.rstrip() + '\n<meta name="theme-color" content="#060607">\n'

    # FIX: no-JS fallback for the mobile nav (it opens via JS only). With JS off on
    # a small screen, reveal the full mobile menu and hide the inert toggle.
    head = head.rstrip() + ('\n<noscript><style>@media(max-width:960px){'
        '.nav-toggle{display:none}'
        '.mobile-panel{max-height:none!important;opacity:1!important;overflow:visible!important;'
        'border-bottom:1px solid rgba(255,255,255,.08)}}'
        '[data-uc-body]{max-height:none!important;opacity:1!important;display:block!important}'
        '</style></noscript>\n')

    # FIX: legal/draft pages must not be indexed
    if slug in LEGAL:
        head = re.sub(r'<meta\s+name="robots"\s+content="[^"]*">',
                      '<meta name="robots" content="noindex, follow">', head)
        if 'name="robots"' not in head:
            head += '<meta name="robots" content="noindex, follow">\n'

    lang = "de" if slug in GERMAN else "en"
    # avoid a duplicate partner marquee: if the page already embeds one in its
    # content (the home page does), use the footer without the marquee.
    footer = FOOTER_ONLY if "Partners, customers" in main else FOOTER_HTML
    # Synchronous head script: add `anim` before first paint so CSS can hide the
    # hero for its entrance (no flash). Skipped under reduced-motion. A 1.6s
    # `anim-done` safety reveals the hero even if site.js never runs.
    # Adds `anim` before first paint when motion is allowed. Motion is allowed when the
    # OS does NOT request reduced motion, OR a preview override is set: visit any page
    # with ?motion=1 to force animations on (persists site-wide via localStorage), ?motion=0
    # to clear. This lets the site be reviewed even with OS "reduce motion" enabled.
    anim = ('<script>try{var q=location.search;'
            'if(/[?&]motion=1/.test(q)){try{localStorage.setItem("pi-motion","on")}catch(e){}}'
            'if(/[?&]motion=0/.test(q)){try{localStorage.removeItem("pi-motion")}catch(e){}}'
            'var f=false;try{f=localStorage.getItem("pi-motion")==="on"}catch(e){}'
            'if(f)window.__PIFX_FORCE=true;'
            'if(f||!matchMedia("(prefers-reduced-motion:reduce)").matches){'
            'var d=document.documentElement;d.className+=" anim";'
            'setTimeout(function(){d.className+=" anim-done"},1600);}}catch(e){}</script>\n')
    doc = (
        "<!DOCTYPE html>\n<html lang=\"" + lang + "\">\n<head>\n"
        + anim
        + head.strip()
        + "\n</head>\n<body>\n"
        + NAV_HTML + "\n"
        + main + "\n"
        + footer + "\n"
        + SCRIPTS + "\n</body>\n</html>\n"
    )
    # Relative asset/CSS/JS paths AND relative internal links so pages render and navigate
    # when opened directly (file://), on a subpath host, or any root host. The 404 is served
    # at arbitrary depths, so it keeps root-absolute paths.
    if slug != "404":
        doc = relativize(doc, "" if slug == "Home" else "../")
        doc = relativize_links(doc, URL_MAP[slug])
    return doc

def relativize(doc, prefix):
    """Make the shared CSS/JS and asset paths relative so a page renders correctly
    when opened directly (file://) as well as when served. Page links and canonical
    URLs stay as they are. prefix is "" for root-level pages, "../" for /folder/ pages."""
    for f in ("site.css", "site.js", "scrollfx.js"):
        doc = doc.replace('"/' + f + '"', '"' + prefix + f + '"')
    doc = re.sub(r'([("\'])/assets/', lambda m: m.group(1) + prefix + 'assets/', doc)
    doc = doc.replace('&quot;/assets/', '&quot;' + prefix + 'assets/')
    doc = doc.replace('&#39;/assets/', '&#39;' + prefix + 'assets/')
    return doc

def relativize_links(doc, page_url):
    """Rewrite internal page links (/stochos/ etc.) to relative paths so navigation works
    on a subpath host (GitHub Pages /repo/), any root host, and file://. Canonical/og URLs
    (absolute https) and #anchors are left untouched."""
    page_file = URL_TO_FILE.get(page_url, "index.html")
    page_dir = posixpath.dirname(page_file) or "."
    def repl(m):
        u = m.group(1)
        if u in URL_TO_FILE:
            return 'href="' + posixpath.relpath(URL_TO_FILE[u], page_dir) + '"'
        return m.group(0)
    return re.sub(r'href="(/[^"#?]*)"', repl, doc)

def out_path(slug):
    url = URL_MAP[slug]
    if url == "/404.html":
        return os.path.join(OUT, "404.html")
    rel = url.strip("/")
    if rel == "":
        return os.path.join(OUT, "index.html")
    return os.path.join(OUT, rel, "index.html")

count = 0
for slug in URL_MAP:
    src = os.path.join(SNAP, slug + ".html")
    if not os.path.exists(src):
        print("MISSING snapshot:", slug); continue
    with io.open(src, "r", encoding="utf-8") as f:
        html = f.read()
    doc = transform(slug, html)
    dst = out_path(slug)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with io.open(dst, "w", encoding="utf-8", newline="\n") as f:
        f.write(doc)
    count += 1
    print("wrote", slug, "->", os.path.relpath(dst, OUT))
print("DONE", count, "pages")
