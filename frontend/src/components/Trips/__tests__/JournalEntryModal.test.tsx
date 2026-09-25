import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import JournalEntryModal from "../JournalEntryModal";
import { useSettingsStore } from "../../../store/settingsStore";
import type { TripJournalEntry } from "../../../types";

vi.unmock("../../../store/settingsStore");
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../../lib/api", () => ({
  tripsApi: { createJournalEntry: vi.fn(), updateJournalEntry: vi.fn() },
}));

const saved: TripJournalEntry = {
  id: "e1",
  tripId: "t1",
  date: "2024-07-15T00:00:00.000Z",
  title: null,
  body: "x",
  mood: null,
  weather: null,
  observedWeather: null,
  createdAt: "",
  updatedAt: "",
};

describe("JournalEntryModal", () => {
  beforeEach(() => {
    useSettingsStore.setState({ openDataEnabled: true });
  });

  it("offers to fetch the weather of a saved entry's day", () => {
    render(<JournalEntryModal tripId="t1" entry={saved} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByRole("button", { name: "openData:weather.fetchOne" })).toBeInTheDocument();
  });
});
