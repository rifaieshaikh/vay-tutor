const { spawn } = require("node:child_process");
const fs = require("node:fs");
const https = require("node:https");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const API_PORT = 8443;
const MONGO_PORT = 27017;

function dataDirectory() {
  if (process.platform === "win32" && process.env.ProgramData) {
    return path.join(process.env.ProgramData, "Vay Tutor");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Vay Tutor");
  }
  return path.join(os.homedir(), ".local", "share", "vay-tutor");
}

function certificateNames() {
  const names = [
    { type: 2, value: "localhost" },
    { type: 7, ip: "127.0.0.1" },
  ];
  const host = os.hostname();
  if (host) names.push({ type: 2, value: host });
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) names.push({ type: 7, ip: entry.address });
    }
  }
  return names;
}

function mongoArguments(dataDir) {
  return [
    "--dbpath", path.join(dataDir, "db"),
    "--bind_ip", "127.0.0.1",
    "--port", String(MONGO_PORT),
    "--replSet", "rs0",
    "--logpath", path.join(dataDir, "logs", "mongo.log"),
    "--logappend",
  ];
}

function serviceEnvironment(paths, port) {
  return {
    ...process.env,
    MONGO_URL: `mongodb://127.0.0.1:${MONGO_PORT}/?replicaSet=rs0`,
    DB_NAME: "vay_tutor",
    DATA_DIR: paths.dataDir,
    STATIC_DIR: paths.frontendDir,
    DEPLOYMENT_MODE: "local",
    COOKIE_SECURE: "1",
    WORKER_ENABLED: "1",
    PYTHONPATH: paths.backendDir,
    PYTHONNOUSERSITE: "1",
    VAY_PORT: String(port),
  };
}

function apiArguments(paths, port) {
  return [
    "-m",
    "uvicorn",
    "app.main:app",
    "--host",
    "0.0.0.0",
    "--port",
    String(port),
    "--app-dir",
    paths.backendDir,
    "--ssl-certfile",
    path.join(paths.dataDir, "cert.pem"),
    "--ssl-keyfile",
    path.join(paths.dataDir, "key.pem"),
  ];
}

function portOpen(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const finish = (open) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function waitForPort(port, attempts = 120) {
  return new Promise((resolve, reject) => {
    let left = attempts;
    const tick = () => {
      portOpen(port).then((open) => {
        if (open) resolve();
        else if (left === 0) reject(new Error(`Nothing answered on port ${port}.`));
        else {
          left -= 1;
          setTimeout(tick, 250);
        }
      });
    };
    tick();
  });
}

function ensureLayout(dataDir) {
  for (const name of ["db", "logs", "files"]) fs.mkdirSync(path.join(dataDir, name), { recursive: true });
}

function ensureCertificate(dataDir) {
  const certPath = path.join(dataDir, "cert.pem");
  const keyPath = path.join(dataDir, "key.pem");
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) return { certPath, keyPath };
  const selfsigned = require("selfsigned");
  const generated = selfsigned.generate([{ name: "commonName", value: "Vay Tutor" }], {
    algorithm: "sha256",
    keySize: 2048,
    days: 825,
    extensions: [
      { name: "basicConstraints", cA: true },
      { name: "keyUsage", keyCertSign: true, digitalSignature: true, keyEncipherment: true },
      { name: "extKeyUsage", serverAuth: true },
      { name: "subjectAltName", altNames: certificateNames() },
    ],
  });
  fs.writeFileSync(certPath, generated.cert);
  fs.writeFileSync(keyPath, generated.private);
  fs.writeFileSync(path.join(dataDir, "vay-tutor.cer"), generated.cert);
  return { certPath, keyPath };
}

function spawnLogged(command, args, env, logPath) {
  const output = fs.openSync(logPath, "a");
  const child = spawn(command, args, {
    detached: true,
    windowsHide: true,
    stdio: ["ignore", output, output],
    env,
  });
  fs.closeSync(output);
  child.unref();
  return child.pid;
}

function rememberPid(dataDir, name, pid) {
  fs.writeFileSync(path.join(dataDir, `${name}.pid`), String(pid));
}

