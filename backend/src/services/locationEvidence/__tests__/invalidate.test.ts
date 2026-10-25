/**
 * History deleted — open questions vanish, answers stay (TravTrack plan E5;
 * review focus 23). Every TravTrack removal raises the history generation and
 * runs the invalidation in its own transaction, under the TravTrack lock:
 * open findings and questions whose evidence came from the removed history
 * are deleted; accepted ones stay, their evidence cut to a summary without a
 * position or digest; the country days of the removed days go and the days —
 * and their neighbours — are re-derived. Dawarich rows are never touched.
 */
import { prisma, type DbTransaction } from "../../../db";
import { createPrismaClient } from "../../../prismaClient";
import { positionKey } from "../../travtrack/classify";
import { deleteTravTrackRange, registerPointsRemovedHandler } from "../../travtrack/deleteRange";
import type { PointsRemovedCause } from "../../travtrack/deleteRange";
import { deleteTravTrackImport } from "../../travtrack/imports/fileImport";
import { createZone, updateZone } from "../../travtrack/zones";
import { makeUser, wipeTravTrack } from "../../travtrack/__tests__/fixtures";
import { travTrackSwitches } from "../../travtrack/__tests__/switches";
import { setLocationProvider } from "../../locationProvider/provider";
import { utcMidnight } from "../../countryDays/store";
import { acceptCountrySuggestion } from "../countryAccept";
import * as countryRule from "../countrySuggestions";
import { historyGeneration } from "../generation";
import { pointDigest } from "../key";

const PREFIX = "evidence-invalidate-";
const MIN = 60_000;
/** 2026-10-10 10:00 UTC. */
const BASE = Date.parse("2026-10-10T10:00:00Z");
const SEOUL = { lat: 37.57, lon: 126.97 };
const BUSAN = { lat: 35.1, lon: 129.04 };
const PIN = { lat: 37.5712, lon: 126.9768 };

let userId: string;
let seq = 0;
const switches = travTrackSwitches();

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ??= "c".repeat(64);
  userId = await makeUser(`${PREFIX}a`);
});

beforeEach(async () => {
  await switches.set({ beta: true, config: true });
  await wipeTravTrack([userId]);
  await prisma.dawarichStay.deleteMany({ where: { userId } });
  await prisma.locationSuggestion.deleteMany({ where: { userId } });
  await prisma.countryOverride.deleteMany({ where: { userId } });
  await prisma.countryDay.deleteMany({ where: { userId } });
  await prisma.travTrackDirtyDay.deleteMany({ where: { userId } });
  await prisma.travTrackImport.deleteMany({ where: { userId } });
  await prisma.placeVisit.deleteMany({ where: { userId } });
  await prisma.place.deleteMany({ where: { userId } });
});

afterAll(async () => {
  await switches.restore();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
  await prisma.$disconnect();
});

const at = (min: number) => new Date(BASE + min * MIN);
const generation = () => prisma.$transaction((tx) => historyGeneration(tx, userId));

/** Stored points at these minutes after BASE; returns their position keys. */
async function points(
  minutes: number[],
  where = SEOUL,
  origin = "companion:phone-1"
): Promise<string[]> {
  const rows = minutes.map((m) => {
    seq += 1;
    const t = at(m);
    return {
      userId,
      t,
      tS: Math.floor(t.getTime() / 1000),
      lat: where.lat,
      lon: where.lon,
      accuracyM: 5,
      origin,
      originRef: `p-${seq}`,
      deviceId: origin.startsWith("gpx:") ? `file:${origin.slice(4)}` : "phone-1",
    };
  });
  await prisma.travTrackPoint.createMany({ data: rows });
  return rows.map((r) => positionKey(r));
}

type StayOpts = {
  status?: string;
  from?: number;
  to?: number;
  where?: { lat: number; lon: number };
  digests?: string[];
  provider?: "travtrack" | "dawarich";
  kind?: "venue";
  superseded?: string[];
};

