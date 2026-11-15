import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const send = vi.hoisted(() => vi.fn());
const logError = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/api/appImport", async (orig) => ({
  ...(await orig<typeof import("../../../lib/api/appImport")>()),
  sendAppImport: send,
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

import { AppImportTile } from "../AppImportTile";
import { AppImportError } from "../../../lib/api/appImport";

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
      key: "flights",
      created: 1,
      updated: 0,
      skipped: 1,
      errors: 2,
      deleted: 0,
      rows: [
        rowOf(1, "create", "LH400 FRA-JFK"),
        rowOf(2, "skip", "LH401 JFK-FRA", "exists"),
        rowOf(3, "error", "#3", "missing_flight_number"),
        rowOf(4, "error", "Car #1", "unsupported_object:car"),
      ],
    },
  ],
};

function pick(content: string): void {
  const file = new File([content], "export.csv", { type: "application/json" });
  // jsdom's File has no text(); the tile reads the file through it.
  Object.defineProperty(file, "text", { value: () => Promise.resolve(content) });
  fireEvent.change(screen.getByLabelText("settings:import.tile.appImport.uploadLabel"), {
    target: { files: [file] },
  });
}

beforeEach(() => {
  send.mockReset();
  logError.mockReset();
});

describe("AppImportTile — preview, then commit", () => {
  it("shows counts, skips and each unreadable row with its reason, and commits the held text", async () => {
    send.mockResolvedValueOnce(OUTCOME).mockResolvedValueOnce({ ...OUTCOME, dryRun: false });
    const onImported = vi.fn();
    render(<AppImportTile onImported={onImported} />);
    fireEvent.change(screen.getByTestId("app-import-source"), { target: { value: "jetlovers" } });
    pick("Date,Flight,From,To");

    await waitFor(() => expect(screen.getByTestId("app-import-outcome")).toBeInTheDocument());
    expect(send).toHaveBeenCalledWith("jetlovers", "Date,Flight,From,To", true);
    expect(
      screen.getByText(/xlsx:import.counts.*"created":1.*"skipped":1.*"errors":2/)
    ).toBeInTheDocument();
    expect(screen.getByText(/xlsx:import.errors.missing_flight_number/)).toBeInTheDocument();
    expect(screen.getByText(/xlsx:import.errors.unsupported_object.*car/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("xlsx:import.apply"));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send).toHaveBeenLastCalledWith("jetlovers", "Date,Flight,From,To", false);
    await waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(screen.getByText("xlsx:import.applied")).toBeInTheDocument();
  });

  it("offers no apply for a file where nothing can be created", async () => {
    send.mockResolvedValueOnce({
      ...OUTCOME,
      sheets: [{ ...OUTCOME.sheets[0], created: 0, skipped: 0, errors: 1, rows: [] }],
    });
    render(<AppImportTile />);
    pick("x");
    await waitFor(() => expect(screen.getByTestId("app-import-outcome")).toBeInTheDocument());
    expect(screen.getByText("xlsx:import.apply")).toBeDisabled();
    expect(
      screen.getByText("settings:import.tile.appImport.nothingImportable")
    ).toBeInTheDocument();
  });
});

describe("AppImportTile — failures reach the user as themselves", () => {
  it.each([
    ["tooMany", 'xlsx:import.importTooManyRows|{"max":5000}'],
    ["network", "settings:import.tile.appImport.network"],
    ["invalid", "settings:import.tile.appImport.failed"],
    ["rateLimited", "settings:import.tile.appImport.rateLimited"],
  ] as const)("a %s failure on the preview says so and logs the cause", async (kind, copy) => {
    const cause = new AppImportError(kind);
    send.mockRejectedValueOnce(cause);
    render(<AppImportTile />);
    pick("x");
    await waitFor(() => expect(screen.getByText(copy)).toBeInTheDocument());
    expect(logError).toHaveBeenCalledWith(expect.any(String), cause);
    expect(screen.queryByTestId("app-import-outcome")).toBeNull();
  });

  it("an apply whose outcome is unknown says so and offers no retry", async () => {
    send.mockResolvedValueOnce(OUTCOME).mockRejectedValueOnce(new AppImportError("outcomeUnknown"));
    render(<AppImportTile />);
    pick("x");
    await waitFor(() => expect(screen.getByTestId("app-import-outcome")).toBeInTheDocument());
    fireEvent.click(screen.getByText("xlsx:import.apply"));
    await waitFor(() => expect(screen.getByText("xlsx:import.outcomeUnknown")).toBeInTheDocument());
    // No second job alongside one that may still be writing.
    expect(screen.queryByText("xlsx:import.apply")).toBeNull();
  });
});
