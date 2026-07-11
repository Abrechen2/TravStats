jest.mock("../../../db", () => ({
  prisma: {
    adminSettings: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
  },
}));

import { getConsent, setConsent, getOrCreateInstallId, getStatsBaseUrl } from "../consent";
import { prisma } from "../../../db";

const mockPrisma = prisma as unknown as {
  adminSettings: { findFirst: jest.Mock; update: jest.Mock; create: jest.Mock };
};

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.TRAVSTATS_STATS_ENDPOINT;
});

describe("getConsent", () => {
  it("returns the stored state", async () => {
    mockPrisma.adminSettings.findFirst.mockResolvedValue({ id: 7, usageStatsConsent: "granted" });
    await expect(getConsent()).resolves.toBe("granted");
  });

  it("defaults to unset when no settings row exists", async () => {
    mockPrisma.adminSettings.findFirst.mockResolvedValue(null);
    await expect(getConsent()).resolves.toBe("unset");
  });

  it("coerces an unrecognised value to unset", async () => {
    mockPrisma.adminSettings.findFirst.mockResolvedValue({ id: 7, usageStatsConsent: "yolo" });
    await expect(getConsent()).resolves.toBe("unset");
  });
});

describe("setConsent", () => {
  it("rejects an invalid value without touching the DB", async () => {
    await expect(setConsent("maybe" as never)).rejects.toThrow(/invalid consent/i);
    expect(mockPrisma.adminSettings.update).not.toHaveBeenCalled();
  });

  it("updates the singleton by its real id", async () => {
    mockPrisma.adminSettings.findFirst.mockResolvedValue({ id: 7 });
    await setConsent("denied");
    expect(mockPrisma.adminSettings.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { usageStatsConsent: "denied" },
    });
  });
});

describe("getOrCreateInstallId", () => {
  it("returns the existing id without writing", async () => {
    mockPrisma.adminSettings.findFirst.mockResolvedValue({ id: 7, usageStatsInstallId: "abc123" });
    await expect(getOrCreateInstallId()).resolves.toBe("abc123");
    expect(mockPrisma.adminSettings.update).not.toHaveBeenCalled();
  });

  it("generates and persists a 32-char hex id on first call", async () => {
    mockPrisma.adminSettings.findFirst.mockResolvedValue({ id: 7, usageStatsInstallId: null });
    const id = await getOrCreateInstallId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(mockPrisma.adminSettings.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { usageStatsInstallId: id },
    });
  });

  it("is stable across calls", async () => {
    mockPrisma.adminSettings.findFirst.mockResolvedValue({ id: 7, usageStatsInstallId: "stable99" });
    expect(await getOrCreateInstallId()).toBe(await getOrCreateInstallId());
  });
});

describe("getStatsBaseUrl", () => {
  it("defaults to the public endpoint", () => {
    expect(getStatsBaseUrl()).toBe("https://stats.travstats.de");
  });

  it("returns an empty string when explicitly disabled", () => {
    process.env.TRAVSTATS_STATS_ENDPOINT = "";
    expect(getStatsBaseUrl()).toBe("");
  });

  it("strips a trailing slash so path joins stay clean", () => {
    process.env.TRAVSTATS_STATS_ENDPOINT = "https://example.test/";
    expect(getStatsBaseUrl()).toBe("https://example.test");
  });
});
