(function () {
  "use strict";
  const base = document.currentScript.src;
  const assets = {
    pdf: ["./results-pdf.js?v=20261120-performance-v2", "TimerResultsPdf"],
    people: ["./views/people.js?v=20261114-age-groups-v1", "TimerPeopleView"],
  };
  const pending = new Map();
  function load(name) {
    const asset = assets[name];
    if (!asset) return Promise.reject(new Error("Unbekanntes Modul."));
    if (window[asset[1]]) return Promise.resolve();
    if (pending.has(name)) return pending.get(name);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const finish = (error) => {
        clearTimeout(timer);
        script.onload = script.onerror = null;
        if (error) { script.remove(); reject(error); } else resolve();
      };
      const timer = setTimeout(() => finish(new Error("Das Modul konnte nicht rechtzeitig geladen werden. Bitte erneut versuchen.")), 10_000);
      script.src = new URL(asset[0], base).href;
      script.onload = () => finish(window[asset[1]] ? null : new Error("Das Modul konnte nicht gestartet werden."));
      script.onerror = () => finish(new Error("Das Modul konnte nicht geladen werden. Bitte erneut versuchen."));
      document.head.append(script);
    }).catch((error) => { pending.delete(name); throw error; });
    pending.set(name, promise);
    return promise;
  }
  window.TimerLazyAssets = Object.freeze({ load });
})();
