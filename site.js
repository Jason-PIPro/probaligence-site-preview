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

  /* ---------- demonstration ticker: same pause contract ----------
     The warning strip on the interactive demos scrolls on its own. Its button
     ships in the page markup (the strip is a fixed 26px, so it cannot be
     appended blind like the marquee one); this only toggles the animation. */
  document.querySelectorAll(".demo-ticker").forEach(function (ticker) {
    var track = ticker.querySelector(".demo-ticker-track");
    var btn = ticker.querySelector(".demo-ticker-pause");
    if (!track || !btn) return;
    btn.addEventListener("click", function () {
      track.__pinned = !track.__pinned;
      track.style.animationPlayState = track.__pinned ? "paused" : "";
      btn.setAttribute("aria-pressed", track.__pinned ? "true" : "false");
      btn.textContent = track.__pinned ? "▶" : "❚❚";
      btn.setAttribute("aria-label", track.__pinned
        ? "Resume the demonstration notice" : "Pause the demonstration notice");
    });
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

  /* ---------- cookie consent, with a reset/update control ----------
     PI runs cookieless for now (decision 2026-07-09): no analytics, no
     non-essential storage, so there is nothing to consent to and the banner
     is not shown. The machinery below is kept intact. To bring analytics
     back: set ANALYTICS_ENABLED = true (re-shows the banner), restore the
     footer "Cookie settings" link in build_static.py's FOOTER_ONLY, then
     initialise the tracker where marked "non-essential scripts would
     initialise here". */
  var ANALYTICS_ENABLED = false;
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
      '<p>This site uses only essential storage by default. With your consent we may add analytics to improve it. See the <a href="/probaligence-site-preview/privacy/">privacy notice</a>.</p>' +
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
  if (ANALYTICS_ENABLED) {
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
  }
  // No else branch: while ANALYTICS_ENABLED is false the footer carries no
  // "Cookie settings" control at all (removed from the markup and from
  // build_static.py's FOOTER_ONLY on 2026-07-29, Jason's call). Setting
  // ANALYTICS_ENABLED = true therefore also means putting
  // <a href="#" data-consent-reset>Cookie settings</a> back into the footer
  // template, or the banner can be answered once and never reopened.

  /* ---------- demo request form ----------
     Posts to the Cloudflare Worker in 06_website-build/site-services/, which
     files the request as an issue on the PRIVATE repo. Leave the endpoint
     empty until that Worker is deployed: the form then validates and shows the
     email fallback instead of failing on a dead URL. Setup: DEMO-DEPLOY-SETUP.md.

     Wired 2026-07-29. Two things move with this value and must never diverge:
       1. connect-src in security-headers/ (all three host formats). A filled
          endpoint with an unlisted origin means the browser blocks every submit.
       2. ALLOW_ORIGIN on the Worker, which must be the origin the form is
          served from, or the Worker answers 403.
     Derived from the Cloudflare subdomain in demo-extras/feedback-config.json
     and the Worker name in DEMO-DEPLOY-SETUP.md part C2. Confirm it against the
     real Worker URL after deploying, then run the part C5 tests. */
  var DEMO_FORM_ENDPOINT = "https://pi-demo-request.jason-easaw.workers.dev";
  var MAIL_LINK = '<a href="mailto:info@probaligence.com" style="color:var(--amber)">info@probaligence.com</a>';
  // Same slot picker the contact card links to. Kept here so the success state
  // can name a next step instead of stopping at "we will come back to you".
  var BOOK_LINK = '<a href="https://bookings.cloud.microsoft/book/PIProbaligenceGmbHBooking@probaligence.de/"' +
    ' target="_blank" rel="noopener" style="color:var(--amber)">pick a slot that suits you</a>';
  var form = document.querySelector("form[data-demo], form#demo-form, .contact-form form");
  if (!form) {
    // fall back to the first form that has the demo fields
    document.querySelectorAll("form").forEach(function (f) {
      // data-no-demo-form opts a form out of this handler. Without it, any form
      // with an email field (the newsletter signup) is treated as the demo form.
      if (!form && !f.hasAttribute("data-no-demo-form") && f.querySelector('[name="email"]')) form = f;
    });
  }
  if (form) {
    form.setAttribute("novalidate", "novalidate");
    var done = form.querySelector(".form-ok, [data-form-ok]");
    var submitBtn = form.querySelector("button[type=submit]");
    var submitLabel = submitBtn ? submitBtn.textContent : "";
    var sending = false;

    // Say up front that sending is not connected yet, instead of letting the
    // visitor find out only after they have typed out a whole request. Tied to
    // the endpoint, so filling DEMO_FORM_ENDPOINT in for launch removes it.
    if (!DEMO_FORM_ENDPOINT && submitBtn && submitBtn.parentNode) {
      var pending = document.createElement("p");
      pending.setAttribute("data-form-pending", "");
      pending.style.cssText = "margin:0;padding:11px 13px;border:1px solid rgba(255,176,6,.26);" +
        "border-left:2px solid #FFB006;background:rgba(255,176,6,.06);" +
        "font:400 13.5px/1.6 'IBM Plex Sans',sans-serif;color:#C8C8C2";
      pending.innerHTML = "This form is not connected yet. It will start sending when the site goes live. " +
        "Until then, write to " + MAIL_LINK + ".";
      submitBtn.parentNode.insertBefore(pending, submitBtn);
    }

    /* ---------- clear what was typed once it has been sent ----------
       Reported 2026-07-30: after a successful send, reloading the page brought
       the whole request back in the fields. Browsers restore form state on a
       reload, so on a shared machine the next visitor saw the previous
       person's name, address, and use case, and one click would have sent it
       again. Two steps, because the restore happens on the fresh load and not
       in the tab that sent: reset the fields on success, and flag the send so
       the first load after it starts empty. */
    var SENT_KEY = "pi-demo-sent";
    function clearFields() {
      try { form.reset(); } catch (e) {}
      form.querySelectorAll("input, select, textarea").forEach(function (el) {
        el.__touched = false;
        el.removeAttribute("aria-invalid");
      });
      var stale = form.querySelector("[data-form-summary]");
      if (stale) stale.textContent = "";
    }
    function clearIfSent() {
      var flagged = null;
      try { flagged = sessionStorage.getItem(SENT_KEY); } catch (e) {}
      if (!flagged) return;
      try { sessionStorage.removeItem(SENT_KEY); } catch (e) {}
      clearFields();
    }
    clearIfSent();
    window.addEventListener("pageshow", clearIfSent);

    // Success: reveal the prepared confirmation block if the page has one,
    // otherwise replace the form body with the message.
    function finish(html) {
      var pend = form.querySelector("[data-form-pending]");
      if (pend) pend.remove();
      if (done) {
        if (html) done.innerHTML = html;
        done.hidden = false;
        done.classList.add("show");
        done.setAttribute("tabindex", "-1");
        done.focus();
        form.querySelectorAll(".field, .field-row, .cta-row, .check, button[type=submit]").forEach(function (n) {
          if (!n.contains(done)) n.style.display = "none";
        });
      } else {
        form.innerHTML = '<p role="status" style="color:var(--text);font:500 16px/1.6 \'IBM Plex Sans\',sans-serif">' + html + "</p>";
      }
    }

    // Failure: keep the form intact so the visitor can retry, and give them the
    // email route as well. Never lose what they typed.
    function failed(html) {
      sending = false;
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = submitLabel; }
      var note = form.querySelector("[data-form-error]");
      if (!note) {
        note = document.createElement("p");
        note.setAttribute("data-form-error", "");
        note.setAttribute("role", "alert");
        note.style.cssText = "margin-top:14px;font:400 14px/1.6 'IBM Plex Sans',sans-serif;color:#F4B4B4";
        if (submitBtn && submitBtn.parentNode) submitBtn.parentNode.insertBefore(note, submitBtn.nextSibling);
        else form.appendChild(note);
      }
      note.innerHTML = html;
    }

    /* ---------- name the refusal (sign-off A4, 2026-08-06) ----------
       The Worker answers with a code in res.error and has nine distinct
       refusals, but every one of them used to produce the same "That did not go
       through". Someone whose address failed the email pattern was told nothing
       they could act on, which is how the empty-use-case rejection stayed
       invisible from launch until 2026-08-05. The codes are the error strings in
       site-services/demo-request-worker.js. Anything not listed, including a
       dropped connection that returns no body at all, falls through to the
       generic line, so a new Worker code degrades instead of showing nothing. */
    function refusalMessage(code) {
      var retry = " Please try again, or write to " + MAIL_LINK + " and we will pick it up from there.";
      if (code === "email") return "That email address did not pass our check. Look for a typo and send it again.";
      if (code === "name") return "The name field arrived empty. Add your name and send it again.";
      if (code === "rate") return "That is more requests from this connection than we accept in one minute. Wait a minute and send it again, or write to " + MAIL_LINK + ".";
      if (code === "big") return "That request is longer than the form accepts. Shorten the use case and send it again.";
      if (code === "captcha") return "The spam check did not pass. Reload the page and send it again, or write to " + MAIL_LINK + ".";
      if (code === "github") return "Your request reached us but could not be filed." + retry;
      if (code === "origin" || code === "method" || code === "json") {
        return "Something between your browser and us blocked this request, so it never arrived. Please write to " + MAIL_LINK + " and we will pick it up from there.";
      }
      return "That did not go through." + retry;
    }

    /* ---------- a real URL for the success state (sign-off A14, 2026-08-06) ----------
       The in-place message is written first and stays as the fallback, so a
       navigation that is blocked or fails still leaves a confirmation on screen.
       Only the demo request form navigates: this handler also adopts any other
       form carrying an email field (the newsletter signup), and that must never
       land on the contact thank-you page, hence the two-field test. The root
       comes from the brand link, the same trick the search uses for BASE below,
       because the demo build rebases that href onto its GitHub Pages subpath and
       does not rewrite arbitrary paths inside this file. */
    function goThankYou() {
      if (!form.querySelector('[name="company"]') || !form.querySelector('[name="message"]')) return;
      var brand = document.querySelector("header a.brand");
      var root = (brand && brand.getAttribute("href")) || "/";
      if (root.charAt(root.length - 1) !== "/") root += "/";
      try { location.assign(root + "contact/thank-you/"); } catch (e) {}
    }

    /* ---------- validation, staged and spoken ----------
       The form carries novalidate, so the browser says nothing and this is the
       only thing between the visitor and a silent dead end. Until 2026-07-29
       an invalid field got focus plus an .error class that no stylesheet
       defined: the cursor jumped and the page never said what was wrong.

       Staged the way design-toolbox/elements/premium-form-fields.html does it.
       A field is judged only once it has been left (blur) or once submit has
       been pressed, so nobody is told they are wrong while typing the first
       letter of their name. After that it re-checks on every keystroke, so the
       message clears the moment it is fixed rather than at the next submit.

       Copy lives in data-msg / data-msg-email on the field, so the wording is
       editable in the page. The fallbacks here keep any other form sensible. */
    var EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var msgSeq = 0;

    function fieldHost(el) { return el.closest(".field") || el.closest("label") || el.parentNode; }

    // The label text without the amber "*" and without the field's own value.
    function fieldName(el) {
      var lab = el.closest("label") || (el.id ? form.querySelector('label[for="' + el.id + '"]') : null);
      if (!lab) return "This field";
      var copy = lab.cloneNode(true);
      copy.querySelectorAll("input, select, textarea, .field-msg").forEach(function (n) { n.remove(); });
      return (copy.textContent || "").replace(/\*/g, "").trim() || "This field";
    }

    // "" when the field is fine, otherwise the sentence to show under it.
    function problem(el) {
      var v = String(el.value).trim();
      var empty = el.type === "checkbox" ? !el.checked : !v;
      if (empty) return el.getAttribute("data-msg") || fieldName(el) + " is required.";
      if ((el.type === "email" || el.name === "email") && !EMAIL_OK.test(v)) {
        return el.getAttribute("data-msg-email") || "Use a full address, for example you@company.com.";
      }
      return "";
    }

    function msgSlot(el) {
      var host = fieldHost(el);
      var m = host.querySelector(".field-msg");
      if (!m) {
        // A span, not a p: the fields sit inside their <label>, which only
        // takes phrasing content. The CSS gives it block behaviour.
        m = document.createElement("span");
        m.className = "field-msg";
        m.id = "field-msg-" + (++msgSeq);
        m.setAttribute("aria-live", "polite");
        host.appendChild(m);
      }
      return m;
    }

    // Show or clear one field's state. Returns true when the field is good.
    function mark(el) {
      var why = problem(el), m = msgSlot(el);
      m.textContent = why;
      if (why) {
        el.setAttribute("aria-invalid", "true");
        el.setAttribute("aria-describedby", m.id);
      } else {
        el.removeAttribute("aria-invalid");
        el.removeAttribute("aria-describedby");
      }
      return !why;
    }

    // One line above the button, so the reason is visible without hunting.
    function summary(text) {
      var s = form.querySelector("[data-form-summary]");
      if (!text) { if (s) s.remove(); return; }
      if (!s) {
        s = document.createElement("p");
        s.setAttribute("data-form-summary", "");
        s.setAttribute("role", "alert");
        s.className = "form-summary";
        if (submitBtn && submitBtn.parentNode) submitBtn.parentNode.insertBefore(s, submitBtn);
        else form.appendChild(s);
      }
      s.textContent = text;
    }

    // The header is sticky, so plain focus() can park the field under it.
    function reveal(el) {
      try { el.focus({ preventScroll: true }); } catch (err) { el.focus(); }
      if (el.scrollIntoView) {
        el.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
      }
    }

    // Once submit has been pressed the count above the button is live, so a
    // visitor fixing three fields watches it fall to nothing instead of
    // reading a stale "4 fields" while one is left.
    var submitTried = false;
    function refreshSummary() {
      if (!submitTried) return;
      var n = form.querySelectorAll('[aria-invalid="true"]').length;
      summary(!n ? "" : n === 1
        ? "One field still needs an answer, marked in red."
        : n + " fields still need an answer, marked in red.");
    }

    form.querySelectorAll("[required]").forEach(function (el) {
      el.addEventListener("blur", function () { el.__touched = true; mark(el); refreshSummary(); });
      var live = function () { if (el.__touched) { mark(el); refreshSummary(); } };
      el.addEventListener("input", live);
      el.addEventListener("change", live);
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (sending) return;
      var bad = [];
      submitTried = true;
      form.querySelectorAll("[required]").forEach(function (el) {
        el.__touched = true;
        if (!mark(el)) bad.push(el);
      });
      // honeypot: if a bot filled the hidden field, stop silently
      var hp = form.querySelector('.hp input, [name="website"]');
      if (hp && hp.value) return;
      refreshSummary();
      if (bad.length) { reveal(bad[0]); return; }

      var prevErr = form.querySelector("[data-form-error]");
      if (prevErr) prevErr.remove();

      // Not wired yet: validate, confirm, and point at email. No dead request.
      if (!DEMO_FORM_ENDPOINT) {
        finish("Thank you. Your request has been validated. Sending is not yet connected on this preview, " +
          "so please also write to " + MAIL_LINK + " for now.");
        return;
      }

      var val = function (n) { var el = form.querySelector('[name="' + n + '"]'); return el ? String(el.value).trim() : ""; };
      var payload = {
        name: val("name"),
        email: val("email"),
        company: val("company"),
        area: val("area"),
        message: val("message"),
        url: location.href.split("#")[0].slice(0, 200)
      };

      sending = true;
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Sending..."; }

      fetch(DEMO_FORM_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).then(function (r) {
        return r.json().catch(function () { return { ok: false }; });
      }).then(function (res) {
        if (!res || !res.ok) {
          // carry the Worker's code out to refusalMessage instead of losing it
          var refused = new Error("rejected");
          refused.code = res ? res.error : "";
          throw refused;
        }
        // it is sent: nothing typed here stays behind, in this tab or the next load
        try { sessionStorage.setItem(SENT_KEY, "1"); } catch (e) {}
        clearFields();
        // A5: name the next step and point at the booking link. No response
        // window, per the 2026-08-06 decision on C6.
        finish("Thank you. Your request has reached us. The next step is a short call to look at your use case: " +
          BOOK_LINK + ", or wait for our reply by email.");
        goThankYou();
      }).catch(function (err) {
        failed(refusalMessage(err && err.code));
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
      /* the demonstration warning ticker never reveals: a disclaimer faded to 10% while
         the demo above it is already usable defeats its purpose. Skips the strip itself
         AND anything inside it: depending on how a page nests the ticker the mark lands
         on .demo-ticker or on .demo-ticker-view, and marking the inner box hides the text
         while the strip's background stays (seen on /science/). Both reveal paths use this. */
      function mark(el) { if (!el.closest(".demo-ticker")) fn(el); }
      Array.prototype.forEach.call(document.querySelectorAll("main [data-reveal]:not([data-hero-in])"), function (sec) {
        var c = sec;
        for (var i = 0; i < 4; i++) { var k = ec2(c); if (k.length === 1) c = k[0]; else break; } // drill single-child wrappers
        ec2(c).forEach(function (block) {
          var bk = ec2(block);
          if (bk.length >= 2 && bk.length <= 8) bk.forEach(mark);  // a row/grid: reveal each card
          else mark(block);                                        // a single block: reveal it
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

  /* ---------- site search ----------
     No backend, so search runs in the browser against assets/search-index.json
     (built by tools/build-search-index.py). The index is fetched on the first
     open, not on page load, and warmed on hover, so it costs nothing to anyone
     who never searches. Trigger buttons are injected here rather than written
     into the page files: search needs JS, so without it there is no dead
     button, and the header markup in 84 files stays untouched. */
  (function () {
    var head = document.querySelector(".site-header");
    if (!head || !window.fetch || !document.createElement("div").classList) return;

    /* Site root. "/" in production; the demo build rebases the brand link to
       its GitHub Pages subpath, so reading it there keeps both the index fetch
       and every result URL correct without a second index build. */
    var brandLink = head.querySelector("a.brand");
    var BASE = (brandLink && brandLink.getAttribute("href")) || "/";
    if (BASE.charAt(BASE.length - 1) !== "/") BASE += "/";

    var MAX = 12;        // results listed in the overlay; /search/ lists them all
    var SNIP = 150;      // snippet length, characters
    /* A synonym hit is worth this fraction of a literal hit, applied to the
       field score and to the page authority alike. It keeps the promise the
       dictionary makes: a page that really contains the word always outranks a
       page reached by inference. */
    var ALIAS_W = 0.4;
    /* Page authority, added once per page. It has to be big enough to matter:
       a guide that happens to repeat a term in an h2 was beating the canonical
       method page on that term, which is keyword-stuffing logic, not relevance.
       Still below a title match (30), so a news article named for the query
       keeps winning its own name. */
    var RANK = { Home: 18, Product: 22, Solutions: 20, Science: 20, Company: 10, Guides: 8, News: 5, Site: 0 };
    var FEATURED = ["stochos/", "stochos-flow/", "ai-for-engineering/", "news/", "contact/"];
    // shown when a query finds nothing; each one returns pages, checked on build
    var SUGGEST = ["uncertainty", "paint formulation", "on-premise", "surrogate model"];
    var ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<circle cx="11" cy="11" r="7" stroke-linecap="round"/>' +
      '<path d="M16.3 16.3 21 21" stroke-linecap="round"/></svg>';
    var mac = /Mac|iPod|iPhone|iPad/.test(navigator.platform || "");
    var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

    var docs = null, pending = null, failed = false, syn = [], synAt = null, vocab = null;
    var overlay, input, list, countEl, navBtn, rows = [], active = -1, lastFocus = null, uid = 0;
    // true once the user has picked a row with the arrow keys: Enter opens that
    // row only when they chose it, otherwise Enter runs the full search
    var moved = false;

    /* ---- index ----
       foldKeep is length-preserving (an accented character decomposes to base
       plus mark, and dropping the mark restores the original length), so match
       offsets from it still index into the untouched source string. fold adds
       the one substitution that is not length-preserving and is therefore used
       for matching only, never for highlight offsets. */
    function foldKeep(s) {
      s = String(s).toLowerCase();
      if (s.normalize) s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      return s.replace(/[\u2018\u2019]/g, "'");
    }
    function fold(s) { return foldKeep(String(s).replace(/ß/g, "ss")); }
    function prepare(raw) {
      return raw.map(function (d) {
        var heads = (d.h || []).map(function (h) { return h[1]; });
        return {
          u: d.u, t: d.t, s: d.s, d: d.d || "", b: d.b || "", anchors: d.h || [],
          k: d.k || "",
          lt: fold(d.t), lu: fold(d.u.replace(/[/\-_]/g, " ")),
          lh: fold(heads.join(" · ")), ld: fold(d.d || ""), lb: fold(d.b || "")
        };
      });
    }
    /* The synonym dictionary (tools/search-synonyms.txt, shipped inside the
       index) as phrases split into words, plus a lookup from a phrase's first
       word so the tokeniser can test only the few groups that could match. */
    function prepareSyn(groups) {
      syn = (groups || []).map(function (g) {
        return g.map(function (p) { return fold(p).split(" "); });
      });
      /* Prototype-less: these are keyed by words the visitor types, and a plain
         object answers "constructor" or "toString" with something inherited
         from Object.prototype. That threw a TypeError and killed the query. */
      synAt = Object.create(null);
      syn.forEach(function (g, gi) {
        g.forEach(function (words, pi) {
          var k = words[0];
          (synAt[k] || (synAt[k] = [])).push([gi, pi, words.length]);
        });
      });
    }
    function load() {
      if (docs || failed) return pending || Promise.resolve(docs);
      if (!pending) {
        pending = fetch(BASE + "assets/search-index.json", { credentials: "same-origin" })
          .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
          .then(function (data) {
            docs = prepare(data.docs || []);
            prepareSyn(data.syn);
            return docs;
          })
          .catch(function () { failed = true; return null; });
      }
      return pending;
    }

    /* ---- scoring ----
       Terms match at a word start, so a half-typed "optimi" still finds
       "optimization" while "mi" does not match "optimization" mid-word. Every
       term must appear somewhere in a page for it to rank at all (AND). */
    function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
    /* A word the reader has finished, meaning anything followed by a space,
       has to match as a word and not as a prefix: "cad " means CAD, not CADFEM
       (2 pages against 29). Common English endings still count, so finishing a
       word does not throw away "engineers" for "engineer" or "models" for
       "model". The last word keeps matching as a prefix while it is still
       being typed, so results narrow with every keystroke. */
    /* Acronyms do not inflect, and inflecting them lands on unrelated English
       words: "doe" + "s" is "does", which sits on 35 pages that have nothing to
       do with design of experiments, against 5 that name DOE (measured
       2026-07-28 over the built corpus). A length floor was the wrong fix,
       because the tolerance is worth 20 pages on "fit " and 7 on "run ". So the
       acronyms are named instead. Add one when a short query returns prose
       pages; do not switch the tolerance off for words. */
    var NO_INFLECT = Object.assign(Object.create(null), {
      doe: 1, bo: 1, gp: 1, uq: 1, ml: 1, ai: 1, cad: 1, cae: 1, cfd: 1,
      fem: 1, hpc: 1, api: 1, ui: 1, roi: 1, kpi: 1, gui: 1, hte: 1
    });
    function pattern(t, whole) {
      if (!whole) return "\\b" + esc(t);
      if (NO_INFLECT[t]) return "\\b" + esc(t) + "\\b";
      var alt = esc(t) + "(?:s|es|ing|ed|ions?)?";
      if (t.charAt(t.length - 1) === "y") alt = alt + "|" + esc(t.slice(0, -1)) + "ies";
      return "\\b(?:" + alt + ")\\b";
    }
    /* A dictionary phrase as one pattern. Multi-word phrases tolerate whatever
       separator the page uses, so "on prem" in the dictionary finds "on-prem"
       in the copy. Single words keep the ending tolerance above. */
    function phrasePat(p) {
      var w = p.split(" ");
      if (w.length === 1) return pattern(w[0], true);
      return "\\b" + w.map(esc).join("[^a-z0-9+]+") + "\\b";
    }
    /* Longest dictionary phrase starting at token i, or null. A phrase only
       counts once every word in it is finished, so the word still under the
       cursor never triggers an expansion: "bo" on its way to "body" must not
       quietly turn into Bayesian optimization. */
    function phraseAt(raw, i, lastTyped) {
      var cands = synAt && synAt[raw[i]];
      if (!cands) return null;
      var best = null;
      for (var c = 0; c < cands.length; c++) {
        var gi = cands[c][0], pi = cands[c][1], len = cands[c][2];
        if (i + len > raw.length) continue;
        if (lastTyped >= 0 && i + len - 1 >= lastTyped) continue;
        var words = syn[gi][pi], ok = true;
        for (var w = 1; w < len; w++) {
          if (raw[i + w] !== words[w]) { ok = false; break; }
        }
        if (!ok) continue;
        if (!best || len > best.len) best = { len: len, groups: [gi], self: pi };
        else if (len === best.len && best.groups.indexOf(gi) < 0) best.groups.push(gi);
      }
      return best;
    }
    function terms(q) {
      var f = fold(q);
      var raw = f.split(/[^a-z0-9+]+/).filter(Boolean);
      // index of the word still being typed, or -1 once a separator ends it
      var lastTyped = /[a-z0-9+]$/.test(f) ? raw.length - 1 : -1;
      var seen = Object.create(null), out = [], i = 0;
      while (i < raw.length) {
        var hit = phraseAt(raw, i, lastTyped);
        var t, whole, alts = [];
        if (hit) {
          t = raw.slice(i, i + hit.len).join(" ");
          whole = true;
          hit.groups.forEach(function (gi) {
            syn[gi].forEach(function (words) {
              var p = words.join(" ");
              if (p !== t && alts.indexOf(p) < 0) alts.push(p);
            });
          });
          i += hit.len;
        } else {
          t = raw[i];
          whole = i !== lastTyped;
          i += 1;
        }
        if (t.length < 2 || seen[t]) continue;
        seen[t] = 1;
        var self = hit ? phrasePat(t) : pattern(t, whole);
        var term = {
          t: t, whole: whole, re: new RegExp(self, "g"),
          alt: alts.length
            ? new RegExp("(?:" + alts.map(phrasePat).join("|") + ")", "g")
            : null,
          hi: [self].concat(alts.map(phrasePat))
        };
        out.push(term);
      }
      return out;
    }
    function hits(hay, re, cap) {
      re.lastIndex = 0;
      var n = 0;
      while (n < cap && re.exec(hay)) n++;
      return n;
    }
    /* Where a term appears decides what it is worth. Unchanged weights: they
       were tuned against a query matrix and do not move one at a time. */
    function fields(d, re) {
      var s = 0;
      if (hits(d.lt, re, 1)) s += 30;
      if (hits(d.lu, re, 1)) s += 14;
      if (hits(d.lh, re, 1)) s += 8;
      if (hits(d.ld, re, 1)) s += 8;
      return s + hits(d.lb, re, 3) * 3;
    }
    /* A term scores literally, or, only when the page has no literal hit at
       all, through the dictionary at ALIAS_W. A page that matches literally
       therefore scores exactly what it scored before synonyms existed. */
    function termScore(d, t) {
      var s = fields(d, t.re);
      if (s) return { s: s, w: 1 };
      if (t.alt) {
        s = fields(d, t.alt);
        if (s) return { s: s * ALIAS_W, w: ALIAS_W };
      }
      return null;
    }
    function score(d, ts, phrase, any) {
      var total = 0, weight = 0, matched = 0;
      for (var i = 0; i < ts.length; i++) {
        var r = termScore(d, ts[i]);
        if (!r) {
          if (!any) return 0;   // every term must appear (AND)
          continue;
        }
        matched++;
        total += r.s;
        weight += r.w;
      }
      if (!matched) return 0;
      if (phrase && ts.length > 1) {
        if (d.lt.indexOf(phrase) >= 0) total += 60;
        else if (d.lh.indexOf(phrase) >= 0 || d.ld.indexOf(phrase) >= 0) total += 25;
        else if (d.lb.indexOf(phrase) >= 0) total += 12;
      }
      // scaled by matched weight, not term count: the per-term field scores grow
      // with the query, so a flat bonus would shrink away and "ai for
      // engineering" would return a news article ahead of the solution page it
      // is named after. Using the weight also stops a page reached only through
      // the dictionary from riding full page authority past a literal match.
      return total + (RANK[d.s] || 0) * weight;
    }
    function run(q, any) {
      var ts = terms(q);
      if (!docs || !ts.length) return [];
      var phrase = fold(q).trim(), out = [];
      docs.forEach(function (d) {
        var s = score(d, ts, phrase, any);
        if (s > 0) out.push({ d: d, s: s, ts: ts });
      });
      out.sort(function (a, b) { return b.s - a.s || a.d.u.length - b.d.u.length; });
      return out;
    }
    function search(q) { return run(q, false); }

    /* ---- typo tolerance ----
       Only ever a fallback: the strict pass runs first and, when it finds
       something, nothing here is built or consulted. The vocabulary is derived
       in the browser on the first miss rather than shipped, so the index stays
       the size it is. */
    function buildVocab() {
      if (vocab) return vocab;
      vocab = {};
      docs.forEach(function (d) {
        var w = (d.lt + " " + d.lh + " " + d.ld + " " + d.lb).split(/[^a-z0-9+]+/);
        for (var i = 0; i < w.length; i++) {
          if (w[i].length > 2 && !/^\d+$/.test(w[i])) vocab[w[i]] = (vocab[w[i]] || 0) + 1;
        }
      });
      return vocab;
    }
    /* Damerau-Levenshtein, abandoned as soon as every path exceeds max. */
    function dist(a, b, max) {
      var la = a.length, lb = b.length, i, j;
      if (Math.abs(la - lb) > max) return max + 1;
      var prev2 = null, prev = [], cur;
      for (j = 0; j <= lb; j++) prev[j] = j;
      for (i = 1; i <= la; i++) {
        cur = [i];
        var rowMin = i;
        for (j = 1; j <= lb; j++) {
          var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
          var v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
          if (i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) &&
              a.charAt(i - 2) === b.charAt(j - 1)) v = Math.min(v, prev2[j - 2] + 1);
          cur[j] = v;
          if (v < rowMin) rowMin = v;
        }
        if (rowMin > max) return max + 1;
        prev2 = prev;
        prev = cur;
      }
      return prev[lb];
    }
    /* A replacement for one word, or null. A word the corpus knows, including
       as the start of a longer word, is never "corrected": "surro" is a person
       halfway through "surrogate", not a mistake. */
    function fix(tok) {
      if (tok.length < 4) return null;
      var v = buildVocab(), max = tok.length >= 8 ? 2 : 1;
      var best = null, bestD = max + 1, bestN = 0;
      for (var w in v) {
        if (w.length >= tok.length && w.indexOf(tok) === 0) return null;
        var d = dist(tok, w, max);
        if (d > max) continue;
        if (d < bestD || (d === bestD && v[w] > bestN)) { best = w; bestD = d; bestN = v[w]; }
      }
      return best;
    }
    /* The query with every unknown word replaced, or null if nothing changed.
       Correction treats all words as finished: a query that returned nothing is
       one the visitor has evidently finished typing badly. */
    function correct(q) {
      if (!docs) return null;
      var raw = fold(q).split(/[^a-z0-9+]+/).filter(Boolean);
      var changed = false;
      var out = raw.map(function (tok) {
        var f = fix(tok);
        if (f) changed = true;
        return f || tok;
      });
      return changed ? out.join(" ") + " " : null;
    }

    /* ---- the cascade ----
       Strict, then spelling, then any-term, then nothing. Every caller (the
       overlay and the /search/ page) goes through this, so both surfaces answer
       a query the same way. */
    function resolve(q) {
      var found = search(q);
      if (found.length) return { list: found, mode: "exact", q: q };
      var fixed = correct(q);
      if (fixed) {
        found = search(fixed);
        if (found.length) return { list: found, mode: "typo", q: fixed, was: fold(q).trim() };
      }
      found = run(q, true);
      if (found.length) return { list: found, mode: "loose", q: q };
      return { list: [], mode: "none", q: q };
    }

    /* ---- snippet: the first window of body text carrying a term ----
       Cut to sentence boundaries where one is close by, so a snippet reads as
       prose instead of starting mid-clause ("Method What is Bayesian
       optimization?"). Falls back to the old word-boundary trim otherwise. */
    function firstHit(d, ts) {
      var at = -1;
      for (var i = 0; i < ts.length && at < 0; i++) {
        var re = ts[i].re;
        re.lastIndex = 0;
        var m = re.exec(d.lb);
        if (!m && ts[i].alt) { ts[i].alt.lastIndex = 0; m = ts[i].alt.exec(d.lb); }
        if (m) at = m.index;
      }
      return at;
    }
    function snippet(d, ts) {
      var at = ts ? firstHit(d, ts) : -1;
      if (at < 0) return d.d || d.b.slice(0, SNIP);
      var start = Math.max(0, at - 45);
      if (start > 0) {
        // prefer the start of the sentence the match sits in, when it is near
        var dot = d.b.lastIndexOf(". ", at);
        if (dot >= 0 && at - dot < 110) start = dot + 2;
        else { var sp = d.b.indexOf(" ", start); if (sp > 0 && sp < start + 18) start = sp + 1; }
      }
      var text = d.b.slice(start, start + SNIP);
      var end = text.lastIndexOf(". ");
      if (end < 0 && /\.$/.test(text)) end = text.length - 1;
      var full = end > SNIP * 0.55;      // only if it does not throw the match away
      if (full) text = text.slice(0, end + 1);
      text = text.trim();
      return (start > 0 ? "…" : "") + text +
        (!full && start + SNIP < d.b.length ? "…" : "");
    }
    /* Built as nodes, never innerHTML: the query is user input. */
    function mark(text, ts) {
      var frag = document.createDocumentFragment();
      if (!ts.length) { frag.appendChild(document.createTextNode(text)); return frag; }
      // dictionary hits are highlighted too: seeing "metamodel" marked is what
      // explains why a page came back for "surrogate"
      var pats = [];
      ts.forEach(function (t) { pats = pats.concat(t.hi); });
      var re = new RegExp("(" + pats.join("|") + ")", "gi");
      var last = 0, m;
      var hay = foldKeep(text);
      if (hay.length !== text.length) {   // offsets no longer line up: skip the highlight
        frag.appendChild(document.createTextNode(text));
        return frag;
      }
      while ((m = re.exec(hay))) {
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        var el = document.createElement("mark");
        el.textContent = text.slice(m.index, m.index + m[0].length);
        frag.appendChild(el);
        last = m.index + m[0].length;
        if (m[0].length === 0) re.lastIndex++;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      return frag;
    }

    /* ---- rendering ---- */
    /* Land on the section that answers the query rather than the top of the
       page, but only when a heading carries every term literally: a partial
       match would drop the reader into a section that is not what they asked
       for, which is worse than the top of the page. Silently does nothing on a
       page whose headings have no ids. */
    function anchorFor(d, ts) {
      if (!ts || ts.length === 0 || !d.anchors.length) return "";
      for (var i = 0; i < d.anchors.length; i++) {
        var id = d.anchors[i][0];
        if (!id) continue;
        var head = fold(d.anchors[i][1]), all = true;
        for (var j = 0; j < ts.length && all; j++) {
          ts[j].re.lastIndex = 0;
          all = ts[j].re.test(head);
        }
        if (all) return "#" + id;
      }
      return "";
    }
    function row(d, ts, label) {
      var a = document.createElement("a");
      a.className = "pis-item";
      a.href = BASE + d.u + anchorFor(d, ts);
      a.id = "pis-r" + (uid++);
      a.setAttribute("role", "option");
      a.setAttribute("aria-selected", "false");
      var t = document.createElement("span");
      t.className = "pis-t";
      t.appendChild(ts ? mark(d.t, ts) : document.createTextNode(d.t));
      a.appendChild(t);
      var x = document.createElement("span");
      x.className = "pis-x";
      x.appendChild(ts ? mark(snippet(d, ts), ts) : document.createTextNode(d.d || ""));
      a.appendChild(x);
      var u = document.createElement("span");
      u.className = "pis-u";
      // the date is what separates several news items covering one event
      u.textContent = (label || d.s) + (d.k ? "  ·  " + d.k : "") + "  ·  /" + d.u;
      a.appendChild(u);
      a.addEventListener("mousemove", function () { setActive(rows.indexOf(a)); });
      return a;
    }
    function group(text) {
      var g = document.createElement("div");
      g.className = "pis-group";
      g.textContent = text;
      return g;
    }
    function empty(title, body) {
      var e = document.createElement("div");
      e.className = "pis-empty";
      var b = document.createElement("b");
      b.textContent = title;
      e.appendChild(b);
      e.appendChild(document.createTextNode(body));
      return e;
    }
    /* A dead end is a bad end. The suggestions are real queries that return
       real pages, so the empty state teaches what this search can answer. */
    function suggestion(text) {
      var s = document.createElement("button");
      s.type = "button";
      s.className = "pis-sugg";
      s.textContent = text;
      s.addEventListener("click", function () {
        input.value = text + " ";
        input.focus();
        render();
      });
      return s;
    }
    function render() {
      // the raw value matters: a trailing space is what marks the last word as
      // finished, so only the emptiness test and the display text get trimmed
      var raw = input.value;
      var q = raw.trim();
      list.innerHTML = "";
      rows = [];
      active = -1;
      moved = false;   // a new keystroke drops any arrow-key selection
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");

      if (failed) {
        list.appendChild(empty("Search is unavailable",
          "The page index could not be loaded. Use the menu above, or open the site over http rather than from a file."));
        countEl.textContent = "";
        return;
      }
      if (!docs) {
        list.appendChild(empty("Loading the index…", "One moment."));
        countEl.textContent = "";
        return;
      }
      if (!q) {
        list.appendChild(group("Go to"));
        FEATURED.forEach(function (u) {
          var d = byUrl(u);
          if (d) { var r = row(d, null); rows.push(r); list.appendChild(r); }
        });
        countEl.textContent = docs.length + " pages";
        setActive(0);
        return;
      }
      var res = resolve(raw);
      var found = res.list;
      if (!found.length) {
        var e = empty("No results for “" + q + "”", "Try one of these:");
        SUGGEST.forEach(function (s) { e.appendChild(suggestion(s)); });
        list.appendChild(e);
        countEl.textContent = "0 results";
        return;
      }
      if (res.mode === "typo") {
        list.appendChild(group("Showing results for “" + res.q.trim() + "”"));
      } else if (res.mode === "loose") {
        list.appendChild(group("No exact match, closest results"));
      } else {
        list.appendChild(group(found.length === 1 ? "1 result" : found.length + " results"));
      }
      found.slice(0, MAX).forEach(function (f) {
        var r = row(f.d, f.ts);
        rows.push(r);
        list.appendChild(r);
      });
      if (found.length > MAX) {
        var more = document.createElement("a");
        more.className = "pis-item pis-more";
        more.href = BASE + "search/?q=" + encodeURIComponent(res.q.trim());
        more.id = "pis-r" + (uid++);
        more.setAttribute("role", "option");
        more.setAttribute("aria-selected", "false");
        more.textContent = "See all " + found.length + " results";
        more.addEventListener("mousemove", function () { setActive(rows.indexOf(more)); });
        rows.push(more);
        list.appendChild(more);
      }
      countEl.textContent = found.length > MAX
        ? "showing " + MAX + " of " + found.length
        : found.length + (found.length === 1 ? " result" : " results");
      input.setAttribute("aria-expanded", "true");
      setActive(0);
    }
    function byUrl(u) {
      for (var i = 0; i < docs.length; i++) if (docs[i].u === u) return docs[i];
      return null;
    }
    function setActive(i) {
      if (!rows.length) return;
      active = Math.max(0, Math.min(rows.length - 1, i));
      rows.forEach(function (r, k) {
        var on = k === active;
        r.classList.toggle("pis-active", on);
        r.setAttribute("aria-selected", on ? "true" : "false");
      });
      var el = rows[active];
      input.setAttribute("aria-activedescendant", el.id);
      // keep the active row in view without scrollIntoView stealing the page
      if (el.offsetTop < list.scrollTop + 8) list.scrollTop = el.offsetTop - 8;
      else if (el.offsetTop + el.offsetHeight > list.scrollTop + list.clientHeight - 8)
        list.scrollTop = el.offsetTop + el.offsetHeight - list.clientHeight + 8;
    }

    /* ---- shell ---- */
    function build() {
      overlay = document.createElement("div");
      overlay.className = "pis-overlay" + (reduce ? "" : " pis-anim");
      overlay.hidden = true;
      overlay.innerHTML =
        '<div class="pis-panel" role="dialog" aria-modal="true" aria-label="Search this site">' +
        '<div class="pis-inputrow">' + ICON +
        '<input class="pis-input" type="search" autocomplete="off" autocorrect="off" ' +
        'spellcheck="false" role="combobox" aria-expanded="false" aria-controls="pis-list" ' +
        'aria-autocomplete="list" aria-label="Search this site" placeholder="Search pages, guides and news…">' +
        '<span class="pis-esc" aria-hidden="true">esc</span></div>' +
        '<div class="pis-list" id="pis-list" role="listbox" aria-label="Search results"></div>' +
        '<div class="pis-foot"><span>↑↓ navigate</span><span>↵ all results</span>' +
        '<span>esc close</span>' +
        '<span class="pis-count" role="status" aria-live="polite"></span></div></div>';
      document.body.appendChild(overlay);
      input = overlay.querySelector(".pis-input");
      list = overlay.querySelector(".pis-list");
      countEl = overlay.querySelector(".pis-count");

      input.addEventListener("input", render);
      overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) close(); });
      overlay.addEventListener("keydown", onKey);
    }
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); moved = true; setActive(active + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); moved = true; setActive(active - 1); }
      else if (e.key === "Home" && rows.length) { e.preventDefault(); moved = true; setActive(0); }
      else if (e.key === "End" && rows.length) { e.preventDefault(); moved = true; setActive(rows.length - 1); }
      else if (e.key === "Enter") {
        // Enter on a typed query goes to the results page, not the top hit: the
        // first row is highlighted by render(), not by the user, so opening it
        // would send people somewhere they never chose. Arrow keys are the way
        // to pick a row, and only then does Enter open it.
        e.preventDefault();
        if (moved && rows[active]) { rows[active].click(); return; }
        var q = input.value.trim();
        if (q) window.location.href = BASE + "search/?q=" + encodeURIComponent(q);
      } else if (e.key === "Tab") {
        e.preventDefault();   // nothing else in the dialog is focusable: hold focus
        input.focus();
      }
    }
    var lockPad = "";
    function open() {
      if (!overlay) build();
      if (!overlay.hidden) return;
      lastFocus = document.activeElement;
      // opened from the mobile menu: close it, or two scroll locks fight and
      // the first one released unlocks the page under the other
      if (panel && panel.classList.contains("open")) {
        panel.classList.remove("open");
        if (toggle) toggle.setAttribute("aria-expanded", "false");
      }
      overlay.hidden = false;
      input.value = "";
      var gap = window.innerWidth - document.documentElement.clientWidth;
      lockPad = document.body.style.paddingRight;
      if (gap > 0) {
        document.body.style.paddingRight = gap + "px";
        head.style.paddingRight = gap + "px";
      }
      document.body.style.overflow = "hidden";
      render();
      load().then(function () { if (overlay && !overlay.hidden) render(); });
      requestAnimationFrame(function () {
        overlay.classList.add("pis-in");
        input.focus();
      });
    }
    function close() {
      if (!overlay || overlay.hidden) return;
      overlay.classList.remove("pis-in");
      var done = function () {
        overlay.hidden = true;
        document.body.style.overflow = "";
        document.body.style.paddingRight = lockPad;
        head.style.paddingRight = "";
        // the mobile trigger is hidden by then (its menu was closed on open),
        // so fall back to the header button rather than focusing nothing
        var back = (lastFocus && lastFocus.offsetParent) ? lastFocus : navBtn;
        if (back && back.focus) back.focus();
      };
      reduce ? done() : setTimeout(done, 180);
    }

    /* ---- triggers ---- */
    function trigger(el) {
      el.addEventListener("click", function (e) { e.preventDefault(); open(); });
      el.addEventListener("pointerenter", load);   // warm the index on hover
      el.addEventListener("focus", load);
    }
    var nav = head.querySelector(".nav");
    if (nav) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "nav-search";
      btn.setAttribute("aria-label", "Search this site");
      // icon only: the nav has 41px of slack at full width and a visible
      // shortcut pill costs 62px, so the hint lives in the tooltip instead
      btn.title = "Search this site (" + (mac ? "⌘K" : "Ctrl K") + ")";
      btn.innerHTML = ICON;
      var before = nav.querySelector(".nav-cta-ghost") || nav.querySelector(".nav-cta");
      before ? nav.insertBefore(btn, before) : nav.appendChild(btn);
      trigger(btn);
      navBtn = btn;
    }
    var mnav = head.querySelector(".mobile-panel nav");
    if (mnav) {
      var mbtn = document.createElement("button");
      mbtn.type = "button";
      mbtn.className = "m-search";
      mbtn.innerHTML = ICON + "<span>Search this site</span>";
      mnav.insertBefore(mbtn, mnav.firstChild);
      trigger(mbtn);
    }
    document.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        overlay && !overlay.hidden ? close() : open();
        return;
      }
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      var t = e.target, tag = t && t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) return;
      e.preventDefault();
      open();
    });

    /* ---- shared with /search/ ----
       The results page runs the same engine rather than a second copy of it, so
       the overlay and the page can never disagree about what a query means.
       Deliberately narrow: load, resolve, and the two text helpers. */
    window.PISearch = {
      base: BASE,
      load: load,
      resolve: resolve,
      snippet: snippet,
      mark: mark,
      anchor: anchorFor,
      pages: function () { return docs ? docs.length : 0; },
      failed: function () { return failed; }
    };
  })();

  /* ---------- current year ---------- */
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });
})();
