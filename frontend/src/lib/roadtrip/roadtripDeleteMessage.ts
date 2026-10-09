import { survivorsNote } from "../deleteConfirm";
import type { RoadtripDetail } from "../../types/roadtrip";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * What deleting a roadtrip says (forgejo#250), in the shared shape: what goes
 * and how much of it, then what stays, by name.
 *
 * Goes (the server's delete, `DELETE /tours/:id`): the roadtrip's own
 * stations, its legs and its recordings. Stays: the trip it was filed on (and
 * its costs go there — `handExpensesToTrips`; without a trip the server asks
 * separately, 409 `SECTION_HAS_EXPENSES`), every linked lodging and stay (the
 * station only POINTS at the stay), the day tours that set out from its
 * stations (they lose their station, not themselves), and the trip photos
 * filed at its stations (`SetNull` — they stay on their trip).
 *
 * No document note: a roadtrip carries no kept originals of its own — the
 * documents API has no roadtrip entry type, and the stays' documents belong
 * to the stays, which stay.
 */
export function roadtripDeleteMessage(t: Translate, detail: RoadtripDetail): string {
  const name = detail.roadtrip.name;
  const stations = detail.stations.filter((s) => s.state !== "via");
  const parts = [
    stations.length > 0 ? t("roadtrips:deleteConfirm.stations", { count: stations.length }) : null,
    detail.legs.length > 0
      ? t("roadtrips:deleteConfirm.legs", { count: detail.legs.length })
      : null,
  ].filter((p): p is string => p !== null);
  const lines = [
    parts.length > 0
      ? t("roadtrips:deleteConfirm.goes", {
          name,
          list: [...parts, t("roadtrips:deleteConfirm.tracks")].join(", "),
        })
      : t("roadtrips:deleteConfirm.goesEmpty", { name }),
  ];
  if (detail.trip && detail.expenses.length > 0) {
    lines.push(
      t("roadtrips:deleteConfirm.costsToTrip", {
        count: detail.expenses.length,
        trip: detail.trip.name,
      })
    );
  }
  const lodgings = [...new Set(stations.flatMap((s) => (s.stay ? [s.stay.lodgingName] : [])))];
  const photos = stations.reduce((sum, s) => sum + (s.photoCount ?? 0), 0);
  const survivors = survivorsNote(t, [
    ...(detail.trip ? [t("roadtrips:deleteConfirm.survivorTrip", { name: detail.trip.name })] : []),
    ...lodgings.map((lodging) => t("roadtrips:deleteConfirm.survivorLodging", { name: lodging })),
    ...detail.tours.map((tour) => t("roadtrips:deleteConfirm.survivorTour", { name: tour.name })),
    ...(photos > 0 ? [t("roadtrips:deleteConfirm.survivorPhotos", { count: photos })] : []),
  ]);
  if (survivors) lines.push(survivors);
  return lines.join("\n");
}
