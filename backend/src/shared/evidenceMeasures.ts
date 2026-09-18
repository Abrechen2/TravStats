/**
 * The evidence surface inventory, in code.
 *
 * MIRRORED at `frontend/src/shared/evidenceMeasures.ts` (and its five sibling
 * `evidenceMeasures*.ts` part files below); change all six together. Each
 * side has its own test of the same truth table — the convention
 * `backend/src/shared/domains.ts` already uses, and nothing checks the
 * mirror itself.
 *
 * This is the output of the walk recorded in
 * `docs/superpowers/specs/2026-09-18-evidence-surface-inventory.md` — read
 * that document for what each key IS, its exact label, and why a number was
 * (or was not) given a key. The first plan guessed seven keys from memory and
 * missed at least six numbers that are on screen; this list is derived from
 * reading every named component instead.
 *
 * `aggregation` follows the table in
 * `docs/superpowers/specs/2026-09-18-evidence-panel-design.md` ("The model:
 * aggregation kinds"). `servedIn` follows the owner's decision of
 * 2026-09-18: release 1 serves `sum` and `distinct` for the `metric` and
 * `ranking` evidence kinds; `extremum`, `ratio`, `boolean` and `sequence`
 * wait for release 2, and so does EVERY measure on the Achievements page —
 * which is why a handful of `sum` keys (the achievement and leaderboard
 * counts, in `evidenceMeasuresAchievements.ts`) are still `servedIn: 2`
 * despite their aggregation: the page they live on, not the shape of the
 * number, decided that.
 *
 * Ranking DIMENSIONS (airline, aircraft, country, ...) are deliberately NOT
 * entries here — a ranking row is addressed by `rankingKey()` from the
 * evidence contract module, not by a measure key. This registry only names
 * single-tile metrics, plus the achievement/leaderboard figures release 2
 * will resolve the same way.
 *
 * Split across five part files (`evidenceMeasuresFlightCore.ts`,
 * `evidenceMeasuresFlightFun.ts`, `evidenceMeasuresCrossDomain.ts`,
 * `evidenceMeasuresDomains.ts`, `evidenceMeasuresAchievements.ts`) rather
 * than kept as one ~1200-line object literal — this file is the single
 * entry point, but `scripts/check-file-size.mjs` caps a new file at 800
 * lines, and a 139-key registry is many small files, not one large one.
 */

import { FLIGHT_CORE_MEASURES } from "./evidenceMeasuresFlightCore";
import { FLIGHT_FUN_MEASURES } from "./evidenceMeasuresFlightFun";
import { CROSS_DOMAIN_MEASURES } from "./evidenceMeasuresCrossDomain";
import { DOMAIN_MEASURES } from "./evidenceMeasuresDomains";
import { ACHIEVEMENT_MEASURES } from "./evidenceMeasuresAchievements";

export type Aggregation = "sum" | "distinct" | "extremum" | "ratio" | "boolean" | "sequence";

/** What population the number was measured over. Mirrors the surface. */
export type MeasureScope = "allTime" | "year" | "rolling12m" | "domainFiltered";

export interface MeasureSpec {
  aggregation: Aggregation;
  /** Free-form but stable — "flights", "km", "minutes", "%", "currency", ... */
  unit: string;
  scope: MeasureScope;
  /** The component that renders the tile. */
  surface: string;
  /** The backend function/endpoint, or the frontend computation when there is no backend rollup. */
  calculator: string;
  servedIn: 1 | 2;
}

export const EVIDENCE_MEASURES: Record<string, MeasureSpec> = {
  ...FLIGHT_CORE_MEASURES,
  ...FLIGHT_FUN_MEASURES,
  ...CROSS_DOMAIN_MEASURES,
  ...DOMAIN_MEASURES,
  ...ACHIEVEMENT_MEASURES,
};
