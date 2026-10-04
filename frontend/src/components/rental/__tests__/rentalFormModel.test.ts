import { describe, expect, it } from "vitest";
import {
  EMPTY_RENTAL_DRAFT,
  draftFromRental,
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

describe("rentalFormModel", () => {
  it("refuses a station nothing places — a name alone is no position", () => {
    const errors = validateRentalDraft({
      ...placed,
      pickup: { ...placed.pickup, airportId: null, lat: null, lon: null },
    });
    expect(errors.pickupStation).toBe("rental:form.errors.stationUnplaced");
  });

  it("carries the picked airport's id and country into the body", () => {
    const body = rentalInputFromDraft(placed);
    expect(body.pickupStation).toMatchObject({ airportId: 7, name: "Frankfurt", country: "DE" });
    expect(body.returnStation).toBeNull();
  });

  it("sends an empty price as null, never 0, and no currency without a price", () => {
    const body = rentalInputFromDraft({ ...placed, price: "" });
    expect(body.price).toBeNull();
    expect(body.currency).toBeNull();
  });

  it("reads the stored times on the station's clock, not the reader's", () => {
    const draft = draftFromRental(makeRental());
    expect(draft.pickupLocal).toBe("2026-07-01T10:00");
    expect(draft.returnLocal).toBe("2026-07-05T09:30");
    expect(draft.sameStation).toBe(true);
  });

  it("maps a geocoder outage to its own sentence, not the generic one", () => {
    const err = {
      response: {
        status: 503,
        data: { code: "RENTAL_GEOCODER_UNAVAILABLE", field: "pickupStation" },
      },
    };
    expect(rentalSaveError(err)).toEqual({
      key: "rental:form.errors.geocoderUnavailable",
      field: "pickupStation",
    });
  });

  it("names the field of a return before the pickup", () => {
    const err = {
      response: {
        status: 400,
        data: { code: "RENTAL_RETURN_BEFORE_PICKUP", field: "returnLocal" },
      },
    };
    expect(rentalSaveError(err)).toEqual({
      key: "rental:form.errors.returnBeforePickup",
      field: "returnLocal",
    });
  });
});

/**
 * forgejo#163 — "150,00" EUR was refused as "Bitte eine Zahl eingeben."
 * while "150.00" passed: the form read the field with `Number()`, which
 * knows only the dot. A German price is written with a comma.
 */
// forgejo#196: the plate is free text — trimmed, never reformatted, empty is null.
describe("rental licence plate", () => {
  it("round-trips a stored plate and sends it trimmed", () => {
    const draft = draftFromRental(makeRental({ licensePlate: "M-AB 1234" }));
    expect(draft.licensePlate).toBe("M-AB 1234");
    expect(rentalInputFromDraft({ ...placed, licensePlate: "  b-xy 99e " }).licensePlate).toBe(
      "b-xy 99e"
    );
  });

  it("sends an empty plate as null so an edit can clear it", () => {
    expect(rentalInputFromDraft({ ...placed, licensePlate: "   " }).licensePlate).toBeNull();
  });
});

describe("rental amounts in German notation (forgejo#163)", () => {
  it.each([
    ["150,00", 150],
    ["150.00", 150],
    ["25,5", 25.5],
    ["1.500,00", 1500],
    ["1,500.00", 1500],
  ])("accepts the price %s and sends %s", (typed, sent) => {
    const draft = { ...placed, price: typed, currency: "EUR" };
    expect(validateRentalDraft(draft).price).toBeUndefined();
    expect(rentalInputFromDraft(draft).price).toBe(sent);
  });

  it.each(["abc", "-5", "1,2,3", "12,5x"])("still refuses the price %s", (typed) => {
    expect(validateRentalDraft({ ...placed, price: typed }).price).toBe(
      "rental:form.errors.number"
    );
  });

  it("reads a whole km figure written with a decimal comma", () => {
    const draft = { ...placed, distanceKm: "420,0" };
    expect(validateRentalDraft(draft).distanceKm).toBeUndefined();
    expect(rentalInputFromDraft(draft).distanceKm).toBe(420);
  });

  it("still refuses a km figure with a fraction", () => {
    expect(validateRentalDraft({ ...placed, distanceKm: "420,5" }).distanceKm).toBe(
      "rental:form.errors.number"
    );
  });
});
