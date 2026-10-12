const mockCreate = jest.fn();
const mockCleanup = jest.fn();
const mockSchedule = jest.fn(() => ({ start: jest.fn(), stop: jest.fn() }));
jest.mock("node-cron", () => ({ schedule: mockSchedule }));
jest.mock("../services/backupService", () => ({
  createBackup: mockCreate,
  cleanupOldBackups: mockCleanup,
}));
jest.mock("../db", () => ({
  prisma: {
    adminSettings: {
      findFirst: jest.fn(async () => ({ backupEnabled: true, backupInterval: "daily" })),
    },
    backup: { findFirst: jest.fn(async () => null) },
  },
}));
jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { debug: jest.fn(), warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));
import { startScheduler, stopScheduler } from "../services/backupScheduler";

afterEach(() => {
  stopScheduler();
  jest.clearAllMocks();
});
it("prunes only after the scheduled backup succeeds", async () => {
  mockCreate.mockResolvedValue("new");
  await startScheduler();
  const run = (mockSchedule.mock.calls[0] as unknown as [string, () => Promise<void>])[1];
  await run();
  expect(mockCleanup).toHaveBeenCalledTimes(1);
  expect(mockCreate.mock.invocationCallOrder[0]).toBeLessThan(
    mockCleanup.mock.invocationCallOrder[0]
  );
});
it("retains the previous archives when the new dump fails", async () => {
  mockCreate.mockRejectedValue(new Error("dump failed"));
  await startScheduler();
  const run = (mockSchedule.mock.calls[0] as unknown as [string, () => Promise<void>])[1];
  await run();
  expect(mockCleanup).not.toHaveBeenCalled();
});
