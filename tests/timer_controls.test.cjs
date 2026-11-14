const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function node() {
  const classes = new Set();
  return {
    disabled: false, hidden: false, innerHTML: "", textContent: "", handlers: {},
    classList: {
      add: (name) => classes.add(name), remove: (name) => classes.delete(name),
      toggle(name, force) { if (force) classes.add(name); else classes.delete(name); },
      contains: (name) => classes.has(name),
    },
    addEventListener(type, callback) { (this.handlers[type] ||= []).push(callback); },
    emit(type, values = {}) {
      const event = { pointerId: 1, pointerType: "touch", isPrimary: true, button: 0,
        clientX: 50, clientY: 450, detail: 1, preventDefault() { this.defaultPrevented = true; }, ...values };
      for (const handler of this.handlers[type] || []) handler(event);
      return event;
    },
    click() { if (!this.disabled) this.emit("click", { pointerType: "", detail: 0 }); },
    setPointerCapture(id) { this.captured = id; },
    getBoundingClientRect: () => ({ left: 0, right: 150, top: 400, bottom: 480 }),
    querySelectorAll: () => [], close() {},
  };
}

function inputContext(pointerEvents = true) {
  const window = pointerEvents ? { PointerEvent: function () {} } : {};
  const context = vm.createContext({ window });
  vm.runInContext(fs.readFileSync(require.resolve("../timer/control-input.js"), "utf8"), context);
  return window;
}

test("release controls wait for release, including a 40-second hold, and suppress the following native click", () => {
  const window = inputContext();
  for (const pointerType of ["touch", "mouse", "pen"]) {
    const button = node();
    let activations = 0;
    window.TimerControlInput.bindRelease(button, () => activations++);
    button.emit("pointerdown", { pointerType, timeStamp: 1000 });
    assert.equal(activations, 0);
    assert.equal(button.captured, 1);
    assert.equal(button.emit("contextmenu").defaultPrevented, true);
    button.emit("pointerup", { pointerType, timeStamp: 41000 });
    button.emit("lostpointercapture");
    button.emit("click", { pointerType, timeStamp: 41001 });
    assert.equal(activations, 1);
    button.click();
    assert.equal(activations, 2, "keyboard and programmatic activation remain available");
  }
});

test("cancelled, outside, disabled and secondary pointer releases do not activate controls", () => {
  const button = node();
  let activations = 0;
  inputContext().TimerControlInput.bindRelease(button, () => activations++);
  for (const type of ["pointercancel", "lostpointercapture"]) {
    button.emit("pointerdown"); button.emit(type); button.emit("pointerup");
  }
  button.emit("pointerdown"); button.emit("pointerup", { clientX: 151 });
  button.emit("pointerdown", { button: 2 }); button.emit("pointerup");
  button.emit("pointerdown", { isPrimary: false }); button.emit("pointerup");
  button.disabled = true;
  button.emit("pointerdown"); button.emit("pointerup"); button.click();
  button.disabled = false;
  button.emit("pointerdown");
  button.emit("pointerup", { pointerId: 2 });
  assert.equal(activations, 0);
  button.emit("pointerup");
  assert.equal(activations, 1, "another finger cannot end the primary press");
});

test("older browsers retain native click activation", () => {
  const button = node();
  let activations = 0;
  inputContext(false).TimerControlInput.bindRelease(button, () => activations++);
  button.emit("click");
  assert.equal(activations, 1);
});

