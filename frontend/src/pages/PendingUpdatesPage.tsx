/**
 * Posteingang — the one place the user answers questions about their data.
 *
 * Two sections, two backends, on purpose (design §3.5, owner 2026-09-02):
 *
 * - **Zu prüfen** — `DataQualityFlag` rows: a record whose own two sources
 *   disagree, raised as a QUESTION. Nothing has been changed and nothing is
 *   marked correct.
 * - **Flug-Updates** — `PendingFlightUpdate` rows: a provider's proposed field
 *   values for one flight, with a diff and an apply/reject decision.
 *
 * `PendingFlightUpdate` carries a required `flightId`, `apiSource` and
 * `expiresAt` — it is flight-shaped by construction, and 858 lines of service
 * code depend on that shape. So the flag model got its own table with a generic
 * subject rather than being forced through it. The user sees one inbox; the
 * schema keeps apart two things that genuinely differ.
 *
 * The route stays `/pending-updates`. It is linked from the nav and from
 * `Settings/AutoUpdateSection`, and renaming a page is not a reason to break a
 * bookmark.
 */

import AppShell from "../components/ui/AppShell";
import EmptyState from "../components/ui/EmptyState";
import { Card } from "../components/ui/Card";
import { useState, useEffect } from "react";
import { useTranslation } from "../hooks/useTranslation";
import { pendingUpdatesApi, type StatisticsImpact } from "../lib/api";
import { useToastStore } from "../store/toastStore";
import { logger } from "../lib/logger";
import PendingUpdateCard from "../components/PendingUpdateCard";
import StatisticsImpactPreview from "../components/StatisticsImpactPreview";
import DataQualityFlagsSection from "../components/DataQuality/DataQualityFlagsSection";
import { GlobeLoader } from "../components/GlobeLoader";
import { useMinLoadingState } from "../hooks/useMinLoadingState";

interface FlightUpdateData {
  airline?: string;
  aircraft?: string;
  gate?: string;
  terminal?: string;
  depIata?: string;
  arrIata?: string;
  departureTime?: string;
  arrivalTime?: string;
  [key: string]: string | number | boolean | null | undefined;
}

interface ChangeEntry {
  field: string;
  type: "added" | "removed" | "changed";
  oldValue: string | number | boolean | null | undefined;
  newValue: string | number | boolean | null | undefined;
}

interface PendingUpdate {
  id: string;
  flightId: string;
  userId: string;
  status: "pending" | "applied" | "rejected" | "expired" | "edited";
  originalData: FlightUpdateData;
  proposedData: FlightUpdateData;
  editedData?: FlightUpdateData;
  changes: ChangeEntry[];
  editedChanges?: ChangeEntry[];
  apiSource: string;
  fetchedAt: string;
  expiresAt: string;
  appliedAt?: string;
  rejectedAt?: string;
  editedAt?: string;
  statisticsImpact?: StatisticsImpact;
  flight?: {
    id: string;
    flightNumber: string | null;
    airline: string | null;
    departureTime: string;
    arrivalTime: string;
    depIata: string | null;
    arrIata: string | null;
  };
}

interface Statistics {
  totalUpdates: number;
  appliedUpdates: number;
  rejectedUpdates: number;
  editedUpdates: number;
  expiredUpdates: number;
  mostChangedFields: Record<string, number>;
  averageUpdateTime: number | null;
}

