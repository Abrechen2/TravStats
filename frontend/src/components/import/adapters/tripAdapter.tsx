import { useCallback, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useToastStore } from "../../../store/toastStore";
import { logger } from "../../../lib/logger";
import { tripsApi } from "../../../lib/api";
import type { ProposedTrip } from "../../../lib/api/trips";
import DetectReviewModal from "../../Trips/DetectReviewModal";
import TripModal from "../../Trips/TripModal";
import type { DomainImportAdapter } from "../types";

/**
 * Reading a tour operator's travel documents is not built yet — the mails are
 * cover letters and the itinerary sits in the PDF attachment, which needs its
 * own parser. The route exists in the design and in this file; this flag is
 * what turns it on, so switching it over is one line rather than a rebuild.
 */
export const TRIP_DOCUMENT_IMPORT_READY = false;

/**
 * Plugs Trips into `<DomainImportPanel>`.
 *
 * A trip is not an entry beside a flight and a hotel — it is the bracket
 * around them. That shows in the routes: the first real one BUILDS a trip out
 * of what the app already holds, using the same detection that used to appear
 * only as a banner nobody asked for. Typing a name into an empty form is the
 * last resort, not the default it is today.
 */
export function useTripImportAdapter(onTripsChanged: () => void): DomainImportAdapter {
  const { t } = useTranslation(["import", "trips", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const [proposals, setProposals] = useState<ProposedTrip[] | null>(null);
  const [detecting, setDetecting] = useState(false);

  const handleDetect = useCallback((): void => {
    setDetecting(true);
    void (async () => {
      try {
        const result = await tripsApi.detect({ dryRun: true });
        if (result.proposed.length === 0) {
          addToast("info", t("import:trip.fromExisting.empty"));
          return;
        }
        setProposals(result.proposed);
      } catch (err) {
        logger.error("tripAdapter: detect failed", err);
        addToast("error", t("import:trip.fromExisting.failed"));
      } finally {
        setDetecting(false);
      }
    })();
  }, [addToast, t]);

  return {
    domain: "trip",
    panelTitle: t("import:trip.panelTitle"),
    panelHint: t("import:trip.panelHint"),
    acceptedEmailExtensions: [".eml", ".msg", ".txt"],
    supportsDocumentImport: TRIP_DOCUMENT_IMPORT_READY,
    documentRoute: {
      title: t("import:trip.document.title"),
      description: t("import:trip.document.description"),
    },
    routes: [
      {
        id: "from-existing",
        icon: "🧩",
        title: t("import:trip.fromExisting.title"),
        description: t("import:trip.fromExisting.description"),
        primary: true,
        actionLabel: detecting ? t("common:loading.default") : t("import:trip.fromExisting.action"),
        onSelect: detecting ? undefined : handleDetect,
        render: () =>
          proposals ? (
            <DetectReviewModal
              proposals={proposals}
              onClose={() => setProposals(null)}
              onCommitted={() => {
                setProposals(null);
                onTripsChanged();
              }}
            />
          ) : null,
      },
    ],
    manualLabel: t("import:trip.manual"),
    renderManual: ({ onClose, onSaved }) => (
      <TripModal trip={null} onClose={onClose} onSaved={onSaved} />
    ),
    // No parser yet, so nothing can arrive here — see TRIP_DOCUMENT_IMPORT_READY.
    renderReviewModal: (): JSX.Element | null => null,
  };
}
