"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { stageBundledScript } = require("../electron/script-staging.cjs");

function fixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "frameforge-staging-test-"),
  );
  const source = path.join(root, "source.ps1");
  const dataDir = path.join(root, "app-data");
  const bytes = Buffer.from("# trusted bundled helper\r\n'UTF-8: zażółć'\r\n");
  fs.writeFileSync(source, bytes);
  return { root, source, dataDir, bytes };
}

test("staging preserves source bytes and creates a fresh local file each time", () => {
  const item = fixture();
  let first, second;
  try {
    first = stageBundledScript(item.source, item.dataDir);
    second = stageBundledScript(item.source, item.dataDir);
    assert.notEqual(first.scriptPath, item.source);
    assert.notEqual(first.scriptPath, second.scriptPath);
    assert.equal(path.dirname(path.dirname(first.scriptPath)), item.dataDir);
    assert.deepEqual(fs.readFileSync(first.scriptPath), item.bytes);
    assert.deepEqual(fs.readFileSync(second.scriptPath), item.bytes);
    first.cleanup();
    first.cleanup();
    assert.equal(fs.existsSync(path.dirname(first.scriptPath)), false);
    assert.equal(fs.existsSync(second.scriptPath), true);
    assert.deepEqual(fs.readFileSync(item.source), item.bytes);
  } finally {
    first?.cleanup();
    second?.cleanup();
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("a changed staged copy fails verification and its directory is removed", (t) => {
  const item = fixture();
  const write = fs.writeFileSync;
  t.mock.method(fs, "writeFileSync", (file, bytes, options) =>
    write(file, Buffer.concat([bytes, Buffer.from("tampered")]), options),
  );
  try {
    assert.throws(
      () => stageBundledScript(item.source, item.dataDir),
      /integrity check/,
    );
    assert.deepEqual(fs.readdirSync(item.dataDir), []);
    assert.deepEqual(fs.readFileSync(item.source), item.bytes);
  } finally {
    t.mock.restoreAll();
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});
