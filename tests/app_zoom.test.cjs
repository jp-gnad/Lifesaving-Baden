const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { runInNewContext } = require("node:vm");

const source = readFileSync(join(__dirname, "../assets/js/app-zoom.js"), "utf8");

function gestures() {
  const listeners = new Map();
  runInNewContext(source, {
    document: { addEventListener: (type, handle, options) => listeners.set(type, { handle, options }) },
  });
  return function prevented(type, details = {}) {
    const listener = listeners.get(type);
    if (type !== "keydown") assert.equal(listener.options.passive, false);
    let result = false;
    listener.handle({ cancelable: true, ...details, preventDefault() { result = true; } });
    return result;
  };
}

test("pinch, browser gesture events and modified wheel cannot zoom the app", () => {
  const prevented = gestures();
  assert.equal(prevented("gesturestart"), true);
  assert.equal(prevented("gesturechange"), true);
  for (const type of ["touchstart", "touchmove"]) {
    assert.equal(prevented(type, { touches: [{}, {}] }), true);
    assert.equal(prevented(type, { touches: [{}] }), false);
  }
  assert.equal(prevented("wheel", { ctrlKey: true }), true);
  assert.equal(prevented("wheel", { ctrlKey: true, cancelable: false }), false);
  assert.equal(prevented("wheel"), false);
});

test("zoom shortcuts are canceled without consuming other keyboard shortcuts or AltGr input", () => {
  const prevented = gestures();
  for (const key of ["+", "=", "-", "0"]) {
    assert.equal(prevented("keydown", { key, ctrlKey: true }), true);
    assert.equal(prevented("keydown", { key, metaKey: true }), true);
  }
  assert.equal(prevented("keydown", { key: "a", ctrlKey: true }), false);
  assert.equal(prevented("keydown", { key: "+", ctrlKey: true, altKey: true }), false);
  assert.equal(prevented("keydown", { key: "0" }), false);
});
