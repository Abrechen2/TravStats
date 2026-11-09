import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import ToursPage from "../ToursPage";
import { tourIndexApi, type TourSummary } from "../../lib/api/tourIndex";
import { toursApi } from "../../lib/api/tours";
import { tripsApi } from "../../lib/api/trips";
import { useToastStore } from "../../store/toastStore";

vi.mock("../../lib/api/tourIndex", () => ({
  tourIndexApi: { list: vi.fn(), geometryBatch: vi.fn() },
}));
// Strava's status call would reach the network; the page only needs "not connected".
vi.mock("../../components/Trips/StravaImportDialog", () => ({
  default: () => null,
  useStravaConnected: () => false,
}));
vi.mock("../../lib/api/tours", () => ({
  toursApi: { createStandalone: vi.fn(), removeStandalone: vi.fn(), update: vi.fn() },
}));
vi.mock("../../lib/api/trips", () => ({ tripsApi: { getAll: vi.fn() } }));
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../components/ui/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

function tour(overrides: Partial<TourSummary> = {}): TourSummary {
  return {
    id: "t-1",
    tripId: "trip-1",
    tripName: "Norwegen",
    name: "Süd-Norwegen",
    mode: "road",
    kind: "tour",
    activity: null,
    vehicle: null,
    kindAssignedAutomatically: false,
    notes: null,
    anchorStopId: null,
    anchorStopTitle: null,
    distanceKm: 1284.4,
    distanceSource: "legs",
    ascentM: null,
    movingSeconds: null,
    trackCount: 0,
    stopCount: 8,
    startDate: null,
    endDate: null,
    ...overrides,
  };
}

function renderPage(): void {
  render(
    <MemoryRouter>
      <ToursPage />
    </MemoryRouter>
  );
}

