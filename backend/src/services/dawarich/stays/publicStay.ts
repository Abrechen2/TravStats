import type { DawarichStay } from "../../../prisma";

/**
 * A stay row as it may leave the server (TravTrack plan E1, Codex review).
 * Named fields only: the neutral `evidenceKey`, the accept protocol's claim
 * and the provider bookkeeping stay server-side, and so do the point digests
 * a TravTrack finding keeps in `evidence.pointDigests`. These are exactly the
 * columns a stay had before E1, so a Dawarich user's API answer and account
 * export are what they were. One list for the stays API, the account export
 * (and the WebDAV sync that uploads it) — a column added to the table reaches
 * none of them until it is named here.
 */
export const PUBLIC_STAY_SELECT = {
  id: true,
  userId: true,
  fingerprint: true,
  sourceStartAt: true,
  sourceEndAt: true,
  sourceLat: true,
  sourceLon: true,
  status: true,
  startAt: true,
  endAt: true,
  lat: true,
  lon: true,
  zone: true,
  pointCount: true,
  evidence: true,
  placeId: true,
  tripId: true,
  name: true,
  visitId: true,
  detectedAt: true,
  resolvedAt: true,
} as const satisfies Partial<Record<keyof DawarichStay, true>>;

type PublicStayField = keyof typeof PUBLIC_STAY_SELECT;
export type PublicStay = Pick<DawarichStay, PublicStayField>;

const PUBLIC_STAY_FIELDS = Object.keys(PUBLIC_STAY_SELECT) as PublicStayField[];

/** The digests are server-keyed HMACs: never in a response, an export or a share. */
const SERVER_ONLY_EVIDENCE = "pointDigests";

/** `evidence` without its server-only parts, at any depth; anything else as it is. */
export function publicEvidence(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicEvidence);
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== SERVER_ONLY_EVIDENCE)
      .map(([key, v]) => [key, publicEvidence(v)])
  );
}

/** A stay row with only its public columns, in the table's order, and its evidence made public. */
export function publicStay<T extends PublicStay>(row: T): PublicStay {
  return Object.fromEntries(
    PUBLIC_STAY_FIELDS.map((key) => [
      key,
      key === "evidence" ? publicEvidence(row.evidence) : row[key],
    ])
  ) as PublicStay;
}
