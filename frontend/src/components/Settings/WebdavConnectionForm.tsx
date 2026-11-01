import { useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import Button from "../ui/Button";
import { Field, Input } from "../ui/Field";
import type { WebdavSyncStatus, WebdavSyncUpdate } from "../../lib/api/webdavSync";

/**
 * The connection to the account's own WebDAV share: address, user, password
 * (write-only: empty keeps the stored one) and folder. It is its own group with
 * its own save, apart from the immediate rows above it — and its own failure.
 * The design puts this under Services → Backup target; until that page draws
 * it, it lives here so the copy can be set up at all.
 */
export default function WebdavConnectionForm({
  status,
  busy,
  onSave,
}: {
  status: WebdavSyncStatus;
  busy: boolean;
  /** Resolves true when the server confirmed. */
  onSave: (patch: WebdavSyncUpdate) => Promise<boolean>;
}): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const [url, setUrl] = useState(status.url ?? "");
  const [username, setUsername] = useState(status.username ?? "");
  const [password, setPassword] = useState("");
  const [remotePath, setRemotePath] = useState(status.remotePath);

  const patch = (): WebdavSyncUpdate => ({
    url: url.trim() || null,
    username: username.trim() || null,
    remotePath: remotePath.trim() || "/TravStats/",
    // An empty password field keeps the stored one.
    ...(password !== "" ? { password } : {}),
  });

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
      <p className="t-caption">{t("settings:webdavSync.connectionHint")}</p>
      <p className="t-caption">{t("settings:webdavSync.whatIsUploaded")}</p>
      <Field
        label={t("settings:webdavSync.url")}
        htmlFor="webdav-sync-url"
        hint={t(
          status.allowPrivateTargets
            ? "settings:webdavSync.urlHintAdmin"
            : "settings:webdavSync.urlHint"
        )}
      >
        <Input
          id="webdav-sync-url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://cloud.example.com/remote.php/dav/files/name/"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </Field>
      <Field label={t("settings:webdavSync.username")} htmlFor="webdav-sync-user">
        <Input
          id="webdav-sync-user"
          autoComplete="off"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </Field>
      <Field
        label={t("settings:webdavSync.password")}
        htmlFor="webdav-sync-password"
        hint={status.hasPassword ? t("settings:webdavSync.passwordStored") : undefined}
      >
        <Input
          id="webdav-sync-password"
          type="password"
          autoComplete="new-password"
          placeholder={
            status.hasPassword ? t("settings:webdavSync.passwordKeepPlaceholder") : undefined
          }
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <Field label={t("settings:webdavSync.remotePath")} htmlFor="webdav-sync-path">
        <Input
          id="webdav-sync-path"
          value={remotePath}
          onChange={(e) => setRemotePath(e.target.value)}
        />
      </Field>
      <div className="flex flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => void onSave(patch()).then((ok) => ok && setPassword(""))}
        >
          {busy ? t("settings:webdavSync.saving") : t("settings:webdavSync.save")}
        </Button>
        {status.hasPassword && (
          <Button disabled={busy} onClick={() => void onSave({ password: null, enabled: false })}>
            {t("settings:webdavSync.clearPassword")}
          </Button>
        )}
      </div>
    </div>
  );
}
