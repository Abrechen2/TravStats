import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { findAdminPage, ADMIN_SECTION_LABEL_KEY } from "../adminSections";
import { ADMIN_SECTION_FRAME } from "../AdminSectionSwitch";
import { sectionsOf } from "../../Settings/surface";

const beta = vi.hoisted(() => ({ open: new Set<string>() }));
vi.mock("../../../hooks/useBetaFeatures", () => ({
  useBetaFeatures: () => ({ isFeatureVisible: (key: string) => beta.open.has(key) }),
}));
vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ isEnabled: () => true }),
}));
vi.mock("../../Settings/useSectionConditions", () => ({
  useSectionConditions: () => ({ travTrackHeld: false }),
}));

import { useSearchScopes } from "../../Settings/useSearchScopes";

/**
 * Admin → Instanz → TravPlan (owner, 2026-10-26): "erst sichtbar mit aktiven
 * Beta Schalter" — the section exists only while the `travPlan` beta key is
 * open, on the page and in the settings search alike.
 */
const instance = findAdminPage("instance")!;
const shown = (open: string[]) =>
  sectionsOf(instance, {
    level: "standard",
    isGateOpen: (key) => open.includes(key),
    isAdmin: true,
    deepLinked: null,
  }).shown;

const adminSectionIds = () =>
  renderHook(() => useSearchScopes(true))
    .result.current.filter((scope) => scope.path === "/admin/instance")
    .flatMap((scope) => scope.sections.map((s) => s.id));

describe("the TravPlan admin section", () => {
  beforeEach(() => beta.open.clear());

  it("sits next to TravTrack on the instance page, framed by itself", () => {
    const ids = instance.sections.map((s) => s.id);
    expect(ids.indexOf("travPlan")).toBe(ids.indexOf("travTrack") + 1);
    expect(ADMIN_SECTION_LABEL_KEY.travPlan).toBe("admin:travPlan.title");
    expect(ADMIN_SECTION_FRAME.travPlan).toBe("own");
  });

  it("is hidden while the travPlan beta key is closed, and shown once it is open", () => {
    expect(shown([])).not.toContain("travPlan");
    expect(shown(["travTrack"])).not.toContain("travPlan");
    expect(shown(["travPlan"])).toContain("travPlan");
  });

  it("is found by the admin search only while the beta key is open", () => {
    expect(adminSectionIds()).not.toContain("travPlan");
    beta.open.add("travPlan");
    expect(adminSectionIds()).toContain("travPlan");
  });
});
