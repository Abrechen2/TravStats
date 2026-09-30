import { localDateInputSchema, localTimeInputSchema, serializeDay, serializeTime } from "../wire";

/**
 * The wire shapes phase 2 builds on (ADR 0002 D3). The point of the input
 * schema is what it REFUSES: an offset-less string the host would read in
 * its own zone, and a time with no zone or two of them.
 */

describe("localTimeInputSchema", () => {
  it("accepts a wall clock with a zone, or with a place reference", () => {
    expect(
      localTimeInputSchema.safeParse({ local: "2027-03-28T01:59", zone: "Europe/Berlin" }).success
    ).toBe(true);
    expect(
      localTimeInputSchema.safeParse({
        local: "2027-10-31T02:30",
        placeRef: { kind: "airport", id: "FRA" },
        fold: "later",
      }).success
    ).toBe(true);
  });

  it.each([
    ["an offset in the wall clock", { local: "2027-03-28T01:59+01:00", zone: "Europe/Berlin" }],
    ["a bare ISO-Z instant", { local: "2027-03-28T00:59:00.000Z", zone: "Europe/Berlin" }],
    ["no zone at all", { local: "2027-03-28T01:59" }],
    [
      "both a zone and a place",
      { local: "2027-03-28T01:59", zone: "Europe/Berlin", placeRef: { kind: "port", id: "x" } },
    ],
    ["an unknown zone", { local: "2027-03-28T01:59", zone: "Mars/Olympus" }],
    ["a raw offset as zone", { local: "2027-03-28T01:59", zone: "+01:00" }],
  ])("refuses %s", (_label, body) => {
    expect(localTimeInputSchema.safeParse(body).success).toBe(false);
  });
});

describe("localDateInputSchema", () => {
  it("accepts a real day and refuses one that is not", () => {
    expect(localDateInputSchema.safeParse("2028-02-29").success).toBe(true);
    expect(localDateInputSchema.safeParse("2027-02-29").success).toBe(false);
    expect(localDateInputSchema.safeParse("2027-05-02T00:00:00Z").success).toBe(false);
  });
});

describe("serializeTime", () => {
  it("builds {utc, zone, offset, local, precision} from the stored instant and zone", () => {
    expect(serializeTime(new Date("2027-01-14T23:59:00Z"), "Asia/Kathmandu")).toEqual({
      utc: "2027-01-14T23:59:00.000Z",
      zone: "Asia/Kathmandu",
      offset: "+05:45",
      local: "2027-01-15T05:44:00",
      precision: "minute",
      zoneSource: "stored",
    });
  });

  it("says a zone came from today's catalogue instead of passing it off as stored", () => {
    expect(
      serializeTime(new Date("2027-06-01T08:00:00Z"), "Europe/Berlin", "minute", "catalogue")
    ).toMatchObject({
      zone: "Europe/Berlin",
      zoneSource: "catalogue",
      local: "2027-06-01T10:00:00",
    });
  });

  it("shows an instant with no known zone as UTC, labelled, never as a place's clock", () => {
    expect(serializeTime(new Date("2027-06-01T08:00:00Z"), null)).toEqual({
      utc: "2027-06-01T08:00:00.000Z",
      zone: null,
      offset: "+00:00",
      local: "2027-06-01T08:00:00",
      precision: "minute",
      zoneSource: null,
    });
  });
});

describe("serializeDay", () => {
  it("carries a calendar day as YYYY-MM-DD with its zone and precision", () => {
    expect(serializeDay("2027-05-02", "Pacific/Kiritimati")).toEqual({
      date: "2027-05-02",
      zone: "Pacific/Kiritimati",
      precision: "day",
    });
    expect(serializeDay("2011-07-01", null, "month").precision).toBe("month");
  });

  it("refuses something that is not a real day", () => {
    expect(() => serializeDay("2027-02-30", null)).toThrow();
    expect(() => serializeDay("2027-05-02T00:00:00.000Z", null)).toThrow();
  });
});
