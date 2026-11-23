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
  operator?: string;
  operatorSource: string | null;
}

/**
 * The operator columns for a write. `typed` is the operator the request carries
 * (undefined = not part of the request). A typed value clears the source; a
 * blank one is inferred when the evidence allows, else stays blank.
 */
export function operatorColumnsFor(
  typed: string | null | undefined,
  evidence: RailInferenceInput
): InferredOperatorColumns | null {
  if (typed && typed.trim() !== "") return { operatorSource: null };
  if (typed === undefined) return null;
  const inferred = inferRailOperator(evidence);
  return inferred
    ? { operator: inferred, operatorSource: OPERATOR_SOURCE_INFERRED }
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
