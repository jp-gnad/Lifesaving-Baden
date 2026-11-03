(() => {
  const mobile = window.matchMedia("(max-width: 1000px)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const svgNamespace = "http://www.w3.org/2000/svg";
  let scrollLock = null;

  function lockPage(header) {
    if (scrollLock) return;
    const body = document.body;
    const properties = ["position", "top", "left", "right", "width", "padding-right"];
    const gap = window.innerWidth - document.documentElement.clientWidth;
    scrollLock = {
      x: window.scrollX, y: window.scrollY,
      styles: properties.map((name) => [name, body.style.getPropertyValue(name)]),
      inert: [],
    };
    document.documentElement.style.setProperty("--nav-scrollbar-gap", `${gap}px`);
    body.style.paddingRight = `${parseFloat(getComputedStyle(body).paddingRight) + gap}px`;
    body.style.position = "fixed";
    body.style.top = `${-scrollLock.y}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    document.documentElement.classList.add("nav-open");
    body.classList.add("nav-open");
    for (let node = header; node && node !== body; node = node.parentElement) {
      for (const sibling of node.parentElement.children) {
        if (sibling === node || sibling.matches("script, style, link")) continue;
        scrollLock.inert.push([sibling, sibling.inert]);
        sibling.inert = true;
      }
    }
  }

  function unlockPage() {
    if (!scrollLock) return;
    const saved = scrollLock;
    scrollLock = null;
    saved.inert.forEach(([element, inert]) => { element.inert = inert; });
    saved.styles.forEach(([name, value]) => {
      if (value) document.body.style.setProperty(name, value);
      else document.body.style.removeProperty(name);
    });
    document.documentElement.classList.remove("nav-open");
    document.body.classList.remove("nav-open");
    document.documentElement.style.removeProperty("--nav-scrollbar-gap");
    const behavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo(saved.x, saved.y);
    document.documentElement.style.scrollBehavior = behavior;
  }

  function glyph(className, path) {
    const svg = document.createElementNS(svgNamespace, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.setAttribute("class", className);
    const shape = document.createElementNS(svgNamespace, "path");
    shape.setAttribute("d", path);
    svg.append(shape);
    return svg;
  }

  document.querySelectorAll("[data-nav-toggle]").forEach((toggle, navIndex) => {
    const nav = toggle.closest(".nav");
    const panel = nav?.querySelector("[data-nav-links]");
    const header = nav?.closest(".site-header");
    if (!panel || !header) return;

    toggle.replaceChildren(
      glyph("nav-menu-glyph nav-menu-glyph--open", "M3 6h18M3 12h18M3 18h18"),
      glyph("nav-menu-glyph nav-menu-glyph--close", "m5 5 14 14M19 5 5 19"),
    );
    if (!panel.id) panel.id = `mobile-navigation-${navIndex}`;
    toggle.setAttribute("aria-controls", panel.id);

    const backdrop = document.createElement("div");
    backdrop.className = "nav-backdrop";
    backdrop.setAttribute("aria-hidden", "true");
    const root = document.createElement("div");
    root.className = "nav-level nav-root-level";
    root.append(...panel.childNodes);
    panel.append(backdrop, root);
    const levels = [root];
    const submenus = [];
    let current = root;
    let desiredOpen = false;
    let phase = "closed";
    let timer = null;
    let revision = 0;
    let settle = null;
    let animations = [];

    const items = (level) => Array.from(level.children)
      .filter((row) => !row.matches("script, template, [data-nav-submenu]"));
    const rows = (level = current) => items(level).filter((row) => {
      const style = getComputedStyle(row);
      return !row.hidden && style.display !== "none" && style.visibility !== "hidden";
    });
    const mainLink = (row) => row.matches("a") ? row : row.querySelector("a");
    const noMotion = () => reducedMotion.matches || typeof panel.animate !== "function";

    function prepare(level) {
      items(level).forEach((row) => {
        row.classList.add("nav-row");
        const link = mainLink(row);
        if (link) {
          let label = Array.from(link.children).find((child) => child.matches("span:not(.nav-link-icon)"));
          if (!label) {
            label = document.createElement("span");
            Array.from(link.childNodes).forEach((node) => {
              if (node.nodeType !== 1 || !node.matches(".nav-link-icon")) label.append(node);
            });
            link.append(label);
          }
          label.classList.add("nav-link-label");
          if (!link.querySelector(".nav-link-icon")) {
            const icon = document.createElement("span");
            icon.className = "nav-link-icon";
            icon.setAttribute("aria-hidden", "true");
            icon.append(glyph("", "m3 11 9-8 9 8M5 10v10h5v-6h4v6h5V10"));
            link.prepend(icon);
          }
        }
        const submenu = Array.from(row.children).find((child) => child.matches("[data-nav-submenu]"));
        if (!submenu || !link) return;
        const marker = document.createComment("submenu position");
        submenu.before(marker);
        const record = { level: submenu, parent: level, row, marker, hidden: submenu.hidden };
        submenu.id ||= `${panel.id}-submenu-${submenus.length + 1}`;
        submenu.classList.add("nav-level", "nav-submenu-level");
        const arrow = document.createElement("button");
        arrow.type = "button";
        arrow.className = "nav-submenu-toggle";
        arrow.textContent = "›";
        arrow.setAttribute("aria-label", `Untermenü ${link.textContent.trim()} öffnen`);
        arrow.setAttribute("aria-controls", submenu.id);
        arrow.setAttribute("aria-expanded", "false");
        row.append(arrow);
        const back = document.createElement("button");
        back.type = "button";
        back.className = "nav-row nav-back";
        const chevron = document.createElement("span");
        chevron.textContent = "‹";
        chevron.setAttribute("aria-hidden", "true");
        const text = document.createElement("span");
        text.textContent = "Zurück";
        back.append(chevron, text);
        submenu.prepend(back);
        record.arrow = arrow;
        record.back = back;
        submenus.push(record);
        levels.push(submenu);
        arrow.addEventListener("click", () => changeLevel(submenu, back));
        back.addEventListener("click", () => changeLevel(level, arrow));
        prepare(submenu);
      });
    }
    prepare(root);

    function updateActive() {
      const normalize = (path) => path.replace(/\/index\.html$/, "/");
      const here = new URL(window.location.href);
      const links = Array.from(panel.querySelectorAll("a[href]"));
      let active = links.filter((link) => {
        const target = new URL(link.href);
        return link.getAttribute("aria-current") === "page"
          || target.origin === here.origin && normalize(target.pathname) === normalize(here.pathname)
          && (!target.hash || target.hash === here.hash);
      });
      if (!active.length) {
        const home = header.querySelector(".brand[href]");
        active = links.filter((link) => home && link.href === home.href);
      }
      levels.forEach((level) => items(level).forEach((row) => row.classList.remove("is-current-section")));
      active.forEach((link) => {
        link.closest(".nav-row")?.classList.add("is-current-section");
        let level = link.closest(".nav-level");
        for (let parent = submenus.find((item) => item.level === level); parent;
          parent = submenus.find((item) => item.level === parent.parent)) {
          parent.row.classList.add("is-current-section");
        }
      });
    }

    function cancelAnimations() {
      window.clearTimeout(timer);
      timer = null;
      animations.forEach((animation) => animation.cancel());
      animations = [];
      if (settle) settle(false);
      settle = null;
      revision += 1;
    }

    function animate(element, frames, options) {
      animations.push(element.animate(frames, { ...options, fill: "both" }));
    }

    function showLevel(level) {
      current = level;
      levels.forEach((item) => { item.hidden = item !== level; });
      submenus.forEach((item) => item.arrow.setAttribute("aria-expanded", "false"));
      for (let parent = submenus.find((item) => item.level === level); parent;
        parent = submenus.find((item) => item.level === parent.parent)) {
        parent.arrow.setAttribute("aria-expanded", "true");
      }
    }

    function enterMobile() {
      submenus.forEach((item) => { panel.append(item.level); });
      showLevel(root);
      panel.inert = true;
      panel.setAttribute("aria-hidden", "true");
      updateActive();
    }

    function reset() {
      cancelAnimations();
      desiredOpen = false;
      phase = "closed";
      nav.dataset.navState = phase;
      nav.classList.remove("is-open", "is-expanded", "is-closing", "is-instant");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Menü öffnen");
      backdrop.style.removeProperty("opacity");
      if (mobile.matches) {
        showLevel(root);
        panel.inert = true;
        panel.setAttribute("aria-hidden", "true");
      } else {
        root.hidden = false;
        submenus.forEach((item) => {
          item.marker.parentNode.insertBefore(item.level, item.marker);
          item.level.hidden = item.hidden;
          item.arrow.setAttribute("aria-expanded", "false");
        });
        current = root;
        panel.inert = false;
        panel.removeAttribute("aria-hidden");
      }
      unlockPage();
    }

    function transition(open) {
      if (!mobile.matches) { reset(); return Promise.resolve(false); }
      const visibleRows = rows();
      const previous = new Map([backdrop, ...visibleRows].map((element) => {
        const style = getComputedStyle(element);
        return [element, { opacity: style.opacity, transform: style.transform }];
      }));
      const wasClosed = phase === "closed";
      cancelAnimations();
      const token = revision;
      desiredOpen = open;
      phase = open ? "opening" : "closing";
      nav.dataset.navState = phase;
      nav.classList.add("is-open");
      nav.classList.toggle("is-expanded", open);
      nav.classList.toggle("is-closing", !open);
      nav.classList.toggle("is-instant", noMotion());
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Menü schließen" : "Menü öffnen");
      if (!open && panel.contains(document.activeElement)) toggle.focus({ preventScroll: true });
      panel.inert = !open;
      panel.setAttribute("aria-hidden", String(!open));
      if (open) { lockPage(header); updateActive(); }

      let duration = 0;
      if (!noMotion()) {
        visibleRows.forEach((row, index) => {
          const from = wasClosed ? { opacity: 0, transform: "translateX(3rem)" } : previous.get(row);
          const delay = open ? 80 + index * 85 : (visibleRows.length - 1 - index) * 85;
          animate(row, [from, { opacity: open ? 1 : 0, transform: open ? "translateX(0)" : "translateX(3rem)" }], {
            duration: open ? 280 : 220, delay,
            easing: open ? "cubic-bezier(.22, .75, .25, 1)" : "cubic-bezier(.55, .05, .78, .3)",
          });
        });
        const lastRowEnd = visibleRows.length ? (visibleRows.length - 1) * 85 + (open ? 360 : 220) : 0;
        const fadeDelay = open ? 0 : Math.max(0, lastRowEnd - 20);
        animate(backdrop, [{ opacity: wasClosed ? 0 : previous.get(backdrop).opacity }, { opacity: open ? 1 : 0 }], {
          duration: open ? 140 : 130, delay: fadeDelay, easing: open ? "ease-out" : "ease-in",
        });
        duration = Math.max(lastRowEnd, fadeDelay + (open ? 140 : 130));
      } else {
        backdrop.style.opacity = open ? "1" : "0";
      }

      return new Promise((resolve) => {
        settle = resolve;
        const finish = () => {
          if (revision !== token) return;
          settle = null;
          if (open) {
            phase = "open";
            nav.dataset.navState = phase;
          } else reset();
          resolve(true);
        };
        if (duration) timer = window.setTimeout(finish, duration);
        else finish();
      });
    }

    function changeLevel(level, focus) {
      if (!mobile.matches || !desiredOpen) return;
      cancelAnimations();
      showLevel(level);
      current.scrollTop = 0;
      backdrop.style.opacity = "1";
      nav.classList.toggle("is-instant", noMotion());
      if (!noMotion()) rows().forEach((row, index) => {
        animate(row, [{ opacity: 0, transform: "translateX(3rem)" }, { opacity: 1, transform: "translateX(0)" }], {
          duration: 280, delay: 80 + index * 85, easing: "cubic-bezier(.22, .75, .25, 1)",
        });
      });
      phase = "open";
      nav.dataset.navState = phase;
      focus.focus({ preventScroll: true });
    }

    toggle.addEventListener("click", () => transition(!desiredOpen));
    panel.addEventListener("click", (event) => {
      const link = event.target.closest("a[href]");
      if (!mobile.matches || !link || event.defaultPrevented) return;
      if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey
        || link.hasAttribute("download") || (link.target && link.target !== "_self")) {
        transition(false);
        return;
      }
      event.preventDefault();
      transition(false).then((completed) => { if (completed) window.location.assign(link.href); });
    });
    document.addEventListener("click", (event) => {
      if (!desiredOpen || nav.contains(event.target)) return;
      if (event.target.closest("a, button")) reset();
      else transition(false);
    }, { capture: true });
    // Account controls sit beside the menu and must remain immediately usable.
    nav.querySelectorAll("[data-account-open]").forEach((button) => {
      button.addEventListener("click", () => { if (desiredOpen) reset(); }, { capture: true });
    });
    document.addEventListener("keydown", (event) => {
      if (phase === "closed" || !mobile.matches) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (desiredOpen) transition(false);
        toggle.focus({ preventScroll: true });
      } else if (event.key === "Tab" && desiredOpen) {
        const focusable = [toggle, ...current.querySelectorAll("a[href], button:not([disabled])")]
          .filter((element) => element.getClientRects().length && !element.closest("[inert]"));
        const index = focusable.indexOf(document.activeElement);
        if (event.shiftKey && index <= 0) {
          event.preventDefault(); focusable.at(-1)?.focus();
        } else if (!event.shiftKey && (index === -1 || index === focusable.length - 1)) {
          event.preventDefault(); toggle.focus();
        }
      }
    });
    ["touchmove", "wheel"].forEach((type) => {
      document.addEventListener(type, (event) => {
        if (phase !== "closed" && !panel.contains(event.target)) event.preventDefault();
      }, { passive: false });
    });
    mobile.addEventListener("change", () => { reset(); if (mobile.matches) enterMobile(); });
    reducedMotion.addEventListener("change", () => { if (phase !== "closed") transition(desiredOpen); });
    window.addEventListener("hashchange", updateActive);
    window.addEventListener("pagehide", reset);
    if (mobile.matches) enterMobile();
    else reset();
  });
})();