/** A finding row as a TravTrack (or Dawarich) scan writes it. */
async function stay(o: StayOpts = {}) {
  seq += 1;
  const where = o.where ?? SEOUL;
  const provider = o.provider ?? "travtrack";
  const evidence =
    provider === "dawarich"
      ? { source: "dawarich", zone: "Asia/Seoul", pointIds: [1, 2, 3], maxGapMinutes: 10 }
      : {
          source: "travtrack",
          ...(o.kind
            ? {
                kind: o.kind,
                market: { identity: "osm:way:1", areaIds: ["way/1"], venueType: "cafe" },
                supersededFindingIds: o.superseded ?? [],
              }
            : {}),
          zone: "Asia/Seoul",
          pointDigests: o.digests ?? ["d0"],
          maxGapMinutes: 10,
          uncertainties: [],
          readCoverage: "complete",
          explanation: {
            code: o.kind ? "venue.visit" : "stay.dwell",
            params: { minutes: 30, points: 4, radiusM: 150, maxGapMinutes: 10 },
          },
        };
  return prisma.dawarichStay.create({
    data: {
      userId,
      fingerprint: `f-${seq}`,
      evidenceKey: `k-${seq}`,
      provider,
      algorithmVersion: provider === "travtrack" ? 1 : 0,
      status: o.status ?? "pending",
      sourceStartAt: at(o.from ?? 0),
      sourceEndAt: at(o.to ?? 30),
      sourceLat: where.lat,
      sourceLon: where.lon,
      startAt: at(o.from ?? 0),
      endAt: at(o.to ?? 30),
      lat: where.lat,
      lon: where.lon,
      zone: "Asia/Seoul",
      pointCount: 4,
      evidence,
    },
  });
}

/** An accepted TravTrack stay with its place (at PIN) and visit. */
async function acceptedStay(o: StayOpts = {}) {
  const row = await stay(o);
  const place = await prisma.place.create({
    data: { userId, name: "Café", lat: PIN.lat, lon: PIN.lon, visited: true },
  });
  const visit = await prisma.placeVisit.create({
    data: { userId, placeId: place.id, visitedAt: row.startAt, suggestionRef: row.evidenceKey },
  });
  return prisma.dawarichStay.update({
    where: { id: row.id },
    data: {
      status: "accepted",
      placeId: place.id,
      visitId: visit.id,
      lat: PIN.lat,
      lon: PIN.lon,
      resolvedAt: new Date(),
    },
  });
}

/** A TravTrack country question over `[from, until)` UTC days. */
function countryQuestion(from: string, until: string, status = "pending") {
  seq += 1;
  return prisma.locationSuggestion.create({
    data: {
      userId,
      kind: "country",
      provider: "travtrack",
      providerRev: 0,
      algorithm: 1,
      evidenceKey: `c-${seq}`,
      windowFrom: utcMidnight(from),
      windowUntil: utcMidnight(until),
      status,
      explanation: { code: "country.groundDays", params: { country: "PT", days: 2, points: 20 } },
      evidence: { countryCode: "PT", days: 2, pointCount: 20 },
    },
  });
}

const stays = async () =>
  (await prisma.dawarichStay.findMany({ where: { userId }, orderBy: { fingerprint: "asc" } })).map(
    (r) => r.id
  );
const fresh = (id: string) => prisma.dawarichStay.findUnique({ where: { id } });

