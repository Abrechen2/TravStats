import { useEffect, useState } from "react";
import type { JSX } from "react";
import Modal from "../Modal";
import { BusRouteEditor } from "./BusRouteEditor";
import { busApi } from "../../lib/api/bus";
import { logger } from "../../lib/logger";
import { useTranslation } from "../../hooks/useTranslation";
import { useBusRouteEditStore } from "../../store/busRouteEditStore";
import type { BusJourney } from "../../types/bus";

/**
 * The ride editor over the dashboard map (GitHub #409): the bus card's
 * "Strecke bearbeiten" opens the very editor of the ride's detail page.
 * `onSaved` has the dashboard reload its layers, so the new line shows at once.
 */
export function BusRouteEditHost({ onSaved }: { onSaved: () => void }): JSX.Element | null {
  const { t } = useTranslation(["bus", "common"]);
  const rideId = useBusRouteEditStore((s) => s.rideId);
  const close = useBusRouteEditStore((s) => s.close);
  const [ride, setRide] = useState<BusJourney | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setRide(null);
    setFailed(false);
    if (!rideId) return;
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const loaded = await busApi.get(rideId);
        if (!cancelled) setRide(loaded);
      } catch (err) {
        logger.error("BusRouteEditHost: could not load the ride", err);
        if (!cancelled) setFailed(true);
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [rideId]);

  if (!rideId) return null;
  return (
    <Modal
      open
      onClose={close}
      title={t("bus:drawRoute.editManual")}
      maxWidth={880}
      testId="bus-route-edit-host"
    >
      {failed && (
        <p role="alert" className="text-sm text-(--danger)" data-testid="bus-route-edit-failed">
          {t("bus:routeEditor.loadFailed")}
        </p>
      )}
      {!ride && !failed && <p className="t-caption">{t("common:loading.default")}</p>}
      {ride && (
        <BusRouteEditor
          ride={ride}
          onSaved={(): void => {
            close();
            onSaved();
          }}
          onClose={close}
        />
      )}
    </Modal>
  );
}
