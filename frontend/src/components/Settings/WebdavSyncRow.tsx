import { useCallback, useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useExpertRows } from "./frame/useExpertRows";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { logger } from "../../lib/logger";
import { profileWallClock } from "../../lib/profileInstant";
import { token } from "../ui/tokens";
import Button from "../ui/Button";
import {
  ActionControl,
  ChoiceControl,
  ErrorLine,
  InputControl,
  SettingItem,
  SwitchControl,
  useGuardedNavigate,
  useSettingWrite,
} from "../ui/settings";
import {
  JobLostError,
  webdavErrorKey,
  webdavRequestErrorCode,
  webdavSyncApi,
  type WebdavSchedule,
  type WebdavSyncStatus,
  type WebdavSyncUpdate,
} from "../../lib/api/webdavSync";
import { useDependency, useRowCopy } from "./rowCopy";
import WebdavConnectionForm from "./WebdavConnectionForm";

/** ISO date and minute on the profile clock, as the backup row writes it. */
function isoMinute(iso: string): string {
  const local = profileWallClock(iso);
  return local ? `${local.slice(0, 10)} ${local.slice(11, 16)}` : iso;
}

function megabytes(bytes: number | null): string {
  return bytes === null ? "—" : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

const KEEP_MIN = 1;
const KEEP_MAX = 30;

/**
 * "Eigene Kopie auf WebDAV" (design §4 A11, forgejo#321): the account's full
 * export, uploaded on a schedule to a share the user names. Four rows — on/off,
 * how often, versions to keep (Expert) and "Jetzt hochladen" — each writing at
 * once to `PUT /settings/webdav-sync` and keeping the user's pick when the
 * server refuses. Every refusal has its own sentence (`webdavSync.errors`); a
 * refusal of the share is never worded as our own.
 */
export default function WebdavSyncRow({
  alwaysExpert = false,
  withConnection = false,
}: {
  /** Draw the expert row ("Versionen behalten") whatever the level is. */
  alwaysExpert?: boolean;
  /**
   * Draw the connection form here. The design keeps it on Services → Backup
   * target (the Services page mounts `WebdavSyncPanel`); the Data page names the
   * missing connection and jumps there.
   */
  withConnection?: boolean;
}): JSX.Element | null {
  const { t } = useTranslation(["settings", "settingsRows"]);
  const row = useRowCopy("data");
  const dependency = useDependency();
  const isDemo = useIsDemoAccount();
  const levelExpert = useExpertRows(1);
  const expert = alwaysExpert || levelExpert;
  const go = useGuardedNavigate();
  const [status, setStatus] = useState<WebdavSyncStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"save" | "run" | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [runMessage, setRunMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [keepDraft, setKeepDraft] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await webdavSyncApi.get());
      setLoadFailed(false);
    } catch (err) {
      // Our own API failed, not the share: no rows, so nothing can be saved
      // over a stored configuration we could not read.
      logger.error("Failed to load WebDAV sync settings", err);
      setLoadFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const errorText = (err: unknown): string => {
    const code = webdavRequestErrorCode(err);
    return t(code ? webdavErrorKey(code) : "settings:webdavSync.saveError");
  };

  /** One write to the settings; the row's own failure text is kept for the line under it. */
  const send = useCallback(async (patch: WebdavSyncUpdate): Promise<void> => {
    try {
      setStatus(await webdavSyncApi.update(patch));
      setRowError(null);
    } catch (err) {
      setRowError(errorText(err));
      throw err;
    }
  }, []);

  const enabled = useSettingWrite<boolean>("data.webdav.enabled", status?.enabled ?? false, (v) =>
    send({ enabled: v })
  );
  const schedule = useSettingWrite<WebdavSchedule>(
    "data.webdav.schedule",
    status?.schedule ?? "daily",
    (v) => send({ schedule: v })
  );
  const keep = useSettingWrite<number>("data.webdav.keep", status?.keepVersions ?? 5, (v) =>
    send({ keepVersions: v })
  );

  const saveConnection = async (patch: WebdavSyncUpdate): Promise<boolean> => {
    setBusy("save");
    setFormError(null);
    try {
      setStatus(await webdavSyncApi.update(patch));
      return true;
    } catch (err) {
      setFormError(errorText(err));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const runNow = async (): Promise<void> => {
    setBusy("run");
    setRunMessage(null);
    try {
      const result = await webdavSyncApi.runNow();
      setRunMessage(
        result.status === "ok"
          ? { ok: true, text: row("webdavjetzt").res ?? t("settings:webdavSync.runOk") }
          : {
              ok: false,
              text: t("settings:webdavSync.runPartial", {
                reason: t(webdavErrorKey(result.errorCode)),
              }),
            }
      );
    } catch (err) {
      setRunMessage({
        ok: false,
        text: err instanceof JobLostError ? t("settings:webdavSync.runLost") : errorText(err),
      });
    } finally {
      setBusy(null);
      // The recorded result is the truth either way; read it back.
      void load();
    }
  };

  if (loadFailed) return <ErrorLine>{t("settings:webdavSync.loadError")}</ErrorLine>;
  if (!status) return null;

  const configured = Boolean(status.url && status.username && status.hasPassword);
  const lock = isDemo
    ? { why: "demo" as const, reason: t("settings:blocks.lock.demo") }
    : undefined;
  const offDep = status.enabled ? undefined : dependency("webdavOff");
  const keepText = keepDraft ?? String(keep.value);
  const keepCheck = /^\d+$/.test(keepText) && +keepText >= KEEP_MIN && +keepText <= KEEP_MAX;
  const commitKeep = (): void => {
    if (keepDraft === null) return;
    if (keepCheck) keep.choose(Number(keepDraft));
    else return;
    setKeepDraft(null);
  };
  const eigen = row("webdaveigen");
  const takt = row("webdavtakt");
  const vers = row("webdavvers");
  const jetzt = row("webdavjetzt");

  return (
    <div
      data-testid="webdav-sync-row"
      className="flex flex-col"
      style={{ gap: "var(--ts-space-md)" }}
    >
      <SettingItem
        title={eigen.title}
        sub={<LastResult status={status} fallback={eigen.sub} />}
        help={eigen.help}
        save={enabled}
        locked={lock}
        error={rowError ?? undefined}
        dependency={
          configured || status.enabled
            ? undefined
            : dependency("noWebdav", () =>
                withConnection ? setOpen(true) : go("/settings/services#webdav")
              )
        }
        control={<SwitchControl checked={enabled.value} onChange={enabled.choose} />}
      >
        {withConnection && (
          <div>
            <Button onClick={() => setOpen((o) => !o)} aria-expanded={open} disabled={isDemo}>
              {open ? t("settings:webdavSync.hide") : t("settings:webdavSync.setup")}
            </Button>
          </div>
        )}
        {withConnection && open && !isDemo && (
          <WebdavConnectionForm status={status} busy={busy === "save"} onSave={saveConnection} />
        )}
        {formError && <ErrorLine>{formError}</ErrorLine>}
      </SettingItem>
      <SettingItem
        title={takt.title}
        save={schedule}
        locked={lock}
        dependency={offDep}
        control={
          <ChoiceControl<WebdavSchedule>
            label={takt.title}
            value={schedule.value}
            onChange={schedule.choose}
            options={[
              { value: "daily", label: t("settings:webdavSync.schedules.daily") },
              { value: "weekly", label: t("settings:webdavSync.schedules.weekly") },
            ]}
          />
        }
      />
      {expert && (
        <SettingItem
          title={vers.title}
          sub={vers.sub}
          expert
          save={keep}
          locked={lock}
          dependency={offDep}
          error={
            keepDraft !== null && !keepCheck ? t("settings:webdavSync.versionsInvalid") : undefined
          }
          control={
            <span onBlur={commitKeep} onKeyDown={(e) => e.key === "Enter" && commitKeep()}>
              <InputControl
                type="number"
                inputMode="numeric"
                value={keepText}
                onChange={setKeepDraft}
              />
            </span>
          }
        />
      )}
      <SettingItem
        title={jetzt.title}
        locked={lock}
        dependency={offDep}
        control={
          <ActionControl
            label={
              busy === "run" || status.running
                ? t("settings:webdavSync.running")
                : (jetzt.btn ?? t("settings:webdavSync.runNow"))
            }
            busy={busy !== null || status.running}
            onClick={() => void runNow()}
          />
        }
      >
        {runMessage &&
          (runMessage.ok ? (
            <p role="status" className="t-caption" style={{ color: token("good") }}>
              {runMessage.text}
            </p>
          ) : (
            <ErrorLine>{runMessage.text}</ErrorLine>
          ))}
      </SettingItem>
    </div>
  );
}

/** The last run, with its reason when it failed. */
function LastResult({
  status,
  fallback,
}: {
  status: WebdavSyncStatus;
  fallback?: string;
}): JSX.Element {
  const { t } = useTranslation(["settings"]);
  if (!status.ranAt || !status.lastStatus) {
    return <>{[fallback, t("settings:webdavSync.last.never")].filter(Boolean).join(" · ")}</>;
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

/** The Services page's WebDAV card: the rows and the connection form together. */
export function WebdavSyncPanel(): JSX.Element {
  return <WebdavSyncRow withConnection alwaysExpert />;
}
