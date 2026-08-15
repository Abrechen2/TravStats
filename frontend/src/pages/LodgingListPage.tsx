import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { Link, useNavigate } from "react-router-dom";
import NavigationBar from "../components/NavigationBar";
import { LodgingStatStrip } from "../components/Dashboard/tabs/lodging/LodgingStatStrip";
import { StarRating } from "../components/lodging/StarRating";
import { ChainNameLink } from "../components/lodging/ChainNameLink";
import { LodgingStatusTag } from "../components/lodging/LodgingStatusTag";
import DomainImportPanel from "../components/import/DomainImportPanel";
import { useLodgingImportAdapter } from "../components/import/adapters/lodgingAdapter";
import { useTranslation } from "../hooks/useTranslation";
import { getLodgingStats, listLodgings } from "../lib/api/lodging";
import { formatCurrency } from "../lib/units";
import {
  countUnconvertedStays,
  hasAnyPrice,
  lodgingTypeIcon,
  singleCurrencySpend,
  singleOriginalCurrencySpend,
} from "../lib/lodgingFormat";
import { FlagImg, resolveCountryCode } from "../lib/countryFlag";
import { logger } from "../lib/logger";
import { useSettingsStore } from "../store/settingsStore";
import type { Lodging, LodgingListQuery, LodgingStats, LodgingType } from "../types/lodging";

type TypeFilter = LodgingType | "all";
type YearFilter = number | "all";
type CountryFilter = string | "all";
type SortKey = NonNullable<LodgingListQuery["sort"]>;

const TYPES: LodgingType[] = ["hotel", "campsite", "guesthouse", "apartment", "hostel"];
const SORT_KEYS: SortKey[] = ["name", "nights", "rating", "spend"];

