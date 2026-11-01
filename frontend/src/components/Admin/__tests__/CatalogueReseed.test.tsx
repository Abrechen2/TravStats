import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const get = vi.fn();
const post = vi.fn();
vi.mock("../../../lib/api/client", () => ({
  api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, o?: Record<string, unknown>) => (o ? `${key}:${JSON.stringify(o)}` : key),
  }),
}));

import CatalogueReseed from "../CatalogueReseed";

const httpError = (status: number) =>
  Object.assign(new Error("x"), { isAxiosError: true, response: { status } });
const timeout = () => Object.assign(new Error("t"), { isAxiosError: true, code: "ECONNABORTED" });
const runButtons = () => screen.getAllByRole("button", { name: "catalogues.run" });

describe("CatalogueReseed (forgejo#397)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockResolvedValue({
      data: { status: "completed", totalAirports: 70000, processedAirports: 70000 },
    });
  });

  it("shows the airport seeding status on mount", async () => {
    render(<CatalogueReseed />);
    expect(await screen.findByTestId("airport-seeding-status")).toHaveTextContent(
      "status.completed"
    );
  });

  it("says the status could not be read instead of showing nothing", async () => {
    get.mockRejectedValue(new Error("500"));
    render(<CatalogueReseed />);
    expect(await screen.findByRole("alert")).toHaveTextContent("airports.statusFailed");
  });

  it("reports how many airlines were added", async () => {
    post.mockResolvedValue({ data: { inserted: 12 } });
    render(<CatalogueReseed />);
    await userEvent.click(runButtons()[1]);
    expect(post).toHaveBeenCalledWith(
      "/admin/airlines/reseed",
      {},
      expect.objectContaining({ timeout: expect.any(Number) })
    );
    expect(await screen.findByRole("status")).toHaveTextContent("airlines.done");
  });

  it("names the rate limit (429) rather than a generic failure", async () => {
    post.mockRejectedValue(httpError(429));
    render(<CatalogueReseed />);
    await userEvent.click(runButtons()[2]);
    expect(await screen.findByRole("alert")).toHaveTextContent("errors.rateLimited");
  });

  it("calls a timeout an unknown outcome, not a failure", async () => {
    post.mockRejectedValue(timeout());
    render(<CatalogueReseed />);
    await userEvent.click(runButtons()[1]);
    expect(await screen.findByRole("alert")).toHaveTextContent("errors.unknownOutcome");
  });

  it("starts the airport seeding and surfaces a failed seeding run", async () => {
    post.mockResolvedValue({ data: { statusId: 1 } });
    render(<CatalogueReseed />);
    await screen.findByTestId("airport-seeding-status");
    get.mockResolvedValue({ data: { status: "failed", error: "x" } });
    await userEvent.click(runButtons()[0]);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("airports.seedingFailed")
    );
  });
});
