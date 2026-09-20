import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";

import AchievementDetailModal from "../AchievementDetailModal";
import { ACHIEVEMENT_EVIDENCE_KEY } from "../achievementEvidenceKey";
import { EVIDENCE_MEASURES } from "../../../shared/evidenceMeasures";
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

/**
 * A Router is required since the evidence trigger landed: the panel's open
 * state lives in `?evidence=` (useEvidence.ts), not in React state.
 */
const renderModal = (ui: ReactElement): ReturnType<typeof render> =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

describe("AchievementDetailModal", () => {
  it("renders nothing while no card is selected", () => {
    const { container } = renderModal(
      <AchievementDetailModal achievement={null} onClose={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the progress of a locked achievement, not a date it has not reached", () => {
    renderModal(
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
    renderModal(
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

  it("explains a badge the user no longer holds instead of just showing a bar", () => {
    // Owner's ruling, 2026-09-20: held-ness is the live measure, so deleting
    // the flights behind a badge takes it back. `unlockedAt` survives that —
    // it is never cleared — and is the only thing here that can tell the user
    // why the badge and its points went away.
    renderModal(
      <AchievementDetailModal
        achievement={{
          ...base,
          isUnlocked: false,
          progress: 4,
          unlockedAt: "2026-08-12T10:00:00Z",
        }}
        onClose={() => {}}
      />
    );
    expect(screen.getByTestId("achievement-detail-progress")).toBeInTheDocument();
    expect(screen.getByText("4 / 10")).toBeInTheDocument();
    expect(screen.getByTestId("achievement-detail-last-held")).toHaveTextContent(
      "achievements:progress.lastHeld"
    );
    // Not a claim that it is held — the points line belongs to the other state.
    expect(screen.queryByTestId("achievement-detail-unlocked")).not.toBeInTheDocument();
  });

  it("says nothing about a date for a badge that was never held", () => {
    renderModal(
      <AchievementDetailModal
        achievement={{ ...base, isUnlocked: false, progress: 4, unlockedAt: null }}
        onClose={() => {}}
      />
    );
    expect(screen.getByTestId("achievement-detail-progress")).toBeInTheDocument();
    expect(screen.queryByTestId("achievement-detail-last-held")).not.toBeInTheDocument();
  });

  // The grid draws a hidden, still-locked achievement as "???" so it stays a
  // surprise. A dialog that spelled it out would be a way to read every secret
  // by clicking one.
  it("keeps a hidden achievement hidden while it is still locked", () => {
    renderModal(
      <AchievementDetailModal
        achievement={{ ...base, isHidden: true, isUnlocked: false, name: "Geheim" }}
        onClose={() => {}}
      />
    );
    expect(screen.getByText("???")).toBeInTheDocument();
    expect(screen.queryByText("Geheim")).not.toBeInTheDocument();
  });

  it("reveals a hidden achievement once it has been earned", () => {
    renderModal(
      <AchievementDetailModal
        achievement={{ ...base, isHidden: true, isUnlocked: true, unlockedAt: null }}
        onClose={() => {}}
      />
    );
    expect(screen.queryByText("???")).not.toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    renderModal(<AchievementDetailModal achievement={base} onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  /**
   * Beta audit 2026-09-19 (#330, PARTIAL): locked progress read the raw
   * `495456 / 500000` — six digits with no grouping and nothing saying the
   * figure is kilometres.
   */
  describe("the progress fraction", () => {
    const distanceRule: Achievement = {
      ...base,
      code: "DISTANCE_500K",
      requirementType: "distance_km",
      requirement: 500000,
    };

    it("groups the thousands and names the rule's unit", () => {
      renderModal(
        <AchievementDetailModal
          achievement={{ ...distanceRule, isUnlocked: false, progress: 495456 }}
          onClose={() => {}}
        />
      );
      // en-US in the suite (setup.ts fixes the language); the point is that a
      // grouping mark and the unit are there, not which mark the locale picks.
      expect(
        screen.getByText("495,456 / 500,000 achievements:progress.units.km")
      ).toBeInTheDocument();
    });

    it("groups a plain count too, and appends no unit it does not have", () => {
      renderModal(
        <AchievementDetailModal
          achievement={{ ...base, requirement: 10000, isUnlocked: false, progress: 1234 }}
          onClose={() => {}}
        />
      );
      expect(screen.getByText("1,234 / 10,000")).toBeInTheDocument();
    });
  });

  /**
   * The public #330 comment promised "for every statistic behind it, the
   * entries that produced the number". `kind=achievement` answers 501, so the
   * dialog reaches the METRIC the rule stands on where there is one, and says
   * so plainly where there is not.
   */
  describe("the entries behind the statistic", () => {
    it("offers the evidence panel for a rule whose statistic is served", () => {
      renderModal(
        <AchievementDetailModal
          achievement={{ ...base, isUnlocked: false, progress: 4 }}
          onClose={() => {}}
        />
      );
      const trigger = screen.getByRole("button", {
        name: "achievements:progress.evidence.trigger",
      });
      expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
      expect(screen.queryByTestId("achievement-detail-no-evidence")).not.toBeInTheDocument();
    });

    it("says there is no list yet for a rule with no served statistic", () => {
      renderModal(
        <AchievementDetailModal
          achievement={{ ...base, requirementType: "pi_day_flights", isUnlocked: false }}
          onClose={() => {}}
        />
      );
      expect(screen.getByTestId("achievement-detail-no-evidence").textContent).toBe(
        "achievements:progress.evidence.none"
      );
      expect(
        screen.queryByRole("button", { name: "achievements:progress.evidence.trigger" })
      ).not.toBeInTheDocument();
    });

    it("offers neither for a hidden achievement that is still locked", () => {
      renderModal(
        <AchievementDetailModal
          achievement={{ ...base, isHidden: true, isUnlocked: false }}
          onClose={() => {}}
        />
      );
      expect(
        screen.queryByRole("button", { name: "achievements:progress.evidence.trigger" })
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId("achievement-detail-no-evidence")).not.toBeInTheDocument();
    });
  });
});

/**
 * The table is only worth having if every key in it is answered. `EvidenceTrigger`
 * says why: wiring a tile on a registry claim alone "ships a pointer cursor over
 * a 404, which is GitHub #330 with an extra round trip".
 */
describe("ACHIEVEMENT_EVIDENCE_KEY", () => {
  it("names only measures release 1 serves", () => {
    const unserved = Object.entries(ACHIEVEMENT_EVIDENCE_KEY).filter(
      ([, measureKey]) => EVIDENCE_MEASURES[measureKey]?.servedIn !== 1
    );
    expect(unserved).toEqual([]);
  });

  it("names a measure that exists at all", () => {
    const unknown = Object.entries(ACHIEVEMENT_EVIDENCE_KEY).filter(
      ([, measureKey]) => EVIDENCE_MEASURES[measureKey] === undefined
    );
    expect(unknown).toEqual([]);
  });
});

/**
 * Review, 2026-09-19: the table had mapped the `countries` rule to
 * `flightCountriesVisitedCount`, and the two count different things -- the
 * rule folds each airport's country through `toCountryCode` and drops the
 * catalogue's placeholder codes, the resolver counts the raw strings. The
 * panel compares the tile's figure against the one it measures and calls a
 * difference "recomputed", so a wrong mapping does not fail quietly: it
 * raises an alarm about nothing, on the reader's own screen.
 */
describe("the rules this table deliberately leaves out", () => {
  it("does not map `countries`, whose two sides count differently", () => {
    expect(ACHIEVEMENT_EVIDENCE_KEY).not.toHaveProperty("countries");
  });

  it("renders the honest sentence for a countries achievement", () => {
    renderModal(
      <AchievementDetailModal
        achievement={{
          ...base,
          code: "COUNTRY_COLLECTOR",
          requirementType: "countries",
          isUnlocked: false,
        }}
        onClose={() => {}}
      />
    );

    expect(screen.getByTestId("achievement-detail-no-evidence")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "achievements:progress.evidence.trigger" })
    ).not.toBeInTheDocument();
  });
});
