"use strict";

const READ_ACTIONS = new Set([
  "state",
  "scan",
  "history",
  "analyzeCleanup",
  "cs2Scan",
]);
const MUTATION_ACTIONS = new Set([
  "apply",
  "restore",
  "restorePoint",
  "clean",
  "cs2Apply",
  "cs2Restore",
]);
const CLEANUP_IDS = new Set(["user-temp", "windows-temp"]);

function validateRequest(action, payload, catalog) {
  if (!READ_ACTIONS.has(action) && !MUTATION_ACTIONS.has(action))
    throw new Error("Unknown operation.");
  if (payload === undefined) payload = {};
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new Error("Invalid operation parameters.");
  if (MUTATION_ACTIONS.has(action) && payload.approved !== true)
    throw new Error("Review and approve this operation first.");
  if (action === "apply") {
    if (payload.createRestorePoint !== true)
      throw new Error(
        "A Windows restore point is required before applying tweaks.",
      );
    const known = new Set(catalog.map((t) => t.id));
    if (
      !Array.isArray(payload.ids) ||
      !payload.ids.length ||
      payload.ids.length > catalog.length ||
      payload.ids.some((id) => typeof id !== "string" || !known.has(id)) ||
      new Set(payload.ids).size !== payload.ids.length
    ) {
      throw new Error("Select valid, unique tweaks from the catalog.");
    }
    return { approved: true, createRestorePoint: true, ids: [...payload.ids] };
  }
  if (action === "clean") {
    if (
      !Array.isArray(payload.ids) ||
      !payload.ids.length ||
      payload.ids.some((id) => !CLEANUP_IDS.has(id)) ||
      new Set(payload.ids).size !== payload.ids.length
    )
      throw new Error("Select valid cleanup categories.");
    return { approved: true, ids: [...payload.ids] };
  }
  if (action === "restore") {
    if (
      typeof payload.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(payload.id)
    )
      throw new Error("Invalid backup identifier.");
    return { approved: true, id: payload.id };
  }
  return MUTATION_ACTIONS.has(action) ? { approved: true } : {};
}

module.exports = { validateRequest, MUTATION_ACTIONS, READ_ACTIONS };
