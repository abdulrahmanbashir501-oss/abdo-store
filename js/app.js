/* ABDO X — store front-end */
(function () {
  "use strict";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- loader ---------- */
  function hideLoader() {
    var l = document.getElementById("loader");
    if (l) l.classList.add("done");
  }
  window.addEventListener("load", function () {
    setTimeout(hideLoader, reduced ? 0 : 350);
  });
  setTimeout(hideLoader, 3200); // safety

  /* ---------- navbar state ---------- */
  var nav = document.getElementById("nav");
  function onScroll() {
    if (nav) nav.classList.toggle("scrolled", window.scrollY > 24);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- drawer ---------- */
  var drawer = document.getElementById("drawer");
  var overlay = document.getElementById("drawerOverlay");
  function setDrawer(open) {
    if (!drawer || !overlay) return;
    drawer.classList.toggle("open", open);
    overlay.classList.toggle("show", open);
    document.body.style.overflow = open ? "hidden" : "";
  }
  var menuBtn = document.getElementById("menuBtn");
  var drawerClose = document.getElementById("drawerClose");
  if (menuBtn) menuBtn.addEventListener("click", function () { setDrawer(true); });
  if (drawerClose) drawerClose.addEventListener("click", function () { setDrawer(false); });
  if (overlay) overlay.addEventListener("click", function () { setDrawer(false); });
  if (drawer) {
    drawer.querySelectorAll("a.drawer-link").forEach(function (a) {
      a.addEventListener("click", function () { setDrawer(false); });
    });
  }

  /* ---------- search + filters + sort ---------- */
  var state = { q: "", kind: "all", platform: "all", sort: "new" };

  var searchInputs = Array.prototype.slice.call(document.querySelectorAll("[data-search-input]"));
  function setQuery(v, source) {
    state.q = v.trim().toLowerCase();
    searchInputs.forEach(function (i) { if (i !== source) i.value = v; });
    apply();
  }
  searchInputs.forEach(function (input) {
    input.addEventListener("input", function () { setQuery(input.value, input); });
  });

  /* navbar search popover */
  var navSearch = document.getElementById("navSearch");
  var searchBtn = document.getElementById("searchBtn");
  var navSearchInput = document.getElementById("navSearchInput");
  function toggleSearch(open) {
    if (!navSearch) return;
    var willOpen = typeof open === "boolean" ? open : !navSearch.classList.contains("open");
    navSearch.classList.toggle("open", willOpen);
    if (willOpen && navSearchInput) {
      navSearchInput.focus();
      var target = document.getElementById("store");
      if (target) target.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
    }
  }
  if (searchBtn) searchBtn.addEventListener("click", function () { toggleSearch(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      toggleSearch(false);
      setDrawer(false);
      closeModal();
    }
  });

  /* chips */
  document.querySelectorAll("[data-chip-kind]").forEach(function (chip) {
    chip.addEventListener("click", function () {
      state.kind = chip.getAttribute("data-chip-kind");
      document.querySelectorAll("[data-chip-kind]").forEach(function (c) {
        c.classList.toggle("on", c === chip);
      });
      apply();
    });
  });
  document.querySelectorAll("[data-chip-platform]").forEach(function (chip) {
    chip.addEventListener("click", function () {
      state.platform = chip.getAttribute("data-chip-platform");
      document.querySelectorAll("[data-chip-platform]").forEach(function (c) {
        c.classList.toggle("on", c === chip);
      });
      apply();
    });
  });

  var sortSel = document.getElementById("sortSel");
  if (sortSel) {
    sortSel.addEventListener("change", function () {
      state.sort = sortSel.value;
      apply();
    });
  }

  var cards = Array.prototype.slice.call(document.querySelectorAll(".card[data-id]"));
  var sections = {
    game: document.getElementById("gamesGrid"),
    app: document.getElementById("appsGrid")
  };

  function apply() {
    var visible = { game: 0, app: 0 };

    /* sort each grid */
    Object.keys(sections).forEach(function (kind) {
      var grid = sections[kind];
      if (!grid) return;
      var list = cards.filter(function (c) { return c.getAttribute("data-kind") === kind; });
      list.sort(function (a, b) {
        var oa = parseInt(a.getAttribute("data-order"), 10) || 0;
        var ob = parseInt(b.getAttribute("data-order"), 10) || 0;
        return state.sort === "old" ? ob - oa : oa - ob;
      });
      list.forEach(function (c) { grid.appendChild(c); });
    });

    cards.forEach(function (card) {
      var kind = card.getAttribute("data-kind");
      var platforms = (card.getAttribute("data-platforms") || "").split(" ");
      var hay = (card.getAttribute("data-search") || "").toLowerCase();
      var ok = true;
      if (state.kind !== "all" && kind !== state.kind) ok = false;
      if (ok && state.platform !== "all" && platforms.indexOf(state.platform) === -1) ok = false;
      if (ok && state.q && hay.indexOf(state.q) === -1) ok = false;
      card.style.display = ok ? "" : "none";
      if (ok) visible[kind] = (visible[kind] || 0) + 1;
    });

    /* section visibility */
    var gamesSection = document.getElementById("games");
    var appsSection = document.getElementById("apps");
    if (gamesSection) gamesSection.style.display = (state.kind === "app" || visible.game === 0 && (state.q || state.platform !== "all")) && state.kind !== "game" ? "" : "";
    if (gamesSection) gamesSection.style.display = state.kind === "app" ? "none" : "";
    if (appsSection) appsSection.style.display = state.kind === "game" ? "none" : "";

    /* empty states */
    var ge = document.getElementById("gamesEmpty");
    var ae = document.getElementById("appsEmpty");
    if (ge) ge.classList.toggle("show", visible.game === 0 && state.kind !== "app");
    if (ae) ae.classList.toggle("show", visible.app === 0 && state.kind !== "game");

    /* count label */
    var rc = document.getElementById("resultCount");
    if (rc) {
      var n = visible.game + visible.app;
      rc.textContent = n + " / " + cards.length;
    }
  }
  apply();

  /* ---------- stats count-up ---------- */
  var gamesCount = cards.filter(function (c) { return c.getAttribute("data-kind") === "game"; }).length;
  var appsCount = cards.filter(function (c) { return c.getAttribute("data-kind") === "app"; }).length;
  var freeCount = cards.filter(function (c) { return card_free(c); }).length;
  function card_free(c) { return c.getAttribute("data-free") === "1"; }

  function countUp(el, target) {
    if (!el) return;
    if (reduced) { el.textContent = String(target); return; }
    var t0 = null;
    var dur = 900;
    function step(ts) {
      if (!t0) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      el.textContent = String(Math.round(target * (0.2 + 0.8 * p)));
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  var statsDone = false;
  function runStats() {
    if (statsDone) return;
    statsDone = true;
    countUp(document.getElementById("statGames"), gamesCount);
    countUp(document.getElementById("statApps"), appsCount);
    countUp(document.getElementById("statFree"), freeCount);
  }
  var statsEl = document.getElementById("stats");
  if (statsEl && "IntersectionObserver" in window) {
    var so = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { runStats(); so.disconnect(); } });
    }, { threshold: 0.3 });
    so.observe(statsEl);
  } else {
    runStats();
  }

  /* ---------- reveal on scroll ---------- */
  var revealEls = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !reduced) {
    var ro = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add("visible");
          ro.unobserve(e.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -30px 0px" });
    revealEls.forEach(function (el) { ro.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add("visible"); });
  }

  /* ---------- product modal ---------- */
  var modalOverlay = document.getElementById("modalOverlay");
  var modalBox = document.getElementById("modal");
  var modalContent = document.getElementById("modalContent");

  function openModal(card) {
    var tpl = card.querySelector("template");
    if (!tpl || !modalOverlay || !modalContent) return;
    modalContent.innerHTML = "";
    modalContent.appendChild(tpl.content.cloneNode(true));
    modalOverlay.classList.add("open");
    document.body.style.overflow = "hidden";
    var cover = modalContent.querySelector(".modal-cover");
    var cardCover = card.querySelector(".card-cover");
    if (cover && cardCover) {
      cover.style.setProperty("--cov-a", cardCover.style.getPropertyValue("--cov-a"));
      cover.style.setProperty("--cov-b", cardCover.style.getPropertyValue("--cov-b"));
      cover.style.setProperty("--cov-glow", cardCover.style.getPropertyValue("--cov-glow"));
    }
    var closeBtn = modalContent.querySelector("[data-modal-close]");
    if (closeBtn) closeBtn.addEventListener("click", closeModal);
  }
  function closeModal() {
    if (!modalOverlay) return;
    modalOverlay.classList.remove("open");
    document.body.style.overflow = "";
  }
  if (modalOverlay) {
    modalOverlay.addEventListener("click", function (e) {
      if (e.target === modalOverlay) closeModal();
    });
  }

  cards.forEach(function (card) {
    card.addEventListener("click", function (e) {
      if (e.target.closest("a") || e.target.closest("button")) return;
      openModal(card);
    });
    card.setAttribute("tabindex", "0");
    card.setAttribute("role", "button");
    card.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && e.target === card) openModal(card);
    });
  });

  /* ---------- active nav link ---------- */
  var navAnchors = document.querySelectorAll(".nav-links a[href^='#']");
  var sectionMap = {};
  navAnchors.forEach(function (a) {
    var id = a.getAttribute("href").slice(1);
    var el = document.getElementById(id);
    if (el) sectionMap[id] = a;
  });
  if ("IntersectionObserver" in window) {
    var no = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var a = sectionMap[e.target.id];
        if (!a) return;
        if (e.isIntersecting) {
          navAnchors.forEach(function (x) { x.classList.remove("active"); });
          a.classList.add("active");
        }
      });
    }, { rootMargin: "-40% 0px -55% 0px" });
    Object.keys(sectionMap).forEach(function (id) {
      no.observe(document.getElementById(id));
    });
  }
})();
