"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { NativeService } = require("../electron/native-service.cjs");
const { stageBundledScript } = require("../electron/script-staging.cjs");

async function main() {
  if (process.platform !== "win32") {
    console.log("Windows bridge check skipped: Windows is required.");
    return;
  }
  assert.ok(
    process.env.APPDATA,
    "APPDATA is required for a private test fixture.",
  );
  const root = path.join(
    process.env.APPDATA,
    `Frameforge-bridge-test-${randomUUID()}`,
  );
  fs.mkdirSync(root, { recursive: false });
  try {
    const source = path.join(root, "internet-marked-source.ps1");
    fs.writeFileSync(
      source,
      fs.readFileSync(path.join(__dirname, "..", "native", "windows.ps1")),
      { flag: "wx" },
    );
    fs.writeFileSync(
      `${source}:Zone.Identifier`,
      "[ZoneTransfer]\r\nZoneId=3\r\n",
    );
    assert.match(
      fs.readFileSync(`${source}:Zone.Identifier`, "utf8"),
      /ZoneId=3/,
    );
    const dataDir = path.join(root, "app-data");
    const staged = stageBundledScript(source, dataDir);
    try {
      assert.deepEqual(
        fs.readFileSync(staged.scriptPath),
        fs.readFileSync(source),
      );
      assert.equal(
        fs.existsSync(`${staged.scriptPath}:Zone.Identifier`),
        false,
        "Byte staging must not copy the source Internet zone stream.",
      );
    } finally {
      staged.cleanup();
    }
    const service = new NativeService({
      scriptPath: source,
      dataDir,
      catalog: [],
    });
    const result = await service.run("state", {});
    assert.equal(
      result.ok,
      true,
      result.error || "Native state request failed.",
    );
    assert.equal(result.mode, "windows");
    assert.equal(typeof result.isAdmin, "boolean");
    assert.deepEqual(result.appliedIds, []);
    assert.deepEqual(result.history, []);
    assert.match(
      fs.readFileSync(`${source}:Zone.Identifier`, "utf8"),
      /ZoneId=3/,
      "The original bundled file's Internet zone must remain unchanged.",
    );
    assert.equal(
      fs.readdirSync(dataDir).some((name) => name.startsWith("native-run-")),
      false,
      "NativeService must remove its staged helper after the child exits.",
    );
    console.log(
      "Windows bridge passed: Internet-marked bundled helper executes read-only state under RemoteSigned without changing system settings.",
    );
  } finally {
    fs.rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  }
}

main().catch((error) => {
  console.error(error);
  const detail = String(error.stack || error.message || error)
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");
  console.log(
    `::error title=Windows downloaded-script bridge failed::${detail}`,
  );
  process.exitCode = 1;
});
