import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useClickOutside } from "../../hooks/useClickOutside";
import { useDomainColors } from "../../hooks/useDomainColors";
import { useTranslation } from "../../hooks/useTranslation";
import {
  MIN_SEARCH_LENGTH,
  SEARCH_TOTAL_CAP,
  type SearchDomain,
  type SearchHit,
} from "../../lib/api/search";
import { useDisplayFormat } from "../../lib/format";
import { TOUR_COLOR, type DomainKey } from "../../shared/domains";
import { Icon } from "../ui/Icon";
import { useAuthStore } from "../../store/authStore";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { useToursVisible } from "../../hooks/useToursVisible";
import { useGlobalSearch } from "./useGlobalSearch";
import { clearRecentSearches, readRecentSearches, rememberSearch } from "./recentSearches";

interface Group {
  domain: SearchDomain;
  hits: SearchHit[];
}

/** Consecutive hits of one domain make a group; the server already sends them domain by domain. */
function groupHits(hits: readonly SearchHit[]): Group[] {
  const groups: Group[] = [];
  for (const hit of hits) {
    const last = groups[groups.length - 1];
    if (last && last.domain === hit.domain) last.hits.push(hit);
    else groups.push({ domain: hit.domain, hits: [hit] });
  }
  return groups;
}

/** True while the user is typing somewhere else, so "/" stays a character there. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * The header's search field (forgejo#403): one box over every domain the
 * account shows. "/" focuses it, arrow keys walk the hits, Enter opens one,
 * Escape closes. A failed search says why (network, rate limit, session,
 * server) and never reads as "no matches"; a search that could not cover some
 * domains names them.
 */
