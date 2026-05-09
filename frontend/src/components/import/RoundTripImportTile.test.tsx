import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RoundTripImportTile } from "./RoundTripImportTile";

vi.mock("../../lib/api/client", () => ({
  api: {
    post: vi.fn().mockResolvedValue({ data: { count: 0 } }),
    put: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

vi.mock("../../store/settingsStore", () => ({
  useSettingsStore: Object.assign(
    vi.fn(() => ({ display: { language: "en", timezone: "UTC" } })),
    {
      getState: vi.fn(() => ({ display: { timezone: "UTC" } })),
    }
  ),
}));

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "settings:import.tile.roundTrip.title": "Re-import TravStats (round-trip)",
        "settings:import.tile.roundTrip.description":
          "Round-trip XLSX/CSV/JSON exported from TravStats.",
        "settings:import.tile.roundTrip.uploadLabel": "Choose .xlsx / .csv / .json",
        "common:loading": "Loading…",
      };
      return map[key] ?? key;
    },
    i18n: { language: "en" },
  }),
}));

describe("RoundTripImportTile", () => {
  it("renders the upload control", () => {
    render(<RoundTripImportTile />);
    expect(screen.getAllByText(/round-trip/i).length).toBeGreaterThan(0);
  });

  it("rejects unsupported extensions", async () => {
    render(<RoundTripImportTile />);
    const input = screen.getByLabelText(/choose/i) as HTMLInputElement;
    const file = new File(["x"], "foo.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText(/unsupported/i)).toBeInTheDocument();
  });
});
