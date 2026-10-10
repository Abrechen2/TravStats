import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { setClockForTests } from "../../shared/time";
import type { Cruise, CruiseStop, Port } from "../../types";

/**
 * forgejo#223: an underway cruise opens on today's day card; any day of the
 * itinerary opens its own.
 */
const getMock = vi.fn();
const listForEntry = vi.fn();

vi.mock("../../components/documents/DocumentsSection", () => ({ default: () => null }));
vi.mock("../../lib/api/documents", () => ({
  documentsApi: { listForEntry: (...a: unknown[]) => listForEntry(...a) },
  documentFileUrl: (d: { url: string }) => d.url,
}));
vi.mock("../../lib/api", () => ({
  cruiseApi: { get: (...args: unknown[]) => getMock(...args), remove: vi.fn() },
}));
vi.mock("../../components/NavigationBar", () => ({ default: () => <div /> }));
vi.mock("../../components/Cruise/CruiseRouteMap", () => ({ CruiseRouteMap: () => <div /> }));
vi.mock("../../components/Cruise/CruiseEditModal", () => ({ CruiseEditModal: () => null }));
vi.mock("../../hooks/useTodayZone", () => ({ useTodayZone: () => "UTC" }));

import CruiseDetailPage from "../CruiseDetailPage";
import { findNamed, queryNamed } from "../../__tests__/helpers/namedElement";

const port = (id: number, name: string): Port =>
  ({ id, name, country: "Norway", timezone: "Europe/Oslo" }) as Port;

const stop = (id: string, dayNumber: number, date: string, p: Port, extra = {}): CruiseStop =>
  ({
    id,
    cruiseId: "cruise-1",
    portId: p.id,
    port: p,
    dayNumber,
    date: `${date}T00:00:00.000Z`,
    isAtSea: false,
    arrivalTime: null,
    departureTime: null,
    excursionNote: null,
    unresolvedPortName: null,
    stopZone: "Europe/Oslo",
    ...extra,
  }) as CruiseStop;

const cruise = {
  id: "cruise-1",
  ship: null,
  shipNameOverride: "AIDAsol",
  cruiseLine: "AIDA",
  routeName: null,
  departurePort: null,
  arrivalPort: null,
  startDate: "2026-10-05T00:00:00.000Z",
  endDate: "2026-10-08T00:00:00.000Z",
  status: "in_progress",
  price: null,
  currency: "EUR",
  notes: null,
  tags: [],
  companions: [],
  tripId: null,
  stops: [
    stop("s1", 1, "2026-10-05", port(1, "Kiel")),
    stop("s3", 3, "2026-10-07", port(2, "Oslo"), {
      excursionNote: "Holmenkollen",
      allAboardTime: "17:30",
    }),
  ],
} as unknown as Cruise;

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/cruises/cruise-1"]}>
      <Routes>
        <Route path="/cruises/:id" element={<CruiseDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

const scrollIntoView = vi.fn();
Element.prototype.scrollIntoView = scrollIntoView;

describe("CruiseDetailPage — day card", () => {
  afterEach(() => {
    setClockForTests(null);
    vi.clearAllMocks();
  });

  it("opens on today's day while the cruise is underway", async () => {
    setClockForTests("2026-10-07T10:00:00Z");
    getMock.mockResolvedValue(cruise);
    listForEntry.mockResolvedValue([]);
    renderPage();

    const card = await findNamed("region", /detail\.day 3/);
    expect(card.textContent).toContain("dayCard.today");
    // Opened by itself on "today": nothing scrolls, the focus stays put.
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(card.textContent).toContain("Holmenkollen");
    expect(listForEntry).toHaveBeenCalledWith({ type: "cruise", id: "cruise-1" });
  });

  it("opens any day from the itinerary, and asks nothing while no card is open", async () => {
    setClockForTests("2026-12-01T10:00:00Z");
    getMock.mockResolvedValue(cruise);
    listForEntry.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText("dayCard.pickHint")).toBeInTheDocument();
    expect(queryNamed("region", /detail\.day/)).toBeNull();
    expect(listForEntry).not.toHaveBeenCalled();

    const rows = screen.getAllByRole("button", { pressed: false });
    const kiel = rows.find((r) => r.textContent?.includes("Kiel"));
    await userEvent.click(kiel!);
    const card = await findNamed("region", /detail\.day 1/);
    expect(within(card).queryByText("dayCard.today")).toBeNull();
    expect(kiel).toHaveAttribute("aria-pressed", "true");
    // Review I5: on a long itinerary the card sits above the row that was
    // tapped — it is brought into view and takes the focus.
    const heading = within(card).getByRole("heading");
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(document.activeElement).toBe(heading);
  });

  // Re-review: the open card was kept by day number alone, so with two calls
  // on one day, tapping the second opened the first.
  it("opens the second of two calls on one day, not the first", async () => {
    setClockForTests("2026-12-01T10:00:00Z");
    getMock.mockResolvedValue({
      ...cruise,
      stops: [
        stop("s3a", 3, "2026-10-07", port(2, "Oslo"), { excursionNote: "Holmenkollen" }),
        stop("s3b", 3, "2026-10-07", port(9, "Drøbak"), { excursionNote: "Festung" }),
      ],
    });
    listForEntry.mockResolvedValue([]);
    renderPage();

    await screen.findByText("dayCard.pickHint");
    const rows = screen.getAllByRole("button", { pressed: false });
    const drobak = rows.find((r) => r.textContent?.includes("Drøbak"));
    await userEvent.click(drobak!);

    const card = await findNamed("region", /detail\.day 3/);
    expect(card.textContent).toContain("Festung");
    expect(card.textContent).not.toContain("Holmenkollen");
    expect(drobak).toHaveAttribute("aria-pressed", "true");
  });
});
