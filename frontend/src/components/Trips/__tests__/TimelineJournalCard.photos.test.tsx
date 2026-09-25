import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { JournalCard } from "../TimelineJournalCard";
import type { TripJournalEntry } from "../../../types";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

const entry: TripJournalEntry = {
  id: "e1",
  tripId: "t1",
  date: "2024-07-15T00:00:00.000Z",
  title: "Tram 28",
  body: "Up the hill.",
  mood: null,
  weather: null,
  photos: [
    {
      id: "p1",
      url: "/api/v1/trips/t1/photos/p1/file",
      caption: null,
      takenAt: null,
      sortIdx: 0,
      mimetype: "image/jpeg",
      sizeBytes: 1,
      createdAt: "",
    },
  ],
  createdAt: "",
  updatedAt: "",
};

/** Package 9, item 5: the timeline entry shows the photos its author picked. */
describe("JournalCard photos", () => {
  it("shows the entry's photos when the entry is opened", async () => {
    render(
      <JournalCard
        ev={{ id: "j-e1", kind: "journal", date: entry.date, entry } as never}
        language="de"
        onView={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    await userEvent.click(screen.getByText("Tram 28"));
    expect(screen.getByRole("img")).toHaveAttribute("src", "/api/v1/trips/t1/photos/p1/file");
  });
});
