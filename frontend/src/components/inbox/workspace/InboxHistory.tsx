import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { dataQualityFlagsApi } from "../../../lib/api/dataQualityFlags";
import { dawarichStaysApi } from "../../../lib/api/dawarichStays";
import { pendingUpdatesApi } from "../../../lib/api/pendingUpdates";
import { useDisplayFormat } from "../../../lib/displayFormat";
import { logger } from "../../../lib/logger";
import Button from "../../ui/Button";
import { Card } from "../../ui/Card";
import EmptyState from "../../ui/EmptyState";
import { GlobeLoader } from "../../GlobeLoader";
import { flagSubject, W, type Translate } from "./model";

/** The sources whose answers are kept and can be looked back at. */
export type HistorySource = "review" | "updates" | "dawarich";
export const HISTORY_SOURCES: readonly HistorySource[] = ["review", "updates", "dawarich"];

interface Row {
  key: string;
  title: string;
  status: string;
  when: string | null;
}
interface History {
  rows: Row[];
  /** Flight updates only: the totals the old updates tab printed. */
  totals: [string, number][] | null;
}

/**
 * What has already been answered, for one kind of item. The open inbox shows
 * questions; this is where a user looks back — above all at a "Das stimmt so",
 * the one answer that is never asked again. Read-only by design: nothing here
 * re-opens or changes a record.
 */
export default function InboxHistory({ source }: { source: HistorySource }) {
  const { t, i18n } = useTranslation(["dataQuality", "pendingUpdates", "trips"]);
  const format = useDisplayFormat();
  const [history, setHistory] = useState<History | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    setHistory(null);
    try {
      setHistory(await loadHistory(source, t, i18n.language));
    } catch (error) {
      logger.error("Failed to load the inbox history:", error);
      setFailed(true);
    }
    // Keyed on the language, not on `t`: the test helper hands out a new `t`
    // per render, and a reload per render would never settle.
  }, [source, i18n.language]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed)
    return (
      <Card flush>
        <EmptyState
          kind="degraded"
          title={t(`${W}.history.failed`)}
          action={<Button onClick={() => void load()}>{t(`${W}.retry`)}</Button>}
        />
      </Card>
    );
  if (!history)
    return (
      <div className="flex justify-center py-6">
        <GlobeLoader size={96} label={t(`${W}.loading`)} />
      </div>
    );
  return (
    <section aria-label={t(`${W}.history.title`)} className="space-y-3">
      {history.totals && history.totals.some(([, value]) => value > 0) && (
        <p
          className="t-caption flex flex-wrap gap-x-4"
          style={{ fontFamily: "var(--ts-font-mono)" }}
        >
          {history.totals.map(([key, value]) => (
            <span key={key}>
              {value} {t(`pendingUpdates:statistics.${key}`)}
            </span>
          ))}
        </p>
      )}
      {history.rows.length === 0 ? (
        <Card flush>
          <EmptyState kind="pending" title={t(`${W}.history.empty`)} />
        </Card>
      ) : (
        <ul className="space-y-2">
          {history.rows.map((row) => (
            <li key={row.key} className="rounded-lg border border-(--ts-border) p-3 text-sm">
              <span className="font-semibold">{row.title}</span>
              <span className="t-caption block">
                {row.status}
                {row.when ? ` · ${format.dateTime(row.when)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function loadHistory(
  source: HistorySource,
  t: Translate,
  language: string
): Promise<History> {
  if (source === "review") {
    const [resolved, dismissed] = await Promise.all([
      dataQualityFlagsApi.getAll({ status: "resolved" }),
      dataQualityFlagsApi.getAll({ status: "dismissed" }),
    ]);
    return {
      totals: null,
      rows: [...resolved.flags, ...dismissed.flags].map((flag) => ({
        key: flag.id,
        title: `${t(`dataQuality:kinds.${flag.kind}.title`)} · ${flagSubject(flag, t, language)}`,
        status: t(`dataQuality:flag.status.${flag.status}`),
        when: flag.resolvedAt,
      })),
    };
  }
  if (source === "updates") {
    const [applied, rejected, expired, stats] = await Promise.all([
      pendingUpdatesApi.getAll({ status: "applied" }),
      pendingUpdatesApi.getAll({ status: "rejected" }),
      pendingUpdatesApi.getAll({ status: "expired" }),
      pendingUpdatesApi.getStatistics(),
    ]);
    return {
      totals: [
        ["total", stats.totalUpdates],
        ["applied", stats.appliedUpdates],
        ["rejected", stats.rejectedUpdates],
        ["edited", stats.editedUpdates],
        ["expired", stats.expiredUpdates],
      ],
      rows: [...applied.updates, ...rejected.updates, ...expired.updates].map((u) => ({
        key: u.id,
        title: [u.flight?.flightNumber, u.flight?.depIata, "→", u.flight?.arrIata]
          .filter(Boolean)
          .join(" "),
        status: t(`pendingUpdates:status.${u.status}`),
        when: u.appliedAt ?? u.rejectedAt ?? u.expiresAt,
      })),
    };
  }
  const [accepted, rejected, covered, invalidated] = await Promise.all([
    dawarichStaysApi.list("accepted"),
    dawarichStaysApi.list("rejected"),
    dawarichStaysApi.list("covered"),
    // A TravTrack finding whose history went before it was accepted (E4).
    dawarichStaysApi.list("invalidated"),
  ]);
  return {
    totals: null,
    rows: [...accepted, ...rejected, ...covered, ...invalidated].map((stay) => ({
      key: stay.id,
      title: stay.name ?? t("trips:dawarichStays.unnamed"),
      // A covered finding says what already holds it, not just that it left.
      status: stay.evidence.coveredBy
        ? t(`trips:dawarichStays.coveredBy.${stay.evidence.coveredBy.kind}`, {
            name: stay.evidence.coveredBy.name,
          })
        : t(`trips:dawarichStays.status.${stay.status}`),
      when: stay.resolvedAt ?? stay.startAt,
    })),
  };
}
