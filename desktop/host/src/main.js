const { app, BaseWindow, BrowserWindow, Menu, WebContentsView, dialog, ipcMain, session, shell } = require("electron");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  claimSupervisor,
  dataDirectory,
  mongoUrl,
  readinessError,
  startHost,
  stopApi,
  stopHost,
  supervisorProfileDirectory,
  whenReady,
} = require("./supervisor");
const { createTabs } = require("./tabs");

const supervisorOnly = process.argv.includes("--supervisor");
const stopping = process.argv.includes("--stop");
const TAB_HEIGHT = 44;

if (supervisorOnly || stopping) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
  app.setPath("userData", supervisorProfileDirectory());
}

let windowRef = null;
let chromeView = null;
let statusView = null;
let hostOrigin = null;
let ready = false;
const tabs = createTabs();
const views = new Map();
const extraWindows = new Set();
let shortcutAt = 0;

function resourceRoot() {
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, "..", "resources");
}

function hostPaths() {
  const root = resourceRoot();
  const exe = process.platform === "win32" ? ".exe" : "";
  const mongoDir = path.join(root, "mongo");
  return {
    dataDir: dataDirectory(),
    mongoBin: path.join(mongoDir, `mongod${exe}`),
    mongoToolsDir: mongoDir,
    pythonBin: path.join(root, "python", process.platform === "win32" ? "python.exe" : "python"),
    backendDir: path.join(root, "backend"),
    frontendDir: path.join(root, "frontend"),
  };
}

function mongoPortFromData(dataDir) {
  const note = path.join(dataDir, "mongo-port.txt");
  if (!fs.existsSync(note)) return 27017;
  const port = Number(fs.readFileSync(note, "utf8"));
  return port || 27017;
}

function writePassphraseFile(passphrase) {
  const file = path.join(os.tmpdir(), `vay-backup-key-${process.pid}-${Date.now()}.txt`);
  fs.writeFileSync(file, passphrase, { encoding: "utf8", mode: 0o600 });
  return file;
}

