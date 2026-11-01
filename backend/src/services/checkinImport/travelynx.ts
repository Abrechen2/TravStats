/**
 * travelynx account export (JSON) -> rides.
 *
 * Shape taken from the upstream source (github.com/derf/travelynx, branch
 * main, commit 64b7a20d9a27, checked 2026-11-01): `json_export` in
 * `lib/Travelynx/Controller/Account.pm` answers
 * `{account, backends, in_transit, journeys}`; `journeys` are the rows of the
 * `journeys_str` view (latest definition in `lib/Travelynx/Command/database.pm`,
 * schema v73 "timestamps as integers"): `train_type`, `train_line`, `train_no`,
 * `sched_dep_ts` / `real_dep_ts` / `sched_arr_ts` / `real_arr_ts` (epoch
 * seconds), `dep_eva` / `dep_name` / `dep_lat` / `dep_lon` (and `arr_*`),
 * `cancelled`, `user_data` (`{comment}`), `is_iris|is_dbris|is_hafas|is_efa|is_motis`.
 * `*_eva` is the backend's own station id: it is an EVA number only for the
 * IRIS and DB-Navigator backends, so it is used as a station code only there.
 * `in_transit` (not yet checked out) is not read. A cancelled journey was never
 * ridden and is a reject, not a ride.
 * The ride's times are epoch seconds, so the station's zone is applied once the
 * station is known (`toSheets.ts`).
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

/** `user_data` is a JSON object, or the same as a string. */
function commentOf(userData: unknown): string | undefined {
  let u = userData;
  if (typeof u === "string") {
    try {
      u = JSON.parse(u);
    } catch {
      return undefined;
    }
  }
  return isRec(u) ? str(u.comment) : undefined;
}

export function parseTravelynxJson(text: string): CheckinParse {
  const out: CheckinParse = { rides: [], rejects: [] };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    out.rejects.push({ row: 1, label: "#1", reason: "invalid_file" });
    return out;
  }
  const list = Array.isArray(data) ? data : isRec(data) ? data.journeys : null;
  if (!Array.isArray(list)) {
    out.rejects.push({ row: 1, label: "#1", reason: "invalid_file" });
    return out;
  }
  if (list.length > MAX_CHECKIN_RECORDS) throw new TooManyRecordsError();
  list.forEach((item, index) => {
    const row = index + 1;
    const r = isRec(item) ? item : {};
    const evaIsTrusted = r.is_iris === true || r.is_dbris === true;
    const dep: CheckinStop = {
      name: str(r.dep_name),
      code: evaIsTrusted ? eva(r.dep_eva) : undefined,
      lat: num(r.dep_lat),
      lon: num(r.dep_lon),
    };
    const arr: CheckinStop = {
      name: str(r.arr_name),
      code: evaIsTrusted ? eva(r.arr_eva) : undefined,
      lat: num(r.arr_lat),
      lon: num(r.arr_lon),
    };
    const type = str(r.train_type);
    const line = str(r.train_line);
    const no = str(r.train_no);
    const label =
      [
        [type, line ?? no].filter(Boolean).join(" "),
        [dep.name, arr.name].filter(Boolean).join(" → "),
      ]
        .filter(Boolean)
        .join(" ") || `#${row}`;
    if (
      !isRec(item) ||
      (r.sched_dep_ts === undefined && r.real_dep_ts === undefined && !dep.name)
    ) {
      out.rejects.push({ row, label, reason: "not_a_journey" });
      return;
    }
    if (r.cancelled === true) {
      out.rejects.push({ row, label, reason: "cancelled" });
      return;
    }
    const depTime = timeFromEpoch(r.sched_dep_ts ?? r.real_dep_ts);
    const arrTime = timeFromEpoch(r.sched_arr_ts ?? r.real_arr_ts);
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
      notes: commentOf(r.user_data),
      dep: { ...dep, time: depTime },
      arr: { ...arr, time: arrTime },
    };
    out.rides.push(ride);
  });
  return out;
}
