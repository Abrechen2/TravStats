import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { MAP_PANEL_PARAM, MAP_PANEL_ROUTES } from "../../lib/mapRoutes";
import { SettingRows } from "../ui/SettingRow";
import { JumpControl, SettingItem, useGuardedNavigate } from "../ui/settings";
import { SectionCard } from "./SettingsShared";

/**
 * "Karte, Start & Listen": the map's look, the home page and the lists are set
 * where they are seen (rule 1 of the settings redesign), so each is a jump row
 * naming where it leads. The lists lead to the flight list when flights are on,
 * else to the dashboard — a jump to a page the account has switched off would
 * be a dead end.
 */
export default function ViewsJumpCard(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const { isEnabled } = useEnabledDomains();
  const navigate = useGuardedNavigate();
  const rows = [
    { id: "map", to: `/dashboard?${MAP_PANEL_PARAM}=${MAP_PANEL_ROUTES}` },
    { id: "start", to: "/dashboard" },
    { id: "lists", to: isEnabled("flight") ? "/flights" : "/dashboard" },
  ] as const;
  return (
    <SectionCard>
      <SettingRows>
        {rows.map((row) => (
          <SettingItem
            key={row.id}
            title={t(`settings:views.${row.id}.name`)}
            sub={t(`settings:views.${row.id}.sub`)}
            control={
              <JumpControl
                label={t(`settings:views.${row.id}.jump`)}
                onJump={() => navigate(row.to)}
              />
            }
          />
        ))}
      </SettingRows>
    </SectionCard>
  );
}
