import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useToastStore } from "../store/toastStore";
import { adminApi } from "../lib/api";
import axios from "axios";
import { logger } from "../lib/logger";
import NavigationBar from "../components/NavigationBar";
import { useDomainTabs } from "../hooks/useDomainTabs";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { DOMAINS } from "../shared/domains";
import BackupManagement from "../components/Admin/BackupManagement";
import InstanceSettings from "../components/Admin/InstanceSettings";
import UsageStatsSettings from "../components/Admin/UsageStatsSettings";
import WebDAVSettings from "../components/Admin/WebDAVSettings";
import SystemInfoTab from "../components/Admin/SystemInfo";
import UserManagement from "../components/Admin/UserManagement";
import InvitationManagement from "../components/Admin/InvitationManagement";
import CreateLinkInviteModal from "../components/Admin/CreateLinkInviteModal";
import CreateEmailInviteModal from "../components/Admin/CreateEmailInviteModal";
import InviteSuccessModal from "../components/Admin/InviteSuccessModal";
import GlobalApiKeysManager from "../components/Admin/GlobalApiKeysManager";
import ImmichGlobalSettings from "../components/Admin/ImmichGlobalSettings";
import ParserSettingsTab from "../components/Admin/ParserSettings";
import LoggingManager from "../components/Admin/LoggingManager";
import SmtpManager from "../components/Admin/SmtpManager";
import ShipsSection from "../components/Admin/masterData/ShipsSection";
import PortsSection from "../components/Admin/masterData/PortsSection";
import AirlinesSection from "../components/Admin/masterData/AirlinesSection";
import AircraftSection from "../components/Admin/masterData/AircraftSection";
import AirportsSection from "../components/Admin/masterData/AirportsSection";
import { useTranslation } from "../hooks/useTranslation";
import { copyToClipboard } from "../lib/clipboard";
import { normalizeSectionId } from "../lib/sectionAliases";

import type { SystemInfoData, AdminUser } from "../components/Admin/SystemInfo";
import type { Invitation } from "../components/Admin/InvitationManagement";
import type { GlobalApiKeys, ParserApiKeySettings } from "../components/Admin/GlobalApiKeysManager";
import type { ParserSettingsData } from "../components/Admin/ParserSettings";
import type { LoggingConfig, LogFile, LogStats } from "../components/Admin/LoggingManager";

// ==================== Helpers ====================

interface ApiErrorResponse {
  error?: string;
  message?: string;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError<ApiErrorResponse>(error)) {
    return error.response?.data?.error || error.response?.data?.message || fallback;
  }
  return fallback;
}

type ActiveSection =
  | "users"
  | "invitations"
  | "system"
  | "instance"
  | "parsers"
  | "logging"
  | "backups"
  | "externalServices"
  | "smtp"
  | "shipsMasterData"
  | "portsMasterData"
  | "airlinesMasterData"
  | "aircraftMasterData"
  | "airportsMasterData";

type TabId = "general" | "flight" | "cruise";

// Which tab each admin section belongs to. Everything falls in "general"
// unless it's inherently domain-specific. The parser config (Ollama URL /
// model, OCR/regex defaults) is cross-domain — the cruise parser depends on
// the same Ollama endpoint as flights — so it lives under "general", not
// "flight" (where cruise-only users never found it; see issue #129).
// Master data is one sub-section per catalogue — ships and ports under the
// cruise tab, airlines / aircraft / airports under the flight tab. They used
// to be two combined pages ("Schiffe & Häfen", "Airlines & Flugzeuge") that
// stacked every catalogue on one screen; the lists are long enough that
// finding anything meant scrolling past the one above it. Old deep links
// still resolve — see sectionAliases.
const TAB_FOR_SECTION: Record<ActiveSection, TabId> = {
  system: "general",
  instance: "general",
  users: "general",
  invitations: "general",
  externalServices: "general",
  logging: "general",
  backups: "general",
  smtp: "general",
  parsers: "general",
  shipsMasterData: "cruise",
  portsMasterData: "cruise",
  airlinesMasterData: "flight",
  aircraftMasterData: "flight",
  airportsMasterData: "flight",
};

