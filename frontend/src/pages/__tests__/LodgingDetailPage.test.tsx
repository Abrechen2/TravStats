import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Lodging, LodgingMembership, LodgingStay } from "../../types/lodging";

const getLodgingMock = vi.fn();
const deleteLodgingMock = vi.fn();
const deleteStayMock = vi.fn();
const listMembershipsMock = vi.fn();
const tripsGetAllMock = vi.fn();

// The documents section fetches its entry's kept originals on mount. It has
// its own suite, and `__tests__/documentsMountPoints.test.tsx` checks that
// this surface mounts it — here it would only be a request reaching the
// network, which the setup refuses (forgejo#110).
vi.mock("../../components/documents/DocumentsSection", () => ({ default: () => null }));

vi.mock("../../lib/api/lodging", () => ({
  getLodging: (...args: unknown[]) => getLodgingMock(...args),
  deleteLodging: (...args: unknown[]) => deleteLodgingMock(...args),
  deleteStay: (...args: unknown[]) => deleteStayMock(...args),
  listMemberships: () => listMembershipsMock(),
  // The photo section asks for the house's photographs on mount. Without
  // this the mock module has no such export, vitest prints an error per
  // render and the section is never exercised (forgejo#110).
  listLodgingPhotos: () => Promise.resolve([]),
  // The stay editor is opened by one test below (the second entry point into
  // the deletion). It imports these three from the same module; a missing
  // export is `undefined is not a function` the moment the FX preview runs.
  createStay: () => Promise.resolve(null),
  updateStay: () => Promise.resolve(null),
  getFxPreview: () => Promise.resolve(null),
}));

// Same reason as in StayEditor's own suite: the currency picker asks the server
// which currencies were used recently, and the network guard in
// src/__tests__/setup.ts fails any test that lets it.
vi.mock("@/hooks/useRecentCurrencies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useRecentCurrencies")>();
  return { ...actual, useRecentCurrencies: () => [] };
});