describe("a range delete", () => {
  it("removes every open TravTrack finding and suggestion inside it, in the same transaction", async () => {
    await points([0, 10, 20, 30]);
    const open = await Promise.all(
      ["pending", "accepting", "covered", "superseded", "invalidated", "rejected"].map((status) =>
        stay({ status })
      )
    );
    const question = await countryQuestion("2026-10-10", "2026-10-12");
    const other = createPrismaClient();
    try {
      await prisma.$transaction(async (tx) => {
        await deleteTravTrackRange(userId, at(-1), at(60), tx);
        // Inside the removal's transaction they are gone already …
        expect(await tx.dawarichStay.count({ where: { userId } })).toBe(0);
        expect(await tx.locationSuggestion.count({ where: { userId } })).toBe(0);
        // … and nobody else sees that before it commits.
        expect(await other.dawarichStay.count({ where: { userId } })).toBe(open.length);
      });
    } finally {
      await other.$disconnect();
    }
    expect(await stays()).toEqual([]);
    expect(await prisma.locationSuggestion.findUnique({ where: { id: question.id } })).toBeNull();
  });

  it("a rejected finding inside the range is deleted, one outside stays", async () => {
    await points([0, 10, 20, 30, 600, 610, 620]);
    const inside = await stay({ status: "rejected" });
    const outside = await stay({ status: "rejected", from: 600, to: 630 });
    await deleteTravTrackRange(userId, at(-1), at(60));
    expect(await fresh(inside.id)).toBeNull();
    expect(await fresh(outside.id)).not.toBeNull();
  });

  it("an accepted stay and its visit survive; the finding keeps no digest and no source position but the accepted pin", async () => {
    const keys = await points([0, 10, 20, 30]);
    const digests = keys.map((k) => pointDigest(userId, k));
    const accepted = await acceptedStay({ digests });
    await deleteTravTrackRange(userId, at(-1), at(60));
    const row = await prisma.dawarichStay.findUniqueOrThrow({ where: { id: accepted.id } });
    expect(row).toMatchObject({
      status: "accepted",
      visitId: accepted.visitId,
      sourceLat: PIN.lat,
      sourceLon: PIN.lon,
    });
    expect(await prisma.placeVisit.count({ where: { id: accepted.visitId! } })).toBe(1);
    const evidence = row.evidence as Record<string, unknown>;
    expect(Object.keys(evidence).sort()).toEqual(
      ["algorithmVersion", "explanation", "historyDeletedAt", "provider", "source", "zone"].sort()
    );
    const said = JSON.stringify(row.evidence);
    for (const d of digests) expect(said).not.toContain(d);
    expect(said).not.toContain(String(SEOUL.lat));
  });

  it("an accepted country question stays accepted with its override, and keeps no evidence but a summary", async () => {
    await points([0, 10]);
    const q = await countryQuestion("2026-10-10", "2026-10-12", "accepted");
    const override = await prisma.countryOverride.create({
      data: { userId, countryCode: "PT", verdict: "visited", note: "", day: q.windowFrom },
    });
    await prisma.locationSuggestion.update({
      where: { id: q.id },
      data: { acceptedEntryKind: "countryOverride", acceptedEntryId: override.id },
    });
    await deleteTravTrackRange(userId, at(-1), at(60));
    const row = await prisma.locationSuggestion.findUniqueOrThrow({ where: { id: q.id } });
    expect(row).toMatchObject({ status: "accepted", acceptedEntryId: override.id });
    expect(Object.keys(row.evidence as object).sort()).toEqual(
      ["algorithmVersion", "countryCode", "historyDeletedAt", "provider", "source"].sort()
    );
    expect(await prisma.countryOverride.count({ where: { id: override.id } })).toBe(1);
  });

  it("leaves Dawarich findings untouched", async () => {
    await points([0, 10, 20, 30]);
    const dawarich = await stay({ provider: "dawarich" });
    const accepted = await stay({ provider: "dawarich", status: "accepted" });
    await deleteTravTrackRange(userId, at(-1), at(60));
    expect(await fresh(dawarich.id)).toEqual(dawarich);
    expect(await fresh(accepted.id)).toEqual(accepted);
  });

  it("a rolled-back delete changes nothing and does not raise the generation", async () => {
    await points([0, 10, 20, 30]);
    const row = await stay();
    const before = await generation();
    await expect(
      prisma.$transaction(async (tx) => {
        await deleteTravTrackRange(userId, at(-1), at(60), tx);
        throw new Error("rolled back");
      })
    ).rejects.toThrow("rolled back");
    expect(await fresh(row.id)).toEqual(row);
    expect(await generation()).toBe(before);
    expect(await prisma.travTrackPoint.count({ where: { userId } })).toBe(4);
  });

  it("raises the generation once, in the removal's transaction", async () => {
    await points([0]);
    const before = await generation();
    await deleteTravTrackRange(userId, at(-1), at(60));
    expect(await generation()).toBe(before + 1n);
  });

  it("a venue that goes gives its fragments outside the range back to the inbox", async () => {
    await points([0, 10, 20, 30, 90, 100, 110]);
    const inside = await stay({ status: "superseded", from: 0, to: 30 });
    const outside = await stay({ status: "superseded", from: 90, to: 120 });
    const venue = await stay({
      kind: "venue",
      from: 0,
      to: 120,
      superseded: [inside.id, outside.id],
    });
    await deleteTravTrackRange(userId, at(-1), at(60));
    expect(await fresh(venue.id)).toBeNull();
    expect(await fresh(inside.id)).toBeNull();
    expect((await fresh(outside.id))?.status).toBe("pending");
  });

  it("deletes the country days of the removed days and their neighbours, and marks them dirty", async () => {
    // Points on the 10th only; the range runs over the 10th and 11th.
    await points([0, 10]);
    for (const day of ["2026-10-09", "2026-10-10", "2026-10-12"]) {
      await prisma.countryDay.create({
        data: {
          userId,
          source: "travtrack",
          date: utcMidnight(day),
          countryCode: "KR",
          pointCount: 2,
          airportPointCount: 0,
          spanKm: 0,
        },
      });
    }
    await deleteTravTrackRange(userId, at(-1), new Date("2026-10-12T00:00:00Z"));
    const left = await prisma.countryDay.findMany({ where: { userId }, orderBy: { date: "asc" } });
    // The 9th and the 11th neighbour the removed 10th: their rows read its
    // points as edge context and go too (Codex review). The 12th stays.
    expect(left.map((r) => r.date.toISOString().slice(0, 10))).toEqual(["2026-10-12"]);
    const dirty = await prisma.travTrackDirtyDay.findMany({
      where: { userId },
      orderBy: { day: "asc" },
    });
    expect(dirty.map((d) => d.day.toISOString().slice(0, 10))).toEqual(
      expect.arrayContaining(["2026-10-09", "2026-10-10", "2026-10-11"])
    );
  });

  it("a question whose row the removal took while it was being accepted answers EVIDENCE_INVALIDATED", async () => {
    await setLocationProvider(userId, "travtrack");
    await points([0, 10]);
    const q = await countryQuestion("2026-10-10", "2026-10-12");
    const spy = jest.spyOn(countryRule, "countryRunHolds").mockImplementation(async () => {
      // The removal lands while the accept re-checks, holding no lock.
      await deleteTravTrackRange(userId, at(-1), at(60));
      return "holds" as const;
    });
    try {
      await expect(acceptCountrySuggestion(userId, q.id, "visited")).rejects.toMatchObject({
        code: "EVIDENCE_INVALIDATED",
      });
    } finally {
      spy.mockRestore();
    }
    expect(await prisma.locationSuggestion.count({ where: { userId } })).toBe(0);
    expect(await prisma.countryOverride.count({ where: { userId } })).toBe(0);
  });
});

