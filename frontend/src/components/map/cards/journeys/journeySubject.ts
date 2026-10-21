// What a route's picture shows (owner, 2026-10-21): the ferry's ship, the
// rental's car model, the train category. A coach records no vehicle type,
// so a bus route has no picture — abstain rather than show any bus.

import type { SubjectKind } from "../../../../lib/api/mapDetails";
import { modeOf } from "./journeyStats";
import type { MapJourney } from "./journeyTypes";

export interface JourneySubject {
  kind: SubjectKind;
  name: string;
}

function subjectName(j: MapJourney): string | null {
  switch (j.domain) {
    case "ferry":
      return j.facts.vesselName ?? null;
    case "rental":
      return j.facts.vehicleModel ?? null;
    case "rail":
      return j.facts.trainCategory ?? null;
    default:
      return null;
  }
}

const KIND: Partial<Record<MapJourney["domain"], SubjectKind>> = {
  ferry: "vessel",
  rental: "vehicle",
  rail: "train",
};

/** The route's most frequent subject, or null. */
export function routeSubject(journeys: readonly MapJourney[]): JourneySubject | null {
  const kind = journeys[0] ? KIND[journeys[0].domain] : undefined;
  if (!kind) return null;
  const name = modeOf(journeys.map(subjectName));
  return name ? { kind, name } : null;
}
