import { describe, expect, it } from "vitest";
import {
  EMPTY_DEADLINE_DRAFT,
  deadlineDraftError,
  deadlineDraftFrom,
  deadlineWire,
} from "../deadlineDraft";

const instant = {
  utc: "2027-05-01T16:00:00.000Z",
  zone: "Europe/Berlin",
  offset: "+02:00",
  local: "2027-05-01T18:00:00",
  precision: "minute" as const,
  zoneSource: "stored" as const,
};

describe("deadline draft (forgejo#285)", () => {
  it("reads an instant back as its local day and time", () => {
    expect(deadlineDraftFrom({ freeCancellationUntil: instant })).toEqual({
      cancelDay: "2027-05-01",
      cancelTime: "18:00",
      cancelZone: "Europe/Berlin",
      paymentDueOn: "",
    });
  });

  it("a day-only deadline goes out as the bare day — no time is invented", () => {
    const draft = { ...EMPTY_DEADLINE_DRAFT, cancelDay: "2027-05-01" };
    expect(deadlineWire(draft, EMPTY_DEADLINE_DRAFT)).toEqual({
      freeCancellationUntil: "2027-05-01",
    });
  });

  it("a day and a time go out as the wall clock with its zone", () => {
    const draft = {
      ...EMPTY_DEADLINE_DRAFT,
      cancelDay: "2027-05-01",
      cancelTime: "18:00",
      cancelZone: "Asia/Tokyo",
    };
    expect(deadlineWire(draft, EMPTY_DEADLINE_DRAFT)).toEqual({
      freeCancellationUntil: { local: "2027-05-01T18:00", zone: "Asia/Tokyo" },
    });
  });

  it("an untouched form sends nothing; an emptied field sends null", () => {
    const initial = deadlineDraftFrom({
      freeCancellationUntil: instant,
      paymentDue: { date: "2027-04-01", zone: null, precision: "day" },
    });
    expect(deadlineWire(initial, initial)).toEqual({});
    expect(
      deadlineWire({ ...initial, cancelDay: "", cancelTime: "", paymentDueOn: "" }, initial)
    ).toEqual({
      freeCancellationUntil: null,
      paymentDueOn: null,
    });
  });

  it("refuses a time without a day", () => {
    expect(deadlineDraftError({ ...EMPTY_DEADLINE_DRAFT, cancelTime: "10:00" })).toBe(
      "timeWithoutDay"
    );
  });
});
