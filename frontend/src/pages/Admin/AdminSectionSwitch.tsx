import type { JSX } from "react";
import BackupManagement from "../../components/Admin/BackupManagement";
import InstanceSettings from "../../components/Admin/InstanceSettings";
import UsageStatsSettings from "../../components/Admin/UsageStatsSettings";
import WebDAVSettings from "../../components/Admin/WebDAVSettings";
import SystemInfoTab from "../../components/Admin/SystemInfo";
import UserManagement from "../../components/Admin/UserManagement";
import InvitationManagement from "../../components/Admin/InvitationManagement";
import CreateLinkInviteModal from "../../components/Admin/CreateLinkInviteModal";
import CreateEmailInviteModal from "../../components/Admin/CreateEmailInviteModal";
import InviteSuccessModal from "../../components/Admin/InviteSuccessModal";
import GlobalApiKeysManager from "../../components/Admin/GlobalApiKeysManager";
import ImmichGlobalSettings from "../../components/Admin/ImmichGlobalSettings";
import ParserSettingsTab from "../../components/Admin/ParserSettings";
import LoggingManager from "../../components/Admin/LoggingManager";
import SmtpManager from "../../components/Admin/SmtpManager";
import ShipsSection from "../../components/Admin/masterData/ShipsSection";
import PortsSection from "../../components/Admin/masterData/PortsSection";
import AirlinesSection from "../../components/Admin/masterData/AirlinesSection";
import AircraftSection from "../../components/Admin/masterData/AircraftSection";
import AirportsSection from "../../components/Admin/masterData/AirportsSection";
import type { ActiveSection } from "./adminSections";

import type { SystemInfoData, AdminUser } from "../../components/Admin/SystemInfo";
import type { Invitation } from "../../components/Admin/InvitationManagement";
import type {
  GlobalApiKeys,
  ParserApiKeySettings,
} from "../../components/Admin/GlobalApiKeysManager";
import type { ParserSettingsData } from "../../components/Admin/ParserSettings";
import type { LoggingConfig, LogFile, LogStats } from "../../components/Admin/LoggingManager";

export interface InviteSuccessState {
  inviteUrl: string;
  emailSent: boolean | undefined;
  emailError: string | null;
  recipientEmail: string | null;
}

export interface OllamaTestState {
  status: "idle" | "loading" | "ok" | "error" | "warn";
  message?: string;
}

/**
 * Everything a section's JSX reads, gathered in one bag so AdminPage keeps
 * its state declarations and this file is only about wiring — the part that
 * grows with every new admin setting. Mirrors `SettingsSectionSwitch`'s
 * `page` prop; Admin has no equivalent `useAdminPage` hook to pass instead,
 * so the bag is a plain interface built at the call site.
 */
export interface AdminSectionSwitchProps {
  section: ActiveSection;

  // system
  systemInfo: SystemInfoData | null;
  users: AdminUser[];
  onExportData: () => void;
  onDeleteUser: (userId: string) => void;

  // users
  onToggleUserActive: (userId: string) => void;
  onResetTwoFactor: (userId: string) => void;

  // invitations
  invitations: Invitation[];
  invitationStatusFilter: "all" | "active" | "used" | "expired";
  onInvitationStatusFilterChange: (filter: "all" | "active" | "used" | "expired") => void;
  onCreateLinkInvitation: (expiresInDays: 1 | 7 | 30) => void;
  onCreateEmailInvitation: (email: string, expiresInDays: 1 | 7 | 30) => void;
  onCopyInvitationLink: (invitation: Invitation) => void;
  onResendInvitationEmail: (invitation: Invitation) => void;
  onRevokeInvitation: (id: string) => void;
  inviteLinkModalOpen: boolean;
  onOpenInviteLinkModal: () => void;
  onCloseInviteLinkModal: () => void;
  inviteEmailModalOpen: boolean;
  onOpenInviteEmailModal: () => void;
  onCloseInviteEmailModal: () => void;
  inviteCreating: boolean;
  inviteSuccess: InviteSuccessState | null;
  onCloseInviteSuccess: () => void;

  // externalServices
  globalApiKeys: GlobalApiKeys | null;
  onGlobalApiKeysChange: (keys: GlobalApiKeys) => void;
  savingGlobalApiKeys: boolean;
  onSaveGlobalApiKeys: () => void;
  onParserApiKeySettingsChange: (settings: ParserApiKeySettings) => void;

  // parsers
  parserSettings: ParserSettingsData | null;
  savingParsers: boolean;
  onSaveParserSettings: () => void;
  onParserSettingsChange: (settings: ParserSettingsData) => void;
  onTestOllama: () => void;
  ollamaTestState: OllamaTestState;

  // logging
  loggingConfig: LoggingConfig | null;
  logFiles: LogFile[];
  logStats: LogStats | null;
  savingLogging: boolean;
  onSaveLoggingConfig: () => void;
  onToggleDebugLogging: () => void;
  onDownloadLogFile: (filename: string) => void;
  onDeleteLogFile: (filename: string) => void;
  onCleanupLogs: () => void;
  onLoggingConfigChange: (config: LoggingConfig) => void;
}

