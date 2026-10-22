import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { ferryFixture } from "../../components/ferry/__tests__/ferryFixture";

/**
 * Ferry parity with the rail detail page: the crossing's route map, and the
 * trip photos taken on board — the strip only for a crossing on a trip.
 */
vi.mock("../../components/ui/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/documents/DocumentsSection", () => ({ default: () => null }));
vi.mock("../../components/ferry/FerryLivePosition", () => ({ FerryLivePosition: () => null }));
vi.mock("../../components/ferry/FerryRoadtripLink", () => ({ FerryRoadtripLink: () => null }));
vi.mock("../../components/ferry/FerryFormModal", () => ({ FerryFormModal: () => null }));
vi.mock("../../components/Training/ConfirmModal", () => ({ default: () => null }));
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
vi.mock("../../lib/api/ferry", () => ({ ferryApi: { get: (...a: unknown[]) => get(...a) } }));

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
});
