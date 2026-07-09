import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const findUniqueUserSettings = jest.fn();
const findFirstAdminSettings = jest.fn();

jest.mock("../db", () => ({
  prisma: {
    userSettings: { findUnique: findUniqueUserSettings },
    adminSettings: { findFirst: findFirstAdminSettings },
  },
}));

jest.mock("../utils/encryption", () => ({
  // The resolver must call decryptApiKey — the fake strips a marker prefix.
  decryptApiKey: jest.fn((v: string | null | undefined) =>
    typeof v === "string" ? v.replace(/^enc:/, "") : null,
  ),
}));

import { getImmichConnection, getImmichDefaultMode } from "../services/immich/immichResolver";

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.IMMICH_BASE_URL;
  delete process.env.IMMICH_API_KEY;
  findUniqueUserSettings.mockResolvedValue(null);
  findFirstAdminSettings.mockResolvedValue(null);
});

describe("getImmichConnection priority", () => {
  it("prefers the user tier and decrypts the key", async () => {
    findUniqueUserSettings.mockResolvedValue({
      immichBaseUrl: "https://user.lan/",
      immichApiKey: "enc:user-key",
    });
    findFirstAdminSettings.mockResolvedValue({
      globalImmichBaseUrl: "https://global.lan",
      globalImmichApiKey: "enc:global-key",
    });

    await expect(getImmichConnection("u1")).resolves.toEqual({
      baseUrl: "https://user.lan",
      apiKey: "user-key",
      source: "user",
    });
  });

  it("falls through to global when the user tier has a URL but no key", async () => {
    findUniqueUserSettings.mockResolvedValue({
      immichBaseUrl: "https://user.lan",
      immichApiKey: null,
    });
    findFirstAdminSettings.mockResolvedValue({
      globalImmichBaseUrl: "https://global.lan",
      globalImmichApiKey: "enc:global-key",
    });

    await expect(getImmichConnection("u1")).resolves.toMatchObject({
      baseUrl: "https://global.lan",
      source: "global",
    });
  });

  it("falls through to ENV when neither DB tier is complete", async () => {
    process.env.IMMICH_BASE_URL = "https://env.lan/";
    process.env.IMMICH_API_KEY = "env-key";

    await expect(getImmichConnection("u1")).resolves.toEqual({
      baseUrl: "https://env.lan",
      apiKey: "env-key",
      source: "env",
    });
  });

  it("returns null when nothing is configured", async () => {
    await expect(getImmichConnection("u1")).resolves.toBeNull();
  });

  it("skips a tier whose key fails to decrypt", async () => {
    const { decryptApiKey } = jest.requireMock("../utils/encryption") as {
      decryptApiKey: jest.Mock;
    };
    decryptApiKey.mockReturnValueOnce(null); // user key is corrupt
    findUniqueUserSettings.mockResolvedValue({
      immichBaseUrl: "https://user.lan",
      immichApiKey: "enc:broken",
    });
    process.env.IMMICH_BASE_URL = "https://env.lan";
    process.env.IMMICH_API_KEY = "env-key";

    await expect(getImmichConnection("u1")).resolves.toMatchObject({ source: "env" });
  });

  it("skips a tier whose base URL is unusable rather than throwing", async () => {
    findUniqueUserSettings.mockResolvedValue({
      immichBaseUrl: "file:///etc/passwd",
      immichApiKey: "enc:user-key",
    });
    process.env.IMMICH_BASE_URL = "https://env.lan";
    process.env.IMMICH_API_KEY = "env-key";

    await expect(getImmichConnection("u1")).resolves.toMatchObject({ source: "env" });
  });

  it("ignores the user tier entirely when no userId is given", async () => {
    findUniqueUserSettings.mockResolvedValue({
      immichBaseUrl: "https://user.lan",
      immichApiKey: "enc:user-key",
    });
    findFirstAdminSettings.mockResolvedValue({
      globalImmichBaseUrl: "https://global.lan",
      globalImmichApiKey: "enc:global-key",
    });

    await expect(getImmichConnection()).resolves.toMatchObject({ source: "global" });
    expect(findUniqueUserSettings).not.toHaveBeenCalled();
  });
});

describe("getImmichDefaultMode", () => {
  it("returns the stored mode", async () => {
    findUniqueUserSettings.mockResolvedValue({ immichDefaultMode: "import" });
    await expect(getImmichDefaultMode("u1")).resolves.toBe("import");
  });

  it("defaults to link when unset or invalid", async () => {
    findUniqueUserSettings.mockResolvedValue({ immichDefaultMode: "nonsense" });
    await expect(getImmichDefaultMode("u1")).resolves.toBe("link");

    findUniqueUserSettings.mockResolvedValue(null);
    await expect(getImmichDefaultMode("u1")).resolves.toBe("link");
  });
});
