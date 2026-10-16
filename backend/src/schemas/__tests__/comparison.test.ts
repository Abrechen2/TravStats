import {
  aggregateReplySchema,
  leaderboardScopeSchema,
  leaderboardSnapshotSchema,
  personKeySchema,
} from "../comparison";

const snapshot = {
  schema: "travstats-leaderboard",
  version: 1,
  asOf: "2026-10-16T10:00:00.000Z",
  year: null,
  domains: ["flight"],
  metrics: { flightKm: 1200, flights: 3 },
  partial: [],
};

describe("leaderboard wire schemas", () => {
  it("accepts a metric this server does not know, so adding one needs no new version", () => {
    const parsed = leaderboardSnapshotSchema.parse({
      ...snapshot,
      metrics: { ...snapshot.metrics, hikeKm: 4 },
    });
    expect(parsed.metrics.hikeKm).toBe(4);
  });

  it("rejects prototype names and oversized metric records from a remote server", () => {
    for (const raw of ['{"__proto__":1}', '{"constructor":1}', '{"toString":1}', '{"a-b":1}']) {
      expect(
        leaderboardSnapshotSchema.safeParse({ ...snapshot, metrics: JSON.parse(raw) }).success
      ).toBe(false);
    }
    const many = Object.fromEntries(
      Array.from({ length: 65 }, (_, i) => [
        `m${"abcdefghij"[Math.floor(i / 10)]}${"abcdefghij"[i % 10]}`,
        1,
      ])
    );
    expect(leaderboardSnapshotSchema.safeParse({ ...snapshot, metrics: many }).success).toBe(false);
    expect(
      leaderboardSnapshotSchema.safeParse({ ...snapshot, metrics: { flights: -1 } }).success
    ).toBe(false);
  });

  it("needs at least one group and one domain, without duplicates", () => {
    expect(
      leaderboardScopeSchema.safeParse({ groups: [], domains: ["flight"], year: null }).success
    ).toBe(false);
    expect(
      leaderboardScopeSchema.safeParse({ groups: ["trips"], domains: [], year: null }).success
    ).toBe(false);
    expect(
      leaderboardScopeSchema.safeParse({
        groups: ["trips", "trips"],
        domains: ["flight"],
        year: null,
      }).success
    ).toBe(false);
    expect(
      leaderboardScopeSchema.parse({ groups: ["trips"], domains: ["flight"], year: 2025 })
    ).toEqual({
      groups: ["trips"],
      domains: ["flight"],
      year: 2025,
    });
  });

  it("addresses a person by kind and uuid only", () => {
    expect(personKeySchema.safeParse("local:0b9b3f9e-2c47-4f0e-9a0f-3c1d2b4a5e6f").success).toBe(
      true
    );
    expect(personKeySchema.safeParse("self").success).toBe(false);
    expect(personKeySchema.safeParse("remote:../../etc").success).toBe(false);
  });

  it("knows exactly the five aggregate answers", () => {
    expect(aggregateReplySchema.safeParse({ status: "leaked" }).success).toBe(false);
    expect(aggregateReplySchema.parse({ status: "yearNotShared", year: 2024 })).toEqual({
      status: "yearNotShared",
      year: 2024,
    });
  });
});
