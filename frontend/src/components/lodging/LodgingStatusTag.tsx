import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { lodgingIssue, LODGING_ISSUE_ICON } from "./lodgingCompleteness";
import type { Lodging } from "../../types/lodging";

/**
 * What a lodging row still needs, as one tag — or nothing at all.
 *
 * Neutral surface and an icon carry the state, never colour on its own
 * (BRAND.md's "don't"-list), and the same neutral chip the flight data-source
 * badges use, so a table does not sprout a second badge language.
 *
 * Rendering nothing for a sound row is the point, not an omission: 267 of 291
 * rows in a real list are complete, and a confirmation on every one of them
 * would bury the 24 that need a visit.
 */
export function LodgingStatusTag({ lodging }: { lodging: Lodging }): JSX.Element | null {
  const { t } = useTranslation(["lodging"]);
  const issue = lodgingIssue(lodging);
  if (!issue) return null;

  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-(--bg-elevated) px-2 py-0.5 text-xs text-(--text-muted)"
      title={t(`lodging:list.status.${issue}Hint`)}
    >
      <span aria-hidden>{LODGING_ISSUE_ICON[issue]}</span>
      {t(`lodging:list.status.${issue}`)}
    </span>
  );
}

export default LodgingStatusTag;
