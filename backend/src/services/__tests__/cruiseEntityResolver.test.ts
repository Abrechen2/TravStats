jest.mock("../../db", () => ({
  prisma: {
    ship: { findMany: jest.fn() },
    port: { findMany: jest.fn() },
  },
}));

import { resolveCruiseEntities, invalidateCruiseEntityCache } from "../cruiseEntityResolver";
import type { ParsedCruise } from "../cruiseBookingParser";
import { prisma } from "../../db";
import { createCruiseSchema } from "../../schemas/cruise";

const shipFindMany = prisma.ship.findMany as jest.Mock;
const portFindMany = prisma.port.findMany as jest.Mock;

const SHIPS = [
  { id: 1, name: "Mein Schiff 4", cruiseLine: "TUI Cruises" },
  { id: 2, name: "AIDAprima", cruiseLine: "AIDA" },
];

const PORTS = [
  { id: 10, name: "Hamburg", city: "Hamburg", country: "Germany" },
  { id: 11, name: "Bergen", city: "Bergen", country: "Norway" },
  { id: 12, name: "Geirangerfjord", city: "Geiranger", country: "Norway" },
  { id: 13, name: "Lisbon", city: "Lisbon", country: "Portugal" },
  { id: 14, name: "Civitavecchia", city: "Civitavecchia", country: "Italy" },
  { id: 15, name: "Atla", city: "Atla", country: "Estonia" },
];

function baseParsedCruise(overrides: Partial<ParsedCruise> = {}): ParsedCruise {
  return {
    shipName: "Mein Schiff 4",
    cruiseLine: "TUI Cruises",
    startDate: "2025-12-19",
    endDate: "2025-12-26",
    cabinNumber: "8123",
    cabinType: "balcony",
    deck: 8,
    bookingReference: "ABCD12",
    price: 2499,
    currency: "EUR",
    stops: [],
    parserTemplate: "ollama-cruise",
    parserConfidence: 80,
    missing: [],
    ...overrides,
  };
}

beforeEach(() => {
  // Module-level candidate cache survives between tests; clear it so each
  // case sees a fresh prisma.findMany call.
  invalidateCruiseEntityCache();
  shipFindMany.mockReset();
  portFindMany.mockReset();
  shipFindMany.mockResolvedValue(SHIPS);
  portFindMany.mockResolvedValue(PORTS);
});

