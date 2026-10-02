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
