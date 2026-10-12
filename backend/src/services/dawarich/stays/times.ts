import type { DawarichStay, DawarichStayScan } from "../../../prisma";
import { serializeTime } from "../../../shared/time/wire";
const at = (value: Date | null, zone = "UTC") =>
  value ? serializeTime(value, zone, "minute") : null;
export function withStayTimes<T extends DawarichStay>(row: T) {
  const evidence = row.evidence as { zone?: string };
  return {
    ...row,
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
