import { useState } from "react";
import type { JSX } from "react";
import { Button, Dialog } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import type { ConnectionSwitches } from "../../types/sharingRemote";
import ConnectionSwitchesForm from "../Settings/ConnectionSwitchesForm";
import { DEFAULT_SWITCHES } from "./defaultSwitches";

interface Props {
  title: string;
  hint: string;
  /** Resolves when the request is sent; a rejection is shown through `errorText` and the dialog stays. */
  onConfirm: (switches: ConnectionSwitches) => Promise<void>;
  errorText: (failure: unknown) => string;
  onClose: () => void;
}

/**
 * The one question before a connection request goes out: which parts to give, everything on
 * by default (owner, 2026-11-08). Asking a person on this server, redeeming a link and answering
 * a request all use the same switches; nothing is sent before the button.
 */
export default function SwitchesAskDialog({
  title,
  hint,
  onConfirm,
  errorText,
  onClose,
}: Props): JSX.Element {
  const { t } = useTranslation(["comparison", "common"]);
  const [switches, setSwitches] = useState<ConnectionSwitches>(DEFAULT_SWITCHES);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const send = async (): Promise<void> => {
    setBusy(true);
    setFailed(null);
    try {
      await onConfirm(switches);
    } catch (failure) {
      logger.error("friends: request failed", failure);
      setFailed(errorText(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      busy={busy}
      onClose={onClose}
      title={title}
      dismissLabel={String(t("common:buttons.cancel"))}
      action={
        <Button disabled={busy} onClick={() => void send()}>
          {String(t("add.ask"))}
        </Button>
      }
    >
      <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
        <p className="t-caption">{hint}</p>
        <ConnectionSwitchesForm
          idPrefix="friend-ask"
          value={switches}
          onChange={setSwitches}
          disabled={busy}
        />
        {failed && <p role="alert">{failed}</p>}
      </div>
    </Dialog>
  );
}
