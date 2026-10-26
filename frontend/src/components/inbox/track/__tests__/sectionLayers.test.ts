import { describe, expect, it } from "vitest";
import type { TrackPoint } from "../../../../lib/api/travtrack";
import { sectionLayers } from "../SectionMap";

/** The section map draws one path per stretch, never one line through all, and nothing else. */

const p = (t: number, lat: number, lon: number): TrackPoint => [t, lat, lon, 5];

describe("sectionLayers", () => {
  it("one path per stretch, start and end marked, no ring or outline unless asked", () => {
    const layers = sectionLayers({
      stretches: [
        [p(0, 50, 8), p(1, 50.1, 8)],
        [p(2, 52, 10), p(3, 52.1, 10)],
      ],
    });
    expect(layers.map((l) => l.id)).toEqual(["section-stretches", "section-ends"]);
    const paths = layers[0].props.data as unknown[];
    expect(paths).toEqual([
      [
        [8, 50],
        [8, 50.1],
      ],
      [
        [10, 52],
        [10, 52.1],
      ],
    ]);
    expect((layers[1].props.data as Array<{ position: number[] }>).map((d) => d.position)).toEqual([
      [8, 50],
      [10, 52.1],
    ]);
  });

  it("a stay draws its radius and a country question its outline, under the line", () => {
    const layers = sectionLayers({
      stretches: [[p(0, 50, 8), p(1, 50.1, 8)]],
      ring: { lat: 50, lon: 8, radiusM: 150 },
      country: {
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [8, 50] },
      },
    });
    expect(layers.map((l) => l.id)).toEqual([
      "section-country",
      "section-ring",
      "section-stretches",
      "section-ends",
    ]);
  });
});
