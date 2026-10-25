import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({
  routeSnapshot: vi.fn(),
  shareRoute: vi.fn(),
  revokeRoute: vi.fn(),
}));
vi.mock("../../../lib/api/travtrack", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/travtrack")>()),
  travTrackApi: api,
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key} ${JSON.stringify(opts)}` : key,
  }),
}));
vi.mock("../../../lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

import ShareRouteDialog from "../ShareRouteDialog";

/**
 * "Route mitteilen" (TravTrack plan T7): the owner shares a trip's TravTrack
 * line as a snapshot, refreshes it and takes it back. Nothing is shared
 * until asked; a refusal is said in its own words.
 */

const SNAPSHOT = {
  version: 1,
  pointCount: 12,
  createdAt: "2026-10-12T03:00:00Z",
  geometry: [
    [
      [127, 37.5],
      [127.01, 37.5],
    ],
  ],
};

const refusal = (code: string) =>
  Object.assign(new Error(code), { response: { status: 409, data: { code } } });

describe("ShareRouteDialog", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
  });

  const open = () => render(<ShareRouteDialog open onClose={() => {}} tripId="trip-1" />);

  it("says nothing is shared yet and shares on request", async () => {
    api.routeSnapshot.mockResolvedValue(null);
    api.shareRoute.mockResolvedValue(SNAPSHOT);
    open();
    expect(await screen.findByText("sharing:route.notShared")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "sharing:route.share" }));
    await waitFor(() => expect(api.shareRoute).toHaveBeenCalledWith("trip-1"));
    expect(
      await screen.findByText('sharing:route.shared {"count":12}', { exact: false })
    ).toBeInTheDocument();
  });

  it("refreshes and revokes a shared route", async () => {
    api.routeSnapshot.mockResolvedValue(SNAPSHOT);
    api.shareRoute.mockResolvedValue({ ...SNAPSHOT, version: 2 });
    api.revokeRoute.mockResolvedValue(undefined);
    open();
    fireEvent.click(await screen.findByRole("button", { name: "sharing:route.refresh" }));
    await waitFor(() => expect(api.shareRoute).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole("button", { name: "sharing:route.revoke" }));
    await waitFor(() => expect(api.revokeRoute).toHaveBeenCalledWith("trip-1"));
    expect(await screen.findByText("sharing:route.notShared")).toBeInTheDocument();
  });

  it("names a route with nothing to show, and shares nothing", async () => {
    api.routeSnapshot.mockResolvedValue(null);
    api.shareRoute.mockRejectedValue(refusal("TRAVTRACK_ROUTE_EMPTY"));
    open();
    fireEvent.click(await screen.findByRole("button", { name: "sharing:route.share" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("sharing:route.errors.empty");
    expect(screen.getByText("sharing:route.notShared")).toBeInTheDocument();
  });

  it("names the build limit instead of a generic failure, and keeps the shared route", async () => {
    api.routeSnapshot.mockResolvedValue(SNAPSHOT);
    api.shareRoute.mockRejectedValue(
      Object.assign(new Error("429"), {
        response: {
          status: 429,
          data: { code: "TRAVTRACK_ROUTE_BUILD_RATE_LIMITED", retryAfterSeconds: 120 },
        },
      })
    );
    open();
    fireEvent.click(await screen.findByRole("button", { name: "sharing:route.refresh" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("sharing:route.errors.rateLimited");
    expect(screen.getByRole("button", { name: "sharing:route.revoke" })).toBeInTheDocument();
  });

  it("says TravTrack is off instead of pretending nothing is shared", async () => {
    api.routeSnapshot.mockRejectedValue(
      Object.assign(new Error("off"), {
        response: { status: 403, data: { code: "TRAVTRACK_DISABLED" } },
      })
    );
    open();
    expect(await screen.findByRole("alert")).toHaveTextContent("sharing:route.errors.disabled");
    expect(screen.queryByText("sharing:route.notShared")).toBeNull();
  });
});
