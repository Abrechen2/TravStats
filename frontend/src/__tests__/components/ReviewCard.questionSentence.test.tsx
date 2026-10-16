import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import ReviewCard from "../../components/inbox/workspace/ReviewCard";
import type { DataQualityFlag } from "../../types/dataQuality";

/**
 * The sentence that says what kind of question a card asks (ADR 0002 phase 3b).
 *
 * The old review tab opened with "Bei diesen Einträgen widersprechen sich zwei
 * Angaben" whatever it listed — true for an address in the wrong country,
 * untrue for a flight whose airport has no zone: nothing disagrees there,
 * something is missing. In the one inbox the cards of all kinds are mixed, so
 * each card carries its own group's sentence.
 */
vi.mock("../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

const contradiction: DataQualityFlag = {
  id: "flag-1",
  entityType: "lodging",
  entityId: "lodging-1",
  kind: "address_country_mismatch",
  status: "open",
  subject: { entityType: "lodging", entityId: "lodging-1", label: "Hotel Sport" },
  details: {
    claimedCountryCode: "RO",
    claimedCountryText: "Rumänien",
    addressCountryCode: "SI",
    addressCountryText: "Slovenia",
    address: "Grajska cesta 2, Otočec, Slovenia",
  },
  createdAt: "2026-09-01T10:00:00.000Z",
  resolvedAt: null,
};

const timeQuestion: DataQualityFlag = {
  id: "flag-2",
  entityType: "flight",
  entityId: "f1",
  kind: "time_zone_unresolved",
  status: "open",
  subject: {
    entityType: "flight",
    entityId: "f1",
    label: "LH 2462 MUC → CPH",
    parentId: null,
    parentType: null,
    tripId: null,
  },
  details: {
    table: "flights",
    fields: [
      {
        column: "departure",
        reason: "no_position",
        legacyValue: null,
        keptValue: null,
        zone: null,
      },
    ],
  },
  createdAt: "2026-09-27T08:00:00.000Z",
  resolvedAt: null,
};

function show(flag: DataQualityFlag): void {
  render(
    <MemoryRouter>
      <ReviewCard flag={flag} busy={false} act={vi.fn(async () => true)} />
    </MemoryRouter>
  );
}

describe("inbox — each question says what kind of question it is", () => {
  it("does not call a missing zone a contradiction", () => {
    show(timeQuestion);
    expect(screen.getByText(/fehlt uns etwas, um eine Zeit richtig anzuzeigen/)).toBeTruthy();
    expect(screen.queryByText(/widersprechen sich zwei Angaben/)).toBeNull();
  });

  it("keeps the contradiction sentence for contradictions", () => {
    show(contradiction);
    expect(screen.getByText(/widersprechen sich zwei Angaben/)).toBeTruthy();
    expect(screen.queryByText(/fehlt uns etwas/)).toBeNull();
  });

  it("gives the record checks (forgejo#282) their own sentence, not the contradiction one", () => {
    show({
      ...timeQuestion,
      id: "flag-3",
      kind: "flight_number_missing",
      details: { airline: "Condor", status: "flown" },
    } as DataQualityFlag);
    expect(screen.getByText(/Doppelte, sich überschneidende/)).toBeTruthy();
    expect(screen.queryByText(/widersprechen sich zwei Angaben/)).toBeNull();
  });
});
