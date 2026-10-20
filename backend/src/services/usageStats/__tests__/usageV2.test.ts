jest.mock("../../../db", () => {
  const count = () => ({ count: jest.fn() });
  return {
    prisma: {
      flight: count(),
      cruise: count(),
      lodgingStay: count(),
      placeVisit: count(),
      tripRoute: count(),
      railJourney: count(),
      rentalBooking: count(),
      busJourney: count(),
      ferryJourney: count(),
      tripSuggestionDecision: count(),
      apiToken: count(),
      user: { findMany: jest.fn() },
    },
  };
});
jest.mock("../../stats/passportLoader", () => ({ loadPassport: jest.fn() }));

import { buildUsageV2 } from "../usageV2";
import { prisma } from "../../../db";
import { loadPassport } from "../../stats/passportLoader";

/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles only */
const p = prisma as any;
const passport = loadPassport as jest.Mock;

/** forgejo#315: what is used, per domain and feature — bucketed counts only. */
describe("buildUsageV2", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const model of Object.values(p) as any[]) model.count?.mockResolvedValue(0);
    p.flight.count.mockResolvedValue(120);
    p.railJourney.count.mockResolvedValue(7);
    p.tripRoute.count.mockResolvedValue(2);
    p.tripSuggestionDecision.count.mockImplementation(({ where }: any) =>
      Promise.resolve(where.status === "accepted" ? 12 : 3)
    );
    p.apiToken.count.mockResolvedValue(1);
    p.user.findMany.mockResolvedValue([{ id: "u1" }, { id: "u2" }]);
    passport.mockImplementation(async (id: string) => ({
      summary: { visitedCountries: id === "u1" ? 34 : 4 },
    }));
  });

  it("buckets every domain, a zero as its own bucket", async () => {
    const v2 = await buildUsageV2();
    expect(v2.domain_buckets).toEqual({
      flight: "51-250",
      cruise: "0",
      lodging: "0",
      poi: "0",
      roadtrip: "1-10",
      rail: "1-10",
      rental: "0",
      bus: "0",
      ferry: "0",
    });
    expect(p.tripRoute.count).toHaveBeenCalledWith({ where: { kind: "roadtrip" } });
  });

  it("reports the largest passport, and skips an account whose passport fails", async () => {
    expect((await buildUsageV2()).passport_countries_bucket).toBe("21-50");
    passport.mockImplementation(async (id: string) => {
      if (id === "u1") throw new Error("broken record");
      return { summary: { visitedCountries: 4 } };
    });
    expect((await buildUsageV2()).passport_countries_bucket).toBe("1-5");
  });

  it("counts suggestion answers and live device pairings only", async () => {
    const v2 = await buildUsageV2();
    expect(v2.trip_suggestions).toEqual({ accepted: "11-50", dismissed: "1-10" });
    expect(v2.companion_pairings_bucket).toBe("1");
    expect(p.apiToken.count).toHaveBeenCalledWith({
      where: { deviceId: { not: null }, revokedAt: null },
    });
  });

  it("holds no free text and no identifier — only bucket strings", async () => {
    const values: unknown[] = [];
    const walk = (v: unknown): void => {
      if (v && typeof v === "object") Object.values(v).forEach(walk);
      else values.push(v);
    };
    walk(await buildUsageV2());
    const BUCKET = /^(0|1|1-5|1-10|2-5|6\+|6-20|11-50|21-50|50\+|51-250|250\+)$/;
    for (const v of values) expect(typeof v === "string" && BUCKET.test(v)).toBe(true);
  });
});
