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

  // #317: the editor's left-half-of-the-first-star click emits 0.5, and the
  // schema rejected it with "Number must be greater than or equal to 1" — so a
  // stay rated half a star for breakfast could not be saved at all.
  it("accepts the lowest rating the half-star picker can produce", () => {
    const r = createStaySchema.safeParse({
      checkIn: "2024-05-14T15:00:00.000Z",
      checkOut: "2024-05-16T11:00:00.000Z",
      ratingBreakfast: 0.5,
      ratingRoom: 0.5,
      ratingService: 0.5,
    });
    expect(r.success).toBe(true);
  });

  it("still rejects a rating below the lowest half star", () => {
    const r = createStaySchema.safeParse({
      checkIn: "2024-05-14T15:00:00.000Z",
      checkOut: "2024-05-16T11:00:00.000Z",
      ratingBreakfast: 0.25,
    });
    expect(r.success).toBe(false);
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

  // An independent Codex review (2026-09-17) found that only the EXPLICIT
  // `nights` field was capped at 3650 — the checkIn/checkOut SPAN had no
  // bound beyond `checkOut >= checkIn`. A stay saved with
  // checkIn="0001-01-01" / checkOut="9999-12-31" made `walkNights` loop
  // ~3.6M times on every later lodging-statistics request, building
  // ~3.6M-entry maps. Bounding the span here, the same way the explicit
  // count is bounded, refuses the row at the API boundary.
  describe("checkIn/checkOut span cap (3650 nights, mirrors the explicit `nights` cap)", () => {
    it("rejects a span longer than 3650 nights on create", () => {
      const r = createStaySchema.safeParse({
        checkIn: "0001-01-01T00:00:00.000Z",
        checkOut: "9999-12-31T00:00:00.000Z",
      });
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.issues.some((i) => i.path.includes("checkOut"))).toBe(true);
      }
    });

    it("accepts a span of exactly 3650 nights on create", () => {
      // 2020-01-01 + 3650*86,400,000 ms = 2029-12-29, computed rather than
      // guessed at a calendar distance — leap years make "+10 years" 3653 days.
      const r = createStaySchema.safeParse({
        checkIn: "2020-01-01T00:00:00.000Z",
        checkOut: "2029-12-29T00:00:00.000Z",
      });
      expect(r.success).toBe(true);
    });

    it("rejects a span longer than 3650 nights on update", () => {
      const r = updateStaySchema.safeParse({
        checkIn: "0001-01-01T00:00:00.000Z",
        checkOut: "9999-12-31T00:00:00.000Z",
      });
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.issues.some((i) => i.path.includes("checkOut"))).toBe(true);
      }
    });
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
