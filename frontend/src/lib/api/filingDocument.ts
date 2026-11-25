import type { InternalAxiosRequestConfig } from "axios";

import { api } from "./client";
import type { NewEntryDomain } from "./documents";

/**
 * "Neu anlegen aus Dokument": the document is filed by its EXACT id, in the
 * very request that creates the entry. The five create routes already take
 * `documentIds` and file them in the entry's own transaction; this attaches the
 * id to the one request that creates the entry, so nothing has to guess which
 * entry "came from" the document (an earlier version looked for the first
 * entry of the domain created since the dialog opened, which could pick
 * another one made at the same moment).
 *
 * Only the FIRST successful create carries it: a document belongs to one
 * entry, and a second create with the same id would be refused. The lodging
 * batch commit carries it too and answers `documentFiled`; `false` there (no stay
 * was created, or the link failed) leaves the document unfiled and says so.
 */
const CREATE_ROUTE: Record<NewEntryDomain, readonly RegExp[]> = {
  flight: [/^\/flights$/],
  cruise: [/^\/cruises$/],
  rail: [/^\/rail$/],
  // The import's commit, and the empty form's own create ("Leer anlegen mit Dokument").
  rental: [/^\/rentals\/import$/, /^\/rentals$/],
  // The lodging import files it with the first stay it creates and says whether it did;
  // the empty form ("Leer anlegen mit Dokument") files it with the stay it creates.
  lodging: [/^\/lodging-import\/commit$/, /^\/lodging\/[^/]+\/stays$/],
};

interface Pending {
  documentId: string;
  domain: NewEntryDomain;
  carrying: boolean;
  filed: boolean;
}

let pending: Pending | null = null;

export function canFileBy(domain: NewEntryDomain): boolean {
  return CREATE_ROUTE[domain].length > 0;
}

export function setFilingDocument(documentId: string, domain: NewEntryDomain): void {
  pending = { documentId, domain, carrying: false, filed: false };
}

/** Stops attaching; true when the server filed the document with a created entry. */
export function clearFilingDocument(): boolean {
  const filed = pending?.filed ?? false;
  pending = null;
  return filed;
}

const pathOf = (url: string | undefined): string => (url ?? "").split("?")[0].replace(/\/$/, "");

function matches(config: { method?: string; url?: string }): boolean {
  const routes = pending ? CREATE_ROUTE[pending.domain] : [];
  return config.method?.toLowerCase() === "post" && routes.some((r) => r.test(pathOf(config.url)));
}

const CARRIER = "X-Filing-Document";

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (!pending || pending.filed || pending.carrying || !matches(config)) return config;
  const body = config.data as unknown;
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    body instanceof FormData
  ) {
    return config;
  }
  pending.carrying = true;
  config.data = { ...(body as object), documentIds: [pending.documentId] };
  config.headers.set(CARRIER, "1");
  return config;
});

api.interceptors.response.use(
  (response) => {
    if (pending?.carrying && response.config.headers?.get?.(CARRIER)) {
      pending.carrying = false;
      // Only the lodging commit answers `documentFiled`; every other create files it by existing.
      const answered = (response.data as { data?: { documentFiled?: unknown } } | undefined)?.data
        ?.documentFiled;
      pending.filed = answered !== false;
    }
    return response;
  },
  (error: unknown) => {
    const config = (error as { config?: { headers?: { get?: (n: string) => unknown } } }).config;
    if (pending?.carrying && config?.headers?.get?.(CARRIER)) pending.carrying = false;
    return Promise.reject(error);
  }
);
