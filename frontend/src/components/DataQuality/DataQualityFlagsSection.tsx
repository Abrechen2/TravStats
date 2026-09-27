import { useCallback, useEffect, useState } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { dataQualityFlagsApi } from "../../lib/api/dataQualityFlags";
import { logger } from "../../lib/logger";
import { useToastStore } from "../../store/toastStore";
import type { DataQualityFlag, DataQualityFlagStatus } from "../../types/dataQuality";
import { TIME_FLAG_KINDS } from "../../types/timeMigration";

import DataQualityFlagCard from "./DataQualityFlagCard";
import Button from "../ui/Button";

/**
 * The "Zu prüfen" half of the Posteingang.
 *
 * One inbox, two tables (design §3.5): a `PendingFlightUpdate` is a provider's
 * proposed field values for a flight, a `DataQualityFlag` is a question about
 * any record. They share a page and nothing else — this section owns its own
 * fetching, its own filter and its own error handling, so the flight-updates
 * section above it behaves exactly as it did before.
 *
 * The filter offers the answered statuses as well as the open ones. `dismissed`
 * is the only permanent answer, which makes it the one a user is most likely to
 * want to look back at.
 */

const STATUS_OPTIONS: (DataQualityFlagStatus | "all")[] = [
  "open",
  "resolved",
  "dismissed",
  "all",
] as const;

/**
 * The time model's questions (ADR 0002 phase 3b: a zone that could not be
 * resolved, a time of day nobody knows, a day two readings disagree on) are
 * not contradictions — nothing disagrees, something is missing. They get
 * their own heading and sentence; the contradiction sentence ("zwei Angaben
 * widersprechen sich") above them was simply untrue.
 */
const isTimeQuestion = (flag: DataQualityFlag): boolean =>
  (TIME_FLAG_KINDS as readonly string[]).includes(flag.kind);

export default function DataQualityFlagsSection({
  onOpenCount,
}: {
  /** Reports how many questions are open, for the tab label above. */
  onOpenCount?: (count: number) => void;
} = {}): JSX.Element {
  const { t } = useTranslation(["dataQuality", "common"]);
  const addToast = useToastStore((state) => state.addToast);

  const [flags, setFlags] = useState<DataQualityFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<DataQualityFlagStatus | "all">("open");

  const loadFlags = useCallback(async () => {
    try {
      setLoading(true);
      const data = await dataQualityFlagsApi.getAll({ status: statusFilter });
      setFlags(data.flags ?? []);
      if (statusFilter === "open") onOpenCount?.((data.flags ?? []).length);
    } catch (error) {
      logger.error("Failed to load data-quality flags:", error);
      addToast("error", t("dataQuality:inbox.errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, addToast, t, onOpenCount]);

  useEffect(() => {
    void loadFlags();
  }, [loadFlags]);

  // "I have corrected the data" — a later run re-opens it if it did not stick.
  const handleResolve = async (id: string): Promise<void> => {
    try {
      setBusyId(id);
      await dataQualityFlagsApi.resolve(id);
      addToast("success", t("dataQuality:inbox.messages.resolved"));
      await loadFlags();
    } catch (error) {
      logger.error("Failed to resolve data-quality flag:", error);
      addToast("error", t("dataQuality:inbox.errors.resolveFailed"));
    } finally {
      setBusyId(null);
    }
  };

  // "This is not wrong, stop asking" — never re-opened.
  const handleDismiss = async (id: string): Promise<void> => {
    try {
      setBusyId(id);
      await dataQualityFlagsApi.dismiss(id);
      addToast("success", t("dataQuality:inbox.messages.dismissed"));
      await loadFlags();
    } catch (error) {
      logger.error("Failed to dismiss data-quality flag:", error);
      addToast("error", t("dataQuality:inbox.errors.dismissFailed"));
    } finally {
      setBusyId(null);
    }
  };

  const handleRun = async (): Promise<void> => {
    try {
      setRunning(true);
      const summary = await dataQualityFlagsApi.run();
      // Interpolated as `open`, not `count`: i18next reads `count` as a plural
      // selector and would look for `checked_one`/`checked_other` instead.
      addToast("success", t("dataQuality:inbox.messages.checked", { open: summary.open }));
      await loadFlags();
    } catch (error) {
      logger.error("Failed to re-run data-quality checks:", error);
      addToast("error", t("dataQuality:inbox.errors.runFailed"));
    } finally {
      setRunning(false);
    }
  };

  return (
    <section>
      {/* Round 4: the tab above names the section; the status select became
          pills, the recheck sits right. Each group below carries its own
          sentence, so the intro says what its cards are. */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label={t("dataQuality:inbox.review.filter.label")}
          className="flex flex-wrap gap-2"
        >
          {STATUS_OPTIONS.map((option) => {
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
                {t(`dataQuality:inbox.review.filter.${option}`)}
              </button>
            );
          })}
        </div>
        <Button onClick={() => void handleRun()} disabled={running}>
          {running
            ? t("dataQuality:inbox.review.rechecking")
            : t("dataQuality:inbox.review.recheck")}
        </Button>
      </div>

      {loading ? (
        <div
          className="rounded-[var(--ts-radius-card)] p-6 text-center"
          style={{ background: "var(--ts-surface)", border: "1px solid var(--ts-border)" }}
        >
          <span className="t-caption">{t("common:loading.default")}</span>
        </div>
      ) : flags.length === 0 ? (
        <div
          className="rounded-[var(--ts-radius-card)] p-8 text-center"
          style={{ background: "var(--ts-surface)", border: "1px solid var(--ts-border)" }}
        >
          <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--ts-text-bright)" }}>
            {t("dataQuality:inbox.review.empty.title")}
          </h3>
          <p className="t-caption mt-1">{t("dataQuality:inbox.review.empty.description")}</p>
        </div>
      ) : (
        [
          { key: "contradictions", items: flags.filter((f) => !isTimeQuestion(f)) },
          { key: "time", items: flags.filter(isTimeQuestion) },
        ]
          .filter((group) => group.items.length > 0)
          .map((group, index, groups) => (
            <div
              key={group.key}
              className={index > 0 ? "mt-8" : undefined}
              data-testid={`flag-group-${group.key}`}
            >
              {/* A heading only when both kinds are on the page. */}
              {groups.length > 1 && (
                <h3
                  className="mb-1"
                  style={{ fontSize: 15, fontWeight: 700, color: "var(--ts-text-bright)" }}
                >
                  {t(`dataQuality:inbox.review.${group.key}.title`)}
                </h3>
              )}
              <p className="t-caption mb-4">
                {group.key === "time"
                  ? t("dataQuality:inbox.review.time.description")
                  : t("dataQuality:inbox.review.description")}
              </p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {group.items.map((flag) => (
                  <DataQualityFlagCard
                    key={flag.id}
                    flag={flag}
                    busy={busyId === flag.id}
                    onResolve={() => void handleResolve(flag.id)}
                    onDismiss={() => void handleDismiss(flag.id)}
                  />
                ))}
              </div>
            </div>
          ))
      )}
    </section>
  );
}
