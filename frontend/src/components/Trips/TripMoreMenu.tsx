import { useState } from "react";
import type { JSX } from "react";

import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { useTranslation } from "../../hooks/useTranslation";
import { useTravTrackVisible } from "../../hooks/useTravTrackVisible";
import type { Trip } from "../../types";
import TripShareDialog from "../sharing/TripShareDialog";
import { useTripSharingStore } from "../../store/tripSharingStore";
import { useTripShareDialogs } from "../sharing/useTripShareDialogs";
import OverflowMenu from "../ui/OverflowMenu";
import { useChangeHistoryMenu } from "../changeHistory/useChangeHistoryMenu";
import type { OverflowEntry } from "../ui/OverflowMenu";
import { useCoverCropStore } from "../../store/coverCropStore";
import CoverSuggestDialog from "./CoverSuggestDialog";
import { TripExportModal } from "./TripExportModal";
import { useTripSummaryAction } from "./useTripSummaryAction";

/**
 * "Mehr" (⋯) in the trip head, beside "Bearbeiten" (owner, 2026-11-20): the
 * actions that are used rarely or once per trip — sharing, export, offering
 * the trip to another server, the AI summary — and, last and red, delete
 * (which still asks first, in the page's confirm).
 *
 * An entry whose feature is off is absent, not greyed: the beta key, the
 * federation switch, TravTrack, the text model and the shared demo account
 * each decide for their own entries, exactly where the old buttons and cards
 * decided. The panel, keyboard and touch sizing are `ui/OverflowMenu`.
 */
export default function TripMoreMenu({
  trip,
  language,
  onDelete,
  onChanged,
}: {
  trip: Trip;
  /** The reader's UI language; the AI summary is written in it. */
  language: string;
  onDelete: () => void;
  /** The trip changed from the menu (a traveller added, a summary written): reload it. */
  onChanged: () => void;
}): JSX.Element {
  const { t } = useTranslation(["trips", "sharing", "common", "immich"]);
  const isSharedDemo = useIsDemoAccount();
  const travTrack = useTravTrackVisible();
  const summary = useTripSummaryAction(trip, language, t, onChanged);
  const bump = useTripSharingStore((s) => s.bump);
  const shareDialogs = useTripShareDialogs(trip.id, onChanged);
  const changeHistory = useChangeHistoryMenu({
    entityType: "trip",
    entityId: trip.id,
    onRestored: onChanged,
  });
  const [exporting, setExporting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [suggestingCover, setSuggestingCover] = useState(false);

  // One "Teilen …" entry: companions, people on other servers, the code and the
  // public link are sections of its dialog. The route share stays here, for a
  // trip that is running or still ahead and only where TravTrack is offered.
  const entries: OverflowEntry[] = [
    ...(isSharedDemo
      ? []
      : [
          { key: "share", label: t("sharing:menu.share"), onSelect: () => setSharing(true) },
          ...(travTrack && trip.status !== "completed"
            ? [
                {
                  key: "share-route",
                  label: t("sharing:menu.route"),
                  onSelect: () => shareDialogs.pick("route"),
                },
              ]
            : []),
        ]),
    ...(isSharedDemo
      ? []
      : [
          {
            key: "cover",
            label: t("immich:cover.menu"),
            onSelect: () => setSuggestingCover(true),
          },
        ]),
    ...(!isSharedDemo && trip.coverImageUrl
      ? [
          {
            key: "cover-crop",
            label: t("immich:cover.crop.menuAdjust"),
            onSelect: () =>
              useCoverCropStore.getState().open({
                tripId: trip.id,
                coverImageUrl: trip.coverImageUrl!,
                initialCrop: trip.coverCrop ?? null,
                onDone: onChanged,
              }),
          },
        ]
      : []),
    { key: "export", label: t("trips:export.button"), onSelect: () => setExporting(true) },
    ...(summary.available
      ? [
          {
            key: "summary",
            label: summary.generating
              ? t("trips:menu.summaryBusy")
              : trip.summary
                ? t("trips:menu.summaryAgain")
                : t("trips:menu.summaryNone"),
            disabled: summary.generating,
            onSelect: () => void summary.generate(),
          },
        ]
      : []),
    changeHistory.entry,
    { key: "delete", label: t("common:buttons.delete"), danger: true, onSelect: onDelete },
  ];

  return (
    <OverflowMenu
      entries={entries}
      label={t("trips:menu.label")}
      triggerLabel={t("trips:menu.more")}
      testId="trip-more-menu"
    >
      {shareDialogs.node}
      {changeHistory.node}
      {suggestingCover && (
        <CoverSuggestDialog
          tripId={trip.id}
          onClose={() => setSuggestingCover(false)}
          onChosen={onChanged}
        />
      )}
      {exporting && <TripExportModal tripId={trip.id} onClose={() => setExporting(false)} />}
      {sharing && (
        <TripShareDialog
          tripId={trip.id}
          companionNames={trip.companions}
          onClose={() => {
            setSharing(false);
            // Offers, requests and codes made in the dialog change the head's travellers.
            bump(trip.id);
            onChanged();
          }}
          onChanged={onChanged}
          onPick={shareDialogs.pick}
        />
      )}
    </OverflowMenu>
  );
}
