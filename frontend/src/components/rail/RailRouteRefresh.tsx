import { useState } from "react";
import { isAxiosError } from "axios";
import Button from "../ui/Button";
import { railApi } from "../../lib/api/rail";
import { useTranslation } from "../../hooks/useTranslation";
import { geometryNotice } from "./railFormModel";

export function RailRouteRefresh({
  id,
  source,
  onUpdated,
}: {
  id: string;
  source: string;
  onUpdated: () => void;
}): JSX.Element | null {
  const { t } = useTranslation(["rail"]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (source === "manual") return null;
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
  return (
    <div className="mb-4">
      <Button disabled={busy} onClick={() => void refresh()}>
        {t(busy ? "rail:routeRefresh.busy" : "rail:routeRefresh.action")}
      </Button>
      {message && (
        <p role="status" className="mt-2 text-sm">
          {message}
        </p>
      )}
    </div>
  );
}
