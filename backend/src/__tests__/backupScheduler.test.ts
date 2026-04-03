import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const mockFindFirst = jest.fn();
jest.mock("../db", () => ({
  prisma: {
    adminSettings: { findFirst: mockFindFirst },
    backup: { findFirst: jest.fn().mockResolvedValue(null) },
  },
}));

jest.mock("../services/backupService", () => ({
  createBackup: jest.fn().mockResolvedValue({}),
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

  it("does not start scheduler when backupEnabled is false in DB", async () => {
    mockFindFirst.mockResolvedValue({
      backupEnabled: false,
      backupInterval: "weekly",
      backupRetentionDays: 30,
    });
    const { startScheduler } = await import("../services/backupScheduler");

    await startScheduler();

    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it("starts scheduler with daily cron pattern when backupInterval is daily", async () => {
    mockFindFirst.mockResolvedValue({
      backupEnabled: true,
      backupInterval: "daily",
      backupRetentionDays: 30,
    });
    const { startScheduler } = await import("../services/backupScheduler");

    await startScheduler();

    expect(mockSchedule).toHaveBeenCalledWith("0 2 * * *", expect.any(Function));
  });

  it("starts scheduler with weekly cron pattern when backupInterval is weekly", async () => {
    mockFindFirst.mockResolvedValue({
      backupEnabled: true,
      backupInterval: "weekly",
      backupRetentionDays: 30,
    });
    const { startScheduler } = await import("../services/backupScheduler");

    await startScheduler();

    expect(mockSchedule).toHaveBeenCalledWith("0 2 * * 0", expect.any(Function));
  });

  it("uses default values when adminSettings row is null", async () => {
    mockFindFirst.mockResolvedValue(null);
    const { startScheduler } = await import("../services/backupScheduler");

    await startScheduler();

    // Default enabled=false, so scheduler should NOT start
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it("getScheduleStatus returns running=false when no job is scheduled", async () => {
    mockFindFirst.mockResolvedValue({
      backupEnabled: true,
      backupInterval: "weekly",
      backupRetentionDays: 30,
    });
    const { getScheduleStatus } = await import("../services/backupScheduler");

    const status = await getScheduleStatus();

    expect(status).toEqual({ running: false });
  });
});
