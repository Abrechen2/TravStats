import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import ToursPage from "../ToursPage";
import { tourIndexApi, type TourSummary } from "../../lib/api/tourIndex";
import { toursApi } from "../../lib/api/tours";

vi.mock("../../lib/api/tourIndex", () => ({
  tourIndexApi: { list: vi.fn(), geometryBatch: vi.fn() },
}));
vi.mock("../../lib/api/tours", () => ({
  toursApi: { createStandalone: vi.fn(), removeStandalone: vi.fn() },
}));
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
    distanceKm: 1284.4,
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
      })
    );
    // Re-read, not appended: where the new tour lands in an order keyed on
    // the owning trip's start date is the server's answer.
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

    await waitFor(() => expect(toursApi.removeStandalone).toHaveBeenCalledWith("t-1"));
    expect(screen.getByText("Süd-Norwegen")).toBeInTheDocument();
  });
});
