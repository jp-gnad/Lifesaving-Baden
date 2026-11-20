(function () {
  "use strict";
  const root = document.documentElement;
  const splash = document.querySelector(".app-launch");
  let active = Boolean(splash && root.classList.contains("app-launching"));
  let generation = 0, shownAt = 0, watchdog;
  const startedAt = Date.now();
  const noticeDelay = 5_000;
  let startupFailed = false;
  const failureText = "Der Start konnte nicht abgeschlossen werden. Bitte versuche es erneut.";
  const blocked = [];
  const pause = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
  const frame = () => new Promise((resolve) => window.requestAnimationFrame(resolve));
  const status = splash?.querySelector("[data-launch-status]");
  const retry = splash?.querySelector("[data-launch-retry]");
  const restore = () => {
    for (const [element, wasInert] of blocked) if (!wasInert) element.removeAttribute("inert");
  };
  function hide() {
    active = false;
    window.clearTimeout(watchdog);
    root.classList.remove("app-launching", "app-launch-minimum");
    restore();
    window.removeEventListener("error", resourceError, true);
  }
  function message(text) {
    if (!active) return;
    if (status) { status.textContent = text; status.hidden = false; }
    if (retry) retry.hidden = false;
  }
  function failedResource() {
    if (!active) return;
    startupFailed = true;
    if (Date.now() - startedAt >= noticeDelay) message(failureText);
  }
  function resourceError(event) {
    // Hidden avatar placeholders and optional photos can fail independently of startup.
    if (event?.target?.tagName === "IMG") return;
    failedResource();
  }
  let brandReady = Promise.resolve();
  if (active) {
    root.classList.add("app-launch-minimum");
    for (const element of document.body.children) {
      if (element === splash || element.tagName === "SCRIPT") continue;
      blocked.push([element, element.hasAttribute("inert")]);
      element.setAttribute("inert", "");
    }
    const content = splash.querySelector(".app-launch-content");
    const logo = splash.querySelector("img");
    brandReady = (async () => {
      let timer;
      const decoded = logo?.decode ? logo.decode().then(() => {
        if (active) logo.style.visibility = "";
        return true;
      }, () => false) : Promise.resolve(Boolean(logo?.complete));
      const available = await Promise.race([decoded,
        new Promise((resolve) => { timer = window.setTimeout(() => resolve(false), 250); }),
      ]);
      window.clearTimeout(timer);
      if (!active) return;
      if (logo && !available) logo.style.visibility = "hidden";
      shownAt = Date.now();
      content.hidden = false;
    })();
    watchdog = window.setTimeout(() => message(startupFailed ? failureText
      : "Das Laden dauert länger. Du kannst weiter warten oder es erneut versuchen."), noticeDelay);
    retry?.addEventListener("click", () => {
      const url = new URL(window.location.href);
      url.searchParams.set("appLaunch", "1");
      window.location.replace(url.href);
    });
    window.addEventListener("error", resourceError, true);
    window.addEventListener("pagehide", () => { generation += 1; hide(); }, { once: true });
  }

  async function assetsReady() {
    // Normal document loading includes local CSS/backgrounds. Late profile
    // photos are optional; only visible same-origin images gate this overlay.
    if (document.readyState !== "complete") await new Promise((resolve) => window.addEventListener("load", resolve, { once: true }));
    if (document.fonts?.ready) await document.fonts.ready.catch(() => {});
    const images = [...document.images].filter((image) => image.decode && image.getClientRects().length
      && image.getBoundingClientRect().top < window.innerHeight
      && new URL(image.currentSrc || image.src, window.location.href).origin === window.location.origin);
    await Promise.all(images.map((image) => image.decode().catch(() => {})));
    await frame();
    await frame();
  }

  window.LifesavingAppLaunch = Object.freeze({
    get active() { return active; },
    hold() { generation += 1; },
    async ready(isCurrent = () => true) {
      if (!active) return isCurrent();
      const version = ++generation;
      await Promise.all([brandReady, assetsReady()]);
      const minimum = 650 - (Date.now() - shownAt);
      if (minimum > 0) await pause(minimum);
      if (!active || generation !== version || !isCurrent()) return false;
      hide();
      return true;
    },
    fail() { failedResource(); },
  });
})();
