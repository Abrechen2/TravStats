import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PhotoJourneyCard from "../PhotoJourneyCard";
import { photoJourneyLabel } from "../photoJourneyLabel";
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

function renderCard(
  over: Partial<PhotoJourney>,
  onAccept: (input: { name?: string }) => void = () => {}
): void {
  const journey = makeJourney(over);
  render(
    <PhotoJourneyCard
      journey={journey}
      label={journey.kind === "visit" ? photoJourneyLabel(journey) : "Lissabon, Portugal"}
      onAccept={onAccept}
      onDismiss={() => {}}
    />
  );
}

const creates = (plan: string): string => `dataQuality:inbox.photoJourneys.creates.${plan}`;
const ACCEPT = "dataQuality:inbox.photoJourneys.actions.accept";

/** A stop at Gyeongbokgung inside the Korea trip, as prod held it (forgejo#211). */
const VISIT: Partial<PhotoJourney> = {
  kind: "visit",
  placeId: null,
  tripId: "trip-korea",
  tripName: "Korea",
  suggestedName: "Gyeongbokgung",
  suggestedLocalName: "경복궁",
  suggestedRef: "osm:way/2",
  startDate: "2026-05-01T05:10:00.000Z",
  endDate: "2026-05-01T05:30:00.000Z",
  startDay: "2026-05-01",
  endDay: "2026-05-01",
  startLocal: "2026-05-01T14:10:00",
  endLocal: "2026-05-01T14:30:00",
  photoCount: 82,
  locatedCount: 82,
  city: "Seoul",
  countryName: "South Korea",
};

describe("PhotoJourneyCard — a visit finding (forgejo#211)", () => {
  it("heads with both names, names the trip, and shows the stop on the place's clock", () => {
    renderCard(VISIT);
    expect(screen.getByRole("heading")).toHaveTextContent("Gyeongbokgung · 경복궁");
    expect(screen.getByText("dataQuality:inbox.photoJourneys.kind.visit")).toBeInTheDocument();
    expect(screen.getByText("dataQuality:inbox.photoJourneys.facts.trip")).toBeInTheDocument();
    // 14:10 Seoul, never the reader's zone: the instant is 05:10Z.
    expect(screen.getByText(/01\.05\.2026 · 14:10 – 14:30/)).toBeInTheDocument();
  });

  it("promises a new place and a visit in the trip, and accepts with no name of its own", async () => {
    const onAccept = vi.fn();
    renderCard(VISIT, onAccept);
    expect(screen.getByText(creates("visitInTrip"))).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: ACCEPT }));
    expect(onAccept).toHaveBeenCalledWith({});
  });

  it("promises only the visit when an own place within reach takes it", () => {
    renderCard({ ...VISIT, placeId: "place-7" });
    expect(screen.getByText(creates("visitInTripOwnPlace"))).toBeInTheDocument();
  });

  it("asks for a name when the lookup named nothing, and accepts only once it has one", async () => {
    const onAccept = vi.fn();
    renderCard({ ...VISIT, suggestedName: null, suggestedLocalName: null }, onAccept);
    const accept = screen.getByRole("button", { name: ACCEPT });
    expect(accept).toBeDisabled();

    await userEvent.type(screen.getByRole("textbox"), "  Palace Grounds ");
    expect(accept).toBeEnabled();
    await userEvent.click(accept);
    expect(onAccept).toHaveBeenCalledWith({ name: "Palace Grounds" });
  });
});

describe("photoJourneyLabel for a visit finding", () => {
  it("shows the sign beside the name only where the two differ", () => {
    expect(photoJourneyLabel(makeJourney(VISIT))).toBe("Gyeongbokgung · 경복궁");
    expect(photoJourneyLabel(makeJourney({ ...VISIT, suggestedLocalName: null }))).toBe(
      "Gyeongbokgung"
    );
  });

  it("falls back to the stored town when the lookup named nothing", () => {
    expect(photoJourneyLabel(makeJourney({ ...VISIT, suggestedName: null }))).toBe(
      "Seoul, South Korea"
    );
  });
});

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
