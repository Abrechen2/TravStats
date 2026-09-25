import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import JournalEntryModal from "../JournalEntryModal";
import { tripsApi } from "../../../lib/api";
import { useSettingsStore } from "../../../store/settingsStore";
import type { TripJournalEntry } from "../../../types";

vi.unmock("../../../store/settingsStore");
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../../lib/api", () => ({
  tripsApi: { createJournalEntry: vi.fn(), updateJournalEntry: vi.fn() },
}));
vi.mock("@/hooks/useJournalMoods", () => ({ useJournalMoods: () => ["🙂", "müde"] }));

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

  it("offers the moods written before, and a picked one is saved", async () => {
    vi.mocked(tripsApi.createJournalEntry).mockResolvedValue(saved);
    render(
      <JournalEntryModal
        tripId="t1"
        entry={null}
        defaultDate="2024-07-15"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    fireEvent.change(screen.getByPlaceholderText("trips:journalModal.bodyPlaceholder"), {
      target: { value: "Ein Tag" },
    });
    fireEvent.click(screen.getByText("müde"));
    fireEvent.click(screen.getByText("trips:journalModal.save"));

    await waitFor(() =>
      expect(tripsApi.createJournalEntry).toHaveBeenCalledWith(
        "t1",
        expect.objectContaining({ mood: "müde" })
      )
    );
  });
});
