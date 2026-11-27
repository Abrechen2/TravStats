import { useCallback, useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import {
  RECOVERY_KEY_STATUS_EVENT,
  recoveryKeyApi,
  type RecoveryKeyStatus,
} from "../../lib/api/recoveryKey";
import { logger } from "../../lib/logger";
import { profileDateTime } from "../../lib/profileInstant";
import { ActionControl, ErrorLine, SettingItem } from "../ui/settings";
import RecoveryKeyDialog from "./RecoveryKeyDialog";

/**
 * The recovery-key row on Sicherungen: whether the key is confirmed, and
 * "Wiederherstellungsschlüssel anzeigen", which runs the same flow as the
 * mandatory dialog — here it can be cancelled.
 */
export default function RecoveryKeyRow(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const [status, setStatus] = useState<RecoveryKeyStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback((): void => {
    recoveryKeyApi.status().then(
      (s) => {
        setStatus(s);
        setFailed(false);
      },
      (error: unknown) => {
        logger.warn("Failed to read the recovery-key status", error);
        setFailed(true);
      }
    );
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(RECOVERY_KEY_STATUS_EVENT, load);
    return () => window.removeEventListener(RECOVERY_KEY_STATUS_EVENT, load);
  }, [load]);

  const sub = !status
    ? t("settings:recoveryKey.row.sub")
    : status.confirmed && status.confirmedAt
      ? t("settings:recoveryKey.row.confirmed", {
          when: profileDateTime(new Date(status.confirmedAt)) ?? "—",
        })
      : status.confirmedForOtherKey
        ? t("settings:recoveryKey.row.otherKey")
        : t("settings:recoveryKey.row.unconfirmed");

  return (
    <>
      <SettingItem
        title={t("settings:recoveryKey.row.title")}
        sub={sub}
        scope="allAccounts"
        control={
          <ActionControl label={t("settings:recoveryKey.row.open")} onClick={() => setOpen(true)} />
        }
      >
        {failed ? <ErrorLine>{t("settings:recoveryKey.row.loadFailed")}</ErrorLine> : null}
      </SettingItem>
      <RecoveryKeyDialog
        open={open}
        blocking={false}
        onClose={() => setOpen(false)}
        onConfirmed={(s) => {
          setStatus(s);
          setOpen(false);
        }}
      />
    </>
  );
}
