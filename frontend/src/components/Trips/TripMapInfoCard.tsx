// The trip map's persistent info card: what was clicked, when, what kind of
// thing it is, and where to read more. It stays until it is closed — unlike a
// hover tooltip — and sits in a fixed corner instead of floating over the dot,
// so it can neither run off a tablet's edge nor hide the thing it describes.

import { Icon } from "../ui/Icon";
import { type JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { useCoarsePointer } from "../../hooks/useCoarsePointer";
import { formatDayLong } from "../../shared/time/calendar";
import { useTripMapInfoStore } from "../../store/tripMapInfoStore";

const DATE: Intl.DateTimeFormatOptions = {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
};

export function TripMapInfoCard({
  seqOf,
}: {
  /** The number the map shows on an entry, by its key. */
  seqOf: (key: string) => number | undefined;
}): JSX.Element | null {
  const { t, i18n } = useTranslation(["trips"]);
  const coarse = useCoarsePointer();
  const info = useTripMapInfoStore((s) => s.info);
  const close = useTripMapInfoStore((s) => s.close);
  if (!info) return null;
  const locale = i18n.language || "de";
  const when = info.span
    ? info.span.start === info.span.end
      ? formatDayLong(info.span.start, locale, DATE)
      : `${formatDayLong(info.span.start, locale, DATE)} – ${formatDayLong(info.span.end, locale, DATE)}`
    : t("trips:detail.map.info.undated");
  const seq = seqOf(info.key);
  const target = coarse ? "min-h-(--ts-size-touch-min) inline-flex items-center" : "";
  return (
    <section
      data-testid="trip-map-info-card"
      aria-label={info.title}
      className="absolute bottom-10 left-3 z-20 w-[min(20rem,calc(100%-1.5rem))] rounded-lg p-3 text-sm"
      style={{
        background: "rgba(13,17,23,0.92)",
        backdropFilter: "blur(6px)",
        border: "1px solid var(--color-border)",
        color: "var(--text-primary)",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            {seq !== undefined ? `${seq} · ` : ""}
            {t(`trips:detail.map.info.kind.${info.kind}`)}
          </p>
          <h3 className="truncate font-semibold">{info.title}</h3>
          {info.subtitle && (
            <p className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
              {info.subtitle}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={close}
          aria-label={t("trips:detail.map.info.close")}
          className={`rounded-md px-2 ${coarse ? "min-h-(--ts-size-touch-min) min-w-(--ts-size-touch-min)" : "py-0.5"}`}
        >
          <Icon name="x" size={16} />
        </button>
      </div>
      <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
        {when}
      </p>
      {(info.entityHref || info.timelineHref) && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {info.timelineHref && (
            <Link to={info.timelineHref} className={`underline ${target}`}>
              {t("trips:detail.map.info.openTimeline")}
            </Link>
          )}
          {info.entityHref && (
            <Link to={info.entityHref} className={`underline ${target}`}>
              {t("trips:detail.map.info.openEntity")}
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
