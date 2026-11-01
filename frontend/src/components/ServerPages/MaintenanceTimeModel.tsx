import { useEffect, useState, type JSX } from "react";
import { adminApi } from "../../lib/api";
import { logger } from "../../lib/logger";
import { useTranslation } from "../../hooks/useTranslation";
import TimeMigrationReport from "../Admin/timeModel/TimeMigrationReport";
import ZoneReResolve from "../Admin/timeModel/ZoneReResolve";
import { useRowCopy } from "../Settings/rowCopy";
import { ErrorLine, SettingItem } from "../ui/settings";
import type { AdminUser } from "./types";

/**
 * Maintenance › Zeitzonen (design C7, Expert): what the time-model migration did
 * and the deliberate way to determine zones again (ADR 0002, D2). Both are
 * reports with their own dry-run flow, hosted in the two rows of the design.
 */
export default function MaintenanceTimeModel(): JSX.Element {
  const { t } = useTranslation(["settingsRows"]);
  const row = useRowCopy("maintenance");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    adminApi.getUsers().then(
      (r) => alive && setUsers(r.users as AdminUser[]),
      (error: unknown) => {
        logger.error("Failed to load the accounts for the time-model report:", error);
        if (alive) setFailed(true);
      }
    );
    return () => {
      alive = false;
    };
  }, []);
  const report = row("tzreport");
  const resolve = row("tzresolve");
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
      <SettingItem title={report.title} scope="allAccounts" expert>
        {failed ? <ErrorLine>{t("settingsRows:maintenance.usersLoadFailed")}</ErrorLine> : null}
        <TimeMigrationReport users={users} />
      </SettingItem>
      <SettingItem title={resolve.title} sub={resolve.sub} scope="allAccounts" expert>
        <ZoneReResolve />
      </SettingItem>
    </div>
  );
}
