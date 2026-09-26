import { z } from "zod";
import { dayFieldSchema, legacyDayFieldSchema, timeFieldSchema } from "../timeInput";
import { fakeUtcOf, instantOfFakeUtc, resolveTimeField } from "../resolveInput";
import { timeErrorFromZod } from "../errors";

/**
 * Phase 2 inbound shapes (ADR 0002 D3). The point is what they REFUSE: an
 * offset-less datetime the host would read in its own zone, and — from a
 * browser session — a bare ISO-Z on a field that used to hold fake UTC.
 */

const visitField = timeFieldSchema({ allowDate: true, impliedPlace: true });

function codeOf(schema: z.ZodType, value: unknown): { code?: string; field?: string } {
  const parsed = z.object({ at: schema }).safeParse({ at: value });
  if (parsed.success) return {};
  const err = timeErrorFromZod(parsed.error);
  return { code: err?.code, field: err?.field };
}

describe("timeFieldSchema", () => {
  it("reads {local}, a day and an offset-bearing instant", () => {
    expect(visitField.parse({ local: "2027-03-28T10:00" })).toEqual({
      kind: "local",
      local: "2027-03-28T10:00",
    });
    expect(visitField.parse("2027-03-28")).toEqual({ kind: "date", date: "2027-03-28" });
    expect(visitField.parse("2027-03-28T08:00:00.000Z")).toMatchObject({
      kind: "instant",
      bareZ: true,
    });
    expect(visitField.parse("2027-03-28T10:00:00+02:00")).toMatchObject({
      kind: "instant",
      bareZ: false,
    });
  });

  it.each([["2027-03-28T10:00"], ["2027-03-28T10:00:00"], ["2027-03-28 10:00"]])(
    "refuses the offset-less %s with TIME_SHAPE_REQUIRED on its field",
    (value) => {
      expect(codeOf(visitField, value)).toEqual({ code: "TIME_SHAPE_REQUIRED", field: "at" });
    }
  );

  it("refuses a day where the field needs a time", () => {
    expect(codeOf(timeFieldSchema(), "2027-03-28").code).toBe("TIME_SHAPE_REQUIRED");
  });

  it("reports an unknown zone inside the object as ZONE_UNKNOWN", () => {
    expect(codeOf(visitField, { local: "2027-03-28T10:00", zone: "Mars/Olympus" })).toEqual({
      code: "ZONE_UNKNOWN",
      field: "at.zone",
    });
  });

  it("needs a zone source where the entity names no place", () => {
    expect(timeFieldSchema().safeParse({ local: "2027-03-28T10:00" }).success).toBe(false);
  });
});

describe("dayFieldSchema", () => {
  it("keeps the day an offset-bearing string WRITES", () => {
    expect(dayFieldSchema().parse("2027-05-02")).toBe("2027-05-02");
    expect(dayFieldSchema().parse("2027-05-02T00:00:00.000Z")).toBe("2027-05-02");
    // Local midnight in Berlin is the previous evening in UTC — the day is 05-02.
    expect(dayFieldSchema().parse("2027-05-02T00:00:00+02:00")).toBe("2027-05-02");
    expect(legacyDayFieldSchema().parse("2027-05-02")).toBe("2027-05-02T00:00:00.000Z");
  });

  it("refuses an offset-less datetime and a day that does not exist", () => {
    expect(codeOf(dayFieldSchema(), "2027-05-02T10:00").code).toBe("TIME_SHAPE_REQUIRED");
    expect(dayFieldSchema().safeParse("2027-02-30").success).toBe(false);
  });
});

describe("resolveTimeField", () => {
  const berlin = { placeZone: () => "Europe/Berlin", userId: "u", viaToken: false };

  it("converts a typed wall clock with the place's zone and keeps the wall clock for the legacy column", async () => {
    const r = await resolveTimeField(
      { kind: "local", local: "2027-07-01T14:30" },
      { ...berlin, field: "visitedAt", legacyFakeUtc: true }
    );
    expect(r.utc.toISOString()).toBe("2027-07-01T12:30:00.000Z");
    expect(r).toMatchObject({ zone: "Europe/Berlin", precision: "minute" });
    expect(fakeUtcOf(r).toISOString()).toBe("2027-07-01T14:30:00.000Z");
  });

  it("refuses a typed time in the spring gap, naming the field", async () => {
    await expect(
      resolveTimeField(
        { kind: "local", local: "2027-03-28T02:30" },
        { ...berlin, field: "visitedAt" }
      )
    ).rejects.toMatchObject({ code: "LOCAL_TIME_NONEXISTENT", field: "visitedAt" });
  });

  it("takes the earlier repeated hour by default and the later with fold", async () => {
    const earlier = await resolveTimeField(
      { kind: "local", local: "2027-10-31T02:30" },
      { ...berlin, field: "x" }
    );
    const later = await resolveTimeField(
      { kind: "local", local: "2027-10-31T02:30", fold: "later" },
      { ...berlin, field: "x" }
    );
    expect(earlier.utc.toISOString()).toBe("2027-10-31T00:30:00.000Z");
    expect(later.utc.toISOString()).toBe("2027-10-31T01:30:00.000Z");
    expect(earlier.ambiguous).toBe(true);
  });

  it("refuses a typed time at a place with no zone instead of reading it as UTC", async () => {
    await expect(
      resolveTimeField(
        { kind: "local", local: "2027-07-01T14:30" },
        { placeZone: () => null, userId: "u", viaToken: false, field: "visitedAt" }
      )
    ).rejects.toMatchObject({ code: "TZ_UNRESOLVED", field: "visitedAt" });
  });

  it("refuses a bare ISO-Z from a browser session on a fake-UTC field, accepts it from a token", async () => {
    const input = { kind: "instant" as const, utc: new Date("2027-07-01T12:30:00Z"), bareZ: true };
    await expect(
      resolveTimeField(input, { ...berlin, field: "visitedAt", legacyFakeUtc: true })
    ).rejects.toMatchObject({ code: "TIME_SHAPE_REQUIRED", field: "visitedAt" });
    const viaToken = await resolveTimeField(input, {
      ...berlin,
      viaToken: true,
      field: "visitedAt",
      legacyFakeUtc: true,
    });
    expect(viaToken.utc.toISOString()).toBe("2027-07-01T12:30:00.000Z");
    expect(viaToken.local).toBe("2027-07-01T14:30:00");
  });

  it("dates a day-only value at the place's midnight, precision day", async () => {
    const r = await resolveTimeField(
      { kind: "date", date: "2027-07-01" },
      { ...berlin, field: "visitedAt" }
    );
    expect(r.utc.toISOString()).toBe("2027-06-30T22:00:00.000Z");
    expect(r.precision).toBe("day");
    expect(fakeUtcOf(r).toISOString()).toBe("2027-07-01T00:00:00.000Z");
  });

  it("reads a legacy fake-UTC value as a machine reading (a gap is not refused)", () => {
    expect(instantOfFakeUtc(new Date("2027-03-28T02:30:00Z"), "Europe/Berlin").toISOString()).toBe(
      "2027-03-28T01:30:00.000Z"
    );
  });
});

describe("years before 100", () => {
  it("are real years, not 1900 + n (Date.UTC's two-digit rule)", () => {
    expect(dayFieldSchema().parse("0001-01-01")).toBe("0001-01-01");
    expect(dayFieldSchema().parse("0001-01-01T00:00:00.000Z")).toBe("0001-01-01");
  });
});
