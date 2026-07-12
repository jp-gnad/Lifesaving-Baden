(() => {
  let lockedScrollY = 0;

  function lockPageScroll() {
    if (document.body.classList.contains("nav-open")) {
      return;
    }

    lockedScrollY = window.scrollY || document.documentElement.scrollTop || 0;
    document.documentElement.classList.add("nav-open");
    document.body.classList.add("nav-open");
    document.body.style.position = "fixed";
    document.body.style.top = `-${lockedScrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
  }

  function unlockPageScroll() {
    if (!document.body.classList.contains("nav-open")) {
      return;
    }

    const scrollY = lockedScrollY;

    document.documentElement.classList.remove("nav-open");
    document.body.classList.remove("nav-open");
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    window.scrollTo(0, scrollY);
  }

  function syncNavBodyState() {
    const hasOpenNav = Boolean(document.querySelector(".nav.is-open"));

    if (hasOpenNav) {
      lockPageScroll();
      return;
    }

    unlockPageScroll();
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

  window.addEventListener("resize", () => {
    if (!window.matchMedia("(min-width: 861px)").matches) {
      return;
    }

    document.querySelectorAll(".nav.is-open").forEach(closeNav);
  });
})();
