import type { JSX } from "react";
import AdminSectionSwitch from "./AdminSectionSwitch";
import { LAZY_ADMIN_SECTIONS, type ActiveSection } from "./adminSections";
import { LazyBody } from "./LazySection";

/**
 * One server section. The sections that fetch their own data on mount are held
 * back until they have been near the viewport once (`LAZY_ADMIN_SECTIONS`), so a
 * page with several of them asks the server for what the reader scrolls to.
 */
export function AdminSectionBody({
  section,
  mountId,
}: {
  section: ActiveSection;
  mountId: string;
}): JSX.Element {
  const body = <AdminSectionSwitch section={section} mountId={mountId} />;
  return LAZY_ADMIN_SECTIONS.has(section) ? (
    <LazyBody id={`settings-${mountId}-body`}>{body}</LazyBody>
  ) : (
    body
  );
}
