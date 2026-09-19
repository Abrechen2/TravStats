import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AchievementDetailModal from "../AchievementDetailModal";
import type { Achievement } from "../../../types";

/**
 * #330: the cards drew a pointer cursor and grew on hover while nothing was
 * clickable. The owner's call was to keep the affordance and make it true, so
 * this dialog is what a click now opens — badge, progress, date, and nothing
 * the engine cannot back.
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

describe("AchievementDetailModal", () => {
  it("renders nothing while no card is selected", () => {
    const { container } = render(<AchievementDetailModal achievement={null} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the progress of a locked achievement, not a date it has not reached", () => {
    render(
      <AchievementDetailModal
        achievement={{ ...base, isUnlocked: false, progress: 4 }}
        onClose={() => {}}
      />
    );
    expect(screen.getByTestId("achievement-detail-progress")).toBeInTheDocument();
    expect(screen.getByText("4 / 10")).toBeInTheDocument();
    expect(screen.queryByTestId("achievement-detail-unlocked")).not.toBeInTheDocument();
  });

  it("shows the date and the points once it is unlocked", () => {
    render(
      <AchievementDetailModal
        achievement={{
          ...base,
          isUnlocked: true,
          progress: 10,
          unlockedAt: "2026-08-12T10:00:00Z",
        }}
        onClose={() => {}}
      />
    );
    expect(screen.getByTestId("achievement-detail-unlocked")).toBeInTheDocument();
    expect(screen.getByText("+10")).toBeInTheDocument();
    // The progress bar belongs to the half that is still being worked on.
    expect(screen.queryByTestId("achievement-detail-progress")).not.toBeInTheDocument();
  });

  // The grid draws a hidden, still-locked achievement as "???" so it stays a
  // surprise. A dialog that spelled it out would be a way to read every secret
  // by clicking one.
  it("keeps a hidden achievement hidden while it is still locked", () => {
    render(
      <AchievementDetailModal
        achievement={{ ...base, isHidden: true, isUnlocked: false, name: "Geheim" }}
        onClose={() => {}}
      />
    );
    expect(screen.getByText("???")).toBeInTheDocument();
    expect(screen.queryByText("Geheim")).not.toBeInTheDocument();
  });

  it("reveals a hidden achievement once it has been earned", () => {
    render(
      <AchievementDetailModal
        achievement={{ ...base, isHidden: true, isUnlocked: true, unlockedAt: null }}
        onClose={() => {}}
      />
    );
    expect(screen.queryByText("???")).not.toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(<AchievementDetailModal achievement={base} onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
