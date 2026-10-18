import { version as APP_VERSION } from "../../package.json";
import catalog from "../../shared/catalog.json";

type Bridge = Record<string, (...args: any[]) => any>;
declare global {
  interface Window {
    optimizer?: Bridge;
  }
}

export type Tweak = (typeof catalog.tweaks)[number];
export const categories = catalog.categories;
export const profiles = catalog.profiles;

const previewError = {
  ok: false,
  preview: true,
  error:
    "Open the Windows desktop app to use this feature. Browser preview cannot read or change your PC.",
};
const initialState = {
  ok: true,
  mode: "preview",
  isAdmin: false,
  restoreAvailable: false,
  appliedIds: [],
  history: [],
  version: APP_VERSION,
};

function historyEntries(entries: any[]) {
  return (entries || []).map((entry) => ({
    ...entry,
    count: entry.count ?? entry.tweakIds?.length ?? 0,
  }));
}

async function call(method: string, args: any[] = []): Promise<any> {
  const bridge = window.optimizer;
  if (!bridge?.[method]) return { ...previewError };
  try {
    return await bridge[method](...args);
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Operation failed. Please retry.",
    };
  }
}

function normalizeScan(result: any) {
  if (!result.ok) return result;
  const memory = result.memory || {};
  return {
    ...result,
    timestamp: new Date().toISOString(),
    cpu: {
      ...result.cpu,
      threads: result.cpu?.logicalProcessors ?? result.cpu?.threads,
    },
    gpu: (result.gpu || []).map((gpu: any) => ({
      ...gpu,
      vramGB: gpu.vramBytes
        ? Number((gpu.vramBytes / 2 ** 30).toFixed(1))
        : null,
    })),
    memory: {
      ...memory,
      totalGB: memory.totalBytes
        ? Math.round(memory.totalBytes / 2 ** 30)
        : null,
      speedMHz:
        memory.slots?.[0]?.configuredSpeedMhz ??
        memory.slots?.[0]?.speedMhz ??
        null,
      modules: memory.slots || [],
    },
    motherboard: result.board || result.motherboard,
    disks: (result.disks || []).map((disk: any) => ({
      ...disk,
      sizeGB: disk.sizeBytes
        ? Number((disk.sizeBytes / 10 ** 9).toFixed(1))
        : null,
    })),
    monitor: result.monitors || [],
  };
}

export const api = {
  async getState(): Promise<any> {
    if (!window.optimizer) return { ...initialState };
    const result = await call("getState");
    return {
      ...result,
      version: APP_VERSION,
      history: historyEntries(result.history),
      appliedIds: result.appliedIds || [],
    };
  },
  async listTweaks(): Promise<any[]> {
    return catalog.tweaks;
  },
  async scan(): Promise<any> {
    return normalizeScan(await call("scan"));
  },
  async applyTweaks(
    ids: string[],
    options: { approved: true; createRestorePoint: true },
  ): Promise<any> {
    return call("applyTweaks", [ids, options]);
  },
  async restoreBackup(id: string, options: { approved: true }): Promise<any> {
    return call("restoreBackup", [id, options]);
  },
  async createRestorePoint(options: { approved: true }): Promise<any> {
    return call("createRestorePoint", [options]);
  },
  async analyzeCleanup(): Promise<any> {
    return call("analyzeCleanup");
  },
  async clean(ids: string[], options: { approved: true }): Promise<any> {
    return call("clean", [ids, options]);
  },
  async cs2Scan(): Promise<any> {
    const r = await call("cs2Scan");
    return { ...r, found: r.installed ?? r.found ?? false };
  },
  async cs2Apply(options: { approved: true }): Promise<any> {
    return call("cs2Apply", [options]);
  },
  async cs2Restore(options: { approved: true }): Promise<any> {
    return call("cs2Restore", [options]);
  },
  async elevate(options: { approved: true }): Promise<any> {
    return call("elevate", [options]);
  },
  onProgress(callback: (progress: any) => void): () => void {
    return window.optimizer?.onProgress?.(callback) || (() => {});
  },
};

export default api;
