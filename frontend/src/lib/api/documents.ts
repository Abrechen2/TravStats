import type { AxiosError } from "axios";

import { API_URL, api } from "./client";

/**
 * Kept originals, from the web.
 *
 * `backend/src/routes/documents.ts` (forgejo#116) has served these endpoints
 * since 2026-09-16 and the Companion has used them since, but the browser had
 * no surface at all: the 2.7.0 what's-new promises "Bordkarten,
 * Hotelrechnungen und Buchungsbestätigungen liegen jetzt als Dokumente am
 * Eintrag, zu dem sie gehören", and the beta audit of 2026-09-19 measured zero
 * hits for `/documents` under `frontend/src`. This module is the missing half.
 *
 * The types mirror `backend/src/schemas/document.ts`; the router answers in the
 * `{success, data}` family (ADR 0001), so every read here unwraps `.data.data`.
 */

export const DOCUMENT_FORMATS = ["image", "pdf", "eml", "emailText", "pkpass"] as const;
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];

export const DOCUMENT_KINDS = ["invoice", "booking", "boardingPass", "ticket", "other"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** The entries a document can be filed with — at most one of them. */
export const DOCUMENT_ENTRY_TYPES = [
  "flight",
  "cruise",
  "lodgingStay",
  "placeVisit",
  "trip",
] as const;
export type DocumentEntryType = (typeof DOCUMENT_ENTRY_TYPES)[number];

export interface DocumentEntryRef {
  type: DocumentEntryType;
  id: string;
}

/** Mirrors `toDocumentDto` in `backend/src/services/documents/documentService.ts`. */
export interface TravelDocument {
  id: string;
  format: DocumentFormat;
  kind: DocumentKind | null;
  mimetype: string;
  sizeBytes: number;
  sha256: string;
  originalName: string | null;
  /** What to call it on screen — already resolved server-side. */
  displayName: string;
  issuedOn: string | null;
  source: string;
  parsedDomain: string | null;
  entry: DocumentEntryRef | null;
  createdAt: string;
  linkedAt: string | null;
  /** Absolute API path of the bytes, `/api/v1/documents/:id/file`. */
  url: string;
}

/**
 * An unfiled document, as `GET /documents/unfiled` lists it.
 *
 * `deletesAt` is the date the server's hourly sweep will remove it, row and
 * bytes, counted from when it BECAME unfiled rather than from its upload. It
 * is the reason the endpoint exists: the sweep used to be silent, so an upload
 * that was never filed vanished after a week without anyone being told
 * (2026-09-19 integrity audit, finding 4).
 *
 * Null when the server cannot date the row — which the sweep also abstains on,
 * so the screen and the deletion agree. Nothing produces such a row today.
 */
export interface UnfiledDocument extends TravelDocument {
  deletesAt: string | null;
}

/** Bytes, per format. */
export type DocumentLimits = Record<DocumentFormat, number>;

interface Envelope<T> {
  success: boolean;
  data: T;
}

/**
 * Where each entry type lists its documents. The five prefixes are the
 * router's `ENTRY_LIST_PATHS`, spelled out here rather than derived, because a
 * derivation would have to invent the plural and the `lodging/stays` nesting.
 */
const ENTRY_LIST_PATH: Record<DocumentEntryType, (id: string) => string> = {
  flight: (id) => `/flights/${id}/documents`,
  cruise: (id) => `/cruises/${id}/documents`,
  lodgingStay: (id) => `/lodging/stays/${id}/documents`,
  placeVisit: (id) => `/places/visits/${id}/documents`,
  trip: (id) => `/trips/${id}/documents`,
};

export function documentListPath(entry: DocumentEntryRef): string {
  return ENTRY_LIST_PATH[entry.type](encodeURIComponent(entry.id));
}

/**
 * Where a browser fetches the bytes.
 *
 * A plain link, not a blob fetch: the JWT is an HttpOnly cookie, and a
 * top-level navigation carries it. `API_URL` is empty in production (same
 * origin) and set only when the dev frontend talks to a backend on another
 * port.
 */
export function documentFileUrl(document: TravelDocument): string {
  return API_URL ? `${API_URL}${document.url}` : document.url;
}

export interface UploadDocumentInput {
  entry: DocumentEntryRef;
  file: File;
  kind?: DocumentKind;
  /** YYYY-MM-DD. */
  issuedOn?: string;
}

/**
 * How long a document upload may take, overriding the shared instance's 10 s.
 *
 * That default is set up for reads. A 10 MB scan — the largest the server
 * accepts for an image or a PDF — outruns it on any domestic uplink, and the
 * request the browser abandons is one the server has already stored: the user
 * sees a failure, tries again, and the second send is deduplicated by sha256
 * into the same document. So the visible result was an error message over a
 * file that had in fact arrived.
 */
const DOCUMENT_UPLOAD_TIMEOUT_MS = 120_000;

/**
 * The limits are instance constants, so one answer serves every section on the
 * page. Without the cache a place with six visits asked six times for the same
 * five numbers. A rejection is NOT kept: a failed probe must be retryable.
 */
let limitsRequest: Promise<DocumentLimits> | null = null;

export const documentsApi = {
  listForEntry: async (entry: DocumentEntryRef): Promise<TravelDocument[]> => {
    const { data } = await api.get<Envelope<TravelDocument[]>>(documentListPath(entry));
    return data.data;
  },

  /** The caller's own unfiled uploads, newest first. */
  listUnfiled: async (): Promise<UnfiledDocument[]> => {
    const { data } = await api.get<Envelope<UnfiledDocument[]>>("/documents/unfiled");
    return data.data;
  },

  limits: (): Promise<DocumentLimits> => {
    if (!limitsRequest) {
      limitsRequest = api
        .get<Envelope<DocumentLimits>>("/documents/limits")
        .then((response) => response.data.data)
        .catch((error: unknown) => {
          limitsRequest = null;
          throw error;
        });
    }
    return limitsRequest;
  },

  upload: async ({ entry, file, kind, issuedOn }: UploadDocumentInput): Promise<TravelDocument> => {
    const form = new FormData();
    form.append("file", file);
    form.append("entryType", entry.type);
    form.append("entryId", entry.id);
    if (kind) form.append("kind", kind);
    if (issuedOn) form.append("issuedOn", issuedOn);
    // No explicit `format`: the server decides from the BYTES and treats a
    // declaration as a hint, so sending our guess could only ever disagree.
    //
    // No Content-Type either. A multipart type without a boundary is an
    // unparsable request; the platform writes the real one, and axios scrubs
    // anything we put there first (helpers/resolveConfig.js) — so a hand-set
    // header is either ignored or wrong, never right.
    const { data } = await api.post<Envelope<TravelDocument>>("/documents", form, {
      timeout: DOCUMENT_UPLOAD_TIMEOUT_MS,
    });
    return data.data;
  },

  remove: async (id: string): Promise<void> => {
    await api.delete(`/documents/${id}`);
  },
};

/**
 * The shared demo account's 403, told apart from every other 403.
 *
 * `middleware/demoGuard.ts` answers `{error: "DEMO_ACCOUNT_FORBIDDEN"}`. That
 * code is a machine word; showing it to a visitor of a public preview is how a
 * refusal turns into a bug report, so callers map it to the sentence the rest
 * of the app already uses.
 */
export function isDemoForbidden(error: unknown): boolean {
  const response = (error as AxiosError<{ error?: string }> | undefined)?.response;
  return response?.status === 403 && response.data?.error === "DEMO_ACCOUNT_FORBIDDEN";
}
