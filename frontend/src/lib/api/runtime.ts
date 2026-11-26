import { api } from "./client";

/** `GET /admin/runtime` (perf audit 2026-11, item 4). Mirrors backend `schemas/runtime.ts`. */
export interface SlowEntry {
  key: string;
  durationMs: number;
  recordedAt: string;
  suppressed: number;
}

export type StatementsStatus = "available" | "notInstalled" | "notLoaded" | "error";

export interface RuntimeReport {
  checkedAt: string;
  uptimeSeconds: number;
  eventLoop: { p50Ms: number; p99Ms: number; maxMs: number; windowMs: number } | null;
  memory: {
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
    heapLimitMb: number;
    externalMb: number;
  };
  database: {
    ping: { ok: boolean; latencyMs: number | null; error?: string };
    pool: { max: number; total: number; idle: number; waiting: number } | null;
    statements: {
      status: StatementsStatus;
      statements: Array<{
        query: string;
        calls: number;
        meanMs: number;
        maxMs: number;
        totalMs: number;
        rows: number;
      }>;
      error?: string;
    };
  };
  jobs: {
    heavySlot: { running: { name: string; stateSince: string } | null; waiting: string[] };
    importWriteSlot: { held: number; waiting: number };
  };
  slowRequests: SlowEntry[];
  slowQueries: SlowEntry[];
}

export const runtimeApi = {
  get: async (): Promise<RuntimeReport> => {
    const { data } = await api.get<RuntimeReport>("/admin/runtime");
    return data;
  },
};
