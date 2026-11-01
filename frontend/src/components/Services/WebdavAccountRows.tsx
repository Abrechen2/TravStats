import { useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import {
  webdavErrorKey,
  webdavRequestErrorCode,
  webdavSyncApi,
  type WebdavSyncUpdate,
} from "../../lib/api/webdavSync";
import { ErrorLine } from "../ui/settings";
import type { ServiceField } from "../../lib/api/externalServices";
import FieldsGroup from "./FieldsGroup";
import { useLoaded } from "./useLoaded";
import { useDemoLock } from "./useLockFor";

/**
 * The account's own WebDAV connection: address, user, password and folder. It
 * has its own endpoint (`/settings/webdav-sync`) — the account PUT of the
 * catalogue cannot write it — and its own group, apart from the server's backup
 * target and from the schedule rows on the Data page.
 */
export default function WebdavAccountRows(): JSX.Element | null {
  const { t } = useTranslation(["settingsRows", "settings"]);
  const demo = useDemoLock();
  const { data, setData, failed } = useLoaded(() => webdavSyncApi.get());
  const [error, setError] = useState<string | null>(null);
  if (failed) return <ErrorLine>{t("settings:webdavSync.loadError")}</ErrorLine>;
  if (!data) return null;

  const fields: ServiceField[] = [
    { key: "url", kind: "url", value: data.url, expert: false },
    { key: "username", kind: "text", value: data.username, expert: false },
    { key: "password", kind: "secret", value: data.hasPassword ? "set" : null, expert: false },
    { key: "remotePath", kind: "text", value: data.remotePath, expert: true },
  ];
  const wording = (err: unknown): string => {
    const code = webdavRequestErrorCode(err);
    return t(code ? webdavErrorKey(code) : "settings:webdavSync.saveError");
  };

  return (
    <>
      <p className="t-caption" style={{ margin: 0 }}>
        {t("settings:webdavSync.connectionHint")} {t("settings:webdavSync.whatIsUploaded")}
      </p>
      <FieldsGroup
        id="services.webdav.account"
        label={t("settingsRows:services.ui.accountGroup", { name: "WebDAV" })}
        serviceId="webdav"
        fields={fields}
        secretTemplate="ownKey"
        tests={false}
        lock={demo}
        errorText={error}
        write={async (changes) => {
          setError(null);
          const patch: WebdavSyncUpdate = {
            ...(typeof changes.url === "string" ? { url: changes.url.trim() || null } : {}),
            ...(typeof changes.username === "string"
              ? { username: changes.username.trim() || null }
              : {}),
            ...(typeof changes.remotePath === "string"
              ? { remotePath: changes.remotePath.trim() || "/TravStats/" }
              : {}),
            ...(typeof changes.password === "string" && changes.password !== ""
              ? { password: changes.password }
              : {}),
          };
          try {
            setData(await webdavSyncApi.update(patch));
          } catch (err) {
            setError(wording(err));
            throw err;
          }
        }}
        onRemoveSecret={async () => {
          try {
            setData(await webdavSyncApi.update({ password: null, enabled: false }));
          } catch (err) {
            setError(wording(err));
          }
        }}
      />
    </>
  );
}
