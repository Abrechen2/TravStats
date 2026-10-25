import type { DawarichStay, DawarichStayScan } from "../../../prisma";
import { serializeTime } from "../../../shared/time/wire";
import { publicMarketCoverage } from "./publicCoverage";
import { publicStay } from "./publicStay";
const at = (value: Date | null, zone = "UTC") =>
  value ? serializeTime(value, zone, "minute") : null;
/**
 * A stay as the API answers it: its public columns (`publicStay`), the visit
 * a list reads with it, and its times. Never the whole row.
 */
export function withStayTimes<T extends DawarichStay & { visit?: unknown }>(row: T) {
  const evidence = row.evidence as { zone?: string };
  return {
    ...publicStay(row),
    ...("visit" in row ? { visit: row.visit } : {}),
    times: {
      startAt: at(row.startAt, row.zone),
      endAt: at(row.endAt, row.zone),
      sourceStartAt: at(row.sourceStartAt, evidence.zone ?? row.zone),
      sourceEndAt: at(row.sourceEndAt, evidence.zone ?? row.zone),
      detectedAt: at(row.detectedAt),
      resolvedAt: at(row.resolvedAt),
    },
  };
}
/**
 * The scan state as the API answers it. `provider` (the last scan's source,
 * TravTrack plan E1) is bookkeeping and stays server-side, so a Dawarich
 * account's answer holds exactly the columns it held before TravTrack; a
 * TravTrack account learns its source from the settings' `source` instead.
 */
export function withScanTimes(scan: DawarichStayScan | null) {
  const { provider: _provider, ...row } = scan ?? ({} as Partial<DawarichStayScan>);
  return {
    ...(scan ? row : {}),
    ...(scan ? { marketResult: publicMarketCoverage(scan.marketResult) } : {}),
    times: {
      startedAt: at(scan?.startedAt ?? null),
      finishedAt: at(scan?.finishedAt ?? null),
      leaseUntil: at(scan?.leaseUntil ?? null),
      dataThrough: at(scan?.dataThrough ?? null),
      windowStart: at(scan?.windowStart ?? null),
      windowEnd: at(scan?.windowEnd ?? null),
    },
  };
}
