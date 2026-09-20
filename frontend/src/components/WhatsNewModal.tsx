import Modal from "./Modal";
import { useTranslation } from "../hooks/useTranslation";
import type { WhatsNewEntry } from "../content/whatsNew";

/**
 * The release highlights, and nothing else.
 *
 * Until 2026-09-20 this modal carried an `extraSlot` whose only occupant was
 * the instance-wide telemetry consent card. The beta audit of 2026-09-19 found
 * that arrangement to be the defect: this dialog is dismissed reflexively —
 * people close release notes without reading them — so a consent question
 * riding along at the bottom was answered by a dismissal that meant nothing.
 * The owner ruled on 2026-09-20 that consent gets a step of its own, shown
 * after this one is gone (`hooks/useTelemetryConsentStep.ts`). Do not add a
 * slot back: whatever would go in it has the same problem.
 */
interface WhatsNewModalProps {
  isOpen: boolean;
  entry: WhatsNewEntry | null;
  onClose: () => void;
}

export default function WhatsNewModal({
  isOpen,
  entry,
  onClose,
}: WhatsNewModalProps): JSX.Element | null {
  const { t } = useTranslation(["whatsNew", "common"]);

  if (!isOpen || !entry) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={t("whatsNew:title", { version: entry.version })}
      maxWidth={672}
      closeLabel={t("common:buttons.close")}
      footer={
        <button onClick={onClose} className="btn-primary">
          {t("whatsNew:dismiss")}
        </button>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {t("whatsNew:subtitle")}
        </p>

        <ul className="flex flex-col gap-4">
          {entry.highlights.map((item) => (
            <li key={item.titleKey} className="flex gap-3">
              <span className="mt-0.5 text-xl leading-none" aria-hidden="true">
                {item.icon}
              </span>
              <span>
                <span className="font-medium block" style={{ color: "var(--text-primary)" }}>
                  {t(`whatsNew:${item.titleKey}`)}
                  {item.beta && (
                    <span
                      className="ml-2 align-middle inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                      style={{
                        color: "var(--accent)",
                        background: "var(--accent-soft)",
                        border: "1px solid var(--accent-glow)",
                      }}
                    >
                      {t("whatsNew:betaBadge")}
                    </span>
                  )}
                </span>
                <span className="text-sm block" style={{ color: "var(--text-muted)" }}>
                  {t(`whatsNew:${item.bodyKey}`)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
