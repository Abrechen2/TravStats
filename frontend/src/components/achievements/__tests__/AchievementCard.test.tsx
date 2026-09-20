import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import AchievementCard from "../AchievementCard";
import type { Achievement } from "../../../types";

/**
 * The card has three states, and the third is the one the owner's ruling of
 * 2026-09-20 created: a badge the user HAD.
 *
 * Held-ness is the live measure now ("Löschen löscht auch Punkte, der
 * Live-Stand wird gezählt"), so deleting the flights behind a badge takes the
 * badge and its points away. Without a word on the card that is a number
 * silently going down — the user sees "57 of 276" where it said 58 and has
 * nothing to read it against. `unlockedAt` survives (it is never cleared), so
 * the card can say when they last held it.
 *
 * The suite's `t` returns the key, so the assertions below are on the key. The
 * copy itself is pinned by the locale parity test.
 */
const base: Achievement = {
  id: "1",
  code: "FIRST_FLIGHT",
  name: "Abgehoben",
  description: "Absolviere deinen ersten Flug",
  category: "explorer",
  icon: "✈️",
  tier: "bronze",
  requirement: 10,
  requirementType: "flights_count",
  points: 10,
  isHidden: false,
  createdAt: "2026-01-01T00:00:00Z",
  domain: "flight",
};

describe("AchievementCard", () => {
  it("shows the unlock date and no progress bar while the badge is held", () => {
    render(
      <AchievementCard
        achievement={{
          ...base,
          isUnlocked: true,
          progress: 12,
          progressPercentage: 100,
          unlockedAt: "2026-08-12T10:00:00Z",
        }}
      />
    );
    expect(screen.getByText("2026-08-12")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("achievement-last-held")).not.toBeInTheDocument();
  });

  it("shows the progress bar and when it was last held once the measure falls", () => {
    render(
      <AchievementCard
        achievement={{
          ...base,
          isUnlocked: false,
          progress: 4,
          progressPercentage: 40,
          unlockedAt: "2026-08-12T10:00:00Z",
        }}
      />
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
    expect(screen.getByText("4 / 10")).toBeInTheDocument();
    expect(screen.getByTestId("achievement-last-held")).toHaveTextContent(
      "achievements:progress.lastHeld"
    );
  });

  it("says nothing about a date for a badge that was never held", () => {
    render(
      <AchievementCard
        achievement={{
          ...base,
          isUnlocked: false,
          progress: 4,
          progressPercentage: 40,
          unlockedAt: null,
        }}
      />
    );
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByTestId("achievement-last-held")).not.toBeInTheDocument();
  });

  it("keeps a hidden, unheld achievement secret — including that it once was held", () => {
    // A "last held on" line under a "???" card would say the user had solved
    // this one, which is exactly what the mystery state withholds.
    render(
      <AchievementCard
        achievement={{
          ...base,
          isHidden: true,
          isUnlocked: false,
          progress: 4,
          progressPercentage: 40,
          unlockedAt: "2026-08-12T10:00:00Z",
        }}
      />
    );
    expect(screen.getByText("???")).toBeInTheDocument();
    expect(screen.queryByTestId("achievement-last-held")).not.toBeInTheDocument();
  });
});
