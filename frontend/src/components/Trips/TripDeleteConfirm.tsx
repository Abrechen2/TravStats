import type { JSX } from "react";

import ConfirmModal from "../Training/ConfirmModal";
import { useDocumentCount } from "../../hooks/useDocumentCount";
import { useTranslation } from "../../hooks/useTranslation";
import { DELETE_BUTTON_CLASS, withDocumentNote } from "../../lib/deleteConfirm";

interface Props {
  isOpen: boolean;
  tripId: string;
  tripName: string;
  onClose: () => void;
  onConfirm: () => void;
}

/**
 * The question asked before a trip goes.
 *
 * A component of its own, not four more lines on `TripDetailPage`: that page is
 * frozen at 1399 lines in `scripts/file-size-baseline.json`, a listed file may
 * never grow, and the count has to be held in state somewhere.
 *
 * The sentence names its losses in prose because most of them have no number
 * worth printing — photographs, stops, companions, journal entries, tours with
 * their tracks. The documents are the exception, and the one finding 3 of the
 * write-path audit (2026-09-19) was about: `Document.tripId` carries
 * `onDelete: Cascade`, measured against the live database by
 * `backend/src/__tests__/integrity/cascades.integrity.test.ts`, and a trip is
 * the entry most likely to hold several at once — a whole holiday's tickets and
 * bills filed in one place.
 *
 * The count is asked for only while the dialog is open. This component stays
 * mounted for the life of the page, so asking on mount would put a request on
 * every trip anybody reads.
 */
export default function TripDeleteConfirm({
  isOpen,
  tripId,
  tripName,
  onClose,
  onConfirm,
}: Props): JSX.Element {
  const { t } = useTranslation(["trips", "common", "documents"]);
  const documentCount = useDocumentCount(isOpen ? { type: "trip", id: tripId } : null);

  return (
    <ConfirmModal
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={onConfirm}
      title={t("trips:deleteTripConfirmTitle")}
      message={withDocumentNote(t("trips:deleteTripConfirm", { name: tripName }), t, documentCount)}
      confirmText={t("trips:deleteTrip")}
      cancelText={t("trips:modal.cancel")}
      confirmButtonClass={DELETE_BUTTON_CLASS}
    />
  );
}
