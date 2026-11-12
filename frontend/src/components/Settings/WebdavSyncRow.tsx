import { useCallback, useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useExpertRows } from "./frame/useExpertRows";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { logger } from "../../lib/logger";
import { profileWallClock } from "../../lib/profileInstant";
import { token } from "../ui/tokens";
import {
  ChoiceControl,
  ErrorLine,
  InputControl,
  SettingItem,
  StatusValue,
  SwitchControl,
  useGuardedNavigate,
  useSettingWrite,
} from "../ui/settings";
import {
  webdavErrorKey,
  webdavRequestErrorCode,
  webdavSyncApi,
  type WebdavSchedule,
  type WebdavSyncStatus,
  type WebdavSyncUpdate,
} from "../../lib/api/webdavSync";
import { useDependency, useRowCopy } from "./rowCopy";

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
}: {
  /** Draw the expert row ("Versionen behalten") whatever the level is. */
  alwaysExpert?: boolean;
}): JSX.Element | null {
  const { t } = useTranslation(["settings", "settingsRows"]);
  const row = useRowCopy("data");
  const dependency = useDependency();
  const isDemo = useIsDemoAccount();
  // How often and versions to keep are expert rows (settings v3). "Jetzt hochladen"
  // is gone (S6): the schedule uploads, and the last result is shown below.
  const levelExpert = useExpertRows(2);
  const expert = alwaysExpert || levelExpert;
  const go = useGuardedNavigate();
  const [status, setStatus] = useState<WebdavSyncStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- errorText only maps an error code to copy at failure time; re-creating send per render would churn its consumers
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
  const last = row("webdavlast");

  return (
    <div
      data-testid="webdav-sync-row"
      className="flex flex-col"
      style={{ gap: "var(--ts-space-md)" }}
    >
      <SettingItem
        title={eigen.title}
        sub={eigen.sub}
        help={eigen.help}
        save={enabled}
        locked={lock}
        error={rowError ?? undefined}
        dependency={
          configured || status.enabled
            ? undefined
            : dependency("noWebdav", () => go("/settings/dienstek#webdav"))
        }
        control={<SwitchControl checked={enabled.value} onChange={enabled.choose} />}
      />
      {expert && (
        <SettingItem
          title={takt.title}
          expert
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
      )}
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
      {status.enabled && (
        <SettingItem
          title={last.title}
          control={
            <StatusValue>
              <LastResult status={status} />
            </StatusValue>
          }
        />
      )}
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
