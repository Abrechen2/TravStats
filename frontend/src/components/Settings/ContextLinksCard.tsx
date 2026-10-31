import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { SettingRow, SettingRows } from "../ui/SettingRow";
import { SectionCard, SectionTitle } from "./SettingsShared";

export interface ContextLink {
  /** `<scope>.<id>`: the row's `title` and `sub` live under it. */
  id: string;
  to: string;
}

/**
 * A settings section whose controls belong to their context — the map panel,
 * a list, the comparison — and so are not repeated here (settings redesign,
 * rule 1). It gives the setting a place in Einstellungen to be found by, and
 * one button that jumps to the live editor.
 */
export function ContextLinksCard({
  scope,
  links,
}: {
  /** `views.mapAppearance`, `privacy.encryptedGrants` — a key group in `settings`. */
  scope: string;
  links: readonly ContextLink[];
}): JSX.Element {
  const { t } = useTranslation(["settings"]);
  return (
    <SectionCard>
      <SectionTitle
        title={t(`settings:${scope}.title`)}
        description={t(`settings:${scope}.description`)}
      />
      <SettingRows>
        {links.map((link) => (
          <SettingRow
            key={link.id}
            title={t(`settings:${scope}.${link.id}.title`)}
            sub={t(`settings:${scope}.${link.id}.sub`)}
            control={
              <Link to={link.to} className="btn-secondary">
                {t("settings:contextLinks.open")}
              </Link>
            }
          />
        ))}
      </SettingRows>
    </SectionCard>
  );
}
