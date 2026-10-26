const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { apiArguments, certificateNames, mongoArguments, serviceEnvironment } = require("./supervisor");

test("MongoDB stays on localhost as one replica-set member", () => {
  const args = mongoArguments(path.join("data-root"));
  assert.deepEqual(args.slice(0, 8), [
    "--dbpath", path.join("data-root", "db"),
    "--bind_ip", "127.0.0.1",
    "--port", "27017",
    "--replSet", "rs0",
  ]);
});

test("the API serves the frontend over HTTPS and does not publish MongoDB", () => {
  const paths = { dataDir: "/data", frontendDir: "/frontend", backendDir: "/backend" };
  const env = serviceEnvironment(paths, 8443);
  assert.equal(env.STATIC_DIR, "/frontend");
  assert.equal(env.COOKIE_SECURE, "1");
  assert.equal(env.MONGO_URL, "mongodb://127.0.0.1:27017/?replicaSet=rs0");
  assert.equal(env.MONGO_URL.includes("0.0.0.0"), false);
  const args = apiArguments(paths, 8443);
  assert.equal(args[args.indexOf("--host") + 1], "0.0.0.0");
  assert.equal(args[args.indexOf("--port") + 1], "8443");
  assert.equal(args.includes("--ssl-certfile"), true);
});

test("the host certificate names this computer and localhost", () => {
  const names = certificateNames();
  assert.equal(names.some((item) => item.value === "localhost"), true);
  assert.equal(names.some((item) => item.ip === "127.0.0.1"), true);
});
