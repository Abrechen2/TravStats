import { afterEach, describe, expect, it } from "@jest/globals";

import {
  PROVIDER_DOWN_TTL_MS,
  PROVIDER_ERROR_STREAK,
  downProviders,
  providerDown,
  recordProviderOutcome,
  resetProviderHealth,
} from "../providerHealth";
import { orsFailureReason } from "../openRouteService";

afterEach(() => resetProviderHealth());

describe("routing provider health (#411)", () => {
  it("a 410 from ORS is a refused key, not a provider_error a single leg could explain", () => {
    expect(orsFailureReason(410, null)).toBe("auth");
  });

  it("marks a provider down on a refused key and clears it on the next routed answer", () => {
    recordProviderOutcome("openrouteservice", "auth");
    expect(providerDown("openrouteservice")).toMatchObject({ reason: "auth" });
    recordProviderOutcome("openrouteservice", null);
    expect(providerDown("openrouteservice")).toBeNull();
  });

  it("single misses never mark a provider down; a run of provider errors does", () => {
    for (let i = 0; i < 10; i += 1) recordProviderOutcome("graphhopper", "no_route");
    expect(providerDown("graphhopper")).toBeNull();
    for (let i = 0; i < PROVIDER_ERROR_STREAK - 1; i += 1)
      recordProviderOutcome("graphhopper", "provider_error");
    expect(providerDown("graphhopper")).toBeNull();
    recordProviderOutcome("graphhopper", "provider_error");
    expect(downProviders().map((d) => d.providerId)).toEqual(["graphhopper"]);
  });

  it("forgets an outage after the TTL so a recovered provider is asked again", () => {
    const at = new Date("2026-11-26T10:00:00Z");
    recordProviderOutcome("openrouteservice", "auth", at);
    const later = new Date(at.getTime() + PROVIDER_DOWN_TTL_MS + 1);
    expect(providerDown("openrouteservice", later)).toBeNull();
  });

  it("a user's own refused key does not mark the instance's provider down; an instance 410 does", () => {
    recordProviderOutcome("openrouteservice", "auth", undefined, "user:someone");
    expect(providerDown("openrouteservice")).toBeNull();
    expect(downProviders()).toEqual([]);
    expect(providerDown("openrouteservice", undefined, "user:someone")).not.toBeNull();

    recordProviderOutcome("openrouteservice", orsFailureReason(410, null));
    expect(downProviders().map((d) => d.providerId)).toEqual(["openrouteservice"]);
  });
});
