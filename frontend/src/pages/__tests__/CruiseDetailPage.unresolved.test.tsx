import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Cruise, CruiseStop, Port } from "../../types";

/**
 * forgejo#222 on the page (with forgejo#176): the "+1" beside the port count
 * is said in words, the work list sits under the itinerary, and resolving a
 * port updates the page.
 */
const getMock = vi.fn();
const updateMock = vi.fn();

vi.mock("../../components/documents/DocumentsSection", () => ({ default: () => null }));
vi.mock("../../lib/api/documents", () => ({
  documentsApi: { listForEntry: () => Promise.resolve([]) },
  documentFileUrl: (d: { url: string }) => d.url,
}));
vi.mock("../../lib/api", () => ({
  cruiseApi: {
    get: (...a: unknown[]) => getMock(...a),
    update: (...a: unknown[]) => updateMock(...a),
    remove: vi.fn(),
  },
  portsApi: {
    search: () => Promise.resolve([{ id: 77, name: "Colón", country: "Panama" }]),
    geocode: () => Promise.resolve({ ports: [], failure: null }),
  },
}));
vi.mock("../../components/NavigationBar", () => ({ default: () => <div /> }));
vi.mock("../../components/Cruise/CruiseRouteMap", () => ({ CruiseRouteMap: () => <div /> }));
vi.mock("../../components/Cruise/CruiseEditModal", () => ({ CruiseEditModal: () => null }));

import CruiseDetailPage from "../CruiseDetailPage";

const stop = (id: string, day: number, extra: Partial<CruiseStop>): CruiseStop =>
  ({
    id,
    cruiseId: "cruise-1",
    portId: null,
    port: null,
    dayNumber: day,
    date: null,
    isAtSea: false,
    arrivalTime: null,
    departureTime: null,
    excursionNote: null,
    unresolvedPortName: null,
    ...extra,
  }) as CruiseStop;

const base = {
  id: "cruise-1",
  ship: null,
  shipNameOverride: "QA Aurora",
  cruiseLine: null,
  routeName: null,
  departurePort: null,
  arrivalPort: null,
  startDate: "2025-10-05T00:00:00.000Z",
  endDate: "2025-10-12T00:00:00.000Z",
  status: "flown",
  price: null,
  currency: "EUR",
  notes: null,
  tags: [],
  companions: [],
  tripId: null,
} as unknown as Cruise;

describe("CruiseDetailPage — unresolved ports", () => {
  it("names the unresolved ports in the figures and resolves them in place", async () => {
    getMock.mockResolvedValue({
      ...base,
      stops: [stop("s2", 2, { unresolvedPortName: "Colon" })],
    });
    // Every save recreates the stops: the same day comes back with a new id.
    updateMock.mockResolvedValue({
      ...base,
      stops: [stop("s2-new", 2, { portId: 77, port: { id: 77, name: "Colón" } as Port })],
    });
    render(
      <MemoryRouter initialEntries={["/cruises/cruise-1"]}>
        <Routes>
          <Route path="/cruises/:id" element={<CruiseDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText(/detail\.unresolvedKpi/)).toBeInTheDocument();
    // Open day 2's card first; it must stay open through the save (review M3).
    const row = screen
      .getAllByRole("button", { pressed: false })
      .find((r) => r.textContent?.includes("Colon"));
    await userEvent.click(row!);
    expect(await screen.findByRole("region", { name: /detail\.day 2/ })).toBeInTheDocument();
    const list = screen.getByRole("region", { name: "unresolved.title" });
    await within(list).findByRole("radio", { name: /Colón/ });
    await userEvent.click(within(list).getByRole("button", { name: "unresolved.confirm" }));

    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "unresolved.title" })).toBeNull()
    );
    expect(screen.queryByText(/detail\.unresolvedKpi/)).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("unresolved.done");
    expect(screen.getByRole("region", { name: /detail\.day 2/ })).toBeInTheDocument();
  });
});
