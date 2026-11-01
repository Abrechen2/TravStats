import { parserOwnFields } from "../../components/Admin/parserOwnFields";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from "react";
import { useToastStore } from "../../store/toastStore";
import { adminApi } from "../../lib/api";
import { logger } from "../../lib/logger";
import { apiErrorMachineCode } from "../../lib/apiError";
import { resetHasLlmCache } from "../../hooks/useHasLlm";
import { useTranslation } from "../../hooks/useTranslation";
import { copyToClipboard } from "../../lib/clipboard";
import { useLoggingAdmin } from "./useLoggingAdmin";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import { LAZY_ADMIN_SECTIONS, type ActiveSection } from "./adminSections";
import AdminSectionSwitch, {
  type AdminSectionSwitchProps,
  type InviteSuccessState,
} from "./AdminSectionSwitch";
import { LazyBody } from "./LazySection";

import type { SystemInfoData, AdminUser } from "../../components/Admin/SystemInfo";
import type { Invitation } from "../../components/Admin/InvitationManagement";
import type { ParserSettingsData } from "../../components/Admin/ParserSettings";

// ==================== Helpers ====================

/**
 * The toast text for a failed admin call: the caller's own sentence in the
 * reader's language. Never the server's `error` field — that is English
 * prose written for a log, and printing it put English into the German page.
 * Sections that can tell failures apart map the server's stable `code`
 * themselves (the log section: `logErrorCopy`).
 */
function getErrorMessage(_error: unknown, fallback: string): string {
  return fallback;
}

// ==================== Admin Page Component ====================

// ==================== Admin host ====================

type SwitchProps = Omit<AdminSectionSwitchProps, "section">;

interface AdminHostValue {
  loading: boolean;
  switchProps: SwitchProps;
  onVisible: Partial<Record<ActiveSection, () => void>>;
}

const AdminHostContext = createContext<AdminHostValue | null>(null);

/**
 * The server's section components need what the old Administration page
 * loaded in one go — system info, accounts, invitations, parser settings —
 * and the handlers that change it. In the one settings area they sit on
 * several pages (Server, Nutzer, Dienste, ...), so that state lives here, once,
 * above whichever of them an admin has open (settings rebuild, package 1).
 * Mounted only for an admin and only on a page that has such a section, so a
 * person without the permission never asks the server for any of it.
 */
export function AdminHost({
  highlightUserId,
  children,
}: {
  /** `?user=` — a link that meant one account, not the table; a pointer, never state. */
  highlightUserId: string | null;
  children: ReactNode;
}): JSX.Element {
  const { t, i18n } = useTranslation(["admin", "common"]);
  const { confirm: askConfirm, confirmDialog } = useConfirmDialog();
  const addToast = useToastStore((state) => state.addToast);
  // State
  const [systemInfo, setSystemInfo] = useState<SystemInfoData | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [parserSettings, setParserSettings] = useState<ParserSettingsData | null>(null);
  // What the server last told this page; the Parser save diffs against it.
  const [parserLoaded, setParserLoaded] = useState<ParserSettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [inviteLinkModalOpen, setInviteLinkModalOpen] = useState(false);
  const [inviteEmailModalOpen, setInviteEmailModalOpen] = useState(false);
  const [inviteCreating, setInviteCreating] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState<InviteSuccessState | null>(null);
  const [invitationStatusFilter, setInvitationStatusFilter] = useState<
    "all" | "active" | "used" | "expired"
  >("active");
  const [savingParsers, setSavingParsers] = useState(false);
  const {
    loggingConfig,
    setLoggingConfig,
    logFiles,
    logStats,
    savingLogging,
    loadLoggingData,
    handleToggleDebugLogging,
    handleSaveLoggingConfig,
    handleDownloadLogFile,
    handleDeleteLogFile,
    handleCleanupLogs,
  } = useLoggingAdmin(t, addToast, askConfirm, i18n.language);
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
      setParserLoaded(parserData);
    } catch (error) {
      logger.error("Failed to load admin data:", error);
    } finally {
      setLoading(false);
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
    if (!(await askConfirm({ message: t("admin:prompts.confirmExport") }))) return;
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

  const handleSaveParserSettings = async (): Promise<void> => {
    if (!parserSettings) return;
    setSavingParsers(true);
    try {
      await adminApi.updateAdminParserSettings(parserOwnFields(parserSettings, parserLoaded));
      addToast("success", t("admin:toasts.parserSettingsSaved"));
      // Re-read: the key comes back masked and "is this a cloud endpoint" is
      // the server's answer for what was actually stored.
      const fresh = await adminApi.getAdminParserSettings();
      setParserSettings(fresh);
      setParserLoaded(fresh);
      // The KI-Parser row of Externe Dienste reads the parser's capabilities,
      // cached per tab; this save may have changed them.
      resetHasLlmCache();
    } catch (error: unknown) {
      logger.error("Failed to save parser settings:", error);
      const code = apiErrorMachineCode(error);
      addToast(
        "error",
        code === "LLM_BASE_URL_HTTPS_REQUIRED" || code === "LLM_BASE_URL_INVALID"
          ? t(`admin:parserSettings.provider.saveErrors.${code}`)
          : getErrorMessage(error, t("admin:toasts.parserSettingsFailed"))
      );
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

  const switchProps: SwitchProps = {
    systemInfo,
    users,
    onExportData: handleExportData,
    onDeleteUser: handleDeleteUser,
    onToggleUserActive: handleToggleUserActive,
    onResetTwoFactor: handleResetTwoFactor,
    highlightUserId,
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

  // The one section whose fetch used to be triggered by `activeSection`
  // becoming active fires once, from LazySection's onVisible, instead —
  // everything else that needs deferred loading owns its own on-mount fetch
  // (see LAZY_ADMIN_SECTIONS).
  const value = useMemo<AdminHostValue>(
    () => ({ loading, switchProps, onVisible: { logging: loadLoggingData } }),
    // switchProps is rebuilt every render on purpose: it carries handlers.
    [loading, switchProps]
  );

  return (
    <AdminHostContext.Provider value={value}>
      {children}
      {confirmDialog}
    </AdminHostContext.Provider>
  );
}

/** One server section, wired to the host above it. */
export function AdminSectionBody({ section }: { section: ActiveSection }): JSX.Element | null {
  const host = useContext(AdminHostContext);
  if (!host) return null;
  // The old page held back until the first load answered; each section does
  // now, so the page around it can draw at once.
  if (host.loading) return <div style={{ minHeight: 120 }} aria-busy="true" />;
  const body = <AdminSectionSwitch section={section} {...host.switchProps} />;
  return LAZY_ADMIN_SECTIONS.has(section) ? (
    <LazyBody id={`settings-${section}-body`} onVisible={host.onVisible[section]}>
      {body}
    </LazyBody>
  ) : (
    body
  );
}
