import { useEffect, useState, type JSX } from "react";
import { useLocation } from "react-router-dom";
import { useAuthStore } from "../../store/authStore";
import { RECOVERY_KEY_STATUS_EVENT, recoveryKeyApi } from "../../lib/api/recoveryKey";
import { logger } from "../../lib/logger";
import RecoveryKeyDialog from "./RecoveryKeyDialog";

/** How soon a failed status read is asked again. */
export const STATUS_RETRY_MS = 15_000;

/**
 * Owner requirement, 2026-11-24: on an instance with a WebDAV/cloud backup
 * target whose recovery key is unconfirmed — or confirmed for a key since
 * replaced — every admin meets a blocking dialog after login and on every page
 * load until the flow is done. Ordinary accounts never see it, and nothing
 * else is paused: backups and the WebDAV copy keep running meanwhile.
 *
 * The status is asked on mount, on every route change and whenever something
 * announces a change (a WebDAV save, a confirmation elsewhere). A failed read
 * keeps the last answer rather than unblocking on a network error.
 */
export default function RecoveryKeyGate({
  sessionConfirmed,
}: {
  sessionConfirmed: boolean;
}): JSX.Element | null {
  const isAdmin = useAuthStore((s) => Boolean(s.user?.isAdmin));
  const { pathname } = useLocation();
  const [required, setRequired] = useState(false);
  const active = sessionConfirmed && isAdmin;

  useEffect(() => {
    if (!active) {
      setRequired(false);
      return;
    }
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const load = (): void => {
      clearTimeout(retry);
      recoveryKeyApi.status().then(
        (status) => alive && setRequired(status.required),
        (error: unknown) => {
          logger.warn("Failed to read the recovery-key status", error);
          // Not an answer: ask again rather than leave a first failure as "not required".
          if (alive) retry = setTimeout(load, STATUS_RETRY_MS);
        }
      );
    };
    load();
    window.addEventListener(RECOVERY_KEY_STATUS_EVENT, load);
    return () => {
      alive = false;
      clearTimeout(retry);
      window.removeEventListener(RECOVERY_KEY_STATUS_EVENT, load);
    };
  }, [active, pathname]);

  if (!active || !required) return null;
  return <RecoveryKeyDialog open blocking onConfirmed={(status) => setRequired(status.required)} />;
}
