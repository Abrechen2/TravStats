import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import PhotoJourneyCard from "../PhotoJourneyCard";
import type { PhotoJourney } from "../../../types/photoJourney";

/**
 * The card PROMISES what accepting will do, and the promise must be the rule
 * the act reads. Keyed on `journey.kind` it was not: a `place` finding whose
 * place had been deleted since the scan creates nothing — correctly — while the
 * card went on saying "records a visit to this place". Nothing could catch that,
 * because promise and act were derived in two files from two conditions.
 */

function makeJourney(over: Partial<PhotoJourney> = {}): PhotoJourney {
  return {
    id: "journey-1",
    status: "pending",
    kind: "place",
    startDate: "2026-04-02T08:00:00.000Z",
    endDate: "2026-04-02T19:00:00.000Z",
    photoCount: 9,
    locatedCount: 9,
    lat: 38.7223,
    lon: -9.1393,
    countryCode: "PT",
    countryName: "Portugal",
    city: "Lissabon",
    previewAssetIds: [],
    placeId: "place-7",
    distanceKm: 0.4,
    nights: null,
    airportIata: null,
    spreadKm: null,
    createdTripId: null,
    createdPlaceVisitId: null,
    createdLodgingStayId: null,
    resolvedAt: null,
    createdAt: "2026-04-03T03:00:00.000Z",
    ...over,
  };
}

function renderCard(over: Partial<PhotoJourney>): void {
  render(
    <PhotoJourneyCard
      journey={makeJourney(over)}
      label="Lissabon, Portugal"
      onAccept={() => {}}
      onDismiss={() => {}}
    />
  );
}

const creates = (plan: string): string => `dataQuality:inbox.photoJourneys.creates.${plan}`;

describe("PhotoJourneyCard — what it promises accepting will do", () => {
  it("promises a visit for a place finding that still has its place", () => {
    renderCard({ kind: "place", placeId: "place-7" });
    expect(screen.getByText(creates("placeVisit"))).toBeInTheDocument();
  });

  it("promises NOTHING for a place finding whose place is gone", () => {
    renderCard({ kind: "place", placeId: null });
    expect(screen.getByText(creates("placeMissingAnswerOnly"))).toBeInTheDocument();
    expect(screen.queryByText(creates("placeVisit"))).not.toBeInTheDocument();
  });

  it("promises a trip for a trip finding", () => {
    renderCard({ kind: "trip", placeId: null, airportIata: "LIS" });
    expect(screen.getByText(creates("trip"))).toBeInTheDocument();
  });

  it("promises only an answer for a stay finding — a stay needs a lodging", () => {
    renderCard({ kind: "stay", placeId: "place-7", nights: 3 });
    expect(screen.getByText(creates("stayAnswerOnly"))).toBeInTheDocument();
  });
});
