import { positionKey } from "../../travtrack/classify";
import {
  evidenceSecretFrom,
  observationKey,
  pointDigest,
  pointDigestWith,
  stayEvidenceKey,
  stayEvidenceKeyWith,
} from "../key";

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);

beforeAll(() => {
  // CI sets one; a bare local run has none, and the key module must not mint
  // and persist a real one for a unit test.
  process.env.ENCRYPTION_KEY ??= "c".repeat(64);
});

describe("observationKey", () => {
  it("a Dawarich point and a TravTrack point with the same second and coordinates have the same key", () => {
    // Dawarich: `timestamp` in whole seconds, numeric id; TravTrack: `t` in ms, `t_s`.
    const dawarich = { id: 912_345, atMs: 1_760_000_000 * 1000, lat: 37.5665, lon: 126.978 };
    const travtrack = { tS: 1_760_000_000, lat: 37.5665, lon: 126.978 };
    expect(observationKey(dawarich)).toBe(positionKey(travtrack));
  });

  it("milliseconds do not change the key", () => {
    const base = { atMs: 1_760_000_000_000, lat: 1.25, lon: 2.5 };
    expect(observationKey({ ...base, atMs: base.atMs + 999 })).toBe(observationKey(base));
    expect(observationKey({ ...base, atMs: base.atMs + 1000 })).not.toBe(observationKey(base));
  });
});

describe("pointDigest", () => {
  const key = observationKey({ atMs: 1_760_000_000_000, lat: 1.25, lon: 2.5 });

  it("a digest differs per account and per server secret", () => {
    const a = evidenceSecretFrom(KEY_A);
    const b = evidenceSecretFrom(KEY_B);
    expect(pointDigestWith(a, "u1", key)).not.toBe(pointDigestWith(a, "u2", key));
    expect(pointDigestWith(a, "u1", key)).not.toBe(pointDigestWith(b, "u1", key));
    expect(pointDigestWith(a, "u1", key)).toBe(pointDigestWith(a, "u1", key));
  });

  it("is 16 bytes of hex and does not spell the position", () => {
    const digest = pointDigestWith(evidenceSecretFrom(KEY_A), "u1", key);
    expect(digest).toMatch(/^[0-9a-f]{32}$/);
    expect(digest).not.toContain("1760000000");
  });

  it("the server secret is derived, never the instance key itself", () => {
    expect(evidenceSecretFrom(KEY_A).toString("hex")).not.toBe(KEY_A);
    expect(evidenceSecretFrom(KEY_A)).toHaveLength(32);
  });

  it("the default secret comes from the instance key", () => {
    // Whatever the instance key is here, the default path is the derived one.
    const instance = process.env.ENCRYPTION_KEY;
    expect(instance).toMatch(/^[0-9a-fA-F]{64}$/);
    expect(pointDigest("u1", key)).toBe(
      pointDigestWith(evidenceSecretFrom(instance as string), "u1", key)
    );
  });
});

describe("stayEvidenceKey", () => {
  const stay = {
    first: { atMs: 1_760_000_000_250, lat: 37.5665, lon: 126.978 },
    last: { atMs: 1_760_003_600_900, lat: 37.56651, lon: 126.97801 },
    startMs: 1_760_000_000_250,
    endMs: 1_760_003_600_900,
    lat: 37.566504,
    lon: 126.978005,
  };

  it("the stay key holds no provider id", () => {
    const secret = evidenceSecretFrom(KEY_A);
    // The same stop read from Dawarich (numeric ids) and from TravTrack (seq refs).
    const fromDawarich = stayEvidenceKeyWith(secret, {
      ...stay,
      first: { ...stay.first, id: 41 },
      last: { ...stay.last, id: 977 },
    } as typeof stay);
    const fromTravTrack = stayEvidenceKeyWith(secret, {
      ...stay,
      first: { ...stay.first, ref: "8812" },
      last: { ...stay.last, ref: "9001" },
    } as typeof stay);
    expect(fromDawarich).toBe(fromTravTrack);
    expect(fromDawarich).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rounds the centre to five decimals and keys on the bounds", () => {
    const secret = evidenceSecretFrom(KEY_A);
    expect(stayEvidenceKeyWith(secret, { ...stay, lat: 37.5665041 })).toBe(
      stayEvidenceKeyWith(secret, stay)
    );
    expect(stayEvidenceKeyWith(secret, { ...stay, endMs: stay.endMs + 1 })).not.toBe(
      stayEvidenceKeyWith(secret, stay)
    );
    expect(stayEvidenceKey(stay)).toBe(stayEvidenceKey(stay));
  });
});
