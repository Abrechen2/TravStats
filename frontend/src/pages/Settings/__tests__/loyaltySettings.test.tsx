import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * Owner decision 2026-09-26, on the tester's word: every loyalty programme is
 * managed centrally in Einstellungen → Bonusprogramme — hotel, airline and
 * cruise — with no beta switch in front of it and ONE editor per kind of card.
 * The hotel cards 2.6 users already have (served by `/lodging-memberships`)
 * must appear there, and the three per-domain sections of before are gone.
 */

vi.mock("../../../hooks/useToursVisible", () => ({ useToursVisible: () => false }));
vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({
    enabled: ["flight", "lodging"],
    isEnabled: (key: string) => key === "flight" || key === "lodging",
  }),
}));

const lodgingApi = vi.hoisted(() => ({
  listLodgings: vi.fn(async () => []),
  listChains: vi.fn(async () => []),
  listMemberships: vi.fn(async () => [
    {
      id: "m1",
      userId: "u1",
      programName: "Marriott Bonvoy",
      membershipNumber: null,
      tier: "Gold",
      chainIds: [],
      chains: [],
      lodgingIds: [],
      lodgings: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ]),
  createMembership: vi.fn(),
  updateMembership: vi.fn(),
  deleteMembership: vi.fn(),
}));
vi.mock("../../../lib/api/lodging", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/lodging")>()),
  ...lodgingApi,
}));
const loyaltyApi = vi.hoisted(() => ({
  listLoyaltyMemberships: vi.fn(async () => []),
  listFrequentFlyerSuggestions: vi.fn(async () => []),
  createLoyaltyMembership: vi.fn(),
  updateLoyaltyMembership: vi.fn(),
  deleteLoyaltyMembership: vi.fn(),
}));
vi.mock("../../../lib/api/loyalty", () => loyaltyApi);

import SettingsSectionSwitch from "../SettingsSectionSwitch";
import {
  GENERAL_GROUP_IDS,
  SETTINGS_GROUPS,
  gateOfSection,
  groupOfSection,
  movedSection,
} from "../settingsModel";

type Page = Parameters<typeof SettingsSectionSwitch>[0]["page"];
const page = { user: { username: "owner", isAdmin: false } } as unknown as Page;

async function renderSection(): Promise<void> {
  render(
    <MemoryRouter>
      <SettingsSectionSwitch section="loyalty" page={page} />
    </MemoryRouter>
  );
  await act(async () => {});
}

describe("Einstellungen → Bonusprogramme", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the 2.6 hotel cards in the hotel block, with no beta switch involved", async () => {
    await renderSection();
    const hotel = screen.getByTestId("loyalty-lodging");
    expect(await within(hotel).findByText("Marriott Bonvoy")).toBeTruthy();
    expect(lodgingApi.listMemberships).toHaveBeenCalled();
  });

  it("draws one editor per enabled domain, and one hotel editor only", async () => {
    await renderSection();
    expect(screen.getByTestId("loyalty-flight")).toBeTruthy();
    expect(screen.queryByTestId("loyalty-cruise")).toBeNull();
    expect(screen.getAllByTestId("membership-manager")).toHaveLength(1);
    // The card's name appears once: no second list of the same cards.
    expect(screen.getAllByText("Marriott Bonvoy")).toHaveLength(1);
  });

  it("is one general section, never gated, and the old per-domain ids lead to it", () => {
    expect(groupOfSection("loyalty")?.id).toBe("loyalty");
    expect(GENERAL_GROUP_IDS).toContain("loyalty");
    expect(gateOfSection("loyalty")).toBeUndefined();
    for (const old of ["lodgingMemberships", "flightMemberships", "cruiseMemberships"]) {
      expect(movedSection(old)).toBe("loyalty");
      expect(groupOfSection(old)).toBeUndefined();
    }
    const everySection = SETTINGS_GROUPS.flatMap((g) => g.sections as readonly string[]);
    expect(everySection.filter((s) => /Memberships$/.test(s))).toEqual([]);
  });
});
