import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

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

  it("cannot load more of the old list while a new search replaces it", async () => {
    listPage.mockResolvedValueOnce(
      page([trip("a", "A"), trip("b", "B"), trip("c", "C"), trip("d", "D")], 6)
    );
    renderPage();
    await screen.findByText("A");
    listPage.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "x" } });
    await waitFor(() => expect(listPage).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("trips-load-more")).toBeDisabled();
  });

  it("shows an error, not an empty list, when the server request fails", async () => {
    listPage.mockRejectedValue(new Error("boom"));
    renderPage();
    expect(await screen.findByTestId("trips-list-error")).toHaveTextContent("trips:listError");
    expect(screen.queryByText("trips:noTrips")).toBeNull();
  });

  // Back from a trip used to bring back only the first page, so the card the
  // reader had scrolled to after "mehr laden" was gone and the scroll had
  // nowhere to land.
  it("Back after 'mehr laden' reloads as many trips as were shown, from ?shown=", async () => {
    const many = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) => trip(`t${from + i}`, `T${from + i}`));
    listPage
      .mockResolvedValueOnce(page(many(0, 500), 900))
      .mockResolvedValueOnce(page(many(500, 200), 900));
    render(
      <MemoryRouter initialEntries={["/trips?shown=700"]}>
        <TripsPage />
      </MemoryRouter>
    );
    await screen.findByText("T699");
    expect(listPage).toHaveBeenNthCalledWith(1, expect.objectContaining({ limit: 500, offset: 0 }));
    expect(listPage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ limit: 200, offset: 500 })
    );
  });

  it("'mehr laden' writes the shown count into the URL", async () => {
    function Where(): JSX.Element {
      const location = useLocation();
      return <output data-testid="where">{location.search}</output>;
    }
    listPage
      .mockResolvedValueOnce(page([trip("a", "A"), trip("b", "B")], 3))
      .mockResolvedValueOnce(page([trip("c", "C")], 3));
    render(
      <MemoryRouter initialEntries={["/trips"]}>
        <Where />
        <TripsPage />
      </MemoryRouter>
    );
    fireEvent.click(await screen.findByTestId("trips-load-more"));
    await screen.findByText("C");
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("shown=3"));
  });

  describe("filter pills are single-select", () => {
    const facetPage = () => ({
      trips: [trip("a", "A")],
      total: 5,
      truncated: false,
      facets: { status: { completed: 3, planned: 2 }, category: { business: 2, vacation: 3 } },
    });
    function Where(): JSX.Element {
      return <output data-testid="where">{useLocation().search}</output>;
    }
    const open = (url: string) =>
      render(
        <MemoryRouter initialEntries={[url]}>
          <Where />
          <TripsPage />
        </MemoryRouter>
      );
    const lit = () =>
      screen
        .getAllByRole("button", { pressed: true })
        .map((b) => b.textContent ?? "")
        .filter((t) => /status\.|category\.|allStatuses/.test(t));

    beforeEach(() => listPage.mockResolvedValue(facetPage()));

    it("clicking a category after a status leaves only the category lit and queries it alone", async () => {
      open("/trips?status=planned");
      await screen.findByText("trips:category.business");
      expect(lit()).toHaveLength(1);
      fireEvent.click(screen.getByText("trips:category.business"));
      await waitFor(() =>
        expect(listPage).toHaveBeenLastCalledWith(
          expect.objectContaining({ category: "business", status: undefined })
        )
      );
      expect(lit()).toHaveLength(1);
      expect(lit()[0]).toContain("category.business");
      expect(screen.getByTestId("where").textContent).not.toContain("status=planned");
    });

    it("clicking a status after a category leaves only the status lit", async () => {
      open("/trips?category=business");
      fireEvent.click(await screen.findByText("trips:status.planned"));
      await waitFor(() =>
        expect(listPage).toHaveBeenLastCalledWith(
          expect.objectContaining({ status: "planned", category: undefined })
        )
      );
      expect(lit()).toHaveLength(1);
      expect(lit()[0]).toContain("status.planned");
    });

    it("'Alle' clears both and is the only lit pill", async () => {
      open("/trips?category=business");
      fireEvent.click(await screen.findByText("trips:filterBar.allStatuses"));
      await waitFor(() =>
        expect(screen.getByTestId("where").textContent).not.toContain("category=")
      );
      expect(lit()).toHaveLength(1);
      expect(lit()[0]).toContain("allStatuses");
    });

    it("an old link carrying both filters is read as the category alone", async () => {
      open("/trips?status=planned&category=business");
      await screen.findByText("trips:category.business");
      await waitFor(() =>
        expect(listPage).toHaveBeenCalledWith(
          expect.objectContaining({ category: "business", status: undefined })
        )
      );
      expect(lit()).toHaveLength(1);
      expect(lit()[0]).toContain("category.business");
    });

    it("pill counts come from the whole logbook's facets, whichever pill is lit", async () => {
      open("/trips?category=business");
      await screen.findByText("trips:status.planned");
      const pill = (label: string) => screen.getByText(label).closest("button")!;
      expect(pill("trips:status.planned")).toHaveTextContent("2");
      expect(pill("trips:status.completed")).toHaveTextContent("3");
      expect(pill("trips:category.business")).toHaveTextContent("2");
    });
  });
});
