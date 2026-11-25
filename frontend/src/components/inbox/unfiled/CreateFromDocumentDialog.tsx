import { useState } from "react";
import type { JSX } from "react";
import { useNavigate } from "react-router-dom";

import Modal from "../../Modal";
import { useEnabledDomains } from "../../../hooks/useEnabledDomains";
import { useTranslation } from "../../../hooks/useTranslation";
import { documentsApi, type NewEntryDomain, type TravelDocument } from "../../../lib/api/documents";
import { logger } from "../../../lib/logger";
import { NEW_ENTRY_DOMAINS, type DocumentFilingHandoff } from "../documentFilingHandoff";
import { readDocumentFor } from "./documentReading";

interface Props {
  document: TravelDocument;
  onClose: () => void;
}

/** The formats an import dialog can read: the same ones the parse routes take. */
const READABLE_FORMATS = new Set(["pdf", "image", "eml"]);

/**
 * "Neu anlegen aus Dokument": pick what to create, and the matching import
 * dialog opens with this document already dropped into it — it reads the file
 * (the existing parsers; nothing new here). Whatever the user saves is then
 * filed with this document, so it leaves the unassigned list.
 *
 * Offered for the five domains that have an import dialog. A document the
 * parser already attributed to one (`parsedDomain`) is listed first.
 */
export default function CreateFromDocumentDialog({ document, onClose }: Props): JSX.Element {
  const { t } = useTranslation(["dataQuality", "common"]);
  const navigate = useNavigate();
  const { isEnabled } = useEnabledDomains();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The reader found nothing for this domain: its reason stays here, on the
  // inbox, with "create empty with the document" — never a silent jump to an
  // empty form.
  const [empty, setEmpty] = useState<{ domain: NewEntryDomain; file: File; reason: string } | null>(
    null
  );

  const domains = NEW_ENTRY_DOMAINS.filter((d) => isEnabled(d));
  const ordered = [...domains].sort(
    (a, b) => Number(b === document.parsedDomain) - Number(a === document.parsedDomain)
  );
  const readable = READABLE_FORMATS.has(document.format);

  const handOver = (handoff: DocumentFilingHandoff): void => {
    navigate("/dashboard", { state: { documentFilingHandoff: handoff } });
  };

  const start = async (domain: NewEntryDomain): Promise<void> => {
    setBusy(true);
    setError(null);
    setEmpty(null);
    let file: File;
    try {
      const blob = await documentsApi.fetchFile(document.id);
      file = new File([blob], document.displayName, {
        type: blob.type || document.mimetype,
      });
    } catch (err: unknown) {
      logger.error({ err, id: document.id }, "CreateFromDocumentDialog: file could not be read");
      setError(t("dataQuality:unfiledDocuments.create.fetchFailed"));
      setBusy(false);
      return;
    }
    const outcome = await readDocumentFor(file, domain, t);
    if (!outcome.found) {
      logger.warn({ id: document.id, domain }, "CreateFromDocumentDialog: nothing read");
      setEmpty({ domain, file, reason: outcome.reason });
      setBusy(false);
      return;
    }
    handOver({
      documentId: document.id,
      domain,
      document: { kind: "file", file },
      ...(outcome.reading ? { reading: outcome.reading } : {}),
    });
  };

  const createEmpty = (): void => {
    if (!empty) return;
    handOver({
      documentId: document.id,
      domain: empty.domain,
      document: { kind: "file", file: empty.file },
      manual: true,
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title={t("dataQuality:unfiledDocuments.create.title", { name: document.displayName })}
      maxWidth={480}
      testId="create-from-document-dialog"
    >
      <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
        <p className="t-caption">
          {readable
            ? t("dataQuality:unfiledDocuments.create.hint")
            : t("dataQuality:unfiledDocuments.create.unreadable")}
        </p>
        {ordered.length === 0 && (
          <p className="t-caption">{t("dataQuality:unfiledDocuments.create.noDomains")}</p>
        )}
        {readable && (
          <ul className="flex flex-col" style={{ gap: "var(--ts-space-xs)" }}>
            {ordered.map((domain) => (
              <li key={domain}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void start(domain)}
                  className="flex w-full items-center justify-between rounded-md border border-border px-4 py-2 text-left text-sm pointer-coarse:min-h-(--ts-size-touch-min) disabled:opacity-50"
                >
                  <span>{t(`dataQuality:unfiledDocuments.create.domains.${domain}`)}</span>
                  {domain === document.parsedDomain && (
                    <span className="t-caption">
                      {t("dataQuality:unfiledDocuments.create.recognised")}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        {busy && (
          <p className="t-caption" role="status">
            {t("dataQuality:unfiledDocuments.create.reading")}
          </p>
        )}
        {empty !== null && (
          <div
            role="alert"
            data-testid="create-from-document-empty"
            className="flex flex-col rounded-md border px-4 py-3"
            style={{ gap: "var(--ts-space-sm)", borderColor: "var(--ts-bad)" }}
          >
            <p className="text-sm" style={{ margin: 0, fontWeight: 600 }}>
              {t("dataQuality:unfiledDocuments.create.nothingFound")}
            </p>
            <p className="text-sm" style={{ margin: 0 }}>
              {empty.reason}
            </p>
            <p className="t-caption" style={{ margin: 0 }}>
              {t("dataQuality:unfiledDocuments.create.createEmptyHint")}
            </p>
            <div className="flex flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
              <button
                type="button"
                onClick={createEmpty}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium pointer-coarse:min-h-(--ts-size-touch-min)"
              >
                {t("dataQuality:unfiledDocuments.create.createEmpty")}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-4 py-2 text-sm pointer-coarse:min-h-(--ts-size-touch-min)"
              >
                {t("common:buttons.cancel")}
              </button>
            </div>
          </div>
        )}
        {error !== null && (
          <p className="t-caption" role="alert" style={{ color: "var(--ts-bad)" }}>
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
