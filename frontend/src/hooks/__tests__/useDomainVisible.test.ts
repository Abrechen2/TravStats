import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.unmock("../../store/settingsStore");

import { useDomainOffered, useDomainVisible } from "../useDomainVisible";
import { useEnabledDomains } from "../useEnabledDomains";
import { DOMAIN_BETA_GATES } from "../../config/domainBetaGates";
import { DOMAIN_KEYS, type DomainKey } from "../../shared/domains";
import { useSettingsStore } from "../../store/settingsStore";

/**
 * One rule for every domain behind a beta switch: the domain exists for a
 * reader only while the instance allows it (`DOMAIN_BETA_GATES`) AND the reader
 * wants it. `useEnabledDomains` applies every gate, so a surface that asks it
 * cannot forget one — rail, rental and bus used to be dropped only by hooks of
 * their own, and each surface hand-rolled which of them to ask.
 */
const GATED = Object.keys(DOMAIN_BETA_GATES) as DomainKey[];
const UNGATED = DOMAIN_KEYS.filter((k) => !GATED.includes(k));

describe("domain visibility", () => {
  beforeEach(() => {
    useSettingsStore.setState({ enabledDomains: [...DOMAIN_KEYS], betaFeaturesEnabled: true });
  });

  it("gates exactly the beta domains", () => {
    expect([...GATED].sort()).toEqual(["roadtrip"]);
  });

  // Rail left beta in 2.7.0-rc.20 (owner, 2026-10-22): like flights and cruises.
  it.each([false, null])("shows rail while the beta flag is %s", (flag) => {
    useSettingsStore.setState({ betaFeaturesEnabled: flag });
    expect(renderHook(() => useDomainVisible("rail")).result.current).toBe(true);
    expect(renderHook(() => useDomainOffered("rail")).result.current).toBe(true);
    expect(renderHook(() => useEnabledDomains()).result.current.enabled).toContain("rail");
  });

  it.each(GATED)("%s is shown when the instance allows it and the user wants it", (key) => {
    expect(renderHook(() => useDomainVisible(key)).result.current).toBe(true);
    expect(renderHook(() => useEnabledDomains()).result.current.isEnabled(key)).toBe(true);
  });

  it.each(GATED.flatMap((k) => [[k, false] as const, [k, null] as const]))(
    "%s is gone from the enabled domains while the beta flag is %s",
    (key, flag) => {
      useSettingsStore.setState({ betaFeaturesEnabled: flag });
      expect(renderHook(() => useEnabledDomains()).result.current.enabled).not.toContain(key);
      expect(renderHook(() => useDomainVisible(key)).result.current).toBe(false);
      expect(renderHook(() => useDomainOffered(key)).result.current).toBe(false);
    }
  );

  it.each(GATED)("%s is hidden when the user has the domain off", (key) => {
    useSettingsStore.setState({ enabledDomains: DOMAIN_KEYS.filter((k) => k !== key) });
    expect(renderHook(() => useDomainVisible(key)).result.current).toBe(false);
    // Offered is the instance half alone — the settings switch must stay reachable.
    expect(renderHook(() => useDomainOffered(key)).result.current).toBe(true);
  });

  it.each(UNGATED)("%s does not depend on the beta flag", (key) => {
    useSettingsStore.setState({ betaFeaturesEnabled: false });
    expect(renderHook(() => useDomainOffered(key)).result.current).toBe(true);
    expect(renderHook(() => useEnabledDomains()).result.current.isEnabled(key)).toBe(true);
  });
});