async function stopwatch(discipline = "normal", participantResponse = null) {
  const nodes = new Map();
  const find = (key) => {
    if (!nodes.has(key)) nodes.set(key, node());
    return nodes.get(key);
  };
  const actions = node();
  find("#left-action").parentElement = actions;
  let now = 0, frame;
  const window = inputContext();
  window.timerFirestoreApi = { getAuthContext: async () => ({}) };
  const context = vm.createContext({
    ...require("../timer/core.js"), window,
    routeVersion: 1,
    eventCache: { read: async () => ({ id: "e", name: "Test", can_use_timer: true, enabled_disciplines_json: JSON.stringify([discipline]) }) },
    document: { querySelector: find, documentElement: { clientHeight: 800 } },
    app: node(), animationFrame: null,
    api: async () => participantResponse || ({ event: { name: "Test", can_use_timer: true, enabled_disciplines_json: JSON.stringify([discipline]) }, participants: [] }),
    performance: { now: () => now }, requestAnimationFrame(callback) { frame = callback; return 1; }, cancelAnimationFrame() {},
    setTimeout: () => 1, clearTimeout() {},
    compareParticipantsByOrganization: () => 0, setDocumentTitle() {}, icon: () => "",
    bindDialogClose() {}, setTimerInteractionLock() {},
  });
  const source = fs.readFileSync(require.resolve("../timer/app.js"), "utf8");
  vm.runInContext(source.slice(source.indexOf("async function renderTimer(id)"), source.indexOf("async function renderViewer(")), context);
  await context.renderTimer("e");
  return { find, actions,
    advance(ms) { now += ms; frame?.(); },
    click(id) { find(`#${id}`).click(); },
    hold(id, ms) { const button = find(`#${id}`); button.emit("pointerdown"); now += ms; frame?.(); button.emit("pointerup"); button.emit("click"); },
    frequencyTap() { find("#timer-view").emit("click", { target: { closest: () => null }, clientY: 100 }); },
  };
}

test("Start and Runde still activate exactly once after holding for 40 seconds", async () => {
  const h = await stopwatch();
  h.hold("right-action", 40000);
  assert.equal(h.find("#clock").textContent, "0:00,00", "start is timed at release");
  h.hold("left-action", 40000);
  assert.equal(h.find("#clock").textContent, "0:40,00");
  assert.equal(h.find("#progress").textContent, "1 / max. 20 Laps");
});

test("the timer opens and starts while its participant download is still pending", { timeout: 1000 }, async () => {
  const h = await stopwatch("normal", new Promise(() => {}));
  assert.equal(h.find("#right-action").textContent, "Start");
  h.click("right-action");
  h.advance(1250);
  assert.equal(h.find("#clock").textContent, "0:01,25");
  assert.equal(h.find("#clock-status").textContent, "Läuft");
});

test("undo merges the previous lap with the live lap without losing elapsed time and can be repeated", async () => {
  const h = await stopwatch();
  assert.equal(h.find("#undo-lap").disabled, true);
  h.click("right-action");
  h.advance(1000); h.click("left-action");
  h.advance(3000); h.click("undo-lap"); h.advance(0);
  assert.equal(h.find("#live-lap-time").textContent, "0:04,00");
  assert.equal(h.find("#clock").textContent, "0:04,00");
  assert.equal(h.find("#progress").textContent, "0 / max. 20 Laps");
  assert.equal(h.find("#undo-lap").disabled, true);
  h.advance(1000); h.click("left-action");
  assert.match(h.find("#lap-list").innerHTML, /0:05,00/);
  h.advance(1000); h.click("left-action");
  h.advance(1000); h.click("undo-lap"); h.click("undo-lap"); h.advance(0);
  assert.equal(h.find("#live-lap-time").textContent, "0:07,00");
  assert.equal(h.find("#clock-status").textContent, "Läuft");
  h.advance(1000);
  assert.equal(h.find("#live-lap-time").textContent, "0:08,00");
});

test("undo restores Runde in the final discipline lap and clears affected frequency measurements", async () => {
  const h = await stopwatch("rescue100");
  h.click("right-action");
  h.frequencyTap(); h.advance(1000); h.click("left-action");
  h.frequencyTap(); h.advance(1000); h.click("left-action");
  assert.equal(h.find("#left-action").hidden, true);
  assert.equal(h.actions.classList.contains("final-lap"), true);
  h.frequencyTap(); h.advance(1000); h.click("undo-lap"); h.advance(0);
  assert.equal(h.find("#left-action").hidden, false);
  assert.equal(h.actions.classList.contains("final-lap"), false);
  assert.equal(h.find("#live-lap-time").textContent, "0:02,00");
  assert.equal((h.find("#lap-list").innerHTML.match(/\/min/g) || []).length, 1, "earlier lap frequency is retained");
  h.frequencyTap(); h.advance(1000); h.click("left-action");
  assert.equal((h.find("#lap-list").innerHTML.match(/\/min/g) || []).length, 2, "the combined lap can capture a new frequency");
});
