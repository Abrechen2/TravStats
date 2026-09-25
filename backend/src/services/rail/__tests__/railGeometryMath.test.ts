import {
  decodePolyline,
  isTracedShape,
  lineLengthKm,
  sliceBetween,
  type LonLat,
} from "../railGeometryMath";
import {
  BERLIN,
  encodePolyline,
  FRANKFURT,
  FULDA,
  tracedLine,
} from "../lookup/__tests__/railFetchMock";

const at = (s: { lat: number; lon: number }): LonLat => [s.lon, s.lat];

describe("decodePolyline", () => {
  it("reads Google's reference polyline at precision 5", () => {
    // developers.google.com/maps/documentation/utilities/polylinealgorithm
    const points = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", 5);
    expect(points).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]);
  });

  it("reads MOTIS' precision 6 — a precision-5 reading would put Frankfurt near the equator", () => {
    const encoded = encodePolyline([at(FRANKFURT), at(FULDA)], 6);
    const [first] = decodePolyline(encoded, 6);
    expect(first[0]).toBeCloseTo(FRANKFURT.lon, 5);
    expect(first[1]).toBeCloseTo(FRANKFURT.lat, 5);
  });

  it("refuses a truncated string instead of inventing a point", () => {
    expect(() => decodePolyline("_p~iF~ps|U_", 5)).toThrow("truncated");
  });
});

describe("isTracedShape", () => {
  it("accepts a line whose points are close together", () => {
    expect(isTracedShape(tracedLine([FRANKFURT, FULDA, BERLIN]))).toBe(true);
  });

  it("rejects station-to-station chords — a feed without shapes is not a trace", () => {
    // Frankfurt–Fulda alone is ~85 km, far over the 35 km a segment may span.
    expect(isTracedShape([at(FRANKFURT), at(FULDA), at(BERLIN)])).toBe(false);
  });

  it("rejects a line that is traced except for one long jump", () => {
    const line = [...tracedLine([FRANKFURT, FULDA]), at(BERLIN)];
    expect(isTracedShape(line)).toBe(false);
  });
});

describe("sliceBetween", () => {
  const line = tracedLine([FRANKFURT, FULDA, BERLIN]);

  it("cuts the whole trip down to the ride, ending on the stations themselves", () => {
    const slice = sliceBetween(line, at(FRANKFURT), at(FULDA))!;
    expect(slice[0]).toEqual(at(FRANKFURT));
    expect(slice[slice.length - 1]).toEqual(at(FULDA));
    // Frankfurt–Fulda, not Frankfurt–Berlin.
    expect(lineLengthKm(slice)).toBeGreaterThan(80);
    expect(lineLengthKm(slice)).toBeLessThan(95);
  });

  it("answers null when a station is not on the line", () => {
    const paris: LonLat = [2.3591, 48.8768];
    expect(sliceBetween(line, at(FRANKFURT), paris)).toBeNull();
  });

  it("answers null when the arrival comes before the departure along the line", () => {
    expect(sliceBetween(line, at(FULDA), at(FRANKFURT))).toBeNull();
  });
});
