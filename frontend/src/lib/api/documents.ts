import type { AxiosError } from "axios";

import { API_URL, api } from "./client";
import type { ExtractValuesRequest, ExtractValuesResult } from "../extractValues";

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

export const DOCUMENT_FORMATS = ["image", "pdf", "eml", "emailText", "pkpass", "gpx"] as const;
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
  "railJourney",
  "rentalBooking",
  "busJourney",
  "ferryJourney",
  "tripExpense",
  "tour",
] as const;
export type DocumentEntryType = (typeof DOCUMENT_ENTRY_TYPES)[number];

export interface DocumentEntryRef {
  type: DocumentEntryType;
  id: string;
}

/**
 * What a rental's hand-over evidence shows (forgejo#239). Mirrors
 * `RENTAL_DOCUMENT_CATEGORIES` in backend/src/services/documents/documentFormats.ts.
 */
export const RENTAL_DOCUMENT_CATEGORIES = [
  "pickup",
  "return",
  "damage",
  "fuel",
  "odometer",
] as const;
export type RentalDocumentCategory = (typeof RENTAL_DOCUMENT_CATEGORIES)[number];

/** Mirrors `toDocumentDto` in `backend/src/services/documents/documentService.ts`. */
export interface TravelDocument {
  id: string;
  format: DocumentFormat;
  kind: DocumentKind | null;
  mimetype: string;
  sizeBytes: number;
  sha256: string;
  originalName: string | null;
  /** The owner's own remark; null/absent = none. */
  note?: string | null;
  /** What to call it on screen — already resolved server-side. */
  displayName: string;
  issuedOn: string | null;
  /** A rental's evidence category; null = uncategorised (forgejo#239). Absent from older servers. */
  rentalCategory?: RentalDocumentCategory | null;
  source: string;
  parsedDomain: string | null;
  entry: DocumentEntryRef | null;
  createdAt: string;
  linkedAt: string | null;
  /** Absolute API path of the bytes, `/api/v1/documents/:id/file`. */
  url: string;
  /**
   * Only in a per-entry list (plan D2), and absent from older servers: the
   * document's role at THIS entry — filed here (`primary`) or evidence for it
   * (`covers`).
   */
  linkRole?: LinkRole;
  /** For a `covers` document, the entry it was filed at ("Beleg aus …"). */
  evidenceFrom?: DocumentEntryInfo | null;
  /** How many entries the document is linked to. */
  linkCount?: number;
  /**
   * Plan D7, per-entry lists only: the companion this document is for AT THIS
   * entry; null = the owner or the whole group. Absent from older servers.
   */
  forCompanion?: { id: string; displayName: string } | null;
  /** How the person was set: auto (a parsed name), user, or null = undecided. */
  forSource?: "user" | "auto" | null;
  /** `GET /documents` only: the companions it is assigned to on any entry. */
  people?: Array<{ id: string; displayName: string }>;
  /** Reaches this entry only through an expense paid at it (forgejo#429): no link to remove. */
  viaExpense?: boolean;
}

export type LinkRole = "primary" | "covers";
export type LinkProvenance = "user" | "parser" | "suggestion" | "legacy";

/** An entry as a document's links name it: a label and the id its page needs. */
export interface DocumentEntryInfo extends DocumentEntryRef {
  label: string;
  /** A stay's lodging, a visit's place, an expense's trip. */
  parentId: string | null;
}

export interface DocumentEntryCandidate extends DocumentEntryInfo {
  tripId: string | null;
}

export interface DocumentLinkView {
  id: string;
  role: LinkRole;
  provenance: LinkProvenance;
  rentalCategory: RentalDocumentCategory | null;
  createdAt: string;
  entry: DocumentEntryCandidate;
  companion?: { id: string; displayName: string } | null;
  companionSource?: "user" | "auto" | null;
}

/** What `DELETE /documents/:id/links` removed — enough to put exactly that back. */
export interface RemovedDocumentLink {
  role: LinkRole;
  provenance: LinkProvenance;
  rentalCategory: RentalDocumentCategory | null;
  entry: DocumentEntryRef;
}

export interface DocumentLinkCandidates {
  tripEntries: DocumentEntryCandidate[];
  otherEntries: DocumentEntryCandidate[];
}

