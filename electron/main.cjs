"use strict";
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const { tweaks } = require("../shared/tweaks.cjs");
const { NativeService } = require("./native-service.cjs");

let window;
let service;
const development = !app.isPackaged && process.argv.includes("--dev");
const entry = path.join(__dirname, "..", "dist", "index.html");
const allowedUrl = development
  ? "http://127.0.0.1:5173"
  : pathToFileURL(entry).href;

function assertSender(event) {
  const url = event.senderFrame?.url || "";
  const allowed = development
    ? new URL(url).origin === allowedUrl
    : url.split("#")[0] === allowedUrl;
  if (!window || event.sender !== window.webContents || !allowed)
    throw new Error("Untrusted application request.");
}

function createWindow() {
  window = new BrowserWindow({
    width: 1460,
    height: 960,
    minWidth: 900,
    minHeight: 650,
    title: "Frameforge",
    backgroundColor: "#0b0e14",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (
      url.split("#")[0] !== allowedUrl &&
      !(development && new URL(url).origin === allowedUrl)
    )
      event.preventDefault();
  });
  window.on("close", (event) => {
    if (service.busy) {
      event.preventDefault();
      dialog.showMessageBox(window, {
        type: "info",
        title: "Operation in progress",
        message:
          "Wait for the approved Windows operation to finish before closing Frameforge.",
        buttons: ["OK"],
      });
    }
  });
  development ? window.loadURL(allowedUrl) : window.loadFile(entry);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  app.whenReady().then(() => {
    service = new NativeService({
      scriptPath: app.isPackaged
        ? path.join(process.resourcesPath, "native", "windows.ps1")
        : path.join(__dirname, "..", "native", "windows.ps1"),
      dataDir: app.getPath("userData"),
      catalog: tweaks,
      notify: (update) => {
        if (window && !window.isDestroyed())
          window.webContents.send("optimizer:progress", update);
      },
    });
    ipcMain.handle("optimizer:catalog", (event) => {
      assertSender(event);
      return tweaks;
    });
    ipcMain.handle("optimizer:request", (event, action, payload) => {
      assertSender(event);
      return service.run(action, payload);
    });
    ipcMain.handle("optimizer:elevate", (event, options) => {
      assertSender(event);
      if (options?.approved !== true)
        return { ok: false, error: "Approve the administrator restart first." };
      if (process.platform !== "win32")
        return { ok: false, error: "Administrator mode requires Windows." };
      if (!app.isPackaged)
        return {
          ok: false,
          error:
            "For development, launch your terminal as administrator before npm run desktop.",
        };
      if (service.busy)
        return {
          ok: false,
          error: "Wait for the current operation to finish.",
        };
      // Encode a fixed command with a safely quoted application path. UAC remains visible to the user.
      const executable = process.execPath.replace(/'/g, "''");
      const command = `try { Start-Process -FilePath '${executable}' -Verb RunAs -ErrorAction Stop; exit 0 } catch { exit 1 }`;
      const powershell = path.win32.join(
        process.env.SystemRoot || "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      );
      return new Promise((resolve) => {
        // The elevated process must be able to acquire the single-instance lock.
        app.releaseSingleInstanceLock();
        const child = spawn(
          powershell,
          [
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            Buffer.from(command, "utf16le").toString("base64"),
          ],
          { windowsHide: true },
        );
        child.on("error", () => {
          app.requestSingleInstanceLock();
          resolve({
            ok: false,
            error: "Unable to request administrator access.",
          });
        });
        child.on("close", (code) => {
          if (code === 0) {
            resolve({ ok: true });
            app.quit();
          } else {
            app.requestSingleInstanceLock();
            resolve({
              ok: false,
              error: "Administrator request was cancelled or denied.",
            });
          }
        });
      });
    });
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
