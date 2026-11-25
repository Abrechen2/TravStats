import { prisma } from "../../../db";
import type { Prisma } from "../../../prisma";
import type { Span } from "../readSafe";

/**
 * The account's cleanup choices and road-matched stretches (rc46 extras C,
 * `travtrack_cleanups`). Raw points are never touched here or anywhere in
 * this folder: a row is a drawing aid over them, and deleting it is the undo.
 */

export type MatchRow = {
  id: string;
  fromMs: number;
  untilMs: number;
  /** One line per matched piece, `[lon, lat]`. */
  lines: [number, number][][];
  confidence: number;
  provider: string;
  pointCount: number;
};

export type SmoothingChoice = {
  /** The account-wide default (off unless switched on). */
  global: boolean;
  /** The choice for this span, or null when only the default applies. */
  span: boolean | null;
};

const asLines = (raw: unknown): [number, number][][] =>
  Array.isArray(raw)
    ? raw
        .filter(Array.isArray)
        .map((line) =>
          (line as unknown[]).filter(
            (c): c is [number, number] =>
              Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number"
          )
        )
    : [];

export async function smoothingChoice(userId: string, window: Span): Promise<SmoothingChoice> {
  const rows = await prisma.travTrackCleanup.findMany({
    where: { userId, kind: "smooth" },
    select: { fromMs: true, untilMs: true, enabled: true },
  });
  const global = rows.find((r) => r.fromMs === null)?.enabled ?? false;
  const span = rows.find(
    (r) =>
      r.fromMs !== null &&
      r.untilMs !== null &&
      Number(r.fromMs) <= window.fromMs &&
      Number(r.untilMs) >= window.untilMs
  );
  return { global, span: span ? span.enabled : null };
}

/** Switch smoothing for the whole account (`span` null) or for one span of days. */
export async function setSmoothing(
  userId: string,
  span: Span | null,
  enabled: boolean
): Promise<void> {
  const where = {
    userId,
    kind: "smooth",
    fromMs: span ? BigInt(span.fromMs) : null,
    untilMs: span ? BigInt(span.untilMs) : null,
  };
  await prisma.$transaction(async (tx) => {
    await tx.travTrackCleanup.deleteMany({ where });
    await tx.travTrackCleanup.create({ data: { ...where, enabled } });
  });
}

export async function matchesIn(userId: string, window: Span): Promise<MatchRow[]> {
  const rows = await prisma.travTrackCleanup.findMany({
    where: {
      userId,
      kind: "mapMatch",
      fromMs: { lt: BigInt(window.untilMs) },
      untilMs: { gt: BigInt(window.fromMs) },
    },
    orderBy: { fromMs: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    fromMs: Number(r.fromMs),
    untilMs: Number(r.untilMs),
    lines: asLines(r.geometry),
    confidence: r.confidence ?? 0,
    provider: r.provider ?? "",
    pointCount: r.pointCount ?? 0,
  }));
}

export async function storeMatch(userId: string, match: Omit<MatchRow, "id">): Promise<MatchRow> {
  // A stretch matched again replaces what was matched there before.
  const row = await prisma.$transaction(async (tx) => {
    await tx.travTrackCleanup.deleteMany({
      where: {
        userId,
        kind: "mapMatch",
        fromMs: BigInt(match.fromMs),
        untilMs: BigInt(match.untilMs),
      },
    });
    return tx.travTrackCleanup.create({
      data: {
        userId,
        kind: "mapMatch",
        fromMs: BigInt(match.fromMs),
        untilMs: BigInt(match.untilMs),
        geometry: match.lines as unknown as Prisma.InputJsonValue,
        confidence: match.confidence,
        provider: match.provider,
        pointCount: match.pointCount,
      },
    });
  });
  return { ...match, id: row.id };
}

/** The undo: false when there was nothing of this account's to remove. */
export async function deleteMatch(userId: string, id: string): Promise<boolean> {
  const { count } = await prisma.travTrackCleanup.deleteMany({
    where: { id, userId, kind: "mapMatch" },
  });
  return count > 0;
}
