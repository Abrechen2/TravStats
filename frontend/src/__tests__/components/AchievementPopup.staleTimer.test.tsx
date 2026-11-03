import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import AchievementPopup from "../../components/AchievementPopup";

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const make = (id: string, name: string) => ({
  id,
  achievementId: id,
  progress: 100,
  unlockedAt: "2026-01-01T00:00:00Z",
  achievement: {
    id,
    code: id,
    name,
    description: "d",
    icon: "*",
    tier: "gold" as const,
    category: "c",
    points: 10,
  },
});

describe("AchievementPopup auto-advance timer", () => {
  afterEach(() => vi.useRealTimers());

  it("advances to an achievement that arrived after the timer was scheduled, instead of closing on a stale length", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const first = make("a", "First");
    const { rerender } = render(<AchievementPopup achievements={[first]} onClose={onClose} />);
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    rerender(<AchievementPopup achievements={[first, make("b", "Second")]} onClose={onClose} />);
    act(() => {
      vi.advanceTimersByTime(4000 + 300);
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Second")).toBeTruthy();
  });
});
