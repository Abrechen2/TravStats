import { useState } from "react";
import type { JSX } from "react";

import Button from "../ui/Button";
import { useBetaFeatures } from "../../hooks/useBetaFeatures";
import { useTranslation } from "../../hooks/useTranslation";
import { openDataApi } from "../../lib/api/openData";
import { logger } from "../../lib/logger";
import { useSettingsStore } from "../../store/settingsStore";
import { useToastStore } from "../../store/toastStore";

/**
 * "Complete from OpenStreetMap" (beta `lodgingEnrichment`, 2026-09-24).
 * Behind both the beta switch and the instance's open data switch. Says what
 * it filled, or why it found nothing — a silent "done" would leave the reader
 * guessing whether anything happened.
 */
export default function LodgingEnrichButton({
  lodgingId,
  onDone,
}: {
  lodgingId: string;
  onDone: () => void;
}): JSX.Element | null {
  const { t } = useTranslation(["openData"]);
  const { isFeatureVisible } = useBetaFeatures();
  const openData = useSettingsStore((s) => s.openDataEnabled) === true;
  const addToast = useToastStore((s) => s.addToast);
  const [busy, setBusy] = useState(false);

  if (!openData || !isFeatureVisible("lodgingEnrichment")) return null;

  const run = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await openDataApi.enrichLodging(lodgingId);
      if (!result.found) {
        addToast(
          "info",
          t(
            result.reason === "noCoordinates"
              ? "openData:lodging.noCoordinates"
              : "openData:lodging.notFound"
          )
        );
      } else if (result.filled.length === 0) {
        addToast("info", t("openData:lodging.nothingNew", { name: result.osmName ?? "" }));
      } else {
        const fields = result.filled.map((f) => t(`openData:lodging.field.${f}`)).join(", ");
        addToast("success", t("openData:lodging.filled", { fields }));
        onDone();
      }
    } catch (err) {
      logger.warn("Enriching the lodging from OpenStreetMap failed", err);
      addToast("error", t("openData:lodging.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button onClick={() => void run()} disabled={busy}>
      {busy ? t("openData:lodging.enriching") : t("openData:lodging.enrich")}
    </Button>
  );
}
