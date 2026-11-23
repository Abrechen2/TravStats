import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

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
const status = vi.fn();
const start = vi.fn();
vi.mock("../../../lib/api/rerouteRuns", () => ({
  railRerouteApi: {
    status: () => status(),
    start: (m: string) => start(m),
    cancel: vi.fn(),
  },
}));

import RailRerouteRows from "../RailRerouteRows";

const run = {
  id: "r1",
  scope: "rail",
  routeId: null,
  mode: "straight",
  status: "running",
  total: 3,
  processed: 0,
  routed: 0,
  kept: 0,
  failureCounts: {},
  failureSample: [],
  stopReason: null,
  resumeAfter: null,
  createdAt: "2026-11-23T10:00:00.000Z",
  finishedAt: null,
};

describe("RailRerouteRows", () => {
  it("says how many rides are straight lines for want of a router, and offers no start", async () => {
    status.mockResolvedValue({ run: null, straightJourneys: 385, routerConfigured: false });
    render(<RailRerouteRows railUrl={null} />);
    expect((await screen.findByTestId("rail-reroute-readiness")).textContent).toBe(
      "routing:rail.readiness:385"
    );
    const button = screen.getByRole("button", { name: "routing:rail.start" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("starts with only the straight lines by default", async () => {
    status.mockResolvedValue({ run: null, straightJourneys: 4, routerConfigured: true });
    start.mockResolvedValue(run);
    render(<RailRerouteRows railUrl="http://orr" />);
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "routing:rail.start" }) as HTMLButtonElement).disabled
      ).toBe(false)
    );
    fireEvent.click(screen.getByRole("button", { name: "routing:rail.start" }));
    await waitFor(() => expect(start).toHaveBeenLastCalledWith("straight"));
    expect(await screen.findByTestId("rail-reroute-run")).toBeTruthy();
  });

  it("offers to route every straight line right after an address is saved", async () => {
    status.mockResolvedValue({ run: null, straightJourneys: 385, routerConfigured: false });
    start.mockResolvedValue(run);
    const { rerender } = render(<RailRerouteRows railUrl={null} />);
    await screen.findByTestId("rail-reroute-readiness");
    status.mockResolvedValue({ run: null, straightJourneys: 385, routerConfigured: true });
    await act(async () => {
      rerender(<RailRerouteRows railUrl="http://orr.lan:8989" />);
    });
    const offer = await screen.findByTestId("rail-reroute-offer");
    expect(offer.textContent).toBe("routing:rail.offer:385");
    fireEvent.click(screen.getByRole("button", { name: "routing:rail.offerAction" }));
    await waitFor(() => expect(start).toHaveBeenLastCalledWith("straight"));
  });

  it("follows a removed address: the note returns and the start button locks", async () => {
    status.mockResolvedValue({ run: null, straightJourneys: 3, routerConfigured: true });
    const { rerender } = render(<RailRerouteRows railUrl="http://orr" />);
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "routing:rail.start" }) as HTMLButtonElement).disabled
      ).toBe(false)
    );
    status.mockResolvedValue({ run: null, straightJourneys: 3, routerConfigured: false });
    await act(async () => {
      rerender(<RailRerouteRows railUrl={null} />);
    });
    expect(await screen.findByTestId("rail-reroute-readiness")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "routing:rail.start" }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it("shows a refused start in words instead of nothing", async () => {
    status.mockResolvedValue({ run: null, straightJourneys: 2, routerConfigured: true });
    start.mockRejectedValue(new Error("boom"));
    render(<RailRerouteRows railUrl="http://orr" />);
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "routing:rail.start" }) as HTMLButtonElement).disabled
      ).toBe(false)
    );
    fireEvent.click(screen.getByRole("button", { name: "routing:rail.start" }));
    expect(await screen.findByText("routing:rail.failed")).toBeTruthy();
  });
});
