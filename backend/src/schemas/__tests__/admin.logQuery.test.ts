import { readLogFileQuerySchema } from "../admin";

// forgejo#385 (RULE-33): offset + limit sizes `new Array(...)` in readLogFile.
describe("readLogFileQuerySchema bounds", () => {
  it("rejects a fractional or enormous offset", () => {
    expect(readLogFileQuerySchema.safeParse({ offset: "1.5" }).success).toBe(false);
    expect(readLogFileQuerySchema.safeParse({ offset: "4294967295" }).success).toBe(false);
    expect(readLogFileQuerySchema.safeParse({ offset: "100001" }).success).toBe(false);
  });
  it("rejects a fractional limit", () => {
    expect(readLogFileQuerySchema.safeParse({ limit: "2.5" }).success).toBe(false);
  });
  it("accepts integers within bounds", () => {
    expect(readLogFileQuerySchema.parse({ offset: "100000", limit: "1000" })).toEqual({
      offset: 100000,
      limit: 1000,
    });
  });
});
