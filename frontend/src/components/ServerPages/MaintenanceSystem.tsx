import { useEffect, useState, type JSX } from "react";
import { adminApi } from "../../lib/api";
import { logger } from "../../lib/logger";
import { useDisplayFormat } from "../../lib/displayFormat";
import { useTranslation } from "../../hooks/useTranslation";
import { useDemoAccountStore } from "../../store/demoAccountStore";
import { useToastStore } from "../../store/toastStore";
import { useDialogCopy, useRowCopy } from "../Settings/rowCopy";
import { waitForJob } from "../../lib/api/jobs";
import Button from "../ui/Button";
import {
  ActionControl,
  ConfirmDialog,
  ErrorLine,
  JobStatus,
  SettingItem,
  StatusValue,
} from "../ui/settings";
import type { AdminUser, SystemInfoData } from "./types";
import MaintenanceAirportEnrich from "./MaintenanceAirportEnrich";
import MaintenanceRuntime from "./MaintenanceRuntime";
import { CATALOGUE_KINDS, useCatalogueReseed } from "./useCatalogueReseed";

/**
 * Maintenance › System (design C7, Expert): the version, the complete JSON
 * export, the catalogue re-read (three jobs, each with its own state) and the
 * demo account's removal. Both destructive rows go through the confirmation
 * block; the export and every job say what went wrong when it does.
 */
