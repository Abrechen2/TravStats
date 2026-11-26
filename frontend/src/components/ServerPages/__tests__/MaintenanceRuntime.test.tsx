import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import MaintenanceRuntime from "../MaintenanceRuntime";

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../../../lib/api/runtime", () => ({ runtimeApi: api }));

/**
 * Perf audit 2026-11, item 4: the admin sees what the server is doing, and
 * where pg_stat_statements is missing the card says so and how to enable it.
 */
const report = (statements: object = { status: "notInstalled", statements: [] }) => ({
  checkedAt: "2026-11-26T10:00:00.000Z",
  uptimeSeconds: 100,
  eventLoop: { p50Ms: 10, p99Ms: 40, maxMs: 80, windowMs: 60000 },
  memory: { rssMb: 400, heapUsedMb: 200, heapTotalMb: 260, heapLimitMb: 1126, externalMb: 5 },
  database: {
    ping: { ok: true, latencyMs: 1.2 },
    pool: { max: 10, total: 3, idle: 2, waiting: 0 },
    statements,
  },
  jobs: {
    heavySlot: {
      running: { name: "dataQualitySweep", stateSince: "2026-11-26T04:10:00.000Z" },
      waiting: [],
    },
    importWriteSlot: { held: 0, waiting: 0 },
  },
  slowRequests: [
    {
      key: "GET /api/v1/stats",
      durationMs: 1800,
      recordedAt: "2026-11-26T09:00:00.000Z",
      suppressed: 2,
    },
  ],
  slowQueries: [],
});

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("the runtime card", () => {
  it("says pg_stat_statements is not enabled, with how", async () => {
    api.get.mockResolvedValue(report());
    render(<MaintenanceRuntime />);
    expect(
      await screen.findByText("settingsRows:maintenance.runtime.statements.notInstalled")
    ).toBeInTheDocument();
    expect(screen.getByText("settingsRows:maintenance.runtime.jobs.running")).toBeInTheDocument();
    expect(screen.getByText("GET /api/v1/stats")).toBeInTheDocument();
  });

  it("lists the slowest statements when available", async () => {
    api.get.mockResolvedValue(
      report({
        status: "available",
        statements: [
          {
            query: "SELECT DISTINCT $1",
            calls: 3,
            meanMs: 812,
            maxMs: 1200,
            totalMs: 2436,
            rows: 9,
          },
        ],
      })
    );
    render(<MaintenanceRuntime />);
    expect(await screen.findByText("SELECT DISTINCT $1")).toBeInTheDocument();
  });

  it("says so when the report cannot be loaded", async () => {
    api.get.mockRejectedValue(new Error("network"));
    render(<MaintenanceRuntime />);
    expect(
      await screen.findByText("settingsRows:maintenance.runtime.loadFailed")
    ).toBeInTheDocument();
  });
});
