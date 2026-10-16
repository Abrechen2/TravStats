import {
  runDawarichStaySweep,
  startDawarichStayScheduler,
  stopDawarichStayScheduler,
} from "../dawarichStayScheduler";
import { prisma } from "../../db";
import { reserveScan, scanStays } from "../../services/dawarich/stays/scan";
import cron from "node-cron";
import logger from "../../utils/logger";
import { AppError } from "../../middleware/errorHandler";
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.mock("../../db", () => ({ prisma: { dawarichStayScan: { findMany: jest.fn() } } }));
jest.mock("../../services/dawarich/stays/scan", () => ({
  reserveScan: jest.fn(),
  scanStays: jest.fn(),
}));
jest.mock("node-cron", () => ({ schedule: jest.fn(() => ({ stop: jest.fn() })) }));
beforeEach(() => {
  jest.clearAllMocks();
  stopDawarichStayScheduler();
});
it("continues after one unavailable account and asks only for explicitly enabled scans", async () => {
  (prisma.dawarichStayScan.findMany as jest.Mock).mockResolvedValue([
    { userId: "offline" },
    { userId: "ready" },
  ]);
  jest.mocked(reserveScan).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce();
  await runDawarichStaySweep();
  expect(prisma.dawarichStayScan.findMany).toHaveBeenCalledWith({
    where: { enabled: true },
    select: { userId: true },
  });
  expect(scanStays).toHaveBeenCalledTimes(1);
  expect(scanStays).toHaveBeenCalledWith("ready");
});
it("runs on a UTC schedule, never at boot, and only installs one task", () => {
  startDawarichStayScheduler();
  startDawarichStayScheduler();
  expect(cron.schedule).toHaveBeenCalledTimes(1);
  expect(cron.schedule).toHaveBeenCalledWith("15 */6 * * *", expect.any(Function), {
    timezone: "UTC",
  });
  expect(scanStays).not.toHaveBeenCalled();
});
it("logs the cause of an unexpected account failure instead of swallowing it", async () => {
  (prisma.dawarichStayScan.findMany as jest.Mock).mockResolvedValue([{ userId: "broken" }]);
  const cause = new Error("connection terminated");
  jest.mocked(reserveScan).mockRejectedValueOnce(cause);
  await runDawarichStaySweep();
  expect(logger.error).toHaveBeenCalledWith(
    expect.objectContaining({
      operation: "dawarich_stay_scan_failed",
      userId: "broken",
      err: cause,
    }),
    expect.any(String)
  );
});
it("keeps an expected refusal (already running, disabled) at warn level with its code", async () => {
  (prisma.dawarichStayScan.findMany as jest.Mock).mockResolvedValue([{ userId: "busy" }]);
  jest
    .mocked(reserveScan)
    .mockRejectedValueOnce(new AppError("busy", 409, "DAWARICH_SCAN_UNAVAILABLE"));
  await runDawarichStaySweep();
  expect(logger.error).not.toHaveBeenCalled();
  expect(logger.warn).toHaveBeenCalledWith(
    expect.objectContaining({ userId: "busy", code: "DAWARICH_SCAN_UNAVAILABLE" }),
    expect.any(String)
  );
});
it("logs the cause when the whole sweep fails", async () => {
  const cause = new Error("database down");
  (prisma.dawarichStayScan.findMany as jest.Mock).mockRejectedValue(cause);
  startDawarichStayScheduler();
  const tick = (cron.schedule as jest.Mock).mock.calls[0][1] as () => Promise<void>;
  await tick();
  expect(logger.error).toHaveBeenCalledWith(
    expect.objectContaining({ operation: "dawarich_stay_sweep_failed", err: cause }),
    expect.any(String)
  );
});