describe("a country question", () => {
  it("is removed when one of its days lost points, and kept when none did", async () => {
    await points([0, 10]); // the 10th
    const hit = await countryQuestion("2026-10-09", "2026-10-11");
    const miss = await countryQuestion("2026-10-12", "2026-10-14");
    await deleteTravTrackRange(userId, at(-1), at(60));
    expect(await prisma.locationSuggestion.findUnique({ where: { id: hit.id } })).toBeNull();
    expect(await prisma.locationSuggestion.findUnique({ where: { id: miss.id } })).not.toBeNull();
  });
});

describe("an import delete", () => {
  async function gpxImport(minutes: number[], where = SEOUL) {
    const row = await prisma.travTrackImport.create({
      data: { userId, kind: "gpx", fileName: "walk.gpx", status: "succeeded" },
    });
    const keys = await points(minutes, where, `gpx:${row.id}`);
    return { id: row.id, keys };
  }

  it("removes a finding one of whose constituent points it deleted, even outside its window", async () => {
    const companion = await points([0, 10, 20, 30]);
    const imported = await gpxImport([500, 510]);
    // A finding whose window lies far from the import, but which counted one of its fixes.
    const mixed = await stay({
      digests: [...companion, imported.keys[0]].map((k) => pointDigest(userId, k)),
    });
    await deleteTravTrackImport(userId, imported.id);
    expect(await fresh(mixed.id)).toBeNull();
  });

  it("invalidates open questions from its points only", async () => {
    const companion = await points([0, 10, 20, 30]);
    const imported = await gpxImport([300, 310, 320, 330], BUSAN);
    const own = await stay({
      from: 300,
      to: 330,
      where: BUSAN,
      digests: imported.keys.map((k) => pointDigest(userId, k)),
    });
    const others = await stay({ digests: companion.map((k) => pointDigest(userId, k)) });
    const before = await generation();
    await deleteTravTrackImport(userId, imported.id);
    expect(await fresh(own.id)).toBeNull();
    expect(await fresh(others.id)).toEqual(others);
    expect(await generation()).toBe(before + 1n);
  });
});

