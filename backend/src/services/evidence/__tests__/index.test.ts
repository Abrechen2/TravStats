import { resolveEvidence, DEFAULT_RESOLVERS, EvidenceResolverMap } from "..";
import type { EvidenceResponse } from "../../../schemas/evidence";
import type { EvidenceScope } from "../../../shared/evidence";

const ALL_TIME: EvidenceScope = { period: { kind: "allTime" } };
const PAGE = { offset: 0, limit: 100 };

function response(
  value: number | null,
  overrides: Partial<EvidenceResponse> = {}
): EvidenceResponse {
  return {
    measure: {
      kind: "metric",
      key: "flights.total",
      aggregation: "sum",
      label: { key: "evidence.flights.total" },
      unit: "flights",
      value,
      scope: ALL_TIME,
    },
    entries: [],
    returned: 0,
    omitted: { count: 0 },
    unattributed: [],
    page: PAGE,
    ...overrides,
  };
}

describe("resolveEvidence", () => {
  it("has no wired resolver by default — the fake belongs in Task 5, not here", () => {
    expect(DEFAULT_RESOLVERS).toEqual({});
  });

  it("answers unknownKey when no resolver is registered for the kind", async () => {
    const result = await resolveEvidence("user-1", "metric", "flights.total", ALL_TIME, PAGE);
    expect(result).toEqual({ status: "unknownKey" });
  });

  it("answers unknownKey when the injected resolver returns null (the key it does not serve)", async () => {
    const resolvers: EvidenceResolverMap = { metric: async () => null };
    const result = await resolveEvidence(
      "user-1",
      "metric",
      "no.such.key",
      ALL_TIME,
      PAGE,
      resolvers
    );
    expect(result).toEqual({ status: "unknownKey" });
  });

  it("answers 0 with no entries when the user simply has none — against an injected fake", async () => {
    const resolvers: EvidenceResolverMap = {
      metric: async () => response(0),
    };
    const result = await resolveEvidence(
      "user-1",
      "metric",
      "flights.total",
      ALL_TIME,
      PAGE,
      resolvers
    );
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.response.measure.value).toBe(0);
      expect(result.response.entries).toEqual([]);
    }
  });

  it("answers null, not 0, when the measure cannot be derived — against an injected fake", async () => {
    const resolvers: EvidenceResolverMap = {
      metric: async () => response(null, { unattributed: [{ count: 1, reason: "notPerEntry" }] }),
    };
    const result = await resolveEvidence(
      "user-1",
      "metric",
      "flights.total",
      ALL_TIME,
      PAGE,
      resolvers
    );
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.response.measure.value).toBeNull();
      expect(result.response.unattributed).toEqual([{ count: 1, reason: "notPerEntry" }]);
    }
  });

  it("passes userId, key, scope and page through to the resolver untouched", async () => {
    const resolve = jest.fn(async () => response(3));
    const resolvers: EvidenceResolverMap = { ranking: resolve };
    const scope: EvidenceScope = { period: { kind: "year", year: 2026 }, domains: ["flight"] };
    const page = { offset: 10, limit: 5 };

    await resolveEvidence("user-7", "ranking", "airline:LH", scope, page, resolvers);

    expect(resolve).toHaveBeenCalledWith("user-7", "airline:LH", scope, page);
  });

  it.each(["record", "achievement"] as const)(
    "answers unservedKind for '%s' even with a resolver injected — release 2 is unconditional",
    async (kind) => {
      const resolvers: EvidenceResolverMap = { [kind]: async () => response(1) };
      const result = await resolveEvidence("user-1", kind, "anything", ALL_TIME, PAGE, resolvers);
      expect(result).toEqual({ status: "unservedKind" });
    }
  );
});
