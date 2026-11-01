/**
 * travelynx JSON export -> rides.
 *
 * Two shapes exist: the history API (`fromStation` / `toStation` objects with
 * `scheduledTime` / `realTime` in epoch seconds, a `train` object) and the
 * older account export (flat `train_type`, `sched_departure`, `dep_eva` ...).
 * Both are read; times are epoch seconds, so the station's zone is applied
 * once the station is known (`toSheets.ts`).
 */

import { modeFromTrainType } from "./modes";
import { timeFromEpoch } from "./time";
import {
  MAX_CHECKIN_RECORDS,
  TooManyRecordsError,
  type CheckinParse,
  type CheckinRide,
  type CheckinStop,
} from "./types";

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  const t = String(v).trim();
  return t === "" ? undefined : t;
};
const num = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const eva = (v: unknown): string | undefined => {
  const t = str(v);
  return t && /^\d{5,8}$/.test(t) ? t : undefined;
};

export function parseTravelynxJson(text: string): CheckinParse {
  const out: CheckinParse = { rides: [], rejects: [] };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    out.rejects.push({ row: 1, label: "#1", reason: "invalid_file" });
    return out;
  }
  const list = Array.isArray(data)
    ? data
    : isRec(data)
      ? [data.journeys, data.history, data.data].find(Array.isArray)
      : null;
  if (!Array.isArray(list)) {
    out.rejects.push({ row: 1, label: "#1", reason: "invalid_file" });
    return out;
  }
  if (list.length > MAX_CHECKIN_RECORDS) throw new TooManyRecordsError();
  list.forEach((item, index) => {
    const row = index + 1;
    const r = isRec(item) ? item : {};
    const from = isRec(r.fromStation) ? r.fromStation : null;
    const to = isRec(r.toStation) ? r.toStation : null;
    const train = isRec(r.train) ? r.train : {};
    const dep: CheckinStop = from
      ? {
          name: str(from.name),
          code: eva(from.uic ?? from.eva),
          lat: num(from.latitude),
          lon: num(from.longitude),
        }
      : { name: str(r.checkin_station_name ?? r.dep_name), code: eva(r.dep_eva) };
    const arr: CheckinStop = to
      ? {
          name: str(to.name),
          code: eva(to.uic ?? to.eva),
          lat: num(to.latitude),
          lon: num(to.longitude),
        }
      : { name: str(r.checkout_station_name ?? r.arr_name), code: eva(r.arr_eva) };
    const type = str(train.type ?? r.train_type);
    const line = str(train.line ?? r.train_line);
    const no = str(train.no ?? r.train_no);
    const label =
      [
        [type, line ?? no].filter(Boolean).join(" "),
        [dep.name, arr.name].filter(Boolean).join(" → "),
      ]
        .filter(Boolean)
        .join(" ") || `#${row}`;
    const depTime = timeFromEpoch(
      from
        ? (from.scheduledTime ?? from.realTime)
        : (r.sched_departure ?? r.real_departure ?? r.checkin_time)
    );
    const arrTime = timeFromEpoch(
      to
        ? (to.scheduledTime ?? to.realTime)
        : (r.sched_arrival ?? r.real_arrival ?? r.checkout_time)
    );
    if (depTime === null || arrTime === null) {
      out.rejects.push({ row, label, reason: "invalid_date" });
      return;
    }
    if (!dep.name && !dep.code) {
      out.rejects.push({ row, label, reason: "missing_departure_station" });
      return;
    }
    if (!arr.name && !arr.code) {
      out.rejects.push({ row, label, reason: "missing_arrival_station" });
      return;
    }
    if (!depTime) {
      out.rejects.push({ row, label, reason: "missing_departure_time" });
      return;
    }
    const ride: CheckinRide = {
      row,
      label,
      mode: modeFromTrainType(type),
      category: type,
      trainNumber: no,
      lineName: line,
      notes: str(r.comment ?? r.message),
      dep: { ...dep, time: depTime },
      arr: { ...arr, time: arrTime },
    };
    out.rides.push(ride);
  });
  return out;
}
