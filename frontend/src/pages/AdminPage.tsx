import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { Navigate, useLocation, useParams, useSearchParams } from "react-router-dom";
import { useToastStore } from "../store/toastStore";
import { adminApi } from "../lib/api";
import { logger } from "../lib/logger";
import { apiErrorMachineCode } from "../lib/apiError";
import AppShell from "../components/ui/AppShell";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useSectionInView } from "../hooks/useSectionInView";
import { useEnabledDomains } from "../hooks/useEnabledDomains";
import { useBetaFeatures } from "../hooks/useBetaFeatures";
import { useTranslation } from "../hooks/useTranslation";
import { useEffectiveSettingsLevel } from "../store/settingsLevelStore";
import { copyToClipboard } from "../lib/clipboard";
import { useLoggingAdmin } from "./Admin/useLoggingAdmin";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import {
  ADMIN_MENU,
  ADMIN_PAGES,
  LAZY_ADMIN_SECTIONS,
  findAdminPage,
  type ActiveSection,
  type AdminPageDef,
} from "./Admin/adminSections";
import AdminSectionSwitch, {
  ADMIN_SECTION_FRAME,
  type AdminSectionSwitchProps,
  type InviteSuccessState,
} from "./Admin/AdminSectionSwitch";
import { LazyBody } from "./Admin/LazySection";
import { useDeepLinkScroll } from "./Admin/useDeepLinkScroll";
import { resolveAdminLink } from "./Settings/settingsLinks";
import { pageLevel, sectionsOf } from "./Settings/surface";
import { SettingsLayout } from "../components/Settings/frame/SettingsLayout";
import { SectionFrame } from "../components/Settings/frame/SectionFrame";
import { ExpertNote, ExpertPageNotice } from "../components/Settings/frame/ExpertNote";
import { VersionLine } from "../components/Settings/frame/VersionLine";
import type { SettingsMenuGroup } from "../components/Settings/frame/SettingsMenu";
import { SettingsSearch } from "./Settings/SettingsSearch";
import { useSearchScopes } from "./Settings/useSearchScopes";

import type { SystemInfoData, AdminUser } from "../components/Admin/SystemInfo";
import type { Invitation } from "../components/Admin/InvitationManagement";
import type { GlobalApiKeys, ParserApiKeySettings } from "../components/Admin/GlobalApiKeysManager";
import type { ParserSettingsData } from "../components/Admin/ParserSettings";

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

