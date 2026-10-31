import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * GET /trips caps its list at 500, and the page used to search only those
 * rows. The search and "mehr laden" now go to the server.
 */
const getAllWithInsights = vi.hoisted(() => vi.fn());
const listPage = vi.hoisted(() => vi.fn());
const detect = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api", () => ({ tripsApi: { getAllWithInsights, listPage, detect } }));
vi.mock("../../components/Trips/TripCard", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  default: ({ trip }: { trip: { name: string } }) => <div>{trip.name}</div>,
}));
vi.mock("../../components/Trips/TripInsightsBar", () => ({ TripInsightsBar: () => null }));
vi.mock("../../components/ui/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: () => void }) => unknown) =>
    selector({ addToast: vi.fn() }),
}));

import TripsPage from "../TripsPage";

const trip = (id: string, name: string) => ({
  id,
  name,
  status: "completed",
  category: null,
  tags: [],
  companions: [],
  countries: [],
  startDate: null,
  endDate: null,
});

const page = (trips: ReturnType<typeof trip>[], total = trips.length) => ({
  trips,
  total,
  truncated: trips.length < total,
  facets: { status: { completed: total }, category: {} },
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <TripsPage />
    </MemoryRouter>
  );

describe("TripsPage server-side search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAllWithInsights.mockResolvedValue({ trips: [], mostExpensiveTrip: null });
    detect.mockResolvedValue({ proposed: [] });
  });

  it("typing sends the query to the server and shows the server's result, not a local filter", async () => {
    listPage.mockImplementation(async ({ q }: { q?: string }) =>
      q
        ? page([trip("x", "Lissabon (beyond the first 500)")])
        : page([trip("a", "A"), trip("b", "B"), trip("c", "C"), trip("d", "D")])
    );
    renderPage();
    await screen.findByText("A");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "lissabon" } });
    expect(await screen.findByText("Lissabon (beyond the first 500)")).toBeInTheDocument();
    expect(listPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: "lissabon", offset: 0 })
    );
    await waitFor(() => expect(screen.queryByText("A")).toBeNull());
  });

  it("mehr laden asks for the next offset, appends, and the truncation notice follows", async () => {
    listPage
      .mockResolvedValueOnce(
        page([trip("a", "A"), trip("b", "B"), trip("c", "C"), trip("d", "D")], 6)
      )
      .mockResolvedValueOnce(page([trip("e", "E"), trip("f", "F")], 6));
    renderPage();
    expect(await screen.findByTestId("trips-truncated")).toHaveTextContent("trips:listTruncated");
    fireEvent.click(screen.getByTestId("trips-load-more"));
    await screen.findByText("F");
    expect(listPage).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 4 }));
    expect(screen.getByText("A")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("trips-truncated")).toBeNull());
    expect(screen.queryByTestId("trips-load-more")).toBeNull();
  });

  it("shows an error, not an empty list, when the server request fails", async () => {
    listPage.mockRejectedValue(new Error("boom"));
    renderPage();
    expect(await screen.findByTestId("trips-list-error")).toHaveTextContent("trips:listError");
    expect(screen.queryByText("trips:noTrips")).toBeNull();
  });
});
