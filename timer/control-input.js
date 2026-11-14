(function (root) {
  "use strict";

  function bindRelease(button, activate) {
    let pressedPointer = null;
    const available = () => !button.disabled && !button.hidden;

    button.addEventListener("pointerdown", (event) => {
      if (!available() || event.isPrimary === false || event.button !== 0 || pressedPointer !== null) return;
      // Own the gesture so long presses and small finger movements do not turn
      // into browser selection, a context menu or scrolling.
      event.preventDefault();
      pressedPointer = event.pointerId;
      button.setPointerCapture(event.pointerId);
    });
    button.addEventListener("pointerup", (event) => {
      if (event.pointerId !== pressedPointer) return;
      pressedPointer = null;
      event.preventDefault();
      const bounds = button.getBoundingClientRect();
      if (available() && event.clientX >= bounds.left && event.clientX <= bounds.right
        && event.clientY >= bounds.top && event.clientY <= bounds.bottom) activate();
    });
    const cancel = (event) => {
      if (event.pointerId === pressedPointer) pressedPointer = null;
    };
    button.addEventListener("pointercancel", cancel);
    button.addEventListener("lostpointercapture", cancel);
    button.addEventListener("contextmenu", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      // Pointer releases already activated the control. Keep keyboard, assistive
      // technology and programmatic clicks working without a second activation.
      event.preventDefault();
      if (available() && (!root.PointerEvent || (!event.pointerType && event.detail === 0))) activate();
    });
  }

  const api = { bindRelease };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.TimerControlInput = api;
})(typeof window !== "undefined" ? window : globalThis);
