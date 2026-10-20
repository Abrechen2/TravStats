import { useCallback, useEffect, useState } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { sharingApi } from "../../lib/api/sharing";
import { logger } from "../../lib/logger";
import { useToastStore } from "../../store/toastStore";
import type { ShareConsent, ShareNotice } from "../../types/sharing";
import { shareFieldLabel } from "../sharing/noticeValues";
import { sharingErrorKey, staleUndoFields } from "../sharing/sharingCopy";
import { GlobeLoader } from "../GlobeLoader";
import { Button, Card, EmptyState } from "../ui";
import ShareNoticeCard from "./ShareNoticeCard";

const NS = "sharing:inbox";

/**
 * "Geteilte Reisen" — the Posteingang tab for trip sharing (design
 * 2026-10-09): consent requests waiting for the reader's answer, and notices
 * about shared trips — what another member changed, with undo (S2). A failed load is a failure state with a retry, never an
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
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

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

  /**
   * Undo a change on the reader's own copy, or delete the own copy after a
   * delete. A refusal stays on the notice in its own words — a stale undo
   * names the facts that changed since.
   */
  const act = async (notice: ShareNotice, action: "undo" | "deleteCopy"): Promise<void> => {
    setBusy(notice.id);
    setRowErrors(({ [notice.id]: _gone, ...rest }) => rest);
    try {
      if (action === "undo") await sharingApi.undoNotice(notice.id);
      else await sharingApi.deleteOwnCopy(notice.id);
      addToast("success", t(`${NS}.messages.${action === "undo" ? "undone" : "copyDeleted"}`));
      await load();
    } catch (error) {
      logger.error(`Failed to ${action} share notice:`, error);
      const fields = staleUndoFields(error).map((f) => shareFieldLabel(f, t));
      const message =
        fields.length > 0
          ? t("sharing:errors.undoStaleFields", { fields: fields.join(", ") })
          : t(
              sharingErrorKey(
                error,
                `${NS}.errors.${action === "undo" ? "undoFailed" : "deleteCopyFailed"}`
              )
            );
      setRowErrors((prev) => ({ ...prev, [notice.id]: message }));
      addToast("error", message);
    } finally {
      setBusy(null);
    }
  };

  /**
   * Answer a conflict with another server. A refusal stays on the notice in its
   * own words — an answer against a copy that moved since names the facts.
   */
  const resolve = async (notice: ShareNotice, choice: "mine" | "theirs"): Promise<void> => {
    setBusy(notice.id);
    setRowErrors(({ [notice.id]: _gone, ...rest }) => rest);
    try {
      await sharingApi.resolveConflict(notice.id, choice);
      addToast("success", t(`${NS}.messages.resolved`));
      await load();
    } catch (error) {
      logger.error("Failed to resolve share conflict:", error);
      const fields = staleUndoFields(error, "SHARE_REMOTE_CONFLICT_STALE").map((f) =>
        shareFieldLabel(f, t)
      );
      const message =
        fields.length > 0
          ? t("sharing:errors.conflictStaleFields", { fields: fields.join(", ") })
          : t(sharingErrorKey(error, `${NS}.errors.resolveFailed`));
      setRowErrors((prev) => ({ ...prev, [notice.id]: message }));
      addToast("error", message);
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
    return (
      <div className="flex justify-center py-12">
        <GlobeLoader size={120} label={t("common:loading.default")} />
      </div>
    );
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
            <Card key={consent.id} data-testid="share-request">
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
            </Card>
          ))}
        </section>
      )}
      {notices.length > 0 && (
        <section aria-label={t(`${NS}.notices.title`)} className="space-y-3">
          <h2 className="t-label-mono">{t(`${NS}.notices.title`)}</h2>
          {notices.map((notice) => (
            <ShareNoticeCard
              key={notice.id}
              notice={notice}
              busy={busy === notice.id}
              error={rowErrors[notice.id] ?? null}
              onRead={() => void markRead(notice)}
              onUndo={() => void act(notice, "undo")}
              onDeleteCopy={() => void act(notice, "deleteCopy")}
              onResolve={(choice) => void resolve(notice, choice)}
            />
          ))}
        </section>
      )}
    </div>
  );
}
