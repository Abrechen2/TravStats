import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { useTranslation } from "../../hooks/useTranslation";
import { sharingApi } from "../../lib/api/sharing";
import { logger } from "../../lib/logger";
import { useToastStore } from "../../store/toastStore";
import type { ShareConsent, ShareNotice } from "../../types/sharing";
import { sharingErrorKey } from "../sharing/sharingCopy";
import Button from "../ui/Button";
import EmptyState from "../ui/EmptyState";

const NS = "sharing:inbox";

/**
 * "Geteilte Reisen" — the Posteingang tab for trip sharing (design
 * 2026-10-09): consent requests waiting for the reader's answer, and notices
 * about shared trips. A failed load is a failure state with a retry, never an
 * empty inbox; a failed answer keeps the request and says why.
 */
export default function SharingTab({
  onCount,
}: {
  /** The number for the tab label: open requests plus unread notices. */
  onCount?: (count: number) => void;
} = {}): JSX.Element {
  const { t } = useTranslation(["sharing", "common"]);
  const addToast = useToastStore((state) => state.addToast);
  const [requests, setRequests] = useState<ShareConsent[] | null>(null);
  const [notices, setNotices] = useState<ShareNotice[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [consents, list] = await Promise.all([
        sharingApi.listConsents(),
        sharingApi.listNotices(),
      ]);
      const pending = consents.incoming.filter((c) => c.status === "pending");
      setRequests(pending);
      setNotices(list);
      setLoadFailed(false);
      onCount?.(pending.length + list.filter((n) => n.readAt === null).length);
    } catch (error) {
      logger.error("Failed to load sharing inbox:", error);
      setLoadFailed(true);
    }
  }, [onCount]);

  useEffect(() => {
    void load();
  }, [load]);

  const answer = async (consent: ShareConsent, action: "accept" | "decline"): Promise<void> => {
    setBusy(consent.id);
    try {
      await sharingApi.answerConsent(consent.id, action);
      addToast(
        "success",
        t(`${NS}.messages.${action === "accept" ? "accepted" : "declined"}`, {
          name: consent.person.displayName,
        })
      );
      await load();
    } catch (error) {
      logger.error("Failed to answer consent:", error);
      addToast("error", t(sharingErrorKey(error, `${NS}.errors.answerFailed`)));
      await load();
    } finally {
      setBusy(null);
    }
  };

  const markRead = async (notice: ShareNotice): Promise<void> => {
    setBusy(notice.id);
    try {
      await sharingApi.markNoticeRead(notice.id);
      await load();
    } catch (error) {
      logger.error("Failed to mark notice read:", error);
      addToast("error", t(sharingErrorKey(error, `${NS}.errors.markReadFailed`)));
    } finally {
      setBusy(null);
    }
  };

  if (loadFailed) {
    return (
      <EmptyState
        kind="degraded"
        title={t(`${NS}.errors.loadFailed`)}
        description={t(`${NS}.errors.loadFailedHint`)}
        action={<Button onClick={() => void load()}>{t(`${NS}.errors.retry`)}</Button>}
      />
    );
  }
  if (requests === null || notices === null) {
    return <p className="t-caption">{t("common:loading.default")}</p>;
  }
  if (requests.length === 0 && notices.length === 0) {
    return (
      <EmptyState
        kind="nothing"
        title={t(`${NS}.empty.title`)}
        description={t(`${NS}.empty.description`)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <p className="t-caption">{t(`${NS}.description`)}</p>
      {requests.length > 0 && (
        <section aria-label={t(`${NS}.requests.title`)} className="space-y-3">
          <h2 className="t-label-mono">{t(`${NS}.requests.title`)}</h2>
          {requests.map((consent) => (
            <div
              key={consent.id}
              data-testid="share-request"
              className="rounded-lg p-4"
              style={{ border: "1px solid var(--ts-border)", background: "var(--ts-tile)" }}
            >
              <p className="mb-3 text-sm">
                {t(`${NS}.requests.body`, {
                  name: consent.person.displayName,
                  username: consent.person.username,
                })}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  disabled={busy === consent.id}
                  onClick={() => void answer(consent, "accept")}
                >
                  {t(`${NS}.requests.accept`)}
                </Button>
                <Button
                  disabled={busy === consent.id}
                  onClick={() => void answer(consent, "decline")}
                >
                  {t(`${NS}.requests.decline`)}
                </Button>
              </div>
            </div>
          ))}
        </section>
      )}
      {notices.length > 0 && (
        <section aria-label={t(`${NS}.notices.title`)} className="space-y-3">
          <h2 className="t-label-mono">{t(`${NS}.notices.title`)}</h2>
          {notices.map((notice) => (
            <NoticeRow
              key={notice.id}
              notice={notice}
              busy={busy === notice.id}
              onRead={() => void markRead(notice)}
            />
          ))}
        </section>
      )}
    </div>
  );
}

function NoticeRow({
  notice,
  busy,
  onRead,
}: {
  notice: ShareNotice;
  busy: boolean;
  onRead: () => void;
}): JSX.Element {
  const { t } = useTranslation(["sharing"]);
  const kind = notice.kind === "shared" || notice.kind === "left" ? notice.kind : "other";
  const text = t(`${NS}.notices.${kind}`, {
    name: notice.actor?.displayName ?? t(`${NS}.notices.someone`),
    trip: notice.after?.tripName ?? t(`${NS}.notices.unknownTrip`),
  });
  const unread = notice.readAt === null;
  return (
    <div
      data-testid="share-notice"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg p-4"
      style={{
        border: "1px solid var(--ts-border)",
        background: unread ? "var(--ts-tile)" : "transparent",
        fontWeight: unread ? 600 : 400,
      }}
    >
      <p className="text-sm">{text}</p>
      <div className="flex gap-2">
        {notice.entityType === "trip" && notice.entityKey && (
          <Link to={`/trips/${notice.entityKey}`} className="text-sm">
            {t(`${NS}.notices.open`)}
          </Link>
        )}
        {unread && (
          <Button disabled={busy} onClick={onRead}>
            {t(`${NS}.notices.markRead`)}
          </Button>
        )}
      </div>
    </div>
  );
}
