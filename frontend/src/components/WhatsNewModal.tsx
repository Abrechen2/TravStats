import Modal from "./Modal";
import type { ReactNode } from "react";
import { useTranslation } from "../hooks/useTranslation";
import type { WhatsNewEntry } from "../content/whatsNew";

interface WhatsNewModalProps {
  isOpen: boolean;
  entry: WhatsNewEntry | null;
  onClose: () => void;
  /** Rendered below the highlights. The usage-stats consent card passes through here. */
  extraSlot?: ReactNode;
}

export default function WhatsNewModal({
  isOpen,
  entry,
  onClose,
  extraSlot,
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

        {extraSlot ? <div data-testid="whats-new-extra-slot">{extraSlot}</div> : null}
      </div>
    </Modal>
  );
}
