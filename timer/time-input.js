(function (root) {
  "use strict";

  const digits = (value) => String(value).replace(/\D/g, "");
  function format(value) {
    const raw = digits(value).slice(0, 6);
    if (raw.length <= 2) return raw;
    const seconds = `${raw.slice(0, -2)},${raw.slice(-2)}`;
    return raw.length <= 4 ? seconds : `${seconds.slice(0, -5)}:${seconds.slice(-5)}`;
  }

  function create({ parseTime }) {
    function parse(value) {
      const text = String(value).trim();
      // One or two digits are still whole seconds, before the mask introduces
      // hundredths. Keep the shared parser's validation for completed times.
      if (/^\d{1,2}$/.test(text)) return Number(text) < 60 ? Number(text) * 100 : null;
      return parseTime(text);
    }

    function bind(input, changed = () => {}) {
      if (input.type === "hidden") return;
      function caretFor(value, count) {
        if (count === 0) return 0;
        for (let index = 0, seen = 0; index < value.length; index += 1) {
          if (/\d/.test(value[index]) && ++seen === count) return index + 1;
        }
        return value.length;
      }
      function update() {
        const before = input.value;
        const start = input.selectionStart;
        const end = input.selectionEnd;
        const next = format(before);
        if (next !== before) {
          input.value = next;
          if (start !== null && start !== undefined) input.setSelectionRange(
            caretFor(next, digits(before.slice(0, start)).length),
            caretFor(next, digits(before.slice(0, end)).length),
          );
        }
        changed();
      }
      input.addEventListener("input", (event) => { if (!event.isComposing) update(); });
      input.addEventListener("compositionend", update);
      input.addEventListener("beforeinput", (event) => {
        if (event.isComposing) return;
        const start = input.selectionStart, end = input.selectionEnd;
        if (start === null || start === undefined) return;
        if (event.inputType === "insertText" && event.data &&
          digits(input.value).length - digits(input.value.slice(start, end)).length + digits(event.data).length > 6) {
          event.preventDefault();
          return;
        }
        if (start !== end) return;
        // Backspace/Delete must remove a digit across an automatic separator,
        // rather than restoring that separator and leaving the cursor stuck.
        const backward = event.inputType === "deleteContentBackward";
        const forward = event.inputType === "deleteContentForward";
        const separator = backward ? start - 1 : start;
        if ((!backward && !forward) || !/[:,]/.test(input.value[separator] || "")) return;
        const remove = backward ? separator - 1 : separator + 1;
        if (!/\d/.test(input.value[remove] || "")) return;
        event.preventDefault();
        input.value = input.value.slice(0, remove) + input.value.slice(remove + 1);
        const caret = backward ? remove : start;
        input.setSelectionRange(caret, caret);
        update();
      });
    }

    return Object.freeze({ bind, parse });
  }

  const api = Object.freeze({ create, format });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TimerTimeInput = api;
})(typeof window === "undefined" ? globalThis : window);
