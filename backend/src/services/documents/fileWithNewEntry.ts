import { entryCreatedSince } from "../mailIntake/inbox";
import { getOwnDocument, linkDocuments } from "./documentService";
import type { EntryRef } from "./documentLinks";

export type NewEntryDomain = "flight" | "cruise" | "lodging" | "rail" | "rental";

/**
 * Files a kept document with the entry the user created from it ("Neu anlegen
 * aus Dokument"). The import dialogs create entries through domain routes that
 * hand no id back, so the entry is the first of the domain the account created
 * since `openedAt` — the lookup a proposal's mail uses. Null when none was
 * created: the document stays where it was, and the caller says so.
 *
 * A document already filed elsewhere answers 409 rather than being moved.
 */
export async function fileDocumentWithNewEntry(
  userId: string,
  documentId: string,
  domain: NewEntryDomain,
  openedAt: Date
): Promise<EntryRef | null> {
  const document = await getOwnDocument(userId, documentId);
  const entry = await entryCreatedSince(userId, domain, openedAt);
  if (!entry) return null;
  const ref: EntryRef = { type: entry.type, id: entry.id };
  await linkDocuments(userId, [document.id], ref);
  return ref;
}