describe("a zone", () => {
  const causes: PointsRemovedCause[] = [];
  let unregister: () => void;
  beforeAll(() => {
    unregister = registerPointsRemovedHandler(async (_tx: DbTransaction, uid, cause) => {
      if (uid === userId) causes.push(cause);
    });
  });
  afterAll(() => unregister());
  beforeEach(() => {
    causes.length = 0;
  });

  it("that deletes nothing still removes a pending finding whose position lies in it", async () => {
    const inside = await stay();
    const outside = await stay({ where: BUSAN });
    const before = await generation();
    const { deleted } = await createZone(userId, { name: "Home", ...SEOUL, radiusM: 300 }, false);
    expect(deleted).toBe(0);
    expect(await fresh(inside.id)).toBeNull();
    expect(await fresh(outside.id)).toEqual(outside);
    expect(await generation()).toBe(before + 1n);
  });

  it("created over an accepted stay strips its evidence and keeps the answer", async () => {
    const accepted = await acceptedStay();
    await createZone(userId, { name: "Home", ...SEOUL, radiusM: 300 }, false);
    const row = await prisma.dawarichStay.findUniqueOrThrow({ where: { id: accepted.id } });
    expect(row.status).toBe("accepted");
    expect(row).toMatchObject({ sourceLat: PIN.lat, sourceLon: PIN.lon });
    expect(row.evidence).not.toHaveProperty("pointDigests");
    expect(row.evidence).toHaveProperty("historyDeletedAt");
  });

  it("names the days and keys of the points it deleted, computed before they went", async () => {
    const tenth = await points([0, 10]);
    const twelfth = await points([60 * 48]);
    await points([0], BUSAN);
    await createZone(userId, { name: "Home", ...SEOUL, radiusM: 300 }, true);
    expect(causes).toHaveLength(1);
    const cause = causes[0];
    expect(cause.kind).toBe("zone");
    expect(cause.days).toEqual(["2026-10-10", "2026-10-12"]);
    expect([...(cause.keys ?? [])].sort()).toEqual([...tenth, ...twelfth].sort());
    expect(cause.spans).toEqual([
      [BASE, BASE + 10 * MIN],
      [BASE + 2880 * MIN, BASE + 2880 * MIN],
    ]);
  });

  it("grown over a pending finding removes it", async () => {
    const { zone } = await createZone(userId, { name: "Home", ...BUSAN, radiusM: 100 }, false);
    const row = await stay({ where: { lat: BUSAN.lat + 0.003, lon: BUSAN.lon } });
    await updateZone(userId, zone.id, { radiusM: 1000 }, false);
    expect(await fresh(row.id)).toBeNull();
  });
});
