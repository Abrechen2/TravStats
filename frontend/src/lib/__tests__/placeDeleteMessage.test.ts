import { describe, it, expect } from "vitest";
import { germanT } from "../../__tests__/helpers/germanT";
import { placeDeleteMessage } from "../placeDeleteMessage";
import type { PlaceRelations } from "../api/places";

/**
 * The one sentence the list and the detail page ask a place delete with
 * (forgejo#250), read through the real German resources.
 */
const t = germanT as unknown as (key: string, options?: Record<string, unknown>) => string;

const relations = (over: Partial<PlaceRelations> = {}): PlaceRelations => ({
  visitCount: 2,
  plannedVisitCount: 1,
  photoCount: 0,
  documentCount: 0,
  lists: [],
  trips: [],
  roadtripStationCount: 0,
  ...over,
});

describe("placeDeleteMessage", () => {
  it("counts every visit the server knows of, planned ones included", () => {
    expect(placeDeleteMessage(t, "Pantheon", 1, relations())).toBe(
      "„Pantheon“ wird mit 2 Besuchen dauerhaft gelöscht."
    );
  });

  it("names what goes with it and what stays, one line each", () => {
    const text = placeDeleteMessage(
      t,
      "Pantheon",
      1,
      relations({
        photoCount: 1,
        documentCount: 2,
        lists: [
          { id: "a", name: "Rom" },
          { id: "b", name: "Kuppeln" },
        ],
        trips: [{ id: "t", name: "Rom 2025" }],
        roadtripStationCount: 1,
      })
    );
    expect(text.split("\n")).toEqual([
      "„Pantheon“ wird mit 2 Besuchen dauerhaft gelöscht.",
      "Dazu ein Beleg-Foto, das mit gelöscht wird.",
      "Er verschwindet aus 2 Listen (Rom, Kuppeln); die Listen selbst bleiben.",
      "Dazu 2 Dokumente, die mit gelöscht werden.",
      "Erhalten bleiben: Rom 2025",
      "Eine Roadtrip-Station, die ihn nennt, bleibt erhalten.",
    ]);
  });

  it("says nothing more for a bare place", () => {
    expect(placeDeleteMessage(t, "Trevi", 0, relations({ visitCount: 0 }))).toBe(
      "„Trevi“ wird dauerhaft gelöscht."
    );
  });

  it("uses the caller's count and names trips in general while the counts are unknown", () => {
    expect(placeDeleteMessage(t, "Trevi", 3, null)).toBe(
      "„Trevi“ wird mit 3 Besuchen dauerhaft gelöscht.\nVerknüpfte Reisen bleiben erhalten."
    );
  });
});
