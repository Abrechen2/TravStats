import { beforeEach, describe, expect, it, vi } from "vitest";

const bulk = vi.hoisted(() => vi.fn());
vi.mock("../lib/api/flightLookup", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/api/flightLookup")>("../lib/api/flightLookup");
  return { ...actual, flightLookupApi: { bulk } };
});

import { lookupFlightsBatched, type LookupRow } from "../lib/flightLookupBatch";

const rows = (n: number): LookupRow[] =>
  Array.from({ length: n }, (_, i) => ({
    key: `r${i}`,
    flightNumber: `LH${i}`,
    date: "2024-05-01",
  }));
const axiosError = (status?: number, data: unknown = {}): Error =>
  Object.assign(new Error("x"), {
    isAxiosError: true,
    ...(status ? { response: { status, data } } : {}),
  });
const answerAll = async (items: unknown[]) =>
  items.map((_, index) => ({ index, flightNumber: "x", success: true, flights: [{ a: 1 }] }));

beforeEach(() => vi.clearAllMocks());

describe("lookupFlightsBatched (forgejo#407)", () => {
  it("asks ten to a call, one call at a time, and keys every outcome to its row", async () => {
    bulk.mockImplementation(answerAll);
    const out = await lookupFlightsBatched(rows(23));
    expect(bulk.mock.calls.map((c) => (c[0] as unknown[]).length)).toEqual([10, 10, 3]);
    expect(out.size).toBe(23);
    expect(out.get("r22")).toMatchObject({ status: "found" });
  });

  it("does not ask a row without a number or a day, and says which", async () => {
    bulk.mockResolvedValue([{ index: 0, flightNumber: "LH1", success: true, flights: [] }]);
    const out = await lookupFlightsBatched([
      { key: "a", flightNumber: " ", date: "2024-05-01" },
      { key: "b", flightNumber: "LH2", date: null },
      { key: "c", flightNumber: "LH1", date: "2024-05-01" },
    ]);
    expect(out.get("a")).toMatchObject({ status: "failed", reason: "noFlightNumber" });
    expect(out.get("b")).toMatchObject({ status: "failed", reason: "noDate" });
    expect(out.get("c")).toMatchObject({ status: "empty" });
    expect(bulk).toHaveBeenCalledTimes(1);
  });

  it("reports a provider outage as providers, never as an empty answer", async () => {
    bulk.mockResolvedValue([
      {
        index: 0,
        flightNumber: "LH0",
        success: false,
        error: "LOOKUP_PROVIDER_FAILED",
        providerFailures: [{ provider: "airlabs", outcome: "quota" }],
      },
      { index: 1, flightNumber: "LH1", success: false, error: "INVALID_DATE" },
    ]);
    const out = await lookupFlightsBatched(rows(2));
    expect(out.get("r0")).toMatchObject({
      status: "failed",
      reason: "providers",
      providerFailures: [{ provider: "airlabs", outcome: "quota" }],
    });
    expect(out.get("r1")).toMatchObject({ status: "failed", reason: "invalidDate" });
  });

  it("marks only the refused batch and carries on with the next one", async () => {
    bulk.mockRejectedValueOnce(axiosError(429)).mockImplementationOnce(answerAll);
    const out = await lookupFlightsBatched(rows(12));
    expect(out.get("r0")).toMatchObject({ status: "failed", reason: "rateLimited" });
    expect(out.get("r9")).toMatchObject({ status: "failed", reason: "rateLimited" });
    expect(out.get("r10")).toMatchObject({ status: "found" });
  });

  it.each([
    [undefined, "network"],
    [403, "server"],
    [500, "server"],
  ])("names a failed call by what it was (HTTP %s)", async (status, reason) => {
    bulk.mockRejectedValue(axiosError(status));
    const out = await lookupFlightsBatched(rows(1));
    expect(out.get("r0")).toMatchObject({ reason });
  });

  it("names the demo account's refusal", async () => {
    bulk.mockRejectedValue(axiosError(403, { error: "DEMO_ACCOUNT_FORBIDDEN" }));
    const out = await lookupFlightsBatched(rows(1));
    expect(out.get("r0")).toMatchObject({ reason: "demo" });
  });
});
