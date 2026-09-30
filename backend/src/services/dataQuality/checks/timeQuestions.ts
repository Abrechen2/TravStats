import type { TimeQuestion } from "../../timeMigration/openQuestions";
import type { DataQualityFinding } from "../types";

/**
 * The time-model backfill's open questions (ADR 0002 phase 3b) as findings.
 *
 * The deciding — is the question still unanswered in the row as it is now —
 * happens where the rows are read (`timeMigration/openQuestions.ts`); this is
 * the one line that hands them to the runner, so the inbox reconciles them
 * like every other check: an answered question is resolved, a dismissed one
 * stays dismissed.
 */
export function findOpenTimeQuestions(questions: readonly TimeQuestion[]): DataQualityFinding[] {
  return questions.map((q) => ({
    entityType: q.entityType,
    entityId: q.entityId,
    kind: q.kind,
    details: q.details,
  }));
}
