import { createStopSchema, createTripSchema, updateStopSchema, updateTripSchema } from "../trip";

/**
 * SRV-TRIP-DATE-001 (audit 2026-09-20): POST answered 201 for a trip running
 * 10.08.2025 to 01.08.2025, and the inverted span then showed in Web and
 * Companion. Cruises and stays had refused this since their first schema;
 * trips simply never asked.
 */
describe("trip schemas — a span must not end before it starts", () => {
  it("refuses a created trip whose end precedes its start", () => {
    const r = createTripSchema.safeParse({
      name: "Sommer",
      startDate: "2025-08-10T00:00:00Z",
      endDate: "2025-08-01T00:00:00Z",
    });
    expect(r.success).toBe(false);
  });

  it("refuses the same span on a PATCH that carries both dates", () => {
    const r = updateTripSchema.safeParse({
      startDate: "2025-08-10T00:00:00Z",
      endDate: "2025-08-01T00:00:00Z",
    });
    expect(r.success).toBe(false);
  });

  it("accepts a trip that starts and ends on the same day", () => {
    const r = createTripSchema.safeParse({
      name: "Tagesausflug",
      startDate: "2025-08-10T00:00:00Z",
      endDate: "2025-08-10T00:00:00Z",
    });
    expect(r.success).toBe(true);
  });

  it("accepts a trip with only one end known", () => {
    expect(createTripSchema.safeParse({ name: "Offen", startDate: "2025-08-10Z" }).success).toBe(
      true
    );
    expect(updateTripSchema.safeParse({ endDate: "2025-08-01T00:00:00Z" }).success).toBe(true);
  });

  it("applies the same rule to a trip stop", () => {
    const inverted = { title: "Rom", startDate: "2025-08-10T00:00:00Z", endDate: "2025-08-01Z" };
    expect(createStopSchema.safeParse(inverted).success).toBe(false);
    expect(
      updateStopSchema.safeParse({
        startDate: "2025-08-10T00:00:00Z",
        endDate: "2025-08-01T00:00:00Z",
      }).success
    ).toBe(false);
  });
});
