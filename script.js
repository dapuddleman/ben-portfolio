/* =============================================================
   Benjamin Lock — Portfolio
   Horizontal scroll engine + interactions
   ============================================================= */
(function () {
  "use strict";

  gsap.registerPlugin(ScrollTrigger);

  const track = document.getElementById("track");
  const container = document.getElementById("scroll-container");
  const body = document.body;

  /* -----------------------------------------------------------
     1. Lenis smooth scroll (momentum on the vertical driver)
     ----------------------------------------------------------- */
  let lenis = null;
  if (window.Lenis) {
    lenis = new Lenis({
      duration: 1.1,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 1.4,
    });
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
    window.lenis = lenis;
  }

  /* -----------------------------------------------------------
     2. Progress UI refs + updater
     (declared BEFORE the ScrollTrigger so its onUpdate can safely
      reference them — ScrollTrigger fires onUpdate during setup)
     ----------------------------------------------------------- */
  const progressBar = document.querySelector(".progress__bar");
  const pages = Array.from(document.querySelectorAll(".pagination span"));
  const scrollHint = document.querySelector(".scroll-hint");
  const menuLinks = Array.from(document.querySelectorAll(".menu a"));
  const sections = menuLinks
    .map((a) => document.querySelector(a.getAttribute("href")))
    .filter(Boolean);

  function updateProgress(p) {
    if (progressBar) progressBar.style.width = (p * 100).toFixed(2) + "%";
    if (scrollHint) scrollHint.style.opacity = p > 0.02 ? "0" : "1";

    // pagination: 4 evenly-spaced markers
    if (pages.length) {
      const idx = Math.min(pages.length - 1, Math.floor(p * pages.length));
      pages.forEach((s, i) => s.classList.toggle("is-active", i === idx));
    }

    // active menu item based on which section sits under the sidebar
    if (sections.length) {
      const viewportMid = window.innerWidth * 0.5;
      let activeIdx = 0;
      sections.forEach((sec, i) => {
        const rect = sec.getBoundingClientRect();
        if (rect.left <= viewportMid) activeIdx = i;
      });
      menuLinks.forEach((a, i) =>
        a.classList.toggle("is-active", i === activeIdx)
      );
    }
  }

  /* -----------------------------------------------------------
     3. Vertical wheel -> horizontal translate (GSAP ScrollTrigger)
     ----------------------------------------------------------- */
  const getScrollAmount = () => track.scrollWidth - window.innerWidth;

  const horizontalTween = gsap.to(track, {
    x: () => -getScrollAmount(),
    ease: "none",
  });

  const st = ScrollTrigger.create({
    trigger: container,
    start: "top top",
    end: () => "+=" + getScrollAmount(),
    pin: true,
    scrub: 1,                 // momentum-ish smoothing
    invalidateOnRefresh: true,
    animation: horizontalTween,
    onUpdate: (self) => updateProgress(self.progress),
  });

  /* -----------------------------------------------------------
     4. Anchor menu -> scroll to a section's horizontal position
     ----------------------------------------------------------- */
  function scrollToSection(targetEl) {
    // distance the track must travel so targetEl reaches the left edge
    const targetX = targetEl.offsetLeft;
    const amount = getScrollAmount();
    if (amount <= 0) return;
    const progress = Math.min(1, Math.max(0, targetX / amount));
    const dest = st.start + (st.end - st.start) * progress;
    if (lenis) lenis.scrollTo(dest, { duration: 1.2 });
    else window.scrollTo({ top: dest, behavior: "smooth" });
  }

  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (e) => {
      const id = link.getAttribute("href");
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      scrollToSection(target);
    });
  });

  /* -----------------------------------------------------------
     4b. Keyboard navigation — Arrow / Page keys jump sections
     ----------------------------------------------------------- */
  document.addEventListener("keydown", (e) => {
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;
    if (window.__emuActive) {
      // GBA emulator owns the keys: don't navigate sections, and also swallow
      // the browser's native key-scroll so arrows can't drag the page around.
      // preventDefault doesn't stop the emulator's own listeners from firing.
      const scrollKeys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
                          "PageUp", "PageDown", "Home", "End", " "];
      if (scrollKeys.includes(e.key)) e.preventDefault();
      return;
    }
    const ids = ["intro", "starfall", "vermilion", "stargone", "about"];
    const els = ids.map((id) => document.getElementById(id)).filter(Boolean);
    const amount = getScrollAmount();
    const cur = -gsap.getProperty(track, "x");
    let idx = 0;
    els.forEach((el, i) => { if (el.offsetLeft <= cur + 5) idx = i; });

    if (e.key === "ArrowRight" || e.key === "PageDown") {
      e.preventDefault();
      scrollToSection(els[Math.min(els.length - 1, idx + 1)]);
    } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
      e.preventDefault();
      scrollToSection(els[Math.max(0, idx - 1)]);
    } else if (e.key === "Home") {
      e.preventDefault(); scrollToSection(els[0]);
    } else if (e.key === "End") {
      e.preventDefault(); scrollToSection(els[els.length - 1]);
    }
  });

  /* -----------------------------------------------------------
     4c. Magnetic snap — when the scroll comes to rest near a panel
         edge, glide to that panel's start. Scrolling *within* a wide
         panel stays free, so you choose when to advance.
     ----------------------------------------------------------- */
  (function setupSnap() {
    if (!lenis) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const SNAP_IDS = ["intro", "starfall", "vermilion", "stargone", "about"];
    const THRESHOLD_FRAC = 0.045; // proximity (fraction of total scroll) to grab
    const SETTLE_MS = 150;        // quiet time after the last scroll event

    // Snap targets in raw scroll px: each panel's start, plus the very end.
    // Working in px against lenis.scroll avoids the scrub-lag you'd get from
    // st.progress (which trails the real scroll by ~1s and snaps to stale spots).
    function snapTargets() {
      const max = lenis.limit;
      if (max <= 0) return [];
      const pts = SNAP_IDS.map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((el) => Math.min(max, el.offsetLeft));
      pts.push(max); // keep the resume's tail reachable
      return pts;
    }

    let settleTimer;
    let snapping = false;

    function maybeSnap() {
      if (snapping) return;
      const max = lenis.limit;
      const cur = lenis.scroll;            // real, un-lagged scroll position
      if (max <= 0 || cur <= 2 || cur >= max - 2) return;
      let nearest = cur, best = Infinity;
      snapTargets().forEach((px) => {
        const d = Math.abs(px - cur);
        if (d < best) { best = d; nearest = px; }
      });
      if (best > 4 && best <= THRESHOLD_FRAC * max) {
        snapping = true;
        lenis.scrollTo(nearest, {
          duration: 0.7,
          force: true,
          easing: (t) => 1 - Math.pow(1 - t, 3),
          onComplete: () => { snapping = false; },
        });
        setTimeout(() => { snapping = false; }, 1100); // safety unlock
      }
    }

    lenis.on("scroll", () => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(maybeSnap, SETTLE_MS);
    });
  })();

  /* -----------------------------------------------------------
     4d. GBA emulator key handoff — clicking inside the emulator box
         gives it the keyboard (arrow keys = d-pad); clicking anywhere
         else returns the keys to section navigation.
     ----------------------------------------------------------- */
  const emuBox = document.getElementById("gba-emu");
  if (emuBox) {
    document.addEventListener(
      "pointerdown",
      (e) => { window.__emuActive = emuBox.contains(e.target); },
      true // capture, so the emulator's own UI can't swallow it first
    );
  }

  /* -----------------------------------------------------------
     5. Drag-to-pan inside .pannable hero images
     ----------------------------------------------------------- */
  document.querySelectorAll(".pannable").forEach((pan) => {
    const inner = pan.querySelector(".pannable__inner");
    const hint = pan.querySelector(".drag-hint");
    let dragging = false;
    let startX = 0;
    let currentX = 0;
    let baseX = 0;

    function maxOffset() {
      return Math.max(0, inner.scrollWidth - pan.clientWidth);
    }
    function apply(x) {
      const clamped = Math.min(0, Math.max(-maxOffset(), x));
      currentX = clamped;
      inner.style.transform = "translateX(" + clamped + "px)";
    }

    pan.addEventListener("pointerdown", (e) => {
      dragging = true;
      startX = e.clientX;
      baseX = currentX;
      pan.classList.add("is-dragging");
      if (hint) hint.style.opacity = "0";
      pan.setPointerCapture(e.pointerId);
    });
    pan.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      e.preventDefault();
      apply(baseX + (e.clientX - startX));
    });
    const stop = (e) => {
      if (!dragging) return;
      dragging = false;
      pan.classList.remove("is-dragging");
      if (pan.hasPointerCapture && e && pan.hasPointerCapture(e.pointerId)) {
        pan.releasePointerCapture(e.pointerId);
      }
    };
    pan.addEventListener("pointerup", stop);
    pan.addEventListener("pointercancel", stop);
    pan.addEventListener("pointerleave", stop);
  });

  /* -----------------------------------------------------------
     5b. YouTube lite-embeds — poster image swaps to an autoplaying
         iframe on click, so no YouTube chrome loads until asked for.
     ----------------------------------------------------------- */
  document.querySelectorAll(".video-poster[data-yt]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const iframe = document.createElement("iframe");
      iframe.src =
        "https://www.youtube-nocookie.com/embed/" +
        btn.dataset.yt +
        "?autoplay=1&rel=0";
      iframe.title = btn.getAttribute("aria-label") || "Gameplay video";
      iframe.allow =
        "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
      iframe.allowFullscreen = true;
      btn.replaceWith(iframe);
    });
  });

  /* -----------------------------------------------------------
     5c. Ambient video loops — some browsers park muted autoplay
         (data saver / low power); kick them once, and respect
         prefers-reduced-motion by leaving them on their poster frame.
     ----------------------------------------------------------- */
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const kick = () =>
      document.querySelectorAll("video[autoplay]").forEach((v) => {
        if (v.paused) v.play().catch(() => {});
      });
    window.addEventListener("load", kick);
    kick();
  }

  /* -----------------------------------------------------------
     6. Intro fade-out as the user begins scrolling
     ----------------------------------------------------------- */
  const introEl = document.querySelector(".intro");
  if (introEl) {
    gsap.to(introEl, {
      opacity: 0,
      y: -30,
      ease: "none",
      scrollTrigger: {
        trigger: container,
        start: "top top",
        end: () => "+=" + window.innerWidth * 0.6,
        scrub: true,
        invalidateOnRefresh: true,
      },
    });
  }

  /* -----------------------------------------------------------
     7. Asset reveal — subtle fade/slide as panels enter
     ----------------------------------------------------------- */
  gsap.utils.toArray(".asset, .float-credit, .body-text").forEach((el) => {
    gsap.from(el, {
      opacity: 0,
      y: 24,
      duration: 0.9,
      ease: "power2.out",
      scrollTrigger: {
        trigger: el,
        containerAnimation: horizontalTween,
        start: "left 88%",
        toggleActions: "play none none reverse",
      },
    });
  });

  /* -----------------------------------------------------------
     7b. Themed title effects — per-letter Cyrillic / glitch motion
     ----------------------------------------------------------- */
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  // Latin -> Cyrillic look-alikes (keeps the word readable, reads "Russian")
  const CYR = {
    S: "Ѕ", s: "ѕ", T: "Т", t: "т", A: "А", a: "а", R: "Я", r: "я",
    I: "І", i: "і", G: "Г", g: "г", O: "О", o: "о", N: "И", n: "и",
    E: "Е", e: "е",
  };
  const GLITCH = "▓▒░█▚▞▙▜#%&@/\\<>=*".split("");

  // Wrap each visible character in a <span.fx-glyph>, preserving spaces and <br>
  function splitToGlyphs(el) {
    const nodes = Array.from(el.childNodes);
    el.textContent = "";
    const glyphs = [];
    nodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        for (const ch of node.textContent) {
          if (ch === " ") {
            el.appendChild(document.createTextNode(" "));
          } else {
            const s = document.createElement("span");
            s.className = "fx-glyph";
            s.textContent = ch;
            s.dataset.base = ch;
            el.appendChild(s);
            glyphs.push(s);
          }
        }
      } else if (node.nodeName === "BR") {
        el.appendChild(document.createElement("br"));
      } else {
        el.appendChild(node);
      }
    });
    return glyphs;
  }

  function runCyrillic(glyphs) {
    const swappable = glyphs.filter((g) => CYR[g.dataset.base]);
    if (!swappable.length) return;
    (function tick() {
      const n = 1 + Math.floor(Math.random() * 3);
      for (let k = 0; k < n; k++) {
        const g = swappable[Math.floor(Math.random() * swappable.length)];
        const toAlt = g.textContent === g.dataset.base;
        g.textContent = toAlt ? CYR[g.dataset.base] : g.dataset.base;
        g.classList.toggle("is-alt", toAlt);
      }
      setTimeout(tick, 180 + Math.random() * 560);
    })();
  }

  function runGlitch(glyphs) {
    if (!glyphs.length) return;
    (function burst() {
      const n = 1 + Math.floor(Math.random() * 2);
      for (let k = 0; k < n; k++) {
        const g = glyphs[Math.floor(Math.random() * glyphs.length)];
        let frames = 2 + Math.floor(Math.random() * 3);
        g.classList.add("is-glitch");
        const iv = setInterval(() => {
          g.textContent = GLITCH[Math.floor(Math.random() * GLITCH.length)];
          if (--frames <= 0) {
            clearInterval(iv);
            g.textContent = g.dataset.base;
            g.classList.remove("is-glitch");
          }
        }, 70);
      }
      setTimeout(burst, 700 + Math.random() * 1700);
    })();
  }

  document.querySelectorAll("[data-fx]").forEach((el) => {
    const glyphs = splitToGlyphs(el);
    if (reduceMotion) return; // letters stay as plain English
    if (el.dataset.fx === "cyrillic") runCyrillic(glyphs);
    else if (el.dataset.fx === "glitch") runGlitch(glyphs);
  });

  /* -----------------------------------------------------------
     8. Housekeeping
     ----------------------------------------------------------- */
  // ScrollTrigger's pin spacer is what gives the page its scroll height.
  // Lenis must re-measure AFTER each refresh or its limit stays 0 and the
  // whole page is frozen (can't scroll) until the next resize event.
  function syncScroll() {
    ScrollTrigger.refresh();
    if (lenis) lenis.resize();
  }

  window.addEventListener("load", syncScroll);

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(syncScroll, 200);
  });

  // initial sync once layout is in
  syncScroll();
})();
