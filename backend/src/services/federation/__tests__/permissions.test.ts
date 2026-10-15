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
import { currentGrant, readFriend, storedScope } from "../snapshots";
import { saveBoard } from "../groups";
import { sourceDetails } from "../details";
import type { Scope } from "../contract";

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
    await expect(readFriend(b, link.b, "", null)).rejects.toThrow("refused");
    const stored = await prisma.comparisonLink.findUniqueOrThrow({ where: { id: link.a } });
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
    await expect(readFriend(c, ab.b, "", null)).rejects.toThrow();
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
    await expect(readFriend(b, link.b, "", null)).rejects.toThrow();
    const source = await prisma.comparisonLink.findUniqueOrThrow({ where: { id: link.a } });
    await expect(currentGrant(source, "")).rejects.toThrow();
  });
  it("isolates personal boards and admits only one's confirmed contacts", async () => {
    const a = await user(),
      b = await user(),
      c = await user();
    const link = await pair(a, b);
    const channel = (await listLinks(a))[0].channel;
    const board = await saveBoard(a, { name: "Friends", channels: [channel] });
    await expect(saveBoard(c, { id: board.id, name: "Stolen", channels: [] })).rejects.toThrow();
    await expect(saveBoard(c, { name: "Other", channels: [channel] })).rejects.toThrow();
    expect((await listLinks(b))[0].id).toBe(link.b);
  });
  it("details require their own grant and do not expose costs or notes through general trip data", async () => {
    const a = await user(),
      b = await user();
    const links = await pair(a, b);
    const trip = await prisma.trip.create({
      data: { userId: a, name: "Trip", notes: "private note", description: "private description" },
    });
    const source = await prisma.comparisonLink.findUniqueOrThrow({ where: { id: links.a } });
    await saveGrant(a, links.a, "", scope);
    await expect(sourceDetails(source, "", trip.id)).rejects.toThrow();
    await saveGrant(a, links.a, "", { ...scope, details: true, tripIds: [trip.id] });
    const detail = await sourceDetails(source, "", trip.id);
    expect(JSON.stringify(detail)).not.toContain("private note");
    expect(JSON.stringify(detail)).not.toContain("private description");
    await saveGrant(a, links.a, "", {
      ...scope,
      details: true,
      personal: true,
      tripIds: [trip.id],
    });
    expect(JSON.stringify(await sourceDetails(source, "", trip.id))).toContain("private note");
  });
});

it("group membership changes invalidate grants even at other source accounts", async () => {
  const { createCircle, grantCircle, ownerGrant, readAtHub, removeMember, audienceOf } =
    await import("../circles");
  const a = await user(),
    b = await user(),
    c = await user();
  const ab = await pair(a, b),
    ac = await pair(a, c);
  const circle = await createCircle(a, "Three friends", [ab.a, ac.a]);
  const hubB = await prisma.comparisonLink.findUniqueOrThrow({ where: { id: ab.a } });
  await expect(readAtHub(a, circle.id, null, hubB)).rejects.toThrow();
  await grantCircle(b, ab.b, circle.id, circle.version, scope);
  await grantCircle(c, ac.b, circle.id, circle.version, scope);
  await ownerGrant(a, circle.id, circle.version, scope);
  const sourceB = await prisma.comparisonLink.findUniqueOrThrow({ where: { id: ab.b } });
  expect((await currentGrant(sourceB, audienceOf(circle))).active).toBe(true);
  await removeMember(a, circle.id, hubB.channel);
  await expect(currentGrant(sourceB, audienceOf(circle))).rejects.toThrow();
  await expect(readAtHub(a, circle.id, null, hubB)).rejects.toThrow();
  const sourceC = await prisma.comparisonLink.findUniqueOrThrow({ where: { id: ac.b } });
  await expect(currentGrant(sourceC, audienceOf(circle))).rejects.toThrow();
});

it("projects standalone records by category and filters each flight on its departure calendar", async () => {
  const { sourceRecords } = await import("../records");
  const a = await user(),
    b = await user(),
    c = await user();
  const pairIds = await pair(a, b);
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
  await saveGrant(a, pairIds.a, "", { ...scope, details: true, year: 2026 });
  const source = await prisma.comparisonLink.findUniqueOrThrow({ where: { id: pairIds.a } });
  const basic = await sourceRecords(source, "", "flight");
  expect(basic.rows).toHaveLength(1);
  expect(JSON.stringify(basic)).not.toContain("private-note");
  expect(JSON.stringify(basic)).not.toContain("private-booking");
  expect(basic.rows[0].fields.some((f) => f.name === "price")).toBe(false);
  await saveGrant(a, pairIds.a, "", {
    ...scope,
    details: true,
    costs: true,
    personal: true,
    documents: true,
    year: 2026,
  });
  const full = await sourceRecords(source, "", "flight");
  expect(JSON.stringify(full)).toContain("private-note");
  expect(JSON.stringify(full)).toContain("private-booking");
  expect(JSON.stringify(full)).not.toContain("stranger");
  expect(full.rows[0].fields.find((f) => f.name === "price")?.value).toBe(123);
  await saveGrant(a, pairIds.a, "", { ...scope, details: true, year: 2025 });
  expect((await sourceRecords(source, "", "flight")).rows).toHaveLength(0);
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
