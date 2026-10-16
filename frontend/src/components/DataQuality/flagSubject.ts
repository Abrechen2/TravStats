import type { DataQualityFlag } from "../../types/dataQuality";
import { TIME_FLAG_KINDS } from "../../types/timeMigration";

import { flaggedRecordPath } from "./flagLinks";
import { HOME_SETTINGS_PATH } from "./HomeResidenceFlag";
import { isRecordCheckKind, recordFlagSubjectPath } from "./recordFlagLinks";
import { isTimeFlagEntityType, isTimeFlagKind, timeFlagEditorPath } from "./timeFlagLinks";

/**
 * Where a flag's subject links to: the record's page, or — for a time value
 * the migration left open, or a field a record check asks for — the editor
 * that can fill it. A country has no page (design §3.4): the records that
 * proved it are listed inside the contradiction and each of those links.
 */
export function flagSubjectPath(flag: DataQualityFlag): string | null {
  if (flag.entityType === "country") return null;
  if (flag.entityType === "home") return HOME_SETTINGS_PATH;
  // A record check (forgejo#282) is asked before the time branch: both sit on
  // rows like `flight`, and only the kind says which link fits.
  if (isRecordCheckKind(flag.kind)) return recordFlagSubjectPath(flag);
  if (isTimeFlagEntityType(flag.entityType)) return timeFlagEditorPath(flag);
  if (flag.entityType === "bus_journey") return null;
  return flaggedRecordPath({ entityType: flag.entityType, entityId: flag.entityId, label: "" });
}

/**
 * What to call the subject on screen. A country arrives as an ISO code with no
 * label (only this side knows the reader's language), a row with the user's own
 * text. A code `Intl` cannot name is never printed bare — "CZ" on the line where
 * a hotel name would stand reads as a hotel called "CZ".
 */
export function flagSubjectLabel(
  flag: DataQualityFlag,
  countryLabel: (code: string) => string,
  unnamed: string,
  home: string
): string {
  const subject = flag.subject;
  if (subject?.entityType === "country") return countryLabel(subject.countryCode);
  if (flag.entityType === "country") return countryLabel(flag.entityId);
  if (subject?.entityType === "home" || flag.entityType === "home") return home;
  return subject?.label || unnamed;
}

/**
 * Which kind of question a flag asks. A time question (ADR 0002 phase 3b) is
 * not a contradiction — nothing disagrees, something is missing — and neither
 * is the home question or a record check (forgejo#282). Calling them all "two
 * values contradict each other" was simply untrue.
 */
export type FlagQuestionGroup = "contradictions" | "records" | "home" | "time";

export function flagQuestionGroup(flag: DataQualityFlag): FlagQuestionGroup {
  if ((TIME_FLAG_KINDS as readonly string[]).includes(flag.kind)) return "time";
  if (flag.kind === "home_residence_unconfirmed") return "home";
  if (isRecordCheckKind(flag.kind)) return "records";
  return "contradictions";
}

/** The sentence that says nothing was changed, in the words that fit the question. */
export function flagUnchangedKey(flag: DataQualityFlag): string {
  if (isTimeFlagKind(flag.kind)) return "dataQuality:flag.timeUnchanged";
  if (flag.kind === "home_residence_unconfirmed")
    return "dataQuality:kinds.home_residence_unconfirmed.unchanged";
  if (isRecordCheckKind(flag.kind)) return "dataQuality:flag.recordUnchanged";
  return "dataQuality:flag.neitherIsCorrect";
}

/** The group's sentence: the contradictions keep the section's own description. */
export function flagGroupDescriptionKey(group: FlagQuestionGroup): string {
  return group === "contradictions"
    ? "dataQuality:inbox.review.description"
    : `dataQuality:inbox.review.${group}.description`;
}
