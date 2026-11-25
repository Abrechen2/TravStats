import type { JSX } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import type { RecoveryKeyStatus } from "../../lib/api/recoveryKey";
import { logger } from "../../lib/logger";
import { useAuthStore } from "../../store/authStore";
import Modal from "../Modal";
import Button from "../ui/Button";
import RecoveryKeyFlow from "./RecoveryKeyFlow";

const noop = (): void => {};

/**
 * The recovery-key flow in a dialog. `blocking` is the owner's mandatory mode
 * (2026-11-24): an instance with a backup target whose key is unconfirmed
 * cannot be dismissed — no ×, no Escape, no click beside it. The one way out
 * is signing out.
 */
export default function RecoveryKeyDialog({
  open,
  blocking,
  onClose,
  onConfirmed,
}: {
  open: boolean;
  blocking: boolean;
  onClose?: () => void;
  onConfirmed: (status: RecoveryKeyStatus) => void;
}): JSX.Element | null {
  const { t } = useTranslation(["settings"]);
  const navigate = useNavigate();

  const signOut = async (): Promise<void> => {
    try {
      await useAuthStore.getState().logout();
    } catch (error) {
      logger.warn("Sign-out from the recovery-key dialog failed", error);
    }
    navigate("/login", { replace: true });
  };

  return (
    <Modal
      open={open}
      onClose={blocking ? noop : (onClose ?? noop)}
      showClose={!blocking}
      title={t("settings:recoveryKey.title")}
      testId="recovery-key-dialog"
      footer={
        blocking ? (
          <div className="flex w-full flex-wrap items-center justify-between" style={{ gap: 8 }}>
            <span className="t-caption">{t("settings:recoveryKey.blocking")}</span>
            <Button onClick={() => void signOut()}>{t("settings:recoveryKey.signOut")}</Button>
          </div>
        ) : undefined
      }
    >
      <RecoveryKeyFlow onConfirmed={onConfirmed} />
    </Modal>
  );
}
