import { describe, expect, it } from "vitest";
import {
  applyResolution,
  rowsToResolve,
  summarizeResolution,
  type ResolvableRow,
} from "../placeImportTakeout";
import type { PlaceImportResolution, ResolvedRow, TakeoutTrip } from "../../types/placeImport";

/**
 * #358: the Takeout suggestions fold into the preview rows as SUGGESTIONS —
 * never over what the file said, never over a decision already made, and a
 * same-name place nearby stays the user's question.
 */

const TRIP = { id: "trip-1", name: "Japan", first: "2024-04-01", last: "2024-04-10" };

const row = (i: number, over: Partial<ResolvableRow> = {}): ResolvableRow => ({
  sourceRowIndex: i,
  name: `Row ${i}`,
  lat: null,
  lon: null,
  externalRef: `gmaps:${i + 1}`,
  flags: ["missing_coordinates"],
  dedupeHint: "none",
  matchedPlaceId: null,
  action: "needs_input",
  decision: "",
  ...over,
});

const answer = (i: number, over: Partial<ResolvedRow> = {}): ResolvedRow => ({
  sourceRowIndex: i,
  position: {
    lat: 35,
    lon: 135,
    source: "google_cid",
    address: "Invented 1",
    city: "Kyoto",
    country: "Japan",
  },
  cidReason: null,
  positionReason: null,
  kind: "sight",
  suggestedTreatment: "place",
  visitDay: { date: "2024-04-05", photoCount: 3 },
  visitDayReason: null,
  matchedStay: null,
  ...over,
});

const resolution = (
  rows: ResolvedRow[],
  trip: TakeoutTrip | null = TRIP
): PlaceImportResolution => ({
  listCountry: "JP",
  trip,
  tripReason: null,
  googleConfigured: true,
  rows,
});

describe("applyResolution", () => {
  it("fills position, day and trip, and pre-selects the suggested treatment", () => {
    const [out] = applyResolution([row(0)], resolution([answer(0)]));
    expect(out).toMatchObject({
      lat: 35,
      lon: 135,
      city: "Kyoto",
      visitedAt: "2024-04-05",
      tripId: "trip-1",
      decision: "create",
      flags: [],
      takeout: { positionSource: "google_cid", photoCount: 3, kind: "sight" },
    });
  });

  it("pre-selects a trip stop for a station and 'my stay' for a matched hotel", () => {
    const out = applyResolution(
      [row(0), row(1)],
      resolution([
        answer(0, { kind: "station", suggestedTreatment: "trip_stop" }),
        answer(1, {
          kind: "lodging",
          suggestedTreatment: "stay",
          matchedStay: { id: "stay-1", name: "Invented Inn", checkIn: "2024-04-03" },
        }),
      ])
    );
    expect(out[0].decision).toBe("trip_stop");
    expect(out[1]).toMatchObject({ decision: "stay", lodgingStayId: "stay-1" });
  });

  it("suggests skipping a whole city", () => {
    const [out] = applyResolution(
      [row(0)],
      resolution([answer(0, { kind: "city", suggestedTreatment: "skip" })])
    );
    expect(out.decision).toBe("skip");
  });

  it("never overwrites the file's own position and date, nor a decision already made", () => {
    const [own, decided] = applyResolution(
      [
        row(0, {
          lat: 1,
          lon: 2,
          visitedAt: "2023-01-01",
          flags: [],
          action: "create",
          decision: "create",
        }),
        row(1, { decision: "skip" }),
      ],
      resolution([answer(0, { position: null }), answer(1)])
    );
    expect(own).toMatchObject({ lat: 1, lon: 2, visitedAt: "2023-01-01", decision: "create" });
    // A date the file gave is not "from photos".
    expect(own.takeout?.photoCount).toBeNull();
    expect(decided.decision).toBe("skip");
  });

  it("keeps a same-name place nearby undecided, and an unplaced row waiting with its reason", () => {
    const [nearby, unplaced] = applyResolution(
      [row(0, { lat: 1, lon: 1, flags: [], dedupeHint: "place_nearby" }), row(1)],
      resolution([
        answer(0, { position: null }),
        answer(1, { position: null, cidReason: "quota", positionReason: "not_in_country" }),
      ])
    );
    expect(nearby.decision).toBe("");
    expect(unplaced.decision).toBe("");
    expect(unplaced.flags).toContain("missing_coordinates");
    expect(unplaced.takeout).toMatchObject({
      cidReason: "quota",
      positionReason: "not_in_country",
    });
  });

  it("falls back to a place when a stop is suggested but no trip was found", () => {
    const [out] = applyResolution(
      [row(0)],
      resolution([answer(0, { kind: "fuel", suggestedTreatment: "trip_stop" })], null)
    );
    expect(out.decision).toBe("create");
    expect(out.tripId).toBeNull();
  });
});

describe("rowsToResolve", () => {
  it("sends unplaced rows and Maps rows, never a row already held", () => {
    const rows = [
      row(0),
      row(1, { lat: 1, lon: 1, flags: [], externalRef: "gmaps:9", action: "create" }),
      row(2, { lat: 1, lon: 1, flags: [], externalRef: "csv:x", action: "create" }),
      row(3, { action: "skip", dedupeHint: "place_exact_ref" }),
    ];
    expect(rowsToResolve(rows).map((r) => r.sourceRowIndex)).toEqual([0, 1]);
  });
});

describe("summarizeResolution", () => {
  it("counts sources and names every reason, Google failures included", () => {
    const s = summarizeResolution(
      resolution([
        answer(0),
        answer(1, {
          position: {
            lat: 1,
            lon: 1,
            source: "name_search",
            address: null,
            city: null,
            country: null,
          },
          cidReason: "auth",
          visitDay: null,
        }),
        answer(2, {
          position: null,
          cidReason: "auth",
          positionReason: "not_in_country",
          visitDay: null,
        }),
        answer(3, {
          position: null,
          cidReason: "no_cid",
          positionReason: "not_in_country",
          visitDay: null,
        }),
      ])
    );
    expect(s).toEqual({
      google: 1,
      byName: 1,
      unplaced: 2,
      datedFromPhotos: 1,
      reasons: [{ reason: "not_in_country", count: 2 }],
      googleFailures: [{ reason: "auth", count: 2 }],
    });
  });
});
