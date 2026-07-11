import {
  createLodgingSchema,
  createStaySchema,
  lodgingQuerySchema,
} from "../lodging";

describe("lodging schemas", () => {
  it("accepts a minimal valid lodging", () => {
    const r = createLodgingSchema.safeParse({
      name: "NH Ludwigsburg",
      type: "hotel",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an out-of-range star rating", () => {
    const r = createLodgingSchema.safeParse({ name: "X", stars: 7 });
    expect(r.success).toBe(false);
  });

  it("rejects checkOut before checkIn", () => {
    const r = createStaySchema.safeParse({
      checkIn: "2024-05-16T15:00:00.000Z",
      checkOut: "2024-05-14T11:00:00.000Z",
    });
    expect(r.success).toBe(false);
  });

  it("accepts a half-star rating", () => {
    const r = createStaySchema.safeParse({
      checkIn: "2024-05-14T15:00:00.000Z",
      checkOut: "2024-05-16T11:00:00.000Z",
      ratingOverall: 4.5,
    });
    expect(r.success).toBe(true);
  });

  it("coerces query year/limit from strings", () => {
    const r = lodgingQuerySchema.safeParse({ year: "2024", limit: "50" });
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ year: 2024, limit: 50 });
  });
});
