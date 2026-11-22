import { useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import GeoExportDialog from "../export/GeoExportDialog";
import OverflowMenu from "../ui/OverflowMenu";
import type { OverflowEntry } from "../ui/OverflowMenu";

/**
 * The ⋯ of a route card on a rail, bus or ferry journey (owner, 2026-11-22): re-route, the
 * GPX/KML export as one "Exportieren" and — last, red — dropping a hand-drawn line. The card
 * keeps only its one visible action ("Route bearbeiten" where the domain has an editor).
 * Without a stored line there is nothing to export, so that entry is left out.
 */
export default function RouteMenu({
  entries = [],
  geoExport,
  label,
  testId,
}: {
  /** The page's own entries, in order; a `danger` one is sorted last by the menu. */
  entries?: OverflowEntry[];
  geoExport?: { path: string; testId: string };
  label: string;
  testId: string;
}): JSX.Element | null {
  const { t } = useTranslation("common");
  const [exporting, setExporting] = useState(false);
  const all: OverflowEntry[] = [
    ...entries,
    ...(geoExport
      ? [{ key: "export", label: t("buttons.export"), onSelect: () => setExporting(true) }]
      : []),
  ];
  return (
    <OverflowMenu entries={all} label={label} triggerLabel={t("buttons.more")} testId={testId}>
      {geoExport && (
        <GeoExportDialog
          open={exporting}
          onClose={() => setExporting(false)}
          path={geoExport.path}
          testId={geoExport.testId}
        />
      )}
    </OverflowMenu>
  );
}
