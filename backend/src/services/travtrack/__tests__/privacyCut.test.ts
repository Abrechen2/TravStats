import { privacyCut, segmentCrossesZone } from "../privacyCut";

/**
 * The final-output privacy check (TravTrack plan T5): nothing inside a circle,
 * and no chord through one — on the geometry as it leaves the server.
 */

const HOME = { lat: 37.5665, lon: 126.978, radiusM: 250 };

describe("privacyCut", () => {
  it("drops every vertex inside a zone and breaks the line there", () => {
    const line: [number, number][] = [
      [126.95, 37.5665],
      [126.96, 37.5665],
      [126.978, 37.5665], // home
      [126.99, 37.5665],
      [127.0, 37.5665],
    ];
    expect(privacyCut([line], [HOME])).toEqual([
      [
        [126.95, 37.5665],
        [126.96, 37.5665],
      ],
      [
        [126.99, 37.5665],
        [127.0, 37.5665],
      ],
    ]);
  });

  it("a simplified line whose new chord crosses a zone is broken there", () => {
    // Both vertices are far outside the zone; the chord between them runs through it.
    const chord: [number, number][] = [
      [126.95, 37.5665],
      [127.01, 37.5665],
    ];
    expect(segmentCrossesZone(chord[0], chord[1], HOME)).toBe(true);
    expect(privacyCut([chord], [HOME])).toEqual([]);
  });

  it("a chord that passes beside a zone stays whole", () => {
    const chord: [number, number][] = [
      [126.95, 37.58],
      [127.01, 37.58],
    ];
    expect(privacyCut([chord], [HOME])).toEqual([chord]);
  });

  it("checks a long chord as the great circle and as the line a map draws", () => {
    // 2,000 km along a meridian, passing 100 m from a 150 m zone's centre.
    const zone = { lat: 10, lon: 20.0009, radiusM: 150 };
    expect(segmentCrossesZone([20, 0], [20, 20], zone)).toBe(true);
    expect(segmentCrossesZone([20, 0], [20, 20], { ...zone, lon: 20.01 })).toBe(false);
  });

  it("cuts a home circle given beside the zones", () => {
    const line: [number, number][] = [
      [10, 50],
      [10.0001, 50],
      [10.02, 50],
    ];
    expect(privacyCut([line], [], { home: { lat: 50, lon: 10 }, homeM: 1000 })).toEqual([]);
  });

  it("leaves a line alone without circles, but never a single vertex", () => {
    expect(
      privacyCut(
        [
          [[1, 1]],
          [
            [1, 1],
            [2, 2],
          ],
        ],
        []
      )
    ).toEqual([
      [
        [1, 1],
        [2, 2],
      ],
    ]);
  });
});
