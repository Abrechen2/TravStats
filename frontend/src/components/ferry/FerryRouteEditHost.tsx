import { useEffect, useState } from "react";
import type { JSX } from "react";
import Dialog from "../ui/Dialog";
import { FerryRouteEditor } from "./FerryRouteEditor";
import { ferryApi } from "../../lib/api/ferry";
import { logger } from "../../lib/logger";
import { useTranslation } from "../../hooks/useTranslation";
import { useFerryRouteEditStore } from "../../store/ferryRouteEditStore";
import type { FerryJourney } from "../../types/ferry";
import InlineError from "../ui/InlineError";

/**
 * The crossing editor over the dashboard map (GitHub #407): the ferry card's
 * "Strecke bearbeiten" opens the very editor of the crossing's detail page.
 * A saved line reaches every crossing of the pair, so `onSaved` has the
 * dashboard reload its layers and each of them redraws at once.
 */
export function FerryRouteEditHost({ onSaved }: { onSaved: () => void }): JSX.Element | null {
  const { t } = useTranslation(["ferry", "common"]);
  const crossingId = useFerryRouteEditStore((s) => s.crossingId);
  const close = useFerryRouteEditStore((s) => s.close);
  const [ride, setRide] = useState<FerryJourney | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setRide(null);
    setFailed(false);
    if (!crossingId) return;
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const loaded = await ferryApi.get(crossingId);
        if (!cancelled) setRide(loaded);
      } catch (err) {
        logger.error("FerryRouteEditHost: could not load the crossing", err);
        if (!cancelled) setFailed(true);
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [crossingId]);

  if (!crossingId) return null;
  return (
    <Dialog
      open
      onClose={close}
      title={t("ferry:routing.editManual")}
      maxWidth={880}
      testId="ferry-route-edit-host"
    >
      {failed && (
        <InlineError testId="ferry-route-edit-failed">
          {t("ferry:routeEditor.loadFailed")}
        </InlineError>
      )}
      {!ride && !failed && <p className="t-caption">{t("common:loading.default")}</p>}
      {ride && (
        <FerryRouteEditor
          ride={ride}
          onSaved={(): void => {
            close();
            onSaved();
          }}
          onClose={close}
        />
      )}
    </Dialog>
  );
}
