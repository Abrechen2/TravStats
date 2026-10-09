import { useCallback, useState } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useToastStore } from "../../../store/toastStore";
import { logger } from "../../../lib/logger";
import { tripsApi } from "../../../lib/api";
import type { ProposedTrip } from "../../../lib/api/trips";
import DetectReviewModal from "../../Trips/DetectReviewModal";
import TripModal from "../../Trips/TripModal";
import type { DomainImportAdapter } from "../types";
import { usePackageReviewRenderer } from "./packageAdapter";

/**
 * Reading a tour operator's travel documents: the drop zone parses as
 * `package` (plan 2026-10-09 P3) with the operator templates from the
 * template repository, and the review is the package proposal. Upload the
 * PDF itself — a mail's PDF attachment is not routed to the reader yet.
 */
export const TRIP_DOCUMENT_IMPORT_READY = true;

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
  const renderPackageReview = usePackageReviewRenderer();

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
    parseAs: "package",
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
    renderReviewModal: renderPackageReview,
  };
}
