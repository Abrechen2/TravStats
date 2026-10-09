import type { JSX } from "react";

import ConfirmModal from "../Training/ConfirmModal";
import { useDocumentCount } from "../../hooks/useDocumentCount";
import { useTranslation } from "../../hooks/useTranslation";
import { formatStayPeriod, hasUnknownLength, stayNights } from "../../lib/lodgingDateDisplay";
import { DELETE_BUTTON_CLASS, withDocumentNote } from "../../lib/deleteConfirm";
import type { LodgingStay } from "../../types/lodging";

interface StayDeleteConfirmProps {
  /** The stay whose deletion is being asked about; null while no question is open. */
  stay: LodgingStay | null;
  onClose: () => void;
  onConfirm: () => void;
  deleting: boolean;
}

/**
 * The one question in front of deleting a stay - asked from the house's page
 * and from the chronological stay list, so the two say the same thing.
 *
 * What it says: the period (as the rest of the app writes it - a month- or
 * year-precision stay has no "from - to" to print, and inventing one is what
 * `formatStayPeriod` exists to prevent), the nights, that the house and a
 * linked trip stay, and - only when there are any - the receipt and the kept
 * originals that go with the stay (forgejo#250).
 */
export function StayDeleteConfirm({
  stay,
  onClose,
  onConfirm,
  deleting,
}: StayDeleteConfirmProps): JSX.Element {
  const { t, i18n } = useTranslation(["lodging", "common"]);
  /**
   * Asked only while the confirmation is opening. A house page mounts a
   * documents section for the HOUSE; this is the STAY's own folder, which
   * nothing else has counted.
   */
  const documentCount = useDocumentCount(stay ? { type: "lodgingStay", id: stay.id } : null);

  const message = (current: LodgingStay): string => {
    const period = formatStayPeriod(current, i18n.language, t).label;
    const body = hasUnknownLength(current)
      ? t("lodging:stay.confirmDelete.bodyUnknownLength", { period })
      : t("lodging:stay.confirmDelete.body", {
          period,
          nights: t("lodging:field.nightsCount", { count: stayNights(current) }),
        });
    const withReceipt =
      current.receiptUrl === null
        ? body
        : `${body}\n${t("lodging:stay.confirmDelete.receiptNote")}`;
    // The note above covers the LEGACY single `receiptUrl` only, while
    // `Document.lodgingStayId` cascades too (`onDelete: Cascade`, proven live
    // by `integrity/cascades.integrity.test.ts`). One is a file the cost block
    // links to, the other the whole folder - so both lines stand.
    return withDocumentNote(withReceipt, t, documentCount);
  };

  return (
    <ConfirmModal
      isOpen={stay !== null}
      onClose={onClose}
      onConfirm={onConfirm}
      isLoading={deleting}
      title={t("lodging:stay.confirmDelete.title")}
      message={stay === null ? "" : message(stay)}
      confirmText={t("common:buttons.delete")}
      confirmButtonClass={DELETE_BUTTON_CLASS}
    />
  );
}
