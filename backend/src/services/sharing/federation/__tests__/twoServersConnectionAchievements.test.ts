/**
 * The `achievements` switch of a connection (spec 2026-11-02 §2) and the outbox drop of a switch
 * change nobody heard. Driven through the real signed transport; each test names its defect.
 */
import { randomUUID } from "crypto";
import {
  OFF,
  connect,
  setOffline,
  A,
  B,
  servers,
  user,
  useTwoServers,
  type Server,
} from "./twoServerHarness";

useTwoServers();
let a: Server;
let b: Server;
beforeAll(() => {
  ({ a, b } = servers);
});

const expectCode = (p: Promise<unknown>, code: string) => expect(p).rejects.toMatchObject({ code });

async function people() {
  const anna = await user(a, "Anna");
  const ben = await user(b, "Ben");
  await b.prisma.user.update({ where: { id: ben }, data: { federationFindable: true } });
  return { anna, ben };
}

/** A badge on Anna's server: `held` decides whether her progress meets the requirement. */
async function badge(s: Server, userId: string, domain: string, held: boolean, points = 50) {
  const code = `CONN_${randomUUID().slice(0, 8)}`;
  const achievement = await s.prisma.achievement.create({
    data: {
      code,
      name: `Name ${code}`,
      description: "d",
      category: "explorer",
      domain,
      icon: "star",
      tier: "gold",
      requirement: 10,
      requirementType: "flights_count",
      points,
    },
  });
  await s.prisma.userAchievement.create({
    data: {
      userId,
      achievementId: achievement.id,
      progress: held ? 10 : 4,
      unlockedAt: held ? new Date("2026-01-02T03:04:05Z") : null,
    },
  });
  return code;
}

describe("achievements over a connection", () => {
  it("with the switch on the person reads the earned badges and totals - held, visible ones only", async () => {
    const { anna, ben } = await people();
    const { onTo } = await connect(a, anna, b, ben, { asker: { achievements: true } });
    const held = await badge(a, anna, "shared", true, 70);
    const notYet = await badge(a, anna, "shared", false);
    const hiddenDomain = await badge(a, anna, "cruise", true);
    await a.prisma.userSettings.upsert({
      where: { userId: anna },
      create: { userId: anna, enabledDomains: ["flight"], data: {} },
      update: { enabledDomains: ["flight"] },
    });
    const read = await b.remoteAchievements.readRemoteAchievements(ben, onTo);
    const codes = read.earned.map((e) => e.code);
    expect(codes).toContain(held);
    expect(codes).not.toContain(notYet);
    expect(codes).not.toContain(hiddenDomain);
    expect(read.earned.find((e) => e.code === held)).toMatchObject({
      points: 70,
      unlockedAt: "2026-01-02T03:04:05.000Z",
    });
    expect(read.summary.totalPoints).toBe(read.earned.reduce((n, e) => n + e.points, 0));
  });

  it("with the switch off the read answers the refused kind, and turning it off ends it at once", async () => {
    const { anna, ben } = await people();
    const { onFrom, onTo } = await connect(a, anna, b, ben, {});
    await expectCode(
      b.remoteAchievements.readRemoteAchievements(ben, onTo),
      "SHARE_REMOTE_ACHIEVEMENTS_NOT_SHARED"
    );
    await a.connections.updateConnectionSwitches(anna, onFrom, { ...OFF, achievements: true });
    await b.remoteAchievements.readRemoteAchievements(ben, onTo);
    await a.connections.updateConnectionSwitches(anna, onFrom, { ...OFF });
    await expectCode(
      b.remoteAchievements.readRemoteAchievements(ben, onTo),
      "SHARE_REMOTE_ACHIEVEMENTS_NOT_SHARED"
    );
  });

  it("an ended connection serves nothing even if the switch column is still on", async () => {
    const { anna, ben } = await people();
    const { onFrom, onTo } = await connect(a, anna, b, ben, { asker: { achievements: true } });
    await a.prisma.remoteShareAccount.update({
      where: { id: onFrom },
      data: { state: "revoked", shareAchievements: true },
    });
    await expectCode(
      b.remoteAchievements.readRemoteAchievements(ben, onTo),
      "SHARE_REMOTE_ACHIEVEMENTS_NOT_SHARED"
    );
  });
});

describe("an announcement dropped after 14 days", () => {
  const FIFTEEN_DAYS = 15 * 24 * 3_600_000;

  it("a switch change the peer never heard sends the connection back to reconfirm instead of staying silently out of step", async () => {
    const { anna, ben } = await people();
    const { onFrom } = await connect(a, anna, b, ben, {});
    setOffline(B, true);
    await a.connections.updateConnectionSwitches(anna, onFrom, { ...OFF, achievements: true });
    setOffline(B, false);
    expect(
      await a.prisma.connectionAnnouncement.count({ where: { kind: "connect-settings" } })
    ).toBe(1);
    const run = await a.announcements.runAnnouncements(new Date(Date.now() + FIFTEEN_DAYS));
    expect(run.dropped).toBe(1);
    expect(
      (await a.prisma.remoteShareAccount.findUniqueOrThrow({ where: { id: onFrom } })).state
    ).toBe("reconfirm");
  });

  it("the reconfirmation reaches a person who is no longer findable", async () => {
    const { anna, ben } = await people();
    const { onFrom, onTo } = await connect(a, anna, b, ben, {});
    await b.prisma.user.update({ where: { id: ben }, data: { federationFindable: false } });
    setOffline(B, true);
    await a.connections.updateConnectionSwitches(anna, onFrom, { ...OFF, achievements: true });
    setOffline(B, false);
    await a.announcements.runAnnouncements(new Date(Date.now() + FIFTEEN_DAYS));
    await a.connections.acceptConnection(anna, onFrom, { ...OFF, achievements: true });
    expect(
      (await b.prisma.remoteShareAccount.findUniqueOrThrow({ where: { id: onTo } })).state
    ).toBe("pending_in");
  });

  it("a dropped revoke leaves the connection revoked (it is already ended here)", async () => {
    const { anna, ben } = await people();
    const { onFrom } = await connect(a, anna, b, ben, {});
    setOffline(B, true);
    await a.connections.endConnection(anna, onFrom);
    setOffline(B, false);
    await a.announcements.runAnnouncements(new Date(Date.now() + FIFTEEN_DAYS));
    expect(
      (await a.prisma.remoteShareAccount.findUniqueOrThrow({ where: { id: onFrom } })).state
    ).toBe("revoked");
  });
});

// Keep the origin constants referenced for readers of failures.
void A;
