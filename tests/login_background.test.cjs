const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "assets/js/login-background.js"), "utf8");

test("all three photos can be selected under root and GitHub project URLs", () => {
  const files = ["auth-pool.webp", "auth-rescue.webp", "auth-competition.webp"];
  for (const base of ["https://example.test/", "https://jp-gnad.github.io/Lifesaving-Baden/"]) {
    for (let index = 0; index < files.length; index += 1) {
      const properties = new Map();
      let randomCalls = 0;
      vm.runInNewContext(source, {
        URL, window: { matchMedia: () => ({ matches: false }) },
        Math: { floor: Math.floor, random() { randomCalls++; return (index + 0.5) / files.length; } },
        document: {
          currentScript: { src: `${base}assets/js/login-background.js?v=test` },
          documentElement: { style: { setProperty: (name, value) => properties.set(name, value) } },
        },
      });
      assert.equal(randomCalls, 1);
      assert.ok(properties.get("--login-background-image").startsWith(`url("${base}assets/img/${files[index]}`));
      assert.ok(Number(properties.get("--login-background-ratio")) > 1.4);
      assert.ok(fs.existsSync(path.join(root, "assets/img", files[index])));
    }
  }
});

test("mobile login selects a smaller photograph without changing its aspect ratio", () => {
  for (const small of [false, true]) {
    const properties = new Map();
    vm.runInNewContext(source, { URL, Math: { floor: Math.floor, random: () => 0 },
      window: { matchMedia: () => ({ matches: small }) },
      document: { currentScript: { src: "https://example.test/repo/assets/js/login-background.js" },
        documentElement: { style: { setProperty: (name, value) => properties.set(name, value) } } } });
    assert.match(properties.get("--login-background-image"), small ? /auth-pool-small\.webp/ : /auth-pool\.webp/);
    assert.equal(Number(properties.get("--login-background-ratio")), 2048 / 1365);
  }
});
