"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");
const { validateRequest, MUTATION_ACTIONS } = require("./validation.cjs");
const { stageBundledScript } = require("./script-staging.cjs");

class NativeService {
  constructor({
    scriptPath,
    dataDir,
    catalog,
    platform = process.platform,
    notify = () => {},
  }) {
    this.scriptPath = scriptPath;
    this.dataDir = dataDir;
    this.catalog = catalog;
    this.platform = platform;
    this.notify = notify;
    this.busy = false;
  }

  async run(action, rawPayload) {
    let payload;
    try {
      payload = validateRequest(action, rawPayload, this.catalog);
    } catch (error) {
      return { ok: false, error: error.message };
    }
    if (this.platform !== "win32") {
      if (action === "state")
        return {
          ok: true,
          mode: "preview",
          isAdmin: false,
          restoreAvailable: false,
          appliedIds: [],
          history: [],
        };
      if (action === "history") return { ok: true, history: [] };
      return {
        ok: false,
        preview: true,
        error:
          "This operation requires the Windows desktop app. Preview mode does not change your PC.",
      };
    }
    const mutation = MUTATION_ACTIONS.has(action);
    if (mutation && this.busy)
      return {
        ok: false,
        error: "Another operation is running. Wait for it to finish.",
      };
    if (mutation) this.busy = true;
    this.notify({
      action,
      stage: "running",
      message:
        action === "apply"
          ? "Creating a restore point, saving original settings, and applying your selection…"
          : "Working on your approved operation…",
    });
    try {
      const response = await this.invoke({
        action,
        payload,
        dataDir: this.dataDir,
        catalog: this.catalog,
      });
      this.notify({
        action,
        stage: "complete",
        ok: response.ok,
        message: response.message || response.error || "Operation completed.",
      });
      return response;
    } catch (error) {
      return { ok: false, error: error.message };
    } finally {
      if (mutation) this.busy = false;
    }
  }

  invoke(request) {
    return new Promise((resolve, reject) => {
      // Byte-stage only our bundled helper. ZIP Internet-zone metadata must not
      // turn into an unsigned remote-script dependency. RemoteSigned and any
      // stronger machine policy remain in effect for the new local helper.
      let staged;
      try {
        staged = stageBundledScript(this.scriptPath, this.dataDir);
      } catch (error) {
        reject(
          new Error(
            `Cannot prepare the bundled Windows helper: ${error.message}`,
          ),
        );
        return;
      }
      // Use the built-in, absolute executable; never resolve an executable from renderer input or PATH.
      const executable = path.win32.join(
        process.env.SystemRoot || "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      );
      let child;
      try {
        child = spawn(
          executable,
          [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "RemoteSigned",
            "-File",
            staged.scriptPath,
          ],
          {
            windowsHide: true,
            stdio: ["pipe", "pipe", "pipe"],
            env: process.env,
          },
        );
      } catch (error) {
        staged.cleanup();
        reject(error);
        return;
      }
      // Close follows process exit or a spawn error; release the helper only
      // once PowerShell has closed its file handles.
      child.once("close", () => {
        try {
          staged.cleanup();
        } catch {
          /* A locked local helper can be removed later. */
        }
      });
      let stdout = "",
        stderr = "",
        settled = false;
      // Do not terminate a mutation midway through restoring registry values. Read-only scans can time out.
      const timer = MUTATION_ACTIONS.has(request.action)
        ? null
        : setTimeout(() => {
            child.kill();
            finish(
              new Error(
                "Windows took too long to respond. Retry after checking system services.",
              ),
            );
          }, 90_000);
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        error ? reject(error) : resolve(value);
      };
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
        if (stdout.length > 8 * 1024 * 1024) {
          child.kill();
          finish(new Error("Windows returned an unexpectedly large response."));
        }
      });
      child.stderr.on("data", (chunk) => {
        if (stderr.length < 32_768) stderr += chunk.toString("utf8");
      });
      child.on("error", (error) =>
        finish(new Error(`Cannot start Windows PowerShell: ${error.message}`)),
      );
      child.on("close", (code) => {
        if (settled) return;
        try {
          const parsed = JSON.parse(stdout.replace(/^\uFEFF/, "").trim());
          if (!parsed || typeof parsed.ok !== "boolean")
            throw new Error("Invalid response");
          if (code !== 0 && parsed.ok) parsed.ok = false;
          finish(null, parsed);
        } catch {
          finish(
            new Error(
              code === 0
                ? "Windows returned an invalid response."
                : `Windows operation failed. ${stderr.slice(0, 1000) || "Check that local PowerShell scripts are permitted by your system policy."}`,
            ),
          );
        }
      });
      child.stdin.on("error", () => {});
      child.stdin.end(JSON.stringify(request));
    });
  }
}

module.exports = { NativeService };
