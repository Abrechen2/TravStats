import { useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { sharingApi } from "../../lib/api/sharing";
import { logger } from "../../lib/logger";
import { useToastStore } from "../../store/toastStore";
import type { SharePerson } from "../../types/sharing";
import { Button, Dialog, Field, Input, Select } from "../ui";
import { sharingErrorKey } from "./sharingCopy";

const NS = "sharing:linkDialog";

/**
 * "Mit Konto verknüpfen…" on a companion row (spec 2026-10-16, D9). A link
 * needs an accepted consent from that account (decision 4): with one, pick the
 * account; without any, the dialog sends the request instead — the link
 * follows once the other side agrees. Einstellungen keeps the full list.
 * Mounted only while open, so every opening starts clean.
 */
export default function LinkAccountDialog(props: LinkAccountDialogProps): JSX.Element | null {
  return props.open ? <LinkAccountForm {...props} /> : null;
}

interface LinkAccountDialogProps {
  open: boolean;
  onClose: () => void;
  companion: { id: string; name: string };
  linkableUsers: readonly SharePerson[];
  onLinked: () => void;
}

function LinkAccountForm({
  open,
  onClose,
  companion,
  linkableUsers,
  onLinked,
}: LinkAccountDialogProps): JSX.Element {
  const { t } = useTranslation(["sharing"]);
  const addToast = useToastStore((s) => s.addToast);
  const [userId, setUserId] = useState("");
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canLink = linkableUsers.length > 0;

  const run = async (
    action: () => Promise<string>,
    fallback: string,
    afterSuccess?: () => void
  ): Promise<void> => {
    setBusy(true);
    setError(null);
    let message: string | null = null;
    try {
      message = await action();
    } catch (err) {
      logger.error("Sharing link dialog failed:", err);
      setError(t(sharingErrorKey(err, fallback)));
    } finally {
      setBusy(false);
    }
    // Outside the try: a failing callback is not "could not be linked".
    if (message !== null) {
      addToast("success", message);
      afterSuccess?.();
      onClose();
    }
  };

  const link = (): Promise<void> =>
    run(
      async () => {
        const linked = await sharingApi.linkCompanion(companion.id, userId);
        return t(`${NS}.linked`, {
          name: companion.name,
          username: linked.linkedUser?.username ?? "",
        });
      },
      "sharing:settings.errors.linkFailed",
      onLinked
    );

  const request = (): Promise<void> =>
    run(async () => {
      await sharingApi.requestConsent(username.trim());
      return t(`${NS}.requested`, { username: username.trim() });
    }, "sharing:settings.errors.requestFailed");

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      title={t(`${NS}.title`, { name: companion.name })}
      action={
        canLink ? (
          <Button variant="primary" disabled={busy || !userId} onClick={() => void link()}>
            {t(`${NS}.link`)}
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={busy || !username.trim()}
            onClick={() => void request()}
          >
            {t(`${NS}.request`)}
          </Button>
        )
      }
    >
      <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
        {canLink ? (
          <Field label={t(`${NS}.account`)} htmlFor="link-account">
            <Select id="link-account" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">{t(`${NS}.choose`)}</option>
              {linkableUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName} (@{u.username})
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <>
            <p className="text-sm">{t(`${NS}.requestIntro`, { name: companion.name })}</p>
            <Field label={t(`${NS}.username`)} htmlFor="link-username">
              <Input
                id="link-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </Field>
          </>
        )}
        {error && (
          <p role="alert" className="text-sm" style={{ color: "var(--ts-bad)" }}>
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
