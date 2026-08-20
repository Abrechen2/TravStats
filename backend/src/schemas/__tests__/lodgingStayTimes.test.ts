/**
 * Optional check-in/check-out TIMES on a stay (tester wish, #dev-talk
 * 2026-08-18: a planned hotel should not "begin" at midnight). The times are
 * wall-clock "HH:mm" strings beside the UTC-midnight day anchors — a time is
 * a claim about a specific day, so it requires that day to exist and to be
 * DAY-precise.
 */
import { createStaySchema, updateStaySchema } from "../lodging";

const DAY_STAY = {
  checkIn: "2026-09-01T00:00:00.000Z",
  checkOut: "2026-09-03T00:00:00.000Z",
  datePrecision: "DAY",
  status: "scheduled",
};

describe("stay check-in/check-out times", () => {
  it("accepts valid HH:mm times on a DAY-precision stay", () => {
    const parsed = createStaySchema.parse({
      ...DAY_STAY,
      checkInTime: "15:00",
      checkOutTime: "11:00",
    });
    expect(parsed.checkInTime).toBe("15:00");
    expect(parsed.checkOutTime).toBe("11:00");
  });

  it("accepts a stay without any times (they stay optional)", () => {
    const parsed = createStaySchema.parse(DAY_STAY);
    expect(parsed.checkInTime).toBeUndefined();
    expect(parsed.checkOutTime).toBeUndefined();
  });

  it.each(["25:00", "12:60", "9:00", "noon", "15:00:00"])(
    "rejects the malformed time %s",
    (bad) => {
      expect(() => createStaySchema.parse({ ...DAY_STAY, checkInTime: bad })).toThrow();
    },
  );

  it("rejects a check-in time without a check-in date", () => {
    expect(() =>
      createStaySchema.parse({ datePrecision: "NONE", status: "completed", checkInTime: "15:00" }),
    ).toThrow();
  });

  it("rejects a check-out time without a check-out date", () => {
    expect(() =>
      createStaySchema.parse({
        checkIn: "2026-09-01T00:00:00.000Z",
        datePrecision: "DAY",
        status: "scheduled",
        checkOutTime: "11:00",
      }),
    ).toThrow();
  });

  it("rejects times on MONTH/YEAR precision — a time on 'some time in July' is noise", () => {
    expect(() =>
      createStaySchema.parse({
        checkIn: "2011-07-01T00:00:00.000Z",
        datePrecision: "MONTH",
        status: "completed",
        checkInTime: "15:00",
      }),
    ).toThrow();
  });

  it("allows clearing a time via null on update", () => {
    const parsed = updateStaySchema.parse({ checkInTime: null });
    expect(parsed.checkInTime).toBeNull();
  });

  it("accepts a plain time on update (merge validation lives in the route)", () => {
    const parsed = updateStaySchema.parse({ checkOutTime: "10:30" });
    expect(parsed.checkOutTime).toBe("10:30");
  });
});
