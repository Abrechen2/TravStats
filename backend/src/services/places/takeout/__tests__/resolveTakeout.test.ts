import { prisma } from "../../../../db";
import { GOOGLE_CONCURRENCY, resolveTakeoutList } from "../resolveTakeout";
import type { CidLookup } from "../googleCidLookup";
import type { PlaceResult } from "../../../geo/photon";

/**
 * #358: a Takeout list resolved in the preview — position from the CID (else
 * by name inside the list's country), the single trip into that country, the
 * visit day from photographs inside the trip, and a suggested treatment. Every
 * missing answer carries its reason; nothing here writes.
 *
 * Google and Photon are injected: no test reaches the network.
 */

// Invented places and coordinates in Kyoto; no real person's data.
const SHRINE = { lat: 34.9671, lon: 135.7727 };
const HOTEL = { lat: 34.9858, lon: 135.7588 };
const STATION = { lat: 34.9858, lon: 135.7601 };

const placeOk = (at: { lat: number; lon: number }, types: string[], name = "x"): CidLookup => ({
  ok: true,
  place: { ...at, name, types, address: null, city: "Kyoto", country: "Japan", countryCode: "JP" },
});

const photonHit = (over: Partial<PlaceResult>): PlaceResult => ({
  name: "hit",
  lat: 0,
  lon: 0,
  ...over,
});

