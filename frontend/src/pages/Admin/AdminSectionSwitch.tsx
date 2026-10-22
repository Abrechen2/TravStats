import type { JSX } from "react";
import BackupManagement from "../../components/Admin/BackupManagement";
import ShareLinksSettings from "../../components/Admin/ShareLinksSettings";
import ImportModeSettings from "../../components/Admin/ImportModeSettings";
import TemplateRepoSettings from "../../components/Admin/TemplateRepoSettings";
import FederationSettings from "../../components/Admin/FederationSettings";
import InstanceSettings from "../../components/Admin/InstanceSettings";
import UsageStatsSettings from "../../components/Admin/UsageStatsSettings";
import PushSettings from "../../components/Admin/PushSettings";
import WebDAVSettings from "../../components/Admin/WebDAVSettings";
import SystemInfoTab from "../../components/Admin/SystemInfo";
import UserManagement from "../../components/Admin/UserManagement";
import InvitationManagement from "../../components/Admin/InvitationManagement";
import CreateLinkInviteModal from "../../components/Admin/CreateLinkInviteModal";
import CreateEmailInviteModal from "../../components/Admin/CreateEmailInviteModal";
import InviteSuccessModal from "../../components/Admin/InviteSuccessModal";
import GlobalApiKeysManager from "../../components/Admin/GlobalApiKeysManager";
import AboutSection from "../../components/Settings/AboutSection";
import ParserSettingsTab from "../../components/Admin/ParserSettings";
import LoggingManager from "../../components/Admin/LoggingManager";
import SmtpManager from "../../components/Admin/SmtpManager";
import ShipsSection from "../../components/Admin/masterData/ShipsSection";
import PortsSection from "../../components/Admin/masterData/PortsSection";
import AirlinesSection from "../../components/Admin/masterData/AirlinesSection";
import AircraftSection from "../../components/Admin/masterData/AircraftSection";
import AirportsSection from "../../components/Admin/masterData/AirportsSection";
import LodgingChainsSection from "../../components/Admin/masterData/LodgingChainsSection";
import TimeModelSection from "../../components/Admin/timeModel/TimeModelSection";
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
  /** `?user=` — the account a deep link into user management meant. */
  highlightUserId?: string | null;

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
 * How each section is framed (see `SectionFrame`): `own` sections draw their
 * heading and card themselves (`SectionCard` + `SectionTitle`); `card`
 * sections render only their body, and the frame draws both.
 */
export const ADMIN_SECTION_FRAME: Record<ActiveSection, "own" | "card"> = {
  instance: "card",
  shareLinks: "own",
  importMode: "own",
  usageStats: "card",
  about: "own",
  federation: "own",
  push: "card",
  users: "card",
  invitations: "card",
  externalServices: "own",
  parsers: "card",
  templateRepo: "own",
  smtp: "card",
  backups: "card",
  webdav: "card",
  timeModel: "card",
  logging: "card",
  system: "card",
  airlinesMasterData: "card",
  aircraftMasterData: "card",
  airportsMasterData: "card",
  shipsMasterData: "card",
  portsMasterData: "card",
  lodgingChainsMasterData: "card",
};

/**
 * Renders one admin section's content. Kept apart from the page so the page
 * is about navigation and data loading, and this file is about wiring the
 * sections up — see SettingsSectionSwitch for the pattern this copies.
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

    case "lodgingChainsMasterData":
      return <LodgingChainsSection />;

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
          highlightUserId={props.highlightUserId}
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
      // Grouped by domain, as accordions (forgejo#321): the instance's keys,
      // the routing provider, the shared Immich connection, the rail providers.
      return (
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

    case "templateRepo":
      // Where the templates come from (forgejo#309) — loads its own data.
      return <TemplateRepoSettings />;

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
      return <InstanceSettings />;
    case "shareLinks":
      return <ShareLinksSettings />;
    case "importMode":
      return <ImportModeSettings />;
    case "usageStats":
      return <UsageStatsSettings />;
    case "about":
      // Moved here from personal settings › Darstellung (tester, 2026-10-20);
      // every account still sees the version under the settings menu.
      return <AboutSection />;
    case "federation":
      return <FederationSettings />;
    case "push":
      return <PushSettings />;

    case "backups":
      return <BackupManagement />;
    case "webdav":
      return <WebDAVSettings />;

    case "timeModel":
      return <TimeModelSection users={props.users} />;

    case "smtp":
      return <SmtpManager />;

    default:
      return null;
  }
}
