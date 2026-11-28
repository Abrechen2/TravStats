import type {
  FieldChoice,
  LinkConflictView,
  LinkDecision,
  LinkValue,
} from "../../types/sharingLink";
import { formatShareValue, shareFieldLabel } from "./noticeValues";

type Translate = (key: string, options?: Record<string, unknown>) => string;

const NS = "sharing:link";

/**
 * The link dry run in words (UAT 2026-11-27, M3): a time in the place's zone through the app's own
 * formatter, a line as "gezeichnet (184 Punkte)" instead of coordinate JSON, and every field by its
 * DE/EN label — a group (`geometry`, `checkIn`) by the link's own label, since a house's
 * `sharing:fields.lodging` is a list of labels, not one.
 */
export function formatLinkValue(value: LinkValue, locale: string, t: Translate): string {
  if (value.kind === "line") {
    if (value.quality === "none") return t(`${NS}.line.none`);
    const quality = t(`${NS}.line.${value.quality}`);
    if (value.lines !== undefined)
      return t(`${NS}.line.lines`, { quality, count: value.lines, points: value.points });
    return t(`${NS}.line.single`, { quality, points: value.points });
  }
  return formatShareValue(value, locale, t);
}

/** The label of a differing field or group. */
export function linkFieldLabel(field: string, t: Translate): string {
  const group = t(`${NS}.fieldGroups.${field}`, { defaultValue: "" });
  return group !== "" ? group : shareFieldLabel(field, t);
}

/**
 * What a field starts at: the better value ("genauer") whatever the trip-level decision — sharing
 * UAT 2 found "Jeder behält seine" preselected beside a value marked better. A tie follows the
 * decision. The panel sends every pick explicitly, so the server does what the select shows.
 */
export function defaultFieldChoice(
  decision: LinkDecision,
  conflict: Pick<LinkConflictView, "better">
): FieldChoice {
  if (conflict.better === "here") return "mine";
  if (conflict.better === "there") return "theirs";
  return decision === "best" ? "both" : decision;
}
