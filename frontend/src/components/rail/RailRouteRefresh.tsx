import { useState } from "react";
import { isAxiosError } from "axios";
import RouteMenu from "../detail/RouteMenu";
import { railApi } from "../../lib/api/rail";
import { useTranslation } from "../../hooks/useTranslation";
import { geometryNotice } from "./railFormModel";

export function RailRouteRefresh({
  id,
  source,
  onUpdated,
  geoExport,
}: {
  id: string;
  source: string;
  onUpdated: () => void;
  /** The line's GPX/KML export, which shares the route card's ⋯. */
  geoExport?: { path: string; testId: string };
}): JSX.Element | null {
  const { t } = useTranslation(["rail"]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const refresh = async () => {
    setBusy(true);
    try {
      const result = await railApi.route(id);
      const notice = geometryNotice(result.geometry);
      setMessage(
        notice ? t(notice.key, { reason: t(notice.reasonKey) }) : t("rail:routeRefresh.done")
      );
      if (result.geometry?.outcome === "routed" || result.geometry?.outcome === "traced")
        onUpdated();
    } catch (error) {
      const status = isAxiosError(error) ? error.response?.status : undefined;
      const key =
        status === 429
          ? "rateLimited"
          : status === 409
            ? "conflict"
            : status === 401 || status === 403
              ? "denied"
              : status === 404
                ? "missing"
                : isAxiosError(error) && !error.response
                  ? "network"
                  : "failed";
      setMessage(t(`rail:routeRefresh.${key}`));
    } finally {
      setBusy(false);
    }
  };
  // A hand-drawn route is never replaced automatically, so it offers no refresh — only the export.
  return (
    <div className="mt-2">
      <RouteMenu
        label={t("rail:routeRefresh.menuLabel")}
        testId="rail-route-menu"
        entries={
          source === "manual"
            ? []
            : [
                {
                  key: "refresh",
                  label: t(busy ? "rail:routeRefresh.busy" : "rail:routeRefresh.action"),
                  disabled: busy,
                  onSelect: () => void refresh(),
                },
              ]
        }
        geoExport={geoExport}
      />
      {message && (
        <p role="status" className="mt-2 text-sm">
          {message}
        </p>
      )}
    </div>
  );
}
