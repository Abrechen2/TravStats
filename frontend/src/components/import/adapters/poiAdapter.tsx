import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import type { DomainImportAdapter } from "../types";

/**
 * Places (POI) — built ahead of its domain, deliberately switched off.
 *
 * `DOMAINS.poi.available` is `false`, so nothing mounts this today. It exists
 * because the chooser's whole claim is that a new area inherits the dialog
 * instead of getting one built for it — and that claim is worth nothing until
 * an area actually does. This file is the proof: two routes, no new shell.
 *
 * The routes are `hidden` until the area opens, so switching Places on is two
 * flags rather than an archaeology exercise: `available` here and in the
 * backend mirror, and `POI_IMPORT_READY` below once the search and the map
 * picker exist.
 */
export const POI_IMPORT_READY = false;

export function usePoiImportAdapter(): DomainImportAdapter {
  const { t } = useTranslation(["import", "common"]);

  return {
    domain: "poi",
    panelTitle: t("import:poi.panelTitle"),
    panelHint: t("import:poi.panelHint"),
    acceptedEmailExtensions: [".eml", ".msg", ".txt"],
    // A place is not booked, so no confirmation mail describes one. The drop
    // zone would promise a reading that has no source.
    supportsDocumentImport: false,
    routes: [
      {
        id: "search",
        icon: "🔎",
        title: t("import:poi.search.title"),
        description: t("import:poi.search.description"),
        primary: true,
        actionLabel: t("import:poi.search.action"),
        hidden: !POI_IMPORT_READY,
      },
      {
        id: "on-map",
        icon: "📍",
        title: t("import:poi.onMap.title"),
        description: t("import:poi.onMap.description"),
        actionLabel: t("import:poi.onMap.action"),
        hidden: !POI_IMPORT_READY,
      },
    ],
    // No create form for places yet — rendering a half-built one would be a
    // dead end for the user, and a null here is visible in the tests.
    renderManual: (): JSX.Element | null => null,
    renderReviewModal: (): JSX.Element | null => null,
  };
}
