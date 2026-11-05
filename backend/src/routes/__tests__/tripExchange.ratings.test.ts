import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { commitTripFile } from "../../services/trip/exchange/commit";
import { readTripArchive, unpackEntries } from "../../services/trip/exchange/readArchive";
import { ensureOwnCategoriesByName } from "../../services/lodging/stayRatings";
import { makeAccount, wipeShareTestAccounts, type TestAccount } from "./sharingFixtures";

/**
 * A stay's category ratings cross accounts in a `.travstats` file: the three
 * legacy values as before, plus (additive) the full map - built-in categories
 * by key, the sender's own categories by NAME, created or revived on the
 * receiving account. Before this, only room/breakfast/service survived a round
 * trip and the rest vanished silently.
 */
describe("trip export / import — stay rating categories", () => {
  let anna: TestAccount;
  let ben: TestAccount;
  let tripId: string;
  let ownKey: string;

  const binary = (res: request.Response, done: (err: Error | null, body: Buffer) => void): void => {
    const chunks: Buffer[] = [];
    res.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
    res.on("end", () => done(null, Buffer.concat(chunks)));
  };
  const exportAs = (query = "") =>
    request(app)
      .get(`/api/v1/trips/${tripId}/export${query}`)
      .set("Cookie", anna.cookie)
      .buffer(true)
      .parse(binary);
  const benStay = () =>
    prisma.lodgingStay.findFirstOrThrow({ where: { userId: ben.id }, orderBy: { id: "asc" } });

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-xrate");
    ben = await makeAccount("ben-xrate");
    tripId = (
      await prisma.trip.create({
        data: { userId: anna.id, name: "Rated", startDate: new Date("2026-06-01T00:00:00Z") },
      })
    ).id;
    const own = await prisma.lodgingRatingCategory.create({
      data: { userId: anna.id, name: "Aussicht" },
    });
    ownKey = `custom:${own.id}`;
    const lodging = await prisma.lodging.create({ data: { userId: anna.id, name: "Haus am See" } });
    await prisma.lodgingStay.create({
      data: {
        userId: anna.id,
        lodgingId: lodging.id,
        tripId,
        checkIn: new Date("2026-06-01T15:00:00Z"),
        checkOut: new Date("2026-06-03T10:00:00Z"),
        ratingRoom: 4,
        ratingOverall: 4,
        ratings: { room: 4, parking: 5, [ownKey]: 3 },
      },
    });
  });
  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  it("round-trips a built-in non-legacy category and an own one, the own one by name", async () => {
    const file = await exportAs("?private=1");
    const json = JSON.parse(
      unpackEntries(file.body as Buffer)
        .get("trip.json")!
        .toString()
    );
    expect(json.stays[0].private).toMatchObject({
      ratingRoom: 4,
      ratings: { room: 4, parking: 5 },
      ownRatings: { Aussicht: 3 },
    });
    expect(JSON.stringify(json)).not.toContain(ownKey);

    await commitTripFile(ben.id, readTripArchive(file.body as Buffer));
    const mine = await prisma.lodgingRatingCategory.findFirstOrThrow({
      where: { userId: ben.id, name: "Aussicht" },
    });
    const stay = await benStay();
    expect(stay.ratings).toEqual({ room: 4, parking: 5, [`custom:${mine.id}`]: 3 });
    expect(stay.ratingRoom).toBe(4);
    expect(stay.ratingOverall).toBe(4);
  });

  it("revives a deleted own category of the same name instead of creating a twin", async () => {
    const old = await prisma.lodgingRatingCategory.create({
      data: { userId: ben.id, name: "aussicht", deletedAt: new Date() },
    });
    await commitTripFile(ben.id, readTripArchive((await exportAs("?private=1")).body as Buffer));
    const all = await prisma.lodgingRatingCategory.findMany({ where: { userId: ben.id } });
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: old.id, deletedAt: null });
    expect((await benStay()).ratings).toMatchObject({ [`custom:${old.id}`]: 3 });
  });

  it("writes no ratings in a default (public) export", async () => {
    const text = unpackEntries((await exportAs()).body as Buffer)
      .get("trip.json")!
      .toString();
    expect(text).not.toContain("Aussicht");
    expect(text).not.toContain("parking");
  });

  it("still imports an older file that carries only the three legacy values", async () => {
    const entries = unpackEntries((await exportAs("?private=1")).body as Buffer);
    const json = JSON.parse(entries.get("trip.json")!.toString());
    delete json.stays[0].private.ratings;
    delete json.stays[0].private.ownRatings;
    entries.set("trip.json", Buffer.from(JSON.stringify(json)));
    const { zipSync } = await import("fflate");
    const zip = zipSync(Object.fromEntries([...entries].map(([k, v]) => [k, new Uint8Array(v)])));
    await commitTripFile(ben.id, readTripArchive(Buffer.from(zip)));
    const stay = await benStay();
    expect(stay.ratings).toEqual({ room: 4 });
    expect(stay.ratingOverall).toBe(4);
    expect(await prisma.lodgingRatingCategory.count({ where: { userId: ben.id } })).toBe(0);
  });

  it("keeps both values when a deleted category and a renamed live one share a name", async () => {
    // Delete "Aussicht", then rename another category to "Aussicht": two entries, one name.
    await prisma.lodgingRatingCategory.update({
      where: { id: ownKey.slice("custom:".length) },
      data: { deletedAt: new Date() },
    });
    const other = await prisma.lodgingRatingCategory.create({
      data: { userId: anna.id, name: "Aussicht" },
    });
    const stay = await prisma.lodgingStay.findFirstOrThrow({ where: { userId: anna.id } });
    await prisma.lodgingStay.update({
      where: { id: stay.id },
      data: { ratings: { room: 4, [ownKey]: 3, [`custom:${other.id}`]: 5 } },
    });
    const file = await exportAs("?private=1");
    const exported = JSON.parse(
      unpackEntries(file.body as Buffer)
        .get("trip.json")!
        .toString()
    ).stays[0].private.ownRatings;
    expect(Object.values(exported).sort()).toEqual([3, 5]);
    expect(Object.keys(exported)).toHaveLength(2);

    await commitTripFile(ben.id, readTripArchive(file.body as Buffer));
    const values = Object.values((await benStay()).ratings as Record<string, number>);
    expect(values.sort()).toEqual([3, 4, 5]);
  });

  it("keeps a value with a new name even when the account is already at the 20-category limit", async () => {
    await prisma.lodgingRatingCategory.createMany({
      data: Array.from({ length: 20 }, (_, n) => ({ userId: ben.id, name: `Eigene ${n}` })),
    });
    await commitTripFile(ben.id, readTripArchive((await exportAs("?private=1")).body as Buffer));
    const mine = await prisma.lodgingRatingCategory.findFirstOrThrow({
      where: { userId: ben.id, name: "Aussicht" },
    });
    expect((await benStay()).ratings).toMatchObject({ [`custom:${mine.id}`]: 3 });
  });

  it("resolves names that differ only by case to one category, and counts a revival once", async () => {
    const dead = await prisma.lodgingRatingCategory.create({
      data: { userId: ben.id, name: "ruhe", deletedAt: new Date() },
    });
    const keys = await ensureOwnCategoriesByName(ben.id, ["Aussicht", "aussicht", "Ruhe", "RUHE"]);
    expect(keys.get("Aussicht")).toBe(keys.get("aussicht"));
    expect(keys.get("Ruhe")).toBe(`custom:${dead.id}`);
    expect(keys.get("RUHE")).toBe(`custom:${dead.id}`);
    const all = await prisma.lodgingRatingCategory.findMany({ where: { userId: ben.id } });
    expect(all).toHaveLength(2);
    expect(all.every((c) => c.deletedAt === null)).toBe(true);
  });

  it("refuses a file that would leave the account with an absurd number of categories", async () => {
    await prisma.lodgingRatingCategory.createMany({
      data: Array.from({ length: 100 }, (_, n) => ({ userId: ben.id, name: `Voll ${n}` })),
    });
    await expect(ensureOwnCategoriesByName(ben.id, ["Neu"])).rejects.toThrow(/too many/i);
  });
});
