import { useState, type JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useIsDemoAccount } from "../../../hooks/useIsDemoAccount";
import { useTravTrackCapabilities } from "../../../hooks/useTravTrackVisible";
import { SettingRows } from "../../ui/SettingRow";
import { JumpControl, SettingItem, useGuardedNavigate } from "../../ui/settings";
import { SectionCard } from "../SettingsShared";
import { useExpertRows } from "../frame/useExpertRows";
import { hasPushSources } from "../travTrackPushSources";
import TravTrackImports from "../TravTrackImports";
import DawarichCopyRow from "../location/DawarichCopyRow";
import { DAWARICH_CONNECTION_PATH } from "../location/LocationSourceSection";
import TravTrackAppsRow from "../location/TravTrackAppsRow";

const NS = "settings:tt.sources";

/**
 * Settings → TravTrack → Quellen & Importe: the Dawarich copy, file imports
 * with the history of earlier imports (each removable), further apps (expert)
 * and the jump to the Dawarich connection under Dienste.
 *
 * The import list is here, not behind a jump, so a first file and every delete
 * stay reachable while TravTrack is off on the server and the account still
 * holds data.
 */
export default function TravTrackSourcesSection(): JSX.Element | null {
  const { t } = useTranslation(["settings"]);
  const isDemo = useIsDemoAccount();
  const caps = useTravTrackCapabilities();
  const navigate = useGuardedNavigate();
  const [importsVersion, setImportsVersion] = useState(0);
  const pushSources = hasPushSources(caps?.sources);
  const expert = useExpertRows(pushSources ? 1 : 0);
  if (!caps || !(caps.hasData || caps.enabled)) return null;

  return (
    <SectionCard>
      <SettingRows>
        <DawarichCopyRow
          canStart={caps.enabled && !isDemo}
          onChanged={() => setImportsVersion((v) => v + 1)}
        />
        <SettingItem
          title={t(`${NS}.files.name`)}
          sub={t(`${NS}.files.sub`)}
          help={t(`${NS}.files.help`)}
        >
          <TravTrackImports
            canImport={caps.enabled && !isDemo}
            canDelete={!isDemo}
            version={importsVersion}
            onChanged={() => setImportsVersion((v) => v + 1)}
          />
        </SettingItem>
        {expert && pushSources ? (
          <TravTrackAppsRow
            canCreate={caps.enabled && caps.active && !isDemo}
            canRevoke={!isDemo}
          />
        ) : null}
        <SettingItem
          title={t(`${NS}.dawarich.name`)}
          control={
            <JumpControl
              label={t(`${NS}.dawarich.jump`)}
              onJump={() => navigate(DAWARICH_CONNECTION_PATH)}
            />
          }
        />
      </SettingRows>
    </SectionCard>
  );
}
