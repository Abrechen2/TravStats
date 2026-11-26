import { useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { downloadBlob } from "../../lib/export";
import { toursApi } from "../../lib/api/tours";
import { logger } from "../../lib/logger";
import { buildRoadtripGpx, gpxFileName } from "../../lib/roadtrip/gpxExport";
import type { RoadtripStation } from "../../types/roadtrip";
import type { OverflowEntry } from "../ui/OverflowMenu";
import InlineError from "../ui/InlineError";

/**
 * "GPX exportieren" as an entry of the roadtrip's ⋯ (owner, 2026-11-22): the stations and the
 * legs' lines as a GPX file. The lines are fetched fresh — the page's copy is decoration that
 * may have failed to load, and a file without its route must not pass for the whole export.
 * When the lines cannot be read, nothing is saved and `failure` (rendered beside the header,
 * outside the closed menu) says so.
 */
export function useRoadtripGpx({
  routeId,
  name,
  stations,
}: {
  routeId: string;
  name: string;
  stations: readonly RoadtripStation[];
}): { entry: OverflowEntry; failure: JSX.Element | null } {
  const { t } = useTranslation(["roadtrips"]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const run = async (): Promise<void> => {
    setBusy(true);
    setFailed(false);
    try {
      const geometry = await toursApi.geometry(undefined, routeId);
      const gpx = buildRoadtripGpx(name, stations, geometry);
      downloadBlob(new Blob([gpx], { type: "application/gpx+xml" }), gpxFileName(name));
    } catch (err) {
      logger.warn("Exporting a roadtrip as GPX failed", err);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return {
    entry: {
      key: "gpx",
      label: busy ? t("roadtrips:gpx.exporting") : t("roadtrips:gpx.export"),
      disabled: busy,
      onSelect: () => void run(),
    },
    failure: failed ? <InlineError>{t("roadtrips:gpx.failed")}</InlineError> : null,
  };
}
