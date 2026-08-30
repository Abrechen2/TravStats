import { useTranslation } from "../../hooks/useTranslation";
import AirlineLogoRefreshButton from "./AirlineLogoRefreshButton";

// ==================== SystemInfo Interfaces ====================

export interface SystemInfoData {
  instanceName: string;
  userCount: number;
  activeUserCount: number;
  flightCount: number;
  maxUsers: number;
  warningThreshold: boolean;
  registrationEnabled: boolean;
  version: string;
  buildVersion?: string;
  demoUserExists?: boolean;
  demoUserActive?: boolean;
}

export interface AdminUser {
  id: string;
  username: string;
  isAdmin: boolean;
  isActive: boolean;
  invitedBy?: string;
  createdAt: string;
  /** When the user switched TOTP on; null = off. Drives the reset-2FA action. */
  twoFactorEnabledAt: string | null;
  _count: {
    flights: number;
    userAchievements: number;
  };
}

interface SystemInfoProps {
  systemInfo: SystemInfoData;
  users: AdminUser[];
  onExportData: () => void;
  /** Hard-deletes the demo user via the admin DELETE /users/:id route.
   * Cascades through Prisma so all demo flights/cruises/trips/bookings/
   * achievements get removed too. */
  onDeleteDemoUser: (userId: string) => void;
}

export default function SystemInfo({
  systemInfo,
  users,
  onExportData,
  onDeleteDemoUser,
}: SystemInfoProps): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-(--bg-surface) rounded-lg shadow-sm p-6">
          <div className="text-(--text-muted) text-sm mb-1">{t("admin:instanceLabel")}</div>
          <div className="text-2xl font-bold text-(--text-primary)">
            {systemInfo.instanceName}
          </div>
        </div>
        <div className="bg-(--bg-surface) rounded-lg shadow-sm p-6">
          <div className="text-(--text-muted) text-sm mb-1">{t("admin:totalUsers")}</div>
          <div className="text-2xl font-bold text-(--text-primary)">
            {systemInfo.userCount} / {systemInfo.maxUsers}
          </div>
        </div>
        <div className="bg-(--bg-surface) rounded-lg shadow-sm p-6">
          <div className="text-(--text-muted) text-sm mb-1">{t("admin:activeUsers")}</div>
          <div className="text-2xl font-bold text-(--text-primary)">
            {systemInfo.activeUserCount}
          </div>
        </div>
        <div className="bg-(--bg-surface) rounded-lg shadow-sm p-6">
          <div className="text-(--text-muted) text-sm mb-1">{t("admin:totalFlights")}</div>
          <div className="text-2xl font-bold text-(--text-primary)">
            {systemInfo.flightCount}
          </div>
        </div>
      </div>

      {/* Warning */}
      {systemInfo.warningThreshold && (
        <div
          className="border rounded-lg p-4"
          style={{ background: "var(--bg-elevated)", borderColor: "var(--color-amber)" }}
        >
          <h3 className="font-semibold mb-2" style={{ color: "var(--color-amber)" }}>
            {t("admin:userLimitWarning.title")}
          </h3>
          <p className="text-sm" style={{ color: "var(--color-amber)" }}>
            {t("admin:userLimitWarning.message", { maxUsers: systemInfo.maxUsers })}
          </p>
        </div>
      )}

      {/* Demo User Warning */}
      {systemInfo.demoUserExists && systemInfo.demoUserActive && (
        <div
          className="border rounded-lg p-4"
          style={{ background: "var(--bg-elevated)", borderColor: "#f97316" }}
        >
          <h3 className="font-semibold mb-2" style={{ color: "#ea580c" }}>
            {t("admin:demoWarning.title")}
          </h3>
          <p className="text-sm mb-3" style={{ color: "#ea580c" }}>
            {t("admin:demoWarning.message")}
          </p>
          <button
            onClick={() => {
              const demoUser = users.find((u) => u.username === "demo");
              if (demoUser && confirm(t("admin:prompts.confirmDeleteDemo"))) {
                onDeleteDemoUser(demoUser.id);
              }
            }}
            className="btn-danger text-sm"
          >
            {t("admin:demoWarning.button")}
          </button>
        </div>
      )}

      {/* Configuration */}
      <div className="bg-(--bg-surface) rounded-lg shadow-sm p-6">
        <h2 className="text-lg font-semibold text-(--text-primary) mb-4">
          {t("admin:systemInfo.configuration")}
        </h2>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <dt className="text-sm text-(--text-muted)">
              {t("admin:systemInfo.registration")}
            </dt>
            <dd className="text-lg font-medium text-(--text-primary)">
              {systemInfo.registrationEnabled
                ? t("admin:systemInfo.enabled")
                : t("admin:systemInfo.disabled")}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-(--text-muted)">{t("admin:systemInfo.version")}</dt>
            <dd className="text-lg font-medium text-(--text-primary)">
              {systemInfo.version}
              {/*
                On a promoted `:latest` the image is a byte-identical retag of
                the RC, so buildVersion still carries the `-rc.N` suffix. Show
                only the clean release version; expose the build provenance in a
                hover tooltip (still in the diagnostic bundle for debugging). (#156)
              */}
              {systemInfo.buildVersion && systemInfo.buildVersion !== systemInfo.version && (
                <span
                  className="ml-1.5 align-middle text-xs font-normal cursor-help"
                  style={{ color: "var(--text-muted)" }}
                  title={`${t("admin:systemInfo.buildLabel")}: ${systemInfo.buildVersion} — ${t("admin:systemInfo.buildVersionHint")}`}
                  aria-label={`${t("admin:systemInfo.buildLabel")}: ${systemInfo.buildVersion}`}
                >
                  ⓘ
                </span>
              )}
            </dd>
          </div>
        </dl>
      </div>

      {/* Actions */}
      <div className="bg-(--bg-surface) rounded-lg shadow-sm p-6">
        <h2 className="text-lg font-semibold text-(--text-primary) mb-4">
          {t("admin:systemInfo.dataManagement")}
        </h2>
        <button onClick={onExportData} className="btn-primary px-4 py-2">
          {t("admin:systemInfo.exportButton")}
        </button>
        <p className="text-sm text-(--text-muted) mt-2">
          {t("admin:systemInfo.exportDescription")}
        </p>
        <AirlineLogoRefreshButton />
      </div>
    </div>
  );
}
