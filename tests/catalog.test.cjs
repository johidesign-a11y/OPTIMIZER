"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { tweaks, categories, profiles } = require("../shared/tweaks.cjs");

test("catalog contains at least 50 distinct, executable, described free settings", () => {
  assert.ok(tweaks.length >= 50);
  assert.equal(new Set(tweaks.map((t) => t.id)).size, tweaks.length);
  const targets = new Set();
  const categoryIds = new Set(categories.map((c) => c.id));
  for (const tweak of tweaks) {
    assert.match(tweak.id, /^[a-z][a-z0-9-]+$/);
    assert.ok(tweak.title.length > 5 && tweak.description.length > 30);
    assert.ok(categoryIds.has(tweak.category));
    assert.ok(["low", "moderate"].includes(tweak.risk));
    assert.ok(["none", "signout", "reboot"].includes(tweak.restart));
    assert.ok(["registry", "power"].includes(tweak.kind));
    if (tweak.kind === "registry") {
      assert.ok(tweak.targets.length);
      for (const target of tweak.targets) {
        assert.match(target.path, /^HK(?:CU|LM):\\[^\\]/);
        assert.ok(
          !target.path.includes("\\\\"),
          "registry paths must use single separators",
        );
        assert.ok(["DWord", "String", "Binary"].includes(target.type));
        const key = `${target.path.toLowerCase()}|${target.name.toLowerCase()}`;
        assert.ok(!targets.has(key), `Duplicate registry target ${key}`);
        targets.add(key);
      }
    } else {
      for (const guid of [tweak.power.subgroup, tweak.power.setting])
        assert.match(guid, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i);
      assert.ok(Number.isInteger(tweak.power.ac));
      assert.equal(
        tweak.power.dc,
        undefined,
        "desktop profiles must leave battery settings alone",
      );
    }
  }
});

test("conservative and CS2 profiles reference known settings without optional power or accessibility changes", () => {
  assert.ok(profiles.some((p) => p.id === "balanced"));
  assert.ok(profiles.some((p) => p.id === "cs2"));
  for (const profile of profiles) {
    assert.equal(new Set(profile.ids).size, profile.ids.length);
    for (const id of profile.ids) {
      const tweak = tweaks.find((t) => t.id === id);
      assert.ok(tweak, `Missing ${id}`);
      assert.equal(tweak.kind, "registry");
      assert.ok(!["sticky-keys", "filter-keys", "toggle-keys"].includes(id));
    }
  }
});

test("catalog does not disable system security or use timer/network stack folklore", () => {
  const serialized = JSON.stringify(
    tweaks.map((t) => ({ targets: t.targets, power: t.power })),
  );
  assert.doesNotMatch(
    serialized,
    /DisableAntiSpyware|DisableRealtimeMonitoring|EnableFirewall|useplatformclock|disabledynamictick|TcpAckFrequency|TCPNoDelay|FeatureSettingsOverride|DisableWindowsUpdateAccess/i,
  );
});
