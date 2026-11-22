import type { JSX, ReactNode } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import type { ShareLinkKind } from "../../types/shareLinks";
import { useLodgingEnrich } from "../lodging/LodgingEnrichButton";
import { useShareLink } from "../shareLinks/ShareLinkButton";
import OverflowMenu from "../ui/OverflowMenu";
import type { OverflowEntry } from "../ui/OverflowMenu";

/**
 * The "Mehr" beside "Bearbeiten" in a detail header (owner, 2026-11-22): the page's rare actions
 * (merge, restay, connection, …), the share link and the OpenStreetMap enrichment where the
 * page offers them, and — last, red — delete. Delete only opens the page's own confirm dialog,
 * which is why the entry carries no `confirm` of its own.
 */
export default function DetailMoreMenu({
  entries = [],
  shareLink,
  enrich,
  onDelete,
  deleteLabel,
  children,
}: {
  /** Page-specific entries, in the order they should appear. */
  entries?: OverflowEntry[];
  shareLink?: { kind: ShareLinkKind; targetId: string };
  enrich?: { lodgingId: string; onDone: () => void };
  onDelete: () => void;
  /** The page's own wording of delete ("Ort löschen"); defaults to the common one. */
  deleteLabel?: string;
  /** Dialogs the entries open. */
  children?: ReactNode;
}): JSX.Element {
  const { t } = useTranslation(["common", "sharing"]);
  // Hooks must run unconditionally; a page without the feature passes an inert target.
  const share = useShareLink(shareLink?.kind ?? "flight", shareLink?.targetId ?? "");
  const osm = useLodgingEnrich(enrich?.lodgingId ?? "", enrich?.onDone ?? (() => undefined));

  const all: OverflowEntry[] = [
    ...entries,
    ...(shareLink && share.available
      ? [{ key: "share-link", label: t("sharing:links.button"), onSelect: share.start }]
      : []),
    ...(enrich && osm.available
      ? [
          {
            key: "enrich",
            label: osm.label,
            disabled: osm.busy,
            onSelect: () => void osm.ask(),
          },
        ]
      : []),
    {
      key: "delete",
      label: deleteLabel ?? t("common:buttons.delete"),
      danger: true,
      onSelect: onDelete,
    },
  ];

  return (
    <OverflowMenu
      entries={all}
      label={t("common:buttons.moreActions")}
      triggerLabel={t("common:buttons.more")}
      testId="detail-more-menu"
    >
      {shareLink && share.node}
      {enrich && osm.node}
      {children}
    </OverflowMenu>
  );
}
