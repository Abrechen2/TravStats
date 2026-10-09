import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Link, useParams } from "react-router-dom";
import AppShell from "../components/ui/AppShell";
import DetailHeader from "../components/ui/DetailHeader";
import DetailKpis, { type DetailKpi } from "../components/ui/DetailKpis";
import DetailSection from "../components/ui/DetailSection";
import Button from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { useTranslation } from "../hooks/useTranslation";
import { railApi } from "../lib/api/rail";
import { classifyLoadFailure, type LoadFailure } from "../lib/api/loadFailure";
import { logger } from "../lib/logger";
import {
  connectionDurationMinutes,
  connectionSpan,
  connectionStations,
  connectionStatus,
} from "../lib/rail/railConnection";
import { RailConnectionView } from "../components/rail/RailConnectionView";
import { formatRailDuration } from "../lib/rail/railDuration";
import { formatRailSpan } from "../lib/railTime";
import type { RailConnectionDetail } from "../types/rail";

/**
 * A whole train ride (forgejo#187): the page between the logbook and a single
 * train. It lists the ride's trains in travel order, each linking to its own
 * page, with the wait at every change. Reached by any of its legs' ids, so a
 * link stays good when the first leg is deleted. It edits nothing — a train is
 * edited on its own page — and it states no distance, because the legs'
 * figures may mix a straight line with a traced one.
 *
 * Gated in App.tsx like the logbook: the `railDomain` beta switch, then the
 * user's domain choice.
 */
export default function RailConnectionPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation(["rail", "common"]);
  const locale = i18n.language.startsWith("en") ? "en-GB" : "de-DE";
  const [connection, setConnection] = useState<RailConnectionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setFailure(null);
      try {
        const loaded = await railApi.getConnection(id);
        if (!cancelled) setConnection(loaded);
      } catch (err: unknown) {
        logger.error("RailConnectionPage: failed to load connection", err);
        if (!cancelled) setFailure(classifyLoadFailure(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  if (loading) {
    return (
      <AppShell width="list">
        <p className="text-(--text-muted)">{t("rail:detail.loading")}</p>
      </AppShell>
    );
  }
  if (failure !== null || !connection || connection.legs.length === 0) {
    const isLoadError = failure === "loadError";
    return (
      <AppShell width="reading">
        <Link to="/rail" className="ts-back-link text-sm text-(--text-muted)">
          ← {t("rail:title")}
        </Link>
        <div
          role="alert"
          className="mt-4 rounded-md border border-(--danger)/50 bg-(--danger)/10 p-4 text-sm text-(--danger)"
        >
          {isLoadError ? t("rail:connection.loadError") : t("rail:connection.notFound")}
        </div>
        {isLoadError && (
          <div className="mt-3">
            <Button onClick={() => setReloadKey((k) => k + 1)}>{t("common:buttons.retry")}</Button>
          </div>
        )}
      </AppShell>
    );
  }

  const { legs } = connection;
  const span = connectionSpan(legs);
  const duration = connectionDurationMinutes(legs);
  const status = connectionStatus(legs);
  const changes = legs.length - 1;

  const kpis: DetailKpi[] = [
    ...(duration !== null
      ? [
          {
            key: "duration",
            value: formatRailDuration(duration, t),
            label: t("rail:connection.totalDuration"),
          },
        ]
      : []),
    {
      key: "changes",
      value: String(changes),
      label: t("rail:connection.changesLabel", { count: changes }),
    },
    {
      key: "trains",
      value: String(legs.length),
      label: t("rail:connection.trainsLabel", { count: legs.length }),
    },
  ];

  return (
    <AppShell width="list">
      <DetailHeader
        backTo="/rail"
        backLabel={t("rail:detail.back")}
        domain="rail"
        icon={<Icon name="train-front" size={24} />}
        title={connectionStations(legs).join(" → ")}
        meta={[
          span ? formatRailSpan(span, locale) : null,
          connection.booking?.pnr
            ? t("rail:connection.booking", { pnr: connection.booking.pnr })
            : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        hero={<DetailKpis items={kpis} />}
        status={
          status ? (
            <span className="ts-status-pill" data-testid="rail-connection-status">
              {t(`rail:status.${status}`)}
            </span>
          ) : undefined
        }
      />

      <DetailSection title={t("rail:connection.legs")}>
        <RailConnectionView legs={legs} pnr={connection.booking?.pnr ?? null} showPnr={false} />
      </DetailSection>
    </AppShell>
  );
}
