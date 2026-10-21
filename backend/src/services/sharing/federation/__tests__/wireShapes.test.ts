/**
 * What may travel between servers (spec 2026-10-20 §4, F-S4c): per entity, the wire's keys are
 * exactly the fact list (`services/sharing/facts/*`, as the adapters carry it) minus the sender's
 * catalogue ids plus the references standing for them — so a fact added to a list, or a private
 * column added to a row, cannot reach the wire without someone changing this inventory — and
 * the receiver refuses any key beyond it. Time travels as ADR 0002 says.
 */
import { randomUUID } from "crypto";
import { prisma } from "../../../../db";
import { ADAPTERS } from "../../adapters";
import {
  CRUISE_LEG_FACT_FIELDS,
  CRUISE_STOP_FACT_FIELDS,
  LODGING_FACT_FIELDS,
  TRIP_FACT_FIELDS,
} from "../../facts";
import { SHARE_ENTITIES, type ShareEntity } from "../../shareTypes";
import { MAX_GEOMETRY_POINTS, countPoints, encodeShape } from "../wire/codec";
import { receivedStatus } from "../wire/decode";
import { toWireEntries } from "../wire/encode";
import {
  CATALOGUE_REFS,
  CRUISE_LEG_REFS,
  CRUISE_LEG_SHAPE,
  CRUISE_STOP_REFS,
  CRUISE_STOP_SHAPE,
  ENTRY_SHAPES,
  FLIGHT_SHAPE,
  HOUSE_SHAPE,
  TRIP_SHAPE,
  wireEntrySchema,
} from "../wire/shapes";

const sorted = (xs: Iterable<string>) => [...xs].sort();
const replaced = (fields: readonly string[], refs: Readonly<Record<string, string>>) =>
  sorted([...fields.filter((f) => !(f in refs)), ...Object.values(refs)]);

describe("the wire carries the fact lists and nothing else", () => {
  it.each(SHARE_ENTITIES.map((e) => [e]))(
    "%s: wire keys = the adapter's facts, catalogue ids replaced by references",
    (entity: ShareEntity) => {
      expect(sorted(Object.keys(ENTRY_SHAPES[entity]))).toEqual(
        replaced(ADAPTERS[entity].fields, CATALOGUE_REFS[entity])
      );
    }
  );

  it("nested facts: a stay's house, a cruise's port calls and legs, the trip itself", () => {
    expect(sorted(Object.keys(HOUSE_SHAPE))).toEqual(sorted([...LODGING_FACT_FIELDS, "chain"]));
    expect(sorted(Object.keys(CRUISE_STOP_SHAPE))).toEqual(
      replaced(CRUISE_STOP_FACT_FIELDS, CRUISE_STOP_REFS)
    );
    expect(sorted(Object.keys(CRUISE_LEG_SHAPE))).toEqual(
      replaced(CRUISE_LEG_FACT_FIELDS, CRUISE_LEG_REFS)
    );
    expect(sorted(Object.keys(TRIP_SHAPE))).toEqual(sorted(TRIP_FACT_FIELDS));
  });

  it("no catalogue id survives on the wire, at any depth", () => {
    const ids = [
      ...SHARE_ENTITIES.flatMap((e) => Object.keys(CATALOGUE_REFS[e])),
      ...Object.keys(CRUISE_STOP_REFS),
      ...Object.keys(CRUISE_LEG_REFS),
      "catalogueChainId",
      "chainId",
    ];
    const all = [
      ...SHARE_ENTITIES.flatMap((e) => Object.keys(ENTRY_SHAPES[e])),
      ...Object.keys(HOUSE_SHAPE),
      ...Object.keys(CRUISE_STOP_SHAPE),
      ...Object.keys(CRUISE_LEG_SHAPE),
    ];
    expect(all.filter((k) => ids.includes(k))).toEqual([]);
  });

  it("drops a key a row carries beyond the shape — a private column that slipped into the facts", () => {
    const facts = Object.fromEntries(Object.keys(FLIGHT_SHAPE).map((k) => [k, null]));
    const out = encodeShape(FLIGHT_SHAPE, { ...facts, seatNumber: "12A", price: 321 });
    expect(Object.keys(out).sort()).toEqual(Object.keys(FLIGHT_SHAPE).sort());
    expect(JSON.stringify(out)).not.toContain("12A");
  });

  it("the receiver refuses an entry carrying a key outside the inventory", () => {
    const entry = {
      entity: "stop",
      shareKey: randomUUID(),
      facts: {
        orderIdx: 0,
        domain: null,
        title: "Belém",
        description: null,
        startDate: null,
        endDate: null,
        lat: null,
        lon: null,
        startUtc: null,
        endUtc: null,
        stopZone: null,
        precision: null,
        sourceRef: null,
        lodgingStayRef: null,
      },
    };
    expect(wireEntrySchema.safeParse(entry).success).toBe(true);
    expect(
      wireEntrySchema.safeParse({ ...entry, facts: { ...entry.facts, notes: "private" } }).success
    ).toBe(false);
  });
});

