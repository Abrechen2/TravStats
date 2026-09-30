import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { profileZoneFromSettings, profileZoneOf } from "../profileZone";

/**
 * The profile zone answers "today" (ADR 0002 D4, Q1) and is never allowed to
 * look like a real setting when it is the UTC default.
 */

describe("profileZoneFromSettings", () => {
  it("reads display.timezone when it is a zone", () => {
    expect(profileZoneFromSettings({ display: { timezone: "America/St_Johns" } })).toEqual({
      zone: "America/St_Johns",
      source: "profile",
    });
  });

  it.each([
    ["no settings row", null],
    ["no display block (#87 seeds)", { units: {} }],
    ["an unknown name", { display: { timezone: "Mars/Olympus" } }],
    ["a raw offset", { display: { timezone: "+02:00" } }],
    ["not a string", { display: { timezone: 2 } }],
  ])("labels the UTC stand-in for %s", (_label, data) => {
    expect(profileZoneFromSettings(data)).toEqual({ zone: "UTC", source: "default-utc" });
  });
});

describe("profileZoneOf", () => {
  const USERNAME = "tm-profile-zone";
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("answers the UTC default for a user without settings", async () => {
    expect(await profileZoneOf(userId)).toEqual({ zone: "UTC", source: "default-utc" });
  });

  it("answers the stored zone once the user has one", async () => {
    await prisma.userSettings.create({
      data: { userId, data: { display: { timezone: "Pacific/Kiritimati" } } },
    });
    expect(await profileZoneOf(userId)).toEqual({
      zone: "Pacific/Kiritimati",
      source: "profile",
    });
  });
});
