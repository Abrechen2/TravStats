import { PrismaClient } from "../prisma";
import { prisma } from "../db";
import logger from "../utils/logger";

const prismaClient = prisma as PrismaClient;

/** Union type for values that can appear in flight data fields */
export type FlightFieldValue = string | number | boolean | null | undefined | string[] | unknown[];

export interface FlightChange {
  field: string;
  oldValue: FlightFieldValue;
  newValue: FlightFieldValue;
  type: "added" | "removed" | "changed";
}

const changeKey = (c: { field: string; newValue: unknown }): string =>
  `${c.field}=${JSON.stringify(c.newValue ?? null)}`;

/**
 * Whether the user already rejected exactly this proposal: a rejected update
 * of the flight whose changes cover every proposed field and value. Without it
 * the next poll proposes the same change again and a rejection answers nothing
 * (the historical path skips any rejected flight: `flightEnrichmentService`).
 */
export async function wasAlreadyRejected(
  flightId: string,
  changes: readonly FlightChange[]
): Promise<boolean> {
  if (changes.length === 0) return false;
  const rejected = await prismaClient.pendingFlightUpdate.findMany({
    where: { flightId, status: "rejected" },
    select: { changes: true },
  });
  const wanted = changes.map(changeKey);
  const hit = rejected.some((row) => {
    const had = new Set(
      (Array.isArray(row.changes) ? (row.changes as unknown as FlightChange[]) : []).map(changeKey)
    );
    return wanted.every((k) => had.has(k));
  });
  if (hit) {
    logger.info(
      { flightId, operation: "already_rejected" },
      "Skipping a change the user already rejected"
    );
  }
  return hit;
}
