import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useIsDemoAccount } from "../../../hooks/useIsDemoAccount";
import { useBetaFeatures } from "../../../hooks/useBetaFeatures";
import { apiErrorMachineCode } from "../../../lib/apiError";
import type {
  LocationProviderKind,
  LocationProviderSettings,
} from "../../../lib/api/locationProvider";
import { useLocationProviderStore } from "../../../store/locationProviderStore";
import { SectionCard } from "../SettingsShared";
import TrackGapSetting from "./TrackGapSetting";
import { SettingRows } from "../../ui/SettingRow";
import {
  ChoiceControl,
  Dependency,
  ErrorLine,
  JumpControl,
  LinkButton,
  SettingItem,
  StatusValue,
  useGuardedNavigate,
  useSettingWrite,
  type ChoiceOption,
} from "../../ui/settings";

/** Where an account's own Dawarich connection is edited (Dienste). */
export const DAWARICH_CONNECTION_PATH =
  "/settings/services?section=externalServices&service=dawarich";

/**
 * TravTrack is the chosen source: the Dawarich rows (its connection, the hint
 * that it is missing, the jump to Dienste) only add noise then, since nothing
 * reads Dawarich (beta feedback, 2026-11-11). Unknown while the choice has not
 * loaded, so nothing is hidden on a failed read.
 */
export function onTravTrackSource(settings: LocationProviderSettings | null): boolean {
  return settings?.kind === "travtrack";
}

/** The refusals the server names for a switch, as their own lines. */
function refusalKey(err: unknown): string | null {
  switch (apiErrorMachineCode(err)) {
    case "DAWARICH_NOT_CONFIGURED":
      return "settings:location.source.errors.dawarichNotConfigured";
    case "TRAVTRACK_UNAVAILABLE":
      return "settings:location.source.errors.travtrackUnavailable";
    default:
      return null;
  }
}

/**
 * Settings → Standort → Quelle: where the Companion's recordings go and where
 * stays, country days and routes are read from — none, TravTrack or Dawarich.
 *
 * The stored choice is shown only once the server said it; a failed load draws
 * no "Keine" nobody chose. The choice is a write on its own row: a refused
 * switch keeps what the user picked, says why, and offers "Erneut versuchen" or
 * "Verwerfen". Dawarich needs the account's OWN connection (R8) — the server's
 * serves tour and cruise tracks only — so it stays unselectable, with the
 * reason and the jump to the connection, until that exists. A source that
 * stopped working stays shown as chosen, with a warning, never as a fallback.
 */
export default function LocationSourceSection(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const isDemo = useIsDemoAccount();
  const navigate = useGuardedNavigate();
  const { isFeatureVisible } = useBetaFeatures();
  const state = useLocationProviderStore((s) => s.settings);
  const loadFailed = useLocationProviderStore((s) => s.loadFailed && s.settings === null);
  const refresh = useLocationProviderStore((s) => s.refresh);
  const choose = useLocationProviderStore((s) => s.choose);
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    if (!isDemo) void refresh();
  }, [isDemo, refresh]);

  const write = useSettingWrite<LocationProviderKind>(
    "location.source",
    state?.kind ?? "none",
    async (kind) => {
      setRefusal(null);
      try {
        await choose(kind);
      } catch (err) {
        setRefusal(refusalKey(err));
        // A refusal may mean the choices moved (a key removed elsewhere): ask again.
        void refresh();
        throw err;
      }
    }
  );

  const locked = isDemo
    ? { why: "demo" as const, reason: t("settings:blocks.lock.demo") }
    : undefined;
  const travTrackOffered =
    state !== null &&
    ((state.choices.travtrack && isFeatureVisible("travTrack")) || state.kind === "travtrack");
  const dawarichHidden = onTravTrackSource(state);
  const options: ChoiceOption<LocationProviderKind>[] = state
    ? [
        { value: "none", label: t("settings:location.source.options.none") },
        ...(travTrackOffered
          ? [
              {
                value: "travtrack" as const,
                label: t("settings:location.source.options.travtrack"),
              },
            ]
          : []),
        {
          value: "dawarich",
          label: t("settings:location.source.options.dawarich"),
          disabled: !state.choices.dawarich && state.kind !== "dawarich",
        },
      ]
    : [];

  return (
    <SectionCard>
      <SettingRows>
        <SettingItem
          title={t("settings:location.source.name")}
          name={t("settings:location.source.name")}
          sub={t("settings:location.source.sub")}
          help={t("settings:location.source.help")}
          save={write}
          locked={locked}
          control={
            state && !isDemo ? (
              <ChoiceControl
                value={write.value}
                options={options}
                label={t("settings:location.source.name")}
                onChange={write.choose}
              />
            ) : undefined
          }
        >
          {!isDemo && loadFailed ? (
            <ErrorLine>
              {t("settings:location.source.loadError")}{" "}
              <LinkButton onClick={() => void refresh()}>
                {t("settings:blocks.save.retry")}
              </LinkButton>
            </ErrorLine>
          ) : null}
          {state && !state.choices.dawarich && !dawarichHidden ? (
            <Dependency
              reason={t("settings:blocks.dep.noOwnDawarich.reason")}
              jump={{
                label: t("settings:blocks.dep.noOwnDawarich.jump"),
                onJump: () => navigate(DAWARICH_CONNECTION_PATH),
              }}
            />
          ) : null}
          {state && state.status !== "ok" ? (
            <p role="alert" className="t-caption" style={{ color: "var(--ts-warn)", margin: 0 }}>
              {t(`settings:location.source.status.${state.status}`)}
            </p>
          ) : null}
          {refusal ? <ErrorLine>{t(refusal)}</ErrorLine> : null}
        </SettingItem>

        <TrackGapSetting locked={locked} />

        {dawarichHidden ? null : (
          <SettingItem
            title={t("settings:location.dawlink.name")}
            locked={locked}
            control={
              <>
                {state ? (
                  <StatusValue>
                    {t(
                      state.choices.dawarich
                        ? "settings:location.dawlink.connected"
                        : "settings:location.dawlink.notConnected"
                    )}
                  </StatusValue>
                ) : null}
                <JumpControl
                  label={t("settings:location.dawlink.jump")}
                  onJump={() => navigate(DAWARICH_CONNECTION_PATH)}
                />
              </>
            }
          />
        )}
      </SettingRows>
    </SectionCard>
  );
}
