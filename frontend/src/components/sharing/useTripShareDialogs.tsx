import { useEffect, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { sharingApi } from "../../lib/api/sharing";
import { logger } from "../../lib/logger";
import { useToastStore } from "../../store/toastStore";
import { useTripSharingStore } from "../../store/tripSharingStore";
import type { SharePerson, TripPerson } from "../../types/sharing";
import ShareLinkDialog from "../shareLinks/ShareLinkDialog";
import ShareTripDialog from "./ShareTripDialog";
import ShareRouteDialog from "./ShareRouteDialog";
import { reportPageError } from "../../store/pageErrorStore";

export const SHARE_ITEMS = ["companions", "link", "route"] as const;
export type ShareItem = (typeof SHARE_ITEMS)[number];

/**
 * The three sharing dialogs of a trip and what they need, apart from whatever
 * opens them: the head's "Teilen" menu and the "Mehr" menu both pick an item
 * and render `node`.
 *
 * The people are loaded when the companions item is picked, so the dialog
 * always opens on the current state. A failed load is said out loud and
 * nothing opens — an empty picker would read as "nobody to share with".
 */
export function useTripShareDialogs(
  tripId: string,
  onChanged?: () => void
): { pick: (which: ShareItem) => void; loading: boolean; node: JSX.Element } {
  const { t } = useTranslation(["sharing"]);
  const addToast = useToastStore((s) => s.addToast);
  const bump = useTripSharingStore((s) => s.bump);
  const [dialog, setDialog] = useState<ShareItem | null>(null);
  // Tagged with its trip, so a trip change never offers the previous trip's people.
  const [loaded, setLoaded] = useState<{
    tripId: string;
    people: TripPerson[];
    linkableUsers: SharePerson[];
  } | null>(null);

  useEffect(() => {
    if (dialog !== "companions") return;
    let cancelled = false;
    void (async () => {
      try {
        const view = await sharingApi.tripSharing(tripId);
        if (!cancelled) {
          setLoaded({ tripId, people: view.people, linkableUsers: view.linkableUsers });
        }
      } catch (error) {
        if (cancelled) return;
        logger.error("Failed to load trip sharing:", error);
        reportPageError(t("sharing:trip.errors.loadFailed"));
        setDialog(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dialog, tripId, addToast, t]);

  const current = loaded?.tripId === tripId ? loaded : null;
  const people = current?.people ?? null;

  const node = (
    <>
      {dialog === "route" && (
        <ShareRouteDialog open onClose={() => setDialog(null)} tripId={tripId} />
      )}
      {dialog === "link" && (
        <ShareLinkDialog open onClose={() => setDialog(null)} kind="trip" targetId={tripId} />
      )}
      {dialog === "companions" && people && (
        <ShareTripDialog
          open
          onClose={() => setDialog(null)}
          tripId={tripId}
          people={people}
          linkableUsers={current?.linkableUsers ?? []}
          onShared={() => bump(tripId)}
          onPeopleChanged={() => {
            bump(tripId);
            onChanged?.();
          }}
        />
      )}
    </>
  );
  return {
    pick: (which) => {
      setLoaded(null);
      setDialog(which);
    },
    loading: dialog === "companions" && !people,
    node,
  };
}
