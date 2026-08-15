import { calculateLodgingStats, type LodgingStayData } from "../lodgingStats";

const NOW = new Date("2026-08-15T12:00:00Z");

const stay = (o: Partial<LodgingStayData>): LodgingStayData => ({
  lodgingId: "l1",
  lodgingName: "Hotel Adlon",
  type: "hotel",
  country: "DE",
  city: "Berlin",
  chainId: 1,
  chainName: "Kempinski",
  stars: 5,
  lat: 52.516,
  lon: 13.38,
  checkIn: new Date("2024-05-14T00:00:00Z"),
  checkOut: new Date("2024-05-16T00:00:00Z"),
  status: "completed",
  totalPriceBase: 200,
  fxBaseCurrency: "EUR",
  currency: "EUR",
  totalPrice: 200,
  board: "breakfast",
  isAwardStay: false,
  ratingOverall: null,
  ratingRoom: null,
  ratingBreakfast: null,
  ratingService: null,
  programName: null,
  membershipTier: null,
  ...o,
});

/** Two nights, at whichever chain and in whichever year is asked for. */
const nightsAt = (
  chainName: string | null,
  o: Partial<LodgingStayData> = {},
): LodgingStayData => stay({ chainName, chainId: chainName === null ? null : 1, ...o });

const loyalty = (stays: LodgingStayData[]) =>
  calculateLodgingStats(stays, "EUR", undefined, NOW).loyalty;

describe("lodging loyalty", () => {
  it("splits nights between chains and independent houses", () => {
    const l = loyalty([
      nightsAt("Kempinski"),
      nightsAt(null, {
        lodgingId: "l2",
        checkIn: new Date("2024-06-01"),
        checkOut: new Date("2024-06-04"),
      }),
    ]);
    expect(l.chainNights).toBe(2);
    expect(l.independentNights).toBe(3);
  });

  it("measures the top-chain share against CHAIN nights, not against all nights", () => {
    // 6 chain nights, 4 of them at one brand, plus 10 nights in independents.
    // The answer is 4/6, not 4/16 — this is a statement about brand choice.
    const l = loyalty([
      nightsAt("Motel One", {
        checkIn: new Date("2024-01-01"),
        checkOut: new Date("2024-01-05"),
      }),
      nightsAt("Kempinski", {
        lodgingId: "l2",
        checkIn: new Date("2024-02-01"),
        checkOut: new Date("2024-02-03"),
      }),
      nightsAt(null, {
        lodgingId: "l3",
        checkIn: new Date("2024-03-01"),
        checkOut: new Date("2024-03-11"),
      }),
    ]);
    expect(l.topChain).toEqual({ name: "Motel One", nights: 4 });
    expect(l.topChainShare).toBeCloseTo(4 / 6, 4);
  });

  it("reports a concentration of 1 when every chain night is one brand", () => {
    const l = loyalty([nightsAt("Motel One"), nightsAt("Motel One", { lodgingId: "l2" })]);
    expect(l.concentration).toBe(1);
  });

  it("reports a lower concentration the wider the nights are spread", () => {
    const four = loyalty([
      nightsAt("A"),
      nightsAt("B", { lodgingId: "l2" }),
      nightsAt("C", { lodgingId: "l3" }),
      nightsAt("D", { lodgingId: "l4" }),
    ]);
    const two = loyalty([nightsAt("A"), nightsAt("B", { lodgingId: "l2" })]);
    expect(four.concentration!).toBeLessThan(two.concentration!);
    expect(four.concentration).toBeCloseTo(0.25, 4);
  });

  it("has no chain figures at all when every house is independent", () => {
    const l = loyalty([nightsAt(null)]);
    expect(l.topChain).toBeNull();
    expect(l.topChainShare).toBeNull();
    expect(l.concentration).toBeNull();
    expect(l.independentNights).toBe(2);
  });

  it("counts programme nights per CALENDAR year, which is how status is counted", () => {
    const l = loyalty([
      stay({
        programName: "Minor DISCOVERY",
        membershipTier: "Gold",
        checkIn: new Date("2024-12-30"),
        checkOut: new Date("2025-01-02"),
      }),
      stay({
        lodgingId: "l2",
        programName: "Minor DISCOVERY",
        membershipTier: "Gold",
        checkIn: new Date("2025-03-01"),
        checkOut: new Date("2025-03-06"),
      }),
    ]);
    // The first stay starts in 2024, so all three of its nights are 2024 —
    // the same attribution nights use everywhere else in this rollup.
    const y2024 = l.programmeYears.find((p) => p.year === "2024");
    const y2025 = l.programmeYears.find((p) => p.year === "2025");
    expect(y2024?.nights).toBe(3);
    expect(y2025?.nights).toBe(5);
    expect(y2024?.tier).toBe("Gold");
  });

  it("keeps two programmes in the same year apart", () => {
    const l = loyalty([
      stay({ programName: "Marriott Bonvoy" }),
      stay({ lodgingId: "l2", programName: "Minor DISCOVERY" }),
    ]);
    expect(l.programmeYears).toHaveLength(2);
    expect(l.programmeYears.map((p) => p.programme).sort()).toEqual([
      "Marriott Bonvoy",
      "Minor DISCOVERY",
    ]);
  });

  it("lists programme years newest first", () => {
    const l = loyalty([
      stay({ programName: "Bonvoy", checkIn: new Date("2022-01-01"), checkOut: new Date("2022-01-03") }),
      stay({
        lodgingId: "l2",
        programName: "Bonvoy",
        checkIn: new Date("2025-01-01"),
        checkOut: new Date("2025-01-03"),
      }),
    ]);
    expect(l.programmeYears.map((p) => p.year)).toEqual(["2025", "2022"]);
  });

  it("has no programme rows when no card covered any stay", () => {
    const l = loyalty([stay({ programName: null })]);
    expect(l.programmeYears).toEqual([]);
  });

  it("returns zeroes rather than NaN for an empty input", () => {
    const l = loyalty([]);
    expect(l.chainNights).toBe(0);
    expect(l.independentNights).toBe(0);
    expect(l.concentration).toBeNull();
    expect(l.chainNightsRanked).toEqual([]);
  });
});