export default function AdminPage(): JSX.Element {
  const { t, i18n } = useTranslation(["admin", "common"]);
  const { confirm: askConfirm, confirmDialog } = useConfirmDialog();
  const addToast = useToastStore((state) => state.addToast);
  const [searchParams, setSearchParams] = useSearchParams();
  // The sections column the deep-link aligner's ResizeObserver watches (see
  // the effect below) — any lazy section growing past its placeholder height
  // changes this element's size.
  const mainRef = useRef<HTMLDivElement>(null);

  // State
  const [systemInfo, setSystemInfo] = useState<SystemInfoData | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [parserSettings, setParserSettings] = useState<ParserSettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  // One page per menu entry (forgejo#321). Every address goes through
  // `resolveAdminLink` first — `/admin?tab=general&section=logging` and the
  // other pre-page links redirect to the canonical `/admin/<page>`.
  const params = useParams<{ page?: string }>();
  const location = useLocation();
  const { isEnabled } = useEnabledDomains();
  const { isFeatureVisible } = useBetaFeatures();
  const level = useEffectiveSettingsLevel();
  const searchScopes = useSearchScopes(true);
  const isReachable = useCallback(
    (p: AdminPageDef) => !p.domain || isEnabled(p.domain),
    [isEnabled]
  );
  const namedSection = searchParams.get("section");
  const canonical = resolveAdminLink({
    page: params.page,
    section: namedSection,
    tab: searchParams.get("tab"),
    user: searchParams.get("user"),
    expert: searchParams.get("expert") === "1",
    isReachable,
  });
  const target = new URL(canonical, "http://x");
  const isCanonical =
    target.pathname === location.pathname &&
    target.searchParams.get("section") === namedSection &&
    !searchParams.get("tab");
  const current = findAdminPage(params.page);
  const pageTitle = current ? t(current.labelKey) : "";
  useDocumentTitle(
    current ? `TravStats – ${t("admin:title", { defaultValue: "Admin" })} – ${pageTitle}` : null
  );
  const deepLinkedSection: ActiveSection | null =
    isCanonical && namedSection ? (namedSection as ActiveSection) : null;

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
      // Re-read: the key comes back masked and "is this a cloud endpoint" is
      // the server's answer for what was actually stored.
      setParserSettings(await adminApi.getAdminParserSettings());
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

  // ==================== Sections + Navigation ====================

  const visible = useMemo(
    () =>
      current
        ? sectionsOf(current, {
            // An expert page opened at the standard level — by a link, the
            // search or a bookmark — shows its sections, with a note above,
            // rather than an empty page.
            level: pageLevel(current) === "expert" ? "expert" : level,
            isGateOpen: isFeatureVisible,
            isAdmin: true,
            deepLinked: namedSection,
          })
        : { shown: [] as ActiveSection[], hiddenExpert: 0, deepLinkedExpert: null },
    [current, level, isFeatureVisible, namedSection]
  );

  // Which section is on screen, for the chips to mark — the scroll-spy
  // Settings uses (see useSectionInView), reused rather than duplicated.
  const inView = useSectionInView(visible.shown, "admin");

  // Scrolls a `?section=` deep link into view and keeps correcting that
  // position while the page's lazy sections are still settling — see
  // `useDeepLinkScroll`'s own doc comment for the two-round Wave C finding
  // C1 story (independent review, 2026-09-17, and its 2026-09-18 follow-up).
  useDeepLinkScroll(mainRef, loading, deepLinkedSection);

  const jump = useCallback(
    (id: string): void => {
      setSearchParams({ section: id }, { replace: true });
      const el = document.getElementById(`admin-${id}`);
      if (el && typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ block: "start", behavior: "smooth" });
      }
    },
    [setSearchParams]
  );

  // ==================== Render ====================

  if (!isCanonical || !current) return <Navigate to={canonical} replace />;

  if (loading) {
    return (
      <AppShell width="list">
        <div className="flex min-h-[calc(100vh-12rem)] items-center justify-center">
          Admin Panel
        </div>
      </AppShell>
    );
  }

  const switchProps: Omit<AdminSectionSwitchProps, "section"> = {
    systemInfo,
    users,
    onExportData: handleExportData,
    onDeleteUser: handleDeleteUser,
    onToggleUserActive: handleToggleUserActive,
    onResetTwoFactor: handleResetTwoFactor,
    // `?user=` — a link that meant one account, not the table. Read here
    // beside `?tab=`/`?section=`, which is where this page already keeps its
    // URL reading, and never written back: it is a pointer, not state.
    highlightUserId: searchParams.get("user"),
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

  const inMenu = (p: AdminPageDef): boolean =>
    level === "expert" || pageLevel(p) === "standard" || p.id === current.id;
  const reachable = ADMIN_PAGES.filter(isReachable);
  const groups: SettingsMenuGroup[] = ADMIN_MENU.map((g) => ({
    id: g.id,
    label: g.labelKey ? t(g.labelKey) : null,
    entries: reachable
      .filter((p) => g.pages.includes(p.id) && inMenu(p))
      .map((p) => ({
        id: p.id,
        label: t(p.labelKey),
        to: `/admin/${p.id}`,
        icon: p.icon,
        badge: p.id === "users" ? users.length : undefined,
      })),
  })).filter((g) => g.entries.length > 0);
  const hiddenPages = reachable.filter((p) => !inMenu(p)).length;
  const labelOf = (id: ActiveSection): string =>
    t(current.sections.find((s) => s.id === id)?.labelKey ?? id);
  const isExpertPage = pageLevel(current) === "expert" && level === "standard";

  return (
    <>
      <SettingsLayout
        navLabel={t("admin:title", { defaultValue: "Administration" })}
        groups={groups}
        activePage={current.id}
        hiddenPages={hiddenPages}
        search={<SettingsSearch scopes={searchScopes} />}
        menuFooter={<VersionLine />}
        title={pageTitle}
        // The scope line is the counterpart of the one in user settings:
        // everything here is instance-wide.
        meta={t("admin:scopeHint")}
        chips={visible.shown.map((id) => ({ id, label: labelOf(id) }))}
        anchorPrefix="admin"
        activeSection={inView}
        onJump={jump}
        notice={isExpertPage ? <ExpertPageNotice /> : null}
      >
        <div ref={mainRef} className="flex min-w-0 flex-col" style={{ gap: "var(--ts-space-xl)" }}>
          {visible.shown.map((id, index) => {
            const body = <AdminSectionSwitch section={id} {...switchProps} />;
            return (
              <SectionFrame
                key={id}
                anchorId={`admin-${id}`}
                headingAbove={index === 0 ? pageTitle : null}
                label={labelOf(id)}
                frame={ADMIN_SECTION_FRAME[id]}
                deepLinkedExpert={visible.deepLinkedExpert === id && !isExpertPage}
                revealExpertRows={namedSection === id && searchParams.get("expert") === "1"}
              >
                {/* A lazily-fetching section (see LAZY_ADMIN_SECTIONS) mounts its
                    body only once it has been near the viewport. */}
                {LAZY_ADMIN_SECTIONS.has(id) ? (
                  <LazyBody id={`admin-${id}-body`} onVisible={sectionOnVisible[id]}>
                    {body}
                  </LazyBody>
                ) : (
                  body
                )}
              </SectionFrame>
            );
          })}
          <ExpertNote count={visible.hiddenExpert} />
        </div>
      </SettingsLayout>
      {confirmDialog}
    </>
  );
}
