import { useCallback, useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useTravTrackCapabilities } from "../../../hooks/useTravTrackVisible";
import { formatDateTime } from "../../../lib/displayFormat";
import { logger } from "../../../lib/logger";
import {
  travTrackApi,
  type TravTrackLastSeen,
  type TravTrackSummary,
} from "../../../lib/api/travtrack";
import { SettingRows } from "../../ui/SettingRow";
import { JumpControl, SettingItem, StatusValue, useGuardedNavigate } from "../../ui/settings";
import { SectionCard } from "../SettingsShared";
import LocationSourceSection from "../location/LocationSourceSection";
import { RowFailure } from "../location/useRowAction";
import TripRecordingSection from "../TripRecordingSection";
import TravTrackTripNote from "../TravTrackTripNote";

const NS = "settings:tt.recording";
/** Where a phone is paired and signed out (Profil & Anmeldung). */
const PAIRING_PATH = "/settings/account#devices";

/**
 * Settings → TravTrack → Aufzeichnung: what is stored (points, since, last
 * seen), where the location comes from, whether trips are recorded, and the
 * phones that send — with the jump to pairing. A failed read says so with a
 * retry; it never draws "nothing stored".
 */
export default function TravTrackRecordingSection(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const navigate = useGuardedNavigate();
  const caps = useTravTrackCapabilities();
  const [summary, setSummary] = useState<TravTrackSummary | null>(null);
  const [lastSeen, setLastSeen] = useState<TravTrackLastSeen | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const shown = caps !== null && (caps.hasData || caps.enabled);
  const load = useCallback(async (): Promise<void> => {
    try {
      const [s, seen] = await Promise.all([travTrackApi.summary(), travTrackApi.lastSeen()]);
      setSummary(s);
      setLastSeen(seen);
      setLoadFailed(false);
    } catch (err) {
      logger.warn("TravTrack recording: could not load", err);
      setLoadFailed(true);
    }
  }, []);
  useEffect(() => {
    if (shown) void load();
  }, [shown, load]);

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
      {shown ? (
        <SectionCard>
          <SettingRows>
            <SettingItem
              title={t(`${NS}.stored.name`)}
              control={
                summary ? (
                  <StatusValue>
                    {summary.pointCount === 0
                      ? t(`${NS}.stored.empty`)
                      : t(`${NS}.stored.value`, {
                          count: summary.pointCount,
                          since: formatDateTime(summary.firstAt ?? ""),
                        })}
                  </StatusValue>
                ) : undefined
              }
            >
              {loadFailed ? (
                <RowFailure error={t(`${NS}.loadError`)} onRetry={() => void load()} />
              ) : null}
              {summary && lastSeen ? (
                <p className="t-caption" style={{ margin: 0 }}>
                  {t(`${NS}.lastSeen`, { at: formatDateTime(lastSeen.at) })}
                </p>
              ) : null}
              {caps.enabled ? null : (
                <p
                  role="status"
                  className="t-caption"
                  data-testid="travtrack-off"
                  style={{ margin: 0 }}
                >
                  {t(`${NS}.off`)}
                </p>
              )}
              {caps.enabled ? <TravTrackTripNote /> : null}
            </SettingItem>
            <SettingItem
              title={t(`${NS}.devices.name`)}
              sub={t(`${NS}.devices.sub`)}
              control={
                <JumpControl
                  label={t(`${NS}.devices.jump`)}
                  onJump={() => navigate(PAIRING_PATH)}
                />
              }
            >
              {summary && summary.devices.length > 0 ? (
                <ul className="flex flex-col" style={{ gap: "var(--ts-space-xs)" }}>
                  {summary.devices.map((device, index) => (
                    <li key={device.deviceId ?? `none-${index}`} className="t-body">
                      {device.deviceId === null
                        ? t(`${NS}.devices.unnamed`)
                        : lastSeen?.deviceId === device.deviceId && lastSeen.deviceLabel
                          ? lastSeen.deviceLabel
                          : device.deviceId}{" "}
                      <StatusValue>
                        {t(`${NS}.devices.points`, { count: device.pointCount })}
                      </StatusValue>
                    </li>
                  ))}
                </ul>
              ) : null}
            </SettingItem>
          </SettingRows>
        </SectionCard>
      ) : null}
      <LocationSourceSection />
      <TripRecordingSection />
    </div>
  );
}
