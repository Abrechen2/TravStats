import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * Owner decision 2026-09-26: the loyalty centre (2.7) goes behind the beta
 * switch (`loyaltyCenter`). What 2.6 shipped must keep working with it closed:
 * the hotel memberships under Einstellungen → Unterkünfte → Bonusprogramme,
 * served by `/lodging-memberships`. Since 2.7 that section only POINTED at the
 * loyalty page — with the page gated, the pointer would lead nowhere and the
 * hotel cards would have no editor at all.
 */

const beta = vi.hoisted(() => ({ on: false }));
vi.mock("../../../hooks/useBetaFeatures", () => ({
  useBetaFeatures: () => ({
    betaFeaturesEnabled: beta.on,
    isFeatureVisible: (key: string) => key === "loyaltyCenter" && beta.on,
  }),
}));
vi.mock("../../../hooks/useToursVisible", () => ({ useToursVisible: () => false }));

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

import SettingsSectionSwitch from "../SettingsSectionSwitch";
import { gateOfSection } from "../settingsModel";

type Page = Parameters<typeof SettingsSectionSwitch>[0]["page"];
const page = { user: { username: "owner", isAdmin: false } } as unknown as Page;

async function renderSection(): Promise<void> {
  render(
    <MemoryRouter>
      <SettingsSectionSwitch section="lodgingMemberships" page={page} />
    </MemoryRouter>
  );
  await act(async () => {});
}

describe("settings — loyalty programmes and the loyaltyCenter gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the 2.6 hotel membership editor, fed by /lodging-memberships, with the gate closed", async () => {
    beta.on = false;
    await renderSection();

    expect(await screen.findByText("Marriott Bonvoy")).toBeTruthy();
    expect(lodgingApi.listMemberships).toHaveBeenCalled();
    expect(screen.queryByTestId("loyalty-link-lodging")).toBeNull();
  });

  it("points to the loyalty page instead with the gate open", async () => {
    beta.on = true;
    await renderSection();

    expect(screen.getByTestId("loyalty-link-lodging")).toHaveAttribute("href", "/loyalty#lodging");
    expect(lodgingApi.listMemberships).not.toHaveBeenCalled();
  });

  it("gates the flight and cruise programme sections, never the hotel one", () => {
    expect(gateOfSection("flightMemberships")).toBe("loyaltyCenter");
    expect(gateOfSection("cruiseMemberships")).toBe("loyaltyCenter");
    expect(gateOfSection("lodgingMemberships")).toBeUndefined();
  });
});
