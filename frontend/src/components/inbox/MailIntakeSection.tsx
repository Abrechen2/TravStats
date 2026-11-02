import { useCallback, useEffect, useState, type JSX } from "react";
import { useNavigate } from "react-router-dom";

import { useTranslation } from "../../hooks/useTranslation";
import { api } from "../../lib/api/client";
import { logger } from "../../lib/logger";
import { formatDate } from "../../lib/displayFormat";
import { mailIntakeApi, type MailInbox, type MailInboxItem } from "../../lib/api/mailIntake";
import { Card } from "../ui/Card";
import { errorText, minuteOf, reasonText } from "../MailIntake/mailIntakeCopy";
import { openableDomain, type MailIntakeHandoff } from "./mailIntakeHandoff";

/**
 * "Aus deiner Mail" (forgejo#313): what the mail intake made of the mails it
 * read. A proposal is only a proposal — "Prüfen und übernehmen" hands the
 * original mail to the import dialog of its domain, where the user confirms;
 * nothing becomes an entry here. A rejection, a failure and an empty reading
 * each say why, in words, and can be answered (allow the sender, read again).
 * Renders nothing when there is nothing to show.
 */
export default function MailIntakeSection(): JSX.Element | null {
  const { t } = useTranslation(["mailIntake", "common"]);
  const navigate = useNavigate();
  const [inbox, setInbox] = useState<MailInbox>({ items: [], sourceProblem: null });
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setInbox(await mailIntakeApi.inbox());
    } catch (error) {
      // An older server has no such route; the inbox must not complain about it.
      logger.warn("Failed to load the mail intake inbox:", error);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (work: () => Promise<void>, done?: string): Promise<void> => {
    setNotice(null);
    try {
      await work();
      if (done) setNotice(done);
    } catch (error) {
      logger.error("Mail intake action failed", error);
      setNotice(t("mailIntake:inbox.actionError"));
    }
    await load();
  };

  const review = async (item: MailInboxItem): Promise<void> => {
    const domain = openableDomain(item.domain);
    if (!domain || !item.documentId) return;
    setNotice(null);
    try {
      const { data } = await api.get<Blob>(`/documents/${item.documentId}/file`, {
        responseType: "blob",
      });
      const file = new File([data], "mail.eml", { type: "message/rfc822" });
      const handoff: MailIntakeHandoff = { domain, document: { kind: "file", file } };
      navigate("/dashboard", { state: { mailIntakeHandoff: handoff } });
    } catch (error) {
      logger.error("Failed to open the mail for the import", error);
      setNotice(t("mailIntake:inbox.openError"));
    }
  };

  const { items, sourceProblem } = inbox;
  if (items.length === 0 && !sourceProblem) return null;

  const title = (item: MailInboxItem): string =>
    item.status === "proposed"
      ? t(`mailIntake:domains.${item.domain ?? "flight"}`, { defaultValue: "" })
      : t(`mailIntake:inbox.${item.status}Title`);

  return (
    <Card style={{ marginBottom: "var(--ts-space-xl)" }} aria-labelledby="mail-intake-title">
      <h3
        id="mail-intake-title"
        style={{ fontSize: 16, fontWeight: 700, color: "var(--ts-text-bright)" }}
      >
        {t("mailIntake:inbox.title")}
      </h3>
      <p className="t-caption" style={{ marginTop: "var(--ts-space-xs)" }}>
        {t("mailIntake:inbox.description")}
      </p>
      {sourceProblem && (
        <p role="alert" style={{ marginTop: "var(--ts-space-md)", color: "var(--ts-bad)" }}>
          {t("mailIntake:inbox.sourceProblem")}{" "}
          {errorText(t, sourceProblem.error, "mailIntake:errors.protocol_error")}
          {sourceProblem.at ? ` (${minuteOf(sourceProblem.at)})` : ""}
        </p>
      )}
      {notice && (
        <p role="status" style={{ marginTop: "var(--ts-space-md)" }}>
          {notice}
        </p>
      )}
      <ul
        className="flex flex-col"
        style={{ gap: "var(--ts-space-md)", marginTop: "var(--ts-space-lg)" }}
      >
        {items.map((item) => (
          <li
            key={item.id}
            data-testid="mail-intake-card"
            className="flex flex-wrap items-center justify-between"
            style={{
              gap: "var(--ts-space-md)",
              borderTop: "1px solid var(--ts-border)",
              paddingTop: "var(--ts-space-md)",
            }}
          >
            <span className="flex flex-col" style={{ color: "var(--ts-text)" }}>
              <span>
                <strong>{title(item)}</strong> · {item.subject || t("mailIntake:inbox.noSubject")}
              </span>
              <span className="t-caption">
                {item.from ? t("mailIntake:inbox.from", { from: item.from }) : ""}
                {item.receivedAt ? ` · ${formatDate(item.receivedAt)}` : ""}
                {item.status === "proposed" && item.found !== null
                  ? ` · ${t("mailIntake:inbox.found", { count: item.found })}`
                  : ""}
              </span>
              {item.status !== "proposed" && (
                <span className="t-caption">{reasonText(t, item.reason)}</span>
              )}
              {item.deletesAt && (
                <span className="t-caption">
                  {t("mailIntake:inbox.deletesOn", { date: formatDate(item.deletesAt) })}
                </span>
              )}
            </span>
            <span className="flex flex-wrap items-center gap-2">
              {item.status === "proposed" && openableDomain(item.domain) && (
                <button type="button" className="btn-primary" onClick={() => void review(item)}>
                  {t("mailIntake:inbox.review")}
                </button>
              )}
              {item.reason === "sender_not_allowed" && item.from && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() =>
                    void act(
                      () => mailIntakeApi.allowSender(item.id),
                      t("mailIntake:inbox.allowed")
                    )
                  }
                >
                  {t("mailIntake:inbox.allowSender")}
                </button>
              )}
              {(item.status === "failed" || item.status === "nothing") && item.documentId && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void act(() => mailIntakeApi.retry(item.id))}
                >
                  {t("mailIntake:inbox.retry")}
                </button>
              )}
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void act(() => mailIntakeApi.dismiss(item.id))}
              >
                {t("mailIntake:inbox.dismiss")}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
