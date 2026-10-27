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

function supervisorProfileDirectory() {
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "Vay Tutor Supervisor");
  }
  return path.join(dataDirectory(), "supervisor-profile");
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

function mongoArguments(dataDir, port = MONGO_PORT) {
  return [
    "--dbpath", path.join(dataDir, "db"),
    "--bind_ip", "127.0.0.1",
    "--port", String(port),
    "--logpath", path.join(dataDir, "logs", "mongo.log"),
    "--logappend",
  ];
}

function mongoUrl(port) {
  return `mongodb://127.0.0.1:${port}/?directConnection=true`;
}

function withBinaryPath(bin, env) {
  const directory = path.dirname(bin);
  const separator = process.platform === "win32" ? ";" : ":";
  const current = env.PATH || env.Path || "";
  return { ...env, PATH: `${directory}${separator}${current}` };
}

function pythonHome(pythonBin) {
  const directory = path.dirname(pythonBin);
  if (path.basename(directory) === "bin") {
    const root = path.dirname(directory);
    if (fs.existsSync(path.join(root, "lib"))) return root;
  }
  return directory;
}

function serviceEnvironment(paths, port, mongoPort = MONGO_PORT) {
  return withBinaryPath(paths.pythonBin, {
    ...process.env,
    MONGO_URL: mongoUrl(mongoPort),
    DB_NAME: "vay_tutor",
    DATA_DIR: paths.dataDir,
    STATIC_DIR: paths.frontendDir,
    DEPLOYMENT_MODE: "local",
    COOKIE_SECURE: "1",
    WORKER_ENABLED: "1",
    PYTHONPATH: paths.backendDir,
    PYTHONNOUSERSITE: "1",
    PYTHONHOME: pythonHome(paths.pythonBin),
    VAY_PORT: String(port),
    VAY_MONGO_PORT: String(mongoPort),
  });
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

function waitForPort(port, attempts = 80) {
  return new Promise((resolve, reject) => {
    let left = attempts;
    const tick = () => {
      portOpen(port).then((open) => {
        if (open) resolve();
        else if (left === 0) reject(new Error(`Nothing answered on port ${port}.`));
        else {
          left -= 1;
          setTimeout(tick, 100);
        }
      });
    };
    tick();
  });
}

function ensureLayout(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  for (const name of ["db", "logs", "files"]) fs.mkdirSync(path.join(dataDir, name), { recursive: true });
}

function appendLog(dataDir, message) {
  try {
    ensureLayout(dataDir);
    fs.appendFileSync(path.join(dataDir, "logs", "host.log"), `${new Date().toISOString()} ${message}\n`);
  } catch {
    // The data folder may still be locked; the window will show what it can.
  }
}

function readLogTail(dataDir, limit = 12) {
  const files = ["host.log", "api.log", "mongo.log"].map((name) => path.join(dataDir, "logs", name));
  for (const file of files) {
    try {
      if (!fs.existsSync(file)) continue;
      const lines = fs.readFileSync(file, "utf8").trim().split(/\r?\n/).filter(Boolean);
      if (lines.length === 0) continue;
      return lines.slice(-limit).join("\n");
    } catch {
      // Try the next log.
    }
  }
  return "";
}

function readinessError(dataDir, reason) {
  const tail = readLogTail(dataDir);
  if (tail) return new Error(`${reason}\n\n${tail}`);
  return new Error(`${reason}\n\nNo log was written yet. Check that this account can write to ${dataDir}.`);
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

function spawnLogged(command, args, env, logPath, cwd) {
  const output = fs.openSync(logPath, "a");
  const child = spawn(command, args, {
    detached: true,
    windowsHide: true,
    stdio: ["ignore", output, output],
    env,
    cwd,
  });
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

function clearPid(dataDir, name) {
  const file = path.join(dataDir, `${name}.pid`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
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
  removeLoginAgent(dataDir);
}

function trustCertificate(certPath) {
  if (process.platform === "win32") {
    spawn("certutil", ["-addstore", "-user", "Root", certPath], { windowsHide: true, stdio: "ignore" }).unref();
    return;
  }
  if (process.platform === "darwin") {
    const keychain = path.join(os.homedir(), "Library", "Keychains", "login.keychain-db");
    const child = spawn(
      "security",
      ["add-trusted-cert", "-d", "-r", "trustRoot", "-k", keychain, certPath],
      { stdio: "ignore" },
    );
    child.on("error", (error) => {
      appendLog(path.dirname(certPath), `Certificate trust skipped: ${error.message}`);
    });
    child.on("exit", (code) => {
      if (code && code !== 0) {
        appendLog(path.dirname(certPath), `Certificate trust exited with code ${code}.`);
      }
    });
    child.unref();
  }
}

const LAUNCH_AGENT_LABEL = "com.vaytutor.host";

function launchAgentPlistPath() {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`);
}

function packagedMacExecutable() {
  const marker = `${path.sep}Contents${path.sep}MacOS${path.sep}`;
  if (!process.execPath.includes(marker)) return null;
  return process.execPath;
}

function installLoginAgent(dataDir) {
  if (process.platform !== "darwin") return;
  const executable = packagedMacExecutable();
  if (!executable) return;
  const plistPath = launchAgentPlistPath();
  const body = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
    `<plist version="1.0">`,
    `<dict>`,
    `  <key>Label</key>`,
    `  <string>${LAUNCH_AGENT_LABEL}</string>`,
    `  <key>ProgramArguments</key>`,
    `  <array>`,
    `    <string>${executable}</string>`,
    `    <string>--supervisor</string>`,
    `  </array>`,
    `  <key>RunAtLoad</key>`,
    `  <true/>`,
    `  <key>KeepAlive</key>`,
    `  <false/>`,
    `</dict>`,
    `</plist>`,
    ``,
  ].join("\n");
  fs.mkdirSync(path.dirname(plistPath), { recursive: true });
  const previous = fs.existsSync(plistPath) ? fs.readFileSync(plistPath, "utf8") : "";
  if (previous !== body) fs.writeFileSync(plistPath, body);
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid == null) return;
  const domain = `gui/${uid}`;
  spawn("launchctl", ["bootout", domain, plistPath], { stdio: "ignore" }).on("close", () => {
    spawn("launchctl", ["bootstrap", domain, plistPath], { stdio: "ignore" }).on("error", (error) => {
      appendLog(dataDir, `LaunchAgent bootstrap skipped: ${error.message}`);
    });
  });
  appendLog(dataDir, `Login agent registered at ${plistPath}.`);
}

function removeLoginAgent(dataDir) {
  if (process.platform !== "darwin") return;
  const plistPath = launchAgentPlistPath();
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid != null && fs.existsSync(plistPath)) {
    try {
      spawn("launchctl", ["bootout", `gui/${uid}`, plistPath], { stdio: "ignore" }).unref();
    } catch {
      // Best-effort unload.
    }
  }
  try {
    fs.unlinkSync(plistPath);
    if (dataDir) appendLog(dataDir, `Login agent removed from ${plistPath}.`);
  } catch {
    // Already absent.
  }
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

function rememberMongoPort(dataDir, port) {
  fs.writeFileSync(path.join(dataDir, "mongo-port.txt"), String(port));
}

async function startPackagedMongo(paths, port) {
  if (!fs.existsSync(paths.mongoBin)) {
    throw new Error(
      "MongoDB is not running on 127.0.0.1:27017, and the packaged MongoDB is missing. Start MongoDB or reinstall Vay Tutor.",
    );
  }
  appendLog(paths.dataDir, `Starting the packaged MongoDB on 127.0.0.1:${port}.`);
  const pid = spawnLogged(
    paths.mongoBin,
    mongoArguments(paths.dataDir, port),
    withBinaryPath(paths.mongoBin, process.env),
    path.join(paths.dataDir, "logs", "mongo.log"),
    path.dirname(paths.mongoBin),
  );
  rememberPid(paths.dataDir, "mongo", pid);
  await waitForPort(port);
  rememberMongoPort(paths.dataDir, port);
  return { owned: true, port };
}

async function ensureMongo(paths) {
  if (await portOpen(MONGO_PORT)) {
    appendLog(paths.dataDir, "Using the MongoDB already running on 127.0.0.1:27017.");
    clearPid(paths.dataDir, "mongo");
    rememberMongoPort(paths.dataDir, MONGO_PORT);
    return { owned: false, port: MONGO_PORT };
  }
  return startPackagedMongo(paths, MONGO_PORT);
}

async function startHost(paths) {
  ensureLayout(paths.dataDir);
  appendLog(paths.dataDir, "Starting the institute.");
  appendLog(paths.dataDir, `Python binary: ${paths.pythonBin}`);
  appendLog(paths.dataDir, `Backend: ${paths.backendDir}`);
  appendLog(paths.dataDir, `Frontend: ${paths.frontendDir}`);
  for (const file of [paths.pythonBin, path.join(paths.backendDir, "app", "main.py"), path.join(paths.frontendDir, "index.html")]) {
    if (!fs.existsSync(file)) throw new Error(`Missing packaged file: ${file}`);
  }
  const { certPath } = ensureCertificate(paths.dataDir);
  trustCertificate(certPath);
  const mongo = await ensureMongo(paths);
  let port = API_PORT;
  if (!(await health(port))) {
    if (await portOpen(port)) port = await nextPort(port + 1);
    appendLog(paths.dataDir, `Starting the API on port ${port}.`);
    const pid = spawnLogged(
      paths.pythonBin,
      apiArguments(paths, port),
      serviceEnvironment(paths, port, mongo.port),
      path.join(paths.dataDir, "logs", "api.log"),
      path.dirname(paths.pythonBin),
    );
    rememberPid(paths.dataDir, "api", pid);
    await waitUntilHealthy(paths.dataDir, port);
  } else {
    appendLog(paths.dataDir, `The API is already healthy on port ${port}.`);
  }
  const certificate = path.join(paths.dataDir, "vay-tutor.cer");
  fs.writeFileSync(path.join(paths.dataDir, "port.txt"), String(port));
  writeConnectNote(paths.dataDir, port, certificate, mongo);
  appendLog(paths.dataDir, `Ready at https://127.0.0.1:${port}`);
  installLoginAgent(paths.dataDir);
  return { origin: `https://127.0.0.1:${port}`, port, certificate, mongoOwned: mongo.owned, mongoPort: mongo.port };
}

function writeConnectNote(dataDir, port, certificate, mongo) {
  const lines = [`This computer: https://127.0.0.1:${port}`];
  for (const name of certificateNames()) {
    if (name.ip && name.ip !== "127.0.0.1") lines.push(`Other computers: https://${name.ip}:${port}`);
  }
  lines.push(`Certificate for phones and tablets: ${certificate}`);
  if (mongo.owned) {
    lines.push(`MongoDB was started by Vay Tutor on 127.0.0.1:${mongo.port}.`);
  } else {
    lines.push(`MongoDB was already running on 127.0.0.1:${mongo.port}; Vay Tutor is using that instance.`);
  }
  fs.writeFileSync(path.join(dataDir, "connect.txt"), `${lines.join("\r\n")}\r\n`);
}

async function whenReady(dataDir, attempts = 120, delayMs = 250) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
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
    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw readinessError(dataDir, "The institute did not become ready.");
}

async function nextPort(start) {
  for (let port = start; port < start + 20; port += 1) {
    if (!(await portOpen(port))) return port;
  }
  throw new Error("No free port is available for the institute.");
}

async function waitUntilHealthy(dataDir, port) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await health(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw readinessError(dataDir, `The API on port ${port} did not become ready.`);
}

module.exports = {
  API_PORT,
  MONGO_PORT,
  apiArguments,
  certificateNames,
  claimSupervisor,
  dataDirectory,
  ensureMongo,
  installLoginAgent,
  mongoArguments,
  mongoUrl,
  pythonHome,
  readinessError,
  removeLoginAgent,
  serviceEnvironment,
  startHost,
  stopHost,
  supervisorProfileDirectory,
  whenReady,
};
