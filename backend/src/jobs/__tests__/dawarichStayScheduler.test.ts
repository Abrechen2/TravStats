import {
  runDawarichStaySweep,
  startDawarichStayScheduler,
  stopDawarichStayScheduler,
} from "../dawarichStayScheduler";
import { prisma } from "../../db";
import { reserveScan, scanStays } from "../../services/dawarich/stays/scan";
import cron from "node-cron";
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
