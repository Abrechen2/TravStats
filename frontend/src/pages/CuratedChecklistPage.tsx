import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import NavigationBar from "../components/NavigationBar";
import PageTransition from "../components/PageTransition";
import { ChecklistRow } from "../components/places/ChecklistRow";
import { useTranslation } from "../hooks/useTranslation";
import { usePlacesAccess } from "../hooks/usePlacesVisible";
import { curatedText } from "../lib/curatedCopy";
import { logger } from "../lib/logger";
import { classifyLoadFailure, type LoadFailure } from "../lib/api/loadFailure";
import {
  getCuratedProgress,
  getCuratedSuggestions,
  subscribeChecklist,
  tickCuratedItem,
  unsubscribeChecklist,
  untickCuratedItem,
} from "../lib/api/placeLists";
import { continentLabel } from "../lib/continentLabel";
import { countryName } from "../shared/geo/countryCode";

import { useToastStore } from "../store/toastStore";
import type { CuratedProgress, CuratedProgressItem, VisitSuggestion } from "../types/placeList";
import { useDomainColors } from "../hooks/useDomainColors";

type RowFilter = "all" | "open" | "ticked" | "suggested";

/**
 * How the rows are ordered.
 *
 * `name` is the catalog's own order and stays the default — it is the one you
 * can navigate by typing. The other two answer the question a world-spanning
 * list actually provokes: what is near me, and what is on the continent I keep
 * going back to. Both fall back to the name inside a group, so a country's
 * sites still read alphabetically.
 */
type SortKey = "name" | "country" | "continent";

/**
 * How many rows are drawn at once.
 *
 * The World Heritage checklist is 1247 targets. Rendering all of them costs
 * about a second of scripting on every filter keystroke, for a page nobody
 * scrolls to the bottom of. The cap is paired with a line saying exactly how
 * many are hidden — a silent truncation would be the checklist lying about its
 * own length, which is the one thing it may not do.
 */
const RENDER_CAP = 250;

/** Shared look for the three pickers in the filter bar. */
const SELECT_STYLE = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--color-border)",
  color: "var(--text-secondary)",
} as const;

/**
 * The progress screen — the ONE screen in the app that renders two kinds of row.
 *
 * That is the acknowledged cost of lazy materialisation, and it is the point:
 * an unticked target is a GHOST, drawn hollow and dashed, because it is not in
 * the logbook. If it looked like a ticked one the checklist would mean nothing.
 *
 * ## Two things the World Heritage list forced
 *
 * 1. **Filters.** Seven wonders need none; 1247 sites are unusable without a
 *    search box and a country picker, so both live here rather than in a
 *    "later" that never comes.
 * 2. **Suggestions.** With a list that long, the interesting question stops
 *    being "what is on it" and becomes "which of these have I already seen?".
 *    The server answers that from the user's own travel — and only ever
 *    proposes. Accepting one is an ordinary tick that carries the date the
 *    evidence gave it.
 */
