import { buildAnchors, suggestVisits } from "../visitSuggestions";

/**
 * POI Phase D, piece 1. Immich-imported trip photos already carry lat/lon and a
 * date, and were doing nothing for suggestions — a trip with a linked album is
 * already a list of dated, positioned points.
 *
 * A photo is the only anchor here that is not a proxy: every other kind records
 * where the TRAVEL was and infers where the person stood, while a geotagged
 * photo is a GPS fix at the moment the shutter opened. That is what the 1 km
 * radius and the top confidence rank are for, and it is what these tests pin —
 * a later "make the radii consistent" would otherwise spend the one precise
 * anchor on the guesses the weak ones already make.
 */
const COLOSSEUM = { itemId: "colosseum", name: "Colosseo", lat: 41.8902, lon: 12.4922 };

const emptySources = { lodgings: [], cruiseStops: [], flights: [], places: [] };

describe("a geotagged photo is an anchor", () => {
  it("suggests a target the photo was taken beside", () => {
    const anchors = buildAnchors({
      ...emptySources,
      photos: [
        { lat: 41.8905, lon: 12.4925, takenAt: new Date("2024-04-12"), tripName: "Rom 2024" },
      ],
    });

    const [hit] = suggestVisits([COLOSSEUM], anchors);
    expect(hit.itemId).toBe("colosseum");
    expect(hit.confidence).toBe("high");
  });

  it("does not reach across a city the way a flight does", () => {
    // ~7 km away: well inside a flight's 15 km and a hotel's 30, and far
    // outside a photograph's 1 km. Standing 7 km from the Colosseum is not
    // evidence of having been at it.
    const anchors = buildAnchors({
      ...emptySources,
      photos: [
        { lat: 41.953, lon: 12.4922, takenAt: new Date("2024-04-12"), tripName: "Rom 2024" },
      ],
    });

    expect(suggestVisits([COLOSSEUM], anchors)).toEqual([]);
  });

  it("outranks a hotel that reaches the same target", () => {
    const anchors = buildAnchors({
      ...emptySources,
      lodgings: [
        {
          name: "Hotel Adlon",
          lat: 41.8951,
          lon: 12.483,
          checkIn: new Date("2024-04-11"),
          checkOut: new Date("2024-04-14"),
          status: "visited",
        },
      ],
      photos: [
        { lat: 41.8905, lon: 12.4925, takenAt: new Date("2024-04-12"), tripName: "Rom 2024" },
      ],
    });

    const [hit] = suggestVisits([COLOSSEUM], anchors);
    // Both reach it; the question is which reason the user is shown.
    expect(hit.anchorKind).toBe("photo");
    expect(hit.anchorLabel).toBe("Rom 2024");
  });

  it("keeps a photo that has coordinates but no date", () => {
    // Position without a date is still evidence of place. Dropping it would
    // discard the stronger half of the record to punish the missing half.
    const anchors = buildAnchors({
      ...emptySources,
      photos: [{ lat: 41.8905, lon: 12.4925, takenAt: null, tripName: "Rom 2024" }],
    });

    expect(suggestVisits([COLOSSEUM], anchors)).toHaveLength(1);
  });

  it("ignores a photo with no position at all", () => {
    const anchors = buildAnchors({
      ...emptySources,
      photos: [{ lat: null, lon: null, takenAt: new Date("2024-04-12"), tripName: "Rom 2024" }],
    });

    expect(anchors).toEqual([]);
  });

  it("changes nothing for a caller that passes no photos", () => {
    // The field is optional so every existing caller keeps behaving identically.
    expect(buildAnchors(emptySources)).toEqual([]);
  });
});
