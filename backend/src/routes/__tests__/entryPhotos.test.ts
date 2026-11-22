import { describe, it, expect, jest, beforeAll, beforeEach, afterAll } from "@jest/globals";

type Asset = Record<string, unknown>;
const search = {
  immich: jest.fn<() => Promise<{ assets: Asset[]; truncated: boolean }>>(),
  photoprism: jest.fn<() => Promise<{ assets: Asset[]; truncated: boolean }>>(),
};
const connected = { immich: true, photoprism: false };
jest.mock("../../services/photoSource", () => {
  const actual = jest.requireActual("../../services/photoSource") as object;
  return {
    ...actual,
    createPhotoSource: (kind: "immich" | "photoprism") => ({
      kind,
      searchAssetsByTime: () => search[kind](),
    }),
  };
});
jest.mock("../../services/photoSource/connection", () => {
  const actual = jest.requireActual("../../services/photoSource/connection") as object;
  return {
    ...actual,
    getPhotoSourceConnection: async (kind: "immich" | "photoprism") =>
      connected[kind] ? { baseUrl: `http://${kind}.test`, apiKey: "k", source: "user" } : null,
  };
});

import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { clearImmichAssetCache } from "../../services/immich/immichAssetCache";
import { ImmichError } from "../../services/immich/types";
import { settleAllJobs } from "../../services/jobs/jobRegistry";
import {
  drain,
  installEntryPhotoTriggers,
  setTriggerDelay,
  uninstallEntryPhotoTriggers,
} from "../../services/photoLinking/entryPhotoTriggers";
import { autoLinkEverything } from "../../services/photoLinking/entryPhotos";
import type { AutoLinkRun } from "../../services/places/visitPhotoAutoLink";
import { ENTRY_KINDS, type EntryKind } from "../../services/photoLinking/entryKinds";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";

/**
 * Automatic photo links for every entry type but the place visit (owner,
 * 2026-11-21: "ja, alle Bereiche"). Each kind is one fixture with the photo that
 * belongs to it and the three that do not: taken outside its window, taken far
 * from it, and the one inside a privacy zone.
 */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NEAR = id(1);
const WRONG_TIME = id(2);
const FAR = id(3);
const SECOND = id(4);

const asset = (assetId: string, at: string, lat: number, lon: number): Asset => ({
  id: assetId,
  type: "IMAGE",
  fileCreatedAt: at,
  originalFileName: `${assetId}.jpg`,
  mimeType: "image/jpeg",
  sizeBytes: 100,
  lat,
  lon,
});

interface Fixture {
  /** Where the matching photo is and when. */
  at: string;
  lat: number;
  lon: number;
  /** A time outside the entry's window, at the same place. */
  wrongTime: string;
  create: (userId: string) => Promise<string>;
}

const MUC = { lat: 48.35, lon: 11.78 };
const ROME = { lat: 41.9, lon: 12.48 };
const MID = { lat: 49.12, lon: 10.1 };
const journey = (userId: string, hours: [number, number]) => ({
  userId,
  depStationName: "A",
  depLat: 48.14,
  depLon: 11.56,
  arrStationName: "B",
  arrLat: 50.11,
  arrLon: 8.68,
  departureTime: new Date(Date.UTC(2024, 4, 1, hours[0])),
  arrivalTime: new Date(Date.UTC(2024, 4, 1, hours[1])),
});

