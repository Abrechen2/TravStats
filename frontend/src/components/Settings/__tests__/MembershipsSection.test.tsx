import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MembershipsSection from "../MembershipsSection";
import { listMemberships, listLodgings, listChains, updateMembership } from "../../../lib/api/lodging";
import type { Lodging, LodgingMembership } from "../../../types/lodging";

vi.mock("../../../lib/api/lodging", () => ({
  listMemberships: vi.fn(),
  listLodgings: vi.fn(),
  listChains: vi.fn(),
  createMembership: vi.fn(),
  updateMembership: vi.fn(),
  deleteMembership: vi.fn(),
}));

const card: LodgingMembership = {
  id: "m-1",
  userId: "u-1",
  programName: "Minor DISCOVERY",
  membershipNumber: "1234",
  tier: "Gold",
  chainIds: [1, 2],
  chains: [
    { id: 1, name: "NH Hotels" },
    { id: 2, name: "nhow" },
  ],
  lodgingIds: [],
  lodgings: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

// Minimal but complete `Lodging` fixture — copied field-for-field from
// `types/lodging.ts` so it typechecks without `any`.
const lodgingRow: Lodging = {
  id: "l-0",
  userId: "u-1",
  type: "hotel",
  name: "Fixture Hotel",
  chainId: null,
  chain: null,
  address: null,
  city: null,
  country: null,
  lat: null,
  lon: null,
  stars: null,
  amenities: [],
  notes: null,
  dataSource: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  stays: [],
  overallRating: null,
  stayCount: 0,
  nights: 0,
  totalSpendBase: 0,
  totalSpendBaseByCurrency: {},
};

describe("MembershipsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listLodgings).mockResolvedValue([]);
    vi.mocked(listChains).mockResolvedValue([]);
  });

  it("lists every card with its coverage", async () => {
    vi.mocked(listMemberships).mockResolvedValue([card]);
    render(<MembershipsSection />);
    expect(await screen.findByText("Minor DISCOVERY")).toBeInTheDocument();
    expect(screen.getByText(/NH Hotels/)).toBeInTheDocument();
    expect(screen.getByText(/nhow/)).toBeInTheDocument();
  });

  it("shows a card that covers NO chain — the case that used to vanish", async () => {
    // Unticking the last chain hid the membership entirely; this list is
    // unconditional, so it is always reachable.
    vi.mocked(listMemberships).mockResolvedValue([
      { ...card, id: "m-2", programName: "Orphan Card", chainIds: [], chains: [] },
    ]);
    render(<MembershipsSection />);
    expect(await screen.findByText("Orphan Card")).toBeInTheDocument();
  });

  it("offers only chain-less hotels when adding hotel coverage", async () => {
    // Alex: a direct hotel link is for independent hotels. A hotel that has a
    // chain is covered through the chain instead, and a link on it would be
    // dormant — so it is not offered here.
    vi.mocked(listMemberships).mockResolvedValue([card]);
    vi.mocked(listLodgings).mockResolvedValue([
      { ...lodgingRow, id: "l-indie", name: "Hotel Sonnenhof", chainId: null },
      { ...lodgingRow, id: "l-chained", name: "NH Berlin", chainId: 1 },
    ]);

    render(<MembershipsSection />);
    await userEvent.click(await screen.findByTestId("membership-hotels-m-1"));

    const picker = screen.getByTestId("membership-hotel-picker-m-1");
    expect(within(picker).getByText("Hotel Sonnenhof")).toBeInTheDocument();
    expect(within(picker).queryByText("NH Berlin")).not.toBeInTheDocument();
  });

  it("offers chains to tick when unscoped, even for a card that covers none yet", async () => {
    // Unscoped (Settings), the checkbox list used to be
    // suggestedChains(scopeChain) ∪ the card's existing chains — with no
    // scopeChain that is EMPTY for a chain-less card, so creating one here
    // saved chainIds: [] (the exact chain-less card this feature removes)
    // and editing offered nothing to tick, only to untick.
    vi.mocked(listMemberships).mockResolvedValue([
      { ...card, id: "m-3", programName: "Blank Card", chainIds: [], chains: [] },
    ]);
    vi.mocked(listChains).mockResolvedValue([
      {
        id: 5,
        name: "Hilton",
        brandColor: null,
        loyaltyProgram: null,
        isUserAdded: false,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);

    render(<MembershipsSection />);
    await screen.findByText("Blank Card");
    await userEvent.click(screen.getByText("common:buttons.edit"));

    const chainChoices = await screen.findByTestId("membership-chain-choices");
    expect(within(chainChoices).getByText("Hilton")).toBeInTheDocument();
  });

  it("saves a hotel link through lodgingIds", async () => {
    vi.mocked(listMemberships).mockResolvedValue([card]);
    vi.mocked(listLodgings).mockResolvedValue([
      { ...lodgingRow, id: "l-indie", name: "Hotel Sonnenhof", chainId: null },
    ]);
    vi.mocked(updateMembership).mockResolvedValue({ ...card, lodgingIds: ["l-indie"] });

    render(<MembershipsSection />);
    await userEvent.click(await screen.findByTestId("membership-hotels-m-1"));
    await userEvent.click(screen.getByLabelText("Hotel Sonnenhof"));

    await waitFor(() => expect(updateMembership).toHaveBeenCalled());
    expect(vi.mocked(updateMembership).mock.calls[0][0]).toBe("m-1");
    expect(vi.mocked(updateMembership).mock.calls[0][1].lodgingIds).toEqual(["l-indie"]);
  });

  it("chains two quick toggles for the same card instead of the second overwriting the first", async () => {
    // Both clicks fire before the FIRST PATCH has resolved — the stale-closure
    // bug computed both next-lists from the same render-time snapshot ([]), so
    // the second write would have silently dropped the first hotel.
    vi.mocked(listMemberships).mockResolvedValue([
      { ...card, id: "m-4", programName: "Chain Card", chainIds: [], chains: [], lodgingIds: [] },
    ]);
    vi.mocked(listLodgings).mockResolvedValue([
      { ...lodgingRow, id: "l-a", name: "Hotel A", chainId: null },
      { ...lodgingRow, id: "l-b", name: "Hotel B", chainId: null },
    ]);

    let resolveFirst: ((value: LodgingMembership) => void) | undefined;
    const firstResponse = new Promise<LodgingMembership>((resolve) => {
      resolveFirst = resolve;
    });
    vi.mocked(updateMembership)
      .mockImplementationOnce(() => firstResponse)
      .mockImplementationOnce((_id, input) =>
        Promise.resolve({ ...card, id: "m-4", lodgingIds: input.lodgingIds ?? [] })
      );

    render(<MembershipsSection />);
    await userEvent.click(await screen.findByTestId("membership-hotels-m-4"));
    const picker = screen.getByTestId("membership-hotel-picker-m-4");

    await userEvent.click(within(picker).getByLabelText("Hotel A"));
    await userEvent.click(within(picker).getByLabelText("Hotel B"));

    // Only now let the first PATCH resolve — well after the second toggle
    // was already queued behind it.
    resolveFirst?.({ ...card, id: "m-4", lodgingIds: ["l-a"] });

    await waitFor(() => expect(updateMembership).toHaveBeenCalledTimes(2));
    expect(vi.mocked(updateMembership).mock.calls[0][1].lodgingIds).toEqual(["l-a"]);
    // The second write builds on the FIRST update's resolved list, not the
    // stale [] the render closure captured — both hotels end up saved.
    expect(vi.mocked(updateMembership).mock.calls[1][1].lodgingIds).toEqual(["l-a", "l-b"]);
  });
});
