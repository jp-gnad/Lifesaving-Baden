window.LifesavingDashboardHeader = (() => {
  const name = document.querySelector(".dashboard-user-name");
  if (!name) return;
  const heading = name.closest("h1");
  let framePending = false;

  function fitName() {
    framePending = false;
    name.style.fontSize = "";
    const available = name.clientWidth;
    const required = name.scrollWidth;
    if (available > 0 && required > available) {
      const maximum = parseFloat(window.getComputedStyle(heading).fontSize);
      name.style.fontSize = `${Math.floor(maximum * available / required * 100) / 100}px`;
    }
  }

  function scheduleFit() {
    if (framePending) return;
    framePending = true;
    window.requestAnimationFrame(fitName);
  }

  new MutationObserver(scheduleFit).observe(name, { childList: true, characterData: true, subtree: true });
  if (window.ResizeObserver) new ResizeObserver(scheduleFit).observe(heading);
  window.addEventListener("resize", scheduleFit);
  window.addEventListener("pageshow", scheduleFit);
  document.fonts?.ready.then(scheduleFit);
  document.fonts?.addEventListener("loadingdone", scheduleFit);
  fitName();
  return { refresh: scheduleFit };
})();
