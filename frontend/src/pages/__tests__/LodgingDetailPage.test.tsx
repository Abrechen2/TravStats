import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Lodging, LodgingStay } from "../../types/lodging";

const getLodgingMock = vi.fn();
const deleteLodgingMock = vi.fn();

vi.mock("../../lib/api/lodging", () => ({
  getLodging: (...args: unknown[]) => getLodgingMock(...args),
  deleteLodging: (...args: unknown[]) => deleteLodgingMock(...args),
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
  checkIn: "2024-05-12T15:00:00.000Z",
  checkOut: "2024-05-14T11:00:00.000Z",
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
  isAwardStay: false,
  ratingRoom: 4,
  ratingBreakfast: 4,
  ratingService: 4,
  ratingOverall: 4,
  roomAmenities: [],
  bookingReference: "ENG-55021",
  membershipId: null,
  receiptUrl: null,
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
    lat: 47.36,
    lon: 8.53,
    stars: 4,
    amenities: ["Garden", "Parking"],
    notes: null,
    dataSource: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    stays,
    overallRating: 4,
    stayCount: stays.length,
    nights: 2,
    totalSpendBase: 883,
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
    useSettingsStore.setState({
      baseCurrency: "EUR",
      units: { distanceUnit: "kilometers", currency: "EUR" },
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
    // Confirmation must name the stay count (2 stays here). The count is
    // asserted via `data-stay-count` rather than the rendered text because
    // the actual DE/EN copy ("Dieses Hotel hat {{count}} Übernachtungen…")
    // ships in Task 20 — this proves the wiring independent of translation
    // content, the same way `data-lodging-count` is used elsewhere in this
    // codebase's tests (see LodgingTab.test.tsx).
    const message = within(dialog).getByTestId("lodging-delete-message");
    expect(message.getAttribute("data-stay-count")).toBe("2");
    expect(deleteLodgingMock).not.toHaveBeenCalled();

    // Cancelling must not delete either.
    await user.click(within(dialog).getByTestId("lodging-delete-cancel"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(deleteLodgingMock).not.toHaveBeenCalled();

    // Only the explicit confirm click calls deleteLodging.
    await user.click(screen.getByTestId("lodging-delete-button"));
    const dialog2 = await screen.findByRole("dialog");
    await user.click(within(dialog2).getByTestId("lodging-delete-confirm"));

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
      units: { distanceUnit: "kilometers", currency: "USD" },
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
});