describe("time on the wire (ADR 0002)", () => {
  const stopAt = (startUtc: string) => ({
    entity: "stop",
    shareKey: randomUUID(),
    facts: {
      ...Object.fromEntries(Object.keys(ENTRY_SHAPES.stop).map((k) => [k, null])),
      orderIdx: 0,
      title: "x",
      startUtc,
    },
  });

  it("reads a Z instant back as the same instant", () => {
    const parsed = wireEntrySchema.parse(stopAt("2030-06-01T08:00:00.000Z"));
    expect((parsed.facts as { startUtc: Date }).startUtc.toISOString()).toBe(
      "2030-06-01T08:00:00.000Z"
    );
  });

  it.each([["2030-06-01T10:00:00+02:00"], ["2030-06-01T10:00:00"]])(
    "refuses %s: an offset or a missing zone designator is not an instant here",
    (value) => {
      expect(wireEntrySchema.safeParse(stopAt(value)).success).toBe(false);
    }
  );

  it("sends a calendar day as YYYY-MM-DD and reads it back as the stored @db.Date", () => {
    const facts = Object.fromEntries(Object.keys(TRIP_SHAPE).map((k) => [k, null]));
    const out = encodeShape(TRIP_SHAPE, {
      ...facts,
      startDay: new Date("2030-06-01T00:00:00.000Z"),
    });
    expect(out.startDay).toBe("2030-06-01");
  });
});

describe("geometry and status", () => {
  const line = (n: number) => ({
    type: "LineString",
    coordinates: Array.from({ length: n }, (_, i) => [i / 1000, 1]),
  });

  it(`counts points, and a line over ${MAX_GEOMETRY_POINTS} travels without its geometry`, () => {
    expect(countPoints(line(3))).toBe(3);
    const geometry = ENTRY_SHAPES.rail.geometry;
    expect(geometry.encode(line(MAX_GEOMETRY_POINTS))).not.toBeNull();
    expect(geometry.encode(line(MAX_GEOMETRY_POINTS + 1))).toBeNull();
  });

  it("keeps only a status no clock can produce; the rest is derived on the receiver", () => {
    expect(receivedStatus("flight", "flown")).toBe("scheduled");
    expect(receivedStatus("flight", "cancelled")).toBe("cancelled");
    expect(receivedStatus("flight", "historical")).toBe("historical");
    expect(receivedStatus("cruise", "completed")).toBe("scheduled");
    expect(receivedStatus("lodgingStay", "in_progress")).toBe("scheduled");
    expect(receivedStatus("rail", "cancelled")).toBe("cancelled");
  });
});

describe("encoding real rows", () => {
  const userIds: string[] = [];
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("leaves every private column of a flight and a ride behind, and names catalogue rows by natural key", async () => {
    const u = await prisma.user.create({
      data: { username: `wire-${randomUUID().slice(0, 8)}`, passwordHash: "x" },
    });
    userIds.push(u.id);
    const station = await prisma.railStation.create({
      data: {
        sourceId: null,
        name: "Own Halt",
        searchName: "own halt",
        lat: 1,
        lon: 2,
        isUserAdded: true,
      },
    });
    try {
      const flight = await prisma.flight.create({
        data: {
          userId: u.id,
          shareKey: randomUUID(),
          depLat: 1,
          depLon: 2,
          arrLat: 3,
          arrLon: 4,
          departureTime: new Date("2030-06-01T08:00:00.000Z"),
          depTimezone: "Europe/Berlin",
          seatNumber: "SEAT-PRIVATE",
          notes: "NOTE-PRIVATE",
          bookingReference: "PNR-PRIVATE",
          ticketNumber: "TICKET-PRIVATE",
          price: 999.5,
          tags: ["TAG-PRIVATE"],
        },
      });
      const rail = await prisma.railJourney.create({
        data: {
          userId: u.id,
          shareKey: randomUUID(),
          depStationName: "Own Halt",
          depStationId: station.id,
          depLat: 1,
          depLon: 2,
          arrStationName: "Elsewhere",
          arrLat: 3,
          arrLon: 4,
          departureTime: new Date("2030-06-01T08:00:00.000Z"),
          seat: "SEAT-PRIVATE",
          coach: "COACH-PRIVATE",
          bookingReference: "PNR-PRIVATE",
        },
      });
      const [wireFlight] = await toWireEntries(
        prisma,
        "flight",
        await ADAPTERS.flight.load(prisma, [flight.id])
      );
      const [wireRail] = await toWireEntries(
        prisma,
        "rail",
        await ADAPTERS.rail.load(prisma, [rail.id])
      );
      const text = JSON.stringify([wireFlight, wireRail]);
      expect(text).not.toMatch(/PRIVATE|999\.5/);
      expect(wireFlight.facts.departureTime).toBe("2030-06-01T08:00:00.000Z");
      expect(wireRail.facts).not.toHaveProperty("depStationId");
      // A station a user added on this server travels as name and position, no key.
      expect(wireRail.facts.depStation).toEqual({
        sourceId: null,
        uic: null,
        name: "Own Halt",
        lat: 1,
        lon: 2,
      });
      expect(wireEntrySchema.safeParse(wireFlight).success).toBe(true);
      expect(wireEntrySchema.safeParse(wireRail).success).toBe(true);
    } finally {
      await prisma.user.delete({ where: { id: u.id } });
      userIds.pop();
      await prisma.railStation.delete({ where: { id: station.id } });
    }
  });
});
