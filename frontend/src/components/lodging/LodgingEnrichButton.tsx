import { useState } from "react";
import type { JSX } from "react";

import Button from "../ui/Button";
import LodgingEnrichPreviewDialog from "./LodgingEnrichPreviewDialog";
import { useTranslation } from "../../hooks/useTranslation";
import {
  isOpenDataDisabled,
  openDataApi,
  openDataUpstreamFailure,
  type LodgingEnrichmentPreview,
  type LodgingEnrichmentReason,
} from "../../lib/api/openData";
import { logger } from "../../lib/logger";
import { useSettingsStore } from "../../store/settingsStore";
import { useToastStore } from "../../store/toastStore";

/**
 * "Complete from OpenStreetMap" (2026-09-24; out of beta 2026-10-26, after an
 * audit of 200 real lodgings). Behind the instance's open data switch.
 *
 * Since 2026-10-22 in two steps: the click asks what WOULD be filled and
 * shows the matched house (name, OSM object, distance, link) before anything
 * is written; "Apply" then writes exactly that house's values, or nothing if
 * OpenStreetMap meanwhile names another. Every way of finding nothing says
 * which way it was — a silent "done" leaves the reader guessing.
 */
type Upstream = "timeout" | "rateLimited" | "unavailable";
const UPSTREAM_REASONS = new Set(["timeout", "rateLimited", "unavailable"]);

function isUpstreamReason(reason: LodgingEnrichmentReason): reason is Upstream {
  return reason !== null && UPSTREAM_REASONS.has(reason);
}

export default function LodgingEnrichButton({
  lodgingId,
  onDone,
}: {
  lodgingId: string;
  onDone: () => void;
}): JSX.Element | null {
  const { t } = useTranslation(["openData"]);
  const openData = useSettingsStore((s) => s.openDataEnabled) === true;
  const addToast = useToastStore((s) => s.addToast);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<LodgingEnrichmentPreview | null>(null);

  if (!openData) return null;

  /** A found-nothing answer, as the reader's own message. */
  const sayNothing = (reason: LodgingEnrichmentReason): void => {
    if (isUpstreamReason(reason)) {
      // Overpass could not be asked. Saying "OpenStreetMap does not know
      // this house" here — as it used to — was a claim nobody had checked.
      addToast("error", t(`openData:lodging.upstream.${reason}`));
    } else if (reason === "matchChanged") {
      addToast("error", t("openData:lodging.matchChanged"));
    } else {
      addToast(
        "info",
        t(
          reason === "noCoordinates"
            ? "openData:lodging.noCoordinates"
            : "openData:lodging.notFound"
        )
      );
    }
  };

  const sayFailure = (err: unknown, what: string): void => {
    logger.warn(what, err);
    if (isOpenDataDisabled(err)) {
      addToast("error", t("openData:lodging.disabled"));
      return;
    }
    const upstream = openDataUpstreamFailure(err);
    addToast(
      "error",
      t(
        upstream === null
          ? "openData:lodging.failed"
          : `openData:lodging.upstream.${upstream === "clientTimeout" ? "timeout" : upstream}`
      )
    );
  };

  const ask = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await openDataApi.previewLodgingEnrichment(lodgingId);
      if (result.found && result.match) setPreview(result);
      else sayNothing(result.reason);
    } catch (err) {
      sayFailure(err, "Previewing the OpenStreetMap enrichment failed");
    } finally {
      setBusy(false);
    }
  };

  const apply = async (): Promise<void> => {
    const match = preview?.match;
    if (!match) return;
    setBusy(true);
    try {
      const result = await openDataApi.enrichLodging(lodgingId, match.osmRef);
      setPreview(null);
      if (!result.found) {
        sayNothing(result.reason);
        return;
      }
      // The toast names the house the values came from, so the match can be
      // checked even where the lodging already had another reference.
      const name = result.match?.name ?? result.osmName ?? "";
      const ref = `OSM ${match.osmType} ${match.osmId}`;
      if (result.filled.length > 0) {
        const fields = result.filled.map((f) => t(`openData:lodging.field.${f}`)).join(", ");
        addToast("success", t("openData:lodging.applied", { name, ref, fields }), 8000);
      } else if (result.referenceStored) {
        addToast("info", t("openData:lodging.referenceOnly", { name, ref }), 8000);
      } else {
        addToast("info", t("openData:lodging.unchanged", { name, ref }), 8000);
      }
      onDone();
    } catch (err) {
      setPreview(null);
      sayFailure(err, "Enriching the lodging from OpenStreetMap failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button onClick={() => void ask()} disabled={busy}>
        {busy && !preview ? t("openData:lodging.enriching") : t("openData:lodging.enrich")}
      </Button>
      {preview && (
        <LodgingEnrichPreviewDialog
          preview={preview}
          busy={busy}
          onApply={() => void apply()}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}
