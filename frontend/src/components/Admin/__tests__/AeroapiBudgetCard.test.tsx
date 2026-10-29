import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AeroapiBudgetCard from "../AeroapiBudgetCard";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  t: (key: string, opts?: Record<string, unknown>) =>
    opts ? `${key}|${JSON.stringify(opts)}` : key,
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: mocks.t, i18n: { language: "en" } }),
}));
vi.mock("../../../lib/api/aeroapi", () => ({
  aeroapiApi: { get: mocks.get, update: mocks.update },
}));

const settings = (over: Record<string, unknown> = {}) => ({
  tier: "personal",
  customBudgetUsd: null,
  tracksEnabled: false,
  usage: { month: "2026-10", spentUsd: 1.5, budgetUsd: 5, calls: 300, exhausted: false },
  costUsd: { flights: 0.005, track: 0.01 },
  lastTrackSweep: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(settings());
});

/** forgejo#409: AeroAPI plan, monthly budget and the opt-in track switch. */
describe("AeroapiBudgetCard", () => {
  it("shows what is spent against the budget", async () => {
    render(<AeroapiBudgetCard />);
    const usage = await screen.findByTestId("aeroapi-usage");
    expect(usage).toHaveTextContent("$1.50");
    expect(usage).toHaveTextContent("$5.00");
  });

  it("says when the budget is reached instead of staying silent", async () => {
    mocks.get.mockResolvedValue(
      settings({
        usage: { month: "2026-10", spentUsd: 5, budgetUsd: 5, calls: 1000, exhausted: true },
      })
    );
    render(<AeroapiBudgetCard />);
    expect(await screen.findByTestId("aeroapi-exhausted")).toHaveTextContent(
      "admin:aeroapi.exhausted"
    );
  });

  it("saves the feeder tier", async () => {
    mocks.update.mockResolvedValue(settings({ tier: "personal_feeder" }));
    render(<AeroapiBudgetCard />);
    fireEvent.change(await screen.findByLabelText("admin:aeroapi.tier"), {
      target: { value: "personal_feeder" },
    });
    fireEvent.click(screen.getByRole("button", { name: "admin:aeroapi.save" }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({ tier: "personal_feeder", customBudgetUsd: null })
    );
  });

  it("names a refused custom budget instead of a generic failure", async () => {
    mocks.update.mockRejectedValue({ response: { data: { code: "AEROAPI_BUDGET_REQUIRED" } } });
    render(<AeroapiBudgetCard />);
    fireEvent.change(await screen.findByLabelText("admin:aeroapi.tier"), {
      target: { value: "custom" },
    });
    fireEvent.click(screen.getByRole("button", { name: "admin:aeroapi.save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("admin:aeroapi.budgetRequired");
  });

  it("switches the track fetch on and shows why the last sweep stopped", async () => {
    mocks.get.mockResolvedValue(
      settings({
        tracksEnabled: true,
        lastTrackSweep: {
          at: "2026-10-29T10:17:00.000Z",
          status: "stopped_budget",
          counts: { error: 1 },
        },
      })
    );
    mocks.update.mockResolvedValue(settings({ tracksEnabled: false }));
    render(<AeroapiBudgetCard />);
    expect(await screen.findByTestId("aeroapi-sweep")).toHaveTextContent(
      "admin:aeroapi.sweep.status.stopped_budget"
    );
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ tracksEnabled: false }));
  });
});
