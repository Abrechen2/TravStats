/**
 * Natural-key resolution on the receiving server (spec 2026-10-20 §4, F-S4c): catalogue ids
 * never travel, so each reference is matched against THIS server's catalogue — and a miss is
 * kept as what the sender knew, never guessed: an unmatched port call is the cruise stop's
 * unresolved state, an unmatched station or airport a null id beside its name and position, an
 * unmatched ship its name as the override.
 */
import { randomUUID } from "crypto";
import { prisma } from "../../../../db";
import { fromWireEntries } from "../wire/decode";
import { ENTRY_SHAPES, wireEntrySchema, type WireEntry } from "../wire/shapes";

const tag = randomUUID().slice(0, 5).toUpperCase();
const made = { ports: [] as number[], stations: [] as number[], airports: [] as number[] };

const blank = (entity: keyof typeof ENTRY_SHAPES) =>
  Object.fromEntries(Object.keys(ENTRY_SHAPES[entity]).map((k) => [k, null]));
const parse = (entry: object) => wireEntrySchema.parse(entry) as WireEntry;
const port = (name: string, unlocode: string | null) => ({
  unlocode,
  name,
  country: "PT",
  lat: 38,
  lon: -9,
});

afterAll(async () => {
  await prisma.port.deleteMany({ where: { id: { in: made.ports } } });
  await prisma.railStation.deleteMany({ where: { id: { in: made.stations } } });
  await prisma.airport.deleteMany({ where: { id: { in: made.airports } } });
  await prisma.$disconnect();
});

