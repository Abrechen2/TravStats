import { useCallback, useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useIsDemoAccount } from "../../../hooks/useIsDemoAccount";
import { useTravTrackCapabilities } from "../../../hooks/useTravTrackVisible";
import { logger } from "../../../lib/logger";
import { travTrackApi, type PrivacyZone } from "../../../lib/api/travtrack";
import { SettingRows } from "../../ui/SettingRow";
import { SectionCard } from "../SettingsShared";
import { ZONES_CHANGED } from "./zonesChanged";
import TravTrackZonesRow from "../location/TravTrackZonesRow";

/**
 * Settings → TravTrack → Schutzzonen: list, add, edit and remove. The note
 * under the heading says what separates a zone from a fixed place — nothing is stored
 * inside a zone, a fixed place only summarises, and a zone always wins.
 */
export default function TravTrackZonesSection(): JSX.Element | null {
  const { t } = useTranslation(["settings"]);
  const isDemo = useIsDemoAccount();
  const caps = useTravTrackCapabilities();
  const [zones, setZones] = useState<PrivacyZone[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      setZones(await travTrackApi.zones());
      setLoadFailed(false);
    } catch (err) {
      logger.warn("TravTrack zones: could not load", err);
      setLoadFailed(true);
    }
  }, []);
  const shown = caps !== null && (caps.hasData || caps.enabled);
  useEffect(() => {
    if (shown) void load();
  }, [shown, load]);
  if (!caps || !shown) return null;

  return (
    <SectionCard>
      <SettingRows>
        <TravTrackZonesRow
          explanation={t("settings:tt.zones.difference")}
          zones={zones}
          loadFailed={loadFailed}
          onReload={() => void load()}
          canAdd={caps.enabled && !isDemo}
          canRemove={!isDemo}
          canEdit={caps.enabled && !isDemo}
          onChanged={async () => {
            await load();
            window.dispatchEvent(new Event(ZONES_CHANGED));
          }}
        />
      </SettingRows>
    </SectionCard>
  );
}
