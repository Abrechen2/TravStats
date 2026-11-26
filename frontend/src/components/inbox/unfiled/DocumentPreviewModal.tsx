import { useEffect, useState } from "react";
import type { JSX } from "react";

import Dialog from "../../ui/Dialog";
import { useTranslation } from "../../../hooks/useTranslation";
import {
  documentDownloadUrl,
  documentFileUrl,
  type TravelDocument,
} from "../../../lib/api/documents";
import InlineError from "../../ui/InlineError";

interface Props {
  document: TravelDocument;
  onClose: () => void;
}

/**
 * The document, inline: an image as an image, a PDF or a mail's text in a frame.
 * A Wallet pass has no reading the browser can show, so it says so and offers
 * the download. The bytes come from the file route as a plain URL — the JWT is
 * an HttpOnly cookie that a frame navigation carries.
 *
 * "Herunterladen" is always there: a frame that cannot render a PDF (some
 * tablets) leaves no error to catch, so the way out must not depend on one.
 */
export default function DocumentPreviewModal({ document, onClose }: Props): JSX.Element {
  const { t } = useTranslation(["dataQuality", "common"]);
  const [imageFailed, setImageFailed] = useState(false);
  const [frameBlocked, setFrameBlocked] = useState(false);
  // A frame the page's policy refuses leaves no error on the element, only this
  // event — without it a strict proxy would give the user an empty box.
  useEffect(() => {
    const onViolation = (event: SecurityPolicyViolationEvent): void => {
      if (event.effectiveDirective === "frame-src" || event.effectiveDirective === "child-src") {
        setFrameBlocked(true);
      }
    };
    window.document.addEventListener("securitypolicyviolation", onViolation);
    return () => window.document.removeEventListener("securitypolicyviolation", onViolation);
  }, []);
  const src = documentFileUrl(document);

  let body: JSX.Element;
  if (document.format === "image") {
    body = imageFailed ? (
      <InlineError>{t("dataQuality:unfiledDocuments.preview.imageFailed")}</InlineError>
    ) : (
      <img
        src={src}
        alt={document.displayName}
        onError={() => setImageFailed(true)}
        style={{ maxWidth: "100%", maxHeight: "70vh", margin: "0 auto", display: "block" }}
      />
    );
  } else if (document.format === "pkpass") {
    body = <p className="t-caption">{t("dataQuality:unfiledDocuments.preview.noPreview")}</p>;
  } else if (frameBlocked) {
    body = <InlineError>{t("dataQuality:unfiledDocuments.preview.frameBlocked")}</InlineError>;
  } else {
    body = (
      <iframe
        title={document.displayName}
        src={src}
        style={{ width: "100%", height: "70vh", border: "1px solid var(--ts-border)" }}
      />
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={document.displayName}
      maxWidth={960}
      testId="document-preview-modal"
      footer={
        <>
          <a
            href={documentDownloadUrl(document)}
            download={document.displayName}
            className="inline-flex justify-center rounded-md border border-border px-4 py-2 text-sm font-medium pointer-coarse:min-h-(--ts-size-touch-min)"
          >
            {t("dataQuality:unfiledDocuments.preview.download")}
          </a>
          <a
            href={src}
            target="_blank"
            rel="noreferrer"
            className="inline-flex justify-center rounded-md border border-border px-4 py-2 text-sm font-medium pointer-coarse:min-h-(--ts-size-touch-min)"
          >
            {t("dataQuality:unfiledDocuments.open")}
          </a>
        </>
      }
    >
      {document.note && (
        <p
          data-testid="document-note"
          className="t-caption"
          style={{ marginBottom: "var(--ts-space-md)", whiteSpace: "pre-wrap" }}
        >
          {document.note}
        </p>
      )}
      {body}
    </Dialog>
  );
}
