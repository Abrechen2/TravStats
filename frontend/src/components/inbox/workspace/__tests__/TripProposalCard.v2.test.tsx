import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { TripSuggestion } from "../../../../types/tripSuggestion";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

import TripProposalCard from "../TripProposalCard";

/** Trip suggestions v2: a re-asked ("erweitert") and a business proposal say so on the card. */
const base: TripSuggestion = {
  id: "new_trip:-:abc",
  kind: "new_trip",
  startDay: "2025-05-03",
  endDay: "2025-05-20",
  nights: 17,
  planned: false,
  destination: "Rom",
  signals: ["package"],
  zoneUnknown: 0,
  members: [],
};

const renderCard = (s: TripSuggestion) =>
  render(
    <MemoryRouter>
      <TripProposalCard suggestion={s} busy={false} act={vi.fn()} />
    </MemoryRouter>
  );

describe("TripProposalCard — v2 marks", () => {
  it("marks an expanded business proposal and names the package signal", () => {
    renderCard({ ...base, expanded: true, purpose: "business" });
    expect(
      screen.getByText(
        "dataQuality:inbox.tripSuggestions.expanded · dataQuality:inbox.tripSuggestions.business"
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText("dataQuality:inbox.tripSuggestions.signals.package")
    ).toBeInTheDocument();
  });

  it("draws no mark for an ordinary proposal", () => {
    renderCard(base);
    expect(screen.queryByText(/tripSuggestions\.expanded/)).toBeNull();
    expect(screen.queryByText(/tripSuggestions\.business/)).toBeNull();
  });
});
