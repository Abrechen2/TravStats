import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, renderHook, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Layer } from "@deck.gl/core";

const list = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/api/rental", () => ({ rentalApi: { list } }));
vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

import { useRentalOverlay } from "../rentalMapOverlay";

const t = (k: string): string => k;
const drawnCount = (layers: readonly Layer[]): number =>
  layers.reduce((n, l) => n + ((l.props.data as unknown[] | undefined)?.length ?? 0), 0);
const RENTAL = {
  id: "r1",
  provider: "Testcar",
  pickupStationName: "Oslo",
  returnStationName: "Oslo",
  pickupLat: 59.9,
  pickupLon: 10.7,
  returnLat: 59.9,
  returnLon: 10.7,
  oneWay: false,
  routeId: null,
  status: "completed",
};

// beta.22 UAT: a failed rental load was caught into an empty list, so the
// "Alle" map drew no rental and said nothing — failure looked like "none".
describe("useRentalOverlay — a failed load", () => {
  beforeEach(() => list.mockReset());

  it("says the rentals could not be loaded, and draws them after a retry", async () => {
    list.mockRejectedValueOnce(new Error("503")).mockResolvedValue({ rentals: [RENTAL], total: 1 });
    const { result } = renderHook(() => useRentalOverlay(true, false, t));
    await waitFor(() => expect(result.current.status).not.toBeNull());
    expect(drawnCount(result.current.layers)).toBe(0);

    render(<>{result.current.status}</>);
    expect(screen.getByRole("alert")).toHaveTextContent("map:loadFailed.rentals");
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "map:loadFailed.retry" }));
    });
    await waitFor(() => expect(drawnCount(result.current.layers)).toBeGreaterThan(0));
    expect(result.current.status).toBeNull();
  });

  it("says nothing when the account simply has no rentals", async () => {
    list.mockResolvedValue({ rentals: [], total: 0 });
    const { result } = renderHook(() => useRentalOverlay(true, false, t));
    await waitFor(() => expect(list).toHaveBeenCalled());
    await act(async () => undefined);
    expect(result.current.status).toBeNull();
  });
});
