import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { evidenceApi } from "../../lib/api/evidence";
import { classifyLoadFailure, type LoadFailure } from "../../lib/api/loadFailure";
import { logger } from "../../lib/logger";
import {
  EVIDENCE_PAGE_SIZE,
  type EvidenceDomain,
  type EvidenceEntry,
  type EvidenceKind,
  type EvidenceResponse,
} from "../../shared/evidence";
import { useEvidenceOpenStore } from "./evidenceOpenStore";

/**
 * The URL owns the open state (design, "The panel"): `?evidence=<kind>:<key>`.
 * A shared link opens the panel, and the browser's back button closes it —
 * neither works if the state lived only in React.
 */
const EVIDENCE_PARAM = "evidence";

const EVIDENCE_KINDS = new Set<EvidenceKind>(["metric", "ranking", "record", "achievement"]);

function encodeEvidenceParam(kind: EvidenceKind, key: string): string {
  return `${kind}:${key}`;
}

/**
 * `key` itself may contain colons (a ranking key is `airline:LH`), so only
 * the FIRST colon separates `kind` from `key` — the same convention
 * `parseRankingKey` uses one level down.
 */
function decodeEvidenceParam(raw: string | null): { kind: EvidenceKind; key: string } | null {
  if (!raw) return null;
  const at = raw.indexOf(":");
  if (at <= 0) return null;
  const kind = raw.slice(0, at);
  const key = raw.slice(at + 1);
  if (!key || !EVIDENCE_KINDS.has(kind as EvidenceKind)) return null;
  return { kind: kind as EvidenceKind, key };
}

/** What surface the caller measured over. Optional: an unscoped request gets the server's `allTime` default. */
export interface EvidenceScopeParams {
  period?: "allTime" | "year" | "rolling12m";
  year?: number;
  domains?: EvidenceDomain[];
}

/**
 * What a tile knows at the moment it opens the panel. Both fields travel
 * through `evidenceOpenStore.ts`, never the URL — see that module for why.
 */
export interface OpenEvidenceOptions {
  /** The population THIS tile is showing (its own year, its own window) — required whenever it differs from `allTime`. */
  scope?: EvidenceScopeParams;
  /**
   * The figure the tile currently displays, in the measure's own unit —
   * `null`/omitted when the tile has nothing comparable to offer. Compared
   * against the freshly measured `measure.value` so a disagreement between
   * the two renders (design, "The number may have moved").
   */
  renderedValue?: number | null;
}

export interface UseEvidenceOpen {
  isOpen: boolean;
  kind: EvidenceKind | null;
  key: string | null;
  /** Opens the panel by writing `?evidence=<kind>:<key>` — other params are kept — and records `options` for the panel to read. */
  open: (kind: EvidenceKind, key: string, options?: OpenEvidenceOptions) => void;
  /** Removes `?evidence` and clears the recorded scope/rendered value. */
  close: () => void;
}

/**
 * The cheap half of the evidence machinery: reads/writes `?evidence=` and the
 * out-of-band open-store, nothing else. Every TILE that can open the panel
 * uses this, never the full `useEvidence` below — that hook also fetches,
 * and its effect fires on every `isOpen`/`kind`/`key` change. Forty tiles
 * each holding their own `useEvidence()` would mean forty redundant fetches
 * every time any ONE of them was opened, since they would all react to the
 * same shared URL param.
 */
export function useEvidenceOpen(): UseEvidenceOpen {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get(EVIDENCE_PARAM);
  const parsed = useMemo(() => decodeEvidenceParam(raw), [raw]);
  const setOpenRequest = useEvidenceOpenStore((s) => s.setOpenRequest);

  const open = useCallback(
    (kind: EvidenceKind, key: string, options?: OpenEvidenceOptions) => {
      setOpenRequest(options?.scope, options?.renderedValue ?? null);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set(EVIDENCE_PARAM, encodeEvidenceParam(kind, key));
        return next;
      });
    },
    [setSearchParams, setOpenRequest]
  );

  const close = useCallback(() => {
    setOpenRequest(undefined, undefined);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete(EVIDENCE_PARAM);
      return next;
    });
  }, [setSearchParams, setOpenRequest]);

  return {
    isOpen: parsed !== null,
    kind: parsed?.kind ?? null,
    key: parsed?.key ?? null,
    open,
    close,
  };
}

export interface UseEvidenceResult extends UseEvidenceOpen {
  /** The most recently fetched page's own response — `measure`, `omitted`, `unattributed` reflect THIS page. */
  response: EvidenceResponse | null;
  /** Every entry fetched so far, oldest page first — what "load more" appends to. */
  entries: EvidenceEntry[];
  loading: boolean;
  error: LoadFailure | null;
  /** `omitted.count > 0` on the latest page: there is more to load. */
  hasMore: boolean;
  loadMore: () => void;
  /** What the opening tile said it was showing — `null` for a bookmark, a raw `?evidence=` link, or once the panel is closed. */
  renderedValue: number | null;
}

/**
 * `scope` is a fallback for callers with no per-open scope of their own —
 * every tile wired in Task 9 passes its scope through `open()` instead
 * (`evidenceOpenStore.ts`), which wins whenever it is set.
 */
export function useEvidence(scope?: EvidenceScopeParams): UseEvidenceResult {
  const { isOpen, kind, key, open, close } = useEvidenceOpen();
  const storeScope = useEvidenceOpenStore((s) => s.scope);
  const renderedValue = useEvidenceOpenStore((s) => s.renderedValue) ?? null;

  const [response, setResponse] = useState<EvidenceResponse | null>(null);
  const [entries, setEntries] = useState<EvidenceEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<LoadFailure | null>(null);

  // Read inside the fetch without making either one a dependency: a scope
  // object built inline by a caller is a new reference every render, and
  // this hook must not refetch on every render of its host.
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const storeScopeRef = useRef(storeScope);
  storeScopeRef.current = storeScope;

  const fetchPage = useCallback(async (k: EvidenceKind, kk: string, offset: number) => {
    setLoading(true);
    setError(null);
    try {
      const s = storeScopeRef.current ?? scopeRef.current;
      const page = await evidenceApi.get(k, kk, {
        period: s?.period,
        year: s?.year,
        domains: s?.domains,
        offset,
        limit: EVIDENCE_PAGE_SIZE,
      });
      setResponse(page);
      setEntries((prev) => (offset === 0 ? page.entries : [...prev, ...page.entries]));
    } catch (err) {
      const failureKind = classifyLoadFailure(err);
      setError(failureKind);
      if (offset === 0) {
        setResponse(null);
        setEntries([]);
      }
      if (failureKind === "loadError") logger.error("Failed to load evidence:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen || !kind || !key) {
      setResponse(null);
      setEntries([]);
      setError(null);
      return;
    }
    fetchPage(kind, key, 0).catch(() => {
      // fetchPage never rejects — it catches internally — but a lint-visible
      // promise still needs a handler.
    });
  }, [isOpen, kind, key, fetchPage]);

  const loadMore = useCallback(() => {
    if (!kind || !key || loading) return;
    fetchPage(kind, key, entries.length).catch(() => {});
  }, [kind, key, loading, entries.length, fetchPage]);

  return {
    isOpen,
    kind,
    key,
    open,
    close,
    response,
    entries,
    loading,
    error,
    hasMore: (response?.omitted.count ?? 0) > 0,
    loadMore,
    renderedValue,
  };
}
