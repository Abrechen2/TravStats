import {
  computePunctuality,
  ON_TIME_GRACE_MINUTES,
  MIN_GROUP_SAMPLE,
  type PunctualityFlight,
} from "../punctualityStats";

const f = (over: Partial<PunctualityFlight>): PunctualityFlight => ({
  delayMinutes: 0,
  airline: null,
  airlineIata: "LH",
  depIata: "MUC",
  arrIata: "JFK",
  ...over,
});

describe("computePunctuality (#2)", () => {
  it("is all-zero and null on an empty sample", () => {
    const r = computePunctuality([]);
    expect(r.sampleSize).toBe(0);
    expect(r.bestAirline).toBeNull();
    expect(r.worstRoute).toBeNull();
  });

  it("ignores flights with no delay figure", () => {
    const r = computePunctuality([f({ delayMinutes: null }), f({ delayMinutes: 10 })]);
    expect(r.sampleSize).toBe(1);
  });

  it("averages the delay and computes an on-time rate at the 15-min grace", () => {
    // 0, 10 (on time), 40 (late) -> avg 16.7, 2/3 on time
    const r = computePunctuality([
      f({ delayMinutes: 0 }),
      f({ delayMinutes: ON_TIME_GRACE_MINUTES - 5 }),
      f({ delayMinutes: 40 }),
    ]);
    expect(r.avgDelayMinutes).toBeCloseTo(16.7, 1);
    expect(r.onTimeRate).toBeCloseTo(0.67, 2);
  });

  it("ranks best and worst airline, ignoring groups under the sample floor", () => {
    const rows = [
      ...Array.from({ length: MIN_GROUP_SAMPLE }, () => f({ airlineIata: "LH", delayMinutes: 5 })),
      ...Array.from({ length: MIN_GROUP_SAMPLE }, () => f({ airlineIata: "BA", delayMinutes: 45 })),
      // TK has only 1 flight — below the floor, must not win worst.
      f({ airlineIata: "TK", delayMinutes: 300 }),
    ];
    const r = computePunctuality(rows);
    expect(r.bestAirline?.key).toBe("LH");
    expect(r.worstAirline?.key).toBe("BA");
    expect([r.bestAirline?.key, r.worstAirline?.key]).not.toContain("TK");
  });

  it("finds the worst route above the sample floor", () => {
    const rows = [
      ...Array.from({ length: MIN_GROUP_SAMPLE }, () =>
        f({ depIata: "MUC", arrIata: "TXL", delayMinutes: 60 })
      ),
      ...Array.from({ length: MIN_GROUP_SAMPLE }, () =>
        f({ depIata: "MUC", arrIata: "ZRH", delayMinutes: 2 })
      ),
    ];
    const r = computePunctuality(rows);
    expect(r.worstRoute?.key).toBe("MUC-TXL");
  });

  it("falls back to the airline name when there is no IATA code", () => {
    const rows = Array.from({ length: MIN_GROUP_SAMPLE }, () =>
      f({ airlineIata: null, airline: "Private Charter", delayMinutes: 20 })
    );
    const r = computePunctuality(rows);
    expect(r.worstAirline?.key).toBe("Private Charter");
  });
});
