import { prisma } from "../../../db";
import { encryptApiKey } from "../../../utils/encryption";
import { providerFor } from "../resolveProvider";
import { travTrackSwitches } from "../../travtrack/__tests__/switches";
import { makeUser } from "../../travtrack/__tests__/fixtures";

/**
 * Which provider an entry reads (TravTrack plan T4): the chosen one, only while
 * it works, and Dawarich only through the user's OWN connection.
 */

const PREFIX = "travtrack-resolve-";

describe("providerFor", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let adminBefore: { id: number; url: string | null; key: string | null } | null = null;

  const settings = (data: Record<string, unknown>) =>
    prisma.userSettings.upsert({
      where: { userId },
      create: { userId, data: {}, ...data },
      update: data,
    });

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
    const admin = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
    if (admin) {
      adminBefore = {
        id: admin.id,
        url: admin.globalDawarichBaseUrl,
        key: admin.globalDawarichApiKey,
      };
    }
  });

  beforeEach(async () => {
    await prisma.userSettings.deleteMany({ where: { userId } });
    await switches.set({ beta: true, config: true });
  });

  afterAll(async () => {
    await switches.restore();
    if (adminBefore) {
      await prisma.adminSettings.update({
        where: { id: adminBefore.id },
        data: { globalDawarichBaseUrl: adminBefore.url, globalDawarichApiKey: adminBefore.key },
      });
    }
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("none → null", async () => {
    expect(await providerFor(userId)).toBeNull();
  });

  it("travtrack while the instance is on → TravTrack; while it is off → null", async () => {
    await settings({ locationProvider: "travtrack" });
    expect((await providerFor(userId))?.kind).toBe("travtrack");
    await switches.set({ beta: true, config: false });
    expect(await providerFor(userId)).toBeNull();
  });

  it("dawarich with an own connection → Dawarich", async () => {
    await settings({
      locationProvider: "dawarich",
      dawarichBaseUrl: "http://dawarich.local:3000",
      dawarichApiKey: encryptApiKey("own"),
    });
    expect((await providerFor(userId))?.kind).toBe("dawarich");
  });

  it("dawarich with only the admin-global connection → null", async () => {
    const admin = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
    const id = admin ? admin.id : (await prisma.adminSettings.create({ data: {} })).id;
    await prisma.adminSettings.update({
      where: { id },
      data: {
        globalDawarichBaseUrl: "http://shared.local:3000",
        globalDawarichApiKey: encryptApiKey("shared"),
      },
    });
    await settings({ locationProvider: "dawarich" });
    expect(await providerFor(userId)).toBeNull();
  });
});
