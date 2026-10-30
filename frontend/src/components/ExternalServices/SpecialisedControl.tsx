import type { JSX } from "react";
import SmtpManager from "../Admin/SmtpManager";
import WebDAVSettings from "../Admin/WebDAVSettings";
import PushSettings from "../Admin/PushSettings";
import FederationSettings from "../Admin/FederationSettings";
import UsageStatsSettings from "../Admin/UsageStatsSettings";
import TemplateRepoSettings from "../Admin/TemplateRepoSettings";
import ImmichGlobalSettings from "../Admin/ImmichGlobalSettings";
import OpenDataCard from "../Settings/OpenDataCard";

/**
 * Services whose settings are more than a list of fields keep the control that
 * already owns their logic (OAuth-less but multi-step forms, a connection file,
 * a consent dialog of their own). The page embeds it instead of re-writing it,
 * so the form and its save path exist once.
 */
const SPECIALISED: Record<string, () => JSX.Element> = {
  smtp: () => <SmtpManager />,
  webdav: () => <WebDAVSettings />,
  push: () => <PushSettings />,
  federation: () => <FederationSettings />,
  usageStats: () => <UsageStatsSettings />,
  updatesTemplates: () => <TemplateRepoSettings />,
  immich: () => <ImmichGlobalSettings />,
  openData: () => <OpenDataCard isAdmin />,
};

export function replacesGenericFields(serviceId: string): boolean {
  return serviceId in SPECIALISED;
}

export function SpecialisedControl({ serviceId }: { serviceId: string }): JSX.Element | null {
  const render = SPECIALISED[serviceId];
  return render ? render() : null;
}
