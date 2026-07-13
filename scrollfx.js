/* PI Probaligence, PIScrollFX
   Shared, dependency-free scroll/motion engine loaded by every page.
   Purpose: make motion MEAN something. Each page's signature diagram performs
   its own concept: confidence bands bloom, mean lines draw, ranked bars grow,
   data points pop, comparison images wipe in, triggered on load for hero
   visuals and on scroll-in for deeper ones. Plus a sitewide scroll-progress
   rail and a subtle armed parallax on the signature visual for depth.

   Safety: honors prefers-reduced-motion and document.visibilityState exactly
   like the rest of the codebase (the preview/capture frame reports 'hidden',
   which freezes rAF/CSS animation). When motion is not OK, every element is
   left in its authored final state. Set window.__PIFX_FORCE = true to bypass
   the visibility gate for testing. Idempotent and self-initializing. */
(function () {
  "use strict";
  if (window.PIScrollFX) return;

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var booted = false;
  var loopRunning = false;
  var bar = null;
  var parallaxEls = [];   // { el, factor, baseY }
  var sy = 0, lastSy = -1, vh = window.innerHeight || 800, maxScroll = 1;

  // Parallax adds little on phones and can drift on tiny screens; reserve it for
  // roomier viewports. Diagram builds + the progress rail still run everywhere.
  function parallaxAllowed() { return (window.innerWidth || 0) >= 760; }

  function measure() {
    vh = window.innerHeight || vh;
    maxScroll = (document.documentElement.scrollHeight - vh) || 1;
  }

  function canAnimate() {
    return window.__PIFX_FORCE === true || (!reduce && document.visibilityState === "visible");
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function qsa(root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }

  /* ---------- signature-diagram classification ---------- */
  function lineLen(p) { try { if (p.getTotalLength) return p.getTotalLength(); } catch (e) {} return 0; }

  function classify(fig) {
    var svg = fig.querySelector("svg");
    var lines = [], bands = [], bars = [], pts = [], imgs = [];
    if (svg) {
      qsa(svg, "path").forEach(function (p) {
        var stroke = (p.getAttribute("stroke") || "").toLowerCase();
        var fill = (p.getAttribute("fill") || "").toLowerCase();
        var amberStroke = stroke.indexOf("ffb006") > -1 || stroke.indexOf("ffca4d") > -1;
        var amberFill = fill.indexOf("255,176,6") > -1 || fill.indexOf("255, 176, 6") > -1 || fill.indexOf("#ffb006") > -1;
        if (amberStroke) lines.push(p);
        else if (amberFill) bands.push(p);
      });
      qsa(svg, "rect").forEach(function (r) {
        var fill = (r.getAttribute("fill") || "").toLowerCase();
        if (fill.indexOf("255,176,6") > -1 || fill.indexOf("ffb006") > -1) bars.push(r);
      });
      qsa(svg, "circle").forEach(function (c) {
        var st = (c.getAttribute("stroke") || "").toLowerCase(), f = (c.getAttribute("fill") || "").toLowerCase();
        if (st.indexOf("ffca4d") > -1 || st.indexOf("ffb006") > -1 || f.indexOf("ffb006") > -1) pts.push(c);
      });
    } else {
      imgs = qsa(fig, "img");
    }
    return { svg: svg, lines: lines, bands: bands, bars: bars, pts: pts, imgs: imgs };
  }
  function hasParts(p) { return p.lines.length || p.bands.length || p.bars.length || p.pts.length || p.imgs.length; }

  /* ---------- collapse → build → cleanup ---------- */
  function collapse(p, isHero) {
    p.bands.forEach(function (b) {
      b.style.transformBox = "fill-box"; b.style.transformOrigin = "center";
      b.style.transition = "none"; b.style.transform = "scaleY(0.05)"; b.style.opacity = "0";
    });
    p.lines.forEach(function (l) {
      var len = lineLen(l); if (!len) return;
      l.style.transition = "none"; l.style.strokeDasharray = len; l.style.strokeDashoffset = len;
    });
    p.bars.forEach(function (r) {
      var w = parseFloat(r.getAttribute("width")) || 0, h = parseFloat(r.getAttribute("height")) || 0;
      r.style.transformBox = "fill-box"; r.style.transition = "none";
      if (w >= h) { r.style.transformOrigin = "left center"; r.style.transform = "scaleX(0)"; r.__axis = "X"; }
      else { r.style.transformOrigin = "center bottom"; r.style.transform = "scaleY(0)"; r.__axis = "Y"; }
    });
    p.pts.forEach(function (c) {
      c.style.transformBox = "fill-box"; c.style.transformOrigin = "center";
      c.style.transition = "none"; c.style.transform = "scale(0)"; c.style.opacity = "0";
    });
    // images: only wipe deeper figures (a hero image must read fully on load)
    if (!isHero) p.imgs.forEach(function (im) {
      im.style.transition = "none"; im.style.clipPath = "inset(0 100% 0 0)"; im.style.webkitClipPath = "inset(0 100% 0 0)";
    });
  }

  function build(p) {
    if (p.svg) void p.svg.getBoundingClientRect(); // flush collapsed state
    p.bands.forEach(function (b, i) {
      var d = i * 0.08;
      b.style.transition = "transform .95s cubic-bezier(.2,.7,.2,1) " + d + "s, opacity .7s ease " + d + "s";
      b.style.transform = "scaleY(1)"; b.style.opacity = "1";
    });
    p.lines.forEach(function (l, i) {
      var d = 0.22 + i * 0.12;
      l.style.transition = "stroke-dashoffset 1.5s cubic-bezier(.4,0,.2,1) " + d + "s";
      l.style.strokeDashoffset = "0";
    });
    p.bars.forEach(function (r, i) {
      r.style.transition = "transform .8s cubic-bezier(.2,.75,.25,1) " + (0.12 + i * 0.1) + "s";
      r.style.transform = r.__axis === "X" ? "scaleX(1)" : "scaleY(1)";
    });
    p.pts.forEach(function (c, i) {
      var d = 0.5 + i * 0.035;
      c.style.transition = "transform .55s cubic-bezier(.2,1.5,.4,1) " + d + "s, opacity .4s ease " + d + "s";
      c.style.transform = "scale(1)"; c.style.opacity = "1";
    });
    p.imgs.forEach(function (im) {
      im.style.transition = "clip-path 1.15s cubic-bezier(.4,0,.2,1), -webkit-clip-path 1.15s cubic-bezier(.4,0,.2,1)";
      im.style.clipPath = "inset(0 0 0 0)"; im.style.webkitClipPath = "inset(0 0 0 0)";
    });
    setTimeout(function () { cleanup(p); }, 2900);
  }

  function cleanup(p) {
    p.bands.forEach(function (b) { b.style.transition = ""; b.style.transform = "none"; b.style.opacity = ""; b.style.transformBox = ""; });
    p.lines.forEach(function (l) { l.style.transition = ""; l.style.strokeDasharray = "none"; l.style.strokeDashoffset = "0"; });
    p.bars.forEach(function (r) { r.style.transition = ""; r.style.transform = "none"; r.style.transformBox = ""; });
    p.pts.forEach(function (c) { c.style.transition = ""; c.style.transform = "none"; c.style.opacity = ""; });
    p.imgs.forEach(function (im) { im.style.transition = ""; im.style.clipPath = ""; im.style.webkitClipPath = ""; });
  }

  function finalNow(p) { cleanup(p); }

  /* ---------- per-figure setup ---------- */
  function setupFigure(fig, forceHero) {
    if (fig.__pifx) return; fig.__pifx = 1;
    var parts = classify(fig);
    if (!hasParts(parts)) return;
    var rect = fig.getBoundingClientRect();
    var isHero = forceHero || (rect.top + sy) < (vh * 1.15);

    if (!canAnimate()) { finalNow(parts); return; }

    collapse(parts, isHero);

    if (isHero) {
      setTimeout(function () { build(parts); }, 450);
    } else if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { build(parts); io.unobserve(e.target); } });
      }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
      io.observe(fig);
      setTimeout(function () { build(parts); }, 4200); // safety net
    } else {
      build(parts);
    }
  }

  /* ---------- progress rail + parallax loop ---------- */
  function ensureBar() {
    if (bar || document.getElementById("pifx-rail")) { bar = bar || document.getElementById("pifx-rail"); return; }
    bar = document.createElement("div");
    bar.id = "pifx-rail";
    bar.setAttribute("aria-hidden", "true");
    // Full-width element scaled on the X axis: width changes are composited, never laid out.
    bar.style.cssText = "position:fixed;top:0;left:0;height:2px;width:100%;background:#FFB006;z-index:9999;pointer-events:none;box-shadow:0 0 12px rgba(255,176,6,.55);transform:scaleX(0);transform-origin:left center;will-change:transform";
    (document.body || document.documentElement).appendChild(bar);
  }

  function frame() {
    loopRunning = false;
    sy = window.pageYOffset || document.documentElement.scrollTop || 0;
    if (sy === lastSy) return;   // nothing moved; skip writes
    lastSy = sy;
    if (bar) bar.style.transform = "scaleX(" + clamp(sy / maxScroll, 0, 1).toFixed(4) + ")";
    for (var i = 0; i < parallaxEls.length; i++) {
      var pe = parallaxEls[i];
      if (pe.baseY === null) pe.baseY = sy;
      pe.el.style.transform = "translate3d(0," + ((sy - pe.baseY) * -pe.factor).toFixed(2) + "px,0)";
    }
  }
  function onScroll() {
    if (loopRunning) return; loopRunning = true; requestAnimationFrame(frame);
  }

  function setupParallax(root) {
    if (!parallaxAllowed()) return;
    qsa(root, "figure[data-hero], [data-pfx-parallax]").forEach(function (el) {
      if (el.__pifxpl) return; el.__pifxpl = 1;
      var f = parseFloat(el.getAttribute("data-pfx-parallax")) || 0.06;
      el.style.willChange = "transform";
      // arm after the entrance animation has cleared its own transform
      setTimeout(function () { parallaxEls.push({ el: el, factor: f, baseY: null }); }, 1400);
    });
  }

  /* ---------- init ---------- */
  function init(root) {
    root = root || document;
    vh = window.innerHeight || vh;
    sy = window.pageYOffset || 0;

    if (!canAnimate()) {
      qsa(root, "figure").forEach(function (fig) {
        if (fig.__pifx) return; fig.__pifx = 1;
        var parts = classify(fig); if (hasParts(parts)) finalNow(parts);
      });
      return;
    }

    ensureBar();
    measure();
    var heroDone = false;
    qsa(root, "figure").forEach(function (fig) {
      if (fig.__pifx) return;
      var parts = classify(fig);
      if (!hasParts(parts)) { fig.__pifx = 1; return; }
      // The first qualifying figure on the page is always treated as the hero
      // (build on load); later figures build on scroll-in.
      var asHero = !heroDone;
      heroDone = true;
      setupFigure(fig, asHero);
    });
    setupParallax(root);

    if (!loopRunning) {
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", function () { measure(); lastSy = -1; onScroll(); }, { passive: true });
      // height settles as fonts/images/lazy media load; refresh the cached bounds a few times
      [600, 1500, 3500].forEach(function (t) { setTimeout(function () { measure(); lastSy = -1; onScroll(); }, t); });
      requestAnimationFrame(frame);
    }
  }

  function boot() { if (booted) return; booted = true; init(document); }

  if (document.readyState === "complete") setTimeout(boot, 250);
  else window.addEventListener("load", function () { setTimeout(boot, 200); });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") { booted = false; boot(); }
  });

  window.PIScrollFX = { init: init };
})();
