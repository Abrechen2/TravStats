import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const findUniqueUserSettings = jest.fn();
const findFirstAdminSettings = jest.fn();

jest.mock("../../../db", () => ({
  prisma: {
    userSettings: { findUnique: findUniqueUserSettings },
    adminSettings: { findFirst: findFirstAdminSettings },
  },
}));

jest.mock("../../../utils/encryption", () => ({
  // The resolver must call decryptApiKey — the fake strips a marker prefix.
  decryptApiKey: jest.fn((v: string | null | undefined) =>
    typeof v === "string" ? v.replace(/^enc:/, "") : null,
  ),
}));

import { getDawarichConnection } from "../dawarichResolver";

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.DAWARICH_BASE_URL;
  delete process.env.DAWARICH_API_KEY;
  findUniqueUserSettings.mockResolvedValue(null);
  findFirstAdminSettings.mockResolvedValue(null);
});

describe("getDawarichConnection priority", () => {
  it("prefers the user tier and decrypts the key", async () => {
    findUniqueUserSettings.mockResolvedValue({
      dawarichBaseUrl: "https://user.lan/",
      dawarichApiKey: "enc:user-key",
    });
    findFirstAdminSettings.mockResolvedValue({
      globalDawarichBaseUrl: "https://global.lan",
      globalDawarichApiKey: "enc:global-key",
    });

    await expect(getDawarichConnection("u1")).resolves.toEqual({
      baseUrl: "https://user.lan",
      apiKey: "user-key",
      source: "user",
    });
  });

  it("falls through to global when the user tier has a URL but no key", async () => {
    findUniqueUserSettings.mockResolvedValue({
      dawarichBaseUrl: "https://user.lan",
      dawarichApiKey: null,
    });
    findFirstAdminSettings.mockResolvedValue({
      globalDawarichBaseUrl: "https://global.lan",
      globalDawarichApiKey: "enc:global-key",
    });

    await expect(getDawarichConnection("u1")).resolves.toMatchObject({
      baseUrl: "https://global.lan",
      source: "global",
    });
  });

  it("falls through to ENV when neither DB tier is complete", async () => {
    process.env.DAWARICH_BASE_URL = "https://env.lan/";
    process.env.DAWARICH_API_KEY = "env-key";

    await expect(getDawarichConnection("u1")).resolves.toEqual({
      baseUrl: "https://env.lan",
      apiKey: "env-key",
      source: "env",
    });
  });

  it("returns null when nothing is configured", async () => {
    await expect(getDawarichConnection("u1")).resolves.toBeNull();
  });

  it("skips a tier whose key fails to decrypt", async () => {
    const { decryptApiKey } = jest.requireMock("../../../utils/encryption") as {
      decryptApiKey: jest.Mock;
    };
    decryptApiKey.mockReturnValueOnce(null); // user key is corrupt
    findUniqueUserSettings.mockResolvedValue({
      dawarichBaseUrl: "https://user.lan",
      dawarichApiKey: "enc:broken",
    });
    process.env.DAWARICH_BASE_URL = "https://env.lan";
    process.env.DAWARICH_API_KEY = "env-key";

    await expect(getDawarichConnection("u1")).resolves.toMatchObject({ source: "env" });
  });

  it("skips a tier whose base URL is unusable rather than throwing", async () => {
    findUniqueUserSettings.mockResolvedValue({
      dawarichBaseUrl: "file:///etc/passwd",
      dawarichApiKey: "enc:user-key",
    });
    process.env.DAWARICH_BASE_URL = "https://env.lan";
    process.env.DAWARICH_API_KEY = "env-key";

    await expect(getDawarichConnection("u1")).resolves.toMatchObject({ source: "env" });
  });

  it("ignores the user tier entirely when no userId is given", async () => {
    findUniqueUserSettings.mockResolvedValue({
      dawarichBaseUrl: "https://user.lan",
      dawarichApiKey: "enc:user-key",
    });
    findFirstAdminSettings.mockResolvedValue({
      globalDawarichBaseUrl: "https://global.lan",
      globalDawarichApiKey: "enc:global-key",
    });

    await expect(getDawarichConnection()).resolves.toMatchObject({ source: "global" });
    expect(findUniqueUserSettings).not.toHaveBeenCalled();
  });
});
