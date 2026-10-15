import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { RailRouteRefresh } from "../RailRouteRefresh";
import { railApi } from "../../../lib/api/rail";
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, args?: { reason?: string }) => key + (args?.reason ?? ""),
  }),
}));
vi.mock("../../../lib/api/rail", () => ({ railApi: { route: vi.fn() } }));

describe("explicit route refresh", () => {
  it.each(["openrailrouting", "transitous", "brouter", "straight"])(
    "refreshes an existing %s route and remains available after success",
    async (source) => {
      vi.mocked(railApi.route).mockResolvedValue({
        journey: {} as never,
        geometry: { outcome: "routed", geometrySource: "openrailrouting", fallback: null },
      });
      const updated = vi.fn();
      const { rerender } = render(
        <RailRouteRefresh id="ride" source={source} onUpdated={updated} />
      );
      fireEvent.click(screen.getByRole("button"));
      await waitFor(() => expect(updated).toHaveBeenCalledOnce());
      rerender(<RailRouteRefresh id="ride" source="openrailrouting" onUpdated={updated} />);
      expect(screen.getByRole("button")).toBeEnabled();
    }
  );
  it("does not offer automatic replacement of a manual route", () => {
    render(<RailRouteRefresh id="ride" source="manual" onUpdated={vi.fn()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("shows the reason when the provider cannot route, instead of a success message", async () => {
    vi.mocked(railApi.route).mockResolvedValue({
      journey: {} as never,
      geometry: {
        outcome: "straight",
        geometrySource: "straight",
        fallback: "railRoutingNotConfigured",
      },
    });
    const updated = vi.fn();
    render(<RailRouteRefresh id="ride" source="straight" onUpdated={updated} />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent(
      "rail:geometryNotice.reason.railRoutingNotConfigured"
    );
    expect(railApi.route).toHaveBeenCalledWith("ride");
    expect(updated).not.toHaveBeenCalled();
  });
  it.each([
    [429, "rateLimited"],
    [409, "conflict"],
    [403, "denied"],
    [404, "missing"],
    [undefined, "network"],
  ])("explains HTTP %s without losing the journey", async (status, reason) => {
    vi.mocked(railApi.route).mockRejectedValue({
      isAxiosError: true,
      response: status ? { status } : undefined,
    });
    const updated = vi.fn();
    render(<RailRouteRefresh id="ride" source="straight" onUpdated={updated} />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(`rail:routeRefresh.${reason}`)
    );
    expect(updated).not.toHaveBeenCalled();
  });
});
