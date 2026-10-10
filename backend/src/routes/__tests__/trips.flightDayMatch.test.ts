import fs from "fs";
import path from "path";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { getTripPhotoDir } from "../../middleware/upload";
import { readTripArchive, type TripArchive } from "../../services/trip/exchange/readArchive";
import { buildTripFileProposal } from "../../services/trip/exchange/proposal";
import { existingFlight } from "../../services/trip/package/matching";
import { flightDepartureDay, flightDepartureTime } from "../../services/trip/package/flightClock";
import { seedFullTrip, type SeededTrip } from "./tripExchange.fixture";

/**
 * forgejo#279: the import's flight-number-and-day fallback read every stored
 * departure as an instant, so a LEGACY_FAKE_UTC row (the wall clock stored as
 * if it were UTC) at Los Angeles fell on the day before, and a re-import
 * created the flight a second time.
 */
const stamp = Date.now();
const LA = "America/Los_Angeles";

describe("flightDepartureDay — the server's reading of a stored departure", () => {
  it("reads LEGACY_FAKE_UTC by its own components", () => {
    const clock = { depTimezone: LA, depTimeSemantics: "LEGACY_FAKE_UTC" };
    expect(flightDepartureDay("2026-07-06T00:00:00.000Z", clock)).toBe("2026-07-06");
    expect(flightDepartureTime("2026-07-06T00:00:00.000Z", clock)).toBe("00:00");
  });

  it("reads UTC and DATE_ONLY as instants in negative and positive zones", () => {
    for (const semantics of ["UTC", "DATE_ONLY"]) {
      expect(
        flightDepartureDay("2026-07-06T00:00:00.000Z", {
          depTimezone: LA,
          depTimeSemantics: semantics,
        })
      ).toBe("2026-07-05");
      expect(
        flightDepartureDay("2026-07-05T20:00:00.000Z", {
          depTimezone: "Asia/Tokyo",
          depTimeSemantics: semantics,
        })
      ).toBe("2026-07-06");
    }
    expect(
      flightDepartureTime("2026-07-05T20:00:00.000Z", {
        depTimezone: "Asia/Tokyo",
        depTimeSemantics: "DATE_ONLY",
      })
    ).toBeNull();
  });
});

describe("imports find a LEGACY_FAKE_UTC flight on its local day (forgejo#279)", () => {
  let userId: string;
  let seeded: SeededTrip;
  let exported: TripArchive;
  let legacyId: string;

  beforeAll(async () => {
    userId = (await prisma.user.create({ data: { username: `fd-${stamp}`, passwordHash: "x" } }))
      .id;
    seeded = await seedFullTrip(userId, stamp);
    const res = await request(app)
      .get(`/api/v1/trips/${seeded.tripId}/export`)
      .set("Cookie", `auth_token=${generateToken(userId)}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    exported = readTripArchive(res.body as Buffer);
    legacyId = (
      await prisma.flight.create({
        data: {
          userId,
          flightNumber: "UA990",
          depIata: "LAX",
          arrIata: "SFO",
          depLat: 33.94,
          depLon: -118.41,
          arrLat: 37.62,
          arrLon: -122.38,
          departureTime: new Date("2026-07-06T00:00:00Z"),
          depTimezone: LA,
          depTimeSemantics: "LEGACY_FAKE_UTC",
          arrTimeSemantics: "LEGACY_FAKE_UTC",
        },
      })
    ).id;
  });

  afterAll(async () => {
    const photos = await prisma.tripPhoto.findMany({
      where: { trip: { userId } },
      select: { filename: true },
    });
    for (const p of photos) fs.rmSync(path.join(getTripPhotoDir(), p.filename), { force: true });
    await prisma.document.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.port.deleteMany({ where: { id: seeded.portId } });
    await prisma.$disconnect();
  });

  it("package matcher: the same number on 6 July finds the stored row", async () => {
    const hit = await existingFlight(
      userId,
      { flightNumber: "UA990", date: "2026-07-06", depTime: "00:00" } as never,
      null,
      null
    );
    expect(hit?.id).toBe(legacyId);
    const miss = await existingFlight(
      userId,
      { flightNumber: "UA990", date: "2026-07-05", depTime: "17:00" } as never,
      null,
      null
    );
    expect(miss).toBeNull();
  });

  it("file import: a re-imported legacy flight without provenance is not created again", async () => {
    const [flight] = exported.file.flights;
    const archive: TripArchive = {
      ...exported,
      file: {
        ...exported.file,
        flights: [
          {
            ...flight,
            externalRef: null,
            flightNumber: "UA990",
            depIata: "LAX",
            arrIata: "SFO",
            departureTime: "2026-07-06T00:00:00.000Z",
            arrivalTime: null,
            depTimezone: LA,
            arrTimezone: LA,
            depTimeSemantics: "LEGACY_FAKE_UTC",
            arrTimeSemantics: "LEGACY_FAKE_UTC",
          },
        ],
      },
    };
    const proposal = await buildTripFileProposal(userId, archive);
    const entry = proposal.entries.find((e) => e.kind === "flight");
    expect(entry).toMatchObject({ id: legacyId, day: "2026-07-06" });
    expect(entry?.action).not.toBe("create");
  }, 20_000);
});