// ==================== Admin Page Component ====================

export default function AdminPage(): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);
  const addToast = useToastStore((state) => state.addToast);
  const [searchParams, setSearchParams] = useSearchParams();

  // State
  const [systemInfo, setSystemInfo] = useState<SystemInfoData | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [parserSettings, setParserSettings] = useState<ParserSettingsData | null>(null);
  const [loggingConfig, setLoggingConfig] = useState<LoggingConfig | null>(null);
  const [logFiles, setLogFiles] = useState<LogFile[]>([]);
  const [logStats, setLogStats] = useState<LogStats | null>(null);
  const [loading, setLoading] = useState(true);
  // Tab state + URL sync + drift guard live in the shared useDomainTabs
  // hook. Filtered by enabledDomains, URL param "tab", activeTab resets
  // to "general" if its domain gets disabled mid-session.
  // The admin "Flug" tab was dropped once its only section (parser config)
  // moved to "Allgemein" — an empty domain tab is worse UX than none. It's
  // back now that airlineAircraftMasterData gives it a real section again.
  const { tabs, activeTab, setActiveTab } = useDomainTabs<TabId>({
    tabConfig: [
      { id: "general", label: t("admin:tabs2.general") || "Allgemein" },
      {
        id: "flight",
        label: t("admin:tabs2.flight") || "Flug",
        icon: DOMAINS.flight.icon,
        requiresDomain: "flight",
      },
      {
        id: "cruise",
        label: t("admin:tabs2.cruise") || "Kreuzfahrt",
        icon: DOMAINS.cruise.icon,
        requiresDomain: "cruise",
      },
    ],
    defaultTab: "general",
  });

  // Reflect the current tab in the browser tab / history entry so users
  // navigating via Ctrl+Tab or browser history can tell admin tabs apart.
  const activeTabLabel = tabs.find((tab) => tab.id === activeTab)?.label ?? "";
  useDocumentTitle(
    activeTabLabel
      ? `TravStats – ${t("admin:title", { defaultValue: "Admin" })} – ${activeTabLabel}`
      : null
  );

  const initialSectionParam = normalizeSectionId(
    searchParams.get("section")
  ) as ActiveSection | null;
  const [activeSection, setActiveSection] = useState<ActiveSection>(
    initialSectionParam && TAB_FOR_SECTION[initialSectionParam] === activeTab
      ? initialSectionParam
      : "system"
  );
  const [inviteLinkModalOpen, setInviteLinkModalOpen] = useState(false);
  const [inviteEmailModalOpen, setInviteEmailModalOpen] = useState(false);
  const [inviteCreating, setInviteCreating] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState<{
    inviteUrl: string;
    emailSent: boolean | undefined;
    emailError: string | null;
    recipientEmail: string | null;
  } | null>(null);
  const [invitationStatusFilter, setInvitationStatusFilter] = useState<
    "all" | "active" | "used" | "expired"
  >("active");
  const [savingParsers, setSavingParsers] = useState(false);
  const [savingLogging, setSavingLogging] = useState(false);
  const [globalApiKeys, setGlobalApiKeys] = useState<GlobalApiKeys | null>(null);
  const [savingGlobalApiKeys, setSavingGlobalApiKeys] = useState(false);
  const [ollamaTestState, setOllamaTestState] = useState<{
    status: "idle" | "loading" | "ok" | "error" | "warn";
    message?: string;
  }>({ status: "idle" });

  // ==================== Data Loading ====================

  useEffect(() => {
    loadData();
  }, [invitationStatusFilter]);

  useEffect(() => {
    if (activeSection === "logging") {
      loadLoggingData();
    } else if (activeSection === "externalServices") {
      if (!globalApiKeys) {
        loadGlobalApiKeys();
      }
      if (!parserSettings) {
        loadData();
      }
    }
  }, [activeSection]);

  const loadData = async (): Promise<void> => {
    setLoading(true);
    try {
      const [infoData, usersData, invitationsData, parserData] = await Promise.all([
        adminApi.getSystemInfo(),
        adminApi.getUsers(),
        adminApi.getInvitations(invitationStatusFilter),
        adminApi.getAdminParserSettings(),
      ]);
      setSystemInfo(infoData as SystemInfoData);
      setUsers(usersData.users);
      setInvitations(invitationsData.invitations);
      setParserSettings(parserData);
    } catch (error) {
      logger.error("Failed to load admin data:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadGlobalApiKeys = async (): Promise<void> => {
    try {
      const data = await adminApi.getGlobalApiKeys();
      setGlobalApiKeys(data);
    } catch (error) {
      logger.error("Failed to load global API keys:", error);
    }
  };

  const loadLoggingData = async (): Promise<void> => {
    try {
      const [configData, filesData, statsData] = await Promise.all([
        adminApi.getLoggingConfig(),
        adminApi.getLogFiles(),
        adminApi.getLogStats(),
      ]);
      setLoggingConfig(configData);
      setLogFiles(filesData.files);
      setLogStats(statsData);
    } catch (error) {
      logger.error("Failed to load logging data:", error);
    }
  };

  // ==================== Handlers ====================

  const handleToggleUserActive = async (userId: string): Promise<void> => {
    try {
      await adminApi.toggleUserActive(userId);
      addToast("success", t("admin:toasts.userUpdated"));
      await loadData();
    } catch (error: unknown) {
      addToast("error", getErrorMessage(error, t("admin:toasts.userUpdateFailed")));
    }
  };

  const handleDeleteUser = async (userId: string): Promise<void> => {
    try {
      await adminApi.deleteUser(userId);
      addToast("success", t("admin:toasts.userDeleted"));
      await loadData();
    } catch (error: unknown) {
      addToast("error", getErrorMessage(error, t("admin:toasts.userDeleteFailed")));
    }
  };

  const handleCreateLinkInvitation = async (expiresInDays: 1 | 7 | 30): Promise<void> => {
    setInviteCreating(true);
    try {
      const { inviteUrl } = await adminApi.createLinkInvitation(expiresInDays);
      setInviteLinkModalOpen(false);
      setInviteSuccess({
        inviteUrl,
        emailSent: undefined,
        emailError: null,
        recipientEmail: null,
      });
      await loadData();
    } catch (error: unknown) {
      addToast("error", getErrorMessage(error, t("admin:toasts.invitationFailed")));
    } finally {
      setInviteCreating(false);
    }
  };

  const handleCreateEmailInvitation = async (
    email: string,
    expiresInDays: 1 | 7 | 30
  ): Promise<void> => {
    setInviteCreating(true);
    try {
      const { inviteUrl, emailSent, emailError } = await adminApi.createEmailInvitation(
        email,
        expiresInDays
      );
      setInviteEmailModalOpen(false);
      setInviteSuccess({ inviteUrl, emailSent, emailError, recipientEmail: email });
      await loadData();
    } catch (error: unknown) {
      addToast("error", getErrorMessage(error, t("admin:toasts.invitationFailed")));
    } finally {
      setInviteCreating(false);
    }
  };

  const handleCopyInvitationLink = async (invitation: Invitation): Promise<void> => {
    const frontendOrigin = window.location.origin;
    const inviteUrl = `${frontendOrigin}/register?token=${invitation.token}`;
    try {
      await copyToClipboard(inviteUrl);
      addToast("success", t("admin:invitations.success.copiedToClipboard"));
    } catch {
      addToast("error", t("admin:invitations.success.copyFailed"));
    }
  };

  const handleResendInvitationEmail = async (invitation: Invitation): Promise<void> => {
    try {
      const { emailSent, emailError } = await adminApi.resendInvitationEmail(invitation.id);
      if (emailSent) {
        addToast("success", t("admin:invitations.toasts.resent"));
      } else {
        addToast("error", `${t("admin:invitations.toasts.resendFailed")}: ${emailError ?? ""}`);
      }
      await loadData();
    } catch (error: unknown) {
      addToast("error", getErrorMessage(error, t("admin:invitations.toasts.resendFailed")));
    }
  };

  const handleRevokeInvitation = async (id: string): Promise<void> => {
    try {
      await adminApi.revokeInvitation(id);
      addToast("success", t("admin:invitations.toasts.revoked"));
      await loadData();
    } catch (error: unknown) {
      addToast("error", getErrorMessage(error, t("admin:invitations.toasts.revokeFailed")));
    }
  };

  const handleExportData = async (): Promise<void> => {
    if (!confirm(t("admin:prompts.confirmExport"))) {
      return;
    }
    try {
      const data = await adminApi.exportAllData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `travstats-backup-${new Date().toISOString()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error: unknown) {
      addToast("error", getErrorMessage(error, t("admin:toasts.exportFailed")));
    }
  };

  const handleSaveGlobalApiKeys = async (): Promise<void> => {
    setSavingGlobalApiKeys(true);
    setSavingParsers(true);
    try {
      await Promise.all([
        adminApi.updateGlobalApiKeys(globalApiKeys || {}),
        adminApi.updateAdminParserSettings({
          allowUserApiKeys: parserSettings?.allowUserApiKeys,
        }),
      ]);
      addToast("success", t("admin:globalApiKeys.saved") || "API keys saved successfully");
      await loadGlobalApiKeys();
      if (parserSettings) {
        const parserData = await adminApi.getAdminParserSettings();
        setParserSettings(parserData);
      }
    } catch (error: unknown) {
      logger.error("Failed to save API keys:", error);
      addToast(
        "error",
        getErrorMessage(error, t("admin:globalApiKeys.saveFailed") || "Failed to save API keys")
      );
    } finally {
      setSavingGlobalApiKeys(false);
      setSavingParsers(false);
    }
  };

  const handleSaveParserSettings = async (): Promise<void> => {
    if (!parserSettings) return;
    setSavingParsers(true);
    try {
      await adminApi.updateAdminParserSettings(parserSettings);
      addToast("success", t("admin:toasts.parserSettingsSaved"));
    } catch (error: unknown) {
      logger.error("Failed to save parser settings:", error);
      addToast("error", getErrorMessage(error, t("admin:toasts.parserSettingsFailed")));
    } finally {
      setSavingParsers(false);
    }
  };

  const handleTestOllama = async (): Promise<void> => {
    if (!parserSettings?.ollamaUrl || !parserSettings?.ollamaModel) return;
    setOllamaTestState({ status: "loading" });
    try {
      const result = await adminApi.testOllamaConnection(
        parserSettings.ollamaUrl,
        parserSettings.ollamaModel
      );
      if (result.success) {
        const modelCount = result.models?.length ?? 0;
        if (result.warning) {
          setOllamaTestState({
            status: "warn",
            message: `${result.warning} — ${t("admin:parserSettings.ollama.modelsAvailable")}: ${result.models?.join(", ")}`,
          });
        } else {
          setOllamaTestState({
            status: "ok",
            message: t("admin:toasts.ollamaTestSuccess", { count: modelCount }),
          });
        }
      } else {
        setOllamaTestState({ status: "error", message: result.error });
      }
    } catch (error: unknown) {
      setOllamaTestState({
        status: "error",
        message: getErrorMessage(error, t("admin:toasts.ollamaTestFailed")),
      });
    }
  };

  const handleToggleDebugLogging = async (): Promise<void> => {
    if (!loggingConfig) return;
    const newState = loggingConfig.logLevel !== "debug";
    try {
      await adminApi.toggleDebugLogging(newState);
      await loadLoggingData();
      addToast(
        "success",
        t("admin:toasts.debugLoggingToggled", {
          state: newState ? t("admin:toasts.enabled") : t("admin:toasts.disabled"),
        })
      );
    } catch (error: unknown) {
      logger.error("Failed to toggle debug logging:", error);
      addToast("error", getErrorMessage(error, t("admin:toasts.debugLoggingFailed")));
    }
  };

  const handleSaveLoggingConfig = async (): Promise<void> => {
    if (!loggingConfig) return;
    setSavingLogging(true);
    try {
      await adminApi.updateLoggingConfig(loggingConfig);
      addToast("success", t("admin:toasts.loggingConfigSaved"));
      await loadLoggingData();
    } catch (error: unknown) {
      logger.error("Failed to save logging config:", error);
      addToast("error", getErrorMessage(error, t("admin:toasts.loggingConfigFailed")));
    } finally {
      setSavingLogging(false);
    }
  };

  const handleDownloadLogFile = async (filename: string): Promise<void> => {
    try {
      const blob = await adminApi.downloadLogFile(filename);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error: unknown) {
      logger.error("Failed to download log file:", error);
      addToast("error", getErrorMessage(error, t("admin:toasts.logFileDownloadFailed")));
    }
  };

  const handleDeleteLogFile = async (filename: string): Promise<void> => {
    if (!confirm(t("admin:prompts.confirmDeleteLog", { filename }))) {
      return;
    }
    try {
      await adminApi.deleteLogFile(filename);
      addToast("success", t("admin:toasts.logFileDeleted"));
      await loadLoggingData();
    } catch (error: unknown) {
      logger.error("Failed to delete log file:", error);
      addToast("error", getErrorMessage(error, t("admin:toasts.logFileDeletFailed")));
    }
  };

  const handleCleanupLogs = async (): Promise<void> => {
    if (!confirm(t("admin:prompts.confirmCleanupLogs"))) {
      return;
    }
    try {
      const result = await adminApi.cleanupLogs();
      addToast(
        "success",
        t("admin:toasts.cleanupComplete", {
          filesDeleted: result.filesDeleted,
          spaceFreed: (result.spaceFreed / 1024 / 1024).toFixed(2),
        })
      );
      await loadLoggingData();
    } catch (error: unknown) {
      logger.error("Failed to cleanup logs:", error);
      addToast("error", getErrorMessage(error, t("admin:toasts.cleanupFailed")));
    }
  };

  // ==================== Sections + Tab/Section Sync ====================

  interface AdminSection {
    id: ActiveSection;
    label: string;
    badge?: number;
  }

  const allSections: AdminSection[] = [
    { id: "system", label: t("admin:tabs.system") },
    { id: "instance", label: t("admin:tabs.instance") },
    { id: "users", label: t("admin:tabs.users"), badge: users.length },
    { id: "invitations", label: t("admin:tabs.invitations") },
    { id: "externalServices", label: t("admin:tabs.externalServices") },
    { id: "parsers", label: t("admin:tabs.parsers") },
    { id: "logging", label: t("admin:tabs.logging") },
    { id: "backups", label: t("admin:tabs.backups") },
    { id: "smtp", label: t("admin:tabs.smtp") },
    {
      id: "shipsMasterData",
      label: t("admin:cruiseMasterData.ship.menuLabel") || "Schiffe",
    },
    {
      id: "portsMasterData",
      label: t("admin:cruiseMasterData.port.menuLabel") || "Häfen",
    },
    {
      id: "airlinesMasterData",
      label: t("admin:airlineAircraftMasterData.airline.menuLabel") || "Airlines",
    },
    {
      id: "aircraftMasterData",
      label: t("admin:airlineAircraftMasterData.aircraft.menuLabel") || "Flugzeuge",
    },
    {
      id: "airportsMasterData",
      label: t("admin:airlineAircraftMasterData.airport.menuLabel") || "Flughäfen",
    },
  ];

  const sections = allSections.filter((s) => TAB_FOR_SECTION[s.id] === activeTab);
  const firstSectionId = sections[0]?.id;

  // Keep activeSection valid when switching tabs: fall back to first
  // section of the new tab if the current one belongs to a different
  // tab, or if toggling a domain off drops the section entirely. The
  // useDomainTabs hook already guards activeTab; this effect is
  // purely about the section half.
  //
  // Kept above the `if (loading)` early-return so React sees the same
  // hook order on every render (rules-of-hooks).
  useEffect(() => {
    if (TAB_FOR_SECTION[activeSection] !== activeTab) {
      if (firstSectionId) setActiveSection(firstSectionId);
    }
  }, [activeTab, activeSection, firstSectionId]);

  // Bundle tab + section writes into one setSearchParams call. React
  // Router doesn't sequence functional updates across effects, so two
  // separate writes would race and one would drop the other's key. See
  // useDomainTabs for the detailed rationale.
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", activeTab);
        next.set("section", activeSection);
        return next;
      },
      { replace: true }
    );
  }, [activeTab, activeSection, setSearchParams]);

  // ==================== Render ====================

  if (loading) {
    return (
      <div
        className="min-h-screen"
        style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}
      >
        <NavigationBar />
        <div className="flex items-center justify-center min-h-[calc(100vh-4rem)]">Admin Panel</div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen"
      style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}
    >
      <NavigationBar />

      {/* Top tab bar — same pattern as SettingsPage (commit fbbcd13) */}
      <div
        className="px-4 pt-3"
        style={{ background: "var(--bg-base)", borderBottom: "1px solid var(--color-border)" }}
      >
        <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto overflow-y-hidden whitespace-nowrap">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={(): void => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-(--accent) text-(--accent)"
                  : "border-transparent text-(--text-secondary) hover:text-(--text-primary)"
              }`}
            >
              {tab.icon && (
                <span className="mr-1.5" aria-hidden>
                  {tab.icon}
                </span>
              )}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Mobile section picker — mirrors SettingsPage; the desktop
          sidebar takes over from md upward. */}
      <div
        className="md:hidden px-4 py-2 sticky top-0 z-10"
        style={{
          background: "var(--bg-base)",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <label htmlFor="admin-section-picker" className="sr-only">
          {t("admin:sectionPicker", { defaultValue: "Bereich" })}
        </label>
        <select
          id="admin-section-picker"
          value={activeSection}
          onChange={(e): void => setActiveSection(e.target.value as ActiveSection)}
          className="input w-full"
        >
          {sections.map((section) => (
            <option key={section.id} value={section.id}>
              {section.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex md:h-[calc(100vh-3.5rem-2.75rem)]">
        {/* Sidebar */}
        <aside
          className="w-52 shrink-0 flex-col py-4 overflow-y-auto hidden md:flex"
          style={{
            background: "var(--bg-surface)",
            borderRight: "1px solid var(--color-border)",
          }}
        >
          <div className="px-4 pb-3 mb-1" style={{ borderBottom: "1px solid var(--color-border)" }}>
            <h1
              className="text-sm font-semibold uppercase tracking-wider"
              style={{ color: "var(--text-muted)" }}
            >
              {t("admin:title")}
            </h1>
          </div>
          <nav className="space-y-0.5 px-2 mt-2">
            {sections.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-between"
                style={{
                  background: activeSection === section.id ? "var(--bg-elevated)" : "transparent",
                  color: activeSection === section.id ? "var(--accent)" : "var(--text-secondary)",
                  borderLeft:
                    activeSection === section.id
                      ? "2px solid var(--accent)"
                      : "2px solid transparent",
                }}
              >
                <span>{section.label}</span>
                {section.badge !== undefined && (
                  <span
                    className="ml-1 px-1.5 py-0.5 text-xs rounded-full font-medium"
                    style={{
                      background: "var(--bg-base)",
                      color: "var(--text-muted)",
                    }}
                  >
                    {section.badge}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {activeSection === "shipsMasterData" && <ShipsSection />}

          {activeSection === "portsMasterData" && <PortsSection />}

          {activeSection === "airlinesMasterData" && <AirlinesSection />}

          {activeSection === "aircraftMasterData" && <AircraftSection />}

          {activeSection === "airportsMasterData" && <AirportsSection />}

          {activeSection === "system" && systemInfo && (
            <SystemInfoTab
              systemInfo={systemInfo}
              users={users}
              onExportData={handleExportData}
              onDeleteDemoUser={handleDeleteUser}
            />
          )}

          {activeSection === "users" && (
            <UserManagement
              users={users}
              onToggleUserActive={handleToggleUserActive}
              onDeleteUser={handleDeleteUser}
            />
          )}

          {activeSection === "invitations" && (
            <>
              <InvitationManagement
                invitations={invitations}
                statusFilter={invitationStatusFilter}
                onStatusFilterChange={setInvitationStatusFilter}
                onCreateLink={() => setInviteLinkModalOpen(true)}
                onCreateEmail={() => setInviteEmailModalOpen(true)}
                onCopyLink={handleCopyInvitationLink}
                onResendEmail={handleResendInvitationEmail}
                onRevoke={handleRevokeInvitation}
              />

              {inviteLinkModalOpen && (
                <CreateLinkInviteModal
                  onCreate={handleCreateLinkInvitation}
                  onClose={() => setInviteLinkModalOpen(false)}
                  creating={inviteCreating}
                />
              )}

              {inviteEmailModalOpen && (
                <CreateEmailInviteModal
                  onCreate={handleCreateEmailInvitation}
                  onClose={() => setInviteEmailModalOpen(false)}
                  creating={inviteCreating}
                />
              )}

              {inviteSuccess && (
                <InviteSuccessModal
                  inviteUrl={inviteSuccess.inviteUrl}
                  emailSent={inviteSuccess.emailSent}
                  emailError={inviteSuccess.emailError}
                  recipientEmail={inviteSuccess.recipientEmail}
                  onClose={() => setInviteSuccess(null)}
                />
              )}
            </>
          )}

          {activeSection === "externalServices" && (
            <>
              <GlobalApiKeysManager
                globalApiKeys={globalApiKeys}
                parserSettings={
                  parserSettings ? { allowUserApiKeys: parserSettings.allowUserApiKeys } : null
                }
                saving={savingGlobalApiKeys || savingParsers}
                onSave={handleSaveGlobalApiKeys}
                onGlobalApiKeysChange={setGlobalApiKeys}
                onParserSettingsChange={(apiKeySettings: ParserApiKeySettings) => {
                  if (parserSettings) {
                    setParserSettings({
                      ...parserSettings,
                      allowUserApiKeys: apiKeySettings.allowUserApiKeys,
                    });
                  }
                }}
              />
              <ImmichGlobalSettings />
            </>
          )}

          {activeSection === "parsers" && parserSettings && (
            <ParserSettingsTab
              parserSettings={parserSettings}
              savingParsers={savingParsers}
              onSave={handleSaveParserSettings}
              onParserSettingsChange={setParserSettings}
              onTestOllama={handleTestOllama}
              ollamaTestState={ollamaTestState}
            />
          )}

          {activeSection === "logging" && loggingConfig && (
            <LoggingManager
              loggingConfig={loggingConfig}
              logFiles={logFiles}
              logStats={logStats}
              savingLogging={savingLogging}
              onSave={handleSaveLoggingConfig}
              onToggleDebug={handleToggleDebugLogging}
              onDownload={handleDownloadLogFile}
              onDelete={handleDeleteLogFile}
              onCleanup={handleCleanupLogs}
              onLoggingConfigChange={setLoggingConfig}
            />
          )}

          {activeSection === "instance" && (
            <div className="space-y-6">
              <div
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 12,
                }}
              >
                <InstanceSettings />
              </div>
              <div
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 12,
                }}
              >
                <UsageStatsSettings />
              </div>
            </div>
          )}

          {activeSection === "backups" && (
            <div className="space-y-6">
              <BackupManagement />
              <div
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 12,
                }}
              >
                <WebDAVSettings />
              </div>
            </div>
          )}

          {activeSection === "smtp" && (
            <div
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: 12,
                padding: 24,
              }}
            >
              <SmtpManager />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