function runBackupCli(paths, action, passphrase, filePath) {
  const passphraseFile = writePassphraseFile(passphrase);
  const args = [
    "-c",
    "from app.ops_backup import cli; raise SystemExit(cli())",
    action,
    "--data-dir",
    paths.dataDir,
    "--passphrase-file",
    passphraseFile,
  ];
  if (action === "create" && filePath) args.push("--destination", filePath);
  if (action === "restore" && filePath) args.push("--archive", filePath);
  try {
    const result = spawnSync(paths.pythonBin, args, {
      cwd: path.dirname(paths.pythonBin),
      env: {
        ...process.env,
        PYTHONPATH: paths.backendDir,
        PYTHONNOUSERSITE: "1",
        DATA_DIR: paths.dataDir,
        MONGO_URL: mongoUrl(mongoPortFromData(paths.dataDir)),
        DB_NAME: "vay_tutor",
        MONGO_TOOLS_DIR: paths.mongoToolsDir,
      },
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.status === 0) {
      try {
        return JSON.parse(result.stdout || "{}");
      } catch {
        return { ok: true };
      }
    }
    let message = "The backup operation failed.";
    try {
      const body = JSON.parse(result.stderr || "{}");
      if (body.error?.message) message = body.error.message;
    } catch {
      if (result.stderr) message = result.stderr.trim();
      else if (result.error) message = result.error.message;
    }
    throw new Error(message);
  } finally {
    try {
      fs.unlinkSync(passphraseFile);
    } catch {
      // Ignore cleanup failures.
    }
  }
}

function askPrompt(mode) {
  return new Promise((resolve) => {
    const child = new BrowserWindow({
      width: 420,
      height: mode === "backup" ? 360 : 340,
      parent: windowRef || undefined,
      modal: Boolean(windowRef),
      resizable: false,
      minimizable: false,
      maximizable: false,
      title: "Vay Tutor",
      backgroundColor: "#f7f4ee",
      webPreferences: {
        preload: path.join(__dirname, "prompt-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener("prompt-submit", onSubmit);
      if (!child.isDestroyed()) child.close();
      resolve(value);
    };
    const onSubmit = (event, payload) => {
      if (event.sender !== child.webContents) return;
      finish(payload || null);
    };
    ipcMain.on("prompt-submit", onSubmit);
    child.on("closed", () => finish(null));
    child.setMenu(null);
    child.loadFile(path.join(__dirname, "../ui/prompt.html"), { query: { mode } });
  });
}

async function runBackupNow() {
  const paths = hostPaths();
  const answers = await askPrompt("backup");
  if (!answers?.passphrase) return;
  const stamp = new Date().toISOString().slice(0, 10);
  const chosen = await dialog.showSaveDialog(windowRef || undefined, {
    title: "Save backup",
    defaultPath: path.join(app.getPath("documents"), `vay-tutor-backup-${stamp}.zip`),
    filters: [{ name: "Vay Tutor backup", extensions: ["zip"] }],
  });
  if (chosen.canceled || !chosen.filePath) return;
  let target = chosen.filePath;
  if (!target.toLowerCase().endsWith(".zip")) target = `${target}.zip`;
  try {
    const result = runBackupCli(paths, "create", answers.passphrase, target);
    await dialog.showMessageBox(windowRef || undefined, {
      type: "info",
      title: "Backup complete",
      message: "The encrypted backup was saved.",
      detail: result.path || target,
    });
  } catch (error) {
    await dialog.showMessageBox(windowRef || undefined, {
      type: "error",
      title: "Backup failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function runRestoreNow() {
  const paths = hostPaths();
  const chosen = await dialog.showOpenDialog(windowRef || undefined, {
    title: "Restore from backup",
    defaultPath: app.getPath("documents"),
    properties: ["openFile"],
    filters: [{ name: "Vay Tutor backup", extensions: ["zip"] }],
  });
  if (chosen.canceled || !chosen.filePaths[0]) return;
  const answers = await askPrompt("restore");
  if (!answers?.passphrase || answers.confirm !== "RESTORE") return;
  const confirmed = await dialog.showMessageBox(windowRef || undefined, {
    type: "warning",
    title: "Replace all data?",
    message: "Restore replaces the entire institute, including users and passwords.",
    buttons: ["Cancel", "Restore"],
    defaultId: 0,
    cancelId: 0,
  });
  if (confirmed.response !== 1) return;
  try {
    stopApi(paths.dataDir);
    const result = runBackupCli(paths, "restore", answers.passphrase, chosen.filePaths[0]);
    const started = await startHost(paths);
    hostOrigin = started.origin;
    ready = true;
    if (windowRef) {
      for (const id of [...views.keys()]) closeTab(id);
      openTab(`${hostOrigin}/`);
    }
    await dialog.showMessageBox(windowRef || undefined, {
      type: "info",
      title: "Restore complete",
      message: "The institute was restored. Sign in with an account from the backup.",
      detail: result.counts ? `Users restored: ${result.counts.users ?? 0}` : undefined,
    });
  } catch (error) {
    try {
      await startHost(paths);
    } catch {
      // Surface the original restore error.
    }
    await dialog.showMessageBox(windowRef || undefined, {
      type: "error",
      title: "Restore failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function loadingPage(message) {
  const text = String(message)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
  return `data:text/html,<!doctype html><title>Vay Tutor</title><body style="font-family:sans-serif;padding:2rem;background:%23f7f4ee;color:%231c2430"><h1>Vay Tutor</h1><p style="white-space:pre-wrap;max-width:48rem">${text}</p></body>`;
}

function trustLocalCertificate() {
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    const local = request.hostname === "127.0.0.1" || request.hostname === "localhost";
    callback(local ? 0 : -3);
  });
}

function isHostUrl(value) {
  if (!hostOrigin) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === hostOrigin;
  } catch {
    return false;
  }
}

function oncePerShortcut(action) {
  const now = Date.now();
  if (now - shortcutAt < 200) return;
  shortcutAt = now;
  action();
}

function closeContents(view) {
  if (!view || view.webContents.isDestroyed()) return;
  view.webContents.close();
}

function layout() {
  if (!windowRef) return;
  const { width, height } = windowRef.getContentBounds();
  if (!ready) {
    if (chromeView) chromeView.setVisible(false);
    for (const view of views.values()) view.setVisible(false);
    if (statusView) {
      statusView.setVisible(true);
      statusView.setBounds({ x: 0, y: 0, width, height });
    }
    return;
  }
  if (statusView) statusView.setVisible(false);
  if (chromeView) {
    chromeView.setVisible(true);
    chromeView.setBounds({ x: 0, y: 0, width, height: TAB_HEIGHT });
  }
  for (const tab of tabs.snapshot()) {
    const view = views.get(tab.id);
    if (!view) continue;
    const active = tab.id === tabs.activeId;
    view.setVisible(active);
    view.setBounds({
      x: 0,
      y: TAB_HEIGHT,
      width,
      height: Math.max(0, height - TAB_HEIGHT),
    });
  }
}

function publishTabs() {
  if (chromeView && !chromeView.webContents.isDestroyed()) {
    chromeView.webContents.send("tabs-changed", tabs.snapshot());
  }
  const active = tabs.snapshot().find((tab) => tab.active);
  if (windowRef) windowRef.setTitle(active ? active.title : "Vay Tutor");
}

function reloadActive() {
  const view = views.get(tabs.activeId);
  if (view && !view.webContents.isDestroyed()) view.webContents.reload();
}

function bindPageMenu(contents, { refreshActive = false, menuWindow = null } = {}) {
  contents.on("context-menu", (_event, params) => {
    if (!ready || !hostOrigin) return;
    const refresh = () => {
      if (refreshActive) reloadActive();
      else if (!contents.isDestroyed()) contents.reload();
    };
    const link = params.linkURL && isHostUrl(params.linkURL) ? params.linkURL : "";
    const template = link
      ? [
          { label: "Open in New Tab", click: () => openTab(link) },
          { label: "Open in New Window", click: () => openWindow(link) },
          { type: "separator" },
          { label: "Refresh", click: refresh },
          { type: "separator" },
          { label: "Back up now", click: () => void runBackupNow() },
          { label: "Restore from backup…", click: () => void runRestoreNow() },
        ]
      : [
          { label: "Refresh", click: refresh },
          { label: "New Tab", click: () => openTab(`${hostOrigin}/`) },
          { type: "separator" },
          { label: "Back up now", click: () => void runBackupNow() },
          { label: "Restore from backup…", click: () => void runRestoreNow() },
        ];
    Menu.buildFromTemplate(template).popup({
      window: menuWindow || windowRef || undefined,
      x: params.x,
      y: params.y,
    });
  });
}

function bindShortcuts(contents, { reload = reloadActive, close = () => closeTab(tabs.activeId) } = {}) {
  contents.on("before-input-event", (event, input) => {
    if (!ready || input.type !== "keyDown") return;
    if (input.key === "F5") {
      event.preventDefault();
      oncePerShortcut(reload);
      return;
    }
    if (!(input.meta || input.control)) return;
    const key = input.key.toLowerCase();
    if (key === "t") {
      event.preventDefault();
      oncePerShortcut(() => openTab(`${hostOrigin}/`));
    } else if (key === "w") {
      event.preventDefault();
      oncePerShortcut(close);
    } else if (key === "r") {
      event.preventDefault();
      oncePerShortcut(reload);
    } else if (key === "tab") {
      event.preventDefault();
      oncePerShortcut(() => {
        tabs.cycle(input.shift);
        showActive();
      });
    }
  });
}

function showActive() {
  layout();
  const view = views.get(tabs.activeId);
  if (view && !view.webContents.isDestroyed()) view.webContents.focus();
  publishTabs();
}

function openTab(url) {
  if (!ready || !isHostUrl(url)) return;
  const tab = tabs.open(url);
  if (!tab) return;
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "page-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  views.set(tab.id, view);
  windowRef.contentView.addChildView(view);
  const contents = view.webContents;
  contents.setWindowOpenHandler(({ url: target }) => {
    if (isHostUrl(target)) openTab(target);
    else shell.openExternal(target);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, target) => {
    if (!isHostUrl(target)) event.preventDefault();
  });
  contents.on("will-redirect", (event, target) => {
    if (!isHostUrl(target)) event.preventDefault();
  });
  contents.on("page-title-updated", (_event, title) => {
    tabs.rename(tab.id, title);
    publishTabs();
  });
  contents.on("did-fail-load", (_event, code, _description, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    tabs.rename(tab.id, "Cannot open this page");
    publishTabs();
  });
  bindShortcuts(contents);
  bindPageMenu(contents);
  contents.loadURL(url);
  showActive();
}

function openWindow(url) {
  if (!ready || !isHostUrl(url)) return;
  const child = new BaseWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    title: "Vay Tutor",
    backgroundColor: "#f7f4ee",
    show: true,
  });
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "page-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  child.contentView.addChildView(view);
  const layoutChild = () => {
    const { width, height } = child.getContentBounds();
    view.setBounds({ x: 0, y: 0, width, height });
  };
  child.on("resize", layoutChild);
  layoutChild();
  const contents = view.webContents;
  contents.setWindowOpenHandler(({ url: target }) => {
    if (isHostUrl(target)) openTab(target);
    else shell.openExternal(target);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, target) => {
    if (!isHostUrl(target)) event.preventDefault();
  });
  contents.on("will-redirect", (event, target) => {
    if (!isHostUrl(target)) event.preventDefault();
  });
  contents.on("page-title-updated", (_event, title) => {
    if (!child.isDestroyed()) child.setTitle(title);
  });
  const reload = () => {
    if (!contents.isDestroyed()) contents.reload();
  };
  bindShortcuts(contents, {
    reload,
    close: () => {
      if (!child.isDestroyed()) child.close();
    },
  });
  bindPageMenu(contents, { menuWindow: child });
  contents.loadURL(url);
  extraWindows.add(child);
  child.on("closed", () => {
    extraWindows.delete(child);
    closeContents(view);
  });
}

function closeTab(id) {
  if (!tabs.close(id)) return;
  const view = views.get(id);
  views.delete(id);
  if (view) windowRef.contentView.removeChildView(view);
  closeContents(view);
  showActive();
}

function installMenu() {
  const template = [
    ...(process.platform === "darwin"
      ? [{
          label: app.name,
          submenu: [
            { role: "about" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { role: "quit" },
          ],
        }]
      : []),
    {
      label: "File",
      submenu: [
        { label: "Back up now", click: () => void runBackupNow() },
        { label: "Restore from backup…", click: () => void runRestoreNow() },
        { type: "separator" },
        process.platform === "darwin" ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => reloadActive() },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function bringUpInstitute(paths) {
  try {
    return await whenReady(paths.dataDir, 5, 200);
  } catch {
    // The institute is not up yet.
  }
  if (claimSupervisor(paths.dataDir)) {
    return startHost(paths);
  }
  return whenReady(paths.dataDir);
}

function createStatusView() {
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  return view;
}

function createChromeView() {
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  view.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file:")) event.preventDefault();
  });
  bindShortcuts(view.webContents);
  bindPageMenu(view.webContents, { refreshActive: true });
  view.webContents.loadFile(path.join(__dirname, "../ui/tabs.html"));
  return view;
}

function createWindow() {
  windowRef = new BaseWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 520,
    title: "Vay Tutor",
    backgroundColor: "#f7f4ee",
    show: true,
  });
  statusView = createStatusView();
  chromeView = createChromeView();
  windowRef.contentView.addChildView(statusView);
  windowRef.contentView.addChildView(chromeView);
  windowRef.on("resize", layout);
  windowRef.on("closed", () => {
    for (const child of [...extraWindows]) {
      if (!child.isDestroyed()) child.close();
    }
    closeContents(statusView);
    closeContents(chromeView);
    for (const view of views.values()) closeContents(view);
    views.clear();
    windowRef = null;
  });
  layout();
  installMenu();
}

app.whenReady().then(async () => {
  const paths = hostPaths();
  if (stopping) {
    stopHost(paths.dataDir);
    app.quit();
    return;
  }
  if (!supervisorOnly) {
    const gotLock = app.requestSingleInstanceLock();
    if (!gotLock) {
      app.quit();
      return;
    }
    app.on("second-instance", () => {
      if (!windowRef) return;
      if (typeof windowRef.isMinimized === "function" && windowRef.isMinimized()) windowRef.restore();
      windowRef.show();
      windowRef.focus();
    });
    ipcMain.handle("tabs-list", () => tabs.snapshot());
    ipcMain.handle("tabs-new", () => openTab(`${hostOrigin}/`));
    ipcMain.handle("tabs-select", (_event, id) => {
      if (tabs.select(id)) showActive();
    });
    ipcMain.handle("tabs-close", (_event, id) => closeTab(id));
    ipcMain.handle("backup-pick-save", async (_event, suggestedName) => {
      const stamp = suggestedName || `vay-tutor-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      const chosen = await dialog.showSaveDialog(windowRef || undefined, {
        title: "Save backup",
        defaultPath: path.join(app.getPath("documents"), stamp),
        filters: [{ name: "Vay Tutor backup", extensions: ["zip"] }],
      });
      if (chosen.canceled || !chosen.filePath) return null;
      let target = chosen.filePath;
      if (!target.toLowerCase().endsWith(".zip")) target = `${target}.zip`;
      return target;
    });
    ipcMain.handle("backup-write-file", async (_event, filePath, data) => {
      if (!filePath || typeof filePath !== "string") throw new Error("Choose where to save the backup file.");
      const absolute = path.resolve(filePath);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, Buffer.from(data));
      return absolute;
    });
    createWindow();
    await statusView.webContents.loadURL(loadingPage("Starting MongoDB, the API, and the institute…"));
    try {
      const started = await bringUpInstitute(paths);
      trustLocalCertificate();
      hostOrigin = started.origin;
      ready = true;
      openTab(`${started.origin}/`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const detail = message.includes("\n") ? message : readinessError(paths.dataDir, message).message;
      await statusView.webContents.loadURL(loadingPage(detail));
      layout();
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
    try {
      fs.mkdirSync(path.join(paths.dataDir, "logs"), { recursive: true });
      fs.appendFileSync(path.join(paths.dataDir, "logs", "host.log"), `${new Date().toISOString()} ${message}\n`);
    } catch {
      // Ignore secondary logging failures.
    }
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (!supervisorOnly) app.quit();
});
