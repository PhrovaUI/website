/* PhrovaUI — cinematic scroll choreography.
   Cheap by design: one rAF-throttled scroll handler, layout measured only on
   resize, and only transform / opacity / short-lived blur are ever animated.
   Everything "plays once": the intro, the typing and the reveals run a single
   time per page load and never repeat until the page is reloaded. */
(function () {
  "use strict";

  var doc = document, root = doc.documentElement, win = window, nav = navigator;

  var reduceMotion = win.matchMedia && win.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Low-power heuristics: few CPU cores, little RAM, or Data Saver turned on.
  var lite =
    reduceMotion ||
    (nav.connection && nav.connection.saveData) ||
    (nav.deviceMemory && nav.deviceMemory <= 2) ||
    (nav.hardwareConcurrency && nav.hardwareConcurrency <= 4);

  if (lite) root.classList.add("lite");

  var $ = function (id) { return doc.getElementById(id); };
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  var header = $("top-header");
  var progress = $("progress");
  var hero = $("hero");
  var heroBg = $("hero-bg");
  var heroInner = $("hero-inner");
  var intro = $("intro");

  /* =====================================================================
     Typewriter — keeps layout stable by leaving the not-yet-typed remainder
     in the DOM as invisible text, so nothing jumps while typing.
     ===================================================================== */
  function prep(el) {
    var parts = [], total = 0;
    var walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    nodes.forEach(function (node) {
      var full = node.nodeValue;
      if (!full.trim()) return;
      var vis = doc.createElement("span"), hid = doc.createElement("span");
      vis.className = "t-vis";
      hid.className = "t-hid";
      hid.textContent = full;
      node.parentNode.replaceChild(vis, node);
      vis.parentNode.insertBefore(hid, vis.nextSibling);
      parts.push({ vis: vis, hid: hid, full: full });
      total += full.length;
    });
    el._ty = { parts: parts, total: total, done: false, started: false };
  }

  function typeEl(el, fast) {
    var s = el && el._ty;
    if (!s || s.started) return Promise.resolve();
    s.started = true;

    return new Promise(function (resolve) {
      var dur = fast ? 0 : clamp(s.total * 26, 500, 1800);
      var t0 = null, shown = 0, idx = 0;
      el.classList.add("typing");

      function paint(n) {
        // fill completed parts, then the boundary part
        var left = n;
        for (var i = 0; i < s.parts.length; i++) {
          var p = s.parts[i], k = Math.min(left, p.full.length);
          if (i < idx) { left -= p.full.length; continue; }
          p.vis.textContent = p.full.slice(0, k);
          p.hid.textContent = p.full.slice(k);
          if (k < p.full.length) { idx = i; markCaret(p.vis); return; }
          left -= p.full.length;
          idx = i + 1;
        }
      }

      var caretOn = null;
      function markCaret(node) {
        if (caretOn === node) return;
        if (caretOn) caretOn.classList.remove("caret");
        node.classList.add("caret");
        caretOn = node;
      }

      function finish() {
        paint(s.total);
        if (caretOn) caretOn.classList.remove("caret");
        el.classList.remove("typing");
        s.done = true;
        resolve();
      }

      if (dur === 0) return finish();

      (function tick(now) {
        if (t0 === null) t0 = now;
        var n = Math.floor(clamp((now - t0) / dur, 0, 1) * s.total);
        if (n !== shown) { shown = n; paint(n); }
        if (now - t0 >= dur) finish();
        else win.requestAnimationFrame(tick);
      })(performance.now());
    });
  }

  if (!reduceMotion) {
    doc.querySelectorAll("[data-type]").forEach(prep);
  }

  /* =====================================================================
     Smooth (inertial) wheel scrolling — mouse/trackpad devices only.
     Touch devices keep their own native momentum scrolling.
     ===================================================================== */
  var locked = false;
  var smoothScrollTo = null;

  (function initSmooth() {
    var fine = win.matchMedia && win.matchMedia("(pointer: fine)").matches;
    if (lite || !fine) return;

    root.classList.add("smooth-js");

    var target = win.pageYOffset, cur = target, running = false, last = 0;

    function limit() { return Math.max(0, root.scrollHeight - win.innerHeight); }

    function tick(now) {
      var dt = Math.min(64, now - last || 16);
      last = now;
      cur += (target - cur) * (1 - Math.exp(-dt / 120));
      if (Math.abs(target - cur) < 0.4) { cur = target; running = false; }
      win.scrollTo({ top: cur, behavior: "instant" });
      if (running) win.requestAnimationFrame(tick);
    }

    function run() {
      if (running) return;
      running = true;
      last = performance.now();
      win.requestAnimationFrame(tick);
    }

    win.addEventListener("wheel", function (e) {
      if (e.ctrlKey || e.defaultPrevented) return;       // pinch-zoom / handled elsewhere
      e.preventDefault();
      if (locked) return;
      var d = e.deltaY * (e.deltaMode === 1 ? 34 : e.deltaMode === 2 ? win.innerHeight : 1);
      if (!running) { target = cur = win.pageYOffset; }
      target = clamp(target + d, 0, limit());
      run();
    }, { passive: false });

    // keyboard, scrollbar drag, find-in-page … keep our state in sync
    win.addEventListener("scroll", function () {
      if (!running) { target = cur = win.pageYOffset; }
    }, { passive: true });

    smoothScrollTo = function (y) {
      if (!running) { target = cur = win.pageYOffset; }
      target = clamp(y, 0, limit());
      run();
    };
  })();

  // in-page links: glide to the section (works with and without inertial scroll)
  doc.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener("click", function (e) {
      var id = a.getAttribute("href").slice(1);
      var el = id && id !== "top" ? $(id) : null;
      if (id && id !== "top" && !el) return;
      if (!smoothScrollTo) return;                          // native smooth scrolling handles it
      e.preventDefault();
      var y = el ? el.getBoundingClientRect().top + win.pageYOffset - header.offsetHeight : 0;
      smoothScrollTo(y);
    });
  });

  /* ---------- mobile menu ---------- */
  var toggle = doc.querySelector(".menu-toggle");
  if (toggle) {
    var setMenu = function (open) {
      header.classList.toggle("menu-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    };
    toggle.addEventListener("click", function () {
      setMenu(!header.classList.contains("menu-open"));
    });
    doc.querySelectorAll(".main-nav a").forEach(function (a) {
      a.addEventListener("click", function () { setMenu(false); });
    });
    doc.addEventListener("keydown", function (e) {
      if (e.key === "Escape") setMenu(false);
    });
  }

  /* =====================================================================
     Reveal on scroll — once only. Typed elements start typing as they appear.
     ===================================================================== */
  function onReveal(el) {
    el.classList.add("in");
    if (el._ty) {
      var d = parseFloat(el.style.getPropertyValue("--d")) || 0;
      setTimeout(function () { typeEl(el); }, d * 1000 + 120);
    }
  }

  var reveals = doc.querySelectorAll(".reveal, .watch");
  if ("IntersectionObserver" in win) {
    var revealIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          onReveal(en.target);
          revealIO.unobserve(en.target);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    reveals.forEach(function (el) { revealIO.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("in"); typeEl(el, true); });
  }

  /* ---------- pause off-screen animation ---------- */
  var heroVisible = true;

  if ("IntersectionObserver" in win) {
    var visIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var t = en.target, on = en.isIntersecting;
        if (t === hero) heroVisible = on;
        if (t.classList.contains("petals") || t.classList.contains("marquee")) {
          t.classList.toggle("paused", !on);
        }
        if (on && t === hero) schedule();
      });
    }, { rootMargin: "80px 0px" });

    visIO.observe(hero);
    doc.querySelectorAll(".petals, .marquee").forEach(function (el) { visIO.observe(el); });
  }

  /* ---------- measurements (only on resize / load) ---------- */
  var vh = win.innerHeight, maxScroll = 1;

  function measure() {
    vh = win.innerHeight;
    maxScroll = Math.max(1, root.scrollHeight - vh);
    schedule();
  }

  /* ---------- the one scroll handler ---------- */
  var ticking = false;

  function schedule() {
    if (!ticking) {
      ticking = true;
      win.requestAnimationFrame(update);
    }
  }

  function update() {
    ticking = false;
    var y = win.pageYOffset || root.scrollTop;

    progress.style.transform = "scaleX(" + clamp(y / maxScroll, 0, 1).toFixed(4) + ")";

    // hero parallax + gentle fade-out (skipped in low-power mode)
    if (heroVisible && !lite) {
      var f = clamp(y / (vh * 0.9), 0, 1);
      heroBg.style.transform =
        "translate3d(0," + (y * 0.22).toFixed(1) + "px,0) scale(" + (1.06 + f * 0.06).toFixed(4) + ")";
      heroInner.style.transform = "translate3d(0," + (y * 0.12).toFixed(1) + "px,0)";
      heroInner.style.opacity = (1 - f * 1.15).toFixed(3);
    }
  }

  win.addEventListener("scroll", schedule, { passive: true });

  var resizeTimer;
  win.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(measure, 150);
  });

  win.addEventListener("load", measure);
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(measure);

  /* =====================================================================
     Opening sequence — plays on every load / reload, never again after.
     ===================================================================== */
  function heroSequence() {
    var seq = ["eyebrow", "hero-title", "tagline", "hero-description"].map(function (k) {
      return k === "hero-title" ? $(k) : doc.querySelector("." + k);
    });
    (function next(i) {
      if (i >= seq.length) return;
      typeEl(seq[i], reduceMotion).then(function () { setTimeout(function () { next(i + 1); }, 50); });
    })(0);
  }

  var introDone = false;

  function finishIntro() {
    if (introDone) return;
    introDone = true;

    intro.classList.add("open");                     // curtains part
    setTimeout(function () {
      root.classList.add("ready");                   // hero pops in beneath them
      heroSequence();
    }, 260);

    setTimeout(function () {
      intro.classList.add("gone");
      root.classList.remove("intro-lock");
      locked = false;
      win.scrollTo(0, 0);
      measure();
    }, 1000);
  }

  /* Real loading: the bar tracks the page's own fonts and images. The
     below-the-fold images (normally lazy) are fetched and decoded up front,
     so nothing pops in late or shifts the layout while scrolling. */
  function runIntro() {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    win.scrollTo(0, 0);

    if (!intro || reduceMotion) {
      if (intro) intro.classList.add("gone");
      root.classList.add("ready");
      heroSequence();
      return;
    }

    locked = true;
    root.classList.add("intro-lock");

    var fill = $("intro-fill"), pct = $("intro-pct");

    var tasks = [];
    function track(p) {
      var t = { done: false };
      tasks.push(t);
      Promise.resolve(p).catch(function () {}).then(function () { t.done = true; });
    }

    // fonts
    if (doc.fonts && doc.fonts.ready) track(doc.fonts.ready);

    // every image on the page (lazy ones are switched to eager and decoded now)
    Array.prototype.forEach.call(doc.images, function (img) {
      if (img.closest(".intro")) return;
      img.loading = "eager";
      track(
        img.complete && img.naturalWidth
          ? (img.decode ? img.decode() : null)
          : new Promise(function (res) {
              img.addEventListener("load", res, { once: true });
              img.addEventListener("error", res, { once: true });
            }).then(function () { return img.decode ? img.decode() : null; })
      );
    });

    // the page itself (styles, scripts)
    track(new Promise(function (res) {
      if (doc.readyState === "complete") res();
      else win.addEventListener("load", res, { once: true });
    }));

    var shown = 0, lastPct = -1, last = performance.now();

    (function tick(now) {
      if (introDone) return;
      var done = tasks.filter(function (t) { return t.done; }).length;
      var actual = done / tasks.length;

      // ease the displayed value toward the real one
      shown += (actual - shown) * (1 - Math.exp(-(now - last) / 90));
      last = now;
      if (actual === 1 && shown > 0.995) shown = 1;

      fill.style.transform = "scaleX(" + shown.toFixed(4) + ")";
      var n = Math.round(shown * 100);
      if (n !== lastPct) { lastPct = n; pct.textContent = n + "%"; }

      if (shown >= 1) { setTimeout(finishIntro, 180); return; }
      win.requestAnimationFrame(tick);
    })(last);

    // failsafe: never trap the visitor behind the loader
    setTimeout(finishIntro, 9000);
  }

  measure();
  runIntro();
})();
