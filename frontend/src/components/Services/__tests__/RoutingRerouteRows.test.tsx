import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o && "count" in o ? `${k}:${String(o.count)}` : k,
    i18n: { language: "de" },
    ready: true,
  }),
}));
vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../Settings/RailLocalTransitReroute", () => ({
  default: () => <div>rail-reroute</div>,
}));
const start = vi.fn();
vi.mock("../../../lib/api/rerouteRuns", () => ({
  adminRerouteApi: { latest: async () => null, start: (m: string) => start(m), cancel: vi.fn() },
}));

import RoutingRerouteRows from "../RoutingRerouteRows";

const run = {
  id: "r1",
  scope: "instance",
  routeId: null,
  mode: "all",
  status: "running",
  total: 5,
  processed: 0,
  routed: 0,
  kept: 0,
  failureCounts: {},
  failureSample: [],
  stopReason: null,
  resumeAfter: null,
  createdAt: "2026-11-22T10:00:00.000Z",
  finishedAt: null,
};

describe("RoutingRerouteRows", () => {
  it("starts with 'only straight lines' by default and sends 'all' when chosen", async () => {
    start.mockResolvedValue(run);
    render(<RoutingRerouteRows withRail={false} />);
    fireEvent.click(screen.getByRole("button", { name: "routing:admin.start" }));
    await waitFor(() => expect(start).toHaveBeenLastCalledWith("straight"));
    expect(await screen.findByTestId("routing-reroute-run")).toBeTruthy();
  });

  it("sends 'all' once that choice is made", async () => {
    start.mockResolvedValue(run);
    render(<RoutingRerouteRows withRail={false} />);
    fireEvent.click(screen.getByRole("radio", { name: "routing:admin.modeAll" }));
    fireEvent.click(screen.getByRole("button", { name: "routing:admin.start" }));
    await waitFor(() => expect(start).toHaveBeenLastCalledWith("all"));
  });

  it("carries the rail re-route beside it only where the rail router is entered", () => {
    const { rerender } = render(<RoutingRerouteRows withRail={false} />);
    expect(screen.queryByText("rail-reroute")).toBeNull();
    rerender(<RoutingRerouteRows withRail />);
    expect(screen.getByText("rail-reroute")).toBeTruthy();
  });
});
