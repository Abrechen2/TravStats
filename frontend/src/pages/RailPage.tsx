import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import AppShell from "../components/ui/AppShell";
import LogbookTabs from "../components/table/LogbookTabs";
import ConfirmModal from "../components/Training/ConfirmModal";
import { RailFormModal } from "../components/rail/RailFormModal";
import { RailJourneyRow } from "../components/rail/RailJourneyRow";
import { useTranslation } from "../hooks/useTranslation";
import { railApi } from "../lib/api/rail";
import { logger } from "../lib/logger";
import { useToastStore } from "../store/toastStore";
import type { RailJourney } from "../types/rail";

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

type Editing = { journey: RailJourney | null } | null;

/**
 * The rail logbook — phase 1 of docs/superpowers/specs/2026-09-25-rail-domain.md.
 * A server-paged list, newest departure first, with create, edit and delete.
 * The route is gated twice (beta switch + domain choice) in App.tsx.
 */
export default function RailPage(): JSX.Element {
  const { t } = useTranslation(["rail", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const [journeys, setJourneys] = useState<RailJourney[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Editing>(null);
  const [toDelete, setToDelete] = useState<RailJourney | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const handle = setTimeout(() => setQuery(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [search]);

  const load = useCallback(
    async (offset: number): Promise<void> => {
      setLoading(true);
      try {
        const page = await railApi.list({ q: query || undefined, limit: PAGE_SIZE, offset });
        setJourneys((prev) => (offset === 0 ? page.journeys : [...prev, ...page.journeys]));
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
    [query]
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
            onClick={(): void => setEditing({ journey: null })}
            className="rounded-md bg-(--accent) px-4 py-2 text-sm font-medium text-(--bg-base)"
          >
            {t("rail:add")}
          </button>
        </div>
        <p className="t-caption mb-4">
          {t("rail:subtitle")} {t("rail:betaNote")}
        </p>
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
            <p className="t-caption">{t("rail:count", { count: total })}</p>
            <ul>
              {journeys.map((journey) => (
                <RailJourneyRow
                  key={journey.id}
                  journey={journey}
                  onEdit={(j): void => setEditing({ journey: j })}
                  onDelete={setToDelete}
                />
              ))}
            </ul>
            {journeys.length < total && (
              <button
                type="button"
                disabled={loading}
                onClick={(): void => void load(journeys.length)}
                className="mt-4 rounded-md border border-border px-4 py-2 text-sm"
              >
                {t("rail:more")}
              </button>
            )}
          </>
        )}
      </div>

      {editing && (
        <RailFormModal
          journey={editing.journey}
          onClose={(): void => setEditing(null)}
          onSaved={handleSaved}
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
