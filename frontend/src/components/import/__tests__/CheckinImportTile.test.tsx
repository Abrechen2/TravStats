import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const send = vi.hoisted(() => vi.fn());
const logError = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/api/checkinImport", async (orig) => ({
  ...(await orig<typeof import("../../../lib/api/checkinImport")>()),
  sendCheckinImport: send,
}));
vi.mock("../../../lib/logger", () => ({
  logger: { error: logError, warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k}|${JSON.stringify(o)}` : k),
    i18n: { language: "de" },
  }),
}));

import { CheckinImportTile } from "../CheckinImportTile";
import { CheckinImportError } from "../../../lib/api/checkinImport";

const rowOf = (row: number, action: string, label: string, message?: string) => ({
  row,
  action,
  id: null,
  label,
  message,
});
const OUTCOME = {
  dryRun: true,
  mode: "add",
  clean: false,
  backupId: null,
  sheets: [
    {
      key: "rail",
      created: 1,
      updated: 0,
      skipped: 1,
      errors: 2,
      deleted: 0,
      rows: [
        rowOf(1, "create", "ICE 901 Alpha Hbf → Beta Hbf"),
        rowOf(2, "skip", "RE 5 Alpha Hbf → Beta Hbf", "duplicate_in_file"),
        rowOf(3, "error", "#3", "not_a_journey"),
        rowOf(4, "error", "Fähre A → B", "unsupported_mode:ferry"),
      ],
    },
  ],
};

function pick(content: string): void {
  const file = new File([content], "export.json", { type: "application/json" });
  // jsdom's File has no text(); the tile reads the file through it.
  Object.defineProperty(file, "text", { value: () => Promise.resolve(content) });
  fireEvent.change(screen.getByLabelText("settings:import.tile.checkin.uploadLabel"), {
    target: { files: [file] },
  });
}

beforeEach(() => {
  send.mockReset();
  logError.mockReset();
});

describe("CheckinImportTile — preview, then commit", () => {
  it("shows counts, skips and each unreadable row with its reason, and commits the held text", async () => {
    send.mockResolvedValueOnce(OUTCOME).mockResolvedValueOnce({ ...OUTCOME, dryRun: false });
    const onImported = vi.fn();
    render(<CheckinImportTile onImported={onImported} />);
    fireEvent.change(screen.getByTestId("checkin-source"), { target: { value: "travelynx" } });
    pick('{"journeys":[]}');

    await waitFor(() => expect(screen.getByTestId("checkin-outcome")).toBeInTheDocument());
    expect(send).toHaveBeenCalledWith("travelynx", '{"journeys":[]}', true);
    expect(
      screen.getByText(/xlsx:import.counts.*"created":1.*"skipped":1.*"errors":2/)
    ).toBeInTheDocument();
    expect(screen.getByText(/xlsx:import.errors.not_a_journey/)).toBeInTheDocument();
    expect(
      screen.getByText(/unsupported_mode.*ferry/)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("xlsx:import.apply"));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send).toHaveBeenLastCalledWith("travelynx", '{"journeys":[]}', false);
    await waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(screen.getByText("xlsx:import.applied")).toBeInTheDocument();
  });

  it("offers no apply for a file where nothing can be created", async () => {
    send.mockResolvedValueOnce({
      ...OUTCOME,
      sheets: [{ ...OUTCOME.sheets[0], created: 0, skipped: 0, errors: 1, rows: [] }],
    });
    render(<CheckinImportTile />);
    pick("x");
    await waitFor(() => expect(screen.getByTestId("checkin-outcome")).toBeInTheDocument());
    expect(screen.getByText("xlsx:import.apply")).toBeDisabled();
    expect(screen.getByText("settings:import.tile.checkin.nothingImportable")).toBeInTheDocument();
  });
});

describe("CheckinImportTile — failures reach the user as themselves", () => {
  it.each([
    ["tooMany", 'xlsx:import.importTooManyRows|{"max":5000}'],
    ["network", "settings:import.tile.checkin.network"],
    ["invalid", "settings:import.tile.checkin.failed"],
    ["rateLimited", "settings:import.tile.checkin.rateLimited"],
  ] as const)("a %s failure on the preview says so and logs the cause", async (kind, copy) => {
    const cause = new CheckinImportError(kind);
    send.mockRejectedValueOnce(cause);
    render(<CheckinImportTile />);
    pick("x");
    await waitFor(() => expect(screen.getByText(copy)).toBeInTheDocument());
    expect(logError).toHaveBeenCalledWith(expect.any(String), cause);
    expect(screen.queryByTestId("checkin-outcome")).toBeNull();
  });

  it("an apply whose outcome is unknown says so and keeps the preview for a retry", async () => {
    send
      .mockResolvedValueOnce(OUTCOME)
      .mockRejectedValueOnce(new CheckinImportError("outcomeUnknown"));
    render(<CheckinImportTile />);
    pick("x");
    await waitFor(() => expect(screen.getByTestId("checkin-outcome")).toBeInTheDocument());
    fireEvent.click(screen.getByText("xlsx:import.apply"));
    await waitFor(() => expect(screen.getByText("xlsx:import.outcomeUnknown")).toBeInTheDocument());
    expect(screen.getByText("xlsx:import.apply")).toBeEnabled();
  });
});
