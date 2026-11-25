import type { NewEntryDomain } from "../../lib/api/documents";
import type { ImportDocument } from "../import/documentHandoff";
import type { DocumentReading } from "./unfiled/documentReading";

/**
 * A kept document on its way from the inbox to the import dialog of its domain
 * ("Neu anlegen aus Dokument"). Travels as router state to `/dashboard`, where
 * `DashboardLayout` opens the dialog with the file already dropped into it; the
 * request that creates the entry carries the document's id (`lib/api/filingDocument`).
 *
 * The sibling of `MailIntakeHandoff`: that one carries a proposal's mail, this
 * one a document the user uploaded themselves.
 */
export interface DocumentFilingHandoff {
  documentId: string;
  domain: NewEntryDomain;
  document: ImportDocument;
  /**
   * What the inbox already read from it (found something): the import dialog
   * opens on this reading instead of reading the file a second time.
   */
  reading?: DocumentReading;
  /**
   * The reader found nothing and the user chose "create empty with the
   * document": the domain's empty form opens, and its save still files the document.
   */
  manual?: boolean;
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
  const { domain, document, documentId, reading, manual } = handoff as Record<string, unknown>;
  const target = NEW_ENTRY_DOMAINS.find((d) => d === domain);
  const file = (document as { file?: unknown } | null)?.file;
  return target &&
    typeof documentId === "string" &&
    (document as { kind?: unknown } | null)?.kind === "file" &&
    file instanceof File
    ? {
        documentId,
        domain: target,
        document: document as ImportDocument,
        ...(isReading(reading) ? { reading } : {}),
        ...(manual === true ? { manual: true } : {}),
      }
    : null;
}

function isReading(value: unknown): value is DocumentReading {
  if (typeof value !== "object" || value === null) return false;
  const { kind, result } = value as Record<string, unknown>;
  return (kind === "pdf" || kind === "email") && typeof result === "object" && result !== null;
}
