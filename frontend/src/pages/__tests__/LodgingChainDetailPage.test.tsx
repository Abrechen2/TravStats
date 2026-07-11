import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { LodgingChainDetail } from "../../types/lodging";

const getChainDetailMock = vi.fn();
const listMembershipsMock = vi.fn();

vi.mock("../../lib/api/lodging", () => ({
  getChainDetail: (...args: unknown[]) => getChainDetailMock(...args),
  listMemberships: () => listMembershipsMock(),
  createMembership: vi.fn(),
  updateMembership: vi.fn(),
  deleteMembership: vi.fn(),
}));

vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-stub" />,
}));

import LodgingChainDetailPage from "../LodgingChainDetailPage";

function makeDetail(overrides: Partial<LodgingChainDetail> = {}): LodgingChainDetail {
  return {
    chain: {
      id: 1,
      name: "Sheraton",
      brandColor: "#123456",
      loyaltyProgram: "Marriott Bonvoy",
      isUserAdded: false,
      createdAt: "2024-01-01T00:00:00.000Z",
    },
    lodgings: [],
    stats: { hotelCount: 0, stayCount: 0, nights: 0, totalSpendBase: 0, avgRating: null },
    membership: null,
    siblingChains: [],
    ...overrides,
  };
}

async function renderChainDetail(detail: LodgingChainDetail): Promise<void> {
  getChainDetailMock.mockResolvedValue(detail);
  listMembershipsMock.mockResolvedValue(detail.membership ? [detail.membership] : []);
  render(
    <MemoryRouter initialEntries={[`/lodging/chains/${detail.chain.id}`]}>
      <Routes>
        <Route path="/lodging/chains/:id" element={<LodgingChainDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(getChainDetailMock).toHaveBeenCalledWith(detail.chain.id));
  await screen.findByText(detail.chain.name);
}

describe("LodgingChainDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the chain name, loyalty program, and the caller's hotels in it", async () => {
    const detail = makeDetail({
      lodgings: [
        {
          id: "l1",
          userId: "u1",
          type: "hotel",
          name: "Sheraton Zürich",
          chainId: 1,
          chain: null,
          address: null,
          city: "Zürich",
          country: "CH",
          lat: null,
          lon: null,
          stars: 4,
          amenities: [],
          notes: null,
          dataSource: null,
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
          stays: [],
          overallRating: 4.5,
          stayCount: 2,
          nights: 4,
          totalSpendBase: 500,
          totalSpendBaseByCurrency: { EUR: 500 },
        },
      ],
      stats: { hotelCount: 1, stayCount: 2, nights: 4, totalSpendBase: 500, avgRating: 4.5 },
    });
    await renderChainDetail(detail);

    expect(screen.getByTestId("chain-loyalty-program")).toHaveTextContent("Marriott Bonvoy");
    expect(screen.getByText("Sheraton Zürich")).toBeInTheDocument();
  });

  it("shows an empty state when the caller has no hotels in this chain", async () => {
    await renderChainDetail(makeDetail());
    expect(screen.getByText("lodging:chainDetail.hotelsEmpty")).toBeInTheDocument();
  });

  it("scopes the membership block to the chain's program and mentions sibling chains", async () => {
    const detail = makeDetail({
      membership: {
        id: "m1",
        userId: "u1",
        programName: "Marriott Bonvoy",
        membershipNumber: "12345",
        tier: "Gold",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      },
      siblingChains: [
        {
          id: 2,
          name: "Westin",
          brandColor: null,
          loyaltyProgram: "Marriott Bonvoy",
          isUserAdded: false,
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      ],
    });
    await renderChainDetail(detail);

    // The membership shown is the shared PROGRAM, not a chain-specific one.
    expect(await screen.findByText("Gold")).toBeInTheDocument();
    expect(screen.getByText("#12345")).toBeInTheDocument();
    // The global test i18n mock doesn't interpolate `t()` args, so the
    // "shared with {{chains}}" note renders as its raw key here — its
    // PRESENCE (vs. absent when there are no siblings, tested below) is
    // what proves `sharedWithLabel` was actually computed and passed down.
    expect(screen.getByText("lodging:chainDetail.sharedWith")).toBeInTheDocument();
  });

  it("does not show a shared-with note when the program has no sibling chains", async () => {
    const detail = makeDetail({
      membership: {
        id: "m1",
        userId: "u1",
        programName: "Marriott Bonvoy",
        membershipNumber: null,
        tier: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      },
      siblingChains: [],
    });
    await renderChainDetail(detail);

    await screen.findByTestId("membership-manager");
    expect(screen.queryByText("lodging:chainDetail.sharedWith")).not.toBeInTheDocument();
  });

  it("offers to add a membership, scoped to the program, when the caller has none", async () => {
    await renderChainDetail(makeDetail());
    expect(await screen.findByText("lodging:membership.add")).toBeInTheDocument();
  });

  it("shows no membership block for a chain with no loyalty program", async () => {
    const detail = makeDetail({
      chain: { ...makeDetail().chain, loyaltyProgram: null },
    });
    await renderChainDetail(detail);
    expect(screen.getByTestId("chain-loyalty-program")).toHaveTextContent(
      "lodging:chainDetail.noLoyaltyProgram",
    );
    expect(screen.queryByTestId("membership-manager")).not.toBeInTheDocument();
  });

  it("shows a not-found message for a chain id the API rejects", async () => {
    getChainDetailMock.mockRejectedValue(new Error("404"));
    render(
      <MemoryRouter initialEntries={["/lodging/chains/999"]}>
        <Routes>
          <Route path="/lodging/chains/:id" element={<LodgingChainDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText("lodging:chainDetail.notFound")).toBeInTheDocument();
  });
});
