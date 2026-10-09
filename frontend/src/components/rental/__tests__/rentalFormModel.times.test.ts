import { describe, expect, it } from "vitest";
import type { TimeValue } from "../../../shared/time";
import {
  draftFromRental,
  rentalInputFromDraft,
  rentalSaveError,
  validateRentalDraft,
} from "../rentalFormModel";
import { makeRental } from "./rentalFixture";

/**
 * The four wall clocks of the rental form, each with its precision and its
 * occurrence of a repeated hour. Berlin left summer time on 25 Oct 2026:
 * 02:30 was 00:30Z (CEST) and then 01:30Z (CET).
 */
const at = (utc: string, local: string, offset: string, precision = "minute"): TimeValue =>
  ({
    utc,
    zone: "Europe/Berlin",
    offset,
    local,
    precision,
    zoneSource: "stored",
  }) as TimeValue;

const autumnRental = (over: Partial<ReturnType<typeof makeRental>["times"]>) =>
  makeRental({
    times: {
      pickup: at("2026-10-24T08:00:00.000Z", "2026-10-24T10:00:00", "+02:00"),
      return: at("2026-10-26T09:00:00.000Z", "2026-10-26T10:00:00", "+01:00"),
      actualPickup: null,
      actualReturn: null,
      ...over,
    },
  });

describe("rental form times", () => {
  it("re-sends the LATER occurrence of a stored actual return in the repeated hour", () => {
    const draft = draftFromRental(
      autumnRental({
        actualReturn: at("2026-10-25T01:30:00.000Z", "2026-10-25T02:30:00", "+01:00"),
      })
    );
    expect(draft.actualReturnLocal).toBe("2026-10-25T02:30");
    expect(draft.folds.actualReturn).toBe("later");
    expect(rentalInputFromDraft(draft)).toMatchObject({
      actualReturnLocal: "2026-10-25T02:30",
      actualReturnFold: "later",
    });
  });

  it("re-sends the earlier occurrence of a stored actual pickup as earlier", () => {
    const draft = draftFromRental(
      autumnRental({
        actualPickup: at("2026-10-25T00:30:00.000Z", "2026-10-25T02:30:00", "+02:00"),
      })
    );
    expect(draft.folds.actualPickup).toBe("earlier");
    expect(rentalInputFromDraft(draft).actualPickupFold).toBe("earlier");
  });

  it("keeps the booked ends' stored occurrence too", () => {
    const draft = draftFromRental(
      autumnRental({
        pickup: at("2026-10-25T01:30:00.000Z", "2026-10-25T02:30:00", "+01:00"),
      })
    );
    expect(rentalInputFromDraft(draft).pickupFold).toBe("later");
  });

  it("names no occurrence for an ordinary time", () => {
    const input = rentalInputFromDraft(draftFromRental(makeRental()));
    expect(input.pickupFold).toBeNull();
    expect(input.returnFold).toBeNull();
  });

  it("opens a day-only actual end as a day and saves it back as one", () => {
    const draft = draftFromRental(
      makeRental({
        times: {
          ...makeRental().times,
          actualReturn: at("2026-07-04T22:00:00.000Z", "2026-07-05T00:00:00", "+02:00", "day"),
        },
      })
    );
    expect(draft.dayOnly.actualReturn).toBe(true);
    expect(draft.actualReturnLocal).toBe("2026-07-05");
    expect(validateRentalDraft(draft).actualReturnLocal).toBeUndefined();
    expect(rentalInputFromDraft(draft)).toMatchObject({
      actualReturnLocal: "2026-07-05",
      actualReturnFold: null,
    });
  });

  it("opens a day-only BOOKED end as a day, not as 00:00", () => {
    const draft = draftFromRental(
      makeRental({
        returnPrecision: "day",
        times: {
          ...makeRental().times,
          return: at("2026-07-04T22:00:00.000Z", "2026-07-05T00:00:00", "+02:00", "day"),
        },
      })
    );
    expect(draft.dayOnly.return).toBe(true);
    expect(rentalInputFromDraft(draft).returnLocal).toBe("2026-07-05");
  });

  it("sends an empty actual end as null (not recorded) and needs no actual time", () => {
    const draft = draftFromRental(makeRental());
    expect(validateRentalDraft(draft)).toEqual({});
    expect(rentalInputFromDraft(draft)).toMatchObject({
      actualPickupLocal: null,
      actualReturnLocal: null,
      actualPickupFold: null,
      actualReturnFold: null,
    });
  });

  it("refuses a half-typed actual time, and a clock on an end marked day-only", () => {
    const draft = draftFromRental(makeRental());
    expect(
      validateRentalDraft({ ...draft, actualPickupLocal: "2026-07-01" }).actualPickupLocal
    ).toBe("rental:form.errors.timeShape");
    expect(
      validateRentalDraft({
        ...draft,
        dayOnly: { ...draft.dayOnly, actualPickup: true },
        actualPickupLocal: "2026-07-01T10:00",
      }).actualPickupLocal
    ).toBe("rental:form.errors.timeShape");
  });

  it("puts the server's actual-order refusal at the actual return field", () => {
    const refusal = {
      response: {
        status: 400,
        data: { code: "RENTAL_ACTUAL_RETURN_BEFORE_PICKUP", field: "actualReturnLocal" },
      },
    };
    expect(rentalSaveError(refusal)).toEqual({
      key: "rental:form.errors.actualReturnBeforePickup",
      field: "actualReturnLocal",
    });
  });
});
