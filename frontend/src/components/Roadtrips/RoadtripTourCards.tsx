import type { JSX } from "react";
import { Link } from "react-router-dom";

import { Icon, type IconName } from "../ui/Icon";
import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat } from "../../lib/displayFormat";
import type { TourActivity } from "../../shared/tour/roadtrip";
import type { RoadtripDayTour, RoadtripStation } from "../../types/roadtrip";

const ACTIVITY_ICON: Record<TourActivity, IconName> = {
  hike: "mountain",
  walk: "mountain",
  run: "activity",
  bike: "bike",
  mtb: "bike",
  ski: "mountain",
  paddle: "route",
  climb: "mountain",
  other: "route",
};

function hoursMinutes(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")} h`;
}

/**
 * The day tours of a roadtrip (board 2): what each was, how far, how high,
 * how long moving, and at which station it began. A figure the recording
 * does not carry is a dash that says why on hover — a track without
 * elevation did not climb nothing — and a Strava tour says that only the
 * reader sees it, which is what Strava's terms require.
 */
export default function RoadtripTourCards({
  tours,
  stations,
}: {
  tours: RoadtripDayTour[];
  stations: RoadtripStation[];
}): JSX.Element {
  const { t, i18n } = useTranslation(["roadtrips"]);
  const display = useDisplayFormat();
  const nf1 = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 });
  const nf0 = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 });
  const stationTitle = new Map(stations.map((s) => [s.id, s.title]));

  if (tours.length === 0) {
    return <p className="t-caption">{t("roadtrips:detail.toursEmpty")}</p>;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {tours.map((tour) => {
        const station = tour.anchorStopId ? stationTitle.get(tour.anchorStopId) : undefined;
        const meta = [
          tour.activity ? t(`roadtrips:activity.${tour.activity}`) : null,
          tour.startedAt ? display.date(tour.startedAt, { omitYear: true }) : null,
        ]
          .filter(Boolean)
          .join(" · ");
        const foot = [
          station ? t("roadtrips:detail.tourAt", { station }) : null,
          tour.source ? t(`roadtrips:detail.source.${tour.source}`) : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <Link
            key={tour.id}
            to={`/tours/${tour.id}`}
            className="flex flex-col"
            style={{
              gap: 10,
              padding: "var(--ts-space-lg)",
              borderRadius: "var(--ts-radius-card)",
              background: "var(--ts-surface)",
              border: "1px solid var(--ts-border)",
              color: "inherit",
              textDecoration: "none",
            }}
          >
            <div className="flex items-center" style={{ gap: 8 }}>
              <span style={{ color: "var(--domain-tour)" }}>
                <Icon name={tour.activity ? ACTIVITY_ICON[tour.activity] : "route"} size={16} />
              </span>
              <span style={{ fontSize: 16, fontWeight: 800 }}>{tour.name}</span>
              {meta && <span className="t-caption">{meta}</span>}
            </div>
            <div className="grid grid-cols-3 t-meta-mono" style={{ fontSize: 14 }}>
              <span>{nf1.format(tour.distanceKm)} km</span>
              <span title={tour.ascentM === null ? t("roadtrips:detail.noElevation") : undefined}>
                ↑ {tour.ascentM === null ? "—" : `${nf0.format(tour.ascentM)} m`}
              </span>
              <span
                title={tour.movingSeconds === null ? t("roadtrips:detail.noMoving") : undefined}
              >
                {tour.movingSeconds === null ? "—" : hoursMinutes(tour.movingSeconds)}
              </span>
            </div>
            {foot && <span className="t-caption">{foot}</span>}
          </Link>
        );
      })}
    </div>
  );
}
