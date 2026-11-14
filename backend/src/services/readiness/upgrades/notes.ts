/**
 * The update-note registry (spec 2026-11-14 §3.2): one entry per change that an
 * existing install may need to act on or at least know about, with the
 * predicate that says whom it concerns. The data (ids, versions, copy keys,
 * actions) is `NOTE_CATALOGUE` in `shared/readinessCatalogue.ts`.
 *
 * The 2.8.0 notes are the "Upgrading to …" paragraphs of `CHANGELOG.md`
 * (rc.5, rc.27, rc.29, rc.30). The registry is the source; the CHANGELOG is
 * not machine-checked against it in stage 1 (§9).
 */
import {
  NOTE_CATALOGUE,
  type NoteCatalogueEntry,
  type NoteId,
} from "../../../shared/readinessCatalogue";
import type { ReadinessContext } from "../context";

type AppliesWhen = (ctx: ReadinessContext) => boolean;

const everyone: AppliesWhen = () => true;

/**
 * Whom each note concerns. Exhaustive over `NoteId`, so a note without a
 * predicate does not compile. Where the pre-upgrade state is no longer stored
 * (backups were switchable until rc.29 and the switch is gone) the note applies
 * to every admin rather than to nobody.
 */
const APPLIES_WHEN: Readonly<Record<NoteId, AppliesWhen>> = {
  "2.8.0.settingsRemoved": everyone,
  "2.8.0.backupsAlwaysOn": everyone,
  "2.8.0.retentionScheduledOnly": everyone,
  "2.8.0.friendsMerged": everyone,
  "2.8.0.externalServicesMoved": everyone,
  // An ordinary account's own Immich or Dawarich server: an admin's connection keeps LAN access.
  "2.8.0.ownServersPublic": ({ account, isAdmin }) => account.hasImmichOrDawarich && !isAdmin,
};

export interface RegisteredNote extends NoteCatalogueEntry {
  appliesWhen: AppliesWhen;
}

export const NOTES: readonly RegisteredNote[] = NOTE_CATALOGUE.map((entry) => ({
  ...entry,
  appliesWhen: APPLIES_WHEN[entry.id],
}));
