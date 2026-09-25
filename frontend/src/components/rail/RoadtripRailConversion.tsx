import { useState } from "react";
import type { JSX } from "react";
import { useNavigate } from "react-router-dom";

import Button from "../ui/Button";
import { Card } from "../ui/Card";
import Dialog from "../ui/Dialog";
import { useTranslation } from "../../hooks/useTranslation";
import { useRailVisible } from "../../hooks/useRailVisible";
import { railApi, type RoadtripConversionPreview } from "../../lib/api/rail";
import { logger } from "../../lib/logger";
import { useToastStore } from "../../store/toastStore";
import type { StoredRoadtripVehicle } from "../../shared/tour/roadtrip";

interface Props {
  routeId: string;
  vehicle: StoredRoadtripVehicle | null;
  /** The rides were written and the roadtrip stays — reload what is shown. */
  onConverted: () => void;
}

/**
 * "Als Bahnfahrt übernehmen" (owner decision 1 of the rail spec). A roadtrip
 * stored with `rail` as its vehicle — from before rail became a domain — is
 * offered for conversion into rail journeys, one per leg.
 *
 * Shown only where rail is visible at all (beta switch AND the user's domain,
 * `useRailVisible`), and only for a roadtrip by rail. The dialog shows what
 * will be written before anything is; the roadtrip is deleted only when the
 * user ticks that box, and the box is offered only when every leg converts.
 */
export function RoadtripRailConversion({
  routeId,
  vehicle,
  onConverted,
}: Props): JSX.Element | null {
  const { t } = useTranslation(["rail", "common"]);
  const railVisible = useRailVisible();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<RoadtripConversionPreview | null>(null);
  const [failed, setFailed] = useState(false);
  const [removeSection, setRemoveSection] = useState(false);
  const [saving, setSaving] = useState(false);

  if (vehicle !== "rail" || !railVisible) return null;

  const start = async (): Promise<void> => {
    setOpen(true);
    setPreview(null);
    setFailed(false);
    setRemoveSection(false);
    try {
      setPreview(await railApi.previewRoadtripConversion(routeId));
    } catch (err) {
      logger.error("Failed to preview the roadtrip conversion", err);
      setFailed(true);
    }
  };

  const confirm = async (): Promise<void> => {
    setSaving(true);
    try {
      const result = await railApi.convertRoadtrip(routeId, removeSection);
      addToast(
        "success",
        result.created > 0
          ? t("rail:roadtripConversion.done", { count: result.created })
          : t("rail:roadtripConversion.nothingNew")
      );
      setOpen(false);
      if (result.sectionRemoved) {
        addToast("success", t("rail:roadtripConversion.removed"));
        navigate("/rail");
      } else {
        onConverted();
      }
    } catch (err) {
      logger.error("Failed to convert the roadtrip into rail journeys", err);
      addToast("error", t("rail:roadtripConversion.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      className="flex flex-wrap items-center justify-between"
      style={{ gap: "var(--ts-space-md)", marginTop: "var(--ts-space-lg)" }}
      data-testid="roadtrip-rail-conversion"
    >
      <p className="t-body" style={{ margin: 0, maxWidth: 640 }}>
        {t("rail:roadtripConversion.offer")}
      </p>
      <Button variant="secondary" onClick={() => void start()}>
        {t("rail:roadtripConversion.action")}
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("rail:roadtripConversion.title")}
        dismissLabel={t("common:buttons.cancel")}
        action={
          <Button
            variant="primary"
            disabled={saving || !preview || preview.rides.length === 0}
            onClick={() => void confirm()}
          >
            {t("rail:roadtripConversion.confirm")}
          </Button>
        }
      >
        {failed && <p className="t-body">{t("rail:roadtripConversion.loadError")}</p>}
        {!failed && !preview && <p className="t-body">{t("rail:roadtripConversion.loading")}</p>}
        {preview && <PreviewBody preview={preview} />}
        {preview && (
          <label className="flex items-start" style={{ gap: 8, marginTop: "var(--ts-space-md)" }}>
            <input
              type="checkbox"
              checked={removeSection}
              disabled={!preview.canRemoveSection}
              onChange={(e) => setRemoveSection(e.target.checked)}
            />
            <span>
              {t("rail:roadtripConversion.removeSection")}
              {!preview.canRemoveSection && (
                <span className="t-caption" style={{ display: "block" }}>
                  {t("rail:roadtripConversion.removeSectionHint")}
                </span>
              )}
            </span>
          </label>
        )}
      </Dialog>
    </Card>
  );
}

function PreviewBody({ preview }: { preview: RoadtripConversionPreview }): JSX.Element {
  const { t } = useTranslation(["rail"]);
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
      <p className="t-body" style={{ margin: 0, fontWeight: 600 }}>
        {t("rail:roadtripConversion.rides", { count: preview.rides.length })}
      </p>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {preview.rides.map((ride) => (
          <li key={ride.legId}>
            {ride.departureDay} · {ride.departureStationName} → {ride.arrivalStationName} ·{" "}
            {Math.round(ride.distanceKm)} km
            {ride.journeyId && ` · ${t("rail:roadtripConversion.already")}`}
          </li>
        ))}
      </ul>
      <p className="t-caption" style={{ margin: 0 }}>
        {t("rail:roadtripConversion.placeholder")}
      </p>
      {preview.skipped.length > 0 && (
        <p className="t-caption" style={{ margin: 0 }}>
          {t("rail:roadtripConversion.skippedTitle")}{" "}
          {preview.skipped.map((s) => t(`rail:roadtripConversion.reason.${s.reason}`)).join(", ")}
        </p>
      )}
    </div>
  );
}
