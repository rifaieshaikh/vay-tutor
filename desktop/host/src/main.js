const { app, BaseWindow, Menu, WebContentsView, ipcMain, session, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const {
  claimSupervisor,
  dataDirectory,
  readinessError,
  startHost,
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
let shortcutAt = 0;

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

function bindShortcuts(contents) {
  contents.on("before-input-event", (event, input) => {
    if (!ready || input.type !== "keyDown" || !(input.meta || input.control)) return;
    const key = input.key.toLowerCase();
    if (key === "t") {
      event.preventDefault();
      oncePerShortcut(() => openTab(`${hostOrigin}/`));
    } else if (key === "w") {
      event.preventDefault();
      oncePerShortcut(() => closeTab(tabs.activeId));
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
  contents.loadURL(url);
  showActive();
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
  Menu.setApplicationMenu(null);
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
