import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" }, ready: true }),
}));
vi.mock("../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
let answer: () => Promise<unknown> = async () => null;
vi.mock("../../../lib/api/railRoutingAdmin", () => ({
  rerouteLocalTransit: () => answer(),
}));

import RailLocalTransitReroute from "../RailLocalTransitReroute";
import { JobFailedError, JobLostError } from "../../../lib/api/jobs";

const result = (over = {}) => ({
  total: 3,
  routed: 1,
  straight: 1,
  kept: 1,
  skipped: 0,
  stoppedBy: null,
  remaining: 0,
  ...over,
});
const start = () =>
  fireEvent.click(screen.getByRole("button", { name: "settings:railRouting.reroute.action" }));

describe("RailLocalTransitReroute", () => {
  it("names the tally when the pass is done", async () => {
    answer = async () => result();
    render(<RailLocalTransitReroute />);
    start();
    expect(await screen.findByText("settings:railRouting.reroute.done")).toBeTruthy();
  });

  it("says the pass stopped because the router went away, and what is left", async () => {
    answer = async () => result({ stoppedBy: "railRoutingUnavailable", remaining: 2 });
    render(<RailLocalTransitReroute />);
    start();
    expect(await screen.findByRole("status")).toHaveTextContent(
      "settings:railRouting.reroute.stopped"
    );
  });

  it.each([
    ["notConfigured", () => new JobFailedError("notConfigured", 409)],
    ["lost", () => new JobLostError()],
    [
      "alreadyRunning",
      () => Object.assign(new Error("409"), { response: { data: { code: "alreadyRunning" } } }),
    ],
    ["failed", () => new Error("Network Error")],
  ])("names a failure in words (%s)", async (key, error) => {
    answer = async () => {
      throw error();
    };
    render(<RailLocalTransitReroute />);
    start();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      `settings:railRouting.reroute.${key}`
    );
  });
});
