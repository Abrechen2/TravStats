import { useState, type JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useIsDemoAccount } from "../../../hooks/useIsDemoAccount";
import { useTodayZone } from "../../../hooks/useTodayZone";
import { todayIn } from "../../../shared/time/clock";
import { SettingRows } from "../../ui/SettingRow";
import { ActionControl, SettingItem } from "../../ui/settings";
import { SectionCard } from "../SettingsShared";
import TravTrackDiagnostics from "../TravTrackDiagnostics";

const NS = "settings:location.history.diag";

/** Settings → TravTrack → Diagnose (expert): why points are missing, from the app's own log. */
export default function TravTrackDiagSection(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const isDemo = useIsDemoAccount();
  const zone = useTodayZone();
  const [open, setOpen] = useState(false);
  return (
    <SectionCard>
      <SettingRows>
        <SettingItem
          expert
          title={t(`${NS}.name`)}
          sub={t(`${NS}.sub`)}
          help={t(`${NS}.help`)}
          control={
            <ActionControl
              label={t(open ? `${NS}.close` : `${NS}.open`)}
              onClick={() => setOpen((v) => !v)}
            />
          }
        >
          {open ? <TravTrackDiagnostics today={todayIn(zone)} canDelete={!isDemo} /> : null}
        </SettingItem>
      </SettingRows>
    </SectionCard>
  );
}
