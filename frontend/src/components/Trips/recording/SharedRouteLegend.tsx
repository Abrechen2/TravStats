import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import type { SharedTripRoute } from "../../../lib/api/travtrack";
import { SHARED_ROUTE_RGB } from "./sharedRouteLayers";

/**
 * The label of the shared routes on the trip map (TravTrack plan T7): whose
 * route each line is, and that it is only to be looked at. A failed read is
 * said, never drawn as "nobody shares one".
 */
export default function SharedRouteLegend({
  routes,
  failed,
}: {
  routes: readonly SharedTripRoute[];
  failed: boolean;
}): JSX.Element | null {
  const { t } = useTranslation(["trips"]);
  if (failed) {
    return (
      <p role="status" className="mb-2 text-sm text-(--text-muted)">
        {t("trips:sharedRoute.loadError")}
      </p>
    );
  }
  if (routes.length === 0) return null;
  const swatch = `rgb(${SHARED_ROUTE_RGB.join(" ")})`;
  return (
    <ul aria-label={t("trips:sharedRoute.title")} className="mb-2 flex flex-wrap gap-3 text-sm">
      {routes.map((route, index) => (
        <li key={`${route.sharedBy}-${index}`} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block h-1 w-5 rounded-full"
            style={{ background: swatch }}
          />
          {t("trips:sharedRoute.legend", { name: route.sharedBy })}
        </li>
      ))}
    </ul>
  );
}
