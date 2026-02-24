import InlineHelp from "../Help/InlineHelp";
import { useTranslation } from "../../hooks/useTranslation";

// ==================== SystemInfo Interfaces ====================

export interface GpuDevice {
  id: number;
  name: string;
  memory: number;
}

export interface HardwareInfo {
  cpu: {
    cores: number;
    model: string;
    architecture: string;
    error?: string;
  };
  gpu: {
    available: boolean;
    count?: number;
    name?: string;
    memory?: number;
    cudaVersion?: string;
    deviceId?: number;
    error?: string;
    reason?: string;
    diagnosis?: string[];
    pytorchHasCuda?: boolean;
    gpuDetected?: boolean;
    gpuNameDetected?: string;
    gpus?: GpuDevice[];
  };
  python: {
    available: boolean;
    version?: string;
    pytorch?: {
      available: boolean;
      version?: string;
    };
    error?: string;
  };
  docker: boolean;
  platform?: {
    system: string;
    release: string;
    version: string;
  };
  trainingAccess: {
    accessible: boolean;
    error?: string;
  };
  error?: string;
}

export interface SystemInfoData {
  instanceName: string;
  userCount: number;
  activeUserCount: number;
  flightCount: number;
  maxUsers: number;
  warningThreshold: boolean;
  registrationEnabled: boolean;
  version: string;
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
  _count: {
    flights: number;
    userAchievements: number;
  };
}

interface SystemInfoProps {
  systemInfo: SystemInfoData;
  hardwareInfo: HardwareInfo | null;
  loadingHardwareInfo: boolean;
  users: AdminUser[];
  onLoadHardwareInfo: () => void;
  onExportData: () => void;
  onToggleDemoUser: (userId: string) => void;
}