export default function GlobalSearch(): JSX.Element {
  const { t } = useTranslation(["dashboard", "common"]);
  const navigate = useNavigate();
  const fmt = useDisplayFormat();
  const { colorOf } = useDomainColors();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { enabled } = useEnabledDomains();
  const toursVisible = useToursVisible();
  // Domain chips narrow the search; none chosen = every domain the account shows.
  const [only, setOnly] = useState<SearchDomain[]>([]);
  const chipDomains = useMemo<SearchDomain[]>(
    // A Set: "tour" is both a domain and the tours page, and was drawn twice (UAT rc.45).
    () => [
      ...new Set<SearchDomain>([...enabled, "trip", ...(toursVisible ? ["tour" as const] : [])]),
    ],
    [enabled, toursVisible]
  );
  const { state, retry } = useGlobalSearch(value, only);
  const [recent, setRecent] = useState<string[]>(() => readRecentSearches(userId));
  useEffect(() => setRecent(readRecentSearches(userId)), [userId]);

  useClickOutside(boxRef, () => setOpen(false));

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      e.preventDefault();
      inputRef.current?.focus();
      setOpen(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const trimmed = value.trim();
  // An empty field with remembered queries offers them, walkable like hits.
  const showRecent = open && trimmed.length === 0 && recent.length > 0;
  const tooShort = trimmed.length < MIN_SEARCH_LENGTH;
  const groups = useMemo(
    () => (state.status === "ready" ? groupHits(state.result.hits) : []),
    [state]
  );
  const flat = useMemo(() => groups.flatMap((g) => g.hits), [groups]);
  const listLength = showRecent ? recent.length : flat.length;

  useEffect(() => setActive(0), [flat, showRecent]);

  // Keep the keyboard's choice on screen inside the scrolling panel.
  useEffect(() => {
    if (open && listLength > 0) {
      document.getElementById(`${listId}-opt-${active}`)?.scrollIntoView?.({ block: "nearest" });
    }
  }, [active, open, listLength, listId]);

  const colorFor = (domain: SearchDomain): string =>
    domain === "tour"
      ? TOUR_COLOR
      : domain === "trip"
        ? "var(--ts-muted)"
        : colorOf(domain as DomainKey);

  const go = (hit: SearchHit): void => {
    // Remembered once a result was actually opened: a typed-and-abandoned
    // query says nothing about what the user was looking for.
    if (trimmed.length >= MIN_SEARCH_LENGTH) setRecent(rememberSearch(userId, trimmed));
    setOpen(false);
    setValue("");
    inputRef.current?.blur();
    navigate(hit.path);
  };

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Escape") {
      if (value) setValue("");
      else inputRef.current?.blur();
      setOpen(false);
    } else if (e.key === "ArrowDown" && listLength > 0) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % listLength);
    } else if (e.key === "ArrowUp" && listLength > 0) {
      e.preventDefault();
      setActive((i) => (i - 1 + listLength) % listLength);
    } else if (e.key === "Enter" && open && showRecent && recent[active]) {
      e.preventDefault();
      setValue(recent[active]);
    } else if (e.key === "Enter" && open && flat[active]) {
      e.preventDefault();
      go(flat[active]);
    }
  };

  const optionId = (i: number): string => `${listId}-opt-${i}`;
  const showPanel = (open && trimmed.length > 0) || showRecent;
  const toggleChip = (domain: SearchDomain): void =>
    setOnly((prev) =>
      prev.includes(domain) ? prev.filter((d) => d !== domain) : [...prev, domain]
    );
  let flatIndex = -1;

  return (
    <div ref={boxRef} className="relative" data-testid="global-search">
      <div
        className="flex items-center gap-1 rounded-md px-2"
        style={{ height: 36, background: "var(--ts-tile)", color: "var(--ts-muted)" }}
      >
        <Icon name="search" size={16} />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showPanel && listLength > 0 ? optionId(active) : undefined}
          aria-label={t("dashboard:search.ariaLabel")}
          title={t("dashboard:search.shortcutHint")}
          placeholder={t("dashboard:search.placeholder")}
          value={value}
          maxLength={100}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onInputKey}
          className="w-14 min-[380px]:w-24 bg-transparent text-sm outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-(--ts-accent) sm:w-36 lg:w-52"
          style={{ color: "var(--ts-text-bright)" }}
          autoComplete="off"
        />
      </div>

      {showPanel && (
        <div
          id={listId}
          role="listbox"
          aria-label={t("dashboard:search.results")}
          className="absolute right-0 top-full z-50 mt-1 max-h-[70vh] w-[min(92vw,420px)] overflow-y-auto rounded-md py-1 text-sm"
          style={{ background: "var(--ts-bg)", border: "1px solid var(--ts-border)" }}
        >
          {/* Chips never take the focus: the input keeps "/", arrows and Enter. */}
          <div
            role="group"
            aria-label={t("dashboard:search.chips.label")}
            className="flex flex-wrap gap-1 px-3 pb-1 pt-2"
          >
            {chipDomains.map((domain) => {
              const on = only.includes(domain);
              return (
                <button
                  key={domain}
                  type="button"
                  tabIndex={-1}
                  aria-pressed={on}
                  data-testid={`search-chip-${domain}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => toggleChip(domain)}
                  className="rounded-full px-2 py-0.5 text-xs pointer-coarse:min-h-(--ts-size-touch-min) pointer-coarse:px-3"
                  style={{
                    background: on ? colorFor(domain) : "transparent",
                    color: on ? "var(--ts-bg)" : "var(--ts-muted)",
                    border: `1px solid ${on ? colorFor(domain) : "var(--ts-border)"}`,
                  }}
                >
                  {t(`dashboard:search.group.${domain}`)}
                </button>
              );
            })}
          </div>

          {showRecent && (
            <div role="group" aria-label={t("dashboard:search.recent.label")}>
              <div
                className="flex items-center justify-between px-3 pb-1 pt-2 text-xs"
                style={{ color: "var(--ts-muted)" }}
              >
                <span className="font-semibold uppercase tracking-wide">
                  {t("dashboard:search.recent.label")}
                </span>
                <button
                  type="button"
                  tabIndex={-1}
                  data-testid="search-recent-clear"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    clearRecentSearches(userId);
                    setRecent([]);
                  }}
                  className="underline pointer-coarse:min-h-(--ts-size-touch-min)"
                >
                  {t("dashboard:search.recent.clear")}
                </button>
              </div>
              {recent.map((q, i) => (
                <div
                  key={q}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  tabIndex={-1}
                  data-testid={`search-recent-${i}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setValue(q)}
                  className="cursor-pointer px-3 py-1.5 pointer-coarse:py-3"
                  style={{
                    color: "var(--ts-text-bright)",
                    background: i === active ? "var(--ts-tile)" : "transparent",
                  }}
                >
                  {q}
                </div>
              ))}
            </div>
          )}

          {!showRecent && tooShort && (
            <p role="status" className="px-3 py-2" style={{ color: "var(--ts-muted)" }}>
              {t("dashboard:search.tooMuchTooLittle", { min: MIN_SEARCH_LENGTH })}
            </p>
          )}

          {!tooShort && state.status === "loading" && (
            <p role="status" className="px-3 py-2" style={{ color: "var(--ts-muted)" }}>
              {t("dashboard:search.loading")}
            </p>
          )}

          {!tooShort && state.status === "error" && (
            <div role="alert" className="px-3 py-2">
              <p style={{ color: "var(--ts-warn)" }}>
                {t(`dashboard:search.error.${state.reason}`)}
              </p>
              {(state.reason === "network" ||
                state.reason === "server" ||
                state.reason === "rateLimit") && (
                <button
                  type="button"
                  onClick={retry}
                  className="mt-1 underline"
                  style={{ color: "var(--ts-text-bright)" }}
                >
                  {t("dashboard:search.error.retry")}
                </button>
              )}
            </div>
          )}

          {!tooShort && state.status === "ready" && (
            <>
              {state.result.failed.length > 0 && (
                <p role="alert" className="px-3 py-2" style={{ color: "var(--ts-warn)" }}>
                  {t("dashboard:search.partial", {
                    domains: state.result.failed
                      .map((d) => t(`dashboard:search.group.${d}`))
                      .join(", "),
                  })}
                </p>
              )}
              {flat.length === 0 && state.result.failed.length === 0 && (
                <div className="px-3 py-2" role="status">
                  <p style={{ color: "var(--ts-text-bright)" }}>
                    {t("dashboard:search.empty", { q: state.result.query })}
                  </p>
                  <p className="mt-1" style={{ color: "var(--ts-muted)" }}>
                    {t("dashboard:search.emptyHint")}
                  </p>
                </div>
              )}
              {groups.map((group) => (
                <div
                  key={group.domain}
                  role="group"
                  aria-label={t(`dashboard:search.group.${group.domain}`)}
                >
                  <div
                    className="flex items-center gap-2 px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide"
                    style={{ color: colorFor(group.domain) }}
                  >
                    <span
                      aria-hidden="true"
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: colorFor(group.domain) }}
                    />
                    {t(`dashboard:search.group.${group.domain}`)}
                  </div>
                  {group.hits.map((hit) => {
                    flatIndex += 1;
                    const i = flatIndex;
                    const isActive = i === active;
                    return (
                      <div
                        key={`${hit.kind}-${hit.id}`}
                        id={optionId(i)}
                        role="option"
                        aria-selected={isActive}
                        tabIndex={-1}
                        onMouseEnter={() => setActive(i)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => go(hit)}
                        className="flex cursor-pointer items-baseline justify-between gap-3 px-3 py-1.5"
                        style={{
                          background: isActive ? "var(--ts-tile)" : "transparent",
                          boxShadow: `inset 3px 0 0 ${isActive ? colorFor(hit.domain) : "transparent"}`,
                        }}
                      >
                        <span className="min-w-0">
                          <span
                            className="block truncate"
                            style={{ color: "var(--ts-text-bright)" }}
                          >
                            {hit.title}
                          </span>
                          {hit.subtitle && (
                            <span
                              className="block truncate text-xs"
                              style={{ color: "var(--ts-muted)" }}
                            >
                              {hit.subtitle}
                            </span>
                          )}
                        </span>
                        {hit.date && (
                          <span
                            className="shrink-0 text-xs tabular-nums"
                            style={{ color: "var(--ts-muted)" }}
                          >
                            {fmt.localDateValue(hit.date)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {state.result.more.includes(group.domain) && (
                    <p className="px-3 pb-1 text-xs" style={{ color: "var(--ts-muted)" }}>
                      {t("dashboard:search.more")}
                    </p>
                  )}
                </div>
              ))}
              {state.result.capped && (
                <p className="px-3 py-2 text-xs" style={{ color: "var(--ts-muted)" }}>
                  {t("dashboard:search.capped", { max: SEARCH_TOTAL_CAP })}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
