const { app, BaseWindow, Menu, WebContentsView, ipcMain, net, session } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { checkHost, requireHost } = require("./host");
const { createTabs } = require("./tabs");
const { certificateDecision, hostHostname } = require("./trust");

const version = require("../package.json").version;
const TAB_HEIGHT = 44;
const smoke = process.env.VAY_SMOKE === "1";

let windowRef = null;
let connectView = null;
let chromeView = null;
let mode = "connect";
let hostOrigin = null;
let trustedHostname = "";
const tabs = createTabs();
const views = new Map();
const extraWindows = new Set();
let shortcutAt = 0;

function hostFile() {
  return path.join(app.getPath("userData"), "host.txt");
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

function layout() {
  if (!windowRef) return;
  const { width, height } = windowRef.getContentBounds();
  if (mode === "connect") {
    chromeView.setVisible(false);
    for (const view of views.values()) view.setVisible(false);
    connectView.setVisible(true);
    connectView.setBounds({ x: 0, y: 0, width, height });
    return;
  }
  connectView.setVisible(false);
  chromeView.setVisible(true);
  chromeView.setBounds({ x: 0, y: 0, width, height: TAB_HEIGHT });
  for (const tab of tabs.snapshot()) {
    const view = views.get(tab.id);
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
  if (windowRef) windowRef.setTitle(active ? active.title : "Vay Tutor Client");
}

function closeContents(view) {
  if (!view || view.webContents.isDestroyed()) return;
  view.webContents.close();
}

function localView(fileName) {
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
  if (fileName === "tabs.html") bindPageMenu(view.webContents, { refreshActive: true });
  view.webContents.loadFile(path.join(__dirname, "../ui", fileName));
  return view;
}

function reloadActive() {
  const view = views.get(tabs.activeId);
  if (view && !view.webContents.isDestroyed()) view.webContents.reload();
}

function bindPageMenu(contents, { refreshActive = false, menuWindow = null } = {}) {
  contents.on("context-menu", (_event, params) => {
    if (mode !== "institute" || !hostOrigin) return;
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
        ]
      : [
          { label: "Refresh", click: refresh },
          { label: "New Tab", click: () => openTab(`${hostOrigin}/`) },
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
    if (mode !== "institute" || input.type !== "keyDown") return;
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
  if (mode !== "institute" || !isHostUrl(url)) return;
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
  if (mode !== "institute" || !isHostUrl(url)) return;
  const child = new BaseWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    title: "Vay Tutor Client",
    backgroundColor: "#f4f1ea",
    show: true,
    icon: path.join(__dirname, "../build/window.png"),
  });
  const view = new WebContentsView({
    webPreferences: {
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

function showConnect() {
  mode = "connect";
  hostOrigin = null;
  trustedHostname = "";
  for (const child of [...extraWindows]) {
    if (!child.isDestroyed()) child.close();
  }
  for (const [id, view] of views) {
    windowRef.contentView.removeChildView(view);
    closeContents(view);
    views.delete(id);
  }
  tabs.clear();
  layout();
  if (windowRef) windowRef.setTitle("Vay Tutor Client");
  publishTabs();
  connectView.webContents.focus();
}

function showInstitute(origin) {
  hostOrigin = origin;
  mode = "institute";
  openTab(`${origin}/`);
}

function installMenu() {
  Menu.setApplicationMenu(null);
}

async function readSavedHost() {
  try {
    return (await fs.readFile(hostFile(), "utf8")).trim();
  } catch {
    return "";
  }
}

async function connectToHost(value) {
  const origin = requireHost(value);
  trustedHostname = hostHostname(origin);
  try {
    await checkHost(
      origin,
      (url, options) => net.fetch(url, { ...options, signal: AbortSignal.timeout(8000) }),
      version,
    );
  } catch (error) {
    trustedHostname = "";
    throw error;
  }
  await fs.mkdir(path.dirname(hostFile()), { recursive: true });
  await fs.writeFile(hostFile(), origin, "utf8");
  showInstitute(origin);
  return origin;
}

function createWindow() {
  windowRef = new BaseWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    title: "Vay Tutor Client",
    backgroundColor: "#f4f1ea",
    show: false,
    icon: path.join(__dirname, "../build/window.png"),
  });
  connectView = localView("index.html");
  chromeView = localView("tabs.html");
  windowRef.contentView.addChildView(connectView);
  windowRef.contentView.addChildView(chromeView);
  windowRef.on("resize", layout);
  windowRef.on("closed", () => {
    for (const child of [...extraWindows]) {
      if (!child.isDestroyed()) child.close();
    }
    closeContents(connectView);
    closeContents(chromeView);
    for (const view of views.values()) closeContents(view);
    views.clear();
    windowRef = null;
  });
  const loaded = (contents) => {
    if (!contents.isLoading()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      contents.once("did-finish-load", () => resolve());
      contents.once("did-fail-load", () => reject(new Error("The client window did not load.")));
    });
  };
  Promise.all([loaded(connectView.webContents), loaded(chromeView.webContents)])
    .then(async () => {
      if (!smoke) {
        windowRef.show();
        return;
      }
      const connectApi = await connectView.webContents.executeJavaScript("typeof window.vay");
      const tabApi = await chromeView.webContents.executeJavaScript("typeof window.vay");
      if (connectApi !== "object" || tabApi !== "object") {
        console.error("SMOKE_FAIL");
        app.exit(1);
        return;
      }
      console.log("SMOKE_OK");
      app.exit(0);
    })
    .catch((error) => {
      if (!smoke) return;
      console.error("SMOKE_FAIL", error instanceof Error ? error.message : error);
      app.exit(1);
    });
  layout();
  installMenu();
}

app.setName("Vay Tutor Client");
if (process.platform === "win32") app.setAppUserModelId("com.vaytutor.client");

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!windowRef) return;
    if (typeof windowRef.isMinimized === "function" && windowRef.isMinimized()) windowRef.restore();
    windowRef.show();
    windowRef.focus();
  });
  app.whenReady().then(() => {
    session.defaultSession.setCertificateVerifyProc((request, callback) => {
      callback(certificateDecision(request.hostname, trustedHostname));
    });
    ipcMain.handle("saved-host", () => readSavedHost());
    ipcMain.handle("connect", async (_event, url) => {
      try {
        return { ok: true, origin: await connectToHost(url) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    });
    ipcMain.handle("tabs-list", () => tabs.snapshot());
    ipcMain.handle("tabs-new", () => openTab(`${hostOrigin}/`));
    ipcMain.handle("tabs-select", (_event, id) => {
      if (tabs.select(id)) showActive();
    });
    ipcMain.handle("tabs-close", (_event, id) => closeTab(id));
    ipcMain.handle("change-host", () => showConnect());
    createWindow();
  });
  app.on("window-all-closed", () => app.quit());
}
