import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import JournalViewModal from "./JournalViewModal";
import type { TripJournalEntry } from "../../types";

// Mock i18next used by useTranslation hook — return the last key segment so
// assertions stay language-agnostic.
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

vi.mock("../../hooks/useLocale", () => ({
  useLocale: () => "en-US",
}));

function makeEntry(overrides: Partial<TripJournalEntry> = {}): TripJournalEntry {
  return {
    id: "j1",
    tripId: "t1",
    date: "2026-07-04T00:00:00.000Z",
    title: "Day 4 in Kyoto",
    body: "We saw **Fushimi Inari**.\n\n- torii gates\n- fox statues",
    mood: "🌟",
    weather: "☀ 24°C",
    createdAt: "2026-07-04T00:00:00.000Z",
    updatedAt: "2026-07-04T00:00:00.000Z",
    ...overrides,
  };
}

describe("JournalViewModal", () => {
  it("renders the entry title and meta", () => {
    render(<JournalViewModal entry={makeEntry()} onClose={vi.fn()} />);
    expect(screen.getByText("Day 4 in Kyoto")).toBeInTheDocument();
    expect(screen.getByText(/☀ 24°C/)).toBeInTheDocument();
  });

  it("renders markdown as HTML, not as literal syntax", () => {
    render(<JournalViewModal entry={makeEntry()} onClose={vi.fn()} />);
    // **Fushimi Inari** must become a <strong>, not literal asterisks.
    const strong = screen.getByText("Fushimi Inari");
    expect(strong.tagName).toBe("STRONG");
    expect(screen.queryByText(/\*\*Fushimi Inari\*\*/)).toBeNull();
    // The bullet list becomes real <li> items.
    expect(screen.getByText("torii gates").closest("li")).not.toBeNull();
  });

  it("opens external links in a new tab with a safe rel", () => {
    render(
      <JournalViewModal
        entry={makeEntry({ body: "See [the map](https://example.com/map)." })}
        onClose={vi.fn()}
      />
    );
    const link = screen.getByRole("link", { name: "the map" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<JournalViewModal entry={makeEntry()} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /journalView.close/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("falls back to the date as the heading when there is no title", () => {
    render(<JournalViewModal entry={makeEntry({ title: null })} onClose={vi.fn()} />);
    // No literal "null" heading; the dialog still renders the body.
    expect(screen.queryByText("null")).toBeNull();
    expect(screen.getByText("Fushimi Inari")).toBeInTheDocument();
  });
});
