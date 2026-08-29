import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

describe("TourSectionList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows each section with its distance", async () => {
    vi.mocked(toursApi.list).mockResolvedValue([
      {
        id: "r1", tripId: "t1", name: "Südnorwegen", mode: "road", orderIdx: 0,
        color: null, notes: null, startOdometerKm: null, endOdometerKm: null,
        stopCount: 8, legCount: 7, distanceKm: 1284.4, drivenKm: 1284.4,
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
});
