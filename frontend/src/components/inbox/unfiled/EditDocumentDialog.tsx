import DateField from "../../../components/ui/DateField";
import { useState } from "react";
import type { JSX } from "react";

import Dialog from "../../ui/Dialog";
import { useTranslation } from "../../../hooks/useTranslation";
import {
  DOCUMENT_KINDS,
  documentsApi,
  isDemoForbidden,
  type DocumentKind,
  type TravelDocument,
} from "../../../lib/api/documents";
import { logger } from "../../../lib/logger";
import InlineError from "../../ui/InlineError";

interface Props {
  document: TravelDocument;
  onClose: () => void;
  /** The saved document, as the server answered. */
  onSaved: (saved: TravelDocument) => void;
}

/**
 * Title, date on the document and kind of ONE document, through the existing
 * `PATCH /documents/:id`. Only fields that changed are sent, so saving a date
 * cannot overwrite a kind someone else set a moment ago.
 *
 */
export default function EditDocumentDialog({ document, onClose, onSaved }: Props): JSX.Element {
  const { t } = useTranslation(["dataQuality", "documents", "common"]);
  const [name, setName] = useState(document.displayName);
  const [issuedOn, setIssuedOn] = useState(document.issuedOn ?? "");
  const [note, setNote] = useState(document.note ?? "");
  const [kind, setKind] = useState<DocumentKind | "">(document.kind ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const patch = {
    ...(trimmed !== document.displayName && trimmed !== "" && { displayName: trimmed }),
    ...(issuedOn !== (document.issuedOn ?? "") && { issuedOn: issuedOn === "" ? null : issuedOn }),
    ...(note.trim() !== (document.note ?? "") && { note: note.trim() === "" ? null : note.trim() }),
    ...(kind !== (document.kind ?? "") && { kind: kind === "" ? null : kind }),
  };
  const changed = Object.keys(patch).length > 0;

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await documentsApi.update(document.id, patch));
      onClose();
    } catch (err: unknown) {
      logger.error({ err, id: document.id }, "EditDocumentDialog: save failed");
      setError(
        isDemoForbidden(err)
          ? t("dataQuality:unfiledDocuments.errors.demo")
          : t("dataQuality:unfiledDocuments.errors.saveFailed")
      );
    } finally {
      setBusy(false);
    }
  };

  const field = "rounded-md px-3 py-2 text-sm pointer-coarse:min-h-(--ts-size-touch-min)";
  const fieldStyle = { border: "1px solid var(--ts-border)", background: "transparent" } as const;

  return (
    <Dialog
      open
      onClose={onClose}
      busy={busy}
      dirty={changed}
      title={t("dataQuality:unfiledDocuments.edit.title")}
      maxWidth={480}
      testId="edit-document-dialog"
      footer={(requestClose) => (
        <>
          <button
            type="button"
            onClick={requestClose}
            disabled={busy}
            className="inline-flex justify-center rounded-md border border-border px-4 py-2 text-sm font-medium pointer-coarse:min-h-(--ts-size-touch-min) disabled:opacity-50"
          >
            {t("common:buttons.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || !changed || trimmed === ""}
            className="btn-primary inline-flex justify-center rounded-md px-4 py-2 text-sm font-medium pointer-coarse:min-h-(--ts-size-touch-min) disabled:opacity-50"
          >
            {t("common:buttons.save")}
          </button>
        </>
      )}
    >
      <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
        <label className="flex flex-col" style={{ gap: 4 }}>
          <span className="t-caption">{t("dataQuality:unfiledDocuments.edit.name")}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            className={field}
            style={fieldStyle}
          />
        </label>
        <label className="flex flex-col" style={{ gap: 4 }}>
          <span className="t-caption">{t("dataQuality:unfiledDocuments.edit.issuedOn")}</span>
          <DateField
            inline
            value={issuedOn}
            onChange={(e) => setIssuedOn(e.target.value)}
            className={field}
            style={fieldStyle}
          />
        </label>
        <label className="flex flex-col" style={{ gap: 4 }}>
          <span className="t-caption">{t("dataQuality:unfiledDocuments.edit.kind")}</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as DocumentKind | "")}
            className={field}
            style={fieldStyle}
          >
            <option value="">{t("dataQuality:unfiledDocuments.edit.kindNone")}</option>
            {DOCUMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`documents:kind.${k}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col" style={{ gap: 4 }}>
          <span className="t-caption">{t("dataQuality:unfiledDocuments.edit.note")}</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            rows={3}
            className={field}
            style={fieldStyle}
          />
        </label>
        {error !== null && <InlineError>{error}</InlineError>}
      </div>
    </Dialog>
  );
}
