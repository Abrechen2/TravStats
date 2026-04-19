import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { cruiseApi } from "../lib/api";
import type { Cruise, CruiseStatus } from "../types";
import { CruiseRow } from "../components/Cruise/CruiseRow";
import { CruiseEditModal } from "../components/Cruise/CruiseEditModal";
import NavigationBar from "../components/NavigationBar";
import { useTranslation } from "../hooks/useTranslation";

type StatusFilter = CruiseStatus | "all";
type YearFilter = number | "all";

const STATUSES: CruiseStatus[] = ["scheduled", "flown", "cancelled", "historical"];

export default function CruisesPage(): JSX.Element {
  const { t } = useTranslation("cruise");
  const navigate = useNavigate();
  const [cruises, setCruises] = useState<Cruise[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [showCreate, setShowCreate] = useState<boolean>(false);

  // Filter state — mirrors the flights filter panel conceptually but the
  // data domain is smaller so we inline rather than reuse <Filters />.
  const [search, setSearch] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [yearFilter, setYearFilter] = useState<YearFilter>("all");

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const data = await cruiseApi.list();
      setCruises(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Derive year dropdown options from loaded cruises so we only ever show
  // years the user actually has data for. Sorted descending (newest first).
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    for (const c of cruises) {
      if (c.startDate) years.add(new Date(c.startDate).getFullYear());
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [cruises]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return cruises.filter((c) => {
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (yearFilter !== "all") {
        const year = c.startDate ? new Date(c.startDate).getFullYear() : null;
        if (year !== yearFilter) return false;
      }
      if (needle.length > 0) {
        const shipName = c.ship?.name ?? c.shipNameOverride ?? "";
        const line = c.cruiseLine ?? c.ship?.cruiseLine ?? "";
        const haystack = `${shipName} ${line}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [cruises, search, statusFilter, yearFilter]);

  const resetFilters = (): void => {
    setSearch("");
    setStatusFilter("all");
    setYearFilter("all");
  };

  const hasActiveFilter = search.length > 0 || statusFilter !== "all" || yearFilter !== "all";

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-base)" }}>
      <NavigationBar />

      {/* Sticky filter bar — mirrors FlightsTablePage layout */}
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
              placeholder={t("filter.searchPlaceholder")}
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none md:max-w-xs"
            />
            <select
              value={statusFilter}
              onChange={(e): void => setStatusFilter(e.target.value as StatusFilter)}
              aria-label={t("filter.status")}
              className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
            >
              <option value="all">{t("filter.allStatuses")}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
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
              aria-label={t("filter.year")}
              className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
            >
              <option value="all">{t("filter.allYears")}</option>
              {availableYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            {hasActiveFilter && (
              <button
                type="button"
                onClick={resetFilters}
                className="rounded-md border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                {t("filter.reset")}
              </button>
            )}
          </div>
          <div className="text-xs text-[var(--text-muted)]">
            {t("filter.showing", { count: filtered.length })}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">{t("list.title")}</h1>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-[var(--accent-dim)]"
          >
            {t("list.new")}
          </button>
        </div>

        {loading ? (
          <div className="text-[var(--text-muted)]">Loading …</div>
        ) : filtered.length === 0 ? (
          <div className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-4 py-8 text-center text-[var(--text-muted)]">
            {t("list.empty")}
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--bg-surface)] text-[var(--text-muted)]">
                <tr>
                  <th className="px-3 py-2 text-left">{t("list.columns.ship")}</th>
                  <th className="px-3 py-2 text-left">{t("list.columns.line")}</th>
                  <th className="px-3 py-2 text-left">{t("list.columns.dates")}</th>
                  <th className="px-3 py-2 text-left">{t("list.columns.ports")}</th>
                  <th className="px-3 py-2 text-left">{t("list.columns.status")}</th>
                  <th className="px-3 py-2 text-left">{t("list.columns.cabin")}</th>
                  <th className="px-3 py-2 text-right">{t("list.columns.price")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <CruiseRow key={c.id} cruise={c} onOpen={() => navigate(`/cruises/${c.id}`)} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {showCreate && (
          <CruiseEditModal
            mode="create"
            onClose={() => setShowCreate(false)}
            onSaved={async () => {
              setShowCreate(false);
              await reload();
            }}
          />
        )}
      </div>
    </div>
  );
}
