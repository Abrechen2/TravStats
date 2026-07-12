import { getApiKey } from "../apiKeyResolver";
import { prisma } from "../../db";
import { encryptApiKey } from "../../utils/encryption";

describe("getApiKey('logostream')", () => {
  beforeAll(async () => {
    // The resolver reads the singleton admin_settings row; ensure it exists
    // so updateMany below actually has a row to write to (fresh DBs).
    const existing = await prisma.adminSettings.findFirst();
    if (!existing) {
      await prisma.adminSettings.create({ data: {} });
    }
  });

  afterEach(async () => {
    await prisma.adminSettings.updateMany({ data: { globalLogostreamApiKey: null } });
    delete process.env.LOGOSTREAM_API_KEY;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // NOTE: test keys are deliberately >= 16 bytes. utils/encryption.ts on this
  // branch has the pre-existing short-secret bug (isEncrypted() length
  // heuristic — fixed as 4a6c6d09 on dev/immich-albums, not yet on main):
  // secrets < 16 bytes fail to round-trip and come back as ciphertext.
  it("prefers the admin-global key over env", async () => {
    process.env.LOGOSTREAM_API_KEY = "env-logostream-key";
    await prisma.adminSettings.updateMany({
      data: { globalLogostreamApiKey: encryptApiKey("global-logostream-key") },
    });
    expect(await getApiKey("logostream")).toBe("global-logostream-key");
  });

  it("falls back to env when no global key is set", async () => {
    process.env.LOGOSTREAM_API_KEY = "env-logostream-key";
    expect(await getApiKey("logostream")).toBe("env-logostream-key");
  });

  it("returns null when neither exists", async () => {
    expect(await getApiKey("logostream")).toBeNull();
  });
});