const FIXTURES: Record<EntryKind, Fixture> = {
  flight: {
    at: "2024-05-01T09:00:00.000Z",
    ...ROME,
    wrongTime: "2024-05-01T11:00:00.000Z",
    create: async (userId) =>
      (
        await prisma.flight.create({
          data: {
            userId,
            depLat: ROME.lat,
            depLon: ROME.lon,
            arrLat: MUC.lat,
            arrLon: MUC.lon,
            departureTime: new Date("2024-05-01T10:00:00Z"),
            arrivalTime: new Date("2024-05-01T12:00:00Z"),
          },
        })
      ).id,
  },
  stay: {
    at: "2024-05-02T10:00:00.000Z",
    ...ROME,
    wrongTime: "2024-05-06T10:00:00.000Z",
    create: async (userId) => {
      const lodging = await prisma.lodging.create({
        data: { userId, name: "Hotel", lat: ROME.lat, lon: ROME.lon },
      });
      return (
        await prisma.lodgingStay.create({
          data: {
            userId,
            lodgingId: lodging.id,
            checkInAt: new Date("2024-05-01T14:00:00Z"),
            checkOutAt: new Date("2024-05-04T10:00:00Z"),
            checkInDate: new Date("2024-05-01"),
            checkOutDate: new Date("2024-05-04"),
            stayZone: "Europe/Rome",
          },
        })
      ).id;
    },
  },
  rail: {
    at: "2024-05-01T08:00:00.000Z",
    ...MID,
    wrongTime: "2024-05-01T12:00:00.000Z",
    create: async (userId) =>
      (await prisma.railJourney.create({ data: journey(userId, [6, 10]) })).id,
  },
  bus: {
    at: "2024-05-01T08:00:00.000Z",
    ...MID,
    wrongTime: "2024-05-01T12:00:00.000Z",
    create: async (userId) =>
      (await prisma.busJourney.create({ data: journey(userId, [6, 10]) })).id,
  },
  ferry: {
    at: "2024-05-01T08:00:00.000Z",
    ...MID,
    wrongTime: "2024-05-01T12:00:00.000Z",
    create: async (userId) =>
      (await prisma.ferryJourney.create({ data: journey(userId, [6, 10]) })).id,
  },
  rental: {
    at: "2024-05-02T12:00:00.000Z",
    ...MID,
    wrongTime: "2024-05-05T12:00:00.000Z",
    create: async (userId) =>
      (
        await prisma.rentalBooking.create({
          data: {
            userId,
            provider: "Sixt",
            pickupStationName: "A",
            pickupLat: 48.14,
            pickupLon: 11.56,
            pickupTimezone: "Europe/Berlin",
            returnStationName: "B",
            returnLat: 50.11,
            returnLon: 8.68,
            returnTimezone: "Europe/Berlin",
            pickupTime: new Date("2024-05-01T08:00:00Z"),
            returnTime: new Date("2024-05-03T08:00:00Z"),
          },
        })
      ).id,
  },
  cruiseStop: {
    at: "2024-05-01T10:00:00.000Z",
    lat: 36.72,
    lon: -4.42,
    wrongTime: "2024-05-03T10:00:00.000Z",
    create: async (userId) => {
      const port = await prisma.port.create({
        data: { name: "Malaga", lat: 36.72, lon: -4.42, timezone: "Europe/Madrid" },
      });
      const cruise = await prisma.cruise.create({ data: { userId } });
      return (
        await prisma.cruiseStop.create({
          data: {
            cruiseId: cruise.id,
            portId: port.id,
            dayNumber: 1,
            stopDate: new Date("2024-05-01"),
            stopZone: "Europe/Madrid",
          },
        })
      ).id;
    },
  },
  roadtripStop: {
    at: "2024-05-01T10:00:00.000Z",
    lat: 45.0,
    lon: 7.0,
    wrongTime: "2024-05-04T10:00:00.000Z",
    create: async (userId) => {
      const trip = await prisma.trip.create({ data: { userId, name: "Road" } });
      const route = await prisma.tripRoute.create({
        data: { userId, tripId: trip.id, name: "R", mode: "road", kind: "roadtrip" },
      });
      return (
        await prisma.tripStop.create({
          data: {
            routeId: route.id,
            title: "Station",
            lat: 45.0,
            lon: 7.0,
            startDate: new Date("2024-05-01T00:00:00Z"),
            stopZone: "Europe/Rome",
          },
        })
      ).id;
    },
  },
};

const FK = {
  flight: "flightId",
  stay: "lodgingStayId",
  rail: "railJourneyId",
  bus: "busJourneyId",
  ferry: "ferryJourneyId",
  rental: "rentalId",
  cruiseStop: "cruiseStopId",
  roadtripStop: "tripStopId",
} as const;

