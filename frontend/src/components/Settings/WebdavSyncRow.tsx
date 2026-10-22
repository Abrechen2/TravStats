import { useCallback, useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { useExpertRows } from "./frame/useExpertRows";
import { Field, Input, Select, Switch } from "../ui/Field";
import Button from "../ui/Button";
import { token } from "../ui/tokens";
import { profileWallClock } from "../../lib/profileInstant";
import { logger } from "../../lib/logger";
import DemoLockedNotice from "./DemoLockedNotice";
import {
  JobLostError,
  webdavErrorKey,
  webdavRequestErrorCode,
  webdavSyncApi,
  type WebdavSchedule,
  type WebdavSyncStatus,
  type WebdavSyncUpdate,
} from "../../lib/api/webdavSync";

/** ISO date and minute on the profile clock, as the backup row writes it. */
function isoMinute(iso: string): string {
  const local = profileWallClock(iso);
  return local ? `${local.slice(0, 10)} ${local.slice(11, 16)}` : iso;
}

function megabytes(bytes: number | null): string {
  return bytes === null ? "—" : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

interface Message {
  ok: boolean;
  text: string;
}

/**
 * Daten › Meine Daten & Sync › „Mit WebDAV abgleichen“ (forgejo#321): the
 * account's full export, uploaded on a schedule to a share the user names.
 * An expert row — it is plumbing, not something TravStats needs to work.
 */
export default function WebdavSyncRow(): JSX.Element | null {
  const expert = useExpertRows(1);
  return expert ? <WebdavSyncPanel /> : null;
}

function WebdavSyncPanel(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const isDemo = useIsDemoAccount();

  const [status, setStatus] = useState<WebdavSyncStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remotePath, setRemotePath] = useState("/TravStats/");
  const [schedule, setSchedule] = useState<WebdavSchedule>("daily");
  const [keepVersions, setKeepVersions] = useState("5");
  const [busy, setBusy] = useState<"save" | "run" | null>(null);
  const [message, setMessage] = useState<Message | null>(null);

  const apply = useCallback((next: WebdavSyncStatus) => {
    setStatus(next);
    setUrl(next.url ?? "");
    setUsername(next.username ?? "");
    setRemotePath(next.remotePath);
    setSchedule(next.schedule);
    setKeepVersions(String(next.keepVersions));
  }, []);

  const load = useCallback(async () => {
    try {
      apply(await webdavSyncApi.get());
      setLoadFailed(false);
    } catch (err) {
      // Our own API failed, not the share: no form, so nothing can be saved
      // over a stored configuration we could not read.
      logger.error("Failed to load WebDAV sync settings", err);
      setLoadFailed(true);
    }
  }, [apply]);

  useEffect(() => {
    void load();
  }, [load]);

  const failure = (err: unknown, fallbackKey: string): Message => {
    const code = webdavRequestErrorCode(err);
    return { ok: false, text: t(code ? webdavErrorKey(code) : fallbackKey) };
  };

  const save = async (patch: WebdavSyncUpdate): Promise<boolean> => {
    setBusy("save");
    setMessage(null);
    try {
      apply(await webdavSyncApi.update(patch));
      setPassword("");
      return true;
    } catch (err) {
      setMessage(failure(err, "settings:webdavSync.saveError"));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const formPatch = (): WebdavSyncUpdate => {
    const patch: WebdavSyncUpdate = {
      url: url.trim() || null,
      username: username.trim() || null,
      remotePath: remotePath.trim() || "/TravStats/",
      schedule,
      keepVersions: Number.parseInt(keepVersions, 10) || 5,
    };
    // An empty password field keeps the stored one.
    if (password !== "") patch.password = password;
    return patch;
  };

  const toggle = async (next: boolean): Promise<void> => {
    // Switching on sends the form too, so a first setup is one click.
    const ok = await save(next ? { ...formPatch(), enabled: true } : { enabled: false });
    if (!ok && next) setOpen(true);
  };

  const runNow = async (): Promise<void> => {
    setBusy("run");
    setMessage(null);
    try {
      const result = await webdavSyncApi.runNow();
      setMessage(
        result.status === "ok"
          ? { ok: true, text: t("settings:webdavSync.runOk") }
          : {
              ok: false,
              text: t("settings:webdavSync.runPartial", {
                reason: t(webdavErrorKey(result.errorCode)),
              }),
            }
      );
    } catch (err) {
      setMessage(
        err instanceof JobLostError
          ? { ok: false, text: t("settings:webdavSync.runLost") }
          : failure(err, "settings:webdavSync.errors.unknown")
      );
    } finally {
      setBusy(null);
      // The recorded result is the truth either way; read it back.
      void load();
    }
  };

  if (loadFailed) {
    return (
      <p role="alert" className="t-caption" style={{ color: token("bad") }}>
        {t("settings:webdavSync.loadError")}
      </p>
    );
  }
  if (isDemo) {
    return (
      <div>
        <Switch
          checked={false}
          onChange={() => undefined}
          label={t("settings:webdavSync.title")}
          disabled
          expert
        />
        <DemoLockedNotice />
      </div>
    );
  }

  return (
    <div
      data-testid="webdav-sync-row"
      className="flex flex-col"
      style={{ gap: "var(--ts-space-md)" }}
    >
      <Switch
        id="webdav-sync-enabled"
        checked={status?.enabled ?? false}
        disabled={status === null || busy !== null}
        onChange={(next) => void toggle(next)}
        label={t("settings:webdavSync.title")}
        sub={status ? <LastResult status={status} /> : t("settings:webdavSync.description")}
        expert
      />
      <div className="flex flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
        <Button onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? t("settings:webdavSync.hide") : t("settings:webdavSync.setup")}
        </Button>
        {status?.enabled && (
          <Button onClick={() => void runNow()} disabled={busy !== null || status.running}>
            {busy === "run" || status.running
              ? t("settings:webdavSync.running")
              : t("settings:webdavSync.runNow")}
          </Button>
        )}
      </div>
      {open && status && (
        <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
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
          <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: "var(--ts-space-md)" }}>
            <Field label={t("settings:webdavSync.schedule")} htmlFor="webdav-sync-schedule">
              <Select
                id="webdav-sync-schedule"
                value={schedule}
                onChange={(e) => setSchedule(e.target.value as WebdavSchedule)}
              >
                <option value="daily">{t("settings:webdavSync.schedules.daily")}</option>
                <option value="weekly">{t("settings:webdavSync.schedules.weekly")}</option>
              </Select>
            </Field>
            <Field label={t("settings:webdavSync.keepVersions")} htmlFor="webdav-sync-keep">
              <Input
                id="webdav-sync-keep"
                type="number"
                min={1}
                max={30}
                value={keepVersions}
                onChange={(e) => setKeepVersions(e.target.value)}
              />
            </Field>
          </div>
          <div className="flex flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
            <Button
              variant="primary"
              onClick={() => void save(formPatch())}
              disabled={busy !== null}
            >
              {busy === "save" ? t("settings:webdavSync.saving") : t("settings:webdavSync.save")}
            </Button>
            {status.hasPassword && (
              <Button
                onClick={() => void save({ password: null, enabled: false })}
                disabled={busy !== null}
              >
                {t("settings:webdavSync.clearPassword")}
              </Button>
            )}
          </div>
        </div>
      )}
      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className="text-sm"
          style={{ color: token(message.ok ? "good" : "bad") }}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}

/** The last run, with its reason when it failed. */
function LastResult({ status }: { status: WebdavSyncStatus }): JSX.Element {
  const { t } = useTranslation(["settings"]);
  if (!status.ranAt || !status.lastStatus) {
    return <>{t("settings:webdavSync.last.never")}</>;
  }
  const when = isoMinute(status.ranAt);
  if (status.lastStatus === "failed") {
    return (
      <span style={{ color: token("bad") }}>
        {t("settings:webdavSync.last.failed", {
          when,
          reason: t(webdavErrorKey(status.lastErrorCode)),
        })}
      </span>
    );
  }
  if (status.lastStatus === "partial") {
    return (
      <span style={{ color: token("warn") }}>
        {t("settings:webdavSync.last.partial", {
          when,
          reason: t(webdavErrorKey(status.lastErrorCode)),
        })}
      </span>
    );
  }
  return (
    <span style={{ fontFamily: "var(--ts-font-mono)" }}>
      {t("settings:webdavSync.last.ok", {
        when,
        file: status.lastFileName ?? "—",
        size: megabytes(status.lastSizeBytes),
      })}
    </span>
  );
}
