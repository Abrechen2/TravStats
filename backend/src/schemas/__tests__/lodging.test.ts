import {
  createLodgingSchema,
  updateLodgingSchema,
  createStaySchema,
  updateStaySchema,
  lodgingQuerySchema,
  LODGING_TYPES,
} from "../lodging";

describe("lodging schemas", () => {
  it("accepts a minimal valid lodging", () => {
    const r = createLodgingSchema.safeParse({
      name: "NH Ludwigsburg",
      type: "hotel",
    });
    expect(r.success).toBe(true);
  });

  describe("LODGING_TYPES vocabulary (guesthouse/apartment/hostel)", () => {
    it.each(LODGING_TYPES)("accepts %s as a lodging type", (type) => {
      const r = createLodgingSchema.safeParse({ name: "X", type });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.type).toBe(type);
    });

    it("rejects an unknown lodging type", () => {
      const r = createLodgingSchema.safeParse({ name: "X", type: "resort" });
      expect(r.success).toBe(false);
    });

    it("defaults to hotel when type is omitted", () => {
      const r = createLodgingSchema.safeParse({ name: "X" });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.type).toBe("hotel");
    });
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

  it("strips a client-supplied dataSource — it is server-set provenance, never client input (finding 1)", () => {
    const r = createLodgingSchema.safeParse({ name: "X", dataSource: "parser" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).not.toHaveProperty("dataSource");
    }
  });

  it("rejects an empty stay update body (finding 4)", () => {
    const r = updateStaySchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it("still rejects checkOut before checkIn when both dates are present on update", () => {
    const r = updateStaySchema.safeParse({
      checkIn: "2024-05-16T15:00:00.000Z",
      checkOut: "2024-05-14T11:00:00.000Z",
    });
    expect(r.success).toBe(false);
  });

  it("still accepts a single-field update (e.g. notes only)", () => {
    const r = updateStaySchema.safeParse({ notes: "Lovely stay" });
    expect(r.success).toBe(true);
  });

  it("accepts a local-upload receiptUrl", () => {
    const r = createStaySchema.safeParse({
      checkIn: "2024-05-14T15:00:00.000Z",
      checkOut: "2024-05-16T11:00:00.000Z",
      receiptUrl: "/api/v1/uploads/receipts/abc123.pdf",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a receiptUrl on an untrusted external domain", () => {
    const r = createStaySchema.safeParse({
      checkIn: "2024-05-14T15:00:00.000Z",
      checkOut: "2024-05-16T11:00:00.000Z",
      receiptUrl: "https://evil.example.com/steal.pdf",
    });
    expect(r.success).toBe(false);
  });

  describe("nullable clearable fields (finding 4)", () => {
    it("accepts explicit null for every previously-unclearable lodging field", () => {
      const r = updateLodgingSchema.safeParse({
        address: null,
        city: null,
        country: null,
        notes: null,
      });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.address).toBeNull();
        expect(r.data.city).toBeNull();
        expect(r.data.country).toBeNull();
        expect(r.data.notes).toBeNull();
      }
    });

    it("accepts explicit null for every previously-unclearable stay field", () => {
      const r = updateStaySchema.safeParse({
        roomNumber: null,
        roomCategory: null,
        pricePerNight: null,
        totalPrice: null,
        bookingReference: null,
        receiptUrl: null,
        ratingRoom: null,
        ratingBreakfast: null,
        ratingService: null,
        ratingOverall: null,
        notes: null,
      });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.roomNumber).toBeNull();
        expect(r.data.totalPrice).toBeNull();
        expect(r.data.receiptUrl).toBeNull();
        expect(r.data.ratingOverall).toBeNull();
        expect(r.data.notes).toBeNull();
      }
    });
  });
});
