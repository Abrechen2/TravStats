import type { JSX } from "react";
import { Link } from "react-router-dom";

import { useTranslation } from "../../hooks/useTranslation";
import { useReadinessShellStore } from "../../store/readinessShellStore";
import { Icon } from "../ui/Icon";
import { READINESS_PAGE_PATH } from "./ReadinessInvitationCard";

/**
 * The admin banner (spec §4.3, §12): a thin bar above the content while a
 * required admin item needs action. Server-decided — the server only raises it
 * for admins, ignores snoozes, and never raises it for an unknown state. It has
 * no close button on purpose: it goes away when the item is resolved.
 */
export default function ReadinessBanner(): JSX.Element | null {
  const { t } = useTranslation(["readiness"]);
  const banner = useReadinessShellStore((s) => s.banner);
  if (!banner?.show) return null;

  return (
    <div
      data-testid="readiness-banner"
      className="w-full"
      style={{
        background: "var(--ts-surface2, var(--bg-elevated))",
        borderBottom: "1px solid var(--ts-border, var(--color-border))",
      }}
    >
      <div className="flex items-center gap-2 px-4 py-2 text-sm">
        <Icon name="info" size={16} />
        <span className="min-w-0">
          {t("readiness:banner.text", { count: banner.itemIds.length })}
        </span>
        <Link to={READINESS_PAGE_PATH} className="whitespace-nowrap font-semibold hover:underline">
          {t("readiness:banner.link")}
        </Link>
      </div>
    </div>
  );
}