describe("automatic photo links for every entry type", () => {
  const stamp = Date.now();
  let cookie: string;
  let strangerCookie: string;
  let userId: string;
  const entryIds = {} as Record<EntryKind, string>;

  /** The pass over everything, as the job runs it (the HTTP trigger is rate limited). */
  const runAll = async (): Promise<{ result: AutoLinkRun }> => ({
    result: await autoLinkEverything(userId),
  });
  const links = (kind: EntryKind, refused = false) =>
    prisma.entryPhotoLink.findMany({
      where: { userId, [FK[kind]]: entryIds[kind], refused },
      orderBy: { assetId: "asc" },
    });
  const answerWith = (kind: EntryKind) => {
    const f = FIXTURES[kind];
    search.immich.mockResolvedValue({
      assets: [
        asset(NEAR, f.at, f.lat, f.lon),
        asset(WRONG_TIME, f.wrongTime, f.lat, f.lon),
        asset(FAR, f.at, 10, 100),
      ],
      truncated: false,
    });
  };

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    const user = await prisma.user.create({ data: { username: `epl-${stamp}`, passwordHash } });
    const stranger = await prisma.user.create({
      data: { username: `epl-o-${stamp}`, passwordHash },
    });
    userId = user.id;
    for (const u of [user.id, stranger.id]) {
      await prisma.userSettings.upsert({
        where: { userId: u },
        create: { userId: u, data: {} },
        update: {},
      });
    }
    cookie = `auth_token=${generateToken(user.id)}`;
    strangerCookie = `auth_token=${generateToken(stranger.id)}`;
    for (const kind of ENTRY_KINDS) entryIds[kind] = await FIXTURES[kind].create(userId);
  });

  afterAll(async () => {
    await settleAllJobs();
    uninstallEntryPhotoTriggers();
    await prisma.user.deleteMany({ where: { username: { startsWith: "epl-" } } });
    await prisma.port.deleteMany({ where: { name: "Malaga" } });
  });

  beforeEach(async () => {
    clearImmichAssetCache();
    connected.immich = true;
    connected.photoprism = false;
    await prisma.entryPhotoLink.deleteMany({ where: { userId } });
    await prisma.travTrackPrivacyZone.deleteMany({ where: { userId } });
    await prisma.userSettings.update({ where: { userId }, data: { autoLinkVisitPhotos: true } });
    search.immich.mockReset();
    search.photoprism.mockReset();
    search.photoprism.mockResolvedValue({ assets: [], truncated: false });
  });

  describe.each(ENTRY_KINDS)("%s", (kind) => {
    it("links the photo taken in its window near it, and not the far one or the wrong time", async () => {
      answerWith(kind);
      await runAll();
      const rows = await links(kind);
      expect(rows.map((r) => [r.assetId, r.provider, r.provenance])).toEqual([
        [NEAR, "immich", "auto"],
      ]);
    });

    it("is idempotent: a second pass links nothing twice", async () => {
      answerWith(kind);
      await runAll();
      await runAll();
      expect(await links(kind)).toHaveLength(1);
    });

    it("never links a removed photo again, and the removal is a refusal", async () => {
      answerWith(kind);
      await runAll();
      const [row] = await links(kind);
      const del = await request(app)
        .delete(`/api/v1/entry-photos/${kind}/${entryIds[kind]}/photos/${row.id}`)
        .set("Cookie", cookie);
      expect(del.status).toBe(200);
      await runAll();
      expect(await links(kind)).toHaveLength(0);
      expect(await links(kind, true)).toHaveLength(1);
      const list = await request(app)
        .get(`/api/v1/entry-photos/${kind}/${entryIds[kind]}/photos`)
        .set("Cookie", cookie);
      expect(list.body.data.photos).toEqual([]);
    });

    it("lists its auto links with provider and provenance, for its owner only", async () => {
      answerWith(kind);
      await runAll();
      const mine = await request(app)
        .get(`/api/v1/entry-photos/${kind}/${entryIds[kind]}/photos`)
        .set("Cookie", cookie);
      expect(mine.body.data.photos).toMatchObject([
        { assetId: NEAR, provider: "immich", provenance: "auto" },
      ]);
      const theirs = await request(app)
        .get(`/api/v1/entry-photos/${kind}/${entryIds[kind]}/photos`)
        .set("Cookie", strangerCookie);
      expect(theirs.status).toBe(404);
    });
  });

  it("flight: a photo inside a privacy zone is never linked", async () => {
    answerWith("flight");
    await prisma.travTrackPrivacyZone.create({
      data: { userId, name: "Home", lat: ROME.lat, lon: ROME.lon, radiusM: 500 },
    });
    await runAll();
    expect(await links("flight")).toHaveLength(0);
  });

  it("flight: both windows count (before take-off, after landing), mid-flight does not", async () => {
    search.immich.mockResolvedValue({
      assets: [
        asset(NEAR, "2024-05-01T09:00:00.000Z", ROME.lat, ROME.lon),
        asset(SECOND, "2024-05-01T12:30:00.000Z", MUC.lat, MUC.lon),
        asset(WRONG_TIME, "2024-05-01T11:00:00.000Z", ROME.lat, ROME.lon),
        // Right time for the arrival window, but at the departure airport.
        asset(FAR, "2024-05-01T12:30:00.000Z", ROME.lat, ROME.lon),
      ],
      truncated: false,
    });
    await runAll();
    expect((await links("flight")).map((r) => r.assetId).sort()).toEqual([NEAR, SECOND].sort());
  });

  it("links nothing while the account switch is off", async () => {
    answerWith("flight");
    await prisma.userSettings.update({ where: { userId }, data: { autoLinkVisitPhotos: false } });
    await request(app)
      .post("/api/v1/places/visits/photos/auto-link/run")
      .set("Cookie", cookie)
      .expect(409);
    await runAll();
    expect(await links("flight")).toHaveLength(0);
  });

  it("an undated stay (month precision) matches nothing: abstention, not 'some time that week'", async () => {
    answerWith("stay");
    await prisma.lodgingStay.update({
      where: { id: entryIds.stay },
      data: { datePrecision: "MONTH" },
    });
    await runAll();
    await prisma.lodgingStay.update({
      where: { id: entryIds.stay },
      data: { datePrecision: "DAY" },
    });
    expect(await links("stay")).toHaveLength(0);
  });

  it("an entry that loses its time drops its automatic links, not a manual one", async () => {
    answerWith("stay");
    await runAll();
    await prisma.entryPhotoLink.create({
      data: { userId, lodgingStayId: entryIds.stay, assetId: SECOND, provenance: "manual" },
    });
    await prisma.lodgingStay.update({
      where: { id: entryIds.stay },
      data: { datePrecision: "MONTH" },
    });
    await runAll();
    await prisma.lodgingStay.update({
      where: { id: entryIds.stay },
      data: { datePrecision: "DAY" },
    });
    expect((await links("stay")).map((r) => r.assetId)).toEqual([SECOND]);
  });

  it("a flight whose position moved while its dates stayed drops its automatic links, keeps manual ones and refusals", async () => {
    answerWith("flight");
    await runAll();
    await prisma.entryPhotoLink.createMany({
      data: [
        { userId, flightId: entryIds.flight, assetId: SECOND, provenance: "manual" },
        {
          userId,
          flightId: entryIds.flight,
          assetId: WRONG_TIME,
          provenance: "auto",
          refused: true,
        },
      ],
    });
    await prisma.flight.update({
      where: { id: entryIds.flight },
      data: { depLat: 35.0, depLon: 139.0 },
    });
    await runAll();
    await prisma.flight.update({
      where: { id: entryIds.flight },
      data: { depLat: ROME.lat, depLon: ROME.lon },
    });
    expect((await links("flight")).map((r) => r.assetId)).toEqual([SECOND]);
    expect((await links("flight", true)).map((r) => r.assetId)).toEqual([WRONG_TIME]);
  });

  it("a failing source never costs a link that still fits (re-validation needs that source to answer)", async () => {
    answerWith("flight");
    await runAll();
    search.immich.mockRejectedValue(new ImmichError("unreachable", "down"));
    await runAll();
    expect((await links("flight")).map((r) => r.assetId)).toEqual([NEAR]);
  });

  it("a sea day has no position and matches nothing", async () => {
    answerWith("cruiseStop");
    const cruise = await prisma.cruiseStop.findUniqueOrThrow({
      where: { id: entryIds.cruiseStop },
    });
    const sea = await prisma.cruiseStop.create({
      data: {
        cruiseId: cruise.cruiseId,
        dayNumber: 2,
        isAtSea: true,
        stopDate: new Date("2024-05-01"),
      },
    });
    await runAll();
    expect(await prisma.entryPhotoLink.count({ where: { cruiseStopId: sea.id } })).toBe(0);
  });

  it("a failing source is reported in the run, not a silent 'no photos'; the other source still links", async () => {
    answerWith("flight");
    connected.photoprism = true;
    search.photoprism.mockRejectedValue(new ImmichError("unreachable", "down"));
    const job = (await runAll()) as {
      result?: { sources?: Record<string, string>; linked?: number };
    };
    expect(job.result?.sources?.photoprism).toBe("unreachable");
    expect((await links("flight")).length).toBe(1);
  });

  it("a source with more photos than one search reads is reported as truncated", async () => {
    search.immich.mockResolvedValue({ assets: [], truncated: true });
    const job = (await runAll()) as { result?: { sources?: Record<string, string> } };
    expect(job.result?.sources?.immich).toBe("truncated");
  });

  it("suggestions come from the matcher; a manual link accepts only what was suggested", async () => {
    answerWith("rail");
    const sug = await request(app)
      .get(`/api/v1/entry-photos/rail/${entryIds.rail}/photo-suggestions`)
      .set("Cookie", cookie);
    expect(sug.body.data.suggestions.map((s: { assetId: string }) => s.assetId)).toEqual([NEAR]);
    expect(sug.body.data).toMatchObject({ total: 1, thinned: false });
    const link = await request(app)
      .post(`/api/v1/entry-photos/rail/${entryIds.rail}/photos`)
      .set("Cookie", cookie)
      .send({ assetIds: [NEAR, FAR] });
    expect(link.body.data).toEqual({ linked: 1, skipped: 1 });
    expect((await links("rail")).map((r) => [r.assetId, r.provenance])).toEqual([[NEAR, "manual"]]);
  });

  it("suggestions cut to the limit say how many were found instead of silently dropping the rest", async () => {
    const f = FIXTURES.rail;
    search.immich.mockResolvedValue({
      assets: Array.from({ length: 70 }, (_, n) => asset(id(1000 + n), f.at, f.lat, f.lon)),
      truncated: false,
    });
    const sug = await request(app)
      .get(`/api/v1/entry-photos/rail/${entryIds.rail}/photo-suggestions`)
      .set("Cookie", cookie);
    expect(sug.body.data.suggestions).toHaveLength(60);
    expect(sug.body.data.total).toBe(70);
    expect(sug.body.data.thinned).toBe(true);
  });

  it("a suggestion thumbnail is only served for an id the server itself found", async () => {
    answerWith("rail");
    const before = await request(app)
      .get(`/api/v1/entry-photos/rail/${entryIds.rail}/photo-suggestions/immich/${NEAR}/file`)
      .set("Cookie", cookie);
    expect(before.status).toBe(404);
    await request(app)
      .get(`/api/v1/entry-photos/rail/${entryIds.rail}/photo-suggestions`)
      .set("Cookie", cookie);
    const stranger = await request(app)
      .get(`/api/v1/entry-photos/rail/${entryIds.rail}/photo-suggestions/immich/${NEAR}/file`)
      .set("Cookie", strangerCookie);
    expect(stranger.status).toBe(404);
  });

  it("removing every automatic link records refusals; manual picks stay", async () => {
    answerWith("bus");
    await request(app)
      .post(`/api/v1/entry-photos/bus/${entryIds.bus}/photos`)
      .set("Cookie", cookie)
      .send({ assetIds: [NEAR] });
    await prisma.entryPhotoLink.create({
      data: {
        userId,
        busJourneyId: entryIds.bus,
        assetId: SECOND,
        provenance: "auto",
        takenAt: new Date("2024-05-01T08:30:00Z"),
      },
    });
    const del = await request(app)
      .delete(`/api/v1/entry-photos/bus/${entryIds.bus}/photos/auto`)
      .set("Cookie", cookie);
    expect(del.body.data).toEqual({ removed: 1 });
    expect((await links("bus")).map((r) => r.assetId)).toEqual([NEAR]);
    expect((await links("bus", true)).map((r) => r.assetId)).toEqual([SECOND]);
  });

  it("a flight moved to another day drops its automatic links from the old day, never a manual one", async () => {
    answerWith("flight");
    await runAll();
    await prisma.entryPhotoLink.create({
      data: {
        userId,
        flightId: entryIds.flight,
        assetId: SECOND,
        provenance: "manual",
        takenAt: new Date("2024-05-01T09:30:00Z"),
      },
    });
    await prisma.flight.update({
      where: { id: entryIds.flight },
      data: {
        departureTime: new Date("2024-06-10T10:00:00Z"),
        arrivalTime: new Date("2024-06-10T12:00:00Z"),
      },
    });
    search.immich.mockResolvedValue({ assets: [], truncated: false });
    await runAll();
    expect((await links("flight")).map((r) => [r.assetId, r.provenance])).toEqual([
      [SECOND, "manual"],
    ]);
    await prisma.flight.update({
      where: { id: entryIds.flight },
      data: {
        departureTime: new Date("2024-05-01T10:00:00Z"),
        arrivalTime: new Date("2024-05-01T12:00:00Z"),
      },
    });
  });

  it("deleting the entry deletes its links (real foreign key, cascade)", async () => {
    const flight = await prisma.flight.create({
      data: { userId, depLat: 1, depLon: 1, arrLat: 2, arrLon: 2 },
    });
    await prisma.entryPhotoLink.create({
      data: { userId, flightId: flight.id, assetId: NEAR, provenance: "auto" },
    });
    await prisma.flight.delete({ where: { id: flight.id } });
    expect(await prisma.entryPhotoLink.count({ where: { flightId: flight.id } })).toBe(0);
  });

  it("a link with no entry or with two is refused by the database", async () => {
    await expect(
      prisma.entryPhotoLink.create({ data: { userId, assetId: NEAR } })
    ).rejects.toThrow();
    await expect(
      prisma.entryPhotoLink.create({
        data: { userId, assetId: NEAR, flightId: entryIds.flight, railJourneyId: entryIds.rail },
      })
    ).rejects.toThrow();
  });

  describe("creator and editor triggers (every write path, through the database client)", () => {
    beforeAll(() => {
      setTriggerDelay(20);
      installEntryPhotoTriggers();
    });
    afterAll(() => uninstallEntryPhotoTriggers());

    const settle = async () => {
      await new Promise((r) => setTimeout(r, 300));
      await settleAllJobs();
    };

    it("a new flight, whichever path created it, gets its photo pass", async () => {
      answerWith("flight");
      const created = await prisma.flight.create({
        data: {
          userId,
          depLat: ROME.lat,
          depLon: ROME.lon,
          arrLat: MUC.lat,
          arrLon: MUC.lon,
          departureTime: new Date("2024-05-01T10:00:00Z"),
          arrivalTime: new Date("2024-05-01T12:00:00Z"),
        },
      });
      await settle();
      const rows = await prisma.entryPhotoLink.findMany({ where: { flightId: created.id } });
      expect(rows.map((r) => r.assetId)).toEqual([NEAR]);
    });

    it("a rail journey created by createMany (the roadtrip conversion) gets its pass", async () => {
      answerWith("rail");
      await prisma.railJourney.createMany({ data: [journey(userId, [6, 10])] });
      await settle();
      const mine = await prisma.railJourney.findMany({ where: { userId } });
      const counts = await prisma.entryPhotoLink.count({
        where: { railJourneyId: { in: mine.map((r) => r.id) } },
      });
      expect(counts).toBeGreaterThanOrEqual(2);
    });

    it("moving a journey's departure re-runs its pass; a status-only edit does not", async () => {
      answerWith("bus");
      await prisma.busJourney.update({
        where: { id: entryIds.bus },
        data: { status: "completed" },
      });
      await settle();
      expect(await links("bus")).toHaveLength(0);
      await prisma.busJourney.update({
        where: { id: entryIds.bus },
        data: { departureTime: new Date("2024-05-01T05:30:00Z") },
      });
      await settle();
      expect(await links("bus")).toHaveLength(1);
    });

    it("a hotel geocoded after its stay was saved gets the stay's pass", async () => {
      answerWith("stay");
      const lodging = await prisma.lodging.create({ data: { userId, name: "Late geocode" } });
      const stay = await prisma.lodgingStay.create({
        data: {
          userId,
          lodgingId: lodging.id,
          checkInAt: new Date("2024-05-01T14:00:00Z"),
          checkOutAt: new Date("2024-05-04T10:00:00Z"),
          checkInDate: new Date("2024-05-01"),
          checkOutDate: new Date("2024-05-04"),
          stayZone: "Europe/Rome",
        },
      });
      await settle();
      expect(await prisma.entryPhotoLink.count({ where: { lodgingStayId: stay.id } })).toBe(0);
      await prisma.lodging.update({
        where: { id: lodging.id },
        data: { lat: ROME.lat, lon: ROME.lon },
      });
      await settle();
      expect(await prisma.entryPhotoLink.count({ where: { lodgingStayId: stay.id } })).toBe(1);
    });

    it("a bulk insert is found through its durable mark, however old its rows look", async () => {
      answerWith("rail");
      const before = new Set(
        (await prisma.railJourney.findMany({ where: { userId } })).map((r) => r.id)
      );
      await prisma.railJourney.createMany({
        data: [{ ...journey(userId, [6, 10]), createdAt: new Date("2020-01-01") }],
      });
      await settle();
      const added = (await prisma.railJourney.findMany({ where: { userId } })).filter(
        (r) => !before.has(r.id)
      );
      expect(await prisma.entryPhotoLink.count({ where: { railJourneyId: added[0].id } })).toBe(1);
      expect(await prisma.entryPhotoDirty.count({ where: { userId } })).toBe(0);
    });

    it("an updateMany that moves departures re-runs the pass for the rows it named", async () => {
      answerWith("bus");
      await prisma.entryPhotoLink.deleteMany({ where: { busJourneyId: entryIds.bus } });
      await prisma.busJourney.updateMany({
        where: { id: entryIds.bus, userId },
        data: { departureTime: new Date("2024-05-01T05:45:00Z") },
      });
      await settle();
      expect(await links("bus")).toHaveLength(1);
    });

    it("keeps the mark of an entry that is not visible yet, and a later drain consumes it", async () => {
      answerWith("flight");
      const ghost = "11111111-1111-4111-8111-111111111111";
      await prisma.entryPhotoDirty.create({ data: { userId, kind: "flight", entryId: ghost } });
      await drain(userId);
      expect(await prisma.entryPhotoDirty.count({ where: { userId, entryId: ghost } })).toBe(1);
      await prisma.entryPhotoDirty.update({
        where: { userId_kind_entryId: { userId, kind: "flight", entryId: ghost } },
        data: { markedAt: new Date(Date.now() - 3_600_000) },
      });
      await drain(userId);
      expect(await prisma.entryPhotoDirty.count({ where: { userId, entryId: ghost } })).toBe(0);
    });

    it("a roadtrip station created by createMany (routeId only) is marked, not skipped", async () => {
      answerWith("roadtripStop");
      const trip = await prisma.trip.create({ data: { userId, name: "Road bulk" } });
      const route = await prisma.tripRoute.create({
        data: { userId, tripId: trip.id, name: "R", mode: "road", kind: "roadtrip" },
      });
      await prisma.tripStop.createMany({
        data: [
          {
            routeId: route.id,
            title: "Bulk station",
            lat: 45.0,
            lon: 7.0,
            startDate: new Date("2024-05-01T00:00:00Z"),
            stopZone: "Europe/Rome",
          },
        ],
      });
      await settle();
      const stop = await prisma.tripStop.findFirst({ where: { routeId: route.id } });
      expect(await prisma.entryPhotoLink.count({ where: { tripStopId: stop!.id } })).toBe(1);
    });

    it("a flight created inside a not-yet-committed transaction still gets its mark and pass", async () => {
      answerWith("flight");
      let id = "";
      await prisma.$transaction(async (tx) => {
        const created = await tx.flight.create({
          data: {
            userId,
            depLat: ROME.lat,
            depLon: ROME.lon,
            arrLat: MUC.lat,
            arrLon: MUC.lon,
            departureTime: new Date("2024-05-01T10:00:00Z"),
            arrivalTime: new Date("2024-05-01T12:00:00Z"),
          },
        });
        id = created.id;
        // Let the observer run while the row is still invisible to the global client.
        await new Promise((r) => setTimeout(r, 100));
      });
      await settle();
      expect(await prisma.entryPhotoLink.count({ where: { flightId: id } })).toBe(1);
    });

    it("keeps the marks when the pass failed (a source that did not answer), and retries later", async () => {
      search.immich.mockRejectedValue(new ImmichError("unreachable", "down", 502));
      const id = await FIXTURES.flight.create(userId);
      await settle();
      expect(await prisma.entryPhotoDirty.count({ where: { userId, entryId: id } })).toBe(1);
      expect(await prisma.entryPhotoLink.count({ where: { flightId: id } })).toBe(0);
      answerWith("flight");
      await drain(userId);
      expect(await prisma.entryPhotoDirty.count({ where: { userId, entryId: id } })).toBe(0);
      expect(await prisma.entryPhotoLink.count({ where: { flightId: id } })).toBe(1);
    });

    it("a lodging upsert that sets coordinates re-runs its stays (reads create/update, not data)", async () => {
      answerWith("stay");
      const lodging = await prisma.lodging.create({ data: { userId, name: "Upsert geocode" } });
      const stay = await prisma.lodgingStay.create({
        data: {
          userId,
          lodgingId: lodging.id,
          checkInAt: new Date("2024-05-01T14:00:00Z"),
          checkOutAt: new Date("2024-05-04T10:00:00Z"),
          checkInDate: new Date("2024-05-01"),
          checkOutDate: new Date("2024-05-04"),
          stayZone: "Europe/Rome",
        },
      });
      await settle();
      await prisma.lodging.upsert({
        where: { id: lodging.id },
        create: { userId, name: "x" },
        update: { lat: ROME.lat, lon: ROME.lon },
      });
      await settle();
      expect(await prisma.entryPhotoLink.count({ where: { lodgingStayId: stay.id } })).toBe(1);
    });

    it("does nothing for an account that switched the feature off", async () => {
      answerWith("flight");
      await prisma.userSettings.update({ where: { userId }, data: { autoLinkVisitPhotos: false } });
      const created = await prisma.flight.create({
        data: {
          userId,
          depLat: ROME.lat,
          depLon: ROME.lon,
          arrLat: MUC.lat,
          arrLon: MUC.lon,
          departureTime: new Date("2024-05-01T10:00:00Z"),
          arrivalTime: new Date("2024-05-01T12:00:00Z"),
        },
      });
      await settle();
      expect(await prisma.entryPhotoLink.count({ where: { flightId: created.id } })).toBe(0);
    });
  });
});
