(function () {
  "use strict";

  const preventZoom = (event) => { if (event.cancelable) event.preventDefault(); };
  const gestureOptions = { capture: true, passive: false };

  for (const type of ["gesturestart", "gesturechange"]) {
    document.addEventListener(type, preventZoom, gestureOptions);
  }
  for (const type of ["touchstart", "touchmove"]) {
    document.addEventListener(type, (event) => {
      if (event.touches.length > 1) preventZoom(event);
    }, gestureOptions);
  }
  document.addEventListener("wheel", (event) => {
    if (event.ctrlKey || event.metaKey) preventZoom(event);
  }, gestureOptions);

  const zoomKeys = new Set(["+", "=", "-", "_", "0"]);
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && zoomKeys.has(event.key)) preventZoom(event);
  }, true);
})();
