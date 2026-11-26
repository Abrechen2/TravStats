import { useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import GeoExportDialog from "../export/GeoExportDialog";
import Dialog from "../ui/Dialog";
import OverflowMenu from "../ui/OverflowMenu";
import type { OverflowEntry } from "../ui/OverflowMenu";
import { ColumnChecklist } from "./ColumnPicker";
import type { PickableColumn } from "./ColumnPicker";
import type { ColumnPrefs } from "./useColumnPrefs";

/** Where every domain's list importers live (Settings → Import hub). */
export const IMPORT_HUB_HREF = "/settings/daten#import";

/**
 * The "Mehr" of a logbook list header (owner, 2026-11-22). Only "+ Hinzufügen" stays visible
 * beside it: bulk selection, the column choice, the importers and the GPX/KML export are the
 * rare ones. Each entry exists only where the page offers the feature.
 */
export default function ListHeaderMenu({
  selection,
  columns,
  prefs,
  importHref = IMPORT_HUB_HREF,
  geoExport,
  extra = [],
}: {
  /** Any selection mode: only whether it is on and how to start it matter here. */
  selection?: { selecting: boolean; start: () => void };
  columns?: readonly PickableColumn[];
  prefs?: ColumnPrefs;
  /** `null` leaves the importers entry out (a list without an import hub entry). */
  importHref?: string | null;
  geoExport?: { path: string; params?: Record<string, string>; testId?: string };
  extra?: OverflowEntry[];
}): JSX.Element {
  const { t } = useTranslation(["common", "bulkEdit"]);
  const [picking, setPicking] = useState(false);
  const [exporting, setExporting] = useState(false);

  const entries: OverflowEntry[] = [
    ...(selection && !selection.selecting
      ? [{ key: "bulk", label: t("bulkEdit:start"), onSelect: selection.start }]
      : []),
    ...(columns && prefs
      ? [{ key: "columns", label: t("common:table.columns"), onSelect: () => setPicking(true) }]
      : []),
    ...(importHref ? [{ key: "import", label: t("common:buttons.import"), href: importHref }] : []),
    ...(geoExport
      ? [{ key: "export", label: t("common:buttons.export"), onSelect: () => setExporting(true) }]
      : []),
    ...extra,
  ];

  return (
    <OverflowMenu
      entries={entries}
      label={t("common:buttons.moreActions")}
      triggerLabel={t("common:buttons.more")}
      testId="list-header-menu"
    >
      {columns && prefs && (
        <Dialog
          open={picking}
          onClose={() => setPicking(false)}
          title={t("common:table.columns")}
          maxWidth={360}
        >
          <div data-testid="column-picker">
            <ColumnChecklist columns={columns} prefs={prefs} />
          </div>
        </Dialog>
      )}
      {geoExport && (
        <GeoExportDialog
          open={exporting}
          onClose={() => setExporting(false)}
          path={geoExport.path}
          params={geoExport.params}
          testId={geoExport.testId}
        />
      )}
    </OverflowMenu>
  );
}
