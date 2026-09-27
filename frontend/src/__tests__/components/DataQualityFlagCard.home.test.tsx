import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import DataQualityFlagCard from "../../components/DataQuality/DataQualityFlagCard";
import type { DataQualityFlag } from "../../types/dataQuality";

/**
 * The one inbox question an account migrated from the old one-airport home
 * gets (owner decision 2026-09-27), as a German reader sees it: what it asks,
 * which airports TravStats knows so far, that nothing changes until they
 * answer, and the way to the settings section that answers it.
 */

vi.mock("../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

const flag: DataQualityFlag = {
  id: "flag-home",
  entityType: "home",
  entityId: "residence",
  status: "open",
  createdAt: "2026-09-27T08:00:00.000Z",
  resolvedAt: null,
  kind: "home_residence_unconfirmed",
  subject: { entityType: "home", entityId: "residence" },
  details: { airports: ["MUC", "CGN"], periods: 2 },
};

describe("DataQualityFlagCard — the home question", () => {
  it("asks the question, names the known airports and links to the Zuhause settings", () => {
    render(
      <MemoryRouter>
        <DataQualityFlagCard flag={flag} onResolve={() => {}} onDismiss={() => {}} />
      </MemoryRouter>
    );
    expect(
      screen.getByText("Wohnort bestätigen und weitere Heimatflughäfen wählen?")
    ).toBeInTheDocument();
    expect(screen.getByText(/nur deinen Heimatflughafen \(MUC, CGN\)/)).toBeInTheDocument();
    expect(
      screen.getByText("Bis du bestätigst, rechnen alle Statistiken genau wie bisher.")
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dein Zuhause" })).toHaveAttribute(
      "href",
      "/settings?section=homeAirport"
    );
    expect(screen.getByRole("link", { name: "Zuhause einrichten" })).toHaveAttribute(
      "href",
      "/settings?section=homeAirport"
    );
    // Not the fallback for a kind this build cannot render.
    expect(screen.queryByText(/kennt diese Version/)).toBeNull();
  });
});
