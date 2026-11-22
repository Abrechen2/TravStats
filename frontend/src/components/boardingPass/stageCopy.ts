import type { BoardingPassStage } from "../../lib/api/types";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The sentence for one reading stage, in the reader's language.
 *
 * The server sends a stable code per stage and never prose; this is the one
 * place that turns it into words. An unknown code (a newer server) falls back
 * to the stage's status rather than printing the code itself.
 */
export function stageMessage(stage: BoardingPassStage, t: Translate): string {
  const fields = (stage.fields ?? [])
    .map((f) => t(`flights:scanner.field.${f}`, { defaultValue: f }))
    .join(", ");
  const key = `flights:scanner.code.${stage.code}`;
  const text = t(key, { count: stage.count ?? 1, fields, defaultValue: "" });
  return text === "" || text === key ? t(`flights:scanner.stage.${stage.stage}`) : text;
}

/** A stage the user must act on (or know about): failed, or only partly done. */
export function stageNeedsAttention(stage: BoardingPassStage): boolean {
  return stage.status === "failed" || stage.status === "partial";
}

/** The stages a failed request carried in its error body, when it carried any. */
export function stagesOfError(err: unknown): BoardingPassStage[] {
  const stages = (err as { response?: { data?: { stages?: unknown } } } | undefined)?.response?.data
    ?.stages;
  return Array.isArray(stages) ? (stages as BoardingPassStage[]) : [];
}
