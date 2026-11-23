import { useCallback, useEffect, useState } from "react";
import axios from "axios";

import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { useToursVisible } from "../../hooks/useToursVisible";
import {
  MIN_SEARCH_LENGTH,
  searchApi,
  type SearchDomain,
  type SearchResult,
} from "../../lib/api/search";
import { classifySearchError, type SearchErrorKind } from "./searchErrors";

export type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; result: SearchResult }
  | { status: "error"; reason: SearchErrorKind };

/**
 * The header search's data: debounced, one request in flight (a newer
 * keystroke aborts the older), and only the domains this account shows —
 * `useEnabledDomains` plus trips, plus tours while the beta key lets them in.
 * The server applies the same gate; sending it keeps the two honest.
 */
export function useGlobalSearch(
  rawQuery: string,
  /** Domain chips: when non-empty, only these are searched (never more than the account shows). */
  only: readonly SearchDomain[] = []
): { state: SearchState; retry: () => void } {
  const query = useDebouncedValue(rawQuery.trim(), 250);
  const { enabled } = useEnabledDomains();
  const toursVisible = useToursVisible();
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);

  const onlyKey = only.join(",");
  const domainsKey = `${enabled.join(",")}|${toursVisible}|${onlyKey}`;

  useEffect(() => {
    if (query.length < MIN_SEARCH_LENGTH) {
      setState({ status: "idle" });
      return;
    }
    const shown: SearchDomain[] = [
      ...enabled,
      "trip",
      ...(toursVisible ? (["tour"] as const) : []),
    ];
    const narrowed = shown.filter((d) => onlyKey.split(",").includes(d));
    // A stale chip (its domain was switched off) narrows to nothing; the
    // server reads an empty list as "everything", so fall back to what is shown.
    const domains = narrowed.length > 0 ? narrowed : shown;
    const controller = new AbortController();
    setState({ status: "loading" });
    searchApi
      .search({ q: query, domains }, controller.signal)
      .then((result) => setState({ status: "ready", result }))
      .catch((error: unknown) => {
        if (axios.isCancel(error)) return;
        setState({ status: "error", reason: classifySearchError(error) });
      });
    return () => controller.abort();
    // `enabled` is represented by `domainsKey`; spreading it would re-fire on identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- enabled is represented by domainsKey and toursVisible follows it; neither should re-fire on identity
  }, [query, domainsKey, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}
