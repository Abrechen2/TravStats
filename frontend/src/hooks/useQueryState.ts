import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useInRouterContext, useLocation, useSearchParams } from "react-router-dom";
import { useDebouncedValue } from "./useDebouncedValue";

/**
 * A piece of list state — a filter, a search, a page — kept in the URL query.
 *
 * The logbook lists held their filters in `useState`, so Back from a detail
 * page, a reload or a shared link reopened the list as if new: page 1, every
 * filter reset (owner report 2026-11-23). In the query, the browser's own
 * history carries them, and Back and reload restore them without any store.
 *
 * Writes REPLACE the current entry: a filter change is not a place the reader
 * wants Back to step through. The default value is never written, so an
 * untouched list keeps a clean URL. Outside a router (a component test that
 * renders a bare table) the hook falls back to plain state.
 */

export interface QueryCodec<T> {
  /** `undefined` for a raw value this list cannot use — the default applies. */
  parse: (raw: string) => T | undefined;
  format: (value: T) => string;
}

/** Any string. */
export const stringParam: QueryCodec<string> = {
  parse: (raw) => raw,
  format: (value) => value,
};

/** One of a fixed set — a typo or a stale bookmark falls back to the default. */
export function oneOfParam<T extends string>(values: readonly T[]): QueryCodec<T> {
  return {
    parse: (raw) => ((values as readonly string[]).includes(raw) ? (raw as T) : undefined),
    format: (value) => value,
  };
}

/** The entry status filter every logbook shares. */
export const statusOrAllParam = oneOfParam([
  "all",
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
] as const);

/** A positive integer — a page number. */
export const positiveIntParam: QueryCodec<number> = {
  parse: (raw) => {
    const value = Number(raw);
    return Number.isInteger(value) && value > 0 ? value : undefined;
  },
  format: (value) => String(value),
};

/** A year filter: a whole number, or the word "all". */
export const yearOrAllParam: QueryCodec<number | "all"> = {
  parse: (raw) => {
    if (raw === "all") return "all";
    const value = Number(raw);
    // The server refuses a year outside 1900-2200; a hand-edited URL falls back to "all".
    return Number.isInteger(value) && value >= 1900 && value <= 2200 ? value : undefined;
  },
  format: (value) => String(value),
};

/**
 * The search a write starts from.
 *
 * `setSearchParams(fn)` hands its updater the params of the LAST RENDER, so two
 * writes in one handler (a filter and the page it resets) would each start
 * from the same stale query and the second would undo the first. Every write
 * here records what it produced; the next write in the same tick builds on
 * that, and the render that follows re-anchors it to the real location.
 */
let pending: { pathname: string; search: string } | null = null;

export function useQuerySetter(): (mutate: (params: URLSearchParams) => void) => void {
  const location = useLocation();
  // The router's own setter rather than `useNavigate`: it keeps the path and
  // only swaps the query, which is all a list state write is.
  const [, setSearchParams] = useSearchParams();
  const locationRef = useRef(location);
  // React Router hands out a new setter whenever the query changes; the ref
  // keeps this writer — and every setter built on it — one stable function.
  const setSearchParamsRef = useRef(setSearchParams);
  useLayoutEffect(() => {
    locationRef.current = location;
    setSearchParamsRef.current = setSearchParams;
    pending = { pathname: location.pathname, search: location.search };
  }, [location, setSearchParams]);

  return useCallback((mutate) => {
    const here = locationRef.current;
    const base = pending && pending.pathname === here.pathname ? pending.search : here.search;
    const params = new URLSearchParams(base);
    mutate(params);
    const next = params.toString();
    const search = next ? `?${next}` : "";
    if (search === base) return;
    pending = { pathname: here.pathname, search };
    setSearchParamsRef.current(params, {
      replace: true,
      state: here.state,
      preventScrollReset: true,
    });
  }, []);
}

type Setter<T> = (next: T | ((previous: T) => T)) => void;

function useRouterQueryState<T>(
  key: string,
  defaultValue: T,
  codec: QueryCodec<T>
): [T, Setter<T>] {
  const location = useLocation();
  const write = useQuerySetter();
  const raw = new URLSearchParams(location.search).get(key);
  const parsed = raw === null ? undefined : codec.parse(raw);
  const value = parsed === undefined ? defaultValue : parsed;
  const valueRef = useRef(value);
  valueRef.current = value;
  const defaultText = codec.format(defaultValue);

  const set = useCallback<Setter<T>>(
    (next) => {
      const resolved =
        typeof next === "function" ? (next as (previous: T) => T)(valueRef.current) : next;
      valueRef.current = resolved;
      const text = codec.format(resolved);
      write((params) => {
        if (text === defaultText || text === "") params.delete(key);
        else params.set(key, text);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- codec is a module constant per call site
    [key, defaultText, write]
  );
  return [value, set];
}

function useLocalQueryState<T>(defaultValue: T): [T, Setter<T>] {
  return useState<T>(defaultValue) as [T, Setter<T>];
}

export function useQueryState<T>(
  key: string,
  defaultValue: T,
  codec: QueryCodec<T>
): [T, Setter<T>] {
  // Whether there is a router never changes for a mounted component, so the
  // branch keeps the hook order stable.
  const inRouter = useInRouterContext();
  return inRouter
    ? // eslint-disable-next-line react-hooks/rules-of-hooks -- stable per mount, see above
      useRouterQueryState(key, defaultValue, codec)
    : // eslint-disable-next-line react-hooks/rules-of-hooks -- stable per mount, see above
      useLocalQueryState(defaultValue);
}

/** Drop the given keys from the query in one write — "reset filters". */
export function useQueryReset(): (keys: readonly string[]) => void {
  const inRouter = useInRouterContext();
  // eslint-disable-next-line react-hooks/rules-of-hooks -- stable per mount
  const write = inRouter ? useQuerySetter() : null;
  return useMemo(
    () => (keys: readonly string[]) => write?.((params) => keys.forEach((k) => params.delete(k))),
    [write]
  );
}

/**
 * A search box whose settled text lives in the URL.
 *
 * The input itself stays on local state: React Router applies a navigation in
 * a transition, and a controlled input fed from a transition loses its caret.
 * The URL follows the debounced text, which is also what a list should query
 * with — "Steigenberger" is one request, not thirteen. Returns the text for
 * the input, its setter, and the settled text.
 */
export function useQuerySearch(
  key = "q",
  delayMs?: number
): [string, (next: string) => void, string] {
  const [param, setParam] = useQueryState(key, "", stringParam);
  const [text, setText] = useState(param);
  const settled = useDebouncedValue(text, delayMs);
  const settledRef = useRef(settled);
  useEffect(() => {
    settledRef.current = settled;
    if (settled !== param) setParam(settled);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follows the typed text only
  }, [settled]);
  useEffect(() => {
    // The query changed from outside (reset, Back within the page): the box follows.
    if (param !== settledRef.current) setText(param);
  }, [param]);
  return [text, setText, settled];
}