/**
 * Renders one admin section's content. Kept apart from the page so the page
 * is about navigation and data loading, and this file is about wiring the
 * ~14 sections up — see SettingsSectionSwitch for the pattern this copies.
 */
export default function AdminSectionSwitch(props: AdminSectionSwitchProps): JSX.Element | null {
  switch (props.section) {
    case "shipsMasterData":
      return <ShipsSection />;

    case "portsMasterData":
      return <PortsSection />;

    case "airlinesMasterData":
      return <AirlinesSection />;

    case "aircraftMasterData":
      return <AircraftSection />;

    case "airportsMasterData":
      return <AirportsSection />;

    case "system":
      return props.systemInfo ? (
        <SystemInfoTab
          systemInfo={props.systemInfo}
          users={props.users}
          onExportData={props.onExportData}
          onDeleteDemoUser={props.onDeleteUser}
        />
      ) : null;

    case "users":
      return (
        <UserManagement
          users={props.users}
          onToggleUserActive={props.onToggleUserActive}
          onDeleteUser={props.onDeleteUser}
          onResetTwoFactor={props.onResetTwoFactor}
        />
      );

    case "invitations":
      return (
        <>
          <InvitationManagement
            invitations={props.invitations}
            statusFilter={props.invitationStatusFilter}
            onStatusFilterChange={props.onInvitationStatusFilterChange}
            onCreateLink={props.onOpenInviteLinkModal}
            onCreateEmail={props.onOpenInviteEmailModal}
            onCopyLink={props.onCopyInvitationLink}
            onResendEmail={props.onResendInvitationEmail}
            onRevoke={props.onRevokeInvitation}
          />

          {props.inviteLinkModalOpen && (
            <CreateLinkInviteModal
              onCreate={props.onCreateLinkInvitation}
              onClose={props.onCloseInviteLinkModal}
              creating={props.inviteCreating}
            />
          )}

          {props.inviteEmailModalOpen && (
            <CreateEmailInviteModal
              onCreate={props.onCreateEmailInvitation}
              onClose={props.onCloseInviteEmailModal}
              creating={props.inviteCreating}
            />
          )}

          {props.inviteSuccess && (
            <InviteSuccessModal
              inviteUrl={props.inviteSuccess.inviteUrl}
              emailSent={props.inviteSuccess.emailSent}
              emailError={props.inviteSuccess.emailError}
              recipientEmail={props.inviteSuccess.recipientEmail}
              onClose={props.onCloseInviteSuccess}
            />
          )}
        </>
      );

    case "externalServices":
      return (
        <>
          <GlobalApiKeysManager
            globalApiKeys={props.globalApiKeys}
            parserSettings={
              props.parserSettings
                ? { allowUserApiKeys: props.parserSettings.allowUserApiKeys }
                : null
            }
            saving={props.savingGlobalApiKeys || props.savingParsers}
            onSave={props.onSaveGlobalApiKeys}
            onGlobalApiKeysChange={props.onGlobalApiKeysChange}
            onParserSettingsChange={props.onParserApiKeySettingsChange}
          />
          <ImmichGlobalSettings />
        </>
      );

    case "parsers":
      return props.parserSettings ? (
        <ParserSettingsTab
          parserSettings={props.parserSettings}
          savingParsers={props.savingParsers}
          onSave={props.onSaveParserSettings}
          onParserSettingsChange={props.onParserSettingsChange}
          onTestOllama={props.onTestOllama}
          ollamaTestState={props.ollamaTestState}
        />
      ) : null;

    case "logging":
      return props.loggingConfig ? (
        <LoggingManager
          loggingConfig={props.loggingConfig}
          logFiles={props.logFiles}
          logStats={props.logStats}
          savingLogging={props.savingLogging}
          onSave={props.onSaveLoggingConfig}
          onToggleDebug={props.onToggleDebugLogging}
          onDownload={props.onDownloadLogFile}
          onDelete={props.onDeleteLogFile}
          onCleanup={props.onCleanupLogs}
          onLoggingConfigChange={props.onLoggingConfigChange}
        />
      ) : null;

    case "instance":
      return (
        <div className="space-y-6">
          <div
            style={{
              background: "var(--ts-surface)",
              border: "1px solid var(--ts-border)",
              borderRadius: "var(--ts-radius-card)",
            }}
          >
            <InstanceSettings />
          </div>
          <div
            style={{
              background: "var(--ts-surface)",
              border: "1px solid var(--ts-border)",
              borderRadius: "var(--ts-radius-card)",
            }}
          >
            <UsageStatsSettings />
          </div>
        </div>
      );

    case "backups":
      return (
        <div className="space-y-6">
          <BackupManagement />
          <div
            style={{
              background: "var(--ts-surface)",
              border: "1px solid var(--ts-border)",
              borderRadius: "var(--ts-radius-card)",
            }}
          >
            <WebDAVSettings />
          </div>
        </div>
      );

    case "smtp":
      return (
        <div
          style={{
            background: "var(--ts-surface)",
            border: "1px solid var(--ts-border)",
            borderRadius: "var(--ts-radius-card)",
            padding: 24,
          }}
        >
          <SmtpManager />
        </div>
      );

    default:
      return null;
  }
}
