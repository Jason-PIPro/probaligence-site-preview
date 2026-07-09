/* PI Probaligence, shared site behaviour. Progressive enhancement only:
   the site works with JS off (nav links visible, dropdowns open on hover/focus,
   content shown, form posts nowhere yet). This adds touch/keyboard support,
   the consent banner with a reset control, the demo-form handler, and a figure
   lightbox. No external resources. The scroll-progress rail is owned by
   scrollfx.js. */
(function () {
  "use strict";

  /* ---------- sticky header state ---------- */
  var header = document.querySelector(".site-header");
  if (header) {
    var onScroll = function () { header.classList.toggle("scrolled", window.scrollY > 8); };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ---------- marquee: an explicit pause control (WCAG 2.2.2) ----------
     No hover pause: the banner keeps scrolling under the pointer. The button
     is the only way to pause, which still satisfies WCAG 2.2.2.
     Covers both variants: the shared .marquee-track and the inline-styled [data-marquee]. */
  document.querySelectorAll(".marquee-track, [data-marquee]").forEach(function (track) {
    var host = track.closest("section") || track.parentElement;
    if (!host || host.querySelector(".marquee-pause")) return;
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "marquee-pause";
    btn.setAttribute("aria-pressed", "false");
    btn.setAttribute("aria-label", "Pause the logo animation");
    btn.textContent = "❚❚";
    btn.addEventListener("click", function () {
      track.__pinned = !track.__pinned;
      track.style.animationPlayState = track.__pinned ? "paused" : "";
      btn.setAttribute("aria-pressed", track.__pinned ? "true" : "false");
      btn.textContent = track.__pinned ? "▶" : "❚❚";
      btn.setAttribute("aria-label", track.__pinned ? "Resume the logo animation" : "Pause the logo animation");
    });
    host.appendChild(btn);
  });

  /* ---------- active link highlight ---------- */
  (function () {
    var path = location.pathname.replace(/index\.html$/, "");
    if (path.length > 1 && path.charAt(path.length - 1) !== "/") path += "/";
    document.querySelectorAll(".site-header a[href]").forEach(function (a) {
      var href = a.getAttribute("href");
      if (!href || href.charAt(0) !== "/") return;
      var hp = href.length > 1 && href.charAt(href.length - 1) !== "/" ? href + "/" : href;
      if (hp === path && hp !== "/") a.classList.add("active");
    });
  })();

  /* ---------- mobile menu ---------- */
  var toggle = document.querySelector(".nav-toggle");
  var panel = document.querySelector(".mobile-panel");
  if (toggle && panel) {
    toggle.addEventListener("click", function () {
      var open = panel.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      document.body.style.overflow = open ? "hidden" : "";
    });
    panel.addEventListener("click", function (e) {
      if (e.target.closest("a")) {
        panel.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
        document.body.style.overflow = "";
      }
    });
  }

  /* ---------- desktop dropdowns: click to toggle (touch), Escape, outside-click ---------- */
  var groups = Array.prototype.slice.call(document.querySelectorAll(".site-header .has-menu"));
  groups.forEach(function (group) {
    var trigger = group.querySelector(".nav-trigger");
    if (!trigger) return;
    trigger.addEventListener("click", function (e) {
      e.preventDefault();
      var open = trigger.getAttribute("aria-expanded") === "true";
      closeAll();
      trigger.setAttribute("aria-expanded", open ? "false" : "true");
    });
  });
  function closeAll() {
    groups.forEach(function (g) {
      var t = g.querySelector(".nav-trigger");
      if (t) t.setAttribute("aria-expanded", "false");
    });
  }
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      closeAll();
      if (panel && panel.classList.contains("open")) {
        panel.classList.remove("open");
        if (toggle) { toggle.setAttribute("aria-expanded", "false"); toggle.focus(); }
        document.body.style.overflow = "";
      }
    }
  });
  document.addEventListener("click", function (e) {
    if (!e.target.closest(".has-menu")) closeAll();
  });

  /* ---------- cookie consent, with a reset/update control ---------- */
  var KEY = "pi-consent";
  function getConsent() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function setConsent(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  function clearConsent() { try { localStorage.removeItem(KEY); } catch (e) {} }

  function buildBanner() {
    if (document.querySelector(".consent-banner")) return;
    var b = document.createElement("div");
    b.className = "consent-banner";
    b.setAttribute("role", "region");
    b.setAttribute("aria-label", "Cookie consent");
    b.innerHTML =
      '<p>This site uses only essential storage by default. With your consent we may add analytics to improve it. See the <a href="/cookies/">cookie information</a>.</p>' +
      '<div class="consent-actions">' +
      '<button type="button" class="consent-btn secondary" data-consent="essential">Essential only</button>' +
      '<button type="button" class="consent-btn primary" data-consent="all">Accept analytics</button>' +
      '</div>';
    b.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-consent]");
      if (!btn) return;
      setConsent(btn.getAttribute("data-consent"));
      if (b.parentNode) b.parentNode.removeChild(b);
      // non-essential scripts would initialise here when consent === "all"
    });
    document.body.appendChild(b);
    var first = b.querySelector("button");
    if (first) first.focus();
  }
  if (!getConsent()) {
    if (document.body) buildBanner();
    else document.addEventListener("DOMContentLoaded", buildBanner);
  }
  // any element with [data-consent-reset] reopens the banner so a choice can be changed
  document.addEventListener("click", function (e) {
    var r = e.target.closest("[data-consent-reset]");
    if (!r) return;
    e.preventDefault();
    clearConsent();
    buildBanner();
  });

  /* ---------- demo request form (staged: routing not wired yet) ---------- */
  var form = document.querySelector("form[data-demo], form#demo-form, .contact-form form");
  if (!form) {
    // fall back to the first form that has the demo fields
    document.querySelectorAll("form").forEach(function (f) {
      if (!form && f.querySelector('[name="email"]')) form = f;
    });
  }
  if (form) {
    form.setAttribute("novalidate", "novalidate");
    var done = form.querySelector(".form-ok, [data-form-ok]");
    form.addEventListener("submit", function (e) {
      e.preventDefault(); // routing is a deliberate team input; nothing is sent yet
      var valid = true, firstBad = null;
      form.querySelectorAll("[required]").forEach(function (el) {
        var good = el.type === "checkbox" ? el.checked : String(el.value).trim().length > 0;
        if (el.type === "email") good = good && /.+@.+\..+/.test(el.value);
        var field = el.closest(".field") || el.parentNode;
        if (field && field.classList) field.classList.toggle("error", !good);
        if (!good) { valid = false; if (!firstBad) firstBad = el; }
      });
      // honeypot: if a bot filled the hidden field, stop silently
      var hp = form.querySelector('.hp input, [name="website"]');
      if (hp && hp.value) return;
      if (!valid) { if (firstBad) firstBad.focus(); return; }
      if (done) {
        done.hidden = false;
        done.classList.add("show");
        done.setAttribute("tabindex", "-1");
        done.focus();
        form.querySelectorAll(".field, .field-row, .cta-row, .check, button[type=submit]").forEach(function (n) {
          if (!n.contains(done)) n.style.display = "none";
        });
      } else {
        form.innerHTML = '<p role="status" style="color:var(--text);font:500 16px/1.6 \'IBM Plex Sans\',sans-serif">' +
          'Thank you. Your request has been validated. Sending is not yet connected on this preview, ' +
          'so please also write to <a href="mailto:info@probaligence.com" style="color:var(--amber)">info@probaligence.com</a> for now.</p>';
      }
    });
    form.querySelectorAll("input, textarea").forEach(function (el) {
      el.addEventListener("input", function () {
        var f = el.closest(".field") || el.parentNode;
        if (f && f.classList) f.classList.remove("error");
      });
    });
  }

  /* ---------- figure lightbox (enhancement; alt text already carries content) ---------- */
  var figImgs = document.querySelectorAll(".shot img, .diagram img, figure[data-zoom] img");
  if (figImgs.length) {
    var box = null, boxImg = null, opener = null, closeBtn = null;
    function ensureBox() {
      if (box) return;
      box = document.createElement("div");
      box.className = "lightbox";
      box.hidden = true;
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-modal", "true");
      box.setAttribute("aria-label", "Enlarged image");
      boxImg = document.createElement("img");
      closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "lightbox-close";
      closeBtn.setAttribute("aria-label", "Close enlarged image");
      closeBtn.innerHTML = "&times;";
      box.appendChild(boxImg);
      box.appendChild(closeBtn);
      document.body.appendChild(box);
      closeBtn.addEventListener("click", close);
      box.addEventListener("click", function (e) { if (e.target === box) close(); });
    }
    function open(src, alt) {
      ensureBox();
      boxImg.src = src; boxImg.alt = alt || "";
      box.hidden = false;
      document.documentElement.style.overflow = "hidden";
      closeBtn.focus();
    }
    function close() {
      if (!box) return;
      box.hidden = true;
      document.documentElement.style.overflow = "";
      if (opener) opener.focus();
    }
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && box && !box.hidden) close(); });
    // focus trap: the close button is the dialog's only focusable control, so keep Tab on it
    document.addEventListener("keydown", function (e) {
      if (e.key === "Tab" && box && !box.hidden) { e.preventDefault(); closeBtn.focus(); }
    });
    figImgs.forEach(function (img) {
      img.classList.add("zoomable");
      img.setAttribute("role", "button");
      img.setAttribute("tabindex", "0");
      var alt = img.getAttribute("alt");
      img.setAttribute("aria-label", "Enlarge image" + (alt ? ": " + alt : ""));
      function go() { opener = img; open(img.currentSrc || img.src, alt); }
      img.addEventListener("click", go);
      img.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
      });
    });
  }

  /* ---------- use-case story accordions (solution pages) ---------- */
  document.querySelectorAll("[data-uc-toggle]").forEach(function (card) {
    var body = card.querySelector("[data-uc-body]");
    if (!body) return;
    var ind = card.querySelector("[data-uc-ind]");
    var hint = card.querySelector("[data-uc-hint]");
    card.setAttribute("aria-expanded", "false");
    function expand() {
      body.style.display = "block";
      var h = body.scrollHeight;
      body.style.maxHeight = "0px"; body.style.opacity = "0";
      void body.offsetHeight; // reflow so the transition runs
      body.style.maxHeight = h + "px"; body.style.opacity = "1";
      card.setAttribute("aria-expanded", "true");
      if (ind) ind.textContent = "×";
      if (hint) hint.textContent = "Close the story";
      var done = function () { body.style.maxHeight = "none"; body.removeEventListener("transitionend", done); };
      body.addEventListener("transitionend", done);
    }
    function collapse() {
      body.style.maxHeight = body.scrollHeight + "px"; void body.offsetHeight;
      body.style.maxHeight = "0px"; body.style.opacity = "0";
      card.setAttribute("aria-expanded", "false");
      if (ind) ind.textContent = "+";
      if (hint) hint.textContent = "Open the story →";
      setTimeout(function () { if (card.getAttribute("aria-expanded") === "false") body.style.display = "none"; }, 600);
    }
    function toggle(e) {
      if (e && e.target.closest && e.target.closest("a")) return; // let real links work
      if (card.getAttribute("aria-expanded") === "true") collapse(); else expand();
    }
    card.addEventListener("click", toggle);
    card.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });
  });

  /* ---------- scroll reveals + count-ups (restores the motion the React build had) ----------
     Progressive and safe: content is shipped visible (baked opacity:1). We only hide
     elements that are BELOW the fold at load, so nothing flashes, then reveal them on
     scroll. With reduced-motion or no IntersectionObserver, everything stays visible and
     numbers show their final value. */
  (function () {
    // Motion preview override: ?motion=1 (persisted in localStorage) forces animations on
    // even when the OS requests reduced motion; ?motion=0 clears it. Default respects the OS.
    var forced = false;
    try { forced = localStorage.getItem("pi-motion") === "on"; } catch (e) {}
    if (forced) window.__PIFX_FORCE = true; // scrollfx reads this to animate its figures
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches && !forced;
    if (reduce) return; // leave everything shipped-visible, numbers at final value
    var EASE = "cubic-bezier(.16,.84,.32,1)";            // smooth ease-out
    var vh = window.innerHeight || 800;
    var FOLD = vh * 0.92;
    // Smoothest path: CSS scroll-driven reveals (compositor, scrubbed to scroll) handle
    // sections where supported (see site.css). JS only falls back where it is not.
    var scrollDriven = !!(window.CSS && CSS.supports && CSS.supports("animation-timeline", "view()"));

    /* ---- count-up: works for [data-count] AND detected stat numbers; keeps exact final text ---- */
    function countUp(el) {
      if (el.__counted) return; el.__counted = 1;
      var raw = el.getAttribute("data-count");
      var finalText = (raw !== null && raw !== "") ? raw : el.textContent.trim();
      var target = parseFloat(String(finalText).replace(/,/g, ""));
      if (isNaN(target)) return;
      var neg = target < 0, hasComma = /,/.test(finalText);
      var dec = ((String(finalText).split(".")[1] || "").match(/\d/g) || []).length;
      var dur = 1200, t0 = null;
      function fmt(v) {
        var s = Math.abs(v).toFixed(dec);
        if (hasComma) { var p = s.split("."); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ","); s = p.join("."); }
        return (neg ? "-" : "") + s;
      }
      function step(now) {
        if (t0 === null) t0 = now;
        var p = Math.min((now - t0) / dur, 1), e = 1 - Math.pow(1 - p, 3);
        el.textContent = fmt(target * e);
        if (p < 1) requestAnimationFrame(step); else el.textContent = finalText; // exact final formatting
      }
      requestAnimationFrame(step);
    }

    /* ---- HERO ENTRANCE: stagger the hero content in on load (FOUC-free; CSS hides it pre-paint) ---- */
    var hero = document.querySelector("[data-hero-in]");
    if (hero && document.documentElement.classList.contains("anim")) {
      var ec = function (n) { return Array.prototype.filter.call(n.children, function (c) { return c.nodeType === 1; }); };
      var h1 = hero.querySelector("h1");
      var col = h1 ? h1.parentElement : hero;
      var hk = ec(col);
      if (hk.length < 2 && hk[0]) hk = ec(hk[0]);   // descend if content is wrapped in one child
      // smooth CSS-keyframe entrance (transform/opacity, defined in site.css), staggered by delay.
      hk.forEach(function (k, i) { k.classList.add("pi-hero-item"); k.style.animationDelay = (i * 90) + "ms"; });
      requestAnimationFrame(function () { requestAnimationFrame(function () { hero.classList.add("in"); }); });
    }

    var hasIO = "IntersectionObserver" in window;

    /* ---- count-up targets: explicit data-count + detected display-size numbers ---- */
    var counts = Array.prototype.slice.call(document.querySelectorAll("[data-count]"));
    Array.prototype.forEach.call(document.querySelectorAll("main *"), function (el) {
      if (el.hasAttribute("data-count") || el.children.length) return;
      var txt = el.textContent.trim();
      if (!/^-?\d{1,3}(,\d{3})+$/.test(txt) && !/^-?\d{1,4}(\.\d+)?$/.test(txt)) return; // pure number
      if (/^-?0\d/.test(txt)) return;                 // skip 01, 02 step labels
      var st = el.getAttribute("style") || "";
      var m = st.match(/font[^;"]*?(\d{2,3})px/);      // only large display numbers
      if (!m || parseInt(m[1], 10) < 28) return;
      counts.push(el);
    });
    counts.forEach(function (el) {
      if (!hasIO) { countUp(el); return; }
      var r = el.getBoundingClientRect();
      if (r.top < FOLD && r.bottom > 0) { countUp(el); return; }
      var o = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { countUp(el); o.unobserve(el); } });
      }, { threshold: 0.6 });
      o.observe(el);
    });

    /* ---- scroll reveals ----
       Preferred path: CSS scroll-driven animation (site.css), which scrubs smoothly with
       scroll on the compositor. We apply it to content BLOCKS inside each section rather
       than the tall section itself (a section taller than the viewport finishes revealing
       before it is in comfortable view; small blocks reveal as each one scrolls in, like a
       per-element reveal). JS only falls back to IntersectionObserver where view() is
       unsupported (Safari/Firefox today). transform + opacity only. */
    function ec2(n) { return Array.prototype.filter.call(n.children, function (c) { return c.nodeType === 1; }); }
    function markBlocks(fn) {
      Array.prototype.forEach.call(document.querySelectorAll("main [data-reveal]:not([data-hero-in])"), function (sec) {
        var c = sec;
        for (var i = 0; i < 4; i++) { var k = ec2(c); if (k.length === 1) c = k[0]; else break; } // drill single-child wrappers
        ec2(c).forEach(function (block) {
          var bk = ec2(block);
          if (bk.length >= 2 && bk.length <= 8) bk.forEach(fn);   // a row/grid: reveal each card
          else fn(block);                                          // a single block: reveal it
        });
      });
    }

    if (scrollDriven) {
      markBlocks(function (el) { el.classList.add("pi-rv"); });    // CSS view() animation handles the rest
      return;
    }
    if (!hasIO) return;
    // JS fallback (no view() support): hide blocks below the fold, reveal on intersect
    function hide(el) {
      el.style.opacity = "0"; el.style.transform = "translateY(40px)";
      el.style.transition = "opacity .7s " + EASE + ", transform .8s " + EASE;
      el.style.willChange = "transform, opacity";
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.style.opacity = "1"; en.target.style.transform = "none"; io.unobserve(en.target); }
      });
    }, { threshold: 0.15, rootMargin: "0px 0px -8% 0px" });
    markBlocks(function (el) {
      if (el.getBoundingClientRect().top < FOLD) return; // above fold: leave visible
      hide(el); io.observe(el);
    });
  })();

  /* ---------- current year ---------- */
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });
})();