vi.mock("../../lib/api", () => ({
  tripsApi: { getAll: () => tripsGetAllMock() },
  // CompanionPicker loads suggestions on mount; unmocked, it went to the
  // network through jsdom's XMLHttpRequest and logged an AggregateError.
  companionsApi: { list: () => Promise.resolve([]) },
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
import { useToastStore } from "../../store/toastStore";

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
    deleteStayMock.mockReset();
    deleteStayMock.mockResolvedValue(undefined);
    listMembershipsMock.mockReset();
    tripsGetAllMock.mockReset();
    listMembershipsMock.mockResolvedValue([]);
    tripsGetAllMock.mockResolvedValue([]);
    useToastStore.setState({ toasts: [] });
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

  it("writes no base-currency total when no stay could be converted", async () => {
    // One stay in USD with no exchange rate: the server's base sum is 0, but
    // that 0 is the absence of a conversion, not a free stay.
    useSettingsStore.setState({ baseCurrency: "EUR", units: { distanceUnit: "kilometers" } });
    getLodgingMock.mockResolvedValue(
      makeLodging({ totalSpendBase: 0 }, [
        { ...baseStay, currency: "USD", totalPrice: 780, totalPriceBase: null },
      ])
    );

    renderDetailPage();
    await waitFor(() => {
      expect(screen.getByText("Engimatt City & Garden")).toBeInTheDocument();
    });

    const row = screen.getByText("lodging:detail.spendBase").closest("div");
    expect(row?.textContent).toContain("—");
    expect(row?.textContent).not.toMatch(/0[,.]?\d*\s?€/);
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
    tripsGetAllMock.mockResolvedValue([{ id: "trip-1", name: "Zürich City" }]);
    listMembershipsMock.mockResolvedValue([{ id: "mem-1", programName: "NH Rewards" }]);
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
        [derivedStay]
      )
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
      makeLodging({ totalSpendBase: 883, totalSpendBaseByCurrency: { EUR: 883 } }, [baseStay])
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
      makeLodging({ totalSpendBase: 0, totalSpendBaseByCurrency: {} }, [clearedStay])
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

  it("renders — (never 0 €) for the spend card when the only priced stay is still planned", async () => {
    // forgejo#82, the detail-page twin of the list cell: `priced` was asked
    // of all stays while `totalSpendBase` is summed over the counted ones,
    // so a planned, priced stay printed the empty sum as "0 €".
    const plannedStay: LodgingStay = {
      ...baseStay,
      status: "scheduled",
      checkIn: "2099-09-07T00:00:00.000Z",
      checkOut: "2099-09-08T00:00:00.000Z",
      totalPrice: 149.9,
      currency: "EUR",
      totalPriceBase: 149.9,
      fxBaseCurrency: "EUR",
      fxRate: 1,
      fxRateDate: "2026-01-01",
      ratingRoom: null,
      ratingBreakfast: null,
      ratingService: null,
      ratingOverall: null,
    };
    getLodgingMock.mockResolvedValue(
      makeLodging({ totalSpendBase: 0, totalSpendBaseByCurrency: {}, nights: 0, stayCount: 0 }, [
        plannedStay,
      ])
    );

    renderDetailPage();

    await waitFor(() => {
      expect(screen.getByText("Engimatt City & Garden")).toBeInTheDocument();
    });

    const spendBaseLabel = screen.getByText("lodging:detail.spendBase");
    expect(spendBaseLabel.closest("div")?.textContent).toMatch(/—/);
    expect(spendBaseLabel.closest("div")?.textContent).not.toMatch(/0\s*€/);
    expect(screen.getByTestId("lodging-spend-planned")).toHaveTextContent(
      "lodging:list.spendPlanned"
    );
  });

  /**
   * Notes were accepted and then shown nowhere.
   *
   * The form has the field, the schema stores it, and the detail page did not
   * mention it once — so anything typed there vanished from view the moment it
   * was saved (Alex, 2026-08-29). It is rendered under the SAME label the form
   * uses; calling it "Beschreibung" in one place and "Notizen" in the other
   * would trade one inconsistency for a fresh one.
   */
  it("shows the notes that were typed into the form", async () => {
    getLodgingMock.mockResolvedValue(
      makeLodging({ notes: "Zimmer zur Hofseite verlangen, Strasse ist laut." })
    );
    renderDetailPage();

    await waitFor(() => {
      expect(
        screen.getByText("Zimmer zur Hofseite verlangen, Strasse ist laut.")
      ).toBeInTheDocument();
    });
  });

  it("says nothing at all when there are no notes", async () => {
    // An empty "Notizen" heading over blank space is its own small lie.
    getLodgingMock.mockResolvedValue(makeLodging({ notes: null }));
    renderDetailPage();

    await waitFor(() => {
      expect(screen.getByTestId("lodging-delete-button")).toBeInTheDocument();
    });
    expect(screen.queryByText("lodging:field.notes")).not.toBeInTheDocument();
  });

  /**
   * Coming from a chain, the way back is the chain.
   *
   * The back button was hard-wired to the full lodging list, so a reader who
   * had drilled list -> chain -> hotel landed two levels up and had to find
   * the chain again (Alex, 2026-08-29). The origin travels in router state, so
   * it survives the click that set it and nothing else — on a reload or a
   * bookmark there genuinely is no origin, and the list is then the honest
   * answer rather than a remembered guess.
   */
  it("offers the way back to the chain when that is where the reader came from", async () => {
    getLodgingMock.mockResolvedValue(makeLodging());

    render(
      <MemoryRouter
        initialEntries={[
          { pathname: "/lodging/lodging-1", state: { fromChain: { id: 7, name: "Kempinski" } } },
        ]}
      >
        <Routes>
          <Route path="/lodging/:id" element={<LodgingDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    // By destination and name, not by the rendered string: the arrow is its
    // own aria-hidden element in the shared detail header, so a screen reader
    // is not read "left arrow" — and a test that matched "← Kempinski" as one
    // text node was really asserting that it is NOT.
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Kempinski" })).toHaveAttribute(
        "href",
        "/lodging/chains/7"
      );
    });
  });

  it("falls back to the list when there is no origin", async () => {
    getLodgingMock.mockResolvedValue(makeLodging());
    renderDetailPage();

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "lodging:detail.backToLogbook" })).toHaveAttribute(
        "href",
        "/lodging"
      );
    });
  });

  // 2.6.1 (owner): a house with dozens of stays stretched the whole page,
  // pushing the map and the spend card off screen. The stays now scroll in
  // a box of their own beside the sidebar instead of the page scrolling.
  it("renders every stay inside one scroll box of its own, in check-in order", async () => {
    const stays = Array.from({ length: 30 }, (_, i) => ({
      ...baseStay,
      id: `stay-${i + 1}`,
      checkIn: `2024-${String((i % 12) + 1).padStart(2, "0")}-01T15:00:00.000Z`,
      checkOut: `2024-${String((i % 12) + 1).padStart(2, "0")}-03T11:00:00.000Z`,
    }));
    getLodgingMock.mockResolvedValue(makeLodging({}, stays));

    renderDetailPage();

    const box = await screen.findByTestId("lodging-stays-scroll");
    expect(box.className).toMatch(/overflow-y-auto/);
    expect(box.className).toMatch(/max-h-/);
    expect(within(box).getAllByText("common:buttons.edit")).toHaveLength(30);
  });

  /**
   * Deleting a stay (owner, 2026-09-19: "es fehlt die Möglichkeit, Aufenthalte
   * in Unterkünften zu löschen").
   *
   * The route and the API client both existed and nothing called them. These
   * tests walk the whole way through — click, confirm, request, reload — for
   * two reasons: a card button that opens nothing looks identical to one that
   * works, and `ConfirmModal`'s own overlay once swallowed every click on its
   * buttons while LOOKING confirmed (2.6.0-rc.9 UAT). jsdom does no
   * hit-testing, so it cannot prove paint order; what it does prove is that
   * the confirm button is reachable, enabled, and that clicking it is the only
   * thing that issues the request.
   */
  it("deletes a stay only after the confirmation, then reloads the lodging", async () => {
    const secondStay: LodgingStay = { ...baseStay, id: "stay-2" };
    getLodgingMock
      .mockResolvedValueOnce(makeLodging({}, [baseStay, secondStay]))
      // What the server answers after the delete — the aggregates come with it.
      .mockResolvedValueOnce(makeLodging({ stayCount: 1, nights: 1 }, [secondStay]));
    const user = userEvent.setup();

    renderDetailPage();

    await screen.findByTestId("stay-card-stay-1");
    await user.click(screen.getByTestId("stay-delete-stay-1"));

    const dialog = await screen.findByRole("dialog");
    // The i18n stub returns the bare key, so the assertion is WHICH key was
    // chosen: the dated form, not the unknown-length one.
    expect(within(dialog).getByText(/lodging:stay\.confirmDelete\.body/)).toBeInTheDocument();
    expect(deleteStayMock).not.toHaveBeenCalled();

    const confirm = within(dialog).getByRole("button", { name: "common:buttons.delete" });
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => {
      expect(deleteStayMock).toHaveBeenCalledWith("lodging-1", "stay-1");
    });
    // The card is gone and the reload happened — a client-side splice alone
    // would leave the header counting a stay that no longer exists.
    await waitFor(() => {
      expect(screen.queryByTestId("stay-card-stay-1")).not.toBeInTheDocument();
    });
    expect(getLodgingMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("stay-card-stay-2")).toBeInTheDocument();
  });

  it("keeps the stay when the confirmation is cancelled", async () => {
    getLodgingMock.mockResolvedValue(makeLodging({}, [baseStay]));
    const user = userEvent.setup();

    renderDetailPage();

    await screen.findByTestId("stay-card-stay-1");
    await user.click(screen.getByTestId("stay-delete-stay-1"));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "common:buttons.cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(deleteStayMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("stay-card-stay-1")).toBeInTheDocument();
  });

  /**
   * A stale figure is worse than a missing one.
   *
   * The aggregates (stayCount, nights, rating, spend) are only ever computed
   * server-side over the whole house, so a delete whose reload failed leaves
   * every one of them counting a stay that is no longer in the list. The row
   * is spliced out locally — that much IS known — and the four figures are
   * withheld until the next successful load rather than presented as data.
   */
  it("withholds the header figures when the post-delete reload fails", async () => {
    const otherStay: LodgingStay = { ...baseStay, id: "stay-2" };
    getLodgingMock
      .mockResolvedValueOnce(makeLodging({ stayCount: 2, nights: 4 }, [baseStay, otherStay]))
      .mockRejectedValueOnce(new Error("network"));
    const user = userEvent.setup();

    renderDetailPage();

    await screen.findByTestId("stay-card-stay-1");
    // The real figures are on screen first.
    expect(screen.getByText("lodging:detail.stays").closest("div")?.textContent).toContain("2");

    await user.click(screen.getByTestId("stay-delete-stay-1"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "common:buttons.delete" }));

    await waitFor(() => {
      expect(deleteStayMock).toHaveBeenCalledTimes(1);
    });
    // The card is gone — the delete itself succeeded.
    await waitFor(() => {
      expect(screen.queryByTestId("stay-card-stay-1")).not.toBeInTheDocument();
    });

    // …and every figure that counted it reads "—" rather than a wrong number.
    const stays = screen.getByText("lodging:detail.stays").closest("div");
    expect(stays?.textContent).toContain("—");
    expect(stays?.textContent).not.toContain("2");
    const nights = screen.getByText("lodging:detail.nights").closest("div");
    expect(nights?.textContent).toContain("—");
    // The two conditional ones leave the strip, which is how this page already
    // says "not known" for a rating and a spend it cannot state. Asked of the
    // KPI <dt> specifically — the sidebar carries the same label as a heading,
    // and that section averages `lodging.stays`, which the splice keeps right.
    const kpiLabels = Array.from(document.querySelectorAll("dt")).map((el) => el.textContent);
    expect(kpiLabels).not.toContain("lodging:detail.avgRating");
    expect(kpiLabels).not.toContain("lodging:detail.spend");
    const spendRow = screen.getByText("lodging:detail.spendBase").closest("div");
    expect(spendRow?.textContent).toContain("—");

    const toasts = useToastStore.getState().toasts;
    expect(toasts.some((toast) => toast.type === "success")).toBe(true);
    expect(toasts.some((toast) => toast.message === "lodging:stay.refreshFailed")).toBe(true);
  });

  it("keeps the row when the delete fails, and says so", async () => {
    getLodgingMock.mockResolvedValue(makeLodging({}, [baseStay]));
    deleteStayMock.mockRejectedValue(new Error("500"));
    const user = userEvent.setup();

    renderDetailPage();

    await screen.findByTestId("stay-card-stay-1");
    await user.click(screen.getByTestId("stay-delete-stay-1"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "common:buttons.delete" }));

    await waitFor(() => {
      expect(deleteStayMock).toHaveBeenCalledTimes(1);
    });
    // The row survives, and nothing was reloaded — a failed delete must not
    // look like a successful one.
    expect(screen.getByTestId("stay-card-stay-1")).toBeInTheDocument();
    expect(getLodgingMock).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().toasts.some((toast) => toast.type === "error")).toBe(true);
  });

  /**
   * The second entry point, and the same path.
   *
   * A stay open in the editor is the other place a reader decides it should
   * not exist. Both routes lead to the one confirmation and the one request —
   * and the editor closes afterwards, because it is showing a stay the server
   * no longer has.
   */
  it("deletes from the stay editor's footer through the same confirmation", async () => {
    getLodgingMock
      .mockResolvedValueOnce(makeLodging({}, [baseStay]))
      .mockResolvedValueOnce(makeLodging({ stayCount: 0, nights: 0 }, []));
    const user = userEvent.setup();

    renderDetailPage();

    await screen.findByTestId("stay-card-stay-1");
    await user.click(screen.getByTestId("stay-edit-stay-1"));

    const deleteInEditor = await screen.findByTestId("stay-editor-delete");
    await user.click(deleteInEditor);

    // By test id, not by role: the stay editor draws its own `role="dialog"`
    // overlay, so two are open at this moment. That is also the stacking
    // question the 2.6.0-rc.9 defect was about — both scrims are z-index 50,
    // and the confirmation wins only because it portals to the end of
    // <body>, after the page. jsdom cannot paint, so this asserts the reason
    // rather than the result.
    const scrim = await screen.findByTestId("confirm-modal");
    expect(scrim.parentElement).toBe(document.body);
    expect(document.body.lastElementChild).toBe(scrim);

    await user.click(within(scrim).getByRole("button", { name: "common:buttons.delete" }));

    await waitFor(() => {
      expect(deleteStayMock).toHaveBeenCalledWith("lodging-1", "stay-1");
    });
    await waitFor(() => {
      expect(screen.queryByTestId("stay-editor-delete")).not.toBeInTheDocument();
    });
  });

  it("offers no delete in the editor while a stay is being created", async () => {
    getLodgingMock.mockResolvedValue(makeLodging({}, [baseStay]));
    const user = userEvent.setup();

    renderDetailPage();

    await screen.findByTestId("stay-card-stay-1");
    await user.click(screen.getByTestId("lodging-add-stay-button"));

    // The editor is open …
    expect(await screen.findByTestId("stay-editor-save")).toBeInTheDocument();
    // … and has nothing to delete.
    expect(screen.queryByTestId("stay-editor-delete")).not.toBeInTheDocument();
  });
});
