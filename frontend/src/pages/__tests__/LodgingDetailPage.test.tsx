import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Lodging, LodgingMembership, LodgingStay } from "../../types/lodging";

const getLodgingMock = vi.fn();
const deleteLodgingMock = vi.fn();
const listMembershipsMock = vi.fn();
const tripsGetAllMock = vi.fn();

vi.mock("../../lib/api/lodging", () => ({
  getLodging: (...args: unknown[]) => getLodgingMock(...args),
  deleteLodging: (...args: unknown[]) => deleteLodgingMock(...args),
  listMemberships: () => listMembershipsMock(),
}));

vi.mock("../../lib/api", () => ({
  tripsApi: { getAll: () => tripsGetAllMock() },
}));

vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-stub" />,
}));

vi.mock("../../components/lodging/LodgingMiniMap", () => ({
  LodgingMiniMap: () => <div data-testid="map-stub" />,
}));

// Use the real settingsStore for the baseCurrency-labeling test below, so we
// can `setState` a divergent `units.currency` vs `baseCurrency` and observe
// which one the page actually renders with.
vi.unmock("../../store/settingsStore");

// Imported after the mocks above so the module graph picks them up.
import LodgingDetailPage from "../LodgingDetailPage";
import { useSettingsStore } from "../../store/settingsStore";

