import { useId } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { HelpIcon } from "../form";
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
export function LodgingStatusTag({
  lodging,
  onRepair,
}: {
  lodging: Lodging;
  /**
   * Given, a house WITHOUT a pin gets a tag that is a button: it opens the
   * in-place repair (forgejo#228) instead of leaving the user to find the edit
   * form and re-save the whole house. A house that has its pin keeps the plain
   * tag - its issue (no street, odd country) is data entry, not a missing point.
   */
  onRepair?: () => void;
}): JSX.Element | null {
  const { t } = useTranslation(["lodging"]);
  const hintId = useId();
  const issue = lodgingIssue(lodging);
  if (!issue) return null;
  // The explanation was a hover-only `title` (forgejo#249). It is now text a
  // screen reader gets with the tag (`aria-describedby` / inline), and `title`
  // stays only as the mouse's extra.
  const hint = t(`lodging:list.status.${issue}Hint`);

  const className =
    "inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-(--bg-elevated) px-2 py-0.5 text-xs text-(--text-muted)";
  const label = t(`lodging:list.status.${issue}`);
  const missingPin = lodging.lat === null || lodging.lon === null;

  if (onRepair && missingPin) {
    return (
      <button
        type="button"
        data-testid={`lodging-repair-${lodging.id}`}
        // A row is clickable as a whole; this must not open the house too.
        onClick={(event) => {
          event.stopPropagation();
          onRepair();
        }}
        aria-label={t("lodging:repair.openFor", { issue: label })}
        aria-describedby={hintId}
        title={hint}
        className={`${className} underline decoration-dotted underline-offset-2 hover:text-(--text-primary) pointer-coarse:min-h-(--ts-size-touch-min)`}
      >
        <span aria-hidden>{LODGING_ISSUE_ICON[issue]}</span>
        {label}
        <span id={hintId} className="sr-only">
          {hint}
        </span>
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <span className={className} title={hint}>
        <span aria-hidden>{LODGING_ISSUE_ICON[issue]}</span>
        {label}
        <span id={hintId} className="sr-only">
          {hint}
        </span>
      </span>
      {/* The same explanation for a finger (forgejo#249): the `title` needs a
          mouse and the sr-only text a screen reader, so a tap-reachable help
          button carries it for everyone else. It sits in a table row that
          opens the house on click and on Enter, so neither may bubble from it. */}
      <span onKeyDown={(event) => event.stopPropagation()}>
        <HelpIcon content={hint} position="bottom" />
      </span>
    </span>
  );
}
