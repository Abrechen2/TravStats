import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { claimReminder, markSent, releaseClaim, LEASE_MS, REARM_MS } from "../claims";

const MIN = 60_000;
const anchor = new Date("2026-11-10T12:00:00.000Z");
const t0 = new Date("2026-11-09T12:00:00.000Z");

describe("durable reminder claims", () => {
  let userId: string;
  const key = (channel = "mail") => ({
    userId,
    domain: "rail" as const,
    entryId: "entry-1",
    leadHours: 24,
    channel,
  });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "claims_a" } });
    userId = (
      await prisma.user.create({
        data: { username: "claims_a", passwordHash: await hashPassword("password123") },
      })
    ).id;
  });
  beforeEach(() => prisma.reminderClaim.deleteMany({ where: { userId } }));
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("one of two simultaneous workers wins the claim", async () => {
    const results = await Promise.all([
      claimReminder(key(), anchor, t0),
      claimReminder(key(), anchor, t0),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("a restart after the send finds the claim and stays quiet", async () => {
    const claim = await claimReminder(key(), anchor, t0);
    await markSent(claim!, t0);
    expect(await claimReminder(key(), anchor, new Date(t0.getTime() + 15 * MIN))).toBeNull();
  });

  it("a channel is claimed independently (mail, and one push claim per device)", async () => {
    expect(await claimReminder(key("mail"), anchor, t0)).not.toBeNull();
    expect(await claimReminder(key("push:dev-1"), anchor, t0)).not.toBeNull();
    expect(await claimReminder(key("push:dev-2"), anchor, t0)).not.toBeNull();
    expect(await claimReminder(key("push:dev-2"), anchor, t0)).toBeNull();
  });

  it("an unfinished claim is reclaimed only after the lease", async () => {
    await claimReminder(key(), anchor, t0);
    expect(await claimReminder(key(), anchor, new Date(t0.getTime() + LEASE_MS - MIN))).toBeNull();
    expect(
      await claimReminder(key(), anchor, new Date(t0.getTime() + LEASE_MS + MIN))
    ).not.toBeNull();
  });

  it("a released claim (failed send) is retaken at once", async () => {
    const claim = await claimReminder(key(), anchor, t0);
    await releaseClaim(claim!);
    expect(await claimReminder(key(), anchor, new Date(t0.getTime() + MIN))).not.toBeNull();
  });

  it("an edit re-arms a sent reminder only when the anchor moved by more than 30 minutes", async () => {
    const claim = await claimReminder(key(), anchor, t0);
    await markSent(claim!, t0);
    const small = new Date(anchor.getTime() + REARM_MS);
    expect(await claimReminder(key(), small, t0)).toBeNull();
    const big = new Date(anchor.getTime() + REARM_MS + MIN);
    expect(await claimReminder(key(), big, t0)).not.toBeNull();
    // ...and the re-armed reminder is itself sent only once.
    expect(await claimReminder(key(), big, t0)).toBeNull();
  });
});
