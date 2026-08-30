import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import { useDomainColors } from "../useDomainColors";
import { useDomainColorStore } from "../../store/domainColorStore";
import { BRAND_DOMAIN_COLORS, normalizeDomainColors } from "../../lib/domainColor";
import { DOMAINS } from "../../shared/domains";

const betaEnabled = { value: false };
vi.mock("../useBetaFeatures", () => ({
  useBetaFeatures: () => ({
    isFeatureVisible: () => betaEnabled.value,
    betaFeaturesEnabled: betaEnabled.value,
  }),
}));

/**
 * The gate covers the VALUE, not only the settings panel.
 *
 * An instance that turns the beta flag back off must not keep rendering
 * colours somebody chose on a beta build — there would be no control left to
 * change them with, and the app would look broken for reasons nobody could
 * find. So with the gate closed everyone sees BRAND.md §3, whatever is sitting
 * in local storage.
 */
describe("useDomainColors", () => {
  beforeEach(() => {
    betaEnabled.value = false;
    useDomainColorStore.getState().resetToBrand();
  });

  it("starts on the brand colours", () => {
    const { result } = renderHook(() => useDomainColors());
    // Read from the domain table rather than restated here: a copy of the
    // hexes in a test would go on passing after somebody changed the brand.
    expect(result.current.colorOf("flight")).toBe(DOMAINS.flight.color);
    expect(result.current.colors).toEqual(BRAND_DOMAIN_COLORS);
  });

  it("ignores a stored colour while the gate is closed", () => {
    useDomainColorStore.getState().setColor("flight", "#00ff00");

    const { result } = renderHook(() => useDomainColors());
    expect(result.current.colorOf("flight")).toBe(DOMAINS.flight.color);
    expect(result.current.customisable).toBe(false);
  });

  it("uses the stored colour once the gate is open", () => {
    betaEnabled.value = true;
    useDomainColorStore.getState().setColor("flight", "#00ff00");

    const { result } = renderHook(() => useDomainColors());
    expect(result.current.colorOf("flight")).toBe("#00ff00");
    expect(result.current.customisable).toBe(true);
    // Untouched domains stay on brand — one picker moves one domain.
    expect(result.current.colorOf("cruise")).toBe(DOMAINS.cruise.color);
  });

  it("comes home from an experiment", () => {
    betaEnabled.value = true;
    useDomainColorStore.getState().setColor("cruise", "#123456");
    useDomainColorStore.getState().resetToBrand();

    const { result } = renderHook(() => useDomainColors());
    expect(result.current.colors).toEqual(BRAND_DOMAIN_COLORS);
  });

  it("keeps a stored map clean on the way in", () => {
    betaEnabled.value = true;
    // Local storage is editable by hand and survives version changes, so the
    // store normalises what it reads. A domain with no usable colour would
    // render invisible marks; a bad entry is not a reason to show a blank
    // chart, so it falls back to that domain's brand hex rather than through.
    expect(normalizeDomainColors({ flight: "rot", cruise: "#112233" })).toEqual({
      ...BRAND_DOMAIN_COLORS,
      cruise: "#112233",
    });
    expect(normalizeDomainColors(null)).toEqual(BRAND_DOMAIN_COLORS);
  });
});
