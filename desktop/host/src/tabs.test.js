const assert = require("node:assert/strict");
const test = require("node:test");
const { MAX_TABS, createTabs } = require("./tabs");

test("new tabs become active and the last tab stays open", () => {
  const tabs = createTabs();
  const first = tabs.open("https://127.0.0.1:8443/");
  const second = tabs.open("https://127.0.0.1:8443/students");
  assert.equal(tabs.activeId, second.id);
  assert.equal(tabs.close(first.id), true);
  assert.equal(tabs.length, 1);
  assert.equal(tabs.close(second.id), false);
});

test("tabs cycle and stop at the maximum", () => {
  const tabs = createTabs();
  for (let index = 0; index < MAX_TABS; index += 1) tabs.open("https://127.0.0.1:8443/");
  assert.equal(tabs.open("https://127.0.0.1:8443/"), null);
  const before = tabs.activeId;
  tabs.cycle(false);
  assert.notEqual(tabs.activeId, before);
});
