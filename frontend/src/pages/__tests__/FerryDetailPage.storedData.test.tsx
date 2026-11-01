import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { ferryFixture } from "../../components/ferry/__tests__/ferryFixture";

/**
 * forgejo#393: data the crossing stores but no view showed — the fare class,
 * the delay and the FX snapshot. Each appears when recorded and draws nothing
 * when it is absent (abstention: never "0" or a dash for an unknown).
 */
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

const FX = {
  price: 120,
  currency: "USD",
  priceBase: 110,
  fxRate: 0.917,
  fxRateDate: "2026-03-12",
  fxBaseCurrency: "EUR",
  fxSource: "ecb",
};

describe("FerryDetailPage — stored data (forgejo#393)", () => {
  beforeEach(() => get.mockReset());

  it("shows the fare class, the delay and the FX snapshot when they are stored", async () => {
    get.mockResolvedValue(ferryFixture({ id: "f1", fareClass: "Flex", delayMinutes: 25, ...FX }));
    draw();
    await screen.findByText("ferry:fareClass");
    expect(screen.getByText("Flex")).toBeInTheDocument();
    expect(screen.getByText("ferry:delayLabel")).toBeInTheDocument();
    expect(screen.getByText("ferry:delay")).toBeInTheDocument();
    expect(screen.getByText("common:fx.label")).toBeInTheDocument();
    expect(screen.getByText(/→.*common:fx\.ecb/)).toBeInTheDocument();
  });

  it("draws no fare class, delay or FX row when none is stored", async () => {
    get.mockResolvedValue(
      ferryFixture({ id: "f1", fareClass: null, delayMinutes: null, price: null })
    );
    draw();
    await waitFor(() => expect(screen.getByTestId("ferry-map-stub")).toBeInTheDocument());
    expect(screen.queryByText("ferry:fareClass")).toBeNull();
    expect(screen.queryByText("ferry:delayLabel")).toBeNull();
    expect(screen.queryByText("common:fx.label")).toBeNull();
  });

  it("says on time for a recorded delay of zero", async () => {
    get.mockResolvedValue(ferryFixture({ id: "f1", delayMinutes: 0 }));
    draw();
    expect(await screen.findByText("ferry:onTime")).toBeInTheDocument();
  });
});