const baseStay: LodgingStay = {
  id: "stay-1",
  lodgingId: "lodging-1",
  userId: "user-1",
  tripId: null,
  bookingId: null,
    checkInTime: null,
    checkOutTime: null,
  checkIn: "2024-05-12T15:00:00.000Z",
  checkOut: "2024-05-14T11:00:00.000Z",
  datePrecision: "DAY" as const,
  nights: null,
  status: "completed",
  roomNumber: "21",
  roomCategory: "Gartenzimmer",
  board: "breakfast",
  pricePerNight: 210,
  currency: "CHF",
  totalPrice: 840,
  totalPriceBase: 883,
  fxRate: 0.9895,
  fxRateDate: "2024-05-12T00:00:00.000Z",
  fxBaseCurrency: "EUR",
  fxSource: null,
  isAwardStay: false,
  ratingRoom: 4,
  ratingBreakfast: 4,
  ratingService: 4,
  ratingOverall: 4,
  roomAmenities: [],
  bookingReference: "ENG-55021",
  membershipId: null,
  membershipOptOut: false,
  receiptUrl: null,
  guests: null,
  companions: [],
  notes: null,
  parserTemplate: null,
  parserConfidence: null,
  dataSource: null,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

function makeLodging(overrides: Partial<Lodging> = {}, stays: LodgingStay[] = [baseStay]): Lodging {
  return {
    id: "lodging-1",
    userId: "user-1",
    type: "hotel",
    name: "Engimatt City & Garden",
    chainId: null,
    chain: null,
    address: "Engimattstr. 14",
    city: "Zürich",
    country: "CH",
    isoCountryCode: null,
    lat: 47.36,
    lon: 8.53,
    stars: 4,
    amenities: ["Garden", "Parking"],
    visited: true,
    notes: null,
    dataSource: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    stays,
    overallRating: 4,
    stayCount: stays.length,
    nights: 2,
    totalSpendBase: 883,
    totalSpendBaseByCurrency: { EUR: 883 },
    ...overrides,
  };
}

function renderDetailPage(id = "lodging-1"): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[`/lodging/${id}`]}>
      <Routes>
        <Route path="/lodging/:id" element={<LodgingDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("LodgingDetailPage", () => {
  beforeEach(() => {
    getLodgingMock.mockReset();
    deleteLodgingMock.mockReset();
    listMembershipsMock.mockReset();
    tripsGetAllMock.mockReset();
    listMembershipsMock.mockResolvedValue([]);
    tripsGetAllMock.mockResolvedValue([]);
    useSettingsStore.setState({
      baseCurrency: "EUR",
      units: { distanceUnit: "kilometers" },
    });
  });

  it("renders the FX readout line when a stay has fxRate + totalPriceBase", async () => {
    getLodgingMock.mockResolvedValue(makeLodging());

    renderDetailPage();

    await waitFor(() => {
      expect(screen.getByText("Engimatt City & Garden")).toBeInTheDocument();
    });

    // Mirrors "840 CHF → 883 € · EZB 0,9895 · 12.05.24" from the mockup — the
    // exact separators are locale-dependent (this test suite's global
    // react-i18next mock pins `i18n.language` to "en", see
    // `src/__tests__/setup.ts`; the German-formatted case is covered
    // precisely by `lib/__tests__/lodgingFormat.test.ts`, which calls the
    // pure formatter directly with language="de"). What's load-bearing here
    // is the wiring: arrow + rate + date all present, nothing broken.
    const readout = await screen.findByTestId("stay-fx-readout-stay-1");
    expect(readout.textContent).toContain("→");
    expect(readout.textContent).toContain("0.9895");
    expect(readout.textContent).not.toMatch(/null|NaN|undefined/);
  });

  it("renders the original price alone — no null/NaN/dangling arrow — when the FX snapshot is null", async () => {
    const unconverted: LodgingStay = {
      ...baseStay,
      id: "stay-2",
      totalPriceBase: null,
      fxRate: null,
      fxRateDate: null,
      fxBaseCurrency: null,
      fxSource: null,
    };
    getLodgingMock.mockResolvedValue(makeLodging({}, [unconverted]));

    renderDetailPage();

    await waitFor(() => {
      expect(screen.getByText("Engimatt City & Garden")).toBeInTheDocument();
    });

    const priceEl = await screen.findByTestId("stay-price-stay-2");
    expect(priceEl.textContent).not.toMatch(/null|NaN|undefined/);
    expect(priceEl.textContent).not.toContain("→");
    // No FX readout node at all for this stay — the "no conversion available"
    // state renders the plain price, not a broken/partial conversion line.
    expect(screen.queryByTestId("stay-fx-readout-stay-2")).not.toBeInTheDocument();
  });

  it("shows a delete confirmation naming the stay count and does NOT call deleteLodging until confirmed", async () => {
    const secondStay: LodgingStay = { ...baseStay, id: "stay-2" };
    getLodgingMock.mockResolvedValue(makeLodging({}, [baseStay, secondStay]));
    const user = userEvent.setup();

    renderDetailPage();

    await waitFor(() => {
      expect(screen.getByText("Engimatt City & Garden")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("lodging-delete-button"));

    const dialog = await screen.findByRole("dialog");
    // The dialog is the shared ConfirmModal now — the same one the LIST uses,
    // which is the whole point: deleting a house looked different depending on
    // where you did it. This file's i18n stub returns the bare key, so the
    // assertion is WHICH key was chosen: `deleteConfirmMessage` is the
    // count-carrying form, `…NoStays` the one for a house with no stays. The
    // choice itself is unit-tested in lib/__tests__/deleteConfirm.test.ts.
    const message = within(dialog).getByText("lodging:detail.deleteConfirmMessage");
    expect(message).toBeInTheDocument();
    expect(deleteLodgingMock).not.toHaveBeenCalled();

    // Cancelling must not delete either.
    await user.click(within(dialog).getByRole("button", { name: "common:buttons.cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(deleteLodgingMock).not.toHaveBeenCalled();

    // Only the explicit confirm click calls deleteLodging.
    await user.click(screen.getByTestId("lodging-delete-button"));
    const dialog2 = await screen.findByRole("dialog");
    await user.click(within(dialog2).getByRole("button", { name: "common:buttons.delete" }));

    await waitFor(() => {
      expect(deleteLodgingMock).toHaveBeenCalledTimes(1);
      expect(deleteLodgingMock).toHaveBeenCalledWith("lodging-1");
    });
  });

  it("labels totalSpendBase with the real baseCurrency, not a differing units.currency", async () => {
    // totalSpendBase is a base-currency figure (CHF here) computed by the
    // backend. Units→Currency is a separate, independently-set display
    // preference (USD here) used elsewhere for flight costs — it must not
    // leak into this label.
    useSettingsStore.setState({
      baseCurrency: "CHF",
      units: { distanceUnit: "kilometers" },
    });
    getLodgingMock.mockResolvedValue(makeLodging({ totalSpendBase: 883 }));

    renderDetailPage();

    await waitFor(() => {
      expect(screen.getByText("Engimatt City & Garden")).toBeInTheDocument();
    });

    // The global react-i18next mock (src/__tests__/setup.ts) returns the raw
    // key as `t`'s output, so the label renders as this literal string.
    const spendLabel = screen.getByText("lodging:detail.spendBase");
    const spendRow = spendLabel.closest("div");
    expect(spendRow?.textContent).toMatch(/CHF/);
    expect(spendRow?.textContent).not.toMatch(/\$883/);
  });

  it("shows a not-found state when the lodging can't be loaded", async () => {
    getLodgingMock.mockRejectedValue(new Error("404"));

    renderDetailPage();

    await waitFor(() => {
      expect(getLodgingMock).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("lodging-delete-button")).not.toBeInTheDocument();
  });

  it("shows the trip pill and the loyalty program when a stay is linked to both", async () => {
    tripsGetAllMock.mockResolvedValue([
      { id: "trip-1", name: "Zürich City" },
    ]);
    listMembershipsMock.mockResolvedValue([
      { id: "mem-1", programName: "NH Rewards" },
    ]);
    const linkedStay: LodgingStay = { ...baseStay, tripId: "trip-1", membershipId: "mem-1" };
    getLodgingMock.mockResolvedValue(makeLodging({}, [linkedStay]));

    renderDetailPage();

    const tripPill = await screen.findByTestId("stay-trip-pill-stay-1");
    expect(tripPill.textContent).toContain("Zürich City");
    const membershipChip = screen.getByTestId("stay-membership-chip-stay-1");
    expect(membershipChip.textContent).toContain("NH Rewards");
  });

  it("shows the loyalty chip derived from the hotel's chain even when the stay has no stored membershipId", async () => {
    // The migration nulls membershipId for exactly this case (a stay whose
    // stored card matched what derivation now produces) — so the card must
    // come from `deriveStayMembership`, not from `stay.membershipId` raw.
    const chainMembership: LodgingMembership = {
      id: "mem-nh",
      userId: "user-1",
      programName: "NH Rewards",
      membershipNumber: null,
      tier: null,
      chainIds: [42],
      chains: [{ id: 42, name: "NH Hotels" }],
      lodgingIds: [],
      lodgings: [],
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    listMembershipsMock.mockResolvedValue([chainMembership]);
    const derivedStay: LodgingStay = { ...baseStay, membershipId: null, membershipOptOut: false };
    getLodgingMock.mockResolvedValue(
      makeLodging(
        {
          chainId: 42,
          chain: {
            id: 42,
            name: "NH Hotels",
            brandColor: null,
            loyaltyProgram: null,
            isUserAdded: false,
            createdAt: "2024-01-01T00:00:00.000Z",
          },
        },
        [derivedStay],
      ),
    );

    renderDetailPage();

    const membershipChip = await screen.findByTestId("stay-membership-chip-stay-1");
    expect(membershipChip.textContent).toContain("NH Rewards");
  });

  it("does not render a trip pill or loyalty chip when a stay has neither linked", async () => {
    getLodgingMock.mockResolvedValue(makeLodging({}, [baseStay])); // tripId/membershipId both null

    renderDetailPage();

    await waitFor(() => {
      expect(screen.getByText("Engimatt City & Garden")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("stay-trip-pill-stay-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("stay-membership-chip-stay-1")).not.toBeInTheDocument();
  });

  it("shows the Original amount and per-category rating averages in the sidebar cards", async () => {
    getLodgingMock.mockResolvedValue(
      makeLodging({ totalSpendBase: 883, totalSpendBaseByCurrency: { EUR: 883 } }, [baseStay]),
    );

    renderDetailPage();

    await waitFor(() => {
      expect(screen.getByText("Engimatt City & Garden")).toBeInTheDocument();
    });

    // "Original" spend line — the stay's own CHF amount, alongside (not
    // instead of) the converted base-currency figure.
    const originalLabel = screen.getByText("lodging:detail.spendOriginal");
    expect(originalLabel.closest("div")?.textContent).toMatch(/840/);

    // Per-category rating averages, not one collapsed aggregate.
    const roomLabel = screen.getByText("lodging:field.ratingRoom");
    expect(roomLabel.closest("div")?.textContent).toContain("4");
  });

  it("renders — (not 0 €) for the spend card when every stay's price has been cleared", async () => {
    const clearedStay: LodgingStay = {
      ...baseStay,
      totalPrice: null,
      totalPriceBase: null,
      fxRate: null,
      fxRateDate: null,
      fxBaseCurrency: null,
      fxSource: null,
    };
    // Mirrors the real backend: a lodging with no priced stay computes
    // totalSpendBase as 0 (computeAggregates' `?? 0` fallback) — the page
    // must not render that 0 as "0 €", which would wrongly assert the stay
    // was free.
    getLodgingMock.mockResolvedValue(
      makeLodging({ totalSpendBase: 0, totalSpendBaseByCurrency: {} }, [clearedStay]),
    );

    renderDetailPage();

    await waitFor(() => {
      expect(screen.getByText("Engimatt City & Garden")).toBeInTheDocument();
    });

    const spendBaseLabel = screen.getByText("lodging:detail.spendBase");
    expect(spendBaseLabel.closest("div")?.textContent).toMatch(/—/);
    expect(spendBaseLabel.closest("div")?.textContent).not.toMatch(/0\s*€/);
    const perNightLabel = screen.getByText("lodging:detail.spendPerNight");
    expect(perNightLabel.closest("div")?.textContent).toMatch(/—/);
  });
});
