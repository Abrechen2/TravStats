import { randomUUID } from "crypto";
import { prisma } from "../../../db";
import {
  claim,
  comparisonCode,
  changeLink,
  invite,
  listLinks,
  saveGrant,
  revokeGrant,
} from "../links";
import { ownedLink } from "../links";
import { currentGrant, storedScope } from "../snapshots";
import { prepareScope } from "../permissions";
import { collectComparison } from "../e2e/source";
import { readSealed } from "../e2e/store";
import { groupRead } from "../e2e/relay";
import type { Scope } from "../contract";

const ANY_DEVICE = "0".repeat(64);

const users: string[] = [];
const scope: Scope = {
  statistics: true,
  details: false,
  costs: false,
  personal: false,
  photos: false,
  documents: false,
  domains: ["flight"],
  tripIds: [],
  futureTrips: true,
  year: null,
  precision: "exact",
  expiresAt: null,
};
async function user() {
  const u = await prisma.user.create({
    data: { username: `comparison-${randomUUID()}`, passwordHash: "test-only" },
  });
  users.push(u.id);
  return u.id;
}
async function pair(a: string, b: string) {
  const code = await invite(a);
  await claim(b, { origin: "local", code: code.code, label: "A" });
  const aa = (await listLinks(a)).at(-1)!,
    bb = (await listLinks(b)).at(-1)!;
  await changeLink(a, aa.id, "confirm", "B", aa.code);
  await changeLink(b, bb.id, "confirm", "A", bb.code);
  return { a: aa.id, b: bb.id };
}
afterAll(async () => {
  await prisma.comparisonAudit.deleteMany({ where: { ownerId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

describe("friend comparison authorisation (isolated database)", () => {
  it("does not publish data merely by accepting or confirming a friendship", async () => {
    const a = await user(),
      b = await user();
    const link = await pair(a, b);
    const stored = await prisma.comparisonLink.findUniqueOrThrow({ where: { id: link.a } });
    await expect(readSealed(stored, "", ANY_DEVICE)).rejects.toThrow("refused");
    await expect(currentGrant(stored, "")).rejects.toThrow("refused");
  });
  it("consumes invitations atomically, stores only their hashes and refuses self pairing", async () => {
    const a = await user(),
      b = await user(),
      c = await user();
    const invitation = await invite(a);
    await expect(
      claim(a, { origin: "local", code: invitation.code, label: "self" })
    ).rejects.toThrow();
    const outcomes = await Promise.allSettled([
      claim(b, { origin: "local", code: invitation.code, label: "a" }),
      claim(c, { origin: "local", code: invitation.code, label: "a" }),
    ]);
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await prisma.comparisonInvite.findUnique({ where: { hash: invitation.code } })
    ).toBeNull();
  });
  it("requires the comparison code, rejects a stranger's IDs and keeps grant direction separate", async () => {
    const a = await user(),
      b = await user(),
      c = await user();
    const invitation = await invite(a);
    await claim(b, { origin: "local", code: invitation.code, label: "A" });
    const aa = (await listLinks(a))[0];
    await expect(changeLink(a, aa.id, "confirm", "B", "xxxxxx")).rejects.toThrow();
    await expect(changeLink(c, aa.id, "confirm", "B", aa.code)).rejects.toThrow();
    await expect(saveGrant(a, aa.id, "", scope)).rejects.toThrow();
    expect(comparisonCode(aa.channel)).toMatch(/^\d{6}$/);
  });
  it("revokes at source and does not expose one friend's values to another friend", async () => {
    const a = await user(),
      b = await user(),
      c = await user();
    const ab = await pair(a, b),
      ac = await pair(a, c);
    await saveGrant(a, ab.a, "", scope);
    const source = await prisma.comparisonLink.findUniqueOrThrow({ where: { id: ab.a } });
    expect((await currentGrant(source, "")).active).toBe(true);
    await expect(ownedLink(c, ab.b)).rejects.toThrow();
    const other = await prisma.comparisonLink.findUniqueOrThrow({ where: { id: ac.a } });
    await expect(currentGrant(other, "")).rejects.toThrow();
    await revokeGrant(a, ab.a, "");
    await expect(currentGrant(source, "")).rejects.toThrow();
  });
  it("never borrows a personal grant for a group audience", async () => {
    const a = await user(),
      b = await user();
    const link = await pair(a, b);
    await saveGrant(a, link.a, "", scope);
    const source = await prisma.comparisonLink.findUniqueOrThrow({ where: { id: link.a } });
    await expect(currentGrant(source, "group-one")).rejects.toThrow();
  });
  it("freezes a selected list, checks trip ownership and rejects expired permissions", async () => {
    const a = await user(),
      b = await user();
    const link = await pair(a, b);
    const own = await prisma.trip.create({ data: { userId: a, name: "Owned" } }),
      foreign = await prisma.trip.create({ data: { userId: b, name: "Foreign" } });
    await expect(saveGrant(a, link.a, "", { ...scope, tripIds: [foreign.id] })).rejects.toThrow();
    await expect(
      saveGrant(a, link.a, "", { ...scope, expiresAt: "2000-01-01T00:00:00.000Z" })
    ).rejects.toThrow();
    await saveGrant(a, link.a, "", { ...scope, futureTrips: false });
    const grant = await prisma.comparisonGrant.findUniqueOrThrow({
      where: { linkId_audience: { linkId: link.a, audience: "" } },
    });
    expect(storedScope(grant.scope).tripIds).toEqual([own.id]);
    await prisma.trip.create({ data: { userId: a, name: "Later" } });
    expect(storedScope(grant.scope).tripIds).toEqual([own.id]);
  });
  it("invalidates every local audience when a link ends", async () => {
    const a = await user(),
      b = await user();
    const link = await pair(a, b);
    await saveGrant(a, link.a, "", scope);
    await changeLink(b, link.b, "revoke");
    const source = await prisma.comparisonLink.findUniqueOrThrow({ where: { id: link.a } });
    await expect(readSealed(source, "", ANY_DEVICE)).rejects.toThrow();
    await expect(currentGrant(source, "")).rejects.toThrow();
  });
  it("details require their own grant and do not expose costs or notes through general trip data", async () => {
    const a = await user();
    const trip = await prisma.trip.create({
      data: { userId: a, name: "Trip", notes: "private note", description: "private description" },
    });
    const collect = async (s: Scope) =>
      JSON.stringify((await collectComparison(a, await prepareScope(a, s))).sections);
    expect(await collect({ ...scope, tripIds: [trip.id] })).not.toContain(trip.id);
    const detail = await collect({ ...scope, details: true, tripIds: [trip.id] });
    expect(detail).toContain(trip.id);
    expect(detail).not.toContain("private note");
    expect(detail).not.toContain("private description");
    expect(
      await collect({ ...scope, details: true, personal: true, tripIds: [trip.id] })
    ).toContain("private note");
  });
});

it("group membership changes invalidate grants even at other source accounts", async () => {
  const { createCircle, grantCircle, ownerGrant, removeMember, audienceOf } =
    await import("../circles");
  const a = await user(),
    b = await user(),
    c = await user();
  const ab = await pair(a, b),
    ac = await pair(a, c);
  const circle = await createCircle(a, "Three friends", [ab.a, ac.a]);
  const hubB = await prisma.comparisonLink.findUniqueOrThrow({ where: { id: ab.a } });
  const read = () =>
    groupRead(
      a,
      circle.id,
      {
        action: "sealed",
        operation: "group-read",
        channel: hubB.channel,
        circleId: circle.id,
        audience: audienceOf(circle),
        source: "host",
        recipient: ANY_DEVICE,
      },
      hubB
    );
  await expect(read()).rejects.toThrow();
  await grantCircle(b, ab.b, circle.id, circle.version, scope);
  await grantCircle(c, ac.b, circle.id, circle.version, scope);
  await ownerGrant(a, circle.id, circle.version, scope);
  const sourceB = await prisma.comparisonLink.findUniqueOrThrow({ where: { id: ab.b } });
  expect((await currentGrant(sourceB, audienceOf(circle))).active).toBe(true);
  await removeMember(a, circle.id, hubB.channel);
  await expect(currentGrant(sourceB, audienceOf(circle))).rejects.toThrow();
  await expect(read()).rejects.toThrow();
  const sourceC = await prisma.comparisonLink.findUniqueOrThrow({ where: { id: ac.b } });
  await expect(currentGrant(sourceC, audienceOf(circle))).rejects.toThrow();
});

it("projects standalone records by category and filters each flight on its departure calendar", async () => {
  const a = await user(),
    c = await user();
  const records = async (s: Scope) => {
    const sent = await collectComparison(a, await prepareScope(a, s));
    return (sent.sections.flights ?? []) as Array<Record<string, unknown>>;
  };
  const flight = {
    depLat: 1,
    depLon: 1,
    arrLat: 2,
    arrLon: 2,
    depTimezone: "Asia/Tokyo",
    depTimeSemantics: "UTC",
    departureTime: new Date("2025-12-31T16:00:00Z"),
    status: "historical",
    notes: "private-note",
    price: 123,
    bookingReference: "private-booking",
  };
  await prisma.flight.create({ data: { userId: a, ...flight } });
  await prisma.flight.create({ data: { userId: c, ...flight, notes: "stranger" } });
  const basic = await records({ ...scope, details: true, year: 2026 });
  expect(basic).toHaveLength(1);
  expect(JSON.stringify(basic)).not.toContain("private-note");
  expect(JSON.stringify(basic)).not.toContain("private-booking");
  expect(basic[0]).not.toHaveProperty("price");
  const full = await records({
    ...scope,
    details: true,
    costs: true,
    personal: true,
    documents: true,
    year: 2026,
  });
  expect(JSON.stringify(full)).toContain("private-note");
  expect(JSON.stringify(full)).toContain("private-booking");
  expect(JSON.stringify(full)).not.toContain("stranger");
  expect(full[0].price).toBe(123);
  expect(await records({ ...scope, details: true, year: 2025 })).toHaveLength(0);
});

it("restores fail closed for grants, links, peer admission and unused invites", async () => {
  const { suspendComparisonAfterRestore } = await import("../restore");
  const a = await user(),
    b = await user();
  const links = await pair(a, b);
  await saveGrant(a, links.a, "", scope);
  await invite(a);
  await suspendComparisonAfterRestore();
  expect(await listLinks(a)).toEqual([]);
  expect(await prisma.comparisonGrant.count({ where: { active: true } })).toBe(0);
  expect(await prisma.comparisonInvite.count({ where: { usedAt: null } })).toBe(0);
});
