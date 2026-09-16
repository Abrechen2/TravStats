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
import { useCallback, useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import PageHeader from "../components/ui/PageHeader";
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
  // Which half is open lives in the URL, so a link can land on the updates.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "updates" ? "updates" : "review";
  const [openQuestions, setOpenQuestions] = useState<number | null>(null);
  const reportOpen = useCallback((n: number) => setOpenQuestions(n), []);

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

  const tabs: { key: "review" | "updates"; label: string; count: number | null }[] = [
    { key: "review", label: t("dataQuality:inbox.review.title"), count: openQuestions },
    {
      key: "updates",
      label: t("dataQuality:inbox.flightUpdates.title"),
      count: statusFilter === "pending" ? pendingCount : null,
    },
  ];

  return (
    <AppShell width="list">
      <div className="w-full">
        <PageHeader
          title={t("dataQuality:inbox.title")}
          meta={t("dataQuality:inbox.description")}
        />

        {/* Round 4: the two halves as tabs rather than two stacked sections —
            the flight updates sat a long scroll below the questions. */}
        <div
          role="tablist"
          className="mb-6 flex overflow-x-auto scrollbar-none"
          style={{ borderBottom: "1px solid var(--ts-border)" }}
        >
          {tabs.map((item) => {
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() =>
                  setSearchParams(item.key === "updates" ? { tab: "updates" } : {}, {
                    replace: true,
                  })
                }
                className="flex shrink-0 items-center gap-2 whitespace-nowrap px-4 py-3 text-sm"
                style={{
                  fontWeight: active ? 700 : 500,
                  color: active ? "var(--ts-text-bright)" : "var(--ts-muted)",
                  boxShadow: `inset 0 -2px 0 ${active ? "var(--ts-accent)" : "transparent"}`,
                }}
              >
                {item.label}
                {item.count !== null && (
                  <span className="t-caption" style={{ fontFamily: "var(--ts-font-mono)" }}>
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Questions about the records first: nobody else will answer them,
            while a flight update expires on its own. The section stays mounted
            so its open count keeps the tab label current. */}
        <div hidden={tab !== "review"}>
          <DataQualityFlagsSection onOpenCount={reportOpen} />
        </div>

        <div hidden={tab !== "updates"}>
          <p className="t-caption mb-4">{t("dataQuality:inbox.flightUpdates.description")}</p>

          {/* The totals only once there are any: five zeros in colour read as
            a result, not as "nothing has happened yet". */}
          {statistics && statistics.totalUpdates > 0 && (
            <p
              className="t-caption mb-4 flex flex-wrap gap-x-4 gap-y-1"
              style={{ fontFamily: "var(--ts-font-mono)" }}
            >
              {(
                [
                  ["total", statistics.totalUpdates],
                  ["applied", statistics.appliedUpdates],
                  ["rejected", statistics.rejectedUpdates],
                  ["edited", statistics.editedUpdates],
                  ["expired", statistics.expiredUpdates],
                ] as const
              ).map(([key, value]) => (
                <span key={key}>
                  <span style={{ color: "var(--ts-text-bright)" }}>{value}</span>{" "}
                  {t(`pendingUpdates:statistics.${key}`)}
                </span>
              ))}
            </p>
          )}

          <div className="mb-5 flex flex-wrap items-center gap-3">
            <div
              role="group"
              aria-label={t("pendingUpdates:filters.status")}
              className="flex flex-wrap gap-2"
            >
              {(["pending", "edited", "applied", "rejected", "expired", "all"] as const).map(
                (option) => {
                  const active = statusFilter === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setStatusFilter(option)}
                      className="rounded-full px-3.5 py-1.5 text-sm font-semibold"
                      style={{
                        background: active ? "var(--ts-accent)" : "transparent",
                        color: active ? "var(--ts-accent-text)" : "var(--ts-text-bright)",
                        border: `1px solid ${active ? "var(--ts-accent)" : "var(--ts-border)"}`,
                      }}
                    >
                      {t(`pendingUpdates:filters.${option}`)}
                    </button>
                  );
                }
              )}
            </div>
            <label className="ml-auto flex items-center gap-2 text-sm">
              <span className="t-caption">{t("pendingUpdates:filters.sortBy")}</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as "createdAt" | "expiresAt")}
                className="rounded-full border px-3 py-1.5 text-sm"
                style={{
                  background: "var(--ts-surface)",
                  borderColor: "var(--ts-border)",
                  color: "var(--ts-text-bright)",
                }}
              >
                <option value="createdAt">{t("pendingUpdates:filters.createdAt")}</option>
                <option value="expiresAt">{t("pendingUpdates:filters.expiresAt")}</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
              aria-label={t("pendingUpdates:filters.sortOrder")}
              className="rounded-full border px-3 py-1.5 text-sm"
              style={{ borderColor: "var(--ts-border)", color: "var(--ts-text-bright)" }}
            >
              {sortOrder === "asc" ? "↑" : "↓"}
            </button>
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
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
        </div>

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