export interface NewDocumentLink {
  entry: DocumentEntryRef;
  role?: LinkRole;
  provenance?: LinkProvenance;
  rentalCategory?: RentalDocumentCategory | null;
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

/**
 * The list plus the number of days it is about.
 *
 * `ttlDays` is sent rather than written into the locale files: the sentence on
 * screen names the number, and a "30" typed into two JSON files is a 30 that
 * goes on being shown after `UNLINKED_TTL_DAYS` changes.
 */
export interface UnfiledDocuments {
  ttlDays: number;
  documents: UnfiledDocument[];
}

export interface UpdateDocumentInput {
  displayName?: string;
  /** The owner's remark; null or blank clears it. */
  note?: string | null;
  kind?: DocumentKind | null;
  /** YYYY-MM-DD, or null to clear. */
  issuedOn?: string | null;
}

/** The domains whose import dialog can read a document and create an entry from it. */
export type NewEntryDomain = "flight" | "cruise" | "lodging" | "rail" | "rental";

/** Bytes, per format. */
export type DocumentLimits = Record<DocumentFormat, number>;

interface Envelope<T> {
  success: boolean;
  data: T;
}

/**
 * Where each entry type lists its documents. The prefixes are the
 * router's `ENTRY_LIST_PATHS`, spelled out here rather than derived, because a
 * derivation would have to invent the plural and the `lodging/stays` nesting.
 */
const ENTRY_LIST_PATH: Record<DocumentEntryType, (id: string) => string> = {
  flight: (id) => `/flights/${id}/documents`,
  cruise: (id) => `/cruises/${id}/documents`,
  lodgingStay: (id) => `/lodging/stays/${id}/documents`,
  placeVisit: (id) => `/places/visits/${id}/documents`,
  trip: (id) => `/trips/${id}/documents`,
  railJourney: (id) => `/rail/${id}/documents`,
  rentalBooking: (id) => `/rentals/${id}/documents`,
  busJourney: (id) => `/bus/${id}/documents`,
  ferryJourney: (id) => `/ferry/${id}/documents`,
  // A roadtrip or trip cost's receipt (forgejo#150).
  tripExpense: (id) => `/expenses/${id}/documents`,
  // A roadtrip or day tour (its TripRoute id; GitHub #415).
  tour: (id) => `/tours/${id}/documents`,
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
/**
 * Where opening a document goes. A mail opens as the server's plain-text
 * reading of it (`?view=text`): the `.eml` itself is a download, and a link
 * that only downloads left a booking confirmation impossible to look at.
 */
export function documentFileUrl(document: TravelDocument): string {
  const url = documentDownloadUrl(document);
  return document.format === "eml" ? `${url}?view=text` : url;
}

/** The stored original's bytes, as kept. */
export function documentDownloadUrl(document: TravelDocument): string {
  return API_URL ? `${API_URL}${document.url}` : document.url;
}

export interface UploadDocumentInput {
  /** Absent: the document is kept unfiled, in the inbox's "nicht zugeordnet" list. */
  entry?: DocumentEntryRef;
  file: File;
  kind?: DocumentKind;
  /** YYYY-MM-DD. */
  issuedOn?: string;
  /** Only with a rentalBooking entry (forgejo#239). */
  rentalCategory?: RentalDocumentCategory;
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

async function postDocument(form: FormData): Promise<{ document: TravelDocument; status: number }> {
  const { data, status } = await api.post<Envelope<TravelDocument>>("/documents", form, {
    timeout: DOCUMENT_UPLOAD_TIMEOUT_MS,
    headers: { "Content-Type": "multipart/form-data" },
  });
  return { document: data.data, status };
}

export const documentsApi = {
  listForEntry: async (entry: DocumentEntryRef): Promise<TravelDocument[]> => {
    const { data } = await api.get<Envelope<TravelDocument[]>>(documentListPath(entry));
    return data.data;
  },

  /** Plan D7: who the document is for at ONE entry; null = me / the whole group. */
  assignCompanion: async (
    id: string,
    entry: DocumentEntryRef,
    companionId: string | null
  ): Promise<{ companionId: string | null; companionSource: "user" | "auto" | null }> => {
    const { data } = await api.put<
      Envelope<{ companionId: string | null; companionSource: "user" | "auto" | null }>
    >(`/documents/${id}/links/companion`, { entry, companionId });
    return data.data;
  },

  /** Every document the user owns, filed or not, page by page — metadata only (spreadsheet export). */
  listEvery: async (companionId?: string): Promise<TravelDocument[]> => {
    const PAGE = 500;
    const documents: TravelDocument[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data } = await api.get<Envelope<{ documents: TravelDocument[]; total: number }>>(
        "/documents",
        { params: { limit: PAGE, offset, ...(companionId ? { companionId } : {}) } }
      );
      documents.push(...data.data.documents);
      if (data.data.documents.length < PAGE || documents.length >= data.data.total) {
        return documents;
      }
    }
  },

  /** The caller's own unfiled uploads, newest first, with the TTL they face. */
  listUnfiled: async (): Promise<UnfiledDocuments> => {
    const { data } = await api.get<Envelope<UnfiledDocuments>>("/documents/unfiled");
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

  upload: async ({
    entry,
    file,
    kind,
    issuedOn,
    rentalCategory,
  }: UploadDocumentInput): Promise<TravelDocument> => {
    const form = new FormData();
    form.append("file", file);
    if (entry) {
      form.append("entryType", entry.type);
      form.append("entryId", entry.id);
    }
    if (kind) form.append("kind", kind);
    if (issuedOn) form.append("issuedOn", issuedOn);
    if (rentalCategory) form.append("rentalCategory", rentalCategory);
    // No explicit `format`: the server decides from the BYTES and treats a
    // declaration as a hint, so sending our guess could only ever disagree.
    //
    // The multipart type is named on purpose. The shared axios instance sets
    // `application/json` for every request, so leaving the header alone sent
    // this FormData under a JSON header and the route answered "No file
    // uploaded" — every web document upload failed (beta.28 UAT, broken since
    // 2026-09-19). Naming `multipart/form-data` lets axios recognise the
    // FormData and write the boundary itself, as the photo uploaders do
    // (`uploadLodgingPhotos` in lodging.ts says why).
    return (await postDocument(form)).document;
  },

  /**
   * An upload into the unassigned list that also says whether these BYTES were
   * already on file there: the server answers 200 with the existing document
   * for a repeat, 201 for a new one.
   */
  uploadUnfiled: async (
    file: File
  ): Promise<{ document: TravelDocument; alreadyThere: boolean }> => {
    const form = new FormData();
    form.append("file", file);
    const { document, status } = await postDocument(form);
    return { document, alreadyThere: status === 200 };
  },

  /** Re-file a rental's evidence under another category, or none (null) — the same document. */
  setRentalCategory: async (
    id: string,
    rentalCategory: RentalDocumentCategory | null
  ): Promise<TravelDocument> => {
    const { data } = await api.patch<Envelope<TravelDocument>>(`/documents/${id}`, {
      rentalCategory,
    });
    return data.data;
  },

  /** Title, date and kind of ONE document (`PATCH /documents/:id`); a field left out stays. */
  update: async (id: string, patch: UpdateDocumentInput): Promise<TravelDocument> => {
    const { data } = await api.patch<Envelope<TravelDocument>>(`/documents/${id}`, patch);
    return data.data;
  },

  /** The stored bytes, for handing a kept document to an import dialog. */
  fetchFile: async (id: string): Promise<Blob> => {
    const { data } = await api.get<Blob>(`/documents/${id}/file`, { responseType: "blob" });
    return data;
  },

  remove: async (id: string): Promise<void> => {
    await api.delete(`/documents/${id}`);
  },

  /** Every entry the document is linked to — the delete-everywhere dialog lists these. */
  links: async (id: string): Promise<DocumentLinkView[]> => {
    const { data } = await api.get<Envelope<DocumentLinkView[]>>(`/documents/${id}/links`);
    return data.data;
  },

  /** With `q` the server searches ALL the account's entries by label, not just the recent ones. */
  linkCandidates: async (id: string, q?: string): Promise<DocumentLinkCandidates> => {
    const { data } = await api.get<Envelope<DocumentLinkCandidates>>(
      `/documents/${id}/link-candidates`,
      { params: q?.trim() ? { q: q.trim() } : undefined }
    );
    return data.data;
  },

  /** The documents of the entry's own trip it is not linked to yet. */
  tripCandidates: async (entry: DocumentEntryRef): Promise<TravelDocument[]> => {
    const { data } = await api.get<Envelope<TravelDocument[]>>("/documents/trip-candidates", {
      params: { entryType: entry.type, entryId: entry.id },
    });
    return data.data;
  },

  addLinks: async (id: string, links: NewDocumentLink[]): Promise<DocumentLinkView[]> => {
    const { data } = await api.post<Envelope<DocumentLinkView[]>>(`/documents/${id}/links`, {
      links,
    });
    return data.data;
  },

  /** Removes the link to ONE entry; the document and its other links stay. */
  unlinkFromEntry: async (id: string, entry: DocumentEntryRef): Promise<RemovedDocumentLink> => {
    const { data } = await api.delete<Envelope<RemovedDocumentLink>>(`/documents/${id}/links`, {
      params: { entryType: entry.type, entryId: entry.id },
    });
    return data.data;
  },

  /**
   * The parser run on a kept document, answering the cost-block values as a
   * proposal (`POST /documents/:id/extract-values`). Parsing can take a minute
   * with a language model behind it, hence the long timeout and the signal.
   */
  extractValues: async (
    id: string,
    body: ExtractValuesRequest,
    signal?: AbortSignal
  ): Promise<ExtractValuesResult> => {
    const { data } = await api.post<Envelope<ExtractValuesResult>>(
      `/documents/${id}/extract-values`,
      body,
      { timeout: EXTRACT_VALUES_TIMEOUT_MS, signal }
    );
    return data.data;
  },

  /**
   * The values the document's ALREADY STORED reading holds
   * (`GET /documents/:id/stored-values`): no parser runs, no budget is spent.
   * `reason` says why `values` is null.
   */
  storedValues: async (
    id: string,
    hints: Pick<ExtractValuesRequest, "flightNumber" | "trainNumber" | "departureDate"> = {}
  ): Promise<StoredValuesResult> => {
    const { data } = await api.get<Envelope<StoredValuesResult>>(`/documents/${id}/stored-values`, {
      params: hints,
    });
    return data.data;
  },
};

/** Why a document has no stored values to show. */
export interface StoredValuesResult {
  domain: ExtractValuesResult["domain"] | null;
  parserUsed: string | null;
  values: ExtractValuesResult["values"];
  reason: "notParsed" | "unreadable" | "nothingFound" | null;
}

/** Longer than any parser's own model timeout, so the server answers first. */
const EXTRACT_VALUES_TIMEOUT_MS = 5 * 60 * 1000;

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
