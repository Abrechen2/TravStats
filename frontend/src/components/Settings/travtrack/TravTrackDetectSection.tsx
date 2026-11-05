import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useIsDemoAccount } from "../../../hooks/useIsDemoAccount";
import { useTravTrackCapabilities } from "../../../hooks/useTravTrackVisible";
import { saveSwitch } from "../../../store/confirmedSettings";
import { useSuggestionSwitchesStore } from "../../../store/suggestionSwitchesStore";
import { SettingRows } from "../../ui/SettingRow";
import {
  JumpControl,
  SettingItem,
  SwitchControl,
  useGuardedNavigate,
  useSettingWrite,
} from "../../ui/settings";
import { SectionCard } from "../SettingsShared";
import StayScanSection from "../location/StayScanSection";
import TravTrackCitiesRow from "../location/TravTrackCitiesRow";

const NS = "settings:tt.detect";
const INBOX_PATH = "/pending-updates";

/**
 * Settings → TravTrack → Erkennung & Vorschläge: name stops (the stay
 * suggestions switch of the inbox), name cities (the monthly values' lookup),
 * and the automatic stay search with its period and "Jetzt suchen" (expert
 * period, inside `StayScanSection`).
 */
export default function TravTrackDetectSection(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const isDemo = useIsDemoAccount();
  const caps = useTravTrackCapabilities();
  const navigate = useGuardedNavigate();
  const stays = useSuggestionSwitchesStore((s) => s.stays);
  const write = useSettingWrite<boolean>("trips.suggestions.stays", stays, (on, o) =>
    saveSwitch("stays", on, o)
  );

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
      <SectionCard>
        <SettingRows>
          <SettingItem
            title={t(`${NS}.stops.name`)}
            sub={t(`${NS}.stops.sub`)}
            help={t(`${NS}.stops.help`)}
            save={write}
            locked={isDemo ? { why: "demo", reason: t("settings:blocks.lock.demo") } : undefined}
            control={
              <SwitchControl
                checked={write.value}
                onChange={write.choose}
                label={t(`${NS}.stops.name`)}
              />
            }
          />
          {caps?.enabled ? <TravTrackCitiesRow demo={isDemo} active={caps.active} /> : null}
          <SettingItem
            title={t(`${NS}.inbox.name`)}
            control={
              <JumpControl label={t(`${NS}.inbox.jump`)} onJump={() => navigate(INBOX_PATH)} />
            }
          />
        </SettingRows>
      </SectionCard>
      <StayScanSection />
    </div>
  );
}
