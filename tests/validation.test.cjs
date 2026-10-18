"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { validateRequest } = require("../electron/validation.cjs");
const { NativeService } = require("../electron/native-service.cjs");
const catalog = [{ id: "game-mode" }, { id: "capture-off" }];

test("every mutation requires explicit approval", () => {
  for (const action of [
    "apply",
    "restore",
    "restorePoint",
    "clean",
    "cs2Apply",
    "cs2Restore",
  ]) {
    assert.throws(
      () => validateRequest(action, {}, catalog),
      /approve/i,
      action,
    );
  }
});

test("apply requires restore point and rejects injected or duplicate identifiers", () => {
  assert.throws(
    () =>
      validateRequest("apply", { approved: true, ids: ["game-mode"] }, catalog),
    /restore point/,
  );
  for (const ids of [
    ["unknown"],
    ["game-mode", "game-mode"],
    ["; Remove-Item C:\\ -Recurse"],
    [],
  ]) {
    assert.throws(
      () =>
        validateRequest(
          "apply",
          { approved: true, createRestorePoint: true, ids },
          catalog,
        ),
      /valid/,
    );
  }
});

test("trusted payload is reconstructed without renderer script fields", () => {
  const payload = validateRequest(
    "apply",
    {
      approved: true,
      createRestorePoint: true,
      ids: ["game-mode"],
      script: "malicious",
      catalog: [],
    },
    catalog,
  );
  assert.deepEqual(payload, {
    approved: true,
    createRestorePoint: true,
    ids: ["game-mode"],
  });
});

test("backup traversal and arbitrary cleanup paths are rejected", () => {
  for (const id of [
    "../../Windows",
    "C:\\Windows",
    "../backup",
    "a.json",
    "",
  ]) {
    assert.throws(
      () => validateRequest("restore", { approved: true, id }, catalog),
      /identifier/,
    );
  }
  assert.throws(
    () =>
      validateRequest("clean", { approved: true, ids: ["C:\\Users"] }, catalog),
    /categories/,
  );
  assert.deepEqual(
    validateRequest("clean", { approved: true, ids: ["user-temp"] }, catalog),
    { approved: true, ids: ["user-temp"] },
  );
});

test("unsupported commands and invalid payloads cannot reach native service", () => {
  assert.throws(
    () => validateRequest("exec", { command: "anything" }, catalog),
    /Unknown/,
  );
  assert.throws(() => validateRequest("scan", [], catalog), /Invalid/);
  assert.deepEqual(validateRequest("scan", { ignored: "value" }, catalog), {});
});

test("Linux preview neither fabricates a scan nor performs mutations", async () => {
  const service = new NativeService({
    platform: "linux",
    catalog,
    scriptPath: "/not-used",
    dataDir: "/not-used",
  });
  const state = await service.run("state");
  assert.equal(state.mode, "preview");
  assert.deepEqual(state.appliedIds, []);
  for (const action of ["scan", "apply", "clean", "restore"]) {
    const payload =
      action === "apply"
        ? { approved: true, createRestorePoint: true, ids: ["game-mode"] }
        : action === "clean"
          ? { approved: true, ids: ["user-temp"] }
          : action === "restore"
            ? { approved: true, id: "backup-1" }
            : {};
    const result = await service.run(action, payload);
    assert.equal(result.ok, false);
    assert.equal(result.preview, true);
  }
});

test("native failures clear mutation lock and concurrent mutations are refused", async () => {
  const service = new NativeService({
    platform: "win32",
    catalog,
    scriptPath: "/not-used",
    dataDir: "/not-used",
  });
  let release;
  service.invoke = () =>
    new Promise((_, reject) => {
      release = reject;
    });
  const first = service.run("restorePoint", { approved: true });
  assert.equal(service.busy, true);
  const second = await service.run("restorePoint", { approved: true });
  assert.equal(second.ok, false);
  assert.match(second.error, /Another operation/);
  release(new Error("Native failure"));
  assert.equal((await first).ok, false);
  assert.equal(service.busy, false);
});