describe("resolveTakeoutList", () => {
  let userId: string;
  let tripId: string;

  const makeTrip = (name: string, countries: string[]) =>
    prisma.trip.create({
      data: {
        userId,
        name,
        countries,
        status: "completed",
        startDay: new Date("2024-04-01T00:00:00Z"),
        endDay: new Date("2024-04-10T00:00:00Z"),
        startZone: "Asia/Tokyo",
        endZone: "Asia/Tokyo",
      },
    });

  const photo = (at: { lat: number; lon: number }, takenAt: string, trip = tripId) =>
    prisma.tripPhoto.create({
      data: {
        tripId: trip,
        filename: "invented.jpg",
        mimetype: "image/jpeg",
        sizeBytes: 1,
        takenAt: new Date(takenAt),
        ...at,
      },
    });

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: { username: `takeout-${Date.now()}-${Math.random()}`, passwordHash: "x" },
    });
    userId = user.id;
    tripId = (await makeTrip("Japan 2024", ["JP"])).id;
  });

  afterEach(async () => {
    await prisma.lodgingStay.deleteMany({ where: { userId } });
    await prisma.lodging.deleteMany({ where: { userId } });
    await prisma.trip.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("places a row by its CID, maps the country list to the trip, and dates it from photos", async () => {
    // Two photos on the 5th, one on the 6th, one outside the trip's span.
    await photo(SHRINE, "2024-04-05T02:00:00Z");
    await photo(SHRINE, "2024-04-05T03:00:00Z");
    await photo(SHRINE, "2024-04-06T03:00:00Z");
    await photo(SHRINE, "2024-05-20T03:00:00Z");
    const lookupCid = jest.fn(async () =>
      placeOk(SHRINE, ["place_of_worship", "tourist_attraction"])
    );

    const result = await resolveTakeoutList(
      userId,
      "Japan.csv",
      [{ sourceRowIndex: 0, name: "Fushimi Inari", externalRef: "gmaps:123" }],
      undefined,
      { googleKey: "k", lookupCid, searchName: jest.fn() }
    );

    expect(lookupCid).toHaveBeenCalledWith("123", "k");
    expect(result.listCountry).toBe("JP");
    expect(result.trip).toMatchObject({ id: tripId, first: "2024-04-01", last: "2024-04-10" });
    expect(result.rows[0]).toMatchObject({
      position: { ...SHRINE, source: "google_cid" },
      cidReason: null,
      positionReason: null,
      kind: "sight",
      suggestedTreatment: "place",
      visitDay: { date: "2024-04-05", photoCount: 2 },
      visitDayReason: null,
    });
  });

  it("without a key says so, and falls back to a name search inside the list's country", async () => {
    const searchName = jest.fn(async () => [
      photonHit({ name: "Elsewhere", countryCode: "KR", lat: 37.5, lon: 127 }),
      photonHit({ name: "Kyoto Station", countryCode: "JP", type: "station", ...STATION }),
    ]);

    const result = await resolveTakeoutList(
      userId,
      "Japan",
      [{ sourceRowIndex: 0, name: "Kyoto Station", externalRef: "gmaps:9" }],
      undefined,
      { googleKey: null, searchName }
    );

    expect(result.googleConfigured).toBe(false);
    expect(result.rows[0]).toMatchObject({
      position: { ...STATION, source: "name_search" },
      cidReason: "no_key",
      kind: "station",
      suggestedTreatment: "trip_stop",
      visitDay: null,
      visitDayReason: "no_photos",
    });
  });

  it("stops asking Google after a quota answer and gives every row that reason", async () => {
    const lookupCid = jest.fn(async (): Promise<CidLookup> => ({ ok: false, reason: "quota" }));
    const searchName = jest.fn(async () => [] as PlaceResult[]);
    const rows = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
      sourceRowIndex: i,
      name: `Row ${i}`,
      externalRef: `gmaps:${i + 1}`,
    }));

    // The first concurrent batch is already in flight when the answer comes;
    // every row after it must not ask again.
    const result = await resolveTakeoutList(userId, "Japan", rows, undefined, {
      googleKey: "k",
      lookupCid,
      searchName,
    });

    expect(lookupCid.mock.calls.length).toBeLessThanOrEqual(GOOGLE_CONCURRENCY);
    expect(result.rows.every((r) => r.cidReason === "quota")).toBe(true);
    expect(result.rows.every((r) => r.positionReason === "not_in_country")).toBe(true);
  });

  it("does not search by name when the list names no country", async () => {
    const searchName = jest.fn();
    const result = await resolveTakeoutList(
      userId,
      "Gespeicherte Orte",
      [{ sourceRowIndex: 0, name: "Somewhere", externalRef: null }],
      undefined,
      { googleKey: "k", lookupCid: jest.fn(), searchName }
    );

    expect(searchName).not.toHaveBeenCalled();
    expect(result.tripReason).toBe("no_country");
    expect(result.rows[0]).toMatchObject({
      position: null,
      cidReason: "no_cid",
      positionReason: "no_country",
      visitDayReason: "no_trip",
    });
  });

  it("names no trip when two trips went into the country", async () => {
    await makeTrip("Japan again", ["JP"]);
    const result = await resolveTakeoutList(
      userId,
      "Japan",
      [{ sourceRowIndex: 0, name: "Shrine", lat: SHRINE.lat, lon: SHRINE.lon }],
      undefined,
      { googleKey: null, searchName: jest.fn() }
    );
    expect(result.trip).toBeNull();
    expect(result.tripReason).toBe("several_trips");
    expect(result.rows[0].visitDayReason).toBe("no_trip");
  });

  it("abstains when two days have as many photos", async () => {
    await photo(SHRINE, "2024-04-05T02:00:00Z");
    await photo(SHRINE, "2024-04-07T02:00:00Z");
    const result = await resolveTakeoutList(
      userId,
      "Japan",
      [{ sourceRowIndex: 0, name: "Shrine", lat: SHRINE.lat, lon: SHRINE.lon }],
      undefined,
      { googleKey: null, searchName: jest.fn() }
    );
    expect(result.rows[0]).toMatchObject({ visitDay: null, visitDayReason: "ambiguous" });
  });

  it("offers a saved hotel as the trip's stay there, and a city as skip", async () => {
    const lodging = await prisma.lodging.create({
      data: { userId, name: "Invented Inn Kyoto", ...HOTEL },
    });
    const stay = await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: lodging.id,
        tripId,
        checkIn: new Date("2024-04-03T00:00:00Z"),
        checkOut: new Date("2024-04-06T00:00:00Z"),
      },
    });
    const lookupCid = jest.fn(async (cid: string) =>
      cid === "1" ? placeOk(HOTEL, ["lodging"]) : placeOk(SHRINE, ["locality", "political"])
    );

    const result = await resolveTakeoutList(
      userId,
      "Japan",
      [
        { sourceRowIndex: 0, name: "Invented Inn", externalRef: "gmaps:1" },
        { sourceRowIndex: 1, name: "Kyoto", externalRef: "gmaps:2" },
      ],
      undefined,
      { googleKey: "k", lookupCid, searchName: jest.fn() }
    );

    expect(result.rows[0]).toMatchObject({
      kind: "lodging",
      suggestedTreatment: "stay",
      matchedStay: { id: stay.id, name: "Invented Inn Kyoto", checkIn: "2024-04-03" },
    });
    expect(result.rows[1]).toMatchObject({ kind: "city", suggestedTreatment: "skip" });
  });

  it("does not look up a row that already carries a position", async () => {
    const lookupCid = jest.fn();
    const result = await resolveTakeoutList(
      userId,
      "Japan",
      [{ sourceRowIndex: 0, name: "Shrine", externalRef: "gmaps:5", ...SHRINE }],
      undefined,
      { googleKey: "k", lookupCid, searchName: jest.fn() }
    );
    expect(lookupCid).not.toHaveBeenCalled();
    expect(result.rows[0].position).toBeNull();
    expect(result.rows[0].positionReason).toBeNull();
  });
});
