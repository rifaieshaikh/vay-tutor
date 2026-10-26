const assert = require("node:assert/strict");
const test = require("node:test");
const { MAX_TABS, createTabs } = require("./tabs");

test("new tabs become active and the last tab stays open", () => {
  const tabs = createTabs();
  const first = tabs.open("https://host:8443/");
  const second = tabs.open("https://host:8443/students");
  assert.equal(tabs.activeId, second.id);
  assert.equal(tabs.snapshot().filter((tab) => tab.active).length, 1);
  assert.equal(tabs.close(second.id), true);
  assert.equal(tabs.activeId, first.id);
  assert.equal(tabs.close(first.id), false);
  assert.equal(tabs.length, 1);
});

test("tabs cycle and stop at the maximum", () => {
  const tabs = createTabs();
  for (let index = 0; index < MAX_TABS; index += 1) tabs.open("https://host:8443/");
  assert.equal(tabs.open("https://host:8443/"), null);
  const first = tabs.snapshot()[0].id;
  assert.equal(tabs.cycle(false), first);
  assert.equal(tabs.cycle(true), tabs.snapshot()[MAX_TABS - 1].id);
});

test("blank titles fall back to the product name", () => {
  const tabs = createTabs();
  const tab = tabs.open("https://host:8443/");
  tabs.rename(tab.id, "   ");
  assert.equal(tabs.snapshot()[0].title, "Vay Tutor");
  tabs.clear();
  assert.equal(tabs.length, 0);
});
