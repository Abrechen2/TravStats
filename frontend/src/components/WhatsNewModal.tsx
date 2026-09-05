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
    <div className="fixed inset-0 z-100 bg-black/60 flex items-center justify-center p-4">
      <div
        className="rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
      >
        <div
          className="px-6 py-4 border-b flex items-center justify-between"
          style={{ borderColor: "var(--color-border)" }}
        >
          <h2
            id="whats-new-title"
            className="text-lg font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            {t("whatsNew:title", { version: entry.version })}
          </h2>
          <button
            onClick={onClose}
            className="text-xl leading-none"
            style={{ color: "var(--text-muted)" }}
            aria-label={t("common:buttons.close")}
          >
            ×
          </button>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex flex-col gap-4">
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

        <div
          className="px-6 py-4 border-t flex justify-end"
          style={{ borderColor: "var(--color-border)" }}
        >
          <button onClick={onClose} className="btn-primary">
            {t("whatsNew:dismiss")}
          </button>
        </div>
      </div>
    </div>
  );
}
