import fs from "fs";
import os from "os";
import path from "path";

process.env.TRAVSTATS_LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "travstats-debug24-"));

import { prisma } from "../../db";
import { ensureAdminSettings } from "../instanceSettingsService";
import {
  DEBUG_LOGGING_HOURS,
  applyLoggingConfig,
  getLoggingConfig,
  invalidateCache,
  toggleDebugLogging,
  updateLoggingConfig,
} from "../loggingConfig";

/**
 * Settings v3 `debug24`: verbose logging that ends itself after 24 hours. Before, the
 * toggle stayed on until somebody remembered it; now it stores an until-instant that
 * the config read, the boot apply and an in-process timer all honour.
 */
describe("verbose logging switches itself off after 24 h", () => {
  let rowId: number;
  let original: { logLevel: string; debugUntil: Date | null };

  const stored = () =>
    prisma.adminSettings.findUniqueOrThrow({
      where: { id: rowId },
      select: { logLevel: true, debugUntil: true },
    });

  beforeAll(async () => {
    const row = await ensureAdminSettings();
    rowId = row.id;
    original = { logLevel: row.logLevel, debugUntil: row.debugUntil };
  });
  afterEach(async () => {
    await prisma.adminSettings.update({ where: { id: rowId }, data: original });
    invalidateCache();
    await applyLoggingConfig();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("switching on stores debug and an until-instant 24 h ahead", async () => {
    const before = Date.now();
    const config = await toggleDebugLogging(true);
    const row = await stored();
    expect(row.logLevel).toBe("debug");
    const until = row.debugUntil!.getTime();
    expect(until).toBeGreaterThanOrEqual(before + DEBUG_LOGGING_HOURS * 3_600_000 - 1000);
    expect(until).toBeLessThanOrEqual(Date.now() + DEBUG_LOGGING_HOURS * 3_600_000 + 1000);
    expect(config.debugUntil).toBe(row.debugUntil!.toISOString());
  });

  it("switching off clears the timer and goes back to info at once", async () => {
    await toggleDebugLogging(true);
    const config = await toggleDebugLogging(false);
    expect(await stored()).toEqual({ logLevel: "info", debugUntil: null });
    expect(config.debugUntil).toBeNull();
  });

  it("a read after the instant puts the level back to info and clears it, even from a warm cache", async () => {
    await toggleDebugLogging(true);
    await getLoggingConfig(); // warm the cache with the running timer
    await prisma.adminSettings.update({
      where: { id: rowId },
      data: { debugUntil: new Date(Date.now() - 1000) },
    });
    invalidateCache();
    const config = await getLoggingConfig();
    expect(config.logLevel).toBe("info");
    expect(config.debugUntil).toBeNull();
    expect(await stored()).toEqual({ logLevel: "info", debugUntil: null });
  });

  it("the boot apply reverts a period that ran out while the server was down", async () => {
    await prisma.adminSettings.update({
      where: { id: rowId },
      data: { logLevel: "debug", debugUntil: new Date(Date.now() - 60_000) },
    });
    invalidateCache();
    const applied = await applyLoggingConfig();
    expect(applied.logLevel).toBe("info");
    expect(await stored()).toEqual({ logLevel: "info", debugUntil: null });
  });

  it("the in-process timer reverts the level when the instant passes", async () => {
    await prisma.adminSettings.update({
      where: { id: rowId },
      data: { logLevel: "debug", debugUntil: new Date(Date.now() + 150) },
    });
    invalidateCache();
    await applyLoggingConfig();
    expect((await stored()).logLevel).toBe("debug");
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(await stored()).toEqual({ logLevel: "info", debugUntil: null });
  });

  it("picking a quiet level by hand ends the timer; picking another verbose one keeps it", async () => {
    await toggleDebugLogging(true);
    const running = (await stored()).debugUntil!;
    await updateLoggingConfig({ logLevel: "trace" });
    expect((await stored()).debugUntil).toEqual(running);
    await updateLoggingConfig({ logLevel: "warn" });
    expect(await stored()).toEqual({ logLevel: "warn", debugUntil: null });
  });

  it("a failed revert keeps the period armed for a retry instead of forgetting it", async () => {
    // A running period the server knows about, then the moment it lapses.
    await prisma.adminSettings.update({
      where: { id: rowId },
      data: { logLevel: "debug", debugUntil: new Date(Date.now() + 60_000) },
    });
    invalidateCache();
    await getLoggingConfig();
    const lapsed = new Date(Date.now() - 1000);
    await prisma.adminSettings.update({
      where: { id: rowId },
      data: { logLevel: "debug", debugUntil: lapsed },
    });
    invalidateCache();
    const spy = jest
      .spyOn(prisma.adminSettings, "updateMany")
      .mockRejectedValueOnce(new Error("database went away"));
    try {
      const applied = await applyLoggingConfig();
      expect(spy).toHaveBeenCalled();
      expect(applied.debugUntil).not.toBeNull();
      expect(await stored()).toEqual({ logLevel: "debug", debugUntil: lapsed });
    } finally {
      spy.mockRestore();
    }
    invalidateCache();
    expect((await getLoggingConfig()).debugUntil).toBeNull();
    expect(await stored()).toEqual({ logLevel: "info", debugUntil: null });
  });
});
