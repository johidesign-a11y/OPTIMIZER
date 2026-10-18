import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const base = "http://127.0.0.1:4173";
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    "4173",
    "--strictPort",
  ],
  { stdio: "pipe" },
);
let serverError = "";
server.stderr.on("data", (c) => {
  serverError += c;
});
let browser;
let assertions = 0;
const check = (value, message) => {
  assert.ok(value, message);
  assertions++;
};
const nav = (page, text) => page.locator(".nav-item").filter({ hasText: text });

try {
  await mkdir("test-results", { recursive: true });
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      if ((await fetch(base)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, `Preview server did not start: ${serverError}`);
  browser = await chromium.launch({
    executablePath: process.env.FRAMEFORGE_CHROMIUM || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.getByText("Browser preview", { exact: true }).waitFor();
  check(
    (await page.locator(".nav-count").innerText()) === "59",
    "Real catalog count did not load.",
  );
  check(
    await page
      .getByText("Target build · not a live scan", { exact: true })
      .isVisible(),
    "Target build is not identified as a target.",
  );
  await page.screenshot({ path: "test-results/overview.png", fullPage: true });
  await nav(page, "Optimizations").click();
  check(
    (await page.locator(".tweak-card").count()) === 59,
    "Catalog did not render all 59 settings.",
  );
  const search = page.getByRole("textbox", { name: "Search optimizations" });
  await search.pressSequentially("mouse");
  check(
    (await search.inputValue()) === "mouse",
    "Search lost focus while typing.",
  );
  check(
    (await page.locator(".tweak-card").count()) > 0 &&
      (await page.locator(".tweak-card").count()) < 59,
    "Search did not filter the catalog.",
  );
  await search.fill("no-such-setting-999");
  check(
    await page.getByText("No matching tweaks", { exact: true }).isVisible(),
    "Empty search results are not explained.",
  );
  await search.fill("");
  await page
    .getByRole("button", { name: "Review & apply", exact: true })
    .click();
  check(await page.getByRole("dialog").isVisible(), "Apply bypassed review.");
  check(
    await page
      .getByRole("button", { name: "Approve & apply", exact: true })
      .isDisabled(),
    "Preview permitted a Windows mutation.",
  );
  await page.screenshot({ path: "test-results/approval.png", fullPage: true });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  for (const view of [
    "Counter-Strike 2",
    "PC scanner",
    "System cleanup",
    "Recovery",
  ]) {
    await nav(page, view).click();
    check(await page.locator("main h1").isVisible(), `Missing ${view} screen.`);
  }
  await nav(page, "PC scanner").click();
  await page.getByRole("button", { name: "Scan my PC", exact: true }).click();
  check(
    await page.getByRole("alert").isVisible(),
    "Preview scan should disclose that Windows is required.",
  );
  check(
    (await page.locator(".spec-card").count()) === 0,
    "Preview fabricated scanner output.",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await nav(page, "Overview").click();
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  check(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Mobile layout overflows horizontally.",
  );
  check(errors.length === 0, `Renderer errors: ${errors.join("; ")}`);
  await page.close();

  // This fixture tests the UI/bridge contract only. It never touches Windows.
  const desktop = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await desktop.addInitScript(() => {
    window.__calls = [];
    const state = {
      ok: true,
      mode: "windows",
      isAdmin: true,
      restoreAvailable: true,
      appliedIds: [],
      history: [],
    };
    const record = (method, args) => window.__calls.push({ method, args });
    window.optimizer = {
      getState: async () => JSON.parse(JSON.stringify(state)),
      scan: async () => ({
        ok: true,
        cpu: { name: "Fixture CPU", cores: 14, logicalProcessors: 20 },
        gpu: [
          {
            name: "Fixture GPU",
            vramBytes: 12 * 2 ** 30,
            driverVersion: "fixture-driver",
          },
        ],
        memory: {
          totalBytes: 32 * 2 ** 30,
          slots: [
            {
              manufacturer: "Fixture RAM",
              partNumber: "DDR-test",
              capacityBytes: 16 * 2 ** 30,
              configuredSpeedMhz: 5600,
            },
          ],
        },
        os: { name: "Fixture Windows", build: "22631" },
        board: { manufacturer: "Fixture", product: "Motherboard" },
        bios: { version: "test" },
        disks: [{ model: "Fixture SSD", sizeBytes: 10 ** 12 }],
        network: [],
        monitors: [],
      }),
      applyTweaks: async (ids, options) => {
        record("apply", { ids, options });
        if (window.__failNext) {
          state.history.unshift({
            id: "partialbackup",
            createdAt: new Date().toISOString(),
            status: "partial",
            tweakIds: ids,
          });
          return {
            ok: false,
            error: "Injected partial failure. Open Recovery.",
            backupId: "partialbackup",
          };
        }
        state.appliedIds = ids;
        state.history.unshift({
          id: "fixturebackup",
          createdAt: new Date().toISOString(),
          status: "applied",
          tweakIds: ids,
        });
        return {
          ok: true,
          changedCount: ids.length,
          appliedIds: ids,
          skipped: [],
        };
      },
      restoreBackup: async (id, options) => {
        record("restore", { id, options });
        state.history[0].status = "restored";
        state.appliedIds = [];
        return { ok: true };
      },
      createRestorePoint: async (options) => {
        record("restorePoint", options);
        return { ok: true };
      },
      analyzeCleanup: async () => ({
        ok: true,
        totalBytes: 4096,
        categories: [
          {
            id: "user-temp",
            title: "User temporary files",
            bytes: 4096,
            fileCount: 2,
          },
        ],
      }),
      clean: async (ids, options) => {
        record("clean", { ids, options });
        return { ok: true, bytesRemoved: 4096, filesRemoved: 2, skipped: 0 };
      },
      cs2Scan: async () => ({
        ok: true,
        installed: true,
        managed: false,
        installPath: "C:\\fixture",
        autoexecPath: "C:\\fixture\\autoexec.cfg",
        configPreview: "fps_max 300\nfps_max_ui 60",
        backups: [],
      }),
      cs2Apply: async (options) => {
        record("cs2Apply", options);
        return { ok: true };
      },
      cs2Restore: async (options) => {
        record("cs2Restore", options);
        return { ok: true };
      },
      onProgress: () => () => {},
    };
  });
  desktop.on("pageerror", (error) => errors.push(error.message));
  await desktop.goto(base);
  await desktop.getByText("Administrator", { exact: true }).waitFor();
  await nav(desktop, "PC scanner").click();
  await desktop
    .getByRole("button", { name: "Scan my PC", exact: true })
    .click();
  await desktop.getByText("Fixture CPU", { exact: true }).waitFor();
  check(
    await desktop.getByText("12 GB", { exact: true }).isVisible(),
    "VRAM was not normalized accurately.",
  );
  check(
    await desktop.getByText("5600 MHz", { exact: true }).first().isVisible(),
    "Configured RAM speed is not displayed.",
  );
  await nav(desktop, "Optimizations").click();
  await desktop
    .getByRole("button", { name: "Review & apply", exact: true })
    .click();
  check(
    (await desktop.evaluate(() => window.__calls.length)) === 0,
    "Operation ran before approval.",
  );
  check(
    await desktop
      .getByRole("button", { name: "Approve & apply", exact: true })
      .isDisabled(),
    "Approval checkbox was bypassed.",
  );
  await desktop.getByRole("dialog").getByRole("checkbox").check();
  await desktop
    .getByRole("button", { name: "Approve & apply", exact: true })
    .click();
  await desktop.getByRole("dialog").waitFor({ state: "hidden" });
  check(
    (await desktop.evaluate(() => window.__calls[0].args.options.approved)) ===
      true,
    "Approval did not reach bridge.",
  );
  await nav(desktop, "Recovery").click();
  check(
    (await desktop.locator(".history-row").count()) === 1,
    "Successful operation backup is missing.",
  );
  await desktop.getByRole("button", { name: "Restore", exact: true }).click();
  await desktop.getByRole("dialog").getByRole("checkbox").check();
  await desktop
    .getByRole("button", { name: "Approve & restore", exact: true })
    .click();
  await desktop.getByRole("dialog").waitFor({ state: "hidden" });
  check(
    await desktop.getByText("Restored", { exact: true }).isVisible(),
    "Restore status did not update.",
  );
  await nav(desktop, "System cleanup").click();
  await desktop
    .getByRole("button", { name: "Analyze my PC", exact: true })
    .click();
  await desktop
    .getByRole("button", { name: "Review & clean", exact: true })
    .click();
  check(
    await desktop.getByText(/permanently deleted/).isVisible(),
    "Deletion confirmation omitted permanence.",
  );
  await desktop.getByRole("dialog").getByRole("checkbox").check();
  await desktop
    .getByRole("button", { name: "Approve & clean", exact: true })
    .click();
  await desktop.getByRole("dialog").waitFor({ state: "hidden" });
  check(
    await desktop.evaluate(() =>
      window.__calls.some(
        (c) => c.method === "clean" && c.args.ids[0] === "user-temp",
      ),
    ),
    "Approved cleanup did not invoke fixed category.",
  );
  await nav(desktop, "Counter-Strike 2").click();
  await desktop
    .getByRole("button", { name: "Find my CS2 installation", exact: true })
    .click();
  await desktop
    .getByRole("button", { name: "Review & apply config", exact: true })
    .click();
  check(
    (await desktop.locator(".config-preview").innerText()) ===
      "fps_max 300\nfps_max_ui 60",
    "Review did not show actual CS2 commands.",
  );
  await desktop.getByRole("button", { name: "Cancel", exact: true }).click();
  await desktop.evaluate(() => {
    window.__failNext = true;
  });
  await nav(desktop, "Optimizations").click();
  await desktop
    .getByRole("button", { name: "Select recommended", exact: true })
    .click();
  await desktop
    .getByRole("button", { name: "Review & apply", exact: true })
    .click();
  await desktop.getByRole("dialog").getByRole("checkbox").check();
  await desktop
    .getByRole("button", { name: "Approve & apply", exact: true })
    .click();
  await desktop.getByRole("alert").waitFor();
  await nav(desktop, "Recovery").click();
  check(
    (await desktop.locator(".history-row").count()) === 2,
    "Failed mutation recovery was not refreshed.",
  );
  check(errors.length === 0, `Renderer errors: ${errors.join("; ")}`);
  console.log(
    `${assertions} UI checks passed: preview, search, responsive layout, approval, scanner mapping, apply/restore, cleanup, CS2 review, and failed-operation recovery.`,
  );
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}
