import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import AppShell from "../components/ui/AppShell";
import LogbookTabs from "../components/table/LogbookTabs";
import ListSummaryStrip from "../components/table/ListSummaryStrip";
import { railSummaryFigures } from "../lib/rail/railSummaryFigures";
import ConfirmModal from "../components/Training/ConfirmModal";
import { RailFormModal } from "../components/rail/RailFormModal";
import DomainImportPanel from "../components/import/DomainImportPanel";
import { useRailImportAdapter } from "../components/import/adapters/railAdapter";
import { RailConnectionRow } from "../components/rail/RailConnectionRow";
import { LoyaltyFilterNotice, useLoyaltyListFilter } from "../components/Loyalty/LoyaltyListFilter";
import { useTranslation } from "../hooks/useTranslation";
import { railApi, type RailConnectionPage } from "../lib/api/rail";
import { logger } from "../lib/logger";
import { useToastStore } from "../store/toastStore";
import type { RailConnection, RailJourney } from "../types/rail";

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

type Editing = { journey: RailJourney | null } | null;

/**
 * One page of the logbook. Normally the server's connections (forgejo#187): a
 * ride with changes is one entry, and a page never cuts one. Opened from a
 * loyalty card's figure the list shows the rides the card COUNTED — trains,
 * one by one — so that view keeps the leg list, each train an entry of its own.
 */
async function loadPage(
  query: string,
  membershipId: string | null,
  linkedYear: number | null,
  offset: number
): Promise<RailConnectionPage> {
  if (membershipId === null) {
    return railApi.listConnections({ q: query || undefined, limit: PAGE_SIZE, offset });
  }
  const page = await railApi.list({
    q: query || undefined,
    membershipId,
    year: linkedYear ?? undefined,
    limit: PAGE_SIZE,
    offset,
  });
  return {
    connections: page.journeys.map((journey) => ({ id: journey.id, legs: [journey] })),
    total: page.total,
  };
}

/**
 * The rail logbook — phase 1 of docs/superpowers/specs/2026-09-25-rail-domain.md.
 * A server-paged list, newest departure first, with create, edit and delete.
 * The route is gated twice (beta switch + domain choice) in App.tsx.
 */
export default function RailPage(): JSX.Element {
  const { t } = useTranslation(["rail", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  // One entry per ride; `total` counts entries, which is what "more" pages over.
  const [entries, setEntries] = useState<RailConnection[]>([]);
  // The trains on screen — what the summary strip counts, as it always did.
  const journeys = useMemo(() => entries.flatMap((entry) => entry.legs), [entries]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Editing>(null);
  const [toDelete, setToDelete] = useState<RailJourney | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [adding, setAdding] = useState(false);
  const railAdapter = useRailImportAdapter();
  // A rail card's figure opens this list on the rides it counted
  // (`?membership=…&year=…`); there is no year filter here to seed, so the
  // notice names the year.
  const loyaltyFilter = useLoyaltyListFilter();
  const { membershipId, linkedYear } = loyaltyFilter;

  useEffect(() => {
    const handle = setTimeout(() => setQuery(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [search]);

  const load = useCallback(
    async (offset: number): Promise<void> => {
      setLoading(true);
      try {
        const page = await loadPage(query, membershipId, linkedYear, offset);
        setEntries((prev) => (offset === 0 ? page.connections : [...prev, ...page.connections]));
        setTotal(page.total);
        setLoadFailed(false);
      } catch (err: unknown) {
        // A failed load is said, never drawn as an empty logbook.
        logger.error("RailPage: failed to load journeys", err);
        setLoadFailed(true);
      } finally {
        setLoading(false);
      }
    },
    [query, membershipId, linkedYear]
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  const handleSaved = async (): Promise<void> => {
    setEditing(null);
    addToast("success", t("rail:saved"));
    await load(0);
  };

  const confirmDelete = async (): Promise<void> => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await railApi.remove(toDelete.id);
      addToast("success", t("rail:deleted"));
      setToDelete(null);
      await load(0);
    } catch (err: unknown) {
      logger.error("RailPage: delete failed", err);
      addToast("error", t("rail:deleteError"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AppShell width="table">
      <LogbookTabs />
      <div className="w-full">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="t-screen-title">{t("rail:title")}</h1>
          <button
            type="button"
            onClick={(): void => setAdding(true)}
            className="rounded-md bg-(--accent) px-4 py-2 text-sm font-medium text-(--bg-base)"
          >
            {t("rail:add")}
          </button>
        </div>
        <p className="t-caption mb-4">
          {t("rail:subtitle")} {t("rail:betaNote")}
        </p>
        {membershipId !== null && (
          <div className="mb-3">
            <LoyaltyFilterNotice
              membershipId={membershipId}
              year={linkedYear}
              onClear={loyaltyFilter.clear}
            />
          </div>
        )}
        <input
          type="search"
          aria-label={t("rail:search")}
          placeholder={t("rail:search")}
          value={search}
          onChange={(e): void => setSearch(e.target.value)}
          className="mb-3 w-full rounded-md border border-border bg-(--bg-surface) px-3 py-2 text-sm"
        />

        {loadFailed ? (
          <p role="alert" className="py-6 text-(--danger)">
            {t("rail:loadError")}
          </p>
        ) : !loading && journeys.length === 0 ? (
          <p className="py-6 text-(--text-muted)">{t("rail:empty")}</p>
        ) : (
          <>
            {/* The same strip the flight and cruise lists carry, so the
                logbook reads alike across areas (owner, 2026-09-28). It
                replaces the bare "N journeys" line, whose number it already
                carries as its first figure. */}
            <ListSummaryStrip
              figures={railSummaryFigures(journeys, {
                journeys: (count: number) => t("rail:summary.journeys", { count }),
                operators: (count: number) => t("rail:summary.operators", { count }),
                stations: (count: number) => t("rail:summary.stations", { count }),
                withoutOperator: (count: number) => t("rail:summary.withoutOperator", { count }),
              })}
              filtered={search.trim().length > 0}
              filteredLabel={t("common:filters.filtered")}
              unknown={loading}
            />
            <ul>
              {entries.map((entry) => (
                <RailConnectionRow
                  key={entry.id}
                  connection={entry}
                  onEdit={(j): void => setEditing({ journey: j })}
                  onDelete={setToDelete}
                />
              ))}
            </ul>
            {entries.length < total && (
              <button
                type="button"
                disabled={loading}
                onClick={(): void => void load(entries.length)}
                className="mt-4 rounded-md border border-border px-4 py-2 text-sm"
              >
                {t("rail:more")}
              </button>
            )}
          </>
        )}
      </div>

      {/* New rides start at the chooser: a ticket to read, or typing it in. */}
      <DomainImportPanel
        open={adding}
        onClose={(): void => setAdding(false)}
        onItemsCreated={(): Promise<void> => load(0)}
        adapter={railAdapter}
      />
      {editing && (
        <RailFormModal
          journey={editing.journey}
          onClose={(): void => setEditing(null)}
          onSaved={handleSaved}
          onProgress={(): Promise<void> => load(0)}
        />
      )}
      <ConfirmModal
        isOpen={toDelete !== null}
        onClose={(): void => setToDelete(null)}
        onConfirm={(): void => void confirmDelete()}
        isLoading={deleting}
        title={t("rail:delete")}
        message={t("rail:deleteConfirm")}
        confirmText={t("common:buttons.delete")}
      />
    </AppShell>
  );
}
