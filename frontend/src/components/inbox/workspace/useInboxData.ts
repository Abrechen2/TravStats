import { useCallback, useEffect, useRef, useState } from "react";
import { dataQualityFlagsApi } from "../../../lib/api/dataQualityFlags";
import { tripSuggestionsApi } from "../../../lib/api/tripSuggestions";
import { pendingUpdatesApi } from "../../../lib/api/pendingUpdates";
import { photoJourneysApi } from "../../../lib/api/photoJourneys";
import { dawarichStaysApi, type StayChoices } from "../../../lib/api/dawarichStays";
import { tripsApi } from "../../../lib/api/trips";
import type { Trip } from "../../../types";
import type { TripSuggestionList } from "../../../types/tripSuggestion";
import type { InboxRecord, InboxSource } from "./model";

/**
 * Which kinds the inbox shows at all. A hidden kind is not asked for: photos
 * behind their gate, trip and stay suggestions behind the account's switches
 * (forgejo#306) — the server would answer those empty anyway, but a request
 * the page does not need is still a request.
 */
export interface InboxVisibility {
  photos: boolean;
  trips: boolean;
  stays: boolean;
}

const hiddenSource = (source: InboxSource, visible: InboxVisibility): boolean =>
  (source === "photos" && !visible.photos) ||
  (source === "trips" && !visible.trips) ||
  (source === "dawarich" && !visible.stays);

/** A failed source is named, never reported as an empty inbox. Latest load wins. */
export function useInboxData(visible: InboxVisibility, active = true) {
  const { photos: photosVisible, trips: tripsVisible, stays: staysVisible } = visible;
  const [records, setRecords] = useState<InboxRecord[]>([]);
  const [stayChoices, setStayChoices] = useState<StayChoices>({ places: [], trips: [] });
  const [trips, setTrips] = useState<Trip[]>([]);
  const [proposalInfo, setProposalInfo] = useState<TripSuggestionList | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    const requests = [
      dataQualityFlagsApi.getAll({ status: "open" }),
      tripsVisible ? tripSuggestionsApi.list() : Promise.resolve(null),
      // Edited proposals are still awaiting application.
      pendingUpdatesApi.getAll({ status: "pending" }),
      pendingUpdatesApi.getAll({ status: "edited" }),
      photosVisible ? photoJourneysApi.list("pending") : Promise.resolve([]),
      tripsApi.getAll(),
      staysVisible
        ? dawarichStaysApi.list("pending").then(async (rows) => ({
            rows,
            choices: rows.length ? await dawarichStaysApi.choices() : { places: [], trips: [] },
          }))
        : Promise.resolve({ rows: [], choices: { places: [], trips: [] } }),
    ] as const;
    const [flags, suggestions, updates, edited, photos, tripList, stays] =
      await Promise.allSettled(requests);
    if (current !== generation.current) return;
    const errors: string[] = [];
    const rows: InboxRecord[] = [];
    const append = <T>(
      result: PromiseSettledResult<T>,
      source: InboxSource,
      map: (data: T) => InboxRecord[]
    ) => {
      if (result.status === "fulfilled") rows.push(...map(result.value));
      else errors.push(source);
    };
    append(flags, "review", (value) => value.flags.map((data) => ({ source: "review", data })));
    append(suggestions, "trips", (value) =>
      (value?.suggestions ?? []).map((data) => ({ source: "trips", data }))
    );
    append(updates, "updates", (value) =>
      value.updates.map((data) => ({ source: "updates", data }))
    );
    append(edited, "updates", (value) =>
      value.updates.map((data) => ({ source: "updates", data }))
    );
    append(photos, "photos", (value) => value.map((data) => ({ source: "photos", data })));
    append(stays, "dawarich", (value) => value.rows.map((data) => ({ source: "dawarich", data })));
    if (stays.status === "fulfilled") setStayChoices(stays.value.choices);
    if (tripList.status === "fulfilled") setTrips(tripList.value);
    else errors.push("tripContext");
    setProposalInfo(suggestions.status === "fulfilled" ? suggestions.value : null);
    const shown = { photos: photosVisible, trips: tripsVisible, stays: staysVisible };
    // Keep last known rows for a failing source, visibly disabled by the caller.
    setRecords((previous) => {
      const kept = previous.filter(
        (row) => errors.includes(row.source) && !hiddenSource(row.source, shown)
      );
      return [
        ...new Map([...kept, ...rows].map((row) => [`${row.source}:${row.data.id}`, row])).values(),
      ];
    });
    setFailed([...new Set(errors)]);
    setLoading(false);
    setLoaded(true);
  }, [photosVisible, tripsVisible, staysVisible]);

  useEffect(() => {
    if (active) void reload();
    return () => {
      generation.current += 1;
    };
  }, [reload, active]);

  return { records, trips, stayChoices, proposalInfo, failed, loading, loaded, reload };
}
