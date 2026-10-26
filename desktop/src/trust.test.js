const assert = require("node:assert/strict");
const test = require("node:test");
const { certificateDecision, hostHostname } = require("./trust");

test("the entered host is trusted without a system certificate", () => {
  assert.equal(hostHostname("https://192.168.1.37:8443/"), "192.168.1.37");
  assert.equal(certificateDecision("192.168.1.37", "192.168.1.37"), 0);
  assert.equal(certificateDecision("HOST.local", "host.local"), 0);
});

test("any other computer keeps the system certificate check", () => {
  assert.equal(certificateDecision("192.168.1.38", "192.168.1.37"), -3);
  assert.equal(certificateDecision("192.168.1.37", ""), -3);
});
