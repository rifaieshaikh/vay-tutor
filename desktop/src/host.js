const CLIENT_VERSION = require("../package.json").version;

function requireHost(value) {
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    throw new Error("Enter the full host address, starting with https://.");
  }
  if (url.protocol !== "https:") {
    throw new Error("The host address must start with https://.");
  }
  if (!url.hostname) {
    throw new Error("Enter the computer name or address of the Vay Tutor host.");
  }
  return url.origin;
}

function readiness(health) {
  const problems = [];
  for (const [field, label] of [
    ["api", "API"],
    ["database", "database"],
    ["disk", "disk"],
    ["worker", "worker"],
  ]) {
    const status = typeof health?.[field] === "string" ? health[field] : "unknown";
    if (field === "worker" && (status === "ok" || status === "standby")) continue;
    if (status !== "ok") problems.push(`${label} is ${status}`);
  }
  if (problems.length > 0) {
    throw new Error(`The host is not ready. ${problems.join(", ")}.`);
  }
}

function compatibility(body) {
  if (body?.status === "compatible") return;
  const message =
    typeof body?.message === "string" ? body.message : "This client cannot use this server.";
  throw new Error(message);
}

function describeTransportError(message) {
  return `Cannot reach the host. ${message}`;
}

function rejectionMessage(body) {
  if (body && typeof body === "object") {
    if (typeof body.error?.message === "string") return body.error.message;
    if (typeof body.message === "string") return body.message;
  }
  return "The host rejected the connection.";
}

async function fetchJson(fetchImpl, url, version) {
  const client = version || CLIENT_VERSION;
  let response;
  try {
    response = await fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "X-Client-Version": client,
        "User-Agent": `VayTutorClient/${client}`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(describeTransportError(message));
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("The host did not return a Vay Tutor status.");
  }
  if (response.ok) return body;
  throw new Error(rejectionMessage(body));
}

async function checkHost(origin, fetchImpl, version) {
  const client = version || CLIENT_VERSION;
  readiness(await fetchJson(fetchImpl, `${origin}/api/v1/health`, client));
  compatibility(
    await fetchJson(
      fetchImpl,
      `${origin}/api/v1/compatibility?client=${encodeURIComponent(client)}`,
      client,
    ),
  );
}

module.exports = {
  CLIENT_VERSION,
  requireHost,
  readiness,
  compatibility,
  describeTransportError,
  checkHost,
};
