window.LifesavingDashboardHeader = (() => {
  const names = Array.from(document.querySelectorAll(".dashboard-user-name, [data-account-greeting-name]"));
  if (!names.length) return;
  let framePending = false;
  const nameAnimations = new WeakMap();

  function setName(value, { immediate = false } = {}) {
    if (immediate) names.forEach((name) => nameAnimations.get(name)?.cancel());
    const changed = names.filter((name) => name.matches(".dashboard-user-name") && name.textContent !== value);
    changed.forEach((name) => {
      nameAnimations.get(name)?.cancel();
      name.textContent = value;
    });
    if (!changed.length) return;
    fitName();
    if (immediate || !value || window.LifesavingAppLaunch?.active
      || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
    changed.forEach((name) => {
      if (!name.animate) return;
      const animation = name.animate([
        { opacity: 0, transform: "translateX(-6px)" },
        { opacity: 1, transform: "translateX(0)" },
      ], { duration: 220, easing: "cubic-bezier(.22, 1, .36, 1)" });
      nameAnimations.set(name, animation);
    });
  }

  function fitName() {
    framePending = false;
    names.forEach((name) => {
      name.style.fontSize = "";
      const available = name.clientWidth;
      const required = name.scrollWidth;
      if (available > 0 && required > available) {
        const heading = name.closest("h1, h2");
        const maximum = parseFloat(window.getComputedStyle(heading).fontSize);
        name.style.fontSize = `${Math.floor(maximum * available / required * 100) / 100}px`;
      }
    });
  }

  function scheduleFit() {
    if (framePending) return;
    framePending = true;
    window.requestAnimationFrame(fitName);
  }

  const textObserver = new MutationObserver(scheduleFit);
  const sizeObserver = window.ResizeObserver ? new ResizeObserver(scheduleFit) : null;
  names.forEach((name) => {
    textObserver.observe(name, { childList: true, characterData: true, subtree: true });
    sizeObserver?.observe(name.closest("h1, h2"));
  });
  window.addEventListener("resize", scheduleFit);
  window.addEventListener("pageshow", scheduleFit);
  document.fonts?.ready.then(scheduleFit);
  document.fonts?.addEventListener("loadingdone", scheduleFit);
  fitName();
  return { refresh: scheduleFit, setName };
})();
