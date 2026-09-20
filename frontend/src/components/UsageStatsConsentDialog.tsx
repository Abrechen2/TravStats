import Modal from "./Modal";
import UsageStatsConsentCard from "./UsageStatsConsentCard";
import { useTranslation } from "../hooks/useTranslation";

/**
 * The instance-wide telemetry consent, as a step of its own.
 *
 * It used to ride at the bottom of the what's-new dialog. The beta audit of
 * 2026-09-19 recorded that as a finding rather than a layout: release notes
 * are dismissed reflexively, so the consent question was being closed by a
 * click that was answering something else entirely — and an unanswered
 * question is not consent. The owner ruled on 2026-09-20 that it becomes its
 * own step, shown AFTER the what's-new is gone, or on its own where there is
 * no what's-new to show.
 *
 * Closing without choosing is deliberately allowed. Consent that cannot be
 * refused or deferred is not consent either; the answer stays `unset` and the
 * step returns on the next load.
 *
 * The buttons, the copy and the PUT are the card's, unchanged — this is the
 * frame around them and nothing more.
 */
interface UsageStatsConsentDialogProps {
  isOpen: boolean;
  /** Called both when a choice was persisted and when the dialog is merely closed. */
  onClose: () => void;
}

export default function UsageStatsConsentDialog({
  isOpen,
  onClose,
}: UsageStatsConsentDialogProps): JSX.Element | null {
  const { t } = useTranslation(["usageStats", "common"]);

  if (!isOpen) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={t("usageStats:consent.title")}
      maxWidth={560}
      closeLabel={t("common:buttons.close")}
      testId="usage-stats-consent-dialog"
    >
      {/* The dialog's accessible name already says this — see `showHeading`. */}
      <UsageStatsConsentCard showHeading={false} onDecided={onClose} />
    </Modal>
  );
}
