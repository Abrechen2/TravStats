import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../../hooks/useTranslation";
import { useCoarsePointer } from "../../../hooks/useCoarsePointer";

export type SettingsSurface = "settings" | "admin";

/** The surface's name, as its tab and its breadcrumb say it. */
export const SURFACE_LABEL_KEY: Record<SettingsSurface, string> = {
  settings: "settings:frame.surface.settings",
  admin: "settings:frame.surface.admin",
};

const SURFACE_PATH: Record<SettingsSurface, string> = {
  settings: "/settings",
  admin: "/admin",
};

/**
 * "Einstellungen | Administration" above both surfaces (forgejo#321
 * prototype): the two are one place with two halves, and an admin moves
 * between them without the account menu. Only an admin gets the second tab —
 * an account without the permission sees its own surface named, and nothing
 * it could not open.
 */
export function SurfaceTabs({
  surface,
  isAdmin,
}: {
  surface: SettingsSurface;
  isAdmin: boolean;
}): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const coarse = useCoarsePointer();
  const tabs: SettingsSurface[] = isAdmin ? ["settings", "admin"] : ["settings"];
  return (
    <nav
      aria-label={t("settings:frame.surfaces")}
      data-surface-tabs=""
      className="flex flex-wrap"
      style={{ gap: "var(--ts-space-xs)", borderBottom: "1px solid var(--ts-border)" }}
    >
      {tabs.map((tab) => {
        const active = tab === surface;
        return (
          <Link
            key={tab}
            to={SURFACE_PATH[tab]}
            aria-current={active ? "page" : undefined}
            className="flex items-center"
            style={{
              minHeight: coarse ? "var(--ts-size-touch-min)" : 38,
              padding: "0 var(--ts-space-lg)",
              marginBottom: -1,
              fontSize: 14,
              fontWeight: active ? 700 : 500,
              color: active ? "var(--ts-text-bright)" : "var(--ts-muted)",
              borderBottom: `2px solid ${active ? "var(--ts-accent)" : "transparent"}`,
            }}
          >
            {t(SURFACE_LABEL_KEY[tab])}
          </Link>
        );
      })}
    </nav>
  );
}

/** "Einstellungen › Konto" above the page title. */
export function SettingsBreadcrumb({
  surface,
  page,
}: {
  surface: SettingsSurface;
  page: string;
}): JSX.Element {
  const { t } = useTranslation(["settings"]);
  return (
    <nav aria-label={t("settings:frame.breadcrumb")} data-settings-breadcrumb="">
      <ol className="t-caption flex flex-wrap items-center" style={{ gap: "var(--ts-space-xs)" }}>
        <li>
          <Link to={SURFACE_PATH[surface]} style={{ color: "var(--ts-muted)" }}>
            {t(SURFACE_LABEL_KEY[surface])}
          </Link>
        </li>
        <li aria-hidden="true">›</li>
        <li aria-current="page" style={{ color: "var(--ts-text)" }}>
          {page}
        </li>
      </ol>
    </nav>
  );
}