export default function CuratedChecklistPage(): JSX.Element {
  const { colorOf } = useDomainColors();
  const { key } = useParams<{ key: string }>();
  const { t, i18n } = useTranslation(["places", "common"]);
  const navigate = useNavigate();
  const access = usePlacesAccess();
  const addToast = useToastStore((s) => s.addToast);

  const [progress, setProgress] = useState<CuratedProgress | null>(null);
  const [suggestions, setSuggestions] = useState<VisitSuggestion[]>([]);
  const [anchorCount, setAnchorCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [busyItem, setBusyItem] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [country, setCountry] = useState<string>("all");
  const [continent, setContinent] = useState<string>("all");
  const [rowFilter, setRowFilter] = useState<RowFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");

  const load = useCallback(async (): Promise<void> => {
    if (!key) return;
    setLoading(true);
    setFailure(null);
    try {
      // Both at once. Suggestions are advisory, so a failure there must not
      // cost the user the checklist itself — hence the separate catch.
      const [next, hints] = await Promise.all([
        getCuratedProgress(key),
        getCuratedSuggestions(key).catch((err: unknown) => {
          logger.warn({ err }, "CuratedChecklistPage: suggestions unavailable");
          return null;
        }),
      ]);
      setProgress(next);
      setSuggestions(hints?.suggestions ?? []);
      setAnchorCount(hints?.anchorCount ?? 0);
    } catch (err: unknown) {
      logger.error({ err }, "CuratedChecklistPage: failed to load progress");
      setFailure(classifyLoadFailure(err));
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    if (access !== "allowed") return;
    void load();
  }, [access, load]);

  const suggestionById = useMemo(
    () => new Map(suggestions.map((s) => [s.itemId, s])),
    [suggestions]
  );

  const handleToggle = useCallback(
    async (item: CuratedProgressItem, visitedAt?: string | null): Promise<void> => {
      setBusyItem(item.itemId);
      try {
        if (item.ticked) {
          await untickCuratedItem(item.itemId);
        } else {
          await tickCuratedItem(item.itemId, visitedAt ?? null);
        }
        // Re-fetch rather than patch locally: ticking also creates a place and
        // files it in the subscription, so the row, the counter AND the
        // subscribed flag can all change from one click.
        await load();
      } catch (err: unknown) {
        logger.error({ err }, "CuratedChecklistPage: failed to toggle item");
        addToast("error", t("places:checklist.tickFailed"));
      } finally {
        setBusyItem(null);
      }
    },
    [load, addToast, t]
  );

  const handleSubscription = useCallback(async (): Promise<void> => {
    if (!progress || !key) return;
    try {
      if (progress.subscribed) {
        await unsubscribeChecklist(key);
      } else {
        await subscribeChecklist(key);
      }
      await load();
    } catch (err: unknown) {
      logger.error({ err }, "CuratedChecklistPage: failed to change subscription");
      addToast("error", t("places:checklist.subscribeFailed"));
    }
  }, [progress, key, load, addToast, t]);

  // Continent options come from the ITEMS, so a list that touches three
  // continents offers three — never the full seven as dead entries.
  const continentOptions = useMemo(() => {
    const names = new Set<string>();
    for (const item of progress?.items ?? []) {
      if (item.continent) names.add(item.continent);
    }
    return [...names]
      .map((value) => ({ value, label: continentLabel(value, t) }))
      .sort((a, b) => a.label.localeCompare(b.label, i18n.language));
  }, [progress?.items, t, i18n.language]);

  // Country options are localised through the shared resolver — never from a
  // list of names baked into the catalog, which would render English in a
  // German UI. NARROWED by the chosen continent: 172 countries in one dropdown
  // is a scroll, 40 is a choice.
  const countryOptions = useMemo(() => {
    const codes = new Set<string>();
    for (const item of progress?.items ?? []) {
      if (continent !== "all" && item.continent !== continent) continue;
      if (item.isoCountryCode) codes.add(item.isoCountryCode.toUpperCase());
    }
    return [...codes]
      .map((code) => ({ code, label: countryName(code, i18n.language) ?? code }))
      .sort((a, b) => a.label.localeCompare(b.label, i18n.language));
  }, [progress?.items, continent, i18n.language]);

  // A country picked under one continent has no meaning under another, so it
  // clears rather than silently emptying the list.
  useEffect(() => {
    if (country === "all") return;
    if (!countryOptions.some((c) => c.code === country)) setCountry("all");
  }, [countryOptions, country]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = (progress?.items ?? []).filter((item) => {
      if (rowFilter === "open" && item.ticked) return false;
      if (rowFilter === "ticked" && !item.ticked) return false;
      if (rowFilter === "suggested" && !suggestionById.has(item.itemId)) return false;
      if (continent !== "all" && item.continent !== continent) return false;
      if (country !== "all" && item.isoCountryCode?.toUpperCase() !== country) return false;
      if (q.length > 0) {
        const haystack = `${item.name} ${item.nameEn ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    // Catalog order is alphabetical, which is right for browsing and wrong for
    // judging: it put a 43 km airport guess above a ship that docked in the
    // town. In the suggestion view the strongest evidence goes first, and that
    // beats the sort picker — the whole point of that view is the ranking.
    if (rowFilter === "suggested") {
      const rank: Record<string, number> = { high: 0, medium: 1, low: 2 };
      return [...rows].sort((a, b) => {
        const sa = suggestionById.get(a.itemId);
        const sb = suggestionById.get(b.itemId);
        if (!sa || !sb) return 0;
        return rank[sa.confidence] - rank[sb.confidence] || sa.distanceKm - sb.distanceKm;
      });
    }

    if (sortKey === "name") return rows;

    const byName = (a: CuratedProgressItem, b: CuratedProgressItem): number =>
      a.name.localeCompare(b.name, i18n.language);
    // A row with no country or continent sorts LAST rather than first: an
    // empty string would otherwise collate before "Ägypten" and open the list
    // with the handful of rows that know least about themselves.
    const groupOf = (item: CuratedProgressItem): string =>
      sortKey === "continent"
        ? continentLabel(item.continent, t, "")
        : item.isoCountryCode
          ? (countryName(item.isoCountryCode, i18n.language) ?? item.isoCountryCode)
          : "";

    return [...rows].sort((a, b) => {
      const ga = groupOf(a);
      const gb = groupOf(b);
      if (ga === gb) return byName(a, b);
      if (ga === "") return 1;
      if (gb === "") return -1;
      return ga.localeCompare(gb, i18n.language) || byName(a, b);
    });
  }, [
    progress?.items,
    search,
    country,
    continent,
    rowFilter,
    sortKey,
    suggestionById,
    t,
    i18n.language,
  ]);

  const shown = filtered.slice(0, RENDER_CAP);
  const hidden = filtered.length - shown.length;

  if (access === "pending" || loading) {
    return (
      <PageTransition>
        <NavigationBar />
        <div className="mx-auto max-w-3xl px-4 py-16 text-center text-[var(--text-muted)]">
          {t("common:loading.default")}
        </div>
      </PageTransition>
    );
  }

  if (access === "denied") {
    return (
      <PageTransition>
        <NavigationBar />
        <div className="mx-auto max-w-3xl px-4 py-16 text-center text-[var(--text-muted)]">
          {t("places:list.domainDisabled")}
        </div>
      </PageTransition>
    );
  }

  if (failure !== null || !progress) {
    const isLoadError = failure === "loadError";
    return (
      <PageTransition>
        <NavigationBar />
        <div className="mx-auto max-w-3xl px-4 py-16 text-center">
          <p role="alert" style={{ color: "var(--danger)" }}>
            {isLoadError ? t("places:lists.loadError") : t("places:checklist.notFound")}
          </p>
          <Link
            to="/places/lists"
            className="mt-3 inline-block text-sm underline"
            style={{ color: "var(--accent)" }}
          >
            {t("places:lists.backToLists")}
          </Link>
        </div>
      </PageTransition>
    );
  }

  const accent = progress.color ?? colorOf("poi");
  const pct =
    progress.itemCount > 0 ? Math.round((progress.tickedCount / progress.itemCount) * 100) : 0;
  const title = curatedText(progress.name, progress.nameEn, i18n.language);

  const FILTERS: Array<{ id: RowFilter; label: string; count: number }> = [
    { id: "all", label: t("places:checklist.filterAll"), count: progress.itemCount },
    {
      id: "open",
      label: t("places:checklist.filterOpen"),
      count: progress.itemCount - progress.tickedCount,
    },
    { id: "ticked", label: t("places:checklist.filterTicked"), count: progress.tickedCount },
    {
      id: "suggested",
      label: t("places:checklist.filterSuggested"),
      count: suggestions.length,
    },
  ];

  return (
    <PageTransition>
      <NavigationBar />
      <div className="mx-auto max-w-[960px] px-4 py-6 sm:px-6">
        <Link to="/places/lists" className="text-sm" style={{ color: "var(--text-muted)" }}>
          ← {t("places:lists.backToLists")}
        </Link>

        <div className="mt-3 mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="t-screen-title flex items-center gap-3">
              {progress.icon && <span aria-hidden>{progress.icon}</span>}
              {title}
            </h1>
            {progress.description && (
              <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
                {curatedText(progress.description, progress.descriptionEn, i18n.language)}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => void handleSubscription()}
            className="shrink-0 rounded-lg px-4 py-2 text-sm"
            style={
              progress.subscribed
                ? { border: "1px solid var(--color-border)", color: "var(--text-secondary)" }
                : { background: "var(--accent)", color: "#0d1117", fontWeight: 500 }
            }
          >
            {progress.subscribed ? t("places:checklist.unsubscribe") : t("places:lists.subscribe")}
          </button>
        </div>

        <div className="mb-4">
          <div
            role="progressbar"
            aria-valuenow={progress.tickedCount}
            aria-valuemin={0}
            aria-valuemax={progress.itemCount}
            aria-label={title}
            style={{
              height: 8,
              borderRadius: 4,
              background: "var(--bg-elevated)",
              overflow: "hidden",
            }}
          >
            <div style={{ width: `${pct}%`, height: "100%", background: accent }} />
          </div>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            {t("places:lists.progress", {
              done: progress.tickedCount,
              total: progress.itemCount,
            })}
          </p>
        </div>

        {/* The suggestion headline. Two different empty states on purpose: no
            recorded travel at all is a different thing to say than travel that
            happens to be nowhere near an open target. */}
        {suggestions.length > 0 ? (
          <p
            className="mb-4 rounded-lg px-3 py-2 text-sm"
            style={{
              background: "rgba(63,185,80,0.08)",
              border: "1px solid rgba(63,185,80,0.3)",
              color: "var(--text-secondary)",
            }}
          >
            {t("places:checklist.suggestionHeadline", { count: suggestions.length })}{" "}
            <button
              type="button"
              onClick={() => setRowFilter("suggested")}
              className="underline"
              style={{ color: "var(--accent)" }}
            >
              {t("places:checklist.showSuggestions")}
            </button>
          </p>
        ) : (
          anchorCount === 0 && (
            <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
              {t("places:checklist.noAnchors")}
            </p>
          )
        )}

        {progress.subscribed && (
          <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
            {t("places:checklist.unsubscribeHint")}
          </p>
        )}

        {/* Filters. A seven-item list does not need them; a 1247-item one is
            unusable without them, and one page serves both. */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("places:checklist.searchPlaceholder")}
            aria-label={t("places:checklist.searchPlaceholder")}
            className="rounded-lg px-3 py-2 text-sm"
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--color-border)",
              color: "var(--text-primary)",
              minWidth: 220,
            }}
          />
          {continentOptions.length > 1 && (
            <select
              value={continent}
              onChange={(e) => setContinent(e.target.value)}
              aria-label={t("places:checklist.continentFilter")}
              className="rounded-lg px-3 py-2 text-sm"
              style={SELECT_STYLE}
            >
              <option value="all">{t("places:checklist.allContinents")}</option>
              {continentOptions.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
          {countryOptions.length > 1 && (
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              aria-label={t("places:checklist.countryFilter")}
              className="rounded-lg px-3 py-2 text-sm"
              style={SELECT_STYLE}
            >
              <option value="all">{t("places:checklist.allCountries")}</option>
              {countryOptions.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
          {/* Ordering. Disabled in the suggestion view, where the ranking IS
              the content and a picker that did nothing would be a lie. */}
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            disabled={rowFilter === "suggested"}
            aria-label={t("places:checklist.sortBy")}
            className="rounded-lg px-3 py-2 text-sm disabled:opacity-40"
            style={SELECT_STYLE}
          >
            <option value="name">{t("places:checklist.sortName")}</option>
            <option value="country">{t("places:checklist.sortCountry")}</option>
            <option value="continent">{t("places:checklist.sortContinent")}</option>
          </select>
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setRowFilter(f.id)}
              disabled={f.id === "suggested" && suggestions.length === 0}
              className="rounded-full px-3 py-1.5 text-xs disabled:opacity-40"
              style={{
                border: "1px solid var(--color-border)",
                background: rowFilter === f.id ? "var(--bg-elevated)" : "transparent",
                color: rowFilter === f.id ? "var(--accent)" : "var(--text-muted)",
                fontWeight: rowFilter === f.id ? 600 : 400,
              }}
            >
              {f.label} · {f.count}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <p className="py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            {t("places:checklist.noMatches")}
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }} className="grid gap-2">
            {shown.map((item) => (
              <ChecklistRow
                key={item.itemId}
                item={item}
                suggestion={suggestionById.get(item.itemId) ?? null}
                accent={accent}
                busy={busyItem === item.itemId}
                // Sorting by something invisible looks like sorting by nothing,
                // so the key being sorted on is shown on the row.
                groupLabel={
                  rowFilter === "suggested" || sortKey === "name"
                    ? null
                    : sortKey === "continent"
                      ? continentLabel(item.continent, t)
                      : item.isoCountryCode
                        ? (countryName(item.isoCountryCode, i18n.language) ?? item.isoCountryCode)
                        : "—"
                }
                onToggle={handleToggle}
              />
            ))}
          </ul>
        )}

        {hidden > 0 && (
          <p className="mt-3 text-center text-xs" style={{ color: "var(--text-muted)" }}>
            {t("places:checklist.moreHidden", { count: hidden })}
          </p>
        )}

        <button
          type="button"
          onClick={() => navigate("/places")}
          className="mt-6 text-sm underline"
          style={{ color: "var(--text-muted)" }}
        >
          {t("places:detail.backToList")}
        </button>
      </div>
    </PageTransition>
  );
}
