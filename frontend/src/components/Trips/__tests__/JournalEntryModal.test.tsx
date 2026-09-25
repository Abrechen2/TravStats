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
// The picker reads the gallery from the server; here it only reports a pick.
vi.mock("../JournalPhotoPicker", () => ({
  default: ({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) => (
    <button type="button" data-value={value.join(",")} onClick={() => onChange(["p2", "p1"])}>
      pick-photos
    </button>
  ),
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

  it("saves the photos picked for a new entry, in the order picked", async () => {
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
    fireEvent.click(screen.getByText("pick-photos"));
    fireEvent.click(screen.getByText("trips:journalModal.save"));

    await waitFor(() =>
      expect(tripsApi.createJournalEntry).toHaveBeenCalledWith(
        "t1",
        expect.objectContaining({ photoIds: ["p2", "p1"] })
      )
    );
  });

  it("starts an edit from the entry's photos and sends them back unchanged", async () => {
    vi.mocked(tripsApi.updateJournalEntry).mockResolvedValue(saved);
    const withPhotos: TripJournalEntry = {
      ...saved,
      photos: [
        {
          id: "p9",
          url: "/p/9",
          caption: null,
          takenAt: null,
          sortIdx: 0,
          mimetype: "image/jpeg",
          sizeBytes: 1,
          createdAt: "",
        },
      ],
    };
    render(
      <JournalEntryModal tripId="t1" entry={withPhotos} onClose={vi.fn()} onSaved={vi.fn()} />
    );
    expect(screen.getByText("pick-photos")).toHaveAttribute("data-value", "p9");
    fireEvent.click(screen.getByText("trips:journalModal.save"));

    await waitFor(() =>
      expect(tripsApi.updateJournalEntry).toHaveBeenCalledWith(
        "t1",
        "e1",
        expect.objectContaining({ photoIds: ["p9"] })
      )
    );
  });
});
