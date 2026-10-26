import { judgePoint, payloadHash } from "../classify";
import { clipSpan } from "../gaps";

/**
 * One point read and judged on its own (TravTrack plan T2): pure, so the
 * rules are testable without a database.
 */

const base = { id: "a", t: "2026-10-12T01:00:00Z", lat: 1, lon: 1 };

describe("TravTrack classify", () => {
  it("reads purpose and entries, defaulting to everyday and none", () => {
    const plain = judgePoint(base, 0);
    expect(plain).toMatchObject({ kind: "point", point: { purpose: "everyday", entries: [] } });

    const linked = judgePoint(
      {
        ...base,
        purpose: "flight",
        entries: [
          { kind: "flight", id: "f1" },
          { kind: "trip", id: "t1" },
          { kind: "flight", id: "f1" },
        ],
      },
      1
    );
    expect(linked).toMatchObject({
      kind: "point",
      point: {
        purpose: "flight",
        entries: [
          { kind: "flight", id: "f1" },
          { kind: "trip", id: "t1" },
        ],
      },
    });
  });

  it("makes a point invalid for a malformed purpose or entry", () => {
    const bad = [
      { purpose: "walk" },
      { purpose: 3 },
      { entries: "trip" },
      { entries: [{ kind: "cruise", id: "c" }] },
      { entries: [{ kind: "trip", id: "" }] },
      { entries: [{ kind: "trip", id: "x".repeat(65) }] },
      { entries: [{ kind: "trip", id: "a\u0001b" }] },
      { entries: Array.from({ length: 5 }, (_, i) => ({ kind: "trip", id: `t${i}` })) },
    ];
    for (const extra of bad) {
      expect(judgePoint({ ...base, ...extra }, 0)).toMatchObject({
        kind: "dropped",
        reason: "invalid",
      });
    }
  });

  it("hashes the same content the same way, whatever the key order", () => {
    expect(payloadHash([{ a: 1, b: 2 }], [])).toBe(payloadHash([{ b: 2, a: 1 }], []));
    expect(payloadHash([{ a: 1 }], [])).not.toBe(
      payloadHash([{ a: 1 }], [{ from: "x", to: "y", reason: "permission" }])
    );
  });

  it("clips a span against deleted ranges, splitting where one lies inside", () => {
    const r = (from: number, to: number) => ({ fromAt: new Date(from), toAt: new Date(to) });
    expect(clipSpan({ fromMs: 0, toMs: 100 }, [r(40, 60)])).toEqual([
      { fromMs: 0, toMs: 40 },
      { fromMs: 60, toMs: 100 },
    ]);
    expect(clipSpan({ fromMs: 0, toMs: 100 }, [r(-10, 30), r(90, 200)])).toEqual([
      { fromMs: 30, toMs: 90 },
    ]);
    expect(clipSpan({ fromMs: 10, toMs: 20 }, [r(0, 100)])).toEqual([]);
    expect(clipSpan({ fromMs: 10, toMs: 20 }, [])).toEqual([{ fromMs: 10, toMs: 20 }]);
  });
});
