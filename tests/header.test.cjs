const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../assets/js/header.js"), "utf8");

function headerPage(initialScroll = 0) {
  const classes = new Set();
  const listeners = {};
  const frames = [];
  const main = { scrollTop: 0 };
  let areas = [main];
  let locked = false;
  let onMutation;
  const header = { classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); } } };
  const document = {
    body: { matches: () => locked },
    querySelector: (selector) => selector === ".site-header" ? header : main,
    querySelectorAll: () => areas,
    addEventListener: (name, callback) => { listeners[name] = callback; },
  };
  const window = {
    scrollY: initialScroll,
    requestAnimationFrame: (callback) => frames.push(callback),
    addEventListener: (name, callback) => { listeners[name] = callback; },
  };
  class MutationObserver {
    constructor(callback) { onMutation = callback; }
    observe() {}
  }
  vm.runInNewContext(source, { document, window, MutationObserver });
  return {
    window, main, frames, listeners,
    shadow: () => classes.has("is-scrolled"),
    flush() { while (frames.length) frames.shift()(); },
    replaceAreas(next) { areas = next; onMutation(); },
    lock(value) { locked = value; },
  };
}

test("document scrolling adds and removes the shadow, including restored positions", () => {
  const page = headerPage(120);
  assert.equal(page.shadow(), true);
  page.window.scrollY = 0;
  page.listeners.scroll();
  page.flush();
  assert.equal(page.shadow(), false);
  page.window.scrollY = 75;
  page.listeners.pageshow();
  page.flush();
  assert.equal(page.shadow(), true);
});

test("internal scrolling counts and replacing a timer view clears stale shadow state", () => {
  const page = headerPage();
  assert.equal(page.shadow(), false);
  page.main.scrollTop = 40;
  page.listeners.scroll();
  page.flush();
  assert.equal(page.shadow(), true);
  page.replaceAreas([{ scrollTop: 0 }]);
  page.flush();
  assert.equal(page.shadow(), false);
});

test("scroll locks preserve the shadow until the page position is restored", () => {
  const page = headerPage(100);
  page.lock(true);
  page.window.scrollY = 0;
  page.listeners.scroll();
  page.flush();
  assert.equal(page.shadow(), true);
  page.lock(false);
  page.listeners.scroll();
  page.flush();
  assert.equal(page.shadow(), false);
});

test("repeated scroll events share one animation frame", () => {
  const page = headerPage();
  for (let i = 0; i < 10; i += 1) page.listeners.scroll();
  assert.equal(page.frames.length, 1);
});
