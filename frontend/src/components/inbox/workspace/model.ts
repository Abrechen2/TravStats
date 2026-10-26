import type { Trip } from "../../../types";
import type { DataQualityFlag } from "../../../types/dataQuality";
import type { PendingUpdate } from "../../../lib/api/types";
import type { PhotoJourney } from "../../../types/photoJourney";
import type { TripSuggestion } from "../../../types/tripSuggestion";
import { countryName } from "../../../shared/geo/countryCode";
import { flagSubjectLabel } from "../../DataQuality/flagSubject";
import { photoJourneyLabel } from "../photoJourneyLabel";
import { suggestedTripName } from "../tripSuggestionCopy";

import type { DawarichStay } from "../../../lib/api/dawarichStays";
import { suggestionDays, type LocationSuggestion } from "../../../lib/api/locationSuggestions";
import { localDay } from "../../../shared/time";

export const W = "dataQuality:inbox.workspace";
export type Translate = (key: string, options?: Record<string, unknown>) => string;
export type InboxSource = "review" | "trips" | "updates" | "photos" | "dawarich" | "location";
export type InboxView = "cards" | "list" | "journey";
export type InboxRecord =
  | { source: "review"; data: DataQualityFlag }
  | { source: "trips"; data: TripSuggestion }
  | { source: "updates"; data: PendingUpdate }
  | { source: "photos"; data: PhotoJourney }
  | { source: "dawarich"; data: DawarichStay }
  | { source: "location"; data: LocationSuggestion };
export type InboxItem = InboxRecord & {
  key: string;
  title: string;
  subject: string;
  day: string | null;
  tripId: string | null;
  groupKey: string;
  groupName: string;
};

/** The card's subject line: one naming rule with the card body (`flagSubjectLabel`). */
export function flagSubject(flag: DataQualityFlag, t: Translate, language: string): string {
  return flagSubjectLabel(
    flag,
    (code) => countryName(code, language) || t("dataQuality:flag.unknownCountry", { code }),
    t("dataQuality:flag.unnamedRecord"),
    t("dataQuality:flag.homeSubject")
  );
}

/** A travel day, never the date the inbox check happened to run. */
export function flagDay(flag: DataQualityFlag): string | null {
  switch (flag.kind) {
    case "trip_end_missing":
    case "trip_entries_outside":
      return flag.details.startDay;
    case "chronology_conflict":
      // A flight's `thisStart` is an instant, not a day: only the server's
      // local `day` names it. A stay's start already is a calendar day.
      return flag.details.domain === "lodging_stay"
        ? flag.details.thisStart.slice(0, 10)
        : (flag.details.day ?? null);
    case "duplicate_candidate":
      return flag.details.day ?? null;
    case "ferry_match":
      // The wall clock at the port, never the UTC instant's date.
      return flag.details.departureTime.local.slice(0, 10);
    case "stay_dates_reversed":
      return flag.details.stays[0]?.checkIn.slice(0, 10) ?? null;
    default:
      return null;
  }
}

