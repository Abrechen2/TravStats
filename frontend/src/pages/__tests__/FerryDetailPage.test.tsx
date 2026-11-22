import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { ferryFixture } from "../../components/ferry/__tests__/ferryFixture";

/**
 * Ferry parity with the rail detail page: the crossing's route map, and the
 * trip photos taken on board — the strip only for a crossing on a trip.
 */
// The entry photo strip has its own suite; here it would reach the network.
vi.mock("../../components/common/EntryPhotos", () => ({
  default: () => null,
  EntryPhotos: () => null,
  EntryPhotosSection: () => null,
}));

vi.mock("../../components/ui/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/documents/DocumentsSection", () => ({ default: () => null }));
vi.mock("../../components/ferry/FerryLivePosition", () => ({ FerryLivePosition: () => null }));
vi.mock("../../components/ferry/FerryRoadtripLink", () => ({ FerryRoadtripLink: () => null }));
vi.mock("../../components/ferry/FerryFormModal", () => ({ FerryFormModal: () => null }));
vi.mock("../../components/ui/ConfirmModal", () => ({ default: () => null }));
vi.mock("../../hooks/useDocumentCount", () => ({ useDocumentCount: () => null }));
vi.mock("../../hooks/useToursVisible", () => ({ useToursVisible: () => false }));
vi.mock("../../components/ferry/FerryRouteMap", () => ({
  FerryRouteMap: ({ ride }: { ride: { id: string } }) => (
    <div data-testid="ferry-map-stub">{ride.id}</div>
  ),
}));
vi.mock("../../components/common/TripPhotoWindowStrip", () => ({
  default: ({ entry, id }: { entry: string; id: string }) => (
    <div data-testid="photo-strip-stub">{`${entry}:${id}`}</div>
  ),
}));
const get = vi.fn();
const clearManualRoute = vi.fn();
vi.mock("../../lib/api/ferry", () => ({
  ferryApi: {
    get: (...a: unknown[]) => get(...a),
    clearManualRoute: (...a: unknown[]) => clearManualRoute(...a),
  },
}));

import FerryDetailPage from "../FerryDetailPage";

const draw = () =>
  render(
    <MemoryRouter initialEntries={["/ferry/f1"]}>
      <Routes>
        <Route path="/ferry/:id" element={<FerryDetailPage />} />
      </Routes>
    </MemoryRouter>
  );

describe("FerryDetailPage — map and photos", () => {
  beforeEach(() => get.mockReset());

  it("draws the route map and the trip's on-board photos", async () => {
    get.mockResolvedValue(
      ferryFixture({ id: "f1", tripId: "t1", trip: { id: "t1", name: "Korea", color: "#000" } })
    );
    draw();
    await waitFor(() => expect(screen.getByTestId("ferry-map-stub").textContent).toBe("f1"));
    expect(screen.getByText("ferry:map.title")).toBeInTheDocument();
    expect(screen.getByTestId("photo-strip-stub").textContent).toBe("ferry:f1");
  });

  it("asks for no photos when the crossing is on no trip", async () => {
    get.mockResolvedValue(ferryFixture({ id: "f1", tripId: null, trip: null }));
    draw();
    await waitFor(() => expect(screen.getByTestId("ferry-map-stub")).toBeInTheDocument());
    expect(screen.queryByTestId("photo-strip-stub")).toBeNull();
  });

  // forgejo#396: tags were stored for a crossing and never shown.
  it("shows the crossing's tags", async () => {
    get.mockResolvedValue(ferryFixture({ id: "f1", tags: ["night", "harbour"] }));
    draw();
    expect(await screen.findByText("#night")).toBeInTheDocument();
    expect(screen.getByText("#harbour")).toBeInTheDocument();
  });

  it("keeps only Bearbeiten in the header and puts Entfernen last and red inside Mehr", async () => {
    get.mockResolvedValue(ferryFixture({ id: "f1", tripId: null, trip: null }));
    draw();
    await waitFor(() => expect(screen.getByTestId("ferry-map-stub")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "ferry:remove" })).toBeNull();
    expect(screen.getByRole("button", { name: "ferry:edit" })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("detail-more-menu"));
    const items = screen.getAllByRole("menuitem");
    expect(items[items.length - 1]?.textContent).toBe("ferry:remove");
    expect(items[items.length - 1]?.style.color).toBe("var(--ts-bad)");
  });

  it("keeps one visible 'Route bearbeiten' and puts the hand-route removal last, red and confirmed, in the route card's ⋯", async () => {
    get.mockResolvedValue(
      ferryFixture({ id: "f1", tripId: null, trip: null, geometrySource: "manual" })
    );
    draw();
    await waitFor(() => expect(screen.getByTestId("ferry-route-draw")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("ferry-route-menu"));
    const items = screen.getAllByRole("menuitem");
    expect(items[items.length - 1]?.textContent).toBe("ferry:routing.clear");
    expect(items[items.length - 1]?.style.color).toBe("var(--ts-bad)");
    fireEvent.click(items[items.length - 1]);
    // Asked first (the dialog is stubbed out here): nothing is cleared by the click itself.
    expect(clearManualRoute).not.toHaveBeenCalled();
  });
});
