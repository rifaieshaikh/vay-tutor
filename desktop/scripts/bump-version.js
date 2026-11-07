#!/usr/bin/env node
/**
 * Bump the shared desktop semver and sync client + host package.json.
 *
 *   node desktop/scripts/bump-version.js --major   # 1.2.3 → 2.0.0  (breaking / major release)
 *   node desktop/scripts/bump-version.js --minor   # 1.2.3 → 1.3.0  (new features)
 *   node desktop/scripts/bump-version.js --patch   # 1.2.3 → 1.2.4  (bug fixes)
 *   node desktop/scripts/bump-version.js --set 1.4.0
 *   node desktop/scripts/bump-version.js --sync    # copy client version onto host
 */
const fs = require("node:fs");
const path = require("node:path");

const desktop = path.resolve(__dirname, "..");
const clientPath = path.join(desktop, "package.json");
const hostPath = path.join(desktop, "host", "package.json");

function readPackage(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writePackage(filePath, pkg) {
  if (pkg.build && "buildVersion" in pkg.build) delete pkg.build.buildVersion;
  fs.writeFileSync(filePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

function parseVersion(value) {
  const parts = String(value).split(".").map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    throw new Error(`Invalid version ${value}. Use major.minor.patch.`);
  }
  return parts;
}

function formatVersion([major, minor, patch]) {
  return `${major}.${minor}.${patch}`;
}

function bump(parts, kind) {
  if (kind === "major") return [parts[0] + 1, 0, 0];
  if (kind === "minor") return [parts[0], parts[1] + 1, 0];
  if (kind === "patch") return [parts[0], parts[1], parts[2] + 1];
  throw new Error(`Unknown bump ${kind}.`);
}

const args = process.argv.slice(2);
const client = readPackage(clientPath);
const host = readPackage(hostPath);
let next = client.version;

if (args.includes("--sync")) {
  next = client.version;
} else if (args.includes("--set")) {
  const index = args.indexOf("--set");
  next = args[index + 1];
  if (!next) throw new Error("Usage: bump-version.js --set 1.2.3");
} else if (args.includes("--major")) {
  next = formatVersion(bump(parseVersion(client.version), "major"));
} else if (args.includes("--minor")) {
  next = formatVersion(bump(parseVersion(client.version), "minor"));
} else if (args.includes("--patch")) {
  next = formatVersion(bump(parseVersion(client.version), "patch"));
} else {
  console.error("Usage: bump-version.js --major | --minor | --patch | --set x.y.z | --sync");
  process.exit(2);
}

parseVersion(next);
client.version = next;
host.version = next;
writePackage(clientPath, client);
writePackage(hostPath, host);
console.log(`Desktop version is ${next}.`);
