import { describe, it, expect, vi } from "vitest";

vi.mock("./api/airports", () => ({ airportsApi: { getByCode: vi.fn() } }));

import { airportsApi } from "./api/airports";
import { airportResolutionMessage, resolveAirportByCode } from "./airportResolve";

const unavailable = (reason?: unknown) => ({
  response: { status: 503, data: { code: "AIRPORT_LOOKUP_UNAVAILABLE", reason } },
});

describe("resolveAirportByCode — 503 AIRPORT_LOOKUP_UNAVAILABLE", () => {
  it.each(["timeout", "network", "http_error"] as const)(
    "carries the reason %s to the message",
    async (reason) => {
      vi.mocked(airportsApi.getByCode).mockRejectedValue(unavailable(reason));
      const r = await resolveAirportByCode("zzz");
      expect(r).toEqual({ kind: "failed", code: "ZZZ", reason });
      if (r.kind === "found") throw new Error("unreachable");
      expect(airportResolutionMessage(r).key).toBe(`errors:airportLookupUnavailable.${reason}`);
    }
  );

  it("maps a reason the client does not know to 'unknown', never a raw token", async () => {
    vi.mocked(airportsApi.getByCode).mockRejectedValue(unavailable("brand_new"));
    const r = await resolveAirportByCode("ZZZ");
    expect(r).toMatchObject({ kind: "failed", reason: "unknown" });
  });

  it("keeps the generic load-failed sentence for any other error", async () => {
    vi.mocked(airportsApi.getByCode).mockRejectedValue({ response: { status: 500, data: {} } });
    const r = await resolveAirportByCode("ZZZ");
    expect(r).toEqual({ kind: "failed", code: "ZZZ" });
    if (r.kind === "found") throw new Error("unreachable");
    expect(airportResolutionMessage(r).key).toBe("errors:airportLoadFailedCode");
  });
});
