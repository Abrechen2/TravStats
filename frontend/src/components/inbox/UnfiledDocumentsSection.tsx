import { useCallback, useEffect, useState } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { documentsApi, documentFileUrl, type UnfiledDocument } from "../../lib/api/documents";
import { formatDate } from "../../lib/displayFormat";
import { logger } from "../../lib/logger";
import { Card } from "../ui/Card";

/**
 * "These uploads belong to nothing yet, and here is when they go" — the
 * per-user block in the inbox's review tab.
 *
 * An unfiled document is deleted by the hourly sweep, row and bytes. That was
 * true at seven days and NOTHING said so: no screen, no locale string, no
 * endpoint (2026-09-19 integrity audit, finding 4). A boarding pass sent from
 * the Companion while offline and never attached to a flight simply stopped
 * existing. The TTL is thirty days now, and this block is the announcement —
 * raising the number without saying it would only have made the silence last
 * longer.
 *
 * Shaped after `PasswordResetRequestsSection`, which sits above it, and
 * disappears the same way: nothing at all when there is nothing unfiled. The
 * difference is whose rows these are — that block is admin-only and about other
 * people's accounts, this one is about the reader's own files.
 *
 * "Öffnen" is a plain anchor at the file route and not a fetch: the JWT is an
 * HttpOnly cookie, so a top-level navigation carries it, and the server already
 * decides which formats are shown and which are handed over as a download.
 */
export default function UnfiledDocumentsSection(): JSX.Element | null {
  const { t } = useTranslation(["dataQuality", "common"]);
  const [documents, setDocuments] = useState<UnfiledDocument[]>([]);

  const load = useCallback(async (): Promise<void> => {
    try {
      setDocuments(await documentsApi.listUnfiled());
    } catch (error) {
      // An older server has no such route, and a reader who came here for
      // their own questions should not get a toast about it.
      logger.warn("Failed to load unfiled documents:", error);
      setDocuments([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (documents.length === 0) return null;

  return (
    <Card style={{ marginBottom: "var(--ts-space-xl)" }} aria-labelledby="unfiled-documents-title">
      <h3
        id="unfiled-documents-title"
        style={{ fontSize: 16, fontWeight: 700, color: "var(--ts-text-bright)" }}
      >
        {t("dataQuality:unfiledDocuments.title")}
      </h3>
      <p className="t-caption" style={{ marginTop: "var(--ts-space-xs)" }}>
        {t("dataQuality:unfiledDocuments.description")}
      </p>

      <ul
        className="flex flex-col"
        style={{ gap: "var(--ts-space-md)", marginTop: "var(--ts-space-lg)" }}
      >
        {documents.map((document) => (
          <li
            key={document.id}
            className="flex flex-wrap items-center justify-between"
            style={{
              gap: "var(--ts-space-md)",
              borderTop: "1px solid var(--ts-border)",
              paddingTop: "var(--ts-space-md)",
            }}
          >
            {/* Two dates as <time> elements rather than one interpolated
                sentence: the deletion date is the point of this block, and an
                ISO `dateTime` beside the formatted text is what lets a screen
                reader — and a test — read the date the user was actually
                promised, instead of the prose around it. */}
            <span className="flex flex-col" style={{ color: "var(--ts-text)" }}>
              <span>{document.displayName}</span>
              <span className="t-caption">
                {t("dataQuality:unfiledDocuments.uploaded")}{" "}
                <time dateTime={document.createdAt}>{formatDate(document.createdAt)}</time>
                {" · "}
                {t("dataQuality:unfiledDocuments.deletesOn")}{" "}
                <time dateTime={document.deletesAt}>{formatDate(document.deletesAt)}</time>
              </span>
            </span>
            <a
              href={documentFileUrl(document)}
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--ts-accent)", textDecoration: "underline" }}
            >
              {t("dataQuality:unfiledDocuments.open")}
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}
