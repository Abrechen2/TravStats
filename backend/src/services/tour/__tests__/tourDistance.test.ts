import { legDistanceKm, drivenKm, travelledKm } from "../tourDistance";

const OSLO = { lat: 59.91, lon: 10.75 };
const GOTHENBURG = { lat: 57.71, lon: 11.97 };

describe("legDistanceKm", () => {
  it("uses the great-circle chord for a straight leg", () => {
    const km = legDistanceKm({ source: "straight", from: OSLO, to: GOTHENBURG });
    // Oslo–Gothenburg is roughly 260 km as the crow flies.
    expect(km).toBeGreaterThan(240);
    expect(km).toBeLessThan(280);
  });

  it("measures the drawn line, not the chord", () => {
    const detour: Array<[number, number]> = [
      [OSLO.lon, OSLO.lat],
      [13.5, 58.8],
      [GOTHENBURG.lon, GOTHENBURG.lat],
    ];
    const straight = legDistanceKm({ source: "straight", from: OSLO, to: GOTHENBURG });
    const drawn = legDistanceKm({ source: "drawn", from: OSLO, to: GOTHENBURG, waypoints: detour });
    expect(drawn).toBeGreaterThan(straight);
  });

  it("falls back to the chord when a drawn leg has no usable line", () => {
    const straight = legDistanceKm({ source: "straight", from: OSLO, to: GOTHENBURG });
    expect(legDistanceKm({ source: "drawn", from: OSLO, to: GOTHENBURG, waypoints: null }))
      .toBeCloseTo(straight, 6);
    expect(legDistanceKm({ source: "drawn", from: OSLO, to: GOTHENBURG, waypoints: [[10.75, 59.91]] }))
      .toBeCloseTo(straight, 6);
  });

  it("is zero for a leg that starts and ends at the same point", () => {
    expect(legDistanceKm({ source: "straight", from: OSLO, to: OSLO })).toBeCloseTo(0, 6);
  });
});

describe("driven vs travelled", () => {
  const legs = [
    { mode: "road", distanceKm: 600 },
    { mode: "ferry", distanceKm: 140 },
    { mode: "foot", distanceKm: 14 },
    { mode: "rail", distanceKm: 90 },
  ];

  it("counts only road kilometres as driven", () => {
    // A van on a ferry is travelling, not driving; a hike is neither; on a
    // train you are a passenger. Mixing these into a vehicle's mileage makes
    // the consumption figure wrong.
    expect(drivenKm(legs)).toBe(600);
  });

  it("counts every leg as travelled", () => {
    expect(travelledKm(legs)).toBe(844);
  });

  it("ignores an unknown mode rather than guessing", () => {
    expect(drivenKm([{ mode: "hovercraft", distanceKm: 10 }])).toBe(0);
  });
});
