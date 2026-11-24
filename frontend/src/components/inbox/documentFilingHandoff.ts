import type { NewEntryDomain } from "../../lib/api/documents";
import type { ImportDocument } from "../import/documentHandoff";

/**
 * A kept document on its way from the inbox to the import dialog of its domain
 * ("Neu anlegen aus Dokument"). Travels as router state to `/dashboard`, where
 * `DashboardLayout` opens the dialog with the file already dropped into it and,
 * once something was saved, files the document with the new entry.
 *
 * The sibling of `MailIntakeHandoff`: that one carries a proposal's mail, this
 * one a document the user uploaded themselves.
 */
export interface DocumentFilingHandoff {
  documentId: string;
  /** When the user opened the dialog; entries created from then on came from this document. */
  openedAt: string;
  domain: NewEntryDomain;
  document: ImportDocument;
}

export const NEW_ENTRY_DOMAINS: readonly NewEntryDomain[] = [
  "flight",
  "cruise",
  "lodging",
  "rail",
  "rental",
];

export function documentFilingHandoffOf(state: unknown): DocumentFilingHandoff | null {
  const handoff = (state as { documentFilingHandoff?: unknown } | null)?.documentFilingHandoff;
  if (typeof handoff !== "object" || handoff === null) return null;
  const { domain, document, documentId, openedAt } = handoff as Record<string, unknown>;
  const target = NEW_ENTRY_DOMAINS.find((d) => d === domain);
  const file = (document as { file?: unknown } | null)?.file;
  return target &&
    typeof documentId === "string" &&
    typeof openedAt === "string" &&
    (document as { kind?: unknown } | null)?.kind === "file" &&
    file instanceof File
    ? { documentId, openedAt, domain: target, document: document as ImportDocument }
    : null;
}
