import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useToastStore } from "../store/toastStore";
import { adminApi } from "../lib/api";
import axios from "axios";
import { logger } from "../lib/logger";
import AppShell from "../components/ui/AppShell";
import PageHeader from "../components/ui/PageHeader";
import AdminIndex from "../components/Admin/AdminIndex";
import { useDomainTabs } from "../hooks/useDomainTabs";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useSectionInView } from "../hooks/useSectionInView";
import { DOMAINS } from "../shared/domains";
import { useTranslation } from "../hooks/useTranslation";
import { copyToClipboard } from "../lib/clipboard";
import { normalizeSectionId } from "../lib/sectionAliases";
import type { ActiveSection, TabId } from "./Admin/adminSections";
import { TAB_FOR_SECTION, LAZY_ADMIN_SECTIONS } from "./Admin/adminSections";
import AdminSectionSwitch, {
  type AdminSectionSwitchProps,
  type InviteSuccessState,
} from "./Admin/AdminSectionSwitch";
import { LazySection, AdminSection } from "./Admin/LazySection";

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

  // Round 4 ("one page, anchor jumps", forgejo#… — tester feedback): every
  // section of the active tab renders at once now, so there is no single
  // "current section" state any more. `?section=` still names the one a
  // deep link should scroll to on mount — kept apart from the current tab,
  // like before, so a link into a DIFFERENT tab than the one in `?tab=`
  // (or the default) still lands nowhere rather than on the wrong tab's
  // section; that limitation predates this change.
  const initialSectionParam = normalizeSectionId(searchParams.get("section"));
  const deepLinkedSection: ActiveSection | null =
    initialSectionParam !== null &&
    TAB_FOR_SECTION[initialSectionParam as ActiveSection] === activeTab
      ? (initialSectionParam as ActiveSection)
      : null;

  const [inviteLinkModalOpen, setInviteLinkModalOpen] = useState(false);
  const [inviteEmailModalOpen, setInviteEmailModalOpen] = useState(false);
  const [inviteCreating, setInviteCreating] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState<InviteSuccessState | null>(null);
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

  const handleResetTwoFactor = async (userId: string): Promise<void> => {
    try {
      await adminApi.disableUserTwoFactor(userId);
      addToast("success", t("admin:toasts.twoFactorReset"));
      await loadData();
    } catch (error: unknown) {
      addToast("error", getErrorMessage(error, t("admin:toasts.twoFactorResetFailed")));
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

  // ==================== Sections + Navigation ====================

  interface AdminSectionMeta {
    id: ActiveSection;
    label: string;
    badge?: number;
  }

  const allSections: AdminSectionMeta[] = [
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

  // Which section is on screen, for the index to mark — the exact scroll-spy
  // Settings uses (see useSectionInView), reused rather than duplicated.
  const inView = useSectionInView(
    sections.map((s) => s.id),
    "admin"
  );

  // Scrolls a deep-linked `?section=` into view once the page has rendered
  // its sections. Keyed on `loading` rather than `[]`: on the very first
  // render the page is still showing the "Admin Panel" placeholder (see the
  // early return below), so `admin-<id>` does not exist in the DOM yet — an
  // empty dependency array would run this before there was anything to
  // scroll to. A later section jump is handled imperatively by `jump`
  // itself, and does not need a second effect keyed on the URL.
  useEffect(() => {
    if (loading || !deepLinkedSection) return;
    const el = document.getElementById(`admin-${deepLinkedSection}`);
    // Feature-checked: jsdom has no layout, so the method is absent there.
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [loading, deepLinkedSection]);

  // Tracks when the deep-linked section itself has actually mounted its real
  // content (a `LazySection` fires its `onVisible` for this — see the map
  // below). Wave C finding C1 (independent review, 2026-09-17): the effect
  // above scrolls using whatever height every section — INCLUDING the ones
  // above the target — happens to have at that moment, which for a lazy one
  // is only the placeholder until it has been near the viewport. Once the
  // target mounts, the page's layout has settled around it, so the scroll is
  // re-run to correct for whatever drifted while sections above it expanded.
  const [deepLinkTargetMounted, setDeepLinkTargetMounted] = useState(false);
  useEffect(() => {
    if (!deepLinkTargetMounted || !deepLinkedSection) return;
    const el = document.getElementById(`admin-${deepLinkedSection}`);
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [deepLinkTargetMounted, deepLinkedSection]);

  const jump = useCallback(
    (id: ActiveSection): void => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("tab", activeTab);
          next.set("section", id);
          return next;
        },
        { replace: true }
      );
      const el = document.getElementById(`admin-${id}`);
      if (el && typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ block: "start", behavior: "smooth" });
      }
    },
    [activeTab, setSearchParams]
  );

  // Keeps `?tab=` current on reload; `?section=` is only ever written by an
  // explicit `jump` (clicking an index entry), same division of labour as
  // SettingsPage's route + `jump`.
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", activeTab);
        return next;
      },
      { replace: true }
    );
  }, [activeTab, setSearchParams]);

  // ==================== Render ====================

  if (loading) {
    return (
      <AppShell width="list">
        <div className="flex min-h-[calc(100vh-12rem)] items-center justify-center">
          Admin Panel
        </div>
      </AppShell>
    );
  }

  const currentLabel = sections.find((s) => s.id === inView)?.label ?? sections[0]?.label ?? "";

  const switchProps: Omit<AdminSectionSwitchProps, "section"> = {
    systemInfo,
    users,
    onExportData: handleExportData,
    onDeleteUser: handleDeleteUser,
    onToggleUserActive: handleToggleUserActive,
    onResetTwoFactor: handleResetTwoFactor,
    invitations,
    invitationStatusFilter,
    onInvitationStatusFilterChange: setInvitationStatusFilter,
    onCreateLinkInvitation: handleCreateLinkInvitation,
    onCreateEmailInvitation: handleCreateEmailInvitation,
    onCopyInvitationLink: handleCopyInvitationLink,
    onResendInvitationEmail: handleResendInvitationEmail,
    onRevokeInvitation: handleRevokeInvitation,
    inviteLinkModalOpen,
    onOpenInviteLinkModal: () => setInviteLinkModalOpen(true),
    onCloseInviteLinkModal: () => setInviteLinkModalOpen(false),
    inviteEmailModalOpen,
    onOpenInviteEmailModal: () => setInviteEmailModalOpen(true),
    onCloseInviteEmailModal: () => setInviteEmailModalOpen(false),
    inviteCreating,
    inviteSuccess,
    onCloseInviteSuccess: () => setInviteSuccess(null),
    globalApiKeys,
    onGlobalApiKeysChange: setGlobalApiKeys,
    savingGlobalApiKeys,
    onSaveGlobalApiKeys: handleSaveGlobalApiKeys,
    onParserApiKeySettingsChange: (apiKeySettings: ParserApiKeySettings) => {
      if (parserSettings) {
        setParserSettings({
          ...parserSettings,
          allowUserApiKeys: apiKeySettings.allowUserApiKeys,
        });
      }
    },
    parserSettings,
    savingParsers,
    onSaveParserSettings: handleSaveParserSettings,
    onParserSettingsChange: setParserSettings,
    onTestOllama: handleTestOllama,
    ollamaTestState,
    loggingConfig,
    logFiles,
    logStats,
    savingLogging,
    onSaveLoggingConfig: handleSaveLoggingConfig,
    onToggleDebugLogging: handleToggleDebugLogging,
    onDownloadLogFile: handleDownloadLogFile,
    onDeleteLogFile: handleDeleteLogFile,
    onCleanupLogs: handleCleanupLogs,
    onLoggingConfigChange: setLoggingConfig,
  };

  // The two sections whose fetch used to be triggered by `activeSection`
  // becoming active now fire once, from LazySection's onVisible, instead —
  // everything else that needs deferred loading owns its own on-mount
  // fetch (see LAZY_ADMIN_SECTIONS).
  const sectionOnVisible: Partial<Record<ActiveSection, () => void>> = {
    logging: loadLoggingData,
    externalServices: () => {
      if (!globalApiKeys) loadGlobalApiKeys();
      if (!parserSettings) loadData();
    },
  };

  return (
    <AppShell width="list">
      <div
        className="grid md:grid-cols-[240px_minmax(0,1fr)]"
        style={{ gap: "var(--ts-space-xxl)" }}
      >
        <div className="hidden md:block">
          <AdminIndex
            tabs={tabs}
            activeTab={activeTab}
            onTab={(id) => setActiveTab(id as TabId)}
            sections={sections}
            activeSection={inView ?? ""}
            onSection={(id) => jump(id as ActiveSection)}
          />
        </div>

        <main className="flex min-w-0 flex-col" style={{ gap: "var(--ts-space-xl)" }}>
          {/* The scope line is the counterpart of the one in user settings:
              everything here is instance-wide. */}
          <PageHeader title={`${t("admin:title")} · ${currentLabel}`} meta={t("admin:scopeHint")} />

          {/* Phone: the area tabs and a section picker in place of the column. */}
          <div className="flex flex-col gap-3 md:hidden">
            {tabs.length > 1 && (
              <div className="flex gap-2 overflow-x-auto scrollbar-none">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    aria-pressed={activeTab === tab.id}
                    onClick={(): void => setActiveTab(tab.id)}
                    className="shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold"
                    style={{
                      background: activeTab === tab.id ? "var(--ts-accent)" : "transparent",
                      color:
                        activeTab === tab.id ? "var(--ts-accent-text)" : "var(--ts-text-bright)",
                      border: `1px solid ${activeTab === tab.id ? "var(--ts-accent)" : "var(--ts-border)"}`,
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            )}
            <label htmlFor="admin-section-picker" className="sr-only">
              {t("admin:sectionPicker", { defaultValue: "Bereich" })}
            </label>
            <select
              id="admin-section-picker"
              value={inView ?? sections[0]?.id ?? ""}
              onChange={(e): void => jump(e.target.value as ActiveSection)}
              className="input w-full"
            >
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.label}
                </option>
              ))}
            </select>
          </div>

          {/* Every section of the active tab renders at once now (tester
              feedback: the admin page should read like the settings page,
              with anchor jumps instead of a picker that swaps content out).
              A lazily-fetching section (see LAZY_ADMIN_SECTIONS) only mounts
              its real content once it has been near the viewport. */}
          {sections.map((section) =>
            LAZY_ADMIN_SECTIONS.has(section.id) ? (
              <LazySection
                key={section.id}
                id={`admin-${section.id}`}
                ariaLabel={section.label}
                onVisible={() => {
                  sectionOnVisible[section.id]?.();
                  if (section.id === deepLinkedSection) setDeepLinkTargetMounted(true);
                }}
              >
                <AdminSectionSwitch section={section.id} {...switchProps} />
              </LazySection>
            ) : (
              <AdminSection key={section.id} id={`admin-${section.id}`} ariaLabel={section.label}>
                <AdminSectionSwitch section={section.id} {...switchProps} />
              </AdminSection>
            )
          )}
        </main>
      </div>
    </AppShell>
  );
}
