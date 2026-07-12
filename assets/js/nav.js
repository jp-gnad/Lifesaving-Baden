(() => {
  function syncNavBodyState() {
    const hasOpenNav = Boolean(document.querySelector(".nav.is-open"));

    document.body.classList.toggle("nav-open", hasOpenNav);
  }

  function closeNav(nav) {
    const toggle = nav.querySelector("[data-nav-toggle]");

    nav.classList.remove("is-open");
    toggle?.setAttribute("aria-expanded", "false");
    toggle?.setAttribute("aria-label", "Menü öffnen");
    syncNavBodyState();
  }

  document.querySelectorAll("[data-nav-toggle]").forEach((toggle) => {
    const nav = toggle.closest(".nav");
    const links = nav?.querySelector("[data-nav-links]");

    if (!nav || !links) {
      return;
    }

    toggle.addEventListener("click", () => {
      const isOpen = nav.classList.toggle("is-open");

      toggle.setAttribute("aria-expanded", String(isOpen));
      toggle.setAttribute("aria-label", isOpen ? "Menü schließen" : "Menü öffnen");
      syncNavBodyState();
    });

    links.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => closeNav(nav));
    });
  });

  document.addEventListener("click", (event) => {
    document.querySelectorAll(".nav.is-open").forEach((nav) => {
      if (!nav.contains(event.target)) {
        closeNav(nav);
      }
    });
  });

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    document.querySelectorAll(".nav.is-open").forEach(closeNav);
  });
})();