export default function LodgingListPage(): JSX.Element {
  const { t } = useTranslation(["lodging", "common", "settings", "import"]);
  const navigate = useNavigate();
  // `totalSpendBase` is computed by the backend in the user's actual base
  // currency (`UserSettings.baseCurrency`) — NOT `units.currency`, which is an
  // independent display preference used elsewhere for flight-cost figures.
  const baseCurrency = useSettingsStore((s) => s.baseCurrency);

  // `baseline` is an UNFILTERED fetch, used only to derive the year/country
  // dropdown option sets so they don't shrink as the user narrows other
  // filters. `rows` is what's actually shown — always the server's response
  // to the CURRENT filter+sort query, never re-sorted here (the backend
  // computes `nights`/`rating`/`spend` from each lodging's stays and sorts
  // the full set BEFORE paginating; re-sorting an already-paginated page
  // client-side would silently produce a different, wrong order).
  const [baseline, setBaseline] = useState<Lodging[]>([]);
  const [rows, setRows] = useState<Lodging[]>([]);
  const [stats, setStats] = useState<LodgingStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<boolean>(false);
  const [showAdd, setShowAdd] = useState<boolean>(false);
  const [search, setSearch] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [yearFilter, setYearFilter] = useState<YearFilter>("all");
  const [countryFilter, setCountryFilter] = useState<CountryFilter>("all");
  const [sortBy, setSortBy] = useState<SortKey>("name");

  useEffect(() => {
    void listLodgings({})
      .then(setBaseline)
      .catch((err: unknown) => logger.error("LodgingListPage: baseline fetch failed", err));
    void getLodgingStats()
      .then(setStats)
      .catch((err: unknown) => logger.error("LodgingListPage: stats fetch failed", err));
  }, []);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(false);
    try {
      const query: LodgingListQuery = { sort: sortBy };
      if (typeFilter !== "all") query.type = typeFilter;
      if (yearFilter !== "all") query.year = yearFilter;
      if (countryFilter !== "all") query.country = countryFilter;
      const data = await listLodgings(query);
      setRows(data);
    } catch (err: unknown) {
      logger.error("LodgingListPage: failed to load lodgings", err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [typeFilter, yearFilter, countryFilter, sortBy]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const reloadAll = useCallback(async (): Promise<void> => {
    await Promise.all([
      reload(),
      listLodgings({})
        .then(setBaseline)
        .catch((err: unknown) => logger.error("LodgingListPage: baseline reload failed", err)),
      getLodgingStats()
        .then(setStats)
        .catch((err: unknown) => logger.error("LodgingListPage: stats reload failed", err)),
    ]);
  }, [reload]);

  const availableYears = useMemo(() => {
    const years = new Set<number>();
    for (const l of baseline) {
      for (const stay of l.stays) {
        const year = new Date(stay.checkIn).getFullYear();
        if (!Number.isNaN(year)) years.add(year);
      }
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [baseline]);

  const availableCountries = useMemo(() => {
    const countries = new Set<string>();
    for (const l of baseline) {
      if (l.country) countries.add(l.country);
    }
    return Array.from(countries).sort((a, b) => a.localeCompare(b));
  }, [baseline]);

  // Search is client-side ONLY as a visibility narrower over the already
  // server-sorted `rows` — it never reorders them, so it can't reintroduce
  // the "sorted-then-truncated-then-resorted" bug the backend comment warns
  // about. The backend query schema has no free-text search param (Zod
  // `lodgingQuerySchema`), so there is nothing to pass through for it.
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle.length === 0) return rows;
    return rows.filter((l) => {
      const haystack = `${l.name} ${l.chain?.name ?? ""} ${l.city ?? ""}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [rows, search]);

  const resetFilters = (): void => {
    setSearch("");
    setTypeFilter("all");
    setYearFilter("all");
    setCountryFilter("all");
  };

  const hasActiveFilter =
    search.length > 0 || typeFilter !== "all" || yearFilter !== "all" || countryFilter !== "all";

  const importAdapter = useLodgingImportAdapter();

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-base)" }}>
      <NavigationBar />

      <div
        className="sticky top-14 z-10 px-4 py-3 backdrop-blur-md"
        style={{
          background: "rgba(13,17,23,0.85)",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <div className="mx-auto flex max-w-6xl flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-1 flex-col gap-2 md:flex-row md:items-center">
            <input
              type="search"
              value={search}
              onChange={(e): void => setSearch(e.target.value)}
              placeholder={t("lodging:filter.searchPlaceholder")}
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none md:max-w-xs"
            />
            <select
              value={typeFilter}
              onChange={(e): void => setTypeFilter(e.target.value as TypeFilter)}
              aria-label={t("lodging:filter.type")}
              className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
            >
              <option value="all">{t("lodging:filter.allTypes")}</option>
              {TYPES.map((ty) => (
                <option key={ty} value={ty}>
                  {t(`lodging:type.${ty}`)}
                </option>
              ))}
            </select>
            <select
              value={yearFilter === "all" ? "all" : String(yearFilter)}
              onChange={(e): void =>
                setYearFilter(
                  e.target.value === "all" ? "all" : Number.parseInt(e.target.value, 10)
                )
              }
              aria-label={t("lodging:filter.year")}
              className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
            >
              <option value="all">{t("lodging:filter.allYears")}</option>
              {availableYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <select
              value={countryFilter}
              onChange={(e): void => setCountryFilter(e.target.value)}
              aria-label={t("lodging:filter.country")}
              className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
            >
              <option value="all">{t("lodging:filter.allCountries")}</option>
              {availableCountries.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              value={sortBy}
              onChange={(e): void => setSortBy(e.target.value as SortKey)}
              aria-label={t("lodging:filter.sort")}
              className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
            >
              {SORT_KEYS.map((key) => (
                <option key={key} value={key}>
                  {t(`lodging:filter.sortOptions.${key}`)}
                </option>
              ))}
            </select>
            {hasActiveFilter && (
              <button
                type="button"
                onClick={resetFilters}
                className="rounded-md border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                {t("common:buttons.reset")}
              </button>
            )}
          </div>
          <div className="text-xs text-[var(--text-muted)]">
            {t("lodging:filter.showing", { count: filtered.length })}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
            {t("lodging:list.title")}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            {/* One way in, not three. "Buchung einlesen" used to sit here as
                its own button beside "Importieren" and "Hotel hinzufügen" —
                three controls for two ideas, and two of them saying "import".
                Reading a booking is not a separate act, it is the first and
                best ROUTE into adding one, so it lives inside this dialog now.
                The bulk hub keeps a quiet link below, not a rival button. */}
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="btn-primary flex items-center gap-2 whitespace-nowrap"
            >
              <span>+</span>
              <span>{t("lodging:add.title")}</span>
            </button>
          </div>
        </div>

        <p className="mb-4 text-xs text-(--text-muted)">
          {t("lodging:list.wholeListHint")}{" "}
          <Link
            to="/settings?section=import"
            className="underline underline-offset-4 hover:text-(--text-primary)"
          >
            {t("settings:import.openHub")}
          </Link>
        </p>

        {stats && <LodgingStatStrip stats={stats} variant="inline" />}

        {loading ? (
          <div className="text-[var(--text-muted)]">{t("lodging:list.loading")}</div>
        ) : loadError ? (
          <div
            role="alert"
            className="rounded-md border border-[var(--danger)]/50 bg-[var(--danger)]/10 px-4 py-4 text-sm text-[var(--danger)]"
          >
            {t("lodging:list.loadError")}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-4 py-8 text-center text-[var(--text-muted)]">
            {t("lodging:list.empty")}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-[var(--color-border)]">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-[var(--bg-surface)] text-[var(--text-muted)]">
                <tr>
                  <th className="px-3 py-2 text-left">{t("lodging:list.columns.name")}</th>
                  <th className="px-3 py-2 text-left">{t("lodging:list.columns.chain")}</th>
                  <th className="px-3 py-2 text-left">{t("lodging:list.columns.location")}</th>
                  <th className="px-3 py-2 text-left">{t("lodging:list.status.label")}</th>
                  <th className="px-3 py-2 text-right">{t("lodging:list.columns.stays")}</th>
                  <th className="px-3 py-2 text-right">{t("lodging:list.columns.nights")}</th>
                  <th className="px-3 py-2 text-left">{t("lodging:list.columns.rating")}</th>
                  <th className="px-3 py-2 text-right">{t("lodging:list.columns.spend")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => (
                  <tr
                    key={l.id}
                    onClick={() => navigate(`/lodging/${l.id}`)}
                    className="cursor-pointer border-t border-[var(--color-border)] hover:bg-[var(--bg-surface)]"
                  >
                    <td className="px-3 py-2">
                      <span aria-hidden className="mr-2">
                        {lodgingTypeIcon(l.type)}
                      </span>
                      <span className="font-medium text-[var(--text-primary)]">{l.name}</span>
                      {/* A saved-places import can bring in hundreds of houses
                          the user has never slept in. Without a mark they are
                          indistinguishable from the maintained ones. */}
                      {!l.visited && (
                        <span
                          data-testid={`lodging-bookmarked-${l.id}`}
                          title={t("lodging:list.bookmarkedHint")}
                          className="ml-2 rounded border border-[var(--color-border)] px-1 py-px text-[10px] text-[var(--text-muted)]"
                        >
                          {t("lodging:list.bookmarked")}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">
                      {l.chain ? (
                        <ChainNameLink chainId={l.chain.id} name={l.chain.name} />
                      ) : (
                        t("lodging:field.independent")
                      )}
                    </td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">
                      {l.city || l.country ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span>{l.city || l.country}</span>
                          <FlagImg country={resolveCountryCode(l.country)} height={12} />
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <LodgingStatusTag lodging={l} />
                    </td>
                    <td className="px-3 py-2 text-right">{l.stayCount}</td>
                    <td className="px-3 py-2 text-right">{l.nights}</td>
                    <td className="px-3 py-2">
                      <StarRating value={l.overallRating} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <LodgingSpendCell lodging={l} baseCurrency={baseCurrency} />
                      {hasOtherBaseCurrencySpend(l.totalSpendBaseByCurrency, baseCurrency) && (
                        <span
                          className="ml-1 align-super text-[10px] text-[var(--text-muted)]"
                          title={t("lodging:list.otherCurrencyHint")}
                        >
                          *
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* The CSV tile used to sit here. It now lives in the central import
            hub (Settings → Import), which is where every domain's LIST
            importers belong — the line under the heading links there. Reading
            a single booking is the first route in the add-dialog below. */}

        {/* The import log used to sit here. It moved to the central import
            hub (Settings → Import) together with the importers it belongs to —
            one place to import, one place to see and undo what was imported. */}

        {/* Adding asks "what do you have?" first: a booking mail or PDF fills
            everything in, typing it out is the last resort in the footer. The
            form itself is unchanged — it is now one route among several. */}
        <DomainImportPanel
          open={showAdd}
          onClose={() => setShowAdd(false)}
          onItemsCreated={reloadAll}
          adapter={importAdapter}
        />
      </div>
    </div>
  );
}

/**
 * True when this lodging has spend snapshotted under a base currency OTHER
 * than the user's current one — i.e. `totalSpendBase` (which only counts the
 * current-base slice) is not the whole picture. Used to render a small,
 * honest "*" hint rather than silently folding those older amounts in
 * (finding 2).
 */
function hasOtherBaseCurrencySpend(
  byCurrency: Record<string, number>,
  currentBaseCurrency: string
): boolean {
  return Object.keys(byCurrency).some((currency) => currency !== currentBaseCurrency);
}

/**
 * Spend column body for one list row (mockup screen ①): the original
 * currency amount with the converted total underneath when every priced
 * stay shares one non-base currency (e.g. "840 CHF" / "≈ 883 €"), the plain
 * converted total when spend is already base-currency or mixed, and "—"
 * (never "0 €") when nothing on this lodging has a recorded price at all.
 */
function LodgingSpendCell({
  lodging,
  baseCurrency,
}: {
  lodging: Lodging;
  baseCurrency: string;
}): JSX.Element {
  const { t } = useTranslation(["lodging"]);
  if (!hasAnyPrice(lodging.stays)) return <>—</>;

  const original = singleOriginalCurrencySpend(lodging.stays, baseCurrency);
  // Priced, but nothing converted: `totalSpendBase` is 0 because the sum has
  // no addends, NOT because the stay cost nothing. Rendering that zero told
  // the reader a hotel was free — and where an original amount was shown it
  // read "$780 ≈ 0 €", which is worse, because it looks like arithmetic.
  //
  // Asked as "is every priced stay unconverted", never as `totalSpendBase === 0`:
  // a genuinely free night (an award stay entered as 0) converts fine and its
  // total is honestly zero.
  const pricedCount = lodging.stays.filter((s) => s.totalPrice !== null).length;
  const unconverted = countUnconvertedStays(lodging.stays);
  const nothingConverted = unconverted === pricedCount;
  // Some converted, some not: the figure below is real but incomplete, and
  // saying so is the same rule the detail page and the stat strip follow.
  const omitted =
    !nothingConverted && unconverted > 0 ? (
      <div className="text-[10px] text-(--text-muted)" title={t("lodging:fx.tooltipNone")}>
        {t("lodging:fx.omittedFromTotal", { count: unconverted })}
      </div>
    ) : null;
  if (nothingConverted) {
    // `singleCurrencySpend`, not `original`: with no conversion shown next to
    // it there is nothing for a base-currency amount to be redundant WITH, and
    // hiding it left the row saying "kein Kurs" with no number at all.
    const amount = singleCurrencySpend(lodging.stays);
    return (
      <>
        {amount && <div>{formatCurrency(amount.amount, amount.currency)}</div>}
        <div className="text-[10px] text-(--text-muted)" title={t("lodging:fx.tooltipNone")}>
          {t("lodging:fx.markerNone")}
        </div>
      </>
    );
  }
  if (!original) {
    return (
      <>
        <div>{formatCurrency(lodging.totalSpendBase, baseCurrency)}</div>
        {omitted}
      </>
    );
  }

  return (
    <>
      <div>{formatCurrency(original.amount, original.currency)}</div>
      <div className="text-[10px]" style={{ color: "var(--fx, #6ab7d8)" }}>
        ≈ {formatCurrency(lodging.totalSpendBase, baseCurrency)}
      </div>
      {omitted}
    </>
  );
}