function readPid(dataDir, name) {
  const file = path.join(dataDir, `${name}.pid`);
  if (!fs.existsSync(file)) return null;
  const pid = Number(fs.readFileSync(file, "utf8"));
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function stopPid(pid) {
  if (!pid) return;
  try {
    process.kill(pid);
  } catch {
    // The process has already exited.
  }
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function claimSupervisor(dataDir) {
  ensureLayout(dataDir);
  const current = readPid(dataDir, "supervisor");
  if (current && current !== process.pid && processAlive(current)) return false;
  rememberPid(dataDir, "supervisor", process.pid);
  return true;
}

function stopHost(dataDir) {
  stopPid(readPid(dataDir, "api"));
  stopPid(readPid(dataDir, "mongo"));
  const supervisor = readPid(dataDir, "supervisor");
  if (supervisor && supervisor !== process.pid) stopPid(supervisor);
}

function trustCertificate(certPath) {
  if (process.platform !== "win32") return;
  spawn("certutil", ["-addstore", "-user", "Root", certPath], { windowsHide: true, stdio: "ignore" }).unref();
}

function health(port) {
  return new Promise((resolve) => {
    const request = https.get(`https://127.0.0.1:${port}/api/v1/health`, { rejectUnauthorized: false }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on("error", () => resolve(false));
    request.setTimeout(2000, () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function startHost(paths) {
  ensureLayout(paths.dataDir);
  const { certPath } = ensureCertificate(paths.dataDir);
  trustCertificate(certPath);
  const mongoUp = await portOpen(MONGO_PORT);
  if (!mongoUp) {
    const pid = spawnLogged(
      paths.mongoBin,
      mongoArguments(paths.dataDir),
      process.env,
      path.join(paths.dataDir, "logs", "host.log"),
    );
    rememberPid(paths.dataDir, "mongo", pid);
    await waitForPort(MONGO_PORT);
  }
  await runReplicaInit(paths, !mongoUp);
  let port = API_PORT;
  if (!(await health(port))) {
    if (await portOpen(port)) port = await nextPort(port + 1);
    const pid = spawnLogged(
      paths.pythonBin,
      apiArguments(paths, port),
      serviceEnvironment(paths, port),
      path.join(paths.dataDir, "logs", "api.log"),
    );
    rememberPid(paths.dataDir, "api", pid);
    await waitUntilHealthy(port);
  }
  const certificate = path.join(paths.dataDir, "vay-tutor.cer");
  fs.writeFileSync(path.join(paths.dataDir, "port.txt"), String(port));
  writeConnectNote(paths.dataDir, port, certificate);
  return { origin: `https://127.0.0.1:${port}`, port, certificate };
}

function writeConnectNote(dataDir, port, certificate) {
  const lines = [`This computer: https://127.0.0.1:${port}`];
  for (const name of certificateNames()) {
    if (name.ip && name.ip !== "127.0.0.1") lines.push(`Other computers: https://${name.ip}:${port}`);
  }
  lines.push(`Certificate for other computers: ${certificate}`);
  lines.push("MongoDB listens on this computer only.");
  fs.writeFileSync(path.join(dataDir, "connect.txt"), `${lines.join("\r\n")}\r\n`);
}

async function whenReady(dataDir) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const note = path.join(dataDir, "port.txt");
    if (fs.existsSync(note)) {
      const port = Number(fs.readFileSync(note, "utf8"));
      if (port && (await health(port))) {
        return {
          origin: `https://127.0.0.1:${port}`,
          port,
          certificate: path.join(dataDir, "vay-tutor.cer"),
        };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("The institute did not become ready. See the log in the Vay Tutor data folder.");
}

function runReplicaInit(paths, initiate) {
  return new Promise((resolve, reject) => {
    const child = spawn(paths.pythonBin, ["-c", REPLICA_INIT, initiate ? "initiate" : "reuse"], {
      env: serviceEnvironment(paths, API_PORT),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let error = "";
    child.stderr.on("data", (chunk) => {
      error += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(error.trim() || "MongoDB did not become a replica set."));
    });
  });
}

async function nextPort(start) {
  for (let port = start; port < start + 20; port += 1) {
    if (!(await portOpen(port))) return port;
  }
  throw new Error("No free port is available for the institute.");
}

async function waitUntilHealthy(port) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await health(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("The institute did not become ready. See the log in the Vay Tutor data folder.");
}

const REPLICA_INIT = `
import sys
from pymongo import MongoClient
from pymongo.errors import OperationFailure
initiate = sys.argv[1] == "initiate"
client = MongoClient("mongodb://127.0.0.1:27017/?directConnection=true", serverSelectionTimeoutMS=8000)
try:
    status = client.admin.command("replSetGetStatus")
except OperationFailure:
    if not initiate:
        raise SystemExit("MongoDB is already running on port 27017. Stop it so Vay Tutor can use its own database.")
    client.admin.command("replSetInitiate", {"_id": "rs0", "members": [{"_id": 0, "host": "127.0.0.1:27017"}]})
else:
    if status.get("set") != "rs0":
        raise SystemExit("MongoDB on port 27017 belongs to a different replica set.")
`;

module.exports = {
  API_PORT,
  MONGO_PORT,
  apiArguments,
  certificateNames,
  claimSupervisor,
  dataDirectory,
  mongoArguments,
  serviceEnvironment,
  startHost,
  stopHost,
  whenReady,
};
