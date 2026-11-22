import OverflowMenu, { type OverflowEntry } from "../../components/ui/OverflowMenu";
import { useTranslation } from "../../hooks/useTranslation";

/**
 * The plan header's secondary actions (edit, refresh, statistics, members, delete) behind one
 * "Mehr" at every width — the web is drawn for iPads, so a phone-only fold left them cluttering
 * the tablet. The primary link ("KI") stays outside. Delete is the entry's own, last and red;
 * the page asks before it deletes.
 */
export function PlanMenu({ entries }: { entries: OverflowEntry[] }) {
  const { t } = useTranslation("travplan");
  return (
    <OverflowMenu
      entries={entries}
      label={t("more")}
      triggerLabel={t("more")}
      testId="plan-more-menu"
    />
  );
}
