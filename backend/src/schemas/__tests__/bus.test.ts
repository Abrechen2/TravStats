import { createBusJourneySchema, updateBusJourneySchema, strayBusFoldKey } from "../bus";

const SEOUL = { name: "Seoul Express Bus Terminal", lat: 37.5048, lon: 127.0046, country: "kr" };
const SOKCHO = { name: "Sokcho Express Bus Terminal", lat: 38.1911, lon: 128.5918 };

describe("bus schemas", () => {
  it("accepts a wall clock without offset and upper-cases the country", () => {
    const r = createBusJourneySchema.safeParse({
      departureStation: SEOUL,
      arrivalStation: SOKCHO,
      departureLocal: "2026-09-20T09:00",
      arrivalLocal: "2026-09-20T11:20",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.departureStation.country).toBe("KR");
      expect(r.data.status).toBe("scheduled");
      expect(r.data.rideKind).toBeUndefined();
    }
  });

  it("refuses an offset in the wall clock — whose clock it is comes from the terminal", () => {
    const r = createBusJourneySchema.safeParse({
      departureStation: SEOUL,
      arrivalStation: SOKCHO,
      departureLocal: "2026-09-20T09:00+09:00",
    });
    expect(r.success).toBe(false);
  });

  it("accepts a day alone (an open ticket)", () => {
    const r = createBusJourneySchema.safeParse({
      departureStation: SEOUL,
      arrivalStation: SOKCHO,
      departureLocal: "2026-09-21",
    });
    expect(r.success).toBe(true);
  });

  it("refuses a station without a position", () => {
    const r = createBusJourneySchema.safeParse({
      departureStation: { name: "Somewhere" },
      arrivalStation: SOKCHO,
      departureLocal: "2026-09-20T09:00",
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].path[0]).toBe("departureStation");
  });

  it("only scheduled and cancelled may be sent", () => {
    expect(
      createBusJourneySchema.safeParse({
        departureStation: SEOUL,
        arrivalStation: SOKCHO,
        departureLocal: "2026-09-20T09:00",
        status: "completed",
      }).success
    ).toBe(false);
  });

  it("an update needs at least one field and a misspelt fold is named", () => {
    expect(updateBusJourneySchema.safeParse({}).success).toBe(false);
    expect(strayBusFoldKey({ arrivalFolds: "later" })).toBe("arrivalFolds");
    expect(strayBusFoldKey({ departureFold: "later" })).toBeNull();
  });

  it("empty strings clear optional text", () => {
    const r = updateBusJourneySchema.safeParse({ operator: "" });
    expect(r.success && r.data.operator).toBeNull();
  });
});