export default function MaintenanceSystem(): JSX.Element {
  const { t } = useTranslation(["settingsRows", "admin"]);
  const row = useRowCopy("maintenance");
  const dialog = useDialogCopy();
  const addToast = useToastStore((s) => s.addToast);
  const refreshDemoNotice = useDemoAccountStore((s) => s.refresh);
  const [info, setInfo] = useState<SystemInfoData | null>(null);
  const [demo, setDemo] = useState<AdminUser | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  const [asking, setAsking] = useState<"reseed" | "demo" | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoFailed, setDemoFailed] = useState(false);
  const [recreating, setRecreating] = useState(false);
  // Said on the page, not only in a toast that may be missed (UAT rc.45).
  const [recreated, setRecreated] = useState(false);
  const fmt = useDisplayFormat();
  const [recreateFailed, setRecreateFailed] = useState(false);

  const reseed = useCatalogueReseed({
    running: (kind) => t(`settingsRows:maintenance.reseed.running.${kind}`),
    done: (kind, count) =>
      count === null
        ? t(`settingsRows:maintenance.reseed.doneNoCount.${kind}`)
        : t(`settingsRows:maintenance.reseed.done.${kind}`, { count }),
    failure: (reason) => t(`settingsRows:maintenance.reseed.failure.${reason}`),
  });

  const load = async (): Promise<void> => {
    try {
      const [system, users] = await Promise.all([adminApi.getSystemInfo(), adminApi.getUsers()]);
      setInfo(system as SystemInfoData);
      setDemo((users.users as AdminUser[]).find((u) => u.username === "demo") ?? null);
      setLoadFailed(false);
    } catch (error) {
      logger.error("Failed to load system info:", error);
      setLoadFailed(true);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const exportAll = async (): Promise<void> => {
    setExporting(true);
    setExportFailed(false);
    try {
      const data = await adminApi.exportAllData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `travstats-backup-${new Date().toISOString()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      logger.error("Failed to export all data:", error);
      setExportFailed(true);
    } finally {
      setExporting(false);
    }
  };

  const removeDemo = async (): Promise<void> => {
    if (!demo) return;
    setDemoBusy(true);
    setDemoFailed(false);
    try {
      await adminApi.deleteUser(demo.id);
      setAsking(null);
      addToast("success", t("settingsRows:users.done.delete", { name: demo.username }));
      await load();
      await refreshDemoNotice();
    } catch (error) {
      logger.error("Failed to delete the demo account:", error);
      setAsking(null);
      setDemoFailed(true);
    } finally {
      setDemoBusy(false);
    }
  };

  const version = row("sysver");
  const full = row("fulljson");
  const seed = row("reseed");
  const del = row("demodel");
  const recreate = row("demorecreate");

  const recreateDemo = async (): Promise<void> => {
    setRecreating(true);
    setRecreateFailed(false);
    setRecreated(false);
    try {
      const { jobId } = await adminApi.recreateDemo();
      await waitForJob(jobId);
      addToast("success", t("settingsRows:maintenance.demorecreate.done"));
      setRecreated(true);
      await load();
      await refreshDemoNotice();
    } catch (error) {
      logger.error("Failed to re-create the demo account:", error);
      setRecreateFailed(true);
      await load();
    } finally {
      setRecreating(false);
    }
  };
  // Why the account is absent, so an admin understands a demo that comes back
  // (env var) or one that stays gone (their own removal).
  const forcedByEnv = info?.demoForcedByEnv === true;
  const removedAt = info?.demoRemovedAt ?? null;
  const asked =
    asking === "reseed"
      ? dialog("reseed")
      : asking === "demo" && demo
        ? dialog("demodel", { name: demo.username, count: demo.entryTotal })
        : null;
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
      {loadFailed ? (
        <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-md)" }}>
          <ErrorLine>{t("settingsRows:maintenance.systemLoadFailed")}</ErrorLine>
          <Button variant="secondary" onClick={() => void load()}>
            {t("settingsRows:server.retry")}
          </Button>
        </div>
      ) : null}
      <SettingItem
        title={version.title}
        scope="allAccounts"
        expert
        control={
          <StatusValue>
            {info ? info.version : "…"}
            {info?.buildVersion && info.buildVersion !== info.version
              ? ` · ${info.buildVersion}`
              : ""}
          </StatusValue>
        }
      />
      <MaintenanceRuntime />
      <SettingItem
        title={full.title}
        sub={full.sub}
        scope="allAccounts"
        expert
        error={exportFailed ? t("settingsRows:maintenance.errors.export") : undefined}
        control={
          <ActionControl
            label={t("settingsRows:maintenance.download")}
            busy={exporting}
            onClick={() => void exportAll()}
          />
        }
      />
      <SettingItem
        title={seed.title}
        sub={seed.sub}
        help={seed.help}
        scope="allAccounts"
        expert
        control={
          <ActionControl
            danger
            label={t("settingsRows:maintenance.reseed.action")}
            busy={reseed.busy}
            onClick={() => setAsking("reseed")}
          />
        }
      >
        {CATALOGUE_KINDS.map((kind) =>
          reseed.jobs[kind] ? <JobStatus key={kind} job={reseed.jobs[kind]!} /> : null
        )}
      </SettingItem>
      <MaintenanceAirportEnrich />
      {!demo ? (
        <SettingItem
          title={recreate.title}
          sub={
            recreating
              ? t("settingsRows:maintenance.demorecreate.running")
              : forcedByEnv
                ? t("settingsRows:maintenance.demorecreate.forced")
                : removedAt
                  ? t("settingsRows:maintenance.demorecreate.removed", {
                      // The account's own date format, not the browser's (UAT rc.45).
                      date: fmt.date(removedAt),
                    })
                  : recreate.sub
          }
          scope="allAccounts"
          expert
          error={recreateFailed ? t("settingsRows:maintenance.errors.recreate") : undefined}
          control={
            <ActionControl
              label={recreate.title}
              busy={recreating}
              onClick={() => void recreateDemo()}
            />
          }
        />
      ) : null}
      {demo ? (
        <SettingItem
          title={del.title}
          sub={
            forcedByEnv
              ? t("settingsRows:maintenance.demorecreate.forced")
              : recreated
                ? t("settingsRows:maintenance.demorecreate.done")
                : undefined
          }
          scope="allAccounts"
          expert
          error={demoFailed ? t("settingsRows:maintenance.errors.demo") : undefined}
          control={<ActionControl danger label={del.title} onClick={() => setAsking("demo")} />}
        />
      ) : null}
      {asked ? (
        <ConfirmDialog
          open
          {...asked}
          busy={demoBusy}
          onCancel={() => setAsking(null)}
          onConfirm={() => {
            if (asking === "reseed") {
              setAsking(null);
              void reseed.run();
            } else void removeDemo();
          }}
        />
      ) : null}
    </div>
  );
}