describe("resolving a wire entry against this server's catalogue", () => {
  it("matches a port by UN/LOCODE; an unmatched call stays a port call under its name", async () => {
    const lis = await prisma.port.create({
      data: { name: "Lisboa", unlocode: `Y${tag}`, lat: 38.7, lon: -9.1 },
    });
    made.ports.push(lis.id);
    const stop = (dayNumber: number, p: object | null, isAtSea = false) => ({
      port: p,
      dayNumber,
      date: null,
      isAtSea,
      arrivalTime: null,
      departureTime: null,
      arrivalUtc: null,
      departureUtc: null,
      stopZone: null,
      stopDate: null,
      timePrecision: null,
      unresolvedPortName: null,
    });
    const [{ row }] = await fromWireEntries(prisma, [
      parse({
        entity: "cruise",
        shareKey: randomUUID(),
        facts: {
          ...blank("cruise"),
          ship: { name: "MS Nowhere", imo: "0000000", cruiseLine: "Nowhere Line" },
          departurePort: port("Lisboa", `Y${tag}`),
          arrivalPort: port("Funchal", "ZZNONE"),
          status: "completed",
          stops: [
            stop(1, port("Lisboa", `Y${tag}`)),
            stop(2, null, true),
            stop(3, port("Funchal", "ZZNONE")),
            stop(4, port("Own Pier", null)),
          ],
          legs: [
            {
              ordinal: 1,
              fromPort: port("Lisboa", `Y${tag}`),
              toPort: port("Funchal", "ZZNONE"),
              distanceKm: 900,
              method: "marnet",
              routerVersion: "t",
              dataVersion: null,
              confidence: "medium",
              computedAt: "2030-01-01T00:00:00.000Z",
            },
          ],
        },
      }),
    ]);
    const f = row.facts as Record<string, unknown> & {
      stops: { portId: number | null; isAtSea: boolean; unresolvedPortName: string | null }[];
    };
    expect(f).toMatchObject({
      shipId: null,
      shipNameOverride: "MS Nowhere",
      cruiseLine: "Nowhere Line",
      departurePortId: lis.id,
      arrivalPortId: null,
      status: "scheduled",
      legs: [],
    });
    expect(f.stops.map((s) => [s.portId, s.isAtSea, s.unresolvedPortName])).toEqual([
      [lis.id, false, null],
      [null, true, null],
      [null, false, "Funchal"],
      [null, false, "Own Pier"],
    ]);
    for (const key of ["ship", "departurePort", "arrivalPort"]) expect(f).not.toHaveProperty(key);
  });

  it("matches a rail station by source id, then by UIC code; a miss keeps name and position", async () => {
    const byUic = await prisma.railStation.create({
      data: { name: "Porto", searchName: "porto", uic: `94${tag}`, lat: 41, lon: -8 },
    });
    made.stations.push(byUic.id);
    const ref = (sourceId: string | null, uic: string | null, name: string) => ({
      sourceId,
      uic,
      name,
      lat: 41,
      lon: -8,
    });
    const [{ row }] = await fromWireEntries(prisma, [
      parse({
        entity: "rail",
        shareKey: randomUUID(),
        facts: {
          ...blank("rail"),
          depStationName: "Porto",
          depStation: ref("nowhere-id", `94${tag}`, "Porto"),
          depLat: 41,
          depLon: -8,
          arrStationName: "Nowhere",
          arrStation: ref("nowhere-2", "000", "Nowhere"),
          arrLat: 40,
          arrLon: -8,
          departureTime: "2030-06-04T09:00:00.000Z",
          geometrySource: "none",
          status: "completed",
        },
      }),
    ]);
    expect(row.facts).toMatchObject({
      depStationId: byUic.id,
      arrStationId: null,
      arrStationName: "Nowhere",
      arrLat: 40,
    });
  });

  it("matches a rental's airport by ICAO, then IATA, and an open airport before a closed one", async () => {
    const closed = await prisma.airport.create({
      data: { name: "Old Field", icao: `Q${tag.slice(0, 3)}`, isClosed: true, lat: 1, lon: 1 },
    });
    const open = await prisma.airport.create({
      data: { name: "New Field", icao: `Q${tag.slice(0, 3)}`, iata: null, lat: 1, lon: 1 },
    });
    const byIata = await prisma.airport.create({
      data: { name: "Iata Only", iata: `${tag.slice(0, 2)}X`, lat: 2, lon: 2 },
    });
    made.airports.push(closed.id, open.id, byIata.id);
    const airport = (icao: string | null, iata: string | null) => ({
      icao,
      iata,
      name: "x",
      lat: 1,
      lon: 1,
    });
    const [{ row }] = await fromWireEntries(prisma, [
      parse({
        entity: "rental",
        shareKey: randomUUID(),
        facts: {
          ...blank("rental"),
          provider: "Rent",
          pickupStationName: "A",
          pickupAirport: airport(`Q${tag.slice(0, 3)}`, null),
          pickupLat: 1,
          pickupLon: 1,
          pickupTimezone: "Europe/Lisbon",
          returnStationName: "B",
          returnAirport: airport("ZZZZ", `${tag.slice(0, 2)}X`),
          returnLat: 2,
          returnLon: 2,
          returnTimezone: "Europe/Lisbon",
          pickupTime: "2030-06-01T08:00:00.000Z",
          returnTime: "2030-06-03T08:00:00.000Z",
          pickupPrecision: "minute",
          returnPrecision: "minute",
          status: "cancelled",
        },
      }),
    ]);
    expect(row.facts).toMatchObject({
      pickupAirportId: open.id,
      returnAirportId: byIata.id,
      status: "cancelled",
    });
  });

  it("names the entry a timeline stop wraps by its share key, as the local copy path expects", async () => {
    const key = randomUUID();
    const [{ row }] = await fromWireEntries(prisma, [
      parse({
        entity: "stop",
        shareKey: randomUUID(),
        facts: {
          ...blank("stop"),
          orderIdx: 1,
          title: "Hotel",
          lodgingStayRef: { entity: "lodgingStay", shareKey: key },
        },
      }),
    ]);
    expect(row.facts).toMatchObject({
      sourceRef: null,
      lodgingStayRef: { table: "lodgingStay", key },
    });
  });
});
