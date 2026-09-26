import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/** What the user configured — the fixture every case sets. */
const userSettingsRow = jest.fn();
/** The direct `userSettings.findUnique` — served from the same fixture. */
const findUniqueUserSettings = jest.fn(async () => userSettingsRow());
const findFirstAdminSettings = jest.fn();

/**
 * The resolver reads the caller and their settings in ONE `user.findUnique`
 * (who the caller is matters since the 2026-09-17 review, finding A2: the
 * SHARED demo account resolves no connection at all). The fake builds that row
 * from `userSettingsRow`, so each case below still states only what the
 * user configured; `callerRow` says who they are — an ordinary account unless
 * a case says otherwise.
 */
let callerRow: { isDemo: boolean; username: string } | null;
const findUniqueUser = jest.fn(async () =>
  callerRow ? { ...callerRow, settings: await userSettingsRow() } : null
);

jest.mock("../db", () => ({
  prisma: {
    userSettings: { findUnique: findUniqueUserSettings },
    adminSettings: { findFirst: findFirstAdminSettings },
    user: { findUnique: findUniqueUser },
  },
}));

jest.mock("../utils/encryption", () => ({
  // The resolver must call decryptApiKey — the fake strips a marker prefix.
  decryptApiKey: jest.fn((v: string | null | undefined) =>
    typeof v === "string" ? v.replace(/^enc:/, "") : null
  ),
}));

import { getImmichConnection, getImmichDefaultMode } from "../services/immich/immichResolver";

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.IMMICH_BASE_URL;
  delete process.env.IMMICH_API_KEY;
  callerRow = { isDemo: false, username: "someone" };
  userSettingsRow.mockResolvedValue(null);
  findFirstAdminSettings.mockResolvedValue(null);
});

describe("getImmichConnection priority", () => {
  it("prefers the user tier and decrypts the key", async () => {
    userSettingsRow.mockResolvedValue({
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
    userSettingsRow.mockResolvedValue({
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
    userSettingsRow.mockResolvedValue({
      immichBaseUrl: "https://user.lan",
      immichApiKey: "enc:broken",
    });
    process.env.IMMICH_BASE_URL = "https://env.lan";
    process.env.IMMICH_API_KEY = "env-key";

    await expect(getImmichConnection("u1")).resolves.toMatchObject({ source: "env" });
  });

  it("skips a tier whose base URL is unusable rather than throwing", async () => {
    userSettingsRow.mockResolvedValue({
      immichBaseUrl: "file:///etc/passwd",
      immichApiKey: "enc:user-key",
    });
    process.env.IMMICH_BASE_URL = "https://env.lan";
    process.env.IMMICH_API_KEY = "env-key";

    await expect(getImmichConnection("u1")).resolves.toMatchObject({ source: "env" });
  });

  it("ignores the user tier entirely when no userId is given", async () => {
    userSettingsRow.mockResolvedValue({
      immichBaseUrl: "https://user.lan",
      immichApiKey: "enc:user-key",
    });
    findFirstAdminSettings.mockResolvedValue({
      globalImmichBaseUrl: "https://global.lan",
      globalImmichApiKey: "enc:global-key",
    });

    await expect(getImmichConnection()).resolves.toMatchObject({ source: "global" });
    expect(findUniqueUser).not.toHaveBeenCalled();
  });

  it("resolves an ordinary user's own connection with a single read", async () => {
    // The demo check used to be a query of its own in front of the settings
    // read — two round trips on every Immich request, thumbnails included.
    userSettingsRow.mockResolvedValue({
      immichBaseUrl: "https://user.lan",
      immichApiKey: "enc:user-key",
    });

    await expect(getImmichConnection("u1")).resolves.toMatchObject({ source: "user" });
    expect(findUniqueUser).toHaveBeenCalledTimes(1);
    expect(findUniqueUserSettings).not.toHaveBeenCalled();
    expect(findFirstAdminSettings).not.toHaveBeenCalled();
  });

  it("resolves nothing for the shared demo account, not even the global tier", async () => {
    callerRow = { isDemo: true, username: "demo" };
    findFirstAdminSettings.mockResolvedValue({
      globalImmichBaseUrl: "https://global.lan",
      globalImmichApiKey: "enc:global-key",
    });

    await expect(getImmichConnection("demo-id")).resolves.toBeNull();
    expect(findFirstAdminSettings).not.toHaveBeenCalled();
  });

  it("falls through to the global tier for an unknown user id", async () => {
    callerRow = null;
    findFirstAdminSettings.mockResolvedValue({
      globalImmichBaseUrl: "https://global.lan",
      globalImmichApiKey: "enc:global-key",
    });

    await expect(getImmichConnection("gone")).resolves.toMatchObject({ source: "global" });
  });
});

describe("getImmichDefaultMode", () => {
  it("returns the stored mode", async () => {
    userSettingsRow.mockResolvedValue({ immichDefaultMode: "import" });
    await expect(getImmichDefaultMode("u1")).resolves.toBe("import");
  });

  it("defaults to link when unset or invalid", async () => {
    userSettingsRow.mockResolvedValue({ immichDefaultMode: "nonsense" });
    await expect(getImmichDefaultMode("u1")).resolves.toBe("link");

    userSettingsRow.mockResolvedValue(null);
    await expect(getImmichDefaultMode("u1")).resolves.toBe("link");
  });
});
