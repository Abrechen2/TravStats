import {
  createRouteSchema,
  updateRouteSchema,
  assignStopsSchema,
  legOverrideSchema,
} from "../schemas/tour";

describe("createRouteSchema", () => {
  it("accepts a minimal section", () => {
    expect(createRouteSchema.parse({ name: "Südnorwegen", mode: "road" })).toMatchObject({
      name: "Südnorwegen",
      mode: "road",
    });
  });

  it("rejects a mode that is not a transport mode", () => {
    expect(() => createRouteSchema.parse({ name: "X", mode: "hotel" })).toThrow();
  });

  it("rejects an empty name", () => {
    expect(() => createRouteSchema.parse({ name: "", mode: "road" })).toThrow();
  });
});

describe("assignStopsSchema", () => {
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "22222222-2222-4222-8222-222222222222";

  it("accepts an ordered id list of distinct stops", () => {
    const parsed = assignStopsSchema.parse({ stopIds: [A, B] });
    expect(parsed.stopIds).toEqual([A, B]);
  });

  it("rejects a repeated stop id — a loop is two distinct stops, not one twice", () => {
    // routeOrderIdx is one Int per stop under @@unique([routeId, routeOrderIdx]);
    // a stop cannot hold two positions. Model a loop with a second stop at the
    // same coordinates instead.
    expect(() => assignStopsSchema.parse({ stopIds: [A, B, A] })).toThrow();
  });

  it("accepts an empty list — that releases every stop", () => {
    expect(assignStopsSchema.parse({ stopIds: [] }).stopIds).toEqual([]);
  });

  it("rejects an id that is not a uuid", () => {
    // TripStop.id is @default(uuid()); a non-uuid can never name a real
    // stop, so the boundary refuses it instead of the database.
    expect(() => assignStopsSchema.parse({ stopIds: [A, "not-a-stop"] })).toThrow();
  });

  it("rejects a list longer than the cap", () => {
    expect(() => assignStopsSchema.parse({ stopIds: Array(513).fill(A) })).toThrow();
  });
});

describe("legOverrideSchema", () => {
  const line: Array<[number, number]> = [
    [10.75, 59.91],
    [11.97, 57.71],
  ];

  it("accepts a drawn line", () => {
    expect(legOverrideSchema.parse({ source: "drawn", waypoints: line }).source).toBe("drawn");
  });

  it("requires at least two points for a drawn line", () => {
    expect(() => legOverrideSchema.parse({ source: "drawn", waypoints: [[10.75, 59.91]] })).toThrow();
  });

  it("rejects coordinates outside the world", () => {
    expect(() =>
      legOverrideSchema.parse({ source: "drawn", waypoints: [[200, 59.91], [11.97, 57.71]] }),
    ).toThrow();
  });

  it("rejects waypoints on a straight leg — a straight leg has no line", () => {
    expect(() => legOverrideSchema.parse({ source: "straight", waypoints: line })).toThrow();
  });

  it("accepts a straight leg with no waypoints", () => {
    expect(legOverrideSchema.parse({ source: "straight" }).source).toBe("straight");
  });

  it("refuses source \"routed\" — that geometry comes from the routing endpoint, not a request body", () => {
    // Fix round 1: the manual override endpoint and the routing endpoint own
    // DIFFERENT source vocabularies (MANUAL_LEG_SOURCES vs
    // ACCEPTED_LEG_SOURCES) — see the doc comment on both in schemas/tour.ts.
    // A caller cannot hand-supply provider geometry through this endpoint.
    let error: unknown;
    try {
      legOverrideSchema.parse({ source: "routed" });
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(String(error)).toMatch(/route/i);
  });

  it("accepts source \"track\" with a trackId — the geometry comes from the referenced track, not this body", () => {
    const trackId = "e5e5f1f0-9b1a-4e2a-9b1a-4e2a9b1a4e2c";
    expect(legOverrideSchema.parse({ source: "track", trackId })).toEqual({
      source: "track",
      trackId,
    });
  });

  it("rejects source \"track\" with no trackId — trackId is required, track itself is NOT refused", () => {
    // Fix round 1: this test used to be titled "still rejects track — phase
    // 3b owns producing it, not this task", from before track was a
    // valid source at all. Phase 3b IS this task now, and track IS
    // produced (see the positive test above). This 400 is ONLY about the
    // missing trackId - the assertion checks the error names trackId
    // specifically, so a regression that rejected track outright (a
    // discriminator mismatch on source instead) would fail this test
    // rather than accidentally satisfy it.
    let error: unknown;
    try {
      legOverrideSchema.parse({ source: "track" });
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(String(error)).toMatch(/trackId/);
  });

  it("a track leg strips any supplied waypoints — the geometry comes from the track, never the request body", () => {
    // The single most important property the discriminated union exists
    // to provide: one leg, one source of truth for its geometry. A caller
    // attaching waypoints to a track leg must not smuggle them through -
    // the track-branch shape has no waypoints field at all, so zod's
    // default (non-strict) object parsing silently drops the unknown key
    // rather than erroring, and the parsed result must reflect that.
    const trackId = "e5e5f1f0-9b1a-4e2a-9b1a-4e2a9b1a4e2c";
    const parsed = legOverrideSchema.parse({
      source: "track",
      trackId,
      waypoints: line,
    });
    expect(parsed).not.toHaveProperty("waypoints");
    expect(parsed).toEqual({ source: "track", trackId });
  });
});

describe("updateRouteSchema", () => {
  it("allows clearing the odometer readings", () => {
    expect(updateRouteSchema.parse({ startOdometerKm: null }).startOdometerKm).toBeNull();
  });

  it("rejects a negative odometer reading", () => {
    expect(() => updateRouteSchema.parse({ startOdometerKm: -1 })).toThrow();
  });
});
