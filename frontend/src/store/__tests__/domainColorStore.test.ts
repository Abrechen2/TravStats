import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { DOMAINS, RETIRED_DOMAIN_DEFAULTS, TOUR_COLOR } from "../../shared/domains";

/**
 * The user's domain colours sit ON TOP of the defaults — and must keep doing
 * so when the defaults move, as they did in round 29 (forgejo#131: rail
 * lavender, roadtrip moss).
 *
 * The store reads local storage once, at import, so each case seeds storage
 * and then imports a fresh copy of the store and hook.
 */
const V1 = "domainColors.v1";
const V2 = "domainColors.v2";

async function freshHook() {
  vi.resetModules();
  const { useDomainColors } = await import("../../hooks/useDomainColors");
  const { useDomainColorStore } = await import("../domainColorStore");
  const { result } = renderHook(() => useDomainColors());
  return { result, store: useDomainColorStore };
}

/** What a 2.7 beta browser held after moving one picker: the whole map, old defaults included. */
const OLD_DEFAULTS_V1 = {
  flight: "#00ff00",
  cruise: RETIRED_DOMAIN_DEFAULTS.cruise?.[0],
  lodging: RETIRED_DOMAIN_DEFAULTS.lodging?.[0],
  poi: RETIRED_DOMAIN_DEFAULTS.poi?.[0],
  roadtrip: RETIRED_DOMAIN_DEFAULTS.roadtrip?.[0],
  rail: RETIRED_DOMAIN_DEFAULTS.rail?.[0],
};

describe("domain colour store over the round-29 defaults", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  it("shows the new rail and roadtrip hues to a user with no stored colours", async () => {
    const { result } = await freshHook();
    expect(result.current.colorOf("rail")).toBe(DOMAINS.rail.color);
    expect(result.current.colorOf("roadtrip")).toBe(DOMAINS.roadtrip.color);
    // The roadtrip default IS the tour colour — one road hue.
    expect(result.current.colorOf("roadtrip")).toBe(TOUR_COLOR);
  });

  it("keeps a user's own rail colour on top of the new default", async () => {
    window.localStorage.setItem(V2, JSON.stringify({ rail: "#123456" }));
    const { result } = await freshHook();
    expect(result.current.colorOf("rail")).toBe("#123456");
    expect(result.current.colorOf("roadtrip")).toBe(DOMAINS.roadtrip.color);
  });

  it("does not let an old full-map save freeze the retired defaults", async () => {
    // Before v2 the store wrote every domain on every change, so a user who
    // had repainted only the flight also held brick-red rail and violet
    // roadtrip — and would never have seen the new hues.
    window.localStorage.setItem(V1, JSON.stringify(OLD_DEFAULTS_V1));
    const { result } = await freshHook();
    expect(result.current.colorOf("flight")).toBe("#00ff00");
    expect(result.current.colorOf("rail")).toBe(DOMAINS.rail.color);
    expect(result.current.colorOf("roadtrip")).toBe(DOMAINS.roadtrip.color);
    expect(result.current.colorOf("cruise")).toBe(DOMAINS.cruise.color);
    expect(result.current.colorOf("lodging")).toBe(DOMAINS.lodging.color);
    expect(result.current.colorOf("poi")).toBe(DOMAINS.poi.color);
  });

  it("keeps a real choice from the old save", async () => {
    window.localStorage.setItem(V1, JSON.stringify({ ...OLD_DEFAULTS_V1, rail: "#abcdef" }));
    const { result } = await freshHook();
    expect(result.current.colorOf("rail")).toBe("#abcdef");
  });

  it("stores only what the user moved, so the next default change reaches the rest", async () => {
    const { store } = await freshHook();
    act(() => store.getState().setColor("cruise", "#112233"));
    expect(JSON.parse(window.localStorage.getItem(V2) ?? "null")).toEqual({ cruise: "#112233" });

    act(() => store.getState().resetToBrand());
    expect(JSON.parse(window.localStorage.getItem(V2) ?? "null")).toEqual({});
  });

  it("a deliberate pick equal to a retired default survives a reload once saved as v2", async () => {
    const { store } = await freshHook();
    const oldRail = RETIRED_DOMAIN_DEFAULTS.rail?.[0] ?? "";
    act(() => store.getState().setColor("rail", oldRail));
    const { result } = await freshHook();
    expect(result.current.colorOf("rail")).toBe(oldRail);
  });
});
