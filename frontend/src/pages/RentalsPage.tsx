import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import AppShell from "../components/ui/AppShell";
import LogbookTabs from "../components/table/LogbookTabs";
import ConfirmModal from "../components/Training/ConfirmModal";
import { RentalFormModal } from "../components/rental/RentalFormModal";
import { RentalRow } from "../components/rental/RentalRow";
import DomainImportPanel from "../components/import/DomainImportPanel";
import { useRentalImportAdapter } from "../components/import/adapters/rentalAdapter";
import { useTranslation } from "../hooks/useTranslation";
import { rentalApi } from "../lib/api/rental";
import { logger } from "../lib/logger";
import { useToastStore } from "../store/toastStore";
import type { RentalBooking } from "../types/rental";

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

type Editing = { rental: RentalBooking | null } | null;

/**
 * The rental logbook — package R1 of
 * docs/superpowers/specs/2026-10-01-rental-domain-design.md: a server-paged
 * list, newest pickup first, with create, edit and delete. Gated twice (beta
 * switch + domain choice) in App.tsx.
 */
export default function RentalsPage(): JSX.Element {
  const { t } = useTranslation(["rental", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const [rentals, setRentals] = useState<RentalBooking[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Editing>(null);
  const [toDelete, setToDelete] = useState<RentalBooking | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [adding, setAdding] = useState(false);
  const rentalAdapter = useRentalImportAdapter();

  useEffect(() => {
    const handle = setTimeout(() => setQuery(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [search]);

  const load = useCallback(
    async (offset: number): Promise<void> => {
      setLoading(true);
      try {
        const page = await rentalApi.list({ q: query || undefined, limit: PAGE_SIZE, offset });
        setRentals((prev) => (offset === 0 ? page.rentals : [...prev, ...page.rentals]));
        setTotal(page.total);
        setLoadFailed(false);
      } catch (err: unknown) {
        // A failed load is said, never drawn as an empty logbook.
        logger.error("RentalsPage: failed to load rentals", err);
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
    addToast("success", t("rental:saved"));
    await load(0);
  };

  const confirmDelete = async (): Promise<void> => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await rentalApi.remove(toDelete.id);
      addToast("success", t("rental:deleted"));
      setToDelete(null);
      await load(0);
    } catch (err: unknown) {
      logger.error("RentalsPage: delete failed", err);
      addToast("error", t("rental:deleteError"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AppShell width="table">
      <LogbookTabs />
      <div className="w-full">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="t-screen-title">{t("rental:title")}</h1>
          <button
            type="button"
            onClick={(): void => setAdding(true)}
            className="rounded-md bg-(--accent) px-4 py-2 text-sm font-medium text-(--bg-base)"
          >
            {t("rental:add")}
          </button>
        </div>
        <p className="t-caption mb-4">
          {t("rental:subtitle")} {t("rental:betaNote")}
        </p>
        <input
          type="search"
          aria-label={t("rental:search")}
          placeholder={t("rental:search")}
          value={search}
          onChange={(e): void => setSearch(e.target.value)}
          className="mb-3 w-full rounded-md border border-border bg-(--bg-surface) px-3 py-2 text-sm"
        />

        {loadFailed ? (
          <p role="alert" className="py-6 text-(--danger)">
            {t("rental:loadError")}
          </p>
        ) : !loading && rentals.length === 0 ? (
          <p className="py-6 text-(--text-muted)">{t("rental:empty")}</p>
        ) : (
          <>
            <p className="t-caption mb-1">{t("rental:count", { count: total })}</p>
            <ul>
              {rentals.map((rental) => (
                <RentalRow
                  key={rental.id}
                  rental={rental}
                  onEdit={(r): void => setEditing({ rental: r })}
                  onDelete={setToDelete}
                />
              ))}
            </ul>
            {rentals.length < total && (
              <button
                type="button"
                disabled={loading}
                onClick={(): void => void load(rentals.length)}
                className="mt-4 rounded-md border border-border px-4 py-2 text-sm"
              >
                {t("rental:more")}
              </button>
            )}
          </>
        )}
      </div>

      {/* New rentals start at the chooser: a booking mail to read, or typing it in. */}
      <DomainImportPanel
        open={adding}
        onClose={(): void => setAdding(false)}
        onItemsCreated={(): Promise<void> => load(0)}
        adapter={rentalAdapter}
      />
      {editing && (
        <RentalFormModal
          rental={editing.rental}
          onClose={(): void => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
      <ConfirmModal
        isOpen={toDelete !== null}
        onClose={(): void => setToDelete(null)}
        onConfirm={(): void => void confirmDelete()}
        isLoading={deleting}
        title={t("rental:delete")}
        message={t("rental:deleteConfirm")}
        confirmText={t("common:buttons.delete")}
      />
    </AppShell>
  );
}
