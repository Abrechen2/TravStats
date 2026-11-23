import type { CheckCatalogueEntry, CheckId } from "../../shared/readinessCatalogue";
import type { ReadinessContext } from "./context";

export type CheckStatus = "ready" | "needsAction" | "unknown";

/** What an evaluator found. `checkedAt` is the evidence time of a stored result, else null. */
export interface Evaluation {
  status: CheckStatus;
  checkedAt: Date | null;
  /** What the copy counts ("N Bahnfahrten"), where the check counts something. */
  count?: number | null;
}

export interface CheckImpl {
  /** Not applicable → not shown at all. */
  appliesWhen(ctx: ReadinessContext): boolean;
  /** From stored state only: never a network call or a mail. */
  evaluate(ctx: ReadinessContext): Evaluation;
}

export type CheckImpls = Readonly<Record<CheckId, CheckImpl>>;

export interface RegisteredCheck extends CheckCatalogueEntry, CheckImpl {}
