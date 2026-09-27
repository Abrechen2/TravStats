import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import ActivityLine from "../ActivityLine";
import type { MembershipActivity } from "../../../types/loyalty";

/**
 * The evaluation the tester asked for (Discord, 2026-09-26): "Nächte/
 * Aufenthalte pro Programm … Vielleicht ein Link zu einer Liste all dieser
 * Nächte/Aufenthalte". Each figure links to the list filtered to the rows it
 * counted — never a history of statuses.
 */
const activity: MembershipActivity = {
  count: 5,
  nights: 11,
  lastActivity: "2025-02-12",
  years: [
    { year: 2025, count: 2, nights: 4 },
    { year: 2024, count: 3, nights: 7 },
  ],
};

const renderLine = (props: Parameters<typeof ActivityLine>[0]) =>
  render(
    <MemoryRouter>
      <ActivityLine {...props} />
    </MemoryRouter>
  );

describe("ActivityLine — per programme, per year, with the list behind each figure", () => {
  it("links a hotel card's total and each year to the lodging list filtered to that card", () => {
    renderLine({ domain: "lodging", membershipId: "card-1", activity });
    expect(screen.getByTestId("loyalty-activity-list")).toHaveAttribute(
      "href",
      "/lodging?membership=card-1"
    );
    const y2024 = screen.getByTestId("loyalty-activity-year-2024");
    expect(within(y2024).getByRole("link")).toHaveAttribute(
      "href",
      "/lodging?membership=card-1&year=2024"
    );
    expect(y2024).toHaveTextContent("2024: loyalty:activity.lodging · loyalty:activity.nights");
  });

  it("links a flight card to the flight list", () => {
    renderLine({
      domain: "flight",
      membershipId: "card-2",
      activity: { ...activity, nights: null, years: [{ year: 2023, count: 4, nights: null }] },
    });
    expect(
      within(screen.getByTestId("loyalty-activity-year-2023")).getByRole("link")
    ).toHaveAttribute("href", "/flights?membership=card-2&year=2023");
  });

  // Acceptance 2026-09-26: the rail block had neither the list link nor
  // year links, while hotel and flight had both.
  it("links a rail card's total and each year to the rail list", () => {
    renderLine({
      domain: "rail",
      membershipId: "card-4",
      activity: { ...activity, nights: null, years: [{ year: 2025, count: 4, nights: null }] },
    });
    expect(screen.getByTestId("loyalty-activity-list")).toHaveAttribute(
      "href",
      "/rail?membership=card-4"
    );
    expect(screen.getByTestId("loyalty-activity-list")).toHaveTextContent(
      "loyalty:activity.showList.rail"
    );
    expect(
      within(screen.getByTestId("loyalty-activity-year-2025")).getByRole("link")
    ).toHaveAttribute("href", "/rail?membership=card-4&year=2025");
  });

  it("gives a cruise card its figures without a link the cruise list could not honour", () => {
    renderLine({ domain: "cruise", membershipId: "card-3", activity });
    expect(screen.getByTestId("loyalty-activity-year-2025")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("says a card covers nothing yet rather than printing zeros", () => {
    renderLine({
      domain: "lodging",
      membershipId: "card-1",
      activity: { count: 0, nights: null, lastActivity: null, years: [] },
    });
    expect(screen.getByText("loyalty:activity.none")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
