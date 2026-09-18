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

export interface UseEvidenceResult {
  isOpen: boolean;
  kind: EvidenceKind | null;
  key: string | null;
  /** Opens the panel by writing `?evidence=<kind>:<key>` into the URL — other params are kept. */
  open: (kind: EvidenceKind, key: string) => void;
  /** Removes `?evidence` and nothing else. */
  close: () => void;
  /** The most recently fetched page's own response — `measure`, `omitted`, `unattributed` reflect THIS page. */
  response: EvidenceResponse | null;
  /** Every entry fetched so far, oldest page first — what "load more" appends to. */
  entries: EvidenceEntry[];
  loading: boolean;
  error: LoadFailure | null;
  /** `omitted.count > 0` on the latest page: there is more to load. */
  hasMore: boolean;
  loadMore: () => void;
}

export function useEvidence(scope?: EvidenceScopeParams): UseEvidenceResult {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get(EVIDENCE_PARAM);
  const parsed = useMemo(() => decodeEvidenceParam(raw), [raw]);

  const [response, setResponse] = useState<EvidenceResponse | null>(null);
  const [entries, setEntries] = useState<EvidenceEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<LoadFailure | null>(null);

  // Read inside the fetch without making it a dependency: a scope object
  // built inline by the caller is a new reference every render, and this
  // hook must not refetch on every render of its host.
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const open = useCallback(
    (kind: EvidenceKind, key: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set(EVIDENCE_PARAM, encodeEvidenceParam(kind, key));
        return next;
      });
    },
    [setSearchParams]
  );

  const close = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete(EVIDENCE_PARAM);
      return next;
    });
  }, [setSearchParams]);

  const fetchPage = useCallback(async (kind: EvidenceKind, key: string, offset: number) => {
    setLoading(true);
    setError(null);
    try {
      const s = scopeRef.current;
      const page = await evidenceApi.get(kind, key, {
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
    if (!parsed) {
      setResponse(null);
      setEntries([]);
      setError(null);
      return;
    }
    fetchPage(parsed.kind, parsed.key, 0).catch(() => {
      // fetchPage never rejects — it catches internally — but a lint-visible
      // promise still needs a handler.
    });
  }, [parsed, fetchPage]);

  const loadMore = useCallback(() => {
    if (!parsed || loading) return;
    fetchPage(parsed.kind, parsed.key, entries.length).catch(() => {});
  }, [parsed, loading, entries.length, fetchPage]);

  return {
    isOpen: parsed !== null,
    kind: parsed?.kind ?? null,
    key: parsed?.key ?? null,
    open,
    close,
    response,
    entries,
    loading,
    error,
    hasMore: (response?.omitted.count ?? 0) > 0,
    loadMore,
  };
}