describe("the tours page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists a tour that belongs to no trip, and says so instead of leaving a blank", async () => {
    vi.mocked(tourIndexApi.list).mockResolvedValue([
      tour(),
      tour({ id: "t-2", tripId: null, tripName: null, name: "Besseggen" }),
    ]);

    renderPage();

    expect(await screen.findByText("Besseggen")).toBeInTheDocument();
    // Every other row shows its trip's name here; a tour with none says
    // what it is rather than showing an empty space in the same slot.
    expect(screen.getByText("trips:tours.noTrip")).toBeInTheDocument();
    expect(screen.getByText("Norwegen")).toBeInTheDocument();
  });

  it("filters tours by name or trip, and says so when the filter empties the list (forgejo#403)", async () => {
    vi.mocked(tourIndexApi.list).mockResolvedValue([
      tour(),
      tour({ id: "t-2", tripId: null, tripName: null, name: "Besseggen" }),
    ]);

    renderPage();
    const box = await screen.findByLabelText("trips:tours.searchPlaceholder");

    fireEvent.change(box, { target: { value: "bessegg" } });
    expect(screen.getByText("Besseggen")).toBeInTheDocument();
    expect(screen.queryByText("Süd-Norwegen")).not.toBeInTheDocument();

    // The trip's name matches too.
    fireEvent.change(box, { target: { value: "norweg" } });
    expect(screen.getByText("Süd-Norwegen")).toBeInTheDocument();

    // An emptied list is "no match", never the "no tours yet" onboarding text.
    fireEvent.change(box, { target: { value: "zzz" } });
    expect(screen.getByText("trips:tours.searchEmpty")).toBeInTheDocument();
    expect(screen.queryByText("trips:tours.pageEmpty")).not.toBeInTheDocument();
  });

  it("links a standalone tour to the trip-less editor path", async () => {
    vi.mocked(tourIndexApi.list).mockResolvedValue([
      tour({ id: "t-2", tripId: null, tripName: null, name: "Besseggen" }),
    ]);

    renderPage();

    const link = (await screen.findByText("Besseggen")).closest("a");
    expect(link).toHaveAttribute("href", "/tours/t-2");
  });

  it("links a trip's tour through its trip, so the trip context survives", async () => {
    vi.mocked(tourIndexApi.list).mockResolvedValue([tour()]);

    renderPage();

    const link = (await screen.findByText("Süd-Norwegen")).closest("a");
    expect(link).toHaveAttribute("href", "/trips/trip-1/route/t-1");
  });

  it("creates a tour with no trip and re-reads the list", async () => {
    vi.mocked(tourIndexApi.list).mockResolvedValue([]);
    vi.mocked(toursApi.createStandalone).mockResolvedValue({
      id: "t-3",
    } as unknown as Awaited<ReturnType<typeof toursApi.createStandalone>>);

    renderPage();
    await waitFor(() => expect(tourIndexApi.list).toHaveBeenCalled());

    fireEvent.click(screen.getByText("trips:tours.newTour"));
    fireEvent.change(screen.getByLabelText("trips:tours.namePlaceholder"), {
      target: { value: "Besseggen" },
    });
    fireEvent.click(screen.getByText("trips:tours.save"));

    await waitFor(() =>
      expect(toursApi.createStandalone).toHaveBeenCalledWith({
        name: "Besseggen",
        mode: "road",
        activity: "hike",
      })
    );
    // Re-read, not appended: where the new tour lands in an order keyed on
    // the owning trip's start date is the server's answer.
    await waitFor(() => expect(tourIndexApi.list).toHaveBeenCalledTimes(2));
  });

  // Acceptance D2: "Neue Tour" had no date, so a standalone day tour could
  // never be placed by the trip suggestions.
  it("creates a day tour with its date and start time", async () => {
    vi.mocked(tourIndexApi.list).mockResolvedValue([]);
    vi.mocked(toursApi.createStandalone).mockResolvedValue({
      id: "t-4",
    } as unknown as Awaited<ReturnType<typeof toursApi.createStandalone>>);

    renderPage();
    await waitFor(() => expect(tourIndexApi.list).toHaveBeenCalled());

    fireEvent.click(screen.getByText("trips:tours.newTour"));
    fireEvent.change(screen.getByLabelText("trips:tours.namePlaceholder"), {
      target: { value: "Fiesole" },
    });
    fireEvent.change(screen.getByLabelText("trips:tours.day.date"), {
      target: { value: "2025-05-04" },
    });
    fireEvent.change(screen.getByLabelText("trips:tours.day.startTime"), {
      target: { value: "08:30" },
    });
    fireEvent.click(screen.getByText("trips:tours.save"));

    await waitFor(() =>
      expect(toursApi.createStandalone).toHaveBeenCalledWith({
        name: "Fiesole",
        mode: "road",
        activity: "hike",
        date: "2025-05-04",
        startTime: "08:30",
      })
    );
    await waitFor(() => expect(tourIndexApi.list).toHaveBeenCalledTimes(2));
  });

  it("offers no rail mode, matching the trip page's own list", async () => {
    vi.mocked(tourIndexApi.list).mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(tourIndexApi.list).toHaveBeenCalled());

    fireEvent.click(screen.getByText("trips:tours.newTour"));
    const options = Array.from(
      screen.getByLabelText("trips:tours.modeLabel").querySelectorAll("option"),
      (o) => o.getAttribute("value")
    );
    expect(options).toEqual(["road", "ferry", "foot", "bike"]);
  });

  it("shows an error state rather than an empty list when the load fails", async () => {
    vi.mocked(tourIndexApi.list).mockRejectedValue(new Error("boom"));

    renderPage();

    expect(await screen.findByText("trips:tours.loadError")).toBeInTheDocument();
    // "nothing yet" and "we could not ask" must not look the same.
    expect(screen.queryByText("trips:tours.pageEmpty")).not.toBeInTheDocument();
  });

  it("keeps the row when a delete fails", async () => {
    vi.mocked(tourIndexApi.list).mockResolvedValue([tour({ tripId: null, tripName: null })]);
    vi.mocked(toursApi.removeStandalone).mockRejectedValue(new Error("boom"));

    renderPage();
    await screen.findByText("Süd-Norwegen");

    fireEvent.click(screen.getByText("trips:tours.deleteLabel"));
    fireEvent.click(await screen.findByText("trips:tours.deleteConfirm.confirm"));

    await waitFor(() =>
      expect(toursApi.removeStandalone).toHaveBeenCalledWith("t-1", { deleteExpenses: false })
    );
    expect(screen.getByText("Süd-Norwegen")).toBeInTheDocument();
  });

  it("asks once more before deleting a tour's costs with it (forgejo#140)", async () => {
    vi.mocked(tourIndexApi.list).mockResolvedValue([tour({ tripId: null, tripName: null })]);
    vi.mocked(toursApi.removeStandalone)
      .mockRejectedValueOnce(
        Object.assign(new Error("conflict"), {
          isAxiosError: true,
          response: { status: 409, data: { code: "SECTION_HAS_EXPENSES", expenseCount: 1 } },
        })
      )
      .mockResolvedValueOnce(undefined);

    renderPage();
    await screen.findByText("Süd-Norwegen");
    fireEvent.click(screen.getByText("trips:tours.deleteLabel"));
    fireEvent.click(await screen.findByText("trips:tours.deleteConfirm.confirm"));
    fireEvent.click(await screen.findByText("trips:tours.deleteWithCosts.confirm"));

    await waitFor(() => expect(screen.queryByText("Süd-Norwegen")).toBeNull());
    expect(vi.mocked(toursApi.removeStandalone).mock.calls[1]).toEqual([
      "t-1",
      { deleteExpenses: true },
    ]);
  });
});

