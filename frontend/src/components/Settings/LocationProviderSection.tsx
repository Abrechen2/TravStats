import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { useBetaFeatures } from "../../hooks/useBetaFeatures";
import {
  locationProviderErrorKey,
  type LocationProviderKind,
} from "../../lib/api/locationProvider";
import { useLocationProviderStore } from "../../store/locationProviderStore";
import { SectionCard, SectionTitle } from "./SettingsShared";
import DemoLockedNotice from "./DemoLockedNotice";
import { token } from "../ui/tokens";
import { Segmented } from "../ui/Segmented";
import { SettingRow, SettingRows } from "../ui/SettingRow";
import Toggletip from "../ui/Toggletip";

/**
 * Settings → Standortverlauf → Standortquelle (TravTrack plan, task S5): where
 * the Companion's new recordings go and where automatic features read
 * positions from — none, TravTrack or Dawarich (prototype board
 * "Stats-Quelle").
 *
 * The stored choice is shown only once the server said it: a load failure
 * offers no radio rather than a "none" nobody chose. A refused switch keeps
 * the old choice and says why. A provider that stopped working stays shown as
 * chosen, with a warning — never as a silent fallback to none.
 *
 * TravTrack appears only where this server offers it AND the `travTrack` beta
 * key is open (its first gate site), or while it is the stored choice, so the
 * warning has a card to sit under.
 *
 * The state lives in `locationProviderStore`, shared with the Dawarich
 * connection card on the same page, which opens and closes the Dawarich choice
 * and can switch the provider itself. The shared demo account sees the
 * demo-locked notice: its choice would be every visitor's.
 */

const POINTS: Record<LocationProviderKind, readonly string[]> = {
  none: ["manual", "noHistory", "ownRecording"],
  travtrack: ["records", "segment", "inbox", "zones"],
  dawarich: ["readOnly", "suggestions", "recording"],
};

const NS = "settings:locationProvider";

export default function LocationProviderSection(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const isDemo = useIsDemoAccount();
  const { isFeatureVisible } = useBetaFeatures();
  const state = useLocationProviderStore((s) => s.settings);
  const loadFailed = useLocationProviderStore((s) => s.loadFailed && s.settings === null);
  const refresh = useLocationProviderStore((s) => s.refresh);
  const choose = useLocationProviderStore((s) => s.choose);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isDemo) void refresh();
  }, [isDemo, refresh]);

  const pick = useCallback(
    async (kind: LocationProviderKind): Promise<void> => {
      if (!state || kind === state.kind) return;
      setSaving(true);
      setError(null);
      try {
        await choose(kind);
      } catch (err) {
        setError(t(locationProviderErrorKey(err)));
        // A refusal may mean the choices moved (a key removed elsewhere): re-ask.
        void refresh();
      } finally {
        setSaving(false);
      }
    },
    [state, choose, refresh, t]
  );

  const kinds: LocationProviderKind[] = state
    ? [
        "none",
        ...((state.choices.travtrack && isFeatureVisible("travTrack")) || state.kind === "travtrack"
          ? ["travtrack" as const]
          : []),
        "dawarich",
      ]
    : [];
  const selectable = (kind: LocationProviderKind): boolean =>
    kind === "none" || (state?.choices[kind] ?? false);

  return (
    <SectionCard>
      <SectionTitle title={t(`${NS}.title`)} description={t(`${NS}.description`)} />

      {isDemo && <DemoLockedNotice />}

      {!isDemo && loadFailed && (
        <p role="alert" className="text-sm" style={{ color: token("bad") }}>
          {t(`${NS}.loadError`)}
        </p>
      )}

      {!isDemo && state && (
        <>
          <SettingRows>
            <SettingRow
              title={
                <>
                  {t(`${NS}.legend`)}{" "}
                  <Toggletip
                    subject={t(`${NS}.legend`)}
                    content={
                      <>
                        <ul className="flex list-disc flex-col gap-1 pl-5">
                          {POINTS[state.kind].map((point) => (
                            <li key={point}>{t(`${NS}.options.${state.kind}.points.${point}`)}</li>
                          ))}
                        </ul>
                        <span className="t-caption">{t(`${NS}.nothingMoves`)}</span>
                      </>
                    }
                  />
                </>
              }
              sub={t(`${NS}.options.${state.kind}.sub`)}
              control={
                <Segmented
                  label={t(`${NS}.legend`)}
                  value={state.kind}
                  disabled={saving}
                  onChange={(kind) => void pick(kind)}
                  options={kinds.map((kind) => ({
                    value: kind,
                    label: t(`${NS}.options.${kind}.label`),
                    disabled: !selectable(kind),
                  }))}
                />
              }
            />
          </SettingRows>
          {kinds.includes("dawarich") && !state.choices.dawarich && (
            <Link to="/settings/location?section=dawarich" className="t-caption underline">
              {t(`${NS}.connectDawarich`)}
            </Link>
          )}

          {state.status !== "ok" && (
            <p role="alert" className="text-sm" style={{ color: token("warn") }}>
              {t(`${NS}.status.${state.status}`)}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm" style={{ color: token("bad") }}>
              {error}
            </p>
          )}
        </>
      )}
    </SectionCard>
  );
}