/** Only persisted relationships group records; matching dates alone never do. */
export function buildInboxItems(
  records: InboxRecord[],
  trips: Trip[],
  t: Translate,
  language: string
): InboxItem[] {
  const tripById = new Map(trips.map((trip) => [trip.id, trip]));
  const flightTrips = new Map(
    trips.flatMap((trip) => (trip.flights ?? []).map((f) => [f.id, trip.id] as const))
  );
  return records.map((record): InboxItem => {
    let title: string;
    let subject: string;
    let day: string | null = null;
    let tripId: string | null = null;
    let knownName: string | null = null;
    let proposed = false;
    switch (record.source) {
      case "review": {
        const flag = record.data;
        title = t(`dataQuality:kinds.${flag.kind}.title`);
        subject = flagSubject(flag, t, language);
        day = flagDay(flag);
        tripId =
          flag.entityType === "trip"
            ? flag.entityId
            : flag.subject && "tripId" in flag.subject
              ? flag.subject.tripId
              : null;
        if (flag.entityType === "trip") knownName = subject;
        if (!tripId && flag.entityType === "flight")
          tripId = flightTrips.get(flag.entityId) ?? null;
        break;
      }
      case "trips": {
        const s = record.data;
        title = t(`${W}.proposal.${s.kind}`, { count: s.members.length });
        subject = s.trip?.name ?? s.place?.name ?? suggestedTripName(s, language, t);
        day = s.startDay;
        tripId = s.trip?.id ?? s.anchor?.tripId ?? null;
        knownName = s.trip?.name ?? null;
        proposed = s.kind === "new_trip";
        break;
      }
      case "updates": {
        const u = record.data;
        title = t(`${W}.flightChanges`, { count: (u.editedChanges ?? u.changes).length });
        subject = [u.flight?.flightNumber, u.flight?.depIata, "→", u.flight?.arrIata]
          .filter(Boolean)
          .join(" ");
        tripId = flightTrips.get(u.flightId) ?? null;
        // The pending-update reference carries instants but no airport zone.
        // Its full date is labelled UTC on the card; do not invent a local day.
        break;
      }
      case "dawarich": {
        const stay = record.data;
        title = t(`${W}.gpsProposal`);
        subject = stay.name ?? t("trips:dawarichStays.unnamed");
        day = localDay(stay.startAt, stay.zone);
        tripId = stay.tripId;
        break;
      }
      case "location": {
        const s = record.data;
        if (s.kind === "trip") {
          // A TravTrack trip question (plan L4): about a span of local days.
          title = t(`${W}.tripAway.cardTitle`);
          if (s.aggregate) {
            subject = t(`${W}.tripAway.more`, { count: s.aggregate.length });
          } else {
            subject = s.trip?.tripName ?? t(`${W}.tripAway.subject`, { count: s.trip?.days ?? 0 });
            tripId = s.trip?.tripId ?? null;
            knownName = s.trip?.tripName ?? null;
          }
          day = s.trip?.fromDay ?? null;
        } else if (s.kind === "journey") {
          // A TravTrack journey question (plan E7): about a local day.
          title = t(`${W}.journey.cardTitle`);
          subject = t(`${W}.journey.subject`, {
            count: Number(s.explanation.params.runs ?? 0),
            km: s.explanation.params.km ?? 0,
          });
          day = s.journey?.day ?? null;
        } else {
          // A TravTrack country question (plan E6): about a country, on UTC days.
          const code = String(s.explanation.params.country ?? "");
          title = t(`${W}.location.cardTitle`);
          subject = countryName(code, language) || code;
          day = suggestionDays(s).first;
        }
        break;
      }
      case "photos": {
        const p = record.data;
        title = t(`dataQuality:inbox.photoJourneys.kind.${p.kind}`);
        subject = photoJourneyLabel(p);
        day = p.startDay ?? null;
        tripId = p.tripId ?? null;
        knownName = p.tripName ?? null;
        proposed = p.kind === "trip";
        break;
      }
    }
    const key = `${record.source}:${record.data.id}`;
    return {
      ...record,
      key,
      title,
      subject,
      day,
      tripId,
      groupKey: tripId ? `trip:${tripId}` : proposed ? `proposal:${key}` : "unassigned",
      groupName: tripId
        ? (tripById.get(tripId)?.name ?? knownName ?? t(`${W}.knownTrip`))
        : proposed
          ? t(`${W}.proposedTrip`, { name: subject })
          : t(`${W}.unassigned`),
    };
  });
}

export function filterInbox(
  items: InboxItem[],
  query: string,
  source: InboxSource | "all",
  deferred: ReadonlySet<string>,
  showDeferred: boolean
): InboxItem[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(
    (item) =>
      (source === "all" || item.source === source) &&
      deferred.has(item.key) === showDeferred &&
      words.every((word) =>
        `${item.title} ${item.subject} ${item.groupName} ${item.day ?? ""}`
          .toLocaleLowerCase()
          .includes(word)
      )
  );
}

export function orderByJourney(items: InboxItem[]): InboxItem[] {
  return [...items].sort((a, b) => {
    if (a.groupKey !== b.groupKey) {
      if (a.groupKey === "unassigned") return 1;
      if (b.groupKey === "unassigned") return -1;
      return a.groupName.localeCompare(b.groupName) || a.groupKey.localeCompare(b.groupKey);
    }
    return (a.day ?? "9999").localeCompare(b.day ?? "9999") || a.key.localeCompare(b.key);
  });
}