export default function SystemInfo({
  systemInfo,
  hardwareInfo,
  loadingHardwareInfo,
  users,
  onLoadHardwareInfo,
  onExportData,
  onToggleDemoUser,
}: SystemInfoProps): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[var(--bg-surface)] rounded-lg shadow p-6">
          <div className="text-[var(--text-muted)] text-sm mb-1">{t("admin:instance")}</div>
          <div className="text-2xl font-bold text-[var(--text-primary)]">
            {systemInfo.instanceName}
          </div>
        </div>
        <div className="bg-[var(--bg-surface)] rounded-lg shadow p-6">
          <div className="text-[var(--text-muted)] text-sm mb-1">{t("admin:totalUsers")}</div>
          <div className="text-2xl font-bold text-[var(--text-primary)]">
            {systemInfo.userCount} / {systemInfo.maxUsers}
          </div>
        </div>
        <div className="bg-[var(--bg-surface)] rounded-lg shadow p-6">
          <div className="text-[var(--text-muted)] text-sm mb-1">{t("admin:activeUsers")}</div>
          <div className="text-2xl font-bold text-[var(--text-primary)]">
            {systemInfo.activeUserCount}
          </div>
        </div>
        <div className="bg-[var(--bg-surface)] rounded-lg shadow p-6">
          <div className="text-[var(--text-muted)] text-sm mb-1">{t("admin:totalFlights")}</div>
          <div className="text-2xl font-bold text-[var(--text-primary)]">
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
            Demo User Active
          </h3>
          <p className="text-sm mb-3" style={{ color: "#ea580c" }}>
            The demo user account (username: &quot;demo&quot;, password: &quot;demo123&quot;) is
            currently active. This is a security risk in production environments. It is recommended
            to deactivate this account after initial testing.
          </p>
          <button
            onClick={() => {
              const demoUser = users.find((u) => u.username === "demo");
              if (
                demoUser &&
                confirm(
                  "Deactivate the demo user account? This will prevent login with demo credentials."
                )
              ) {
                onToggleDemoUser(demoUser.id);
              }
            }}
            className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-lg transition text-sm font-medium"
          >
            Deactivate Demo User
          </button>
        </div>
      )}

      {/* Hardware Information */}
      <div className="bg-[var(--bg-surface)] rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Hardware Information</h2>
          <button
            onClick={onLoadHardwareInfo}
            disabled={loadingHardwareInfo}
            className="px-3 py-1 text-sm font-medium text-[var(--color-amber)] hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loadingHardwareInfo ? t("admin:refreshing") : t("admin:refresh")}
          </button>
        </div>

        {!hardwareInfo && (
          <div className="text-center py-8 text-[var(--text-muted)]">
            {loadingHardwareInfo ? t("admin:hardware.loading") : t("admin:hardware.clickToLoad")}
          </div>
        )}

        {hardwareInfo && hardwareInfo.error && (
          <div
            className="border rounded-lg p-4 mb-4"
            style={{ background: "var(--bg-elevated)", borderColor: "#f87171" }}
          >
            <div className="text-sm" style={{ color: "#dc2626" }}>
              {hardwareInfo.error}
            </div>
          </div>
        )}

        {hardwareInfo && !hardwareInfo.error && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* CPU Info */}
            <div className="border border-[var(--color-border)] rounded-lg p-4">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center">
                <span className="mr-2">CPU</span>
              </h3>
              <dl className="space-y-2">
                <div>
                  <dt className="text-xs text-[var(--text-muted)]">{t("admin:hardware.cores")}</dt>
                  <dd className="text-sm font-medium text-[var(--text-primary)]">
                    {hardwareInfo.cpu.cores}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--text-muted)]">{t("admin:hardware.model")}</dt>
                  <dd className="text-sm font-medium text-[var(--text-primary)] break-words">
                    {hardwareInfo.cpu.model}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--text-muted)]">
                    {t("admin:hardware.architecture")}
                  </dt>
                  <dd className="text-sm font-medium text-[var(--text-primary)]">
                    {hardwareInfo.cpu.architecture}
                  </dd>
                </div>
                {hardwareInfo.cpu.error && (
                  <div className="text-xs text-red-600">{hardwareInfo.cpu.error}</div>
                )}
              </dl>
            </div>

            {/* GPU Info */}
            <div className="border border-[var(--color-border)] rounded-lg p-4">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center">
                <span className="mr-2">GPU</span>
                <span
                  className={`ml-2 px-2 py-0.5 text-xs rounded-full ${
                    hardwareInfo.gpu.available
                      ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                      : hardwareInfo.gpu.gpuDetected
                        ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300"
                        : "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                  }`}
                >
                  {hardwareInfo.gpu.available
                    ? "Verfügbar"
                    : hardwareInfo.gpu.gpuDetected
                      ? "Erkannt (nicht verfügbar)"
                      : "Nicht verfügbar"}
                </span>
              </h3>
              {hardwareInfo.gpu.available ? (
                <dl className="space-y-2">
                  {hardwareInfo.gpu.count && (
                    <div>
                      <dt className="text-xs text-[var(--text-muted)]">
                        {t("admin:hardware.count")}
                      </dt>
                      <dd className="text-sm font-medium text-[var(--text-primary)]">
                        {hardwareInfo.gpu.count}
                      </dd>
                    </div>
                  )}
                  {hardwareInfo.gpu.gpus && hardwareInfo.gpu.gpus.length > 0 ? (
                    <div>
                      <dt className="text-xs text-[var(--text-muted)]">
                        {t("admin:hardware.gpus")}
                      </dt>
                      <dd className="text-sm font-medium text-[var(--text-primary)]">
                        {hardwareInfo.gpu.gpus.map((gpu: GpuDevice) => (
                          <div key={gpu.id} className="mb-1">
                            GPU {gpu.id}: {gpu.name} ({gpu.memory} GB)
                          </div>
                        ))}
                      </dd>
                    </div>
                  ) : (
                    hardwareInfo.gpu.name && (
                      <div>
                        <dt className="text-xs text-[var(--text-muted)]">
                          {t("admin:hardware.name")}
                        </dt>
                        <dd className="text-sm font-medium text-[var(--text-primary)] break-words">
                          {hardwareInfo.gpu.name}
                        </dd>
                      </div>
                    )
                  )}
                  {hardwareInfo.gpu.memory && !hardwareInfo.gpu.gpus && (
                    <div>
                      <dt className="text-xs text-[var(--text-muted)]">
                        {t("admin:hardware.memory")}
                      </dt>
                      <dd className="text-sm font-medium text-[var(--text-primary)]">
                        {hardwareInfo.gpu.memory} GB
                      </dd>
                    </div>
                  )}
                  {hardwareInfo.gpu.cudaVersion && (
                    <div>
                      <dt className="text-xs text-[var(--text-muted)]">
                        {t("admin:hardware.cudaVersion")}
                      </dt>
                      <dd className="text-sm font-medium text-[var(--text-primary)]">
                        {hardwareInfo.gpu.cudaVersion}
                      </dd>
                    </div>
                  )}
                </dl>
              ) : (
                <div className="space-y-2">
                  {hardwareInfo.gpu.gpuDetected && hardwareInfo.gpu.gpuNameDetected && (
                    <div className="text-sm font-medium text-yellow-700">
                      {t("admin:hardware.gpuDetected", {
                        gpuName: hardwareInfo.gpu.gpuNameDetected,
                      })}
                    </div>
                  )}
                  <div className="text-sm text-[var(--text-muted)]">
                    {hardwareInfo.gpu.reason ||
                      hardwareInfo.gpu.error ||
                      t("admin:hardware.noGpuDetected")}
                  </div>
                  {hardwareInfo.gpu.diagnosis && (
                    <div
                      className="mt-3 p-3 border rounded"
                      style={{
                        background: "var(--bg-elevated)",
                        borderColor: "var(--color-amber)",
                      }}
                    >
                      <div
                        className="text-xs font-semibold mb-2"
                        style={{ color: "var(--color-amber)" }}
                      >
                        {t("admin:hardware.solution")}
                      </div>
                      {Array.isArray(hardwareInfo.gpu.diagnosis) ? (
                        hardwareInfo.gpu.diagnosis.length > 0 && (
                          <ul
                            className="text-xs space-y-1 list-disc list-inside"
                            style={{ color: "var(--color-amber)" }}
                          >
                            {hardwareInfo.gpu.diagnosis.map((msg: string, idx: number) => (
                              <li key={idx}>{msg}</li>
                            ))}
                          </ul>
                        )
                      ) : (
                        <div className="text-xs" style={{ color: "var(--color-amber)" }}>
                          {hardwareInfo.gpu.diagnosis}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Python Info */}
            <div className="border border-[var(--color-border)] rounded-lg p-4">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center">
                <span className="mr-2">{t("admin:hardware.python")}</span>
                <span
                  className={`ml-2 px-2 py-0.5 text-xs rounded-full ${
                    hardwareInfo.python.available
                      ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                      : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                  }`}
                >
                  {hardwareInfo.python.available
                    ? t("admin:hardware.available")
                    : t("admin:hardware.notAvailable")}
                </span>
              </h3>
              {hardwareInfo.python.available ? (
                <dl className="space-y-2">
                  {hardwareInfo.python.version && (
                    <div>
                      <dt className="text-xs text-[var(--text-muted)]">
                        {t("admin:hardware.version")}
                      </dt>
                      <dd className="text-sm font-medium text-[var(--text-primary)]">
                        {hardwareInfo.python.version}
                      </dd>
                    </div>
                  )}
                  {hardwareInfo.python.pytorch && (
                    <div>
                      <dt className="text-xs text-[var(--text-muted)]">
                        {t("admin:hardware.pytorch")}
                      </dt>
                      <dd className="text-sm font-medium text-[var(--text-primary)]">
                        {hardwareInfo.python.pytorch.available ? (
                          <span className="text-green-600">
                            {hardwareInfo.python.pytorch.version || t("admin:hardware.available")}
                          </span>
                        ) : (
                          <span className="text-red-600">
                            {t("admin:hardware.notAvailableShort")}
                          </span>
                        )}
                      </dd>
                    </div>
                  )}
                </dl>
              ) : (
                <div className="text-sm text-red-600">
                  {hardwareInfo.python.error || t("admin:hardware.pythonNotFound")}
                </div>
              )}
            </div>

            {/* Environment & Training Access */}
            <div className="border border-[var(--color-border)] rounded-lg p-4">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center">
                <span className="mr-2">{t("admin:hardware.environment")}</span>
              </h3>
              <dl className="space-y-2">
                <div>
                  <dt className="text-xs text-[var(--text-muted)]">{t("admin:hardware.docker")}</dt>
                  <dd className="text-sm font-medium text-[var(--text-primary)]">
                    {hardwareInfo.docker ? (
                      <span className="text-blue-600">{t("admin:hardware.yes")}</span>
                    ) : (
                      <span className="text-[var(--text-muted)]">{t("admin:hardware.no")}</span>
                    )}
                  </dd>
                </div>
                {hardwareInfo.platform && (
                  <>
                    <div>
                      <dt className="text-xs text-[var(--text-muted)]">
                        {t("admin:hardware.system")}
                      </dt>
                      <dd className="text-sm font-medium text-[var(--text-primary)]">
                        {hardwareInfo.platform.system} {hardwareInfo.platform.release}
                      </dd>
                    </div>
                  </>
                )}
                <div className="pt-2 border-t border-[var(--color-border)]">
                  <dt className="text-xs text-[var(--text-muted)] mb-1">
                    {t("admin:hardware.trainingAccess")}
                  </dt>
                  <dd className="text-sm font-medium">
                    {hardwareInfo.trainingAccess.accessible ? (
                      <span className="text-green-600">
                        {t("admin:hardware.trainingAvailable")}
                      </span>
                    ) : (
                      <span className="text-red-600">
                        {t("admin:hardware.trainingNotAvailable")}
                        {hardwareInfo.trainingAccess.error && (
                          <div className="text-xs mt-1 text-red-500">
                            {hardwareInfo.trainingAccess.error}
                          </div>
                        )}
                      </span>
                    )}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        )}
      </div>

      {/* Configuration */}
      <div className="bg-[var(--bg-surface)] rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
          {t("admin:systemInfo.configuration")}
        </h2>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <dt className="text-sm text-[var(--text-muted)]">
              {t("admin:systemInfo.registration")}
            </dt>
            <dd className="text-lg font-medium text-[var(--text-primary)]">
              {systemInfo.registrationEnabled
                ? t("admin:systemInfo.enabled")
                : t("admin:systemInfo.disabled")}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-[var(--text-muted)]">{t("admin:systemInfo.version")}</dt>
            <dd className="text-lg font-medium text-[var(--text-primary)]">{systemInfo.version}</dd>
          </div>
        </dl>
      </div>

      {/* Actions */}
      <div className="bg-[var(--bg-surface)] rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
          {t("admin:systemInfo.dataManagement")}
        </h2>
        <button
          onClick={onExportData}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition"
        >
          Download Full Backup (JSON)
        </button>
        <p className="text-sm text-[var(--text-muted)] mt-2">
          Export all user data for backup purposes (GDPR compliant)
        </p>
        <InlineHelp
          title="Daten-Export"
          category="advanced"
          content={
            <div className="space-y-2 mt-2">
              <p>Exportieren Sie alle Benutzerdaten als JSON-Datei für Backup-Zwecke.</p>
              <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
                <li>
                  <strong>Vollständiger Export:</strong> Enthält alle Flüge, Achievements,
                  Einstellungen und Benutzerdaten
                </li>
                <li>
                  <strong>GDPR-konform:</strong> Alle Daten werden in einem strukturierten Format
                  exportiert
                </li>
                <li>
                  <strong>Backup:</strong> Regelmäßige Exports werden empfohlen, um Datenverlust zu
                  vermeiden
                </li>
                <li>
                  <strong>Format:</strong> JSON-Datei, die einfach importiert oder analysiert werden
                  kann
                </li>
              </ul>
            </div>
          }
        />
      </div>
    </div>
  );
}
