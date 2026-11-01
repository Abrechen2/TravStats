import { useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import { logger } from "../../../lib/logger";
import { pendingUpdatesApi } from "../../../lib/api/pendingUpdates";
import Button from "../../ui/Button";

type Action = "apply" | "reject";

/**
 * "Alle übernehmen / verwerfen" for the flight updates the inbox currently
 * shows (forgejo#397). Applying rewrites flights, so it asks once; the server
 * answers per update, and a partly failed run says how many stayed — they are
 * still in the inbox after the reload, never silently dropped.
 */
export default function BulkUpdatesBar({
  ids,
  reload,
}: {
  ids: string[];
  reload: () => Promise<void>;
}): JSX.Element | null {
  const { t } = useTranslation(["pendingUpdates"]);
  const [confirming, setConfirming] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (ids.length === 0) return null;

  const run = async (action: Action): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      const result =
        action === "apply"
          ? await pendingUpdatesApi.applyMany(ids)
          : await pendingUpdatesApi.rejectMany(ids);
      const done = (action === "apply" ? result.applied : result.rejected) ?? 0;
      setMessage(
        result.failed > 0
          ? { ok: false, text: t("pendingUpdates:bulk.partial", { done, failed: result.failed }) }
          : { ok: true, text: t(`pendingUpdates:bulk.${action}Done`, { count: done }) }
      );
    } catch (err: unknown) {
      logger.error("BulkUpdatesBar: bulk call failed", err);
      setMessage({ ok: false, text: t("pendingUpdates:bulk.failed") });
    } finally {
      setConfirming(null);
      setBusy(false);
      // Reload even after a failure: the server may have done part of it.
      await reload();
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {confirming === null ? (
          <>
            <Button disabled={busy} onClick={() => setConfirming("apply")}>
              {t("pendingUpdates:bulk.apply", { count: ids.length })}
            </Button>
            <Button disabled={busy} onClick={() => setConfirming("reject")}>
              {t("pendingUpdates:bulk.reject", { count: ids.length })}
            </Button>
          </>
        ) : (
          <>
            <span className="text-sm">
              {t(`pendingUpdates:bulk.${confirming}Confirm`, { count: ids.length })}
            </span>
            <Button variant="primary" disabled={busy} onClick={() => void run(confirming)}>
              {t("pendingUpdates:bulk.yes")}
            </Button>
            <Button disabled={busy} onClick={() => setConfirming(null)}>
              {t("pendingUpdates:bulk.cancel")}
            </Button>
          </>
        )}
      </div>
      {message && (
        <p role={message.ok ? "status" : "alert"} className="text-sm">
          {message.text}
        </p>
      )}
    </div>
  );
}
