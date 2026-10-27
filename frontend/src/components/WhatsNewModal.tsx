import { useState } from "react";
import Modal from "./Modal";
import { useTranslation } from "../hooks/useTranslation";
import { Abrechen2Credit } from "./Brand/Abrechen2Credit";
import type { WhatsNewDeveloperNote, WhatsNewEntry } from "../content/whatsNew";

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
 *
 * A release may end with a note from the developer (owner, 2026-10-27). It is
 * a second page, reached by "Next" instead of "Got it", for the same reason:
 * a note at the bottom of the highlights would be dismissed unseen. It asks
 * nothing; the header × still closes the dialog from either page.
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
  const [page, setPage] = useState<"highlights" | "note">("highlights");

  if (!isOpen || !entry) return null;

  const note = entry.developerNote;
  const showingNote = page === "note" && note !== undefined;

  return (
    <Modal
      open
      onClose={onClose}
      title={t("whatsNew:title", { version: entry.version })}
      maxWidth={672}
      closeLabel={t("common:buttons.close")}
      footer={
        note && !showingNote ? (
          <button onClick={() => setPage("note")} className="btn-primary">
            {t("whatsNew:next")}
          </button>
        ) : (
          <button onClick={onClose} className="btn-primary">
            {t("whatsNew:dismiss")}
          </button>
        )
      }
    >
      {showingNote ? <DeveloperNote note={note} /> : <Highlights entry={entry} />}
    </Modal>
  );
}

function Highlights({ entry }: { entry: WhatsNewEntry }): JSX.Element {
  const { t } = useTranslation(["whatsNew"]);
  return (
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
  );
}

function DeveloperNote({ note }: { note: WhatsNewDeveloperNote }): JSX.Element {
  const { t } = useTranslation(["whatsNew"]);
  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-semibold" style={{ color: "var(--text-primary)" }}>
        {t(`whatsNew:${note.titleKey}`)}
      </h3>
      {note.paragraphKeys.map((key) => (
        <p key={key} className="text-sm" style={{ color: "var(--text-muted)" }}>
          {t(`whatsNew:${key}`)}
        </p>
      ))}
      <div className="mt-2 flex flex-col gap-1">
        <span className="font-medium" style={{ color: "var(--text-primary)" }}>
          {t(`whatsNew:${note.signatureKey}`)}
        </span>
        <Abrechen2Credit />
      </div>
    </div>
  );
}
