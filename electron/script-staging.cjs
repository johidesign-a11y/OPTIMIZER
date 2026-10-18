"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash, timingSafeEqual } = require("node:crypto");

// Both paths come from the trusted main process, never from an IPC payload.
// A byte write creates a local helper without copying an archive's Zone.Identifier.
// The hash verifies this copy; release authenticity is a separate distribution check.
function stageBundledScript(scriptPath, dataDir) {
  const source = fs.readFileSync(scriptPath);
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const directory = fs.mkdtempSync(path.join(dataDir, "native-run-"));
  const stagedPath = path.join(directory, "windows.ps1");
  const cleanup = () =>
    fs.rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  try {
    fs.writeFileSync(stagedPath, source, { flag: "wx", mode: 0o600 });
    const sourceHash = createHash("sha256").update(source).digest();
    const stagedHash = createHash("sha256")
      .update(fs.readFileSync(stagedPath))
      .digest();
    if (!timingSafeEqual(sourceHash, stagedHash)) {
      throw new Error(
        "The locally prepared Windows helper failed its integrity check. No Windows command was started.",
      );
    }
    return { scriptPath: stagedPath, cleanup };
  } catch (error) {
    try {
      cleanup();
    } catch {
      // Preserve the preparation failure. This fresh directory is never reused.
    }
    throw error;
  }
}

module.exports = { stageBundledScript };
