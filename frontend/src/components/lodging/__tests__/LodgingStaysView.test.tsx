/**
 * The chronological stay view (forgejo#226): a server-paged list of every stay,
 * found by period and trip, each row opening its stay and leading to its house.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { LodgingStaysView } from "../LodgingStaysView";
import type { LodgingStayListItem } from "../../../types/lodging";

const listStayPageMock = vi.fn();
const deleteStayMock = vi.fn();
const getTripsMock = vi.fn();

vi.mock("../../../lib/api/lodging", () => ({
  listStayPage: (...args: unknown[]) => listStayPageMock(...args),
  deleteStay: (...args: unknown[]) => deleteStayMock(...args),
}));
vi.mock("../../../lib/api", () => ({
  tripsApi: { getAll: (...args: unknown[]) => getTripsMock(...args) },
}));
vi.mock("../../../lib/api/documents", () => ({
  documentsApi: { listForEntry: vi.fn().mockResolvedValue([]) },
}));
vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
// The editor has its own suites; here it only has to receive the right stay and house.
vi.mock("../StayEditor", () => ({
  StayEditor: (props: {
    stay?: { id: string } | null;
    lodgingId: string;
    lodgingName?: string;
    lodgingChainId?: number | null;
    onClose: () => void;
  }) => (
    <div data-testid="stay-editor-stub">
      {props.stay?.id}|{props.lodgingId}|{props.lodgingName}|{String(props.lodgingChainId)}
      <button type="button" onClick={props.onClose}>
        stub-close
      </button>
    </div>
  ),
}));

function makeStay(over: Partial<LodgingStayListItem> & { id: string }): LodgingStayListItem {
  return {
    lodgingId: "house-adlon",
    userId: "u",
    tripId: null,
    bookingId: null,
    checkIn: "2025-06-10T00:00:00.000Z",
    checkOut: "2025-06-15T00:00:00.000Z",
    checkInTime: null,
    checkOutTime: null,
    datePrecision: "DAY",
    nights: null,
    status: "completed",
    roomNumber: null,
    roomCategory: null,
    board: "none",
    pricePerNight: null,
    currency: "EUR",
    totalPrice: null,
    totalPriceBase: null,
    fxRate: null,
    fxRateDate: null,
    fxBaseCurrency: null,
    fxSource: null,
    isAwardStay: false,
    ratingRoom: null,
    ratingBreakfast: null,
    ratingService: null,
    ratingOverall: null,
    roomAmenities: [],
    bookingReference: null,
    membershipId: null,
    membershipOptOut: false,
    receiptUrl: null,
    guests: null,
    companions: [],
    notes: null,
    parserTemplate: null,
    parserConfidence: null,
    dataSource: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    lodging: {
      id: "house-adlon",
      name: "Hotel Adlon",
      type: "hotel",
      city: "Berlin",
      country: "DE",
      chainId: 7,
      isoCountryCode: "DE",
    },
    trip: null,
    ...over,
  };
}

const june = makeStay({ id: "s-june", roomNumber: "412", bookingReference: "AB12" });
const march = makeStay({
  id: "s-march",
  checkIn: "2025-03-01T00:00:00.000Z",
  checkOut: "2025-03-04T00:00:00.000Z",
  roomNumber: "208",
  trip: { id: "t1", name: "Berlin Frühjahr" },
  tripId: "t1",
});
const ibis = makeStay({
  id: "s-ibis",
  lodgingId: "house-ibis",
  lodging: {
    id: "house-ibis",
    name: "Ibis Mitte",
    type: "hotel",
    city: "Berlin",
    country: "DE",
    chainId: null,
    isoCountryCode: "DE",
  },
});

const renderView = (onAddHouse = vi.fn()): ReturnType<typeof render> =>
  render(
    <MemoryRouter>
      <LodgingStaysView onAddHouse={onAddHouse} />
    </MemoryRouter>
  );

describe("LodgingStaysView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listStayPageMock.mockResolvedValue({ rows: [june, ibis, march], total: 3 });
    getTripsMock.mockResolvedValue([{ id: "t1", name: "Berlin Frühjahr" }]);
  });

  it("lists the stays in the order the server sent, one row per stay", async () => {
    renderView();
    const rows = await screen.findAllByRole("row", { name: /./ });
    const bodyRows = rows.filter((row) =>
      row.getAttribute("data-testid")?.startsWith("stay-view-row-")
    );
    expect(bodyRows.map((row) => row.getAttribute("data-testid"))).toEqual([
      "stay-view-row-s-june",
      "stay-view-row-s-ibis",
      "stay-view-row-s-march",
    ]);
  });

  it("tells two stays of one house apart by period, room and booking, and both lead to the house", async () => {
    renderView();
    const juneRow = await screen.findByTestId("stay-view-row-s-june");
    const marchRow = await screen.findByTestId("stay-view-row-s-march");

    // The i18n stub here echoes keys, so presence of the room / booking lines
    // is what can be asserted: June has both, March only a room.
    expect(juneRow).toHaveTextContent("lodging:stayView.room");
    expect(juneRow).toHaveTextContent("lodging:stayView.reference");
    expect(marchRow).toHaveTextContent("lodging:stayView.room");
    expect(marchRow).not.toHaveTextContent("lodging:stayView.reference");
    // Different periods are the first thing in each row.
    expect(juneRow.textContent).not.toEqual(marchRow.textContent);

    const links = [juneRow, marchRow].map((row) => within(row).getByRole("link"));
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/lodging/house-adlon",
      "/lodging/house-adlon",
    ]);
    expect(marchRow).toHaveTextContent("Berlin Frühjahr");
  });

  it("a click on a row opens that stay's editor with its house and chain", async () => {
    renderView();
    await userEvent.click(await screen.findByTestId("stay-view-row-s-june"));
    expect(screen.getByTestId("stay-editor-stub")).toHaveTextContent(
      "s-june|house-adlon|Hotel Adlon|7"
    );
  });

  it("the house link does not open the editor", async () => {
    renderView();
    const row = await screen.findByTestId("stay-view-row-s-ibis");
    await userEvent.click(within(row).getByRole("link"));
    expect(screen.queryByTestId("stay-editor-stub")).toBeNull();
  });

  it("finds stays by period and trip - the server is asked, not the browser", async () => {
    const { container } = renderView();
    await screen.findByTestId("stay-view-row-s-june");

    const dates = container.querySelectorAll<HTMLInputElement>('input[type="date"]');
    fireEvent.change(dates[0], { target: { value: "2025-06-01" } });
    fireEvent.change(dates[1], { target: { value: "2025-06-30" } });
    await userEvent.selectOptions(screen.getByRole("combobox"), "t1");

    await waitFor(() =>
      expect(listStayPageMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ from: "2025-06-01", to: "2025-06-30", tripId: "t1" })
      )
    );
  });

  it("a period that ends before it begins is said at the field and not sent", async () => {
    const { container } = renderView();
    await screen.findByTestId("stay-view-row-s-june");
    const callsBefore = listStayPageMock.mock.calls.length;

    const dates = container.querySelectorAll<HTMLInputElement>('input[type="date"]');
    fireEvent.change(dates[0], { target: { value: "2025-06-30" } });
    fireEvent.change(dates[1], { target: { value: "2025-06-01" } });

    expect(dates[1]).toHaveAttribute("aria-invalid", "true");
    expect(dates[1]).toHaveAccessibleDescription("lodging:stayView.filter.invalidWindow");
    // Changing the first date sent one request; the invalid window sent none.
    expect(listStayPageMock.mock.calls.length).toBeLessThanOrEqual(callsBefore + 1);
    expect(
      listStayPageMock.mock.calls.some(([q]) => q.from === "2025-06-30" && q.to === "2025-06-01")
    ).toBe(false);
  });

  it("a failed load is not 'no stays': it says so and retries", async () => {
    listStayPageMock.mockRejectedValueOnce(new Error("503"));
    renderView();
    expect(await screen.findByText("lodging:stayView.loadError")).toBeInTheDocument();
    expect(screen.queryByText("lodging:stayView.empty")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "common:buttons.retry" }));
    expect(await screen.findByTestId("stay-view-row-s-june")).toBeInTheDocument();
  });

  it("an empty list offers to add a house; a filtered empty list offers the reset instead", async () => {
    listStayPageMock.mockResolvedValue({ rows: [], total: 0 });
    const onAddHouse = vi.fn();
    const { container } = renderView(onAddHouse);

    await userEvent.click(await screen.findByRole("button", { name: "lodging:add.title" }));
    expect(onAddHouse).toHaveBeenCalledTimes(1);

    const dates = container.querySelectorAll<HTMLInputElement>('input[type="date"]');
    fireEvent.change(dates[0], { target: { value: "2020-01-01" } });
    expect(await screen.findByText("common:filters.noMatch")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "lodging:add.title" })).toBeNull();
  });

  it("deletes a stay only after the question, then reloads", async () => {
    deleteStayMock.mockResolvedValue(undefined);
    renderView();
    await userEvent.click(await screen.findByTestId("stay-view-delete-s-june"));

    const dialog = await screen.findByRole("dialog");
    expect(deleteStayMock).not.toHaveBeenCalled();
    const callsBefore = listStayPageMock.mock.calls.length;
    await userEvent.click(within(dialog).getByRole("button", { name: "common:buttons.delete" }));

    await waitFor(() => expect(deleteStayMock).toHaveBeenCalledWith("house-adlon", "s-june"));
    await waitFor(() => expect(listStayPageMock.mock.calls.length).toBeGreaterThan(callsBefore));
  });
});
