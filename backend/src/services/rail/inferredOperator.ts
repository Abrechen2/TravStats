/**
 * Writes the operator `shared/railOperatorInference.ts` names for a journey
 * whose operator was never typed. A typed operator always wins: the inference
 * fills a blank, marks it `operatorSource = "inferred"`, and the backfill never
 * touches a row that has an operator or a source already.
 */
import { prisma } from "../../db";
import logger from "../../utils/logger";
import {
  inferRailOperator,
  OPERATOR_SOURCE_INFERRED,
  type RailInferenceInput,
} from "../../shared/railOperatorInference";

const BATCH = 200;

export interface InferredOperatorColumns {
  operator?: string | null;
  operatorSource: string | null;
}

/**
 * The operator columns for a write, or null to leave them alone.
 *
 * `typed` is the operator the request carries (undefined = not in the request);
 * `stored` is the row before an edit (undefined on create). The edit form
 * resends the stored operator on every save, so a value equal to a stored
 * INFERRED one keeps its mark instead of becoming "entered" by a notes edit.
 * An inferred value is recomputed whenever the evidence is — a train changed
 * to RE no longer carries "DB Fernverkehr" — and cleared when nothing names it.
 */
export function operatorColumnsFor(
  typed: string | null | undefined,
  evidence: RailInferenceInput,
  stored?: { operator: string | null; operatorSource: string | null }
): InferredOperatorColumns | null {
  const storedInferred = stored?.operatorSource === OPERATOR_SOURCE_INFERRED;
  const value = typed?.trim() ?? (typed === undefined ? undefined : "");
  if (value) {
    return storedInferred && value === stored?.operator ? null : { operatorSource: null };
  }
  // Blank typed, or none sent while a stored inference may have gone stale.
  if (typed === undefined && !storedInferred) return null;
  const inferred = inferRailOperator(evidence);
  if (inferred) return { operator: inferred, operatorSource: OPERATOR_SOURCE_INFERRED };
  return typed === undefined || storedInferred
    ? { operator: null, operatorSource: null }
    : { operatorSource: null };
}

export interface OperatorBackfillReport {
  examined: number;
  inferred: number;
}

/** One-off: every journey without an operator gets the inferred one, in batches. */
export async function backfillInferredRailOperators(
  options: { userId?: string } = {}
): Promise<OperatorBackfillReport> {
  const report: OperatorBackfillReport = { examined: 0, inferred: 0 };
  let after: string | undefined;
  for (;;) {
    const rows = await prisma.railJourney.findMany({
      where: {
        operatorSource: null,
        OR: [{ operator: null }, { operator: "" }],
        trainCategory: { not: null },
        ...(options.userId && { userId: options.userId }),
      },
      select: {
        id: true,
        trainCategory: true,
        trainNumber: true,
        depCountry: true,
        arrCountry: true,
        depStationName: true,
        arrStationName: true,
      },
      orderBy: { id: "asc" },
      take: BATCH,
      ...(after && { cursor: { id: after }, skip: 1 }),
    });
    if (rows.length === 0) break;
    after = rows[rows.length - 1].id;
    for (const row of rows) {
      report.examined += 1;
      const operator = inferRailOperator(row);
      if (!operator) continue;
      // share-exempt: the operator is a derived label, not a shared fact; a copy infers its own
      // The guard repeats the where: a user who typed one meanwhile is not overwritten.
      const { count } = await prisma.railJourney.updateMany({
        where: {
          id: row.id,
          operatorSource: null,
          OR: [{ operator: null }, { operator: "" }],
        },
        data: { operator, operatorSource: OPERATOR_SOURCE_INFERRED },
      });
      report.inferred += count;
    }
  }
  if (report.examined > 0) {
    logger.info({ operation: "rail_operator_backfill", ...report }, "Rail operator backfill done");
  }
  return report;
}
