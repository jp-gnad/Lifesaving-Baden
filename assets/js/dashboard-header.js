window.LifesavingDashboardHeader = (() => {
  const names = Array.from(document.querySelectorAll(".dashboard-user-name, [data-account-greeting-name]"));
  if (!names.length) return;
  let framePending = false;

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
  return { refresh: scheduleFit };
})();
