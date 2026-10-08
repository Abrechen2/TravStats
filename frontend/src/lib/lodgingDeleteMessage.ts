import { countedDeleteMessage, survivorsNote, withDocumentNote } from "./deleteConfirm";
import type { Lodging } from "../types/lodging";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** What `useLodgingDeleteFacts` found out; `null` / empty = not known. */
export interface LodgingDeleteFacts {
  /** Kept originals of ALL the house's stays; they are deleted with it. */
  documentCount: number | null;
  /** The house's own photographs; deleted with it, files included. */
  photoCount: number | null;
  /** Names of the trips the stays were linked to; they stay. */
  tripNames: readonly string[];
}

/**
 * The sentence the house-delete confirmation says - on the list AND on the
 * detail page, from one function so the two cannot drift again (they had
 * drifted before: the list rendered a literal "{{name}}" once).
 *
 * The shape is the one `deleteConfirm.ts` describes: what goes (the house, its
 * stays, its photographs, their kept originals) and what stays (the trips, the
 * chain). Lines for facts that are not known yet are simply absent.
 */
export function lodgingDeleteMessage(
  t: Translate,
  lodging: Pick<Lodging, "name" | "stayCount" | "chain">,
  facts: LodgingDeleteFacts
): string {
  const base = countedDeleteMessage(
    t,
    {
      counted: "lodging:detail.deleteConfirmMessage",
      empty: "lodging:detail.deleteConfirmMessageNoStays",
    },
    lodging.name,
    lodging.stayCount
  );
  const withPhotos =
    facts.photoCount !== null && facts.photoCount > 0
      ? `${base}\n${t("lodging:detail.deletePhotosNote", { count: facts.photoCount })}`
      : base;
  const withDocuments = withDocumentNote(withPhotos, t, facts.documentCount);
  const survivors = survivorsNote(t, [
    ...facts.tripNames,
    ...(lodging.chain ? [t("lodging:detail.survivorChain", { name: lodging.chain.name })] : []),
  ]);
  return survivors === null ? withDocuments : `${withDocuments}\n${survivors}`;
}
