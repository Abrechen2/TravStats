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
export function withScanTimes(row: DawarichStayScan | null) {
  return {
    ...row,
    ...(row ? { marketResult: publicMarketCoverage(row.marketResult) } : {}),
    times: {
      startedAt: at(row?.startedAt ?? null),
      finishedAt: at(row?.finishedAt ?? null),
      leaseUntil: at(row?.leaseUntil ?? null),
      dataThrough: at(row?.dataThrough ?? null),
      windowStart: at(row?.windowStart ?? null),
      windowEnd: at(row?.windowEnd ?? null),
    },
  };
}
