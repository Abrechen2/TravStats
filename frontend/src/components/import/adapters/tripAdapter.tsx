import { useCallback, useRef, useState } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useToastStore } from "../../../store/toastStore";
import { logger } from "../../../lib/logger";
import { tripsApi } from "../../../lib/api";
import type { ProposedTrip } from "../../../lib/api/trips";
import DetectReviewModal from "../../Trips/DetectReviewModal";
import TripModal from "../../Trips/TripModal";
import { TripFileImportModal } from "../../Trips/TripFileImportModal";
import type { TripFileCommitResult } from "../../../lib/api/tripExchange";
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
  const fileInput = useRef<HTMLInputElement>(null);
  const [tripFile, setTripFile] = useState<File | null>(null);

  const handleTripFileSaved = useCallback(
    (result: TripFileCommitResult): void => {
      setTripFile(null);
      addToast(
        "success",
        t("import:tripFile.saved", {
          created: result.created,
          attached: result.attached,
          skipped: result.skipped,
        })
      );
      if (result.documents.refused > 0) {
        addToast(
          "warning",
          t("import:tripFile.documentsRefused", { count: result.documents.refused })
        );
      }
      onTripsChanged();
    },
    [addToast, onTripsChanged, t]
  );

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
      {
        id: "from-file",
        icon: "📦",
        title: t("import:tripFile.routeTitle"),
        description: t("import:tripFile.routeDescription"),
        actionLabel: t("import:tripFile.action"),
        onSelect: () => fileInput.current?.click(),
        render: () => (
          <>
            <input
              ref={fileInput}
              type="file"
              accept=".travstats,application/zip"
              className="hidden"
              data-testid="trip-file-input"
              onChange={(e) => {
                const chosen = e.target.files?.[0] ?? null;
                // Cleared, so choosing the same file again fires a change.
                e.target.value = "";
                if (chosen) setTripFile(chosen);
              }}
            />
            {tripFile && (
              <TripFileImportModal
                file={tripFile}
                onCancel={() => setTripFile(null)}
                onSaved={handleTripFileSaved}
              />
            )}
          </>
        ),
      },
    ],
    manualLabel: t("import:trip.manual"),
    renderManual: ({ onClose, onSaved }) => (
      <TripModal trip={null} onClose={onClose} onSaved={onSaved} />
    ),
    renderReviewModal: renderPackageReview,
  };
}
