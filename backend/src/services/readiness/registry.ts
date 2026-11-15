/**
 * The readiness check registry (spec 2026-11-14 §3.1, §5): the catalogue's data
 * (`shared/readinessCatalogue.ts`) joined to its evaluators (`checkImpls.ts`).
 * Pattern: `services/sharing/shareTypes.ts` — an exhaustive mapping plus a test
 * (`__tests__/readiness.contract.test.ts`).
 */
import { CHECK_CATALOGUE } from "../../shared/readinessCatalogue";
import { CHECK_IMPLS } from "./checkImpls";
import type { RegisteredCheck } from "./types";

export const CHECKS: readonly RegisteredCheck[] = CHECK_CATALOGUE.map((entry) => ({
  ...entry,
  ...CHECK_IMPLS[entry.id],
}));
