import fs from "fs";
import path from "path";

import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { generateApiToken } from "../utils/apiTokens";
import { legacyPref, REMINDER_DOMAINS, REMINDER_USER_SELECT } from "../services/reminders/prefs";

/**
 * The backfill of 20261031120900_reminders_per_domain: every account gets, per
 * domain, what it gets today — mail from the e-mail switches, the app channel
 * where a paired device has its reminder switch on — and nothing is switched
 * on that was off. The statement is replayed from the migration file against
 * real accounts and cross-checked against `legacyPref`, the TypeScript twin
 * that serves accounts created later.
 */
const SQL = fs
  .readFileSync(
    path.join(
      __dirname,
      "../../prisma/migrations/20261031120900_reminders_per_domain/migration.sql"
    ),
    "utf-8"
  )
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");
const BACKFILL = SQL.slice(SQL.indexOf('INSERT INTO "reminder_preferences"')).trim();

const CASES = [
  { name: "mail24", email: "x@e.com", h24: true, h2: false, device: false },
  { name: "mailboth", email: "x@e.com", h24: true, h2: true, device: false },
  { name: "mail2", email: "x@e.com", h24: false, h2: true, device: false },
  { name: "noemail", email: null, h24: true, h2: true, device: false },
  { name: "pushonly", email: null, h24: false, h2: false, device: true },
  { name: "both", email: "x@e.com", h24: true, h2: true, device: true },
  { name: "off", email: "x@e.com", h24: false, h2: false, device: false },
];

describe("reminders_per_domain backfill", () => {
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    for (const c of CASES) {
      const username = `migrem_${c.name}`;
      await prisma.user.deleteMany({ where: { username } });
      const u = await prisma.user.create({
        data: {
          username,
          passwordHash: await hashPassword("password123"),
          notificationEmail: c.email,
          notifyBefore24h: c.h24,
          notifyBefore2h: c.h2,
        },
      });
      ids[c.name] = u.id;
      if (c.device) {
        const gen = await generateApiToken();
        const tok = await prisma.apiToken.create({
          data: {
            userId: u.id,
            label: "d",
            scope: "write",
            lookupHash: gen.lookupHash,
            hash: gen.hash,
            deviceId: "d",
          },
        });
        await prisma.devicePush.create({
          data: {
            apiTokenId: tok.id,
            userId: u.id,
            platform: "ios",
            token: "t".repeat(32),
            publicKey: Buffer.alloc(32, 1).toString("base64url"),
            reminders: true,
          },
        });
      }
    }
    await prisma.reminderPreference.deleteMany({ where: { userId: { in: Object.values(ids) } } });
    await prisma.$executeRawUnsafe(BACKFILL);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
    await prisma.$disconnect();
  });

  const rowOf = async (name: string, domain: string) =>
    prisma.reminderPreference.findUniqueOrThrow({
      where: { userId_domain: { userId: ids[name], domain } },
    });

  it("gives every account one row per domain", async () => {
    for (const c of CASES) {
      const rows = await prisma.reminderPreference.count({ where: { userId: ids[c.name] } });
      expect(rows).toBe(REMINDER_DOMAINS.length);
    }
  });

  it("mail follows the e-mail switches; lodging follows the 24 h switch only", async () => {
    expect(await rowOf("mail24", "rail")).toMatchObject({
      enabled: true,
      leadHours: [24],
      channel: "mail",
    });
    expect(await rowOf("mailboth", "flight")).toMatchObject({
      enabled: true,
      leadHours: [24, 2],
      channel: "mail",
    });
    expect(await rowOf("mailboth", "lodging")).toMatchObject({
      enabled: true,
      leadHours: [24],
      channel: "mail",
    });
    expect((await rowOf("mail2", "lodging")).enabled).toBe(false);
    expect(await rowOf("mail2", "bus")).toMatchObject({ enabled: true, leadHours: [2] });
  });

  it("switches nothing on that was off (no address, or no switch)", async () => {
    expect((await rowOf("noemail", "flight")).enabled).toBe(false);
    expect((await rowOf("off", "cruise")).enabled).toBe(false);
  });

  it("keeps push on where a paired device has its reminder switch on", async () => {
    expect(await rowOf("pushonly", "flight")).toMatchObject({
      enabled: true,
      channel: "app",
      leadHours: [24, 2],
    });
    expect(await rowOf("both", "ferry")).toMatchObject({
      enabled: true,
      channel: "both",
      leadHours: [24, 2],
    });
  });

  it("is idempotent: a second run changes nothing", async () => {
    await prisma.reminderPreference.update({
      where: { userId_domain: { userId: ids.mail24, domain: "rail" } },
      data: { leadHours: [24, 7] },
    });
    await prisma.$executeRawUnsafe(BACKFILL);
    expect((await rowOf("mail24", "rail")).leadHours).toEqual([24, 7]);
    expect(await prisma.reminderPreference.count({ where: { userId: ids.mail24 } })).toBe(6);
  });

  it("the TypeScript fallback answers like the SQL for every case and domain", async () => {
    await prisma.reminderPreference.deleteMany({ where: { userId: { in: Object.values(ids) } } });
    await prisma.$executeRawUnsafe(BACKFILL);
    for (const c of CASES) {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: ids[c.name] },
        select: REMINDER_USER_SELECT.select,
      });
      for (const domain of REMINDER_DOMAINS) {
        const row = await rowOf(c.name, domain);
        expect({ enabled: row.enabled, leadHours: row.leadHours, channel: row.channel }).toEqual(
          legacyPref({ ...user, reminderPreferences: [] }, domain)
        );
      }
    }
  });
});
