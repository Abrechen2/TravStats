import type { JSX } from "react";
import ShareLinksSettings from "../../components/Admin/ShareLinksSettings";
import ExternalServicesPointer from "../../components/ExternalServices/ExternalServicesPointer";
import LegacyServiceSummary from "../../components/ExternalServices/LegacyServiceSummary";
import ServicesPage from "../../components/Services/ServicesPage";
import AboutSection from "../../components/Settings/AboutSection";
import BackupsAutomatic from "../../components/ServerPages/BackupsAutomatic";
import BackupsExisting from "../../components/ServerPages/BackupsExisting";
import MaintenanceLogging from "../../components/ServerPages/MaintenanceLogging";
import MaintenanceSystem from "../../components/ServerPages/MaintenanceSystem";
import MaintenanceTimeModel from "../../components/ServerPages/MaintenanceTimeModel";
import ServerGeneral from "../../components/ServerPages/ServerGeneral";
import ServerOffers from "../../components/ServerPages/ServerOffers";
import ServerParsers from "../../components/ServerPages/ServerParsers";
import UsersAccess from "../../components/ServerPages/UsersAccess";
import UsersAccounts from "../../components/ServerPages/UsersAccounts";
import UsersInvitations from "../../components/ServerPages/UsersInvitations";
import ShipsSection from "../../components/Admin/masterData/ShipsSection";
import PortsSection from "../../components/Admin/masterData/PortsSection";
import AirlinesSection from "../../components/Admin/masterData/AirlinesSection";
import AircraftSection from "../../components/Admin/masterData/AircraftSection";
import AirportsSection from "../../components/Admin/masterData/AirportsSection";
import LodgingChainsSection from "../../components/Admin/masterData/LodgingChainsSection";
import type { ActiveSection } from "./adminSections";

/**
 * How each section is framed (see `SectionFrame`): `own` sections draw their
 * heading and card themselves (`SectionCard` + `SectionTitle`); `card`
 * sections render only their body, and the frame draws both.
 */
export const ADMIN_SECTION_FRAME: Record<ActiveSection, "own" | "card"> = {
  instance: "card",
  travTrack: "card",
  travPlan: "card",
  shareLinks: "own",
  importMode: "card",
  usageStats: "card",
  about: "own",
  federation: "card",
  push: "card",
  users: "card",
  invitations: "card",
  externalServices: "own",
  parsers: "card",
  templateRepo: "card",
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
 * Renders one server section. The server pages are built on the settings
 * blocks (package 7) and each loads what it shows; `mountId` tells the two
 * mounts that share a component apart (Zugang and Konten are both `users`,
 * Automatisch and Vorhandene Sicherungen both `backups`).
 */
export default function AdminSectionSwitch({
  section,
  mountId,
}: {
  section: ActiveSection;
  mountId: string;
}): JSX.Element | null {
  switch (section) {
    case "instance":
      return <ServerGeneral />;
    case "travTrack":
      return <ServerOffers />;
    case "parsers":
      return (
        <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
          <ExternalServicesPointer />
          <ServerParsers />
        </div>
      );
    case "users":
      return mountId === "access" ? <UsersAccess /> : <UsersAccounts />;
    case "invitations":
      return <UsersInvitations />;
    case "backups":
      return mountId === "automatic" ? <BackupsAutomatic /> : <BackupsExisting />;
    case "logging":
      return <MaintenanceLogging />;
    case "system":
      return <MaintenanceSystem />;
    case "timeModel":
      return <MaintenanceTimeModel />;

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

    case "externalServices":
      // The services page itself: an administrator's cards carry both sides.
      return <ServicesPage isAdmin />;
    case "shareLinks":
      return <ShareLinksSettings />;
    case "about":
      return <AboutSection />;
    case "templateRepo":
      return <LegacyServiceSummary serviceId="updatesTemplates" />;
    case "usageStats":
      return <LegacyServiceSummary serviceId="usageStats" />;
    case "federation":
      return <LegacyServiceSummary serviceId="federation" />;
    case "push":
      return <LegacyServiceSummary serviceId="push" />;
    case "webdav":
      return <LegacyServiceSummary serviceId="webdav" />;
    case "smtp":
      return <LegacyServiceSummary serviceId="smtp" />;
    default:
      return null;
  }
}
