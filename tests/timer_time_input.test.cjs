const test = require("node:test");
const assert = require("node:assert/strict");
const { format, create } = require("../timer/time-input.js");
const timeInput = create(require("../timer/core.js"));

function field(initial = "") {
  const handlers = new Map();
  const input = { value: initial, type: "text", selectionStart: initial.length, selectionEnd: initial.length,
    addEventListener(type, handler) { handlers.set(type, handler); },
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
  };
  let changes = 0;
  timeInput.bind(input, () => changes++);
  const emit = (type, props = {}) => {
    const event = { preventDefault() { this.defaultPrevented = true; }, ...props };
    handlers.get(type)?.(event);
    return event;
  };
  function edit(inputType, data = null) {
    if (emit("beforeinput", { inputType, data }).defaultPrevented) return;
    let start = input.selectionStart, end = input.selectionEnd;
    if (inputType === "deleteContentBackward" && start === end) start = Math.max(0, start - 1);
    if (inputType === "deleteContentForward" && start === end) end = Math.min(input.value.length, end + 1);
    const inserted = data || "";
    input.value = input.value.slice(0, start) + inserted + input.value.slice(end);
    input.setSelectionRange(start + inserted.length, start + inserted.length);
    emit("input", { inputType, data });
  }
  return { input, emit, edit, changes: () => changes,
    type(text) { for (const digit of text) edit("insertText", digit); },
    select: (start, end = start) => input.setSelectionRange(start, end),
  };
}

test("the live mask follows every requested digit count and stops at six digits", () => {
  const h = field();
  for (const [digit, expected] of [["1", "1"], ["2", "12"], ["3", "1,23"], ["4", "12,34"], ["5", "1:23,45"], ["6", "12:34,56"]]) {
    h.type(digit);
    assert.equal(h.input.value, expected);
    assert.equal(h.input.selectionStart, expected.length);
  }
  h.type("7");
  assert.equal(h.input.value, "12:34,56");
  assert.equal(h.changes(), 6);
  assert.equal(format("999999"), "99:99,99");
  assert.equal(format("9999999"), "99:99,99");
});

test("backspacing from the end reverses the mask all the way to an empty field", () => {
  const h = field(); h.type("123456");
  for (const expected of ["1:23,45", "12,34", "1,23", "12", "1", ""]) {
    h.edit("deleteContentBackward");
    assert.equal(h.input.value, expected);
    assert.equal(h.input.selectionStart, expected.length);
  }
});

test("deleting across separators removes digits instead of trapping the cursor", () => {
  const backward = field("1:23,45"); backward.select(2); backward.edit("deleteContentBackward");
  assert.equal(backward.input.value, "23,45");
  assert.equal(backward.input.selectionStart, 0);
  const forward = field("1:23,45"); forward.select(1); forward.edit("deleteContentForward");
  assert.equal(forward.input.value, "13,45");
  assert.equal(forward.input.selectionStart, 1);
  const comma = field("12,34"); comma.select(3); comma.edit("deleteContentBackward");
  assert.equal(comma.input.value, "1,34");
  assert.equal(comma.changes(), 1);
});

test("selection replacement, insertion in the middle, leading zeros and pasted times preserve the intended digits", () => {
  const h = field("12:34,56");
  h.select(3, 5); h.type("0");
  assert.equal(h.input.value, "1:20,56");
  h.type("8");
  assert.equal(h.input.value, "12:08,56");
  h.select(0, h.input.value.length); h.type("001234");
  assert.equal(h.input.value, "00:12,34");
  h.select(0, h.input.value.length); h.edit("insertFromPaste", "1:23,45");
  assert.equal(h.input.value, "1:23,45");
  assert.equal(timeInput.parse(h.input.value), 8345);
});

test("typing short whole seconds works, existing longer times remain readable, and time validation remains strict", () => {
  assert.equal(timeInput.parse("1"), 100);
  assert.equal(timeInput.parse("12"), 1200);
  assert.equal(timeInput.parse("1,23"), 123);
  assert.equal(timeInput.parse("12:34,56"), 75456);
  assert.equal(timeInput.parse("99:59,99"), 599999);
  assert.equal(timeInput.parse("99:99,99"), null);
  assert.equal(timeInput.parse(""), null);
  const existing = field("100:00,00");
  assert.equal(existing.input.value, "100:00,00");
  assert.equal(timeInput.parse(existing.input.value), 600000);
});
