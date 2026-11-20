const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function harness({ reduced = false, splash = false } = {}) {
  const animations = [], frames = [], observers = [];
  const name = { textContent: "", clientWidth: 200, scrollWidth: 400, style: {},
    matches: (selector) => selector === ".dashboard-user-name", closest: () => ({}),
    animate(keyframes, options) {
      const animation = { keyframes, options, cancelled: false, cancel() { this.cancelled = true; } };
      animations.push(animation); return animation;
    } };
  const window = { requestAnimationFrame: (cb) => frames.push(cb), addEventListener() {},
    getComputedStyle: () => ({ fontSize: "48px" }), matchMedia: () => ({ matches: reduced }), LifesavingAppLaunch: { active: splash } };
  const document = { querySelectorAll: () => [name] };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../assets/js/dashboard-header.js"), "utf8"), {
    window, document, MutationObserver: class { constructor(cb) { observers.push(cb); } observe() {} },
  });
  return { api: window.LifesavingDashboardHeader, name, animations, frames, observers };
}

test("cached names are immediately fitted and never hidden behind a reveal", () => {
  const h = harness();
  h.api.setName("Anna Baden", { immediate: true });
  assert.equal(h.name.textContent, "Anna Baden");
  assert.equal(h.name.style.fontSize, "24px");
  assert.equal(h.animations.length, 0);
});

test("fresh names animate briefly while identical background updates do not replay the animation", () => {
  const h = harness();
  h.api.setName("Anna Baden");
  assert.equal(h.animations.length, 1);
  assert.equal(h.animations[0].options.duration, 220);
  assert.equal(h.name.style.fontSize, "24px", "long names fit before they become visible");
  h.api.setName("Anna Baden"); h.observers[0]();
  h.frames.forEach((cb) => cb());
  assert.equal(h.animations.length, 1);
});

test("a new account or cleared name cancels the old animation rather than restoring old text", () => {
  const h = harness();
  h.api.setName("Anna Baden"); const first = h.animations[0];
  h.api.setName("Bob", { immediate: true });
  assert.equal(first.cancelled, true);
  assert.equal(h.name.textContent, "Bob");
  assert.equal(h.animations.length, 1);
  h.api.setName("Clara"); const next = h.animations[1];
  h.api.setName("");
  assert.equal(next.cancelled, true);
  assert.equal(h.name.textContent, "");
  assert.equal(h.animations.length, 2);
});

test("reduced motion and the native-style startup overlay reveal their finished names without motion", () => {
  for (const options of [{ reduced: true }, { splash: true }]) {
    const h = harness(options); h.api.setName("Anna Baden");
    assert.equal(h.name.textContent, "Anna Baden");
    assert.equal(h.animations.length, 0);
  }
});
