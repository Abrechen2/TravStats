import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ParseLogStats from "./ParseLogStats";

vi.mock("../../lib/api", () => ({
  trainingApi: {
    getParseLogStats: vi.fn().mockResolvedValue({
      totalLogs: 42,
      overallHitRate: 76,
      byAirline: [
        { airline: "Lufthansa", total: 20, hits: 16, hitRate: 80, commonMissingFields: ["price"] },
      ],
    }),
    exportParseLogs: vi.fn().mockResolvedValue(undefined),
    promoteCorrections: vi
      .fn()
      .mockResolvedValue({ promoted: 3, message: "3 corrections promoted" }),
  },
}));

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts?.count !== undefined) return `${opts.count} promoted`;
      return key;
    },
  }),
}));

vi.mock("../../store/toastStore", () => ({
  useToastStore: (selector: (state: { addToast: unknown }) => unknown) =>
    selector({ addToast: vi.fn() }),
}));

vi.mock("../../lib/logger", () => ({
  logger: { error: vi.fn() },
}));

describe("ParseLogStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders stats after loading", async () => {
    render(<ParseLogStats />);
    await waitFor(() => {
      expect(screen.getByText("42")).toBeInTheDocument();
    });
    expect(screen.getByText("76%")).toBeInTheDocument();
    expect(screen.getByText("Lufthansa")).toBeInTheDocument();
  });

  it("calls exportParseLogs when export button clicked", async () => {
    const { trainingApi } = await import("../../lib/api");
    render(<ParseLogStats />);
    await waitFor(() => screen.getByText("42"));

    const exportBtn = screen.getByTestId("export-parse-logs-btn");
    await userEvent.click(exportBtn);
    expect(trainingApi.exportParseLogs).toHaveBeenCalled();
  });

  it("calls promoteCorrections when promote button clicked", async () => {
    const { trainingApi } = await import("../../lib/api");
    render(<ParseLogStats />);
    await waitFor(() => screen.getByText("42"));

    const promoteBtn = screen.getByTestId("promote-corrections-btn");
    await userEvent.click(promoteBtn);
    await waitFor(() => expect(trainingApi.promoteCorrections).toHaveBeenCalled());
  });
});
