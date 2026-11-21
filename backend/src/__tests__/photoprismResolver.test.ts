import { describe, it, expect, jest, beforeEach } from "@jest/globals";

let callerRow: {
  isDemo: boolean;
  username: string;
  isAdmin?: boolean;
  settings: { photoprismBaseUrl?: string | null; photoprismToken?: string | null } | null;
} | null;
const findFirstAdminSettings = jest.fn<() => Promise<Record<string, string | null> | null>>();
const findUniqueUser = jest.fn(async () => callerRow);

jest.mock("../db", () => ({
  prisma: {
    adminSettings: { findFirst: findFirstAdminSettings },
    user: { findUnique: findUniqueUser },
  },
}));
jest.mock("../utils/encryption", () => ({
  decryptApiKey: jest.fn((v: string | null | undefined) =>
    typeof v === "string" ? v.replace(/^enc:/, "") : null
  ),
}));
const connectionGate =
  jest.fn<() => Promise<{ off: "admin" | "account" | null; accountMayConnect: boolean }>>();
jest.mock("../services/externalServices/policy", () => ({ connectionGate }));
jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { getPhotoprismConnection } from "../services/photoprism/photoprismResolver";

const own = { photoprismBaseUrl: "https://own.example.com/", photoprismToken: "enc:own-pw" };
const global = {
  globalPhotoprismBaseUrl: "https://global.example.com",
  globalPhotoprismToken: "enc:global-pw",
};

beforeEach(() => {
  jest.clearAllMocks();
  callerRow = { isDemo: false, username: "someone", isAdmin: false, settings: own };
  findFirstAdminSettings.mockResolvedValue(global);
  connectionGate.mockResolvedValue({ off: null, accountMayConnect: true });
});

describe("getPhotoprismConnection", () => {
  it("prefers the account's own connection; an ordinary account may not reach the LAN", async () => {
    await expect(getPhotoprismConnection("u1")).resolves.toEqual({
      baseUrl: "https://own.example.com",
      apiKey: "own-pw",
      source: "user",
      allowPrivate: false,
    });
  });

  it("keeps LAN access for an admin's own connection", async () => {
    callerRow = { ...callerRow!, isAdmin: true };
    expect(await getPhotoprismConnection("u1")).toMatchObject({
      source: "user",
      allowPrivate: true,
    });
  });

  it("falls through to the admin-global tier (which keeps LAN access) when the account has none", async () => {
    callerRow = {
      ...callerRow!,
      settings: { photoprismBaseUrl: "https://own.example.com", photoprismToken: null },
    };
    expect(await getPhotoprismConnection("u1")).toEqual({
      baseUrl: "https://global.example.com",
      apiKey: "global-pw",
      source: "global",
      allowPrivate: true,
    });
  });

  it("ignores the account's own connection when the admin forbade accounts to connect", async () => {
    connectionGate.mockResolvedValue({ off: null, accountMayConnect: false });
    expect(await getPhotoprismConnection("u1")).toMatchObject({ source: "global" });
  });

  it("resolves nothing when the service is switched off", async () => {
    connectionGate.mockResolvedValue({ off: "account", accountMayConnect: false });
    expect(await getPhotoprismConnection("u1")).toBeNull();
    expect(findFirstAdminSettings).not.toHaveBeenCalled();
  });

  it("keeps a stored LAN URL as the account's connection (refused per request, not swapped for the global one)", async () => {
    callerRow = {
      ...callerRow!,
      settings: { photoprismBaseUrl: "http://192.168.1.5:2342", photoprismToken: "enc:x" },
    };
    expect(await getPhotoprismConnection("u1")).toMatchObject({
      source: "user",
      baseUrl: "http://192.168.1.5:2342",
      allowPrivate: false,
    });
  });

  it("returns null instead of throwing when the lookup fails", async () => {
    findUniqueUser.mockRejectedValueOnce(new Error("db down"));
    expect(await getPhotoprismConnection("u1")).toBeNull();
  });
});
