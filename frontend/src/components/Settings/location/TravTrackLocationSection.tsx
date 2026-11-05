import { useCallback, useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useIsDemoAccount } from "../../../hooks/useIsDemoAccount";
import { useBetaFeatures } from "../../../hooks/useBetaFeatures";
import { useTravTrackCapabilities } from "../../../hooks/useTravTrackVisible";
import { formatDateTime } from "../../../lib/displayFormat";
import { logger } from "../../../lib/logger";
import { travTrackApi, type PrivacyZone, type TravTrackSummary } from "../../../lib/api/travtrack";
import { SettingRows } from "../../ui/SettingRow";
import { JumpControl, SettingItem, StatusValue, useGuardedNavigate } from "../../ui/settings";
import { SectionCard } from "../SettingsShared";
import { useExpertRows } from "../frame/useExpertRows";
import { hasPushSources } from "../travTrackPushSources";
import TravTrackTripNote from "../TravTrackTripNote";
import TravTrackAppsRow from "./TravTrackAppsRow";
import TravTrackCitiesRow from "./TravTrackCitiesRow";
import TravTrackHistoryCard from "./TravTrackHistoryCard";
import TravTrackPlacesRow from "./TravTrackPlacesRow";
import TravTrackZonesRow from "./TravTrackZonesRow";
import { RowFailure } from "./useRowAction";

const NS = "settings:location.tt";

/**
 * Settings → Standort → TravTrack and Verlauf (TravTrack plan T6).
 *
 * What is stored, the privacy zones, the city lookup, further apps, then the
 * history (copy, GPX, export, delete, diagnostics). With TravTrack switched
 * off an account holding data keeps all of it but adding a zone or a key —
 * "TravTrack aus heißt: keine neue Erfassung, nichts wird gelöscht, Export und
 * Löschen bleiben möglich".
 *
 * A failed load says so with a retry; it never draws "nothing stored".
 */
export default function TravTrackLocationSection(): JSX.Element | null {
  const { t } = useTranslation(["settings"]);
  const isDemo = useIsDemoAccount();
  const { isFeatureVisible } = useBetaFeatures();
  const navigate = useGuardedNavigate();
  const caps = useTravTrackCapabilities();
  const [summary, setSummary] = useState<TravTrackSummary | null>(null);
  const [zones, setZones] = useState<PrivacyZone[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [s, z] = await Promise.all([travTrackApi.summary(), travTrackApi.zones()]);
      setSummary(s);
      setZones(z);
      setLoadFailed(false);
    } catch (err) {
      logger.warn("TravTrack settings: could not load", err);
      setLoadFailed(true);
    }
  }, []);

  const shown = caps !== null && (caps.hasData || caps.enabled);
  useEffect(() => {
    if (shown) void load();
  }, [shown, load]);

  const pushSources = hasPushSources(caps?.sources);
  const expert = useExpertRows((pushSources ? 1 : 0) + 1);
  if (!caps || !shown) return null;

  const trackOpen = isFeatureVisible("travTrack") && caps.enabled && (caps.active || caps.hasData);

  return (
    <>
      <SectionCard>
        <SettingRows>
          <SettingItem
            title={t(`${NS}.sum.name`)}
            control={
              <>
                {summary ? (
                  <StatusValue>
                    {summary.pointCount === 0
                      ? t(`${NS}.sum.empty`)
                      : t(`${NS}.sum.value`, {
                          count: summary.pointCount,
                          from: formatDateTime(summary.firstAt ?? ""),
                          to: formatDateTime(summary.lastAt ?? ""),
                          devices: summary.devices.length,
                        })}
                  </StatusValue>
                ) : null}
                {trackOpen ? (
                  <JumpControl label={t(`${NS}.sum.open`)} onJump={() => navigate("/track")} />
                ) : null}
              </>
            }
          >
            {loadFailed ? (
              <RowFailure error={t(`${NS}.sum.loadError`)} onRetry={() => void load()} />
            ) : null}
            {caps.enabled ? null : (
              <p
                role="status"
                className="t-caption"
                data-testid="travtrack-off"
                style={{ margin: 0 }}
              >
                {t(`${NS}.sum.off`)}
              </p>
            )}
            {caps.enabled ? <TravTrackTripNote /> : null}
          </SettingItem>

          <TravTrackPlacesRow />

          <TravTrackZonesRow
            zones={zones}
            loadFailed={loadFailed}
            onReload={() => void load()}
            canAdd={caps.enabled && !isDemo}
            canRemove={!isDemo}
            onChanged={load}
          />

          {caps.enabled ? <TravTrackCitiesRow demo={isDemo} active={caps.active} /> : null}

          {expert && pushSources ? (
            <TravTrackAppsRow
              canCreate={caps.enabled && caps.active && !isDemo}
              canRevoke={!isDemo}
            />
          ) : null}
        </SettingRows>
      </SectionCard>

      <TravTrackHistoryCard
        summary={summary}
        trackOpen={trackOpen}
        enabled={caps.enabled}
        isDemo={isDemo}
        expert={expert}
        onChanged={load}
      />
    </>
  );
}
