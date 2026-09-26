import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

import type { DomainKey } from "../../../shared/domains";
import type { LoyaltyMembership } from "../../../types/loyalty";

let enabled: DomainKey[] = [];
vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ enabled, isEnabled: (key: DomainKey) => enabled.includes(key) }),
}));

const api = vi.hoisted(() => ({
  listLoyaltyMemberships: vi.fn(),
  listFrequentFlyerSuggestions: vi.fn(),
  createLoyaltyMembership: vi.fn(),
  updateLoyaltyMembership: vi.fn(),
  deleteLoyaltyMembership: vi.fn(),
}));
vi.mock("../../../lib/api/loyalty", () => api);
// The flight card form loads the alliance picker (forgejo#133), covered by its
// own suite; pending forever here so it never re-renders under these tests.
vi.mock("../../../lib/api/catalogue", () => ({
  airlinesApi: { alliances: () => new Promise(() => {}) },
}));
vi.mock("../../../lib/api/cruise", () => ({
  cruiseApi: { facets: vi.fn().mockResolvedValue({ lines: [{ value: "AIDA", count: 2 }] }) },
}));

// The hotel section is the Settings editor, tested on its own; here it only
// has to receive the page's per-card extras for the cards it lists.
vi.mock("../MembershipsSection", () => ({
  default: (props: { title?: string; renderExtra?: (m: { id: string }) => ReactNode }) => (
    <div data-testid="hotel-editor">
      {props.title}
      {props.renderExtra?.({ id: "hotel-card" })}
    </div>
  ),
}));

import LoyaltySection from "../LoyaltySection";

const card = (o: Partial<LoyaltyMembership>): LoyaltyMembership => ({
  id: "c1",
  userId: "u1",
  domain: "flight",
  programName: "Miles & More",
  membershipNumber: "992003112345",
  tier: "Senator",
  notes: null,
  airlineCodes: ["LH", "LX"],
  cruiseLines: [],
  chainIds: [],
  chains: [],
  lodgingIds: [],
  lodgings: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  activity: { count: 12, nights: null, lastActivity: "2025-01-02" },
  ...o,
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <LoyaltySection />
    </MemoryRouter>
  );

describe("Einstellungen → Bonusprogramme (LoyaltySection)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enabled = ["flight", "cruise", "lodging"];
    api.listLoyaltyMemberships.mockResolvedValue([]);
  });

  it("draws a section for each enabled domain with programmes, and none for the others", async () => {
    enabled = ["flight", "lodging", "poi"];
    renderPage();
    expect(await screen.findByTestId("loyalty-flight")).toBeInTheDocument();
    expect(screen.getByTestId("loyalty-lodging")).toBeInTheDocument();
    expect(screen.queryByTestId("loyalty-cruise")).toBeNull();
  });

  it("says so when no enabled domain has programmes", async () => {
    enabled = ["poi"];
    renderPage();
    expect(await screen.findByText("loyalty:noDomains")).toBeInTheDocument();
  });

  it("lists a card with its number masked until revealed, and its logbook activity", async () => {
    api.listLoyaltyMemberships.mockResolvedValue([card({})]);
    renderPage();
    const row = await screen.findByTestId("loyalty-card-c1");
    expect(within(row).getByText("Miles & More")).toBeInTheDocument();
    expect(within(row).queryByText("992003112345")).toBeNull();
    expect(within(row).getByText("•••• 2345")).toBeInTheDocument();
    expect(within(row).getByText("LH, LX")).toBeInTheDocument();
    expect(within(row).getByTestId("loyalty-activity")).toBeInTheDocument();

    fireEvent.click(within(row).getByRole("button", { name: "loyalty:number.show" }));
    expect(within(row).getByText("992003112345")).toBeInTheDocument();
  });

  it("keeps each domain's cards in its own section", async () => {
    api.listLoyaltyMemberships.mockResolvedValue([
      card({}),
      card({ id: "c2", domain: "cruise", programName: "AIDA Club", airlineCodes: [] }),
    ]);
    renderPage();
    const flight = await screen.findByTestId("loyalty-flight");
    const cruise = screen.getByTestId("loyalty-cruise");
    expect(within(flight).getByText("Miles & More")).toBeInTheDocument();
    expect(within(flight).queryByText("AIDA Club")).toBeNull();
    expect(within(cruise).getByText("AIDA Club")).toBeInTheDocument();
  });

  it("hands the hotel editor each card's activity", async () => {
    api.listLoyaltyMemberships.mockResolvedValue([
      card({
        id: "hotel-card",
        domain: "lodging",
        programName: "Bonvoy",
        airlineCodes: [],
        activity: { count: 3, nights: 7, lastActivity: "2025-02-12" },
      }),
    ]);
    renderPage();
    const hotel = await screen.findByTestId("hotel-editor");
    await waitFor(() => expect(within(hotel).getByTestId("loyalty-activity")).toBeInTheDocument());
  });

  it("takes a frequent-flyer number over from the flights only once the user saves", async () => {
    api.listFrequentFlyerSuggestions.mockResolvedValue([
      {
        membershipNumber: "9920031",
        suggestedProgramName: "Lufthansa",
        airlines: [
          { code: "LH", name: "Lufthansa" },
          { code: null, name: "Some Charter" },
        ],
        flightCount: 3,
        lastUsed: "2025-07-01",
      },
    ]);
    api.createLoyaltyMembership.mockResolvedValue(card({}));
    renderPage();

    fireEvent.click(await screen.findByTestId("loyalty-suggestions-open"));
    fireEvent.click(await screen.findByRole("button", { name: "loyalty:suggestions.adopt" }));
    expect(api.createLoyaltyMembership).not.toHaveBeenCalled();

    const form = screen.getByTestId("loyalty-form-flight");
    expect(within(form).getByLabelText("loyalty:field.programName")).toHaveValue("Lufthansa");
    expect(within(form).getByLabelText("loyalty:field.membershipNumber")).toHaveValue("9920031");
    fireEvent.change(within(form).getByLabelText("loyalty:field.programName"), {
      target: { value: "Miles & More" },
    });
    fireEvent.click(within(form).getByTestId("loyalty-save-flight"));

    await waitFor(() =>
      expect(api.createLoyaltyMembership).toHaveBeenCalledWith("flight", {
        programName: "Miles & More",
        membershipNumber: "9920031",
        tier: null,
        notes: null,
        // Only the airlines the catalogue could name a code for.
        airlineCodes: ["LH"],
      })
    );
    // The list reloads, and the open suggestion list with it.
    await waitFor(() => expect(api.listFrequentFlyerSuggestions).toHaveBeenCalledTimes(2));
  });
});
