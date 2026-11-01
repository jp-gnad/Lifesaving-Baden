(() => {
  const header = document.querySelector(".site-header");
  if (!header) return;

  let framePending = false;

  function updateShadow() {
    framePending = false;
    if (document.body.matches(".nav-open, .dialog-open")) return;

    const scrolled = window.scrollY > 0 || Array.from(document.querySelectorAll(
      "main, .event-list-section, .person-groups, .viewer-overview #results",
    )).some((area) => area.scrollTop > 0);
    header.classList.toggle("is-scrolled", scrolled);
  }

  function scheduleUpdate() {
    if (framePending) return;
    framePending = true;
    window.requestAnimationFrame(updateShadow);
  }

  document.addEventListener("scroll", scheduleUpdate, { capture: true, passive: true });
  window.addEventListener("pageshow", scheduleUpdate);
  window.addEventListener("resize", scheduleUpdate);
  const main = document.querySelector("main");
  if (main) new MutationObserver(scheduleUpdate).observe(main, { childList: true, subtree: true });
  updateShadow();
})();
