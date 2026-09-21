import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import TourSectionList from "../TourSectionList";
import { toursApi } from "../../../lib/api/tours";

vi.mock("../../../lib/api/tours", () => ({
  toursApi: { list: vi.fn(), create: vi.fn(), remove: vi.fn() },
}));

// Page-level tests in this project receive raw i18n KEYS, not German text.
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

function renderList(tripId: string): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <TourSectionList tripId={tripId} />
    </MemoryRouter>
  );
}

function route(id: string, name: string) {
  return {
    id,
    tripId: "t1",
    name,
    mode: "road" as const,
    orderIdx: 0,
    color: null,
    notes: null,
    startOdometerKm: null,
    endOdometerKm: null,
    stopCount: 8,
    legCount: 7,
    distanceKm: 1284.4,
    drivenKm: 1284.4,
  };
}

describe("TourSectionList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows each section with its distance", async () => {
    vi.mocked(toursApi.list).mockResolvedValue([
      {
        id: "r1",
        tripId: "t1",
        name: "Südnorwegen",
        mode: "road",
        orderIdx: 0,
        color: null,
        notes: null,
        startOdometerKm: null,
        endOdometerKm: null,
        stopCount: 8,
        legCount: 7,
        distanceKm: 1284.4,
        drivenKm: 1284.4,
      },
    ]);

    renderList("t1");

    expect(await screen.findByText("Südnorwegen")).toBeInTheDocument();
    expect(screen.getByText(/1.284/)).toBeInTheDocument();
  });

  it("shows an empty state rather than a zero when there is no section", async () => {
    vi.mocked(toursApi.list).mockResolvedValue([]);
    renderList("t1");
    await waitFor(() => expect(screen.getByText("trips:tours.empty")).toBeInTheDocument());
  });

  it("shows an error instead of a plausible zero when loading fails", async () => {
    // Zeros over a failed load are a lie the user cannot detect.
    vi.mocked(toursApi.list).mockRejectedValue(new Error("boom"));
    renderList("t1");
    await waitFor(() => expect(screen.getByText("trips:tours.loadError")).toBeInTheDocument());
  });

  it("shows a section created after a failed load, and drops the error", async () => {
    vi.mocked(toursApi.list).mockRejectedValueOnce(new Error("boom"));
    renderList("t1");
    await waitFor(() => expect(screen.getByText("trips:tours.loadError")).toBeInTheDocument());

    vi.mocked(toursApi.create).mockResolvedValue({
      id: "r1",
      tripId: "t1",
      name: "Südnorwegen",
      mode: "road",
      orderIdx: 0,
      color: null,
      notes: null,
      startOdometerKm: null,
      endOdometerKm: null,
      stopCount: 0,
      legCount: 0,
      distanceKm: 0,
      drivenKm: 0,
    });

    // Drive the create control the way a user would: open it, name the
    // section, submit.
    fireEvent.click(screen.getByText("trips:tours.newSection"));
    fireEvent.change(screen.getByPlaceholderText("trips:tours.namePlaceholder"), {
      target: { value: "Südnorwegen" },
    });
    fireEvent.click(screen.getByText("trips:tours.save"));

    await waitFor(() => expect(screen.getByText("Südnorwegen")).toBeInTheDocument());
    expect(screen.queryByText("trips:tours.loadError")).not.toBeInTheDocument();
  });

  it("keeps the error banner and never renders an empty list when a create fails", async () => {
    vi.mocked(toursApi.list).mockRejectedValueOnce(new Error("boom"));
    renderList("t1");
    await waitFor(() => expect(screen.getByText("trips:tours.loadError")).toBeInTheDocument());

    vi.mocked(toursApi.create).mockRejectedValue(new Error("nope"));

    fireEvent.click(screen.getByText("trips:tours.newSection"));
    fireEvent.change(screen.getByPlaceholderText("trips:tours.namePlaceholder"), {
      target: { value: "Südnorwegen" },
    });
    fireEvent.click(screen.getByText("trips:tours.save"));

    await waitFor(() => expect(toursApi.create).toHaveBeenCalled());

    // The failed create must not clear the outage banner, and must not
    // render an empty list as if the trip genuinely had no sections.
    expect(screen.getByText("trips:tours.loadError")).toBeInTheDocument();
    expect(screen.queryByText("trips:tours.empty")).not.toBeInTheDocument();
  });

  it("deletes a tour and drops its row, once the confirmation is accepted", async () => {
    vi.mocked(toursApi.list).mockResolvedValue([
      route("r1", "Südnorwegen"),
      route("r2", "Jütland"),
    ]);
    vi.mocked(toursApi.remove).mockResolvedValue(undefined);

    renderList("t1");
    await screen.findByText("Südnorwegen");

    fireEvent.click(screen.getAllByText("trips:tours.deleteLabel")[0]);
    fireEvent.click(await screen.findByText("trips:tours.deleteConfirm.confirm"));

    await waitFor(() => expect(toursApi.remove).toHaveBeenCalledWith("t1", "r1"));
    await waitFor(() => expect(screen.queryByText("Südnorwegen")).not.toBeInTheDocument());
    expect(screen.getByText("Jütland")).toBeInTheDocument();
  });

  it("keeps the row when the delete fails — a vanished row would read as deleted", async () => {
    vi.mocked(toursApi.list).mockResolvedValue([route("r1", "Südnorwegen")]);
    vi.mocked(toursApi.remove).mockRejectedValue(new Error("boom"));

    renderList("t1");
    await screen.findByText("Südnorwegen");

    fireEvent.click(screen.getByText("trips:tours.deleteLabel"));
    fireEvent.click(await screen.findByText("trips:tours.deleteConfirm.confirm"));

    await waitFor(() => expect(toursApi.remove).toHaveBeenCalled());
    expect(screen.getByText("Südnorwegen")).toBeInTheDocument();
  });

  it("offers no rail mode for a new section, while a stored rail tour still reads back", async () => {
    // Alex, 2026-09-20, owner agreed: a train journey is held back for a
    // domain of its own with a real route API, so the tour editor stops
    // offering it. Withdrawing the OFFER must not invalidate data — a tour
    // already saved as rail still renders its own label.
    vi.mocked(toursApi.list).mockResolvedValue([{ ...route("r1", "Zugfahrt"), mode: "rail" }]);
    renderList("t1");
    await screen.findByText("Zugfahrt");
    expect(screen.getByText("trips:tours.mode.rail")).toBeInTheDocument();

    fireEvent.click(screen.getByText("trips:tours.newSection"));
    const options = Array.from(screen.getByRole("combobox").querySelectorAll("option"), (o) =>
      o.getAttribute("value")
    );
    expect(options).toEqual(["road", "ferry", "foot", "bike"]);
  });
});
