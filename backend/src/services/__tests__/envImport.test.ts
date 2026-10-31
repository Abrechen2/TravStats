import { prisma } from "../../db";
import { decryptApiKey } from "../../utils/encryption";
import { getApiKey } from "../apiKeyResolver";
import { importServiceEnv } from "../envImport";
import logger from "../../utils/logger";

const SECRET = "env-airlabs-secret-key-0123456789";

async function resetRow(): Promise<void> {
  if (!(await prisma.adminSettings.findFirst())) await prisma.adminSettings.create({ data: {} });
  await prisma.adminSettings.updateMany({
    data: {
      envImportedAt: null,
      globalAirlabsApiKey: null,
      globalAviationstackApiKey: null,
      photonUrl: null,
      railLookupContact: null,
    },
  });
}

describe("one-time import of the service environment variables", () => {
  beforeEach(resetRow);
  afterEach(() => {
    delete process.env.AIRLABS_API_KEY;
    delete process.env.AVIATIONSTACK_API_KEY;
    delete process.env.PHOTON_URL;
    delete process.env.RAIL_LOOKUP_CONTACT;
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("copies a variable into an empty instance field, encrypted, and records the run", async () => {
    process.env.AIRLABS_API_KEY = SECRET;
    process.env.PHOTON_URL = "https://photon.example.org";
    const result = await importServiceEnv(process.env);
    expect(result.imported).toEqual(expect.arrayContaining(["AIRLABS_API_KEY", "PHOTON_URL"]));
    const row = await prisma.adminSettings.findFirstOrThrow({ orderBy: { id: "asc" } });
    expect(row.globalAirlabsApiKey).not.toBeNull();
    expect(row.globalAirlabsApiKey).not.toContain(SECRET);
    expect(decryptApiKey(row.globalAirlabsApiKey as string)).toBe(SECRET);
    expect(row.photonUrl).toBe("https://photon.example.org");
    expect(row.envImportedAt).not.toBeNull();
  });

  it("keeps the instance value when the field is already filled", async () => {
    await prisma.adminSettings.updateMany({ data: { photonUrl: "https://mine.example.org" } });
    process.env.PHOTON_URL = "https://photon.example.org";
    const result = await importServiceEnv(process.env);
    expect(result.skipped).toContain("PHOTON_URL");
    const row = await prisma.adminSettings.findFirstOrThrow({ orderBy: { id: "asc" } });
    expect(row.photonUrl).toBe("https://mine.example.org");
  });

  it("is a no-op on the second boot: a variable set later is ignored", async () => {
    await importServiceEnv(process.env);
    process.env.AVIATIONSTACK_API_KEY = SECRET;
    const second = await importServiceEnv(process.env);
    expect(second.alreadyDone).toBe(true);
    const row = await prisma.adminSettings.findFirstOrThrow({ orderBy: { id: "asc" } });
    expect(row.globalAviationstackApiKey).toBeNull();
  });

  it("makes the resolver ignore the environment, before and after the import", async () => {
    process.env.AIRLABS_API_KEY = SECRET;
    expect((await getApiKey("airlabs")) ?? null).toBeNull();
    await importServiceEnv(process.env);
    // Now it is the instance's key — read from the settings, not from the variable.
    delete process.env.AIRLABS_API_KEY;
    expect(await getApiKey("airlabs")).toBe(SECRET);
  });

  it("logs variable names only, never a value", async () => {
    process.env.AIRLABS_API_KEY = SECRET;
    process.env.RAIL_LOOKUP_CONTACT = "ops@example.org";
    const spy = jest.spyOn(logger, "info");
    await importServiceEnv(process.env);
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).toContain("AIRLABS_API_KEY");
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain("ops@example.org");
  });
});
