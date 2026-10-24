import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import {
  locationProviderErrorKey,
  type LocationProviderKind,
} from "../../lib/api/locationProvider";
import { useLocationProviderStore } from "../../store/locationProviderStore";
import { SectionCard, SectionTitle } from "./SettingsShared";
import DemoLockedNotice from "./DemoLockedNotice";
import { alpha, token } from "../ui/tokens";

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
 * TravTrack appears only where this server offers it (phase 1: nowhere), or
 * while it is the stored choice, so the warning has a card to sit under.
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
        ...(state.choices.travtrack || state.kind === "travtrack" ? ["travtrack" as const] : []),
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
          <fieldset className="border-0 p-0">
            <legend className="label">{t(`${NS}.legend`)}</legend>
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))" }}
            >
              {kinds.map((kind) => {
                const checked = state.kind === kind;
                const disabled = saving || !selectable(kind);
                return (
                  <div key={kind} className="flex flex-col gap-1">
                    <label
                      className="flex items-start gap-2 rounded-lg p-3 text-sm"
                      style={{
                        cursor: disabled ? "default" : "pointer",
                        opacity: !selectable(kind) && !checked ? 0.6 : 1,
                        border: `${checked ? 2 : 1}px solid ${
                          checked ? token("accent") : token("border")
                        }`,
                        background: checked ? alpha(token("accent"), 8) : undefined,
                      }}
                    >
                      <input
                        type="radio"
                        name="location-provider"
                        value={kind}
                        checked={checked}
                        disabled={disabled}
                        onChange={() => void pick(kind)}
                        className="mt-1"
                      />
                      <span className="flex flex-col gap-0.5">
                        <span className="font-semibold">{t(`${NS}.options.${kind}.label`)}</span>
                        <span className="t-caption">{t(`${NS}.options.${kind}.sub`)}</span>
                      </span>
                    </label>
                    {kind === "dawarich" && !state.choices.dawarich && (
                      <Link
                        to="/settings/location?section=dawarich"
                        className="t-caption underline"
                      >
                        {t(`${NS}.connectDawarich`)}
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          </fieldset>

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

          <div className="flex flex-col gap-2">
            <h3 className="t-label-mono">{t(`${NS}.meaning`)}</h3>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
              {POINTS[state.kind].map((point) => (
                <li key={point}>{t(`${NS}.options.${state.kind}.points.${point}`)}</li>
              ))}
            </ul>
            <p className="t-caption">{t(`${NS}.nothingMoves`)}</p>
          </div>
        </>
      )}
    </SectionCard>
  );
}
