import type { DerivationPoint } from "../derivationRead";
import { toDetectorInput, toTimedPosition } from "../toDetectorInput";

const point: DerivationPoint = {
  ref: "42",
  atMs: Date.parse("2026-10-12T03:04:05.678Z"),
  lat: 37.5665,
  lon: 126.978,
  accuracyM: 12,
  altitudeM: 38.5,
  speedMps: 1.4,
  courseDeg: 270,
  deviceId: "phone-1",
  key: "1760238245|126.978|37.5665",
  digest: "0123456789abcdef0123456789abcdef",
  inFlight: false,
};

describe("toDetectorInput", () => {
  it("toDetectorInput keeps speed in m/s and uses the digest as id", () => {
    expect(toDetectorInput(point)).toEqual({
      id: "0123456789abcdef0123456789abcdef",
      timestampMs: point.atMs,
      latitude: 37.5665,
      longitude: 126.978,
      altitude: 38.5,
      accuracy: 12,
      velocity: 1.4,
      trackId: null,
    });
  });

  it("drops the course, the provider ref and the device", () => {
    const input = toDetectorInput(point) as Record<string, unknown>;
    for (const field of ["courseDeg", "course", "ref", "deviceId", "key", "digest"]) {
      expect(input).not.toHaveProperty(field);
    }
  });

  it("keeps an unknown altitude, accuracy and speed unknown", () => {
    const bare = { ...point, altitudeM: null, accuracyM: null, speedMps: null };
    expect(toDetectorInput(bare)).toMatchObject({ altitude: null, accuracy: null, velocity: null });
  });

  it("toTimedPosition answers the country reducer's three fields only", () => {
    expect(toTimedPosition(point)).toEqual({
      latitude: 37.5665,
      longitude: 126.978,
      timestampMs: point.atMs,
    });
  });
});
