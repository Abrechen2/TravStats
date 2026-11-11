import { describe, it, expect, jest, beforeEach } from "@jest/globals";

type ScheduleSettings = Pick<
  import("../generated/prisma/client").AdminSettings,
  "backupInterval" | "backupRetentionDays"
>;
const mockFindFirst = jest.fn<() => Promise<ScheduleSettings | null>>();
jest.mock("../db", () => ({
  prisma: {
    adminSettings: { findFirst: mockFindFirst },
    backup: { findFirst: jest.fn(async () => null) },
  },
}));

jest.mock("../services/backupService", () => ({
  createBackup: jest.fn(async () => ({})),
}));

const mockSchedule = jest.fn(() => ({ start: jest.fn(), stop: jest.fn() }));
jest.mock("node-cron", () => ({ schedule: mockSchedule }));

jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

describe("backupScheduler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  it("starts scheduler with daily cron pattern when backupInterval is daily", async () => {
    mockFindFirst.mockResolvedValue({
      backupInterval: "daily",
      backupRetentionDays: 30,
    });
    const { startScheduler } = await import("../services/backupScheduler");

    await startScheduler();

    expect(mockSchedule).toHaveBeenCalledWith("0 2 * * *", expect.any(Function), {
      // The backup keeps the host's zone, read once at boot (schedulerZone.ts).
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  });

  it("starts scheduler with weekly cron pattern when backupInterval is weekly", async () => {
    mockFindFirst.mockResolvedValue({
      backupInterval: "weekly",
      backupRetentionDays: 30,
    });
    const { startScheduler } = await import("../services/backupScheduler");

    await startScheduler();

    expect(mockSchedule).toHaveBeenCalledWith("0 2 * * 0", expect.any(Function), {
      // The backup keeps the host's zone, read once at boot (schedulerZone.ts).
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  });

  it("starts the weekly schedule when adminSettings row is null (automatic backups cannot be switched off)", async () => {
    mockFindFirst.mockResolvedValue(null);
    const { startScheduler } = await import("../services/backupScheduler");

    await startScheduler();

    // Automatic backups are always on (settings v3 S6): a fresh instance without a
    // settings row gets the default weekly schedule instead of none at all.
    expect(mockSchedule).toHaveBeenCalledWith("0 2 * * 0", expect.any(Function), expect.anything());
  });

  it("getScheduleStatus returns running=false when no job is scheduled", async () => {
    mockFindFirst.mockResolvedValue({
      backupInterval: "weekly",
      backupRetentionDays: 30,
    });
    const { getScheduleStatus } = await import("../services/backupScheduler");

    const status = await getScheduleStatus();

    expect(status).toEqual({ running: false });
  });
});