// A name of only spaces used to leave the save button greyed out with no word
// of why. The form now says what is missing at the field and sends nothing.
describe("the tours page — a tour needs a name", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("names the missing field instead of saving a blank tour", async () => {
    vi.mocked(tourIndexApi.list).mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(tourIndexApi.list).toHaveBeenCalled());

    fireEvent.click(screen.getByText("trips:tours.newTour"));
    const input = screen.getByLabelText("trips:tours.namePlaceholder");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByText("trips:tours.save"));

    expect(screen.getByRole("alert")).toHaveTextContent("trips:tours.nameRequired");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(toursApi.createStandalone).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "Besseggen" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("detaches a tour from its trip through the tour path, then re-reads the list", async () => {
    vi.mocked(tourIndexApi.list).mockResolvedValue([tour()]);
    vi.mocked(toursApi.update).mockResolvedValue({} as never);
    renderPage();

    fireEvent.click(await screen.findByText("trips:tours.move.detach"));

    await waitFor(() =>
      expect(toursApi.update).toHaveBeenCalledWith(undefined, "t-1", { tripId: null })
    );
    await waitFor(() => expect(tourIndexApi.list).toHaveBeenCalledTimes(2));
  });

  it("tells the reader why a tour drawn over the trip's stops cannot be detached (409), and keeps the row", async () => {
    vi.mocked(tourIndexApi.list).mockResolvedValue([tour()]);
    vi.mocked(toursApi.update).mockRejectedValue(
      Object.assign(new Error("conflict"), { isAxiosError: true, response: { status: 409 } })
    );
    const addToast = vi.fn();
    useToastStore.setState({ addToast } as never);
    renderPage();

    fireEvent.click(await screen.findByText("trips:tours.move.detach"));

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("error", "trips:tours.move.timelineError")
    );
    expect(screen.getByText("Süd-Norwegen")).toBeInTheDocument();
    expect(tourIndexApi.list).toHaveBeenCalledTimes(1);
  });

  it("shows a plain error when the detach fails for another reason", async () => {
    vi.mocked(tourIndexApi.list).mockResolvedValue([tour()]);
    vi.mocked(toursApi.update).mockRejectedValue(new Error("network"));
    const addToast = vi.fn();
    useToastStore.setState({ addToast } as never);
    renderPage();

    fireEvent.click(await screen.findByText("trips:tours.move.detach"));

    await waitFor(() => expect(addToast).toHaveBeenCalledWith("error", "trips:tours.move.error"));
  });

  it("offers 'assign to trip' on a trip-less tour and says why a refused move failed", async () => {
    vi.mocked(tourIndexApi.list).mockResolvedValue([
      tour({ id: "t-2", tripId: null, tripName: null, name: "Besseggen" }),
    ]);
    vi.mocked(tripsApi.getAll).mockResolvedValue([{ id: "trip-9", name: "Jotunheimen" }] as never);
    vi.mocked(toursApi.update).mockRejectedValue(new Error("boom"));
    renderPage();

    fireEvent.click(await screen.findByText("trips:tours.move.action"));
    const select = await screen.findByLabelText("trips:tours.move.tripLabel");
    fireEvent.change(select, { target: { value: "trip-9" } });
    fireEvent.click(screen.getByText("trips:tours.move.confirm"));

    await waitFor(() =>
      expect(toursApi.update).toHaveBeenCalledWith(undefined, "t-2", { tripId: "trip-9" })
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("trips:tours.move.error");
  });

  it("does not render a failed trip read as 'no trips' in the move dialog", async () => {
    vi.mocked(tourIndexApi.list).mockResolvedValue([
      tour({ id: "t-2", tripId: null, tripName: null, name: "Besseggen" }),
    ]);
    vi.mocked(tripsApi.getAll).mockRejectedValue(new Error("down"));
    renderPage();

    fireEvent.click(await screen.findByText("trips:tours.move.action"));

    expect(await screen.findByRole("alert")).toHaveTextContent("trips:tours.move.loadError");
    expect(screen.queryByText("trips:tours.move.noTrips")).not.toBeInTheDocument();
  });

  it("offers to unlink station photos when the server says they block the detach, and resends with the opt-in", async () => {
    vi.mocked(tourIndexApi.list).mockResolvedValue([tour()]);
    vi.mocked(toursApi.update)
      .mockRejectedValueOnce(
        Object.assign(new Error("conflict"), {
          isAxiosError: true,
          response: { status: 409, data: { code: "ROADTRIP_HAS_TRIP_PHOTOS" } },
        })
      )
      .mockResolvedValueOnce({} as never);
    const addToast = vi.fn();
    useToastStore.setState({ addToast } as never);
    renderPage();

    fireEvent.click(await screen.findByText("trips:tours.move.detach"));
    // Not the timeline message: the reader is asked, and can agree.
    fireEvent.click(await screen.findByText("trips:tours.move.detachPhotosConfirm"));

    await waitFor(() =>
      expect(toursApi.update).toHaveBeenLastCalledWith(undefined, "t-1", {
        tripId: null,
        detachStationPhotos: true,
      })
    );
    expect(addToast).not.toHaveBeenCalled();
  });
});
