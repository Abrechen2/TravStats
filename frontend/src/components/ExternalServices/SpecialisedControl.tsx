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
const SPECIALISED: Record<string, (expert: boolean) => JSX.Element> = {
  smtp: (expert) => <SmtpManager expert={expert} />,
  webdav: (expert) => <WebDAVSettings expert={expert} />,
  push: (expert) => <PushSettings expert={expert} />,
  federation: (expert) => <FederationSettings expert={expert} />,
  usageStats: () => <UsageStatsSettings />,
  updatesTemplates: (expert) => <TemplateRepoSettings expert={expert} />,
  immich: () => <ImmichGlobalSettings />,
  openData: () => <OpenDataCard isAdmin />,
};

/**
 * Specialised controls that carry only the on/off switch and leave the
 * catalogue's fields to the generic form beside them (open data: the
 * Overpass address was reachable nowhere while the card replaced the form).
 */
const ALONGSIDE_GENERIC_FIELDS = new Set(["openData"]);

export function hasSpecialisedControl(serviceId: string): boolean {
  return serviceId in SPECIALISED;
}

export function replacesGenericFields(serviceId: string): boolean {
  return serviceId in SPECIALISED && !ALONGSIDE_GENERIC_FIELDS.has(serviceId);
}

/** `expert` is the settings level in force; the form hides what only Expert tunes. */
export function SpecialisedControl({
  serviceId,
  expert,
}: {
  serviceId: string;
  expert: boolean;
}): JSX.Element | null {
  const render = SPECIALISED[serviceId];
  return render ? render(expert) : null;
}
