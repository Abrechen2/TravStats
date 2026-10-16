import type { RailJourney } from "../../types/rail";
import { connectionDistance } from "../../lib/rail/connectionDistance";
import { railDistanceNoteKey } from "./railDistanceLabel";
import { useTranslation } from "../../hooks/useTranslation";

export function ConnectionDistance({ legs }: { legs: readonly RailJourney[] }): JSX.Element {
  const { t, i18n } = useTranslation(["rail"]);
  const distance = connectionDistance(legs);
  const source = distance.source
    ? railDistanceNoteKey(distance.source, {
        includeTicket: true,
        geometrySource: distance.geometrySource,
      })
    : null;
  return (
    <span className="flex flex-col">
      <span>
        {distance.km === null
          ? t("rail:connection.distanceUnknown")
          : `${Math.round(distance.km).toLocaleString(i18n.language)} km`}
      </span>
      {distance.missing > 0 && (
        <span className="t-caption">
          {t("rail:connection.distancePartial", { count: distance.missing })}
        </span>
      )}
      {distance.mixed ? (
        <span className="t-caption">{t("rail:connection.distanceMixed")}</span>
      ) : (
        source && <span className="t-caption">{t(source)}</span>
      )}
    </span>
  );
}
