const assert = require("node:assert/strict");
const test = require("node:test");
const {
  requireHost,
  readiness,
  compatibility,
  describeTransportError,
  checkHost,
} = require("./host");

function json(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

test("host must be https", () => {
  assert.throws(() => requireHost("http://host:8443"), /https:\/\//);
  assert.equal(requireHost("https://host:8443/"), "https://host:8443");
});

test("ready host can still be unbootstrapped", () => {
  readiness({
    api: "ok",
    database: "ok",
    worker: "standby",
    disk: "ok",
    bootstrapped: false,
  });
});

test("down database is not a successful connection", () => {
  assert.throws(
    () => readiness({ api: "ok", database: "down", disk: "ok" }),
    /database is down/,
  );
});

test("incompatible client uses the server message", () => {
  assert.throws(
    () => compatibility({ status: "upgrade_required", message: "Install a compatible version." }),
    /Install a compatible version\./,
  );
});

test("a failed connection names the host", () => {
  const message = describeTransportError("connection refused");
  assert.match(message, /Cannot reach the host/);
});

test("check sends the client version and accepts a standby worker", async () => {
  const seen = [];
  await checkHost(
    "https://host:8443",
    async (url, options) => {
      seen.push({ url, headers: options.headers });
      if (url.endsWith("/health")) {
        return json({ api: "ok", database: "ok", worker: "standby", disk: "ok", bootstrapped: false });
      }
      return json({ status: "compatible", message: "This client can use this server." });
    },
    "0.2.0",
  );
  assert.equal(seen[0].headers["X-Client-Version"], "1.0.0");
  assert.equal(seen[0].headers["User-Agent"], "VayTutorClient/0.2.0");
  assert.equal(seen[1].url, "https://host:8443/api/v1/compatibility?client=1.0.0");
});

test("check reports a certificate failure from the connection", async () => {
  await assert.rejects(
    () =>
      checkHost("https://host:8443", async () => {
        throw new Error("ERR_CERT_AUTHORITY_INVALID");
      }, "0.2.0"),
    /Cannot reach the host/,
  );
});

test("check rejects a non-json host", async () => {
  await assert.rejects(
    () =>
      checkHost("https://host:8443", async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("not json");
        },
      }), "0.2.0"),
    /did not return a Vay Tutor status/,
  );
});
