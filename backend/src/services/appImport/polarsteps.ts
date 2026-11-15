/**
 * Polarsteps: the `trip.json` of the account's data download.
 *
 * SYNTHETIC FORMAT — built from the documented download (a ZIP with one folder
 * per trip, each holding `trip.json` with `all_steps`, and `locations.json`),
 * not from a real file. Steps carry `start_time` (epoch seconds),
 * `timezone_id` and a `location` object `{name, detail, country_code, lat,
 * lon}`. Each step becomes a visited place with one visit at the step's local
 * time; the trip itself and the GPS track (`locations.json`) are not imported
 * — the server has trips and recordings of its own and a step is not a trip.
 * A file may be one trip object or an array of them.
 */

import { z } from "zod";
import { TooManyRecordsError } from "../checkinImport/types";
import { zoneOf } from "../../shared/time/zoneOf";
import { isValidZone } from "../../shared/time/zonedParts";
import { instantToWallClock } from "../rides/rideEnds";
import { MAX_APP_RECORDS, emptyParse, type AppParse } from "./types";

const num = z.union([z.number(), z.string()]).transform((v) => Number(v));
const step = z
  .object({
    name: z.string().nullish(),
    display_name: z.string().nullish(),
    description: z.string().nullish(),
    start_time: num.nullish(),
    timezone_id: z.string().nullish(),
    location: z
      .object({
        name: z.string().nullish(),
        detail: z.string().nullish(),
        country_code: z.string().nullish(),
        lat: num.nullish(),
        lon: num.nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

const tripDoc = z
  .object({
    start_date: num.nullish(),
    end_date: num.nullish(),
    name: z.string().nullish(),
    all_steps: z.array(z.unknown()).optional(),
    steps: z.array(z.unknown()).optional(),
  })
  .passthrough();

type TripDoc = z.infer<typeof tripDoc>;

/**
 * One trip record per Polarsteps trip: its name and local first/last day. The
 * dates come from `start_date` / `end_date`, else from the earliest and latest
 * step; a trip with neither is still created, without dates. The day is read
 * in the zone of the trip's first step (UTC when it names none).
 */
function readTrips(docs: TripDoc[], out: AppParse): void {
  const seen = new Set<string>();
  docs.forEach((t, index) => {
    const row = index + 1;
    const name = t.name?.trim();
    if (!name) {
      out.rejects.push({ sheet: "trips", row, label: `#${row}`, reason: "missing_name" });
      return;
    }
    // Each step's own local day (the zone of the step, as its visit is read),
    // so a trip across zones does not lose its last day.
    const stepDays = (t.all_steps ?? t.steps ?? []).flatMap((s) => {
      const r = step.safeParse(s);
      if (!r.success || r.data.start_time == null || !Number.isFinite(r.data.start_time)) return [];
      const instant = new Date(r.data.start_time * 1000);
      if (Number.isNaN(instant.getTime())) return [];
      const lat = r.data.location?.lat;
      const lon = r.data.location?.lon;
      const zone =
        r.data.timezone_id && isValidZone(r.data.timezone_id)
          ? r.data.timezone_id
          : lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon)
            ? zoneOf({ lat, lon })
            : null;
      return [
        {
          epoch: r.data.start_time,
          zone: zone ?? "UTC",
          day: instantToWallClock(instant, zone ?? "UTC").slice(0, 10),
        },
      ];
    });
    stepDays.sort((x, y) => x.epoch - y.epoch);
    const dayAt = (epoch: number | null | undefined, zone: string): string | undefined => {
      if (epoch == null || !Number.isFinite(epoch)) return undefined;
      const instant = new Date(epoch * 1000);
      return Number.isNaN(instant.getTime())
        ? undefined
        : instantToWallClock(instant, zone).slice(0, 10);
    };
    const first = stepDays[0];
    const last = stepDays[stepDays.length - 1];
    const startDay = dayAt(t.start_date, first?.zone ?? "UTC") ?? first?.day;
    const endDay = dayAt(t.end_date, last?.zone ?? "UTC") ?? last?.day;
    if (startDay && endDay && endDay < startDay) {
      out.rejects.push({ sheet: "trips", row, label: name, reason: "invalid_date" });
      return;
    }
    const key = [name, startDay, endDay].join("|").toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.trips.push({ row, label: name, name, startDay, endDay });
  });
}

export function parsePolarsteps(raw: string): AppParse {
  const out = emptyParse();
  let doc: unknown;
  try {
    doc = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    out.rejects.push({ sheet: "places", row: 1, label: "#1", reason: "invalid_file" });
    return out;
  }
  const trips = (Array.isArray(doc) ? doc : [doc]).map((d) => tripDoc.safeParse(d));
  const steps = trips.flatMap((t) => (t.success ? (t.data.all_steps ?? t.data.steps ?? []) : []));
  if (
    trips.some((t) => !t.success) ||
    (steps.length === 0 && !trips.some((t) => t.success && (t.data.all_steps || t.data.steps)))
  ) {
    out.rejects.push({ sheet: "places", row: 1, label: "#1", reason: "invalid_file" });
    return out;
  }
  if (steps.length > MAX_APP_RECORDS) throw new TooManyRecordsError(MAX_APP_RECORDS);

  readTrips(
    trips.flatMap((t) => (t.success ? [t.data] : [])),
    out
  );

  const placeSeen = new Set<string>();
  steps.forEach((s, index) => {
    const row = index + 1;
    const parsed = step.safeParse(s);
    if (!parsed.success) {
      out.rejects.push({ sheet: "places", row, label: `#${row}`, reason: "invalid_record" });
      return;
    }
    const st = parsed.data;
    const loc = st.location;
    const name = (st.display_name || st.name || loc?.name || "").trim();
    const label = name || `#${row}`;
    if (!name) {
      out.rejects.push({ sheet: "places", row, label, reason: "missing_name" });
      return;
    }
    const lat = loc?.lat ?? undefined;
    const lon = loc?.lon ?? undefined;
    if (lat === undefined || lon === undefined || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      out.rejects.push({ sheet: "places", row, label, reason: "missing_coordinates" });
      return;
    }
    const key = `${name}|${lat.toFixed(4)}|${lon.toFixed(4)}`.toLowerCase();
    if (!placeSeen.has(key)) {
      placeSeen.add(key);
      out.places.push({
        row,
        label,
        cells: {
          name,
          lat: String(lat),
          lon: String(lon),
          city: loc?.name && loc.name !== name ? loc.name : "",
          country: loc?.country_code?.toUpperCase() ?? "",
          notes: st.description?.trim() ?? "",
          category: "other",
          visited: "true",
        },
      });
    }
    // The visit's clock is the place's wall clock written as UTC (the visit
    // column's convention); a step without a time still is a place.
    if (st.start_time !== undefined && st.start_time !== null && Number.isFinite(st.start_time)) {
      const instant = new Date(st.start_time * 1000);
      if (Number.isNaN(instant.getTime())) {
        out.rejects.push({ sheet: "placeVisits", row, label, reason: "invalid_date" });
        return;
      }
      const zone =
        st.timezone_id && isValidZone(st.timezone_id) ? st.timezone_id : zoneOf({ lat, lon });
      const wall = instantToWallClock(instant, zone);
      out.placeVisits.push({ row, label, cells: { placeId: name, visitedAt: `${wall}:00.000Z` } });
    }
  });
  return out;
}
