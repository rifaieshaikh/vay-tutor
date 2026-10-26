const { app, BrowserWindow, session, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { claimSupervisor, dataDirectory, startHost, stopHost, whenReady } = require("./supervisor");

const supervisorOnly = process.argv.includes("--supervisor");
const stopping = process.argv.includes("--stop");

function resourceRoot() {
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, "..", "resources");
}

function hostPaths() {
  const root = resourceRoot();
  const exe = process.platform === "win32" ? ".exe" : "";
  return {
    dataDir: dataDirectory(),
    mongoBin: path.join(root, "mongo", `mongod${exe}`),
    pythonBin: path.join(root, "python", process.platform === "win32" ? "python.exe" : "python"),
    backendDir: path.join(root, "backend"),
    frontendDir: path.join(root, "frontend"),
  };
}

function loadingPage(message) {
  const text = String(message).replace(/[&<>]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character]);
  return `data:text/html,<!doctype html><title>Vay Tutor</title><body style="font-family:sans-serif;padding:2rem;background:%23f7f4ee;color:%231c2430"><h1>Vay Tutor</h1><p>${text}</p></body>`;
}

function trustLocalCertificate() {
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    const local = request.hostname === "127.0.0.1" || request.hostname === "localhost";
    callback(local ? 0 : -3);
  });
}

function launchSupervisor() {
  const args = process.defaultApp ? [process.argv[1], "--supervisor"] : ["--supervisor"];
  if (process.platform === "win32") {
    const script = path.join(process.resourcesPath, "start-supervisor.cmd");
    const child = spawn("cmd.exe", ["/d", "/c", "start", "Vay Tutor", "/b", script], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return;
  }
  const child = spawn(process.execPath, args, { detached: true, stdio: "ignore" });
  child.unref();
}

app.whenReady().then(async () => {
  const paths = hostPaths();
  if (stopping) {
    stopHost(paths.dataDir);
    app.quit();
    return;
  }
  if (!supervisorOnly) {
    const window = new BrowserWindow({
      width: 1280,
      height: 800,
      show: true,
      backgroundColor: "#f7f4ee",
      title: "Vay Tutor",
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    await window.loadURL(loadingPage("Starting MongoDB, the API, and the institute…"));
    try {
      launchSupervisor();
      const started = await whenReady(paths.dataDir);
      trustLocalCertificate();
      window.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith(started.origin)) return { action: "allow" };
        shell.openExternal(url);
        return { action: "deny" };
      });
      await window.loadURL(started.origin);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await window.loadURL(loadingPage(message));
    }
    return;
  }
  if (!claimSupervisor(paths.dataDir)) {
    app.quit();
    return;
  }
  try {
    await startHost(paths);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fs.appendFileSync(path.join(paths.dataDir, "logs", "host.log"), `${message}\n`);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (!supervisorOnly) app.quit();
});