describe("resolveCruiseEntities", () => {
  it("resolves an exact ship match by name", async () => {
    const result = await resolveCruiseEntities(baseParsedCruise());
    expect(result.shipMatched).toBe(true);
    expect(result.input.shipId).toBe(1);
    expect(result.input.shipNameOverride).toBeUndefined();
    expect(result.input.cruiseLine).toBe("TUI Cruises");
  });

  it("falls back to shipNameOverride when no ship matches", async () => {
    const result = await resolveCruiseEntities(
      baseParsedCruise({ shipName: "World Voyager", cruiseLine: "Atlas" }),
    );
    expect(result.shipMatched).toBe(false);
    expect(result.input.shipId).toBeUndefined();
    expect(result.input.shipNameOverride).toBe("World Voyager");
    expect(result.input.cruiseLine).toBe("Atlas");
  });

  it("resolves stops to portIds and re-sequences dayNumber", async () => {
    const cruise = baseParsedCruise({
      stops: [
        { dayNumber: 1, isAtSea: false, portName: "Hamburg" },
        { dayNumber: 2, isAtSea: true },
        { dayNumber: 3, isAtSea: false, portName: "Bergen" },
      ],
    });
    const result = await resolveCruiseEntities(cruise);
    expect(result.input.stops).toHaveLength(3);
    expect(result.input.stops?.[0]).toMatchObject({ portId: 10, dayNumber: 1, isAtSea: false });
    expect(result.input.stops?.[1]).toMatchObject({ portId: null, dayNumber: 2, isAtSea: true });
    expect(result.input.stops?.[2]).toMatchObject({ portId: 11, dayNumber: 3, isAtSea: false });
    expect(result.unmatchedPorts).toHaveLength(0);
  });

  it("maps an unmatched named port to an unresolved stop (no sea-day downgrade)", async () => {
    const cruise = baseParsedCruise({
      stops: [{ dayNumber: 1, isAtSea: false, portName: "Atlantis" }],
    });
    const result = await resolveCruiseEntities(cruise);
    expect(result.unmatchedPorts).toEqual([{ dayNumber: 1, portName: "Atlantis" }]);
    const [stop] = result.input.stops!;
    expect(stop.portId).toBeNull();
    expect(stop.isAtSea).toBe(false);
    expect(stop.unresolvedPortName).toBe("Atlantis");
    // The name lives in its own field now — the excursion note is not tagged.
    expect(stop.excursionNote ?? "").not.toContain("[unmatched:");
  });

  it("degrades a non-sea stop with neither a match nor a name to a sea day (nameless LLM artifact)", async () => {
    const cruise = baseParsedCruise({
      stops: [{ dayNumber: 1, isAtSea: false }],
    });
    const result = await resolveCruiseEntities(cruise);
    const [stop] = result.input.stops!;
    expect(stop.isAtSea).toBe(true);
    expect(stop.portId).toBeNull();
    expect(stop.unresolvedPortName).toBeUndefined();
    expect(result.unmatchedPorts).toHaveLength(0);
    // Locks the resolver <-> Zod contract: the resolver must never produce a
    // stop shape the createCruiseSchema 3-state invariant would reject.
    expect(createCruiseSchema.safeParse(result.input).success).toBe(true);
  });

  it("keeps a real excursion note clean on an unresolved stop", async () => {
    const cruise = baseParsedCruise({
      stops: [{ dayNumber: 1, isAtSea: false, portName: "Atlantis", excursionNote: "City tour" }],
    });
    const result = await resolveCruiseEntities(cruise);
    const [stop] = result.input.stops!;
    expect(stop.unresolvedPortName).toBe("Atlantis");
    expect(stop.excursionNote).toBe("City tour");
  });

  it("matches German exonyms and local endonyms to the English catalog port", async () => {
    const cruise = baseParsedCruise({
      stops: [
        { dayNumber: 1, isAtSea: false, portName: "Lissabon" }, // German exonym
        { dayNumber: 2, isAtSea: false, portName: "Lisboa" }, // Portuguese endonym (fuzzy + map)
        { dayNumber: 3, isAtSea: false, portName: "Rom" }, // exonym → real cruise port
      ],
    });
    const result = await resolveCruiseEntities(cruise);
    expect(result.input.stops?.[0].portId).toBe(13); // Lisbon
    expect(result.input.stops?.[1].portId).toBe(13); // Lisbon
    expect(result.input.stops?.[2].portId).toBe(14); // Civitavecchia (port of Rome)
    expect(result.unmatchedPorts).toHaveLength(0);
  });

  it("does not let a short catalog name swallow a longer parsed name", async () => {
    // "Atlantis" must not match the 4-char port "Atla" via startsWith/contains.
    const cruise = baseParsedCruise({
      stops: [{ dayNumber: 1, isAtSea: false, portName: "Atlantis" }],
    });
    const result = await resolveCruiseEntities(cruise);
    expect(result.input.stops?.[0].portId).toBeNull();
    expect(result.unmatchedPorts).toEqual([{ dayNumber: 1, portName: "Atlantis" }]);
  });

  it("uses city + country as tiebreaker for ambiguous port names", async () => {
    portFindMany.mockResolvedValueOnce([
      { id: 20, name: "Springfield", city: "Springfield", country: "United States" },
      { id: 21, name: "Springfield", city: "Springfield", country: "Canada" },
    ]);
    const cruise = baseParsedCruise({
      stops: [
        { dayNumber: 1, isAtSea: false, portName: "Springfield", country: "Canada" },
      ],
    });
    const result = await resolveCruiseEntities(cruise);
    expect(result.input.stops?.[0].portId).toBe(21);
  });

  it("passes per-stop dates through for both port calls and sea days (#132)", async () => {
    const cruise = baseParsedCruise({
      stops: [
        { dayNumber: 1, isAtSea: false, portName: "Hamburg", date: "2025-12-19" },
        { dayNumber: 2, isAtSea: true, date: "2025-12-20" },
      ],
    });
    const result = await resolveCruiseEntities(cruise);
    expect(result.input.stops?.[0]).toMatchObject({ portId: 10, date: "2025-12-19" });
    expect(result.input.stops?.[1]).toMatchObject({ isAtSea: true, date: "2025-12-20" });
  });

  it("propagates routeName into CruiseInput (#133)", async () => {
    const result = await resolveCruiseEntities(
      baseParsedCruise({ routeName: "Kanaren mit Marokko" }),
    );
    expect(result.input.routeName).toBe("Kanaren mit Marokko");
  });

  it("propagates cabin + price + booking metadata into CruiseInput", async () => {
    const result = await resolveCruiseEntities(baseParsedCruise());
    expect(result.input.cabinNumber).toBe("8123");
    expect(result.input.cabinType).toBe("balcony");
    expect(result.input.deck).toBe(8);
    expect(result.input.bookingReference).toBe("ABCD12");
    expect(result.input.price).toBe(2499);
    expect(result.input.currency).toBe("EUR");
    expect(result.input.status).toBe("scheduled");
  });

  describe("cache behaviour", () => {
    it("loads ships + ports once across consecutive resolves (warm cache)", async () => {
      await resolveCruiseEntities(baseParsedCruise());
      await resolveCruiseEntities(baseParsedCruise());
      await resolveCruiseEntities(baseParsedCruise());
      expect(shipFindMany).toHaveBeenCalledTimes(1);
      expect(portFindMany).toHaveBeenCalledTimes(1);
    });

    it("re-loads after invalidateCruiseEntityCache()", async () => {
      await resolveCruiseEntities(baseParsedCruise());
      invalidateCruiseEntityCache();
      await resolveCruiseEntities(baseParsedCruise());
      expect(shipFindMany).toHaveBeenCalledTimes(2);
      expect(portFindMany).toHaveBeenCalledTimes(2);
    });
  });
});
