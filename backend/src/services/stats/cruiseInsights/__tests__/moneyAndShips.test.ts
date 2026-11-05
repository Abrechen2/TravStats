import { foldCruiseMoney, foldShipProfile } from "../moneyAndShips";
import type { CruiseFacts } from "../rows";
import { call, cruise } from "./fixtures";

const seaCruise = (id: string, start: string, seaDays: number) =>
  cruise(
    id,
    start,
    start,
    null,
    null,
    Array.from({ length: seaDays }, (_, i) => call(i + 1, null, null))
  );

const facts = (over: Partial<CruiseFacts>): CruiseFacts => ({
  price: null,
  currency: "EUR",
  priceBase: null,
  fxBaseCurrency: null,
  cruiseLine: null,
  ship: null,
  ...over,
});

describe("cruise money: never added across currencies", () => {
  const rows = [
    seaCruise("a", "2022-05-01", 4),
    seaCruise("b", "2023-05-01", 2),
    seaCruise("c", "2024-05-01", 3),
    seaCruise("d", "2024-08-01", 0),
    seaCruise("e", "2025-01-01", 5),
  ];
  const map = new Map<string, CruiseFacts>([
    ["a", facts({ price: 800, cruiseLine: "AIDA" })],
    ["b", facts({ price: 400, cruiseLine: "AIDA" })],
    // USD with a snapshot in EUR: reaches the base currency through it.
    [
      "c",
      facts({
        price: 1000,
        currency: "USD",
        priceBase: 900,
        fxBaseCurrency: "EUR",
        cruiseLine: "MSC",
      }),
    ],
    // USD with a snapshot in a stale base: excluded, not converted.
    ["d", facts({ price: 5000, currency: "USD", priceBase: 4500, fxBaseCurrency: "NOK" })],
    ["e", facts({ price: null })],
  ]);
  const money = foldCruiseMoney(rows, map, "EUR");

  it("leaves a foreign price without a base snapshot out of every figure and counts it", () => {
    expect(money.total).toBe(2100);
    expect(money.excluded).toBe(1);
    expect(money.counted).toBe(3);
  });

  it("reports a cruise with no recorded price as unknown, not as 0", () => {
    expect(money.unknownPrice).toBe(1);
    expect(money.perLine.reduce((s, l) => s + l.total, 0)).toBe(2100);
  });

  it("divides by sea days of the counted cruises only", () => {
    // (800+400+900) / (4+2+3)
    expect(money.perSeaDay?.amount).toBe(233.33);
    expect(money.perSeaDay?.seaDays).toBe(9);
    expect(money.perSeaDay?.cruises.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("names the most expensive cruise and sums per line", () => {
    expect(money.mostExpensive).toMatchObject({ cruise: { id: "c" }, amount: 900 });
    expect(money.perLine.map((l) => [l.line, l.total, l.cruises.length])).toEqual([
      ["AIDA", 1200, 2],
      ["MSC", 900, 1],
    ]);
  });

  it("abstains when nothing reaches the base currency", () => {
    const m = foldCruiseMoney(rows, map, "CHF");
    expect(m.total).toBeNull();
    expect(m.perSeaDay).toBeNull();
    expect(m.mostExpensive).toBeNull();
    expect(m.perLine).toEqual([]);
    expect(m.excluded).toBe(4);
  });

  it("counts a recorded 0 as a price that adds nothing, with no per-line row invented", () => {
    const m = foldCruiseMoney(
      [seaCruise("z", "2024-01-01", 2)],
      new Map([["z", facts({ price: 0 })]]),
      "EUR"
    );
    expect(m.total).toBe(0);
    expect(m.unknownPrice).toBe(0);
    expect(m.perSeaDay?.amount).toBe(0);
  });
});

describe("ship profile: the catalogue has holes and the figure says so", () => {
  const ship = (id: number, tonnage: number | null, built: number | null) => ({
    id,
    name: `Ship ${id}`,
    grossTonnage: tonnage,
    capacity: tonnage ? tonnage / 40 : null,
    yearBuilt: built,
  });
  const rows = [
    seaCruise("a", "2022-05-01", 1),
    seaCruise("b", "2024-05-01", 1),
    seaCruise("c", "2024-06-01", 1),
    seaCruise("d", "2024-07-01", 1),
    seaCruise("e", "2010-07-01", 1),
  ];
  const map = new Map<string, CruiseFacts>([
    ["a", facts({ ship: ship(1, 70000, 2012) })],
    ["b", facts({ ship: ship(1, 70000, 2012) })],
    ["c", facts({ ship: ship(2, 180000, 2020) })],
    ["d", facts({ ship: ship(3, null, null) })], // catalogue ship without figures
    ["e", facts({ ship: ship(1, 70000, 2012) })], // sailed before it was built
  ]);
  const p = foldShipProfile(rows, map);

  it("names the biggest ship with the cruises behind it and the coverage", () => {
    expect(p.biggest).toMatchObject({ shipName: "Ship 2", grossTonnage: 180000 });
    expect(p.biggest?.cruises.map((c) => c.id)).toEqual(["c"]);
    expect(p.tonnageKnown).toBe(4);
    expect(p.cruises).toBe(5);
  });

  it("averages age at sailing over the cruises that can say, skipping an impossible one", () => {
    // a: 10, b: 12, c: 4 -> 8.7; d has no build year, e predates its ship
    expect(p.averageAge?.years).toBe(8.7);
    expect(p.ageKnown).toBe(3);
    expect(p.averageAge?.cruises.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("abstains without a catalogue ship", () => {
    const none = foldShipProfile(rows, new Map());
    expect(none.biggest).toBeNull();
    expect(none.averageAge).toBeNull();
    expect(none.ageKnown).toBe(0);
    expect(none.cruises).toBe(5);
  });
});