export default function PendingUpdatesPage(): JSX.Element {
  const { t } = useTranslation(["common", "pendingUpdates", "dataQuality"]);
  const addToast = useToastStore((state) => state.addToast);

  const [updates, setUpdates] = useState<PendingUpdate[]>([]);
  const [statistics, setStatistics] = useState<Statistics | null>(null);
  const [loading, setLoading] = useState(true);
  const showLoader = useMinLoadingState(loading, 2000);
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [sortBy, setSortBy] = useState<"createdAt" | "expiresAt">("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [selectedUpdate, setSelectedUpdate] = useState<string | null>(null);

  useEffect(() => {
    loadUpdates();
    loadStatistics();
  }, [statusFilter]);

  const loadUpdates = async () => {
    try {
      setLoading(true);
      const filters: { status?: string; flightId?: string } = {};
      if (statusFilter && statusFilter !== "all") {
        filters.status = statusFilter;
      }
      const data = await pendingUpdatesApi.getAll(filters);
      setUpdates(data.updates || []);
    } catch (error) {
      logger.error("Failed to load pending updates:", error);
      addToast("error", t("pendingUpdates:errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  const loadStatistics = async () => {
    try {
      const stats = await pendingUpdatesApi.getStatistics();
      setStatistics(stats);
    } catch (error) {
      logger.error("Failed to load statistics:", error);
    }
  };

  const handleApply = async (id: string) => {
    try {
      await pendingUpdatesApi.apply(id);
      addToast("success", t("pendingUpdates:messages.applied"));
      loadUpdates();
      loadStatistics();
    } catch (error) {
      logger.error("Failed to apply update:", error);
      addToast("error", t("pendingUpdates:errors.applyFailed"));
    }
  };

  const handleReject = async (id: string) => {
    try {
      await pendingUpdatesApi.reject(id);
      addToast("success", t("pendingUpdates:messages.rejected"));
      loadUpdates();
      loadStatistics();
    } catch (error) {
      logger.error("Failed to reject update:", error);
      addToast("error", t("pendingUpdates:errors.rejectFailed"));
    }
  };

  const handleEdit = async (id: string, editedData: FlightUpdateData) => {
    try {
      await pendingUpdatesApi.update(id, editedData);
      addToast("success", t("pendingUpdates:messages.updated"));
      loadUpdates();
      loadStatistics();
    } catch (error) {
      logger.error("Failed to update:", error);
      addToast("error", t("pendingUpdates:errors.updateFailed"));
    }
  };

  const sortedUpdates = [...updates].sort((a, b) => {
    let aValue: number;
    let bValue: number;

    if (sortBy === "createdAt") {
      aValue = new Date(a.fetchedAt).getTime();
      bValue = new Date(b.fetchedAt).getTime();
    } else {
      aValue = new Date(a.expiresAt).getTime();
      bValue = new Date(b.expiresAt).getTime();
    }

    if (sortOrder === "asc") {
      return aValue - bValue;
    } else {
      return bValue - aValue;
    }
  });

  const pendingCount = updates.filter((u) => u.status === "pending").length;
  const editedCount = updates.filter((u) => u.status === "edited").length;

  return (
    <AppShell width="list">
      <div className="w-full">
        {/* Header */}
        <div className="mb-6">
          <h1 className="t-screen-title mb-2">{t("dataQuality:inbox.title")}</h1>
          <p style={{ color: "var(--text-muted)" }}>{t("dataQuality:inbox.description")}</p>
        </div>

        {/* Questions about the user's own records. First, because they are the
            ones nobody else will answer — a flight update expires on its own. */}
        <DataQualityFlagsSection />

        {/* Flight updates — behaviour unchanged from before the Posteingang
            rename; only the heading above it is new, because the page title is
            no longer this section's title. */}
        <div className="mb-4">
          <h2 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
            {t("dataQuality:inbox.flightUpdates.title")}
          </h2>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {t("dataQuality:inbox.flightUpdates.description")}
          </p>
        </div>

        {/* Statistics Dashboard */}
        {statistics && (
          <div
            className="rounded-lg shadow-xs p-6 mb-6"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
          >
            <h2 className="text-xl font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
              {t("pendingUpdates:statistics.title")}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div>
                <div className="text-sm" style={{ color: "var(--text-muted)" }}>
                  {t("pendingUpdates:statistics.total")}
                </div>
                <div className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
                  {statistics.totalUpdates}
                </div>
              </div>
              <div>
                <div className="text-sm" style={{ color: "var(--text-muted)" }}>
                  {t("pendingUpdates:statistics.applied")}
                </div>
                <div className="text-2xl font-bold text-(--success)">
                  {statistics.appliedUpdates}
                </div>
              </div>
              <div>
                <div className="text-sm" style={{ color: "var(--text-muted)" }}>
                  {t("pendingUpdates:statistics.rejected")}
                </div>
                <div className="text-2xl font-bold text-(--danger)">
                  {statistics.rejectedUpdates}
                </div>
              </div>
              <div>
                <div className="text-sm" style={{ color: "var(--text-muted)" }}>
                  {t("pendingUpdates:statistics.edited")}
                </div>
                <div className="text-2xl font-bold" style={{ color: "var(--color-amber)" }}>
                  {statistics.editedUpdates}
                </div>
              </div>
              <div>
                <div className="text-sm" style={{ color: "var(--text-muted)" }}>
                  {t("pendingUpdates:statistics.expired")}
                </div>
                <div className="text-2xl font-bold" style={{ color: "var(--text-muted)" }}>
                  {statistics.expiredUpdates}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Filters and Sort */}
        <div
          className="rounded-lg shadow-xs p-4 mb-6"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
        >
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[200px]">
              <label className="label mb-2">{t("pendingUpdates:filters.status")}</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="input w-full"
              >
                <option value="all">{t("pendingUpdates:filters.all")}</option>
                <option value="pending">
                  {t("pendingUpdates:filters.pending")} ({pendingCount})
                </option>
                <option value="edited">
                  {t("pendingUpdates:filters.edited")} ({editedCount})
                </option>
                <option value="applied">{t("pendingUpdates:filters.applied")}</option>
                <option value="rejected">{t("pendingUpdates:filters.rejected")}</option>
                <option value="expired">{t("pendingUpdates:filters.expired")}</option>
              </select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="label mb-2">{t("pendingUpdates:filters.sortBy")}</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as "createdAt" | "expiresAt")}
                className="input w-full"
              >
                <option value="createdAt">{t("pendingUpdates:filters.createdAt")}</option>
                <option value="expiresAt">{t("pendingUpdates:filters.expiresAt")}</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
                className="btn-secondary p-2"
              >
                {sortOrder === "asc" ? "↑" : "↓"}
              </button>
            </div>
          </div>
        </div>

        {/* Updates List */}
        {showLoader ? (
          <div className="flex justify-center py-12">
            <GlobeLoader size={160} label={t("common:loading.default")} />
          </div>
        ) : sortedUpdates.length === 0 ? (
          /* `pending`, not `nothing`. The copy is already in the future tense
             — "Updates erscheinen hier, wenn …" — so this is not "there is
             nothing", it is "it has not happened yet", which is the kind the
             design system paints in `info` and never in red. `nothing` would
             have owed the reader a call to action; a waiting state does not,
             because the nightly run is what fills this. */
          <Card flush>
            <EmptyState
              kind="pending"
              icon={
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M22 12h-6l-2 3h-4l-2-3H2" />
                  <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
                </svg>
              }
              title={t("pendingUpdates:empty.title")}
              description={t("pendingUpdates:empty.description")}
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {sortedUpdates.map((update) => (
              <PendingUpdateCard
                key={update.id}
                update={update}
                onApply={() => handleApply(update.id)}
                onReject={() => handleReject(update.id)}
                onEdit={(editedData) => handleEdit(update.id, editedData)}
                onSelect={() => setSelectedUpdate(update.id)}
                isSelected={selectedUpdate === update.id}
              />
            ))}
          </div>
        )}

        {/* Statistics Impact Preview Modal */}
        {selectedUpdate && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div
              className="rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
                    {t("pendingUpdates:preview.title")}
                  </h2>
                  <button
                    onClick={() => setSelectedUpdate(null)}
                    style={{ color: "var(--text-muted)" }}
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
                {(() => {
                  const update = updates.find((u) => u.id === selectedUpdate);
                  return update ? (
                    <StatisticsImpactPreview impact={update.statisticsImpact} />
                  ) : null;
                })()}
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
