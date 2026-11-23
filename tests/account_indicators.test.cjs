const test = require("node:test");
const assert = require("node:assert/strict");
const { create } = require("../assets/js/account-indicators.js");

function page(storage = new Map()) {
  function node() {
    const attributes = new Map();
    let text = "", hidden = true, writes = 0;
    return { get textContent() { return text; }, set textContent(value) { text = value; writes++; },
      get hidden() { return hidden; }, set hidden(value) { hidden = value; writes++; },
      get writes() { return writes; }, classList: { toggle() {} },
      getAttribute: (name) => attributes.get(name), setAttribute: (name, value) => attributes.set(name, value) };
  }
  const green = node(), red = node(), settings = node(), accounts = node(), clubs = node(), timer = node();
  settings.dataset = { settingsAttention: "personal" };
  for (const badge of [settings, accounts, clubs]) {
    const app = node();
    badge.closest = () => app;
  }
  const elements = {
    "[data-link-indicator]": [green], "[data-account-attention], [data-account-manage-attention]": [red],
    "[data-settings-attention]": [settings], "[data-admin-notification-count]": [accounts], "[data-club-notification-count]": [clubs],
    "[data-timer-account-header-attention], [data-timer-account-manage-attention]": [timer],
  };
  const api = create({ document: { querySelectorAll: (selector) => elements[selector] || [] }, getStorage: () => ({
    getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key),
  }) });
  return { api, storage, green, red, settings, accounts, clubs, timer };
}

test("a new page paints the saved green link and red counters before auth and changes only different values", () => {
  const home = page();
  home.api.setAccount("admin");
  home.api.setProfile("admin", { personal: 2, links: 0 });
  home.api.setRole("admin", true);
  home.api.setCount("admin", "accounts", 4);
  home.api.setCount("admin", "clubs", 1);

  const next = page(home.storage);
  next.api.restore();
  assert.equal(next.green.hidden, false);
  assert.equal(next.red.textContent, "2");
  assert.equal(next.settings.textContent, "2");
  assert.equal(next.accounts.textContent, "4");
  assert.equal(next.clubs.textContent, "1");

  const writes = next.green.writes + next.red.writes + next.accounts.writes + next.clubs.writes;
  next.api.setAccount("admin");
  next.api.setProfile("admin", { personal: 2, links: 0 });
  next.api.setCount("admin", "accounts", 4);
  assert.equal(next.green.writes + next.red.writes + next.accounts.writes + next.clubs.writes, writes);

  next.api.setProfile("admin", { personal: 0, links: 1 });
  next.api.setCount("admin", "accounts", 0);
  assert.equal(next.green.hidden, true);
  assert.equal(next.red.textContent, "1");
  assert.equal(next.settings.hidden, true);
  assert.equal(next.accounts.hidden, true);
  assert.equal(next.clubs.textContent, "1");
});

test("role loss, account switches and logout clear their indicators and ignore late responses", () => {
  const h = page();
  h.api.setAccount("a");
  h.api.setRole("a", true);
  h.api.setProfile("a", { personal: 1, links: 0 });
  h.api.setCount("a", "clubs", 2);
  h.api.setRole("a", false);
  h.api.setCount("a", "clubs", 3);
  assert.equal(h.clubs.hidden, true);
  assert.equal(h.timer.hidden, false);
  h.api.setAccount("b");
  h.api.setProfile("a", { personal: 3, links: 0 });
  h.api.setRole("a", true);
  assert.equal(h.green.hidden, true);
  assert.equal(h.red.hidden, true);
  assert.equal(h.timer.hidden, true);
  h.api.setAccount(null);
  assert.equal(h.storage.size, 0);
});
