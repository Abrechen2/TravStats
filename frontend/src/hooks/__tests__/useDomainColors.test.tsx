import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

import { useDomainColors } from "../useDomainColors";
import { useDomainColorStore } from "../../store/domainColorStore";
import { BRAND_DOMAIN_COLORS, normalizeDomainColors } from "../../lib/domainColor";
import { DOMAINS } from "../../shared/domains";

/**
 * The stored colour IS the value — there is no gate in front of it any more.
 *
 * Until 2026-09-09 this hook asked the beta gate and handed back the brand set
 * while it was closed, because the gate covered the VALUE and not only the
 * settings panel: turning the flag off had to leave nobody painted in colours
 * with no control left to change them. The owner ruled for 2.7 that overriding
 * a domain colour is an ordinary setting, so the gate is gone and the store
 * answers on its own.
 *
 * These tests carry NO `useBetaFeatures` mock, and that absence is the point:
 * the hook no longer imports it. The second case below is the one that fails
 * against the old implementation — it used to hand back the brand hex here.
 */
describe("useDomainColors", () => {
  beforeEach(() => {
    useDomainColorStore.getState().resetToBrand();
  });

  it("starts on the brand colours", () => {
    const { result } = renderHook(() => useDomainColors());
    // Read from the domain table rather than restated here: a copy of the
    // hexes in a test would go on passing after somebody changed the brand.
    expect(result.current.colorOf("flight")).toBe(DOMAINS.flight.color);
    expect(result.current.colors).toEqual(BRAND_DOMAIN_COLORS);
  });

  it("uses a stored colour, with no beta flag involved", () => {
    useDomainColorStore.getState().setColor("flight", "#00ff00");

    const { result } = renderHook(() => useDomainColors());
    expect(result.current.colorOf("flight")).toBe("#00ff00");
    // Untouched domains stay on brand — one picker moves one domain.
    expect(result.current.colorOf("cruise")).toBe(DOMAINS.cruise.color);
  });

  it("comes home from an experiment", () => {
    useDomainColorStore.getState().setColor("cruise", "#123456");
    useDomainColorStore.getState().resetToBrand();

    const { result } = renderHook(() => useDomainColors());
    expect(result.current.colors).toEqual(BRAND_DOMAIN_COLORS);
  });

  it("keeps a stored map clean on the way in", () => {
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
