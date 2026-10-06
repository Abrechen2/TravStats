import { describe, expect, it } from "vitest";
import {
  EMPTY_RENTAL_DRAFT,
  draftDrivenKm,
  draftFromRental,
  parseKmReading,
  rentalInputFromDraft,
  rentalSaveError,
  stationFromHit,
  validateRentalDraft,
  type RentalDraft,
} from "../rentalFormModel";
import { makeRental } from "./rentalFixture";

const placed: RentalDraft = {
  ...EMPTY_RENTAL_DRAFT,
  provider: "Testcar",
  pickup: stationFromHit({
    kind: "airport",
    airportId: 7,
    iata: "FRA",
    name: "Frankfurt",
    address: null,
    city: "Frankfurt",
    lat: 50.03,
    lon: 8.57,
    country: "DE",
    timezone: "Europe/Berlin",
  }),
  pickupLocal: "2026-07-01T10:00",
  returnLocal: "2026-07-05T09:30",
};

/**
 * forgejo#206: the odometer at pick-up and at return. The only km field the
 * form had was the correction, so a reader with the two readings in hand had
 * nowhere to put them.
 */
describe("rental odometer — round trip", () => {
  it("loads both stored readings and sends them back as whole km", () => {
    const draft = draftFromRental(makeRental({ odometerOutKm: 12_000, odometerInKm: 12_634 }));
    expect(draft.odometerOutKm).toBe("12000");
    expect(draft.odometerInKm).toBe("12634");
    const body = rentalInputFromDraft(draft);
    expect(body.odometerOutKm).toBe(12_000);
    expect(body.odometerInKm).toBe(12_634);
  });

  it("sends an empty reading as null so an edit can clear it", () => {
    const body = rentalInputFromDraft({ ...placed, odometerOutKm: "12000", odometerInKm: " " });
    expect(body.odometerOutKm).toBe(12_000);
    expect(body.odometerInKm).toBeNull();
  });

  it.each([
    ["12634", 12_634],
    ["12.634", 12_634],
    ["12,634", 12_634],
    ["12 634", 12_634],
    ["1.234.567", 1_234_567],
    ["0", 0],
  ])("reads the dashboard's %s as %d km, never as a fraction", (typed, km) => {
    expect(parseKmReading(typed)).toBe(km);
  });

  it.each(["12.5", "12,63", "-5", "abc", "12.3456"])("refuses %s as a reading", (typed) => {
    expect(parseKmReading(typed)).toBeNaN();
    expect(validateRentalDraft({ ...placed, odometerOutKm: typed }).odometerOutKm).toBe(
      "rental:form.errors.number"
    );
  });
});

describe("rental odometer — the correction field", () => {
  it("never loads an invoice's figure into the correction, nor sends one back", () => {
    const draft = draftFromRental(makeRental({ distanceKm: 634, distanceSource: "invoice" }));
    expect(draft.distanceKm).toBe("");
    // Absent, not null: an empty correction must not wipe the invoice's km.
    expect("distanceKm" in rentalInputFromDraft(draft)).toBe(false);
  });

  it("loads a stored correction, and clears it when emptied", () => {
    const draft = draftFromRental(makeRental({ distanceKm: 700, distanceSource: "user" }));
    expect(draft.distanceKm).toBe("700");
    expect(rentalInputFromDraft(draft).distanceKm).toBe(700);
    expect(rentalInputFromDraft({ ...draft, distanceKm: "" }).distanceKm).toBeNull();
  });
});

describe("rental odometer — validation", () => {
  it("refuses a return reading below the pick-up one, beside the return field", () => {
    const errors = validateRentalDraft({
      ...placed,
      odometerOutKm: "12634",
      odometerInKm: "12000",
    });
    expect(errors.odometerInKm).toBe("rental:form.errors.odometerReversed");
    expect(errors.odometerOutKm).toBeUndefined();
  });

  it("accepts equal readings and either reading alone", () => {
    expect(validateRentalDraft({ ...placed, odometerOutKm: "500", odometerInKm: "500" })).toEqual(
      {}
    );
    expect(validateRentalDraft({ ...placed, odometerOutKm: "500" })).toEqual({});
    expect(validateRentalDraft({ ...placed, odometerInKm: "500" })).toEqual({});
  });

  it("puts the server's refusal beside the return reading, in the reader's words", () => {
    const err = {
      response: { status: 400, data: { code: "RENTAL_ODOMETER_REVERSED", field: "odometerInKm" } },
    };
    expect(rentalSaveError(err)).toEqual({
      key: "rental:form.errors.odometerReversed",
      field: "odometerInKm",
    });
  });
});

describe("rental odometer — the figure the form announces", () => {
  it("is in − out when both readings are known", () => {
    expect(draftDrivenKm({ ...placed, odometerOutKm: "12.000", odometerInKm: "12.634" })).toEqual({
      km: 634,
      source: "odometer",
    });
  });

  it("abstains on one reading", () => {
    expect(draftDrivenKm({ ...placed, odometerOutKm: "12000" })).toBeNull();
  });

  it("lets a typed correction win and names it as one", () => {
    expect(
      draftDrivenKm({
        ...placed,
        odometerOutKm: "12000",
        odometerInKm: "12634",
        distanceKm: "640",
      })
    ).toEqual({ km: 640, source: "user" });
  });

  it("keeps a stored invoice figure over the readings", () => {
    const draft = draftFromRental(
      makeRental({
        distanceKm: 634,
        distanceSource: "invoice",
        odometerOutKm: 12_000,
        odometerInKm: 12_700,
      })
    );
    expect(draftDrivenKm(draft)).toEqual({ km: 634, source: "invoice" });
  });

  it("drops an emptied correction back to the readings", () => {
    const draft = draftFromRental(
      makeRental({
        distanceKm: 700,
        distanceSource: "user",
        odometerOutKm: 12_000,
        odometerInKm: 12_634,
      })
    );
    expect(draftDrivenKm({ ...draft, distanceKm: "" })).toEqual({ km: 634, source: "odometer" });
  });
});
