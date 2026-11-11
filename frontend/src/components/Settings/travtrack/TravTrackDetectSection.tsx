import type { JSX, ReactNode } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useIsDemoAccount } from "../../../hooks/useIsDemoAccount";
import {
  travTrackSettingsVisible,
  useTravTrackCapabilities,
} from "../../../hooks/useTravTrackVisible";
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
import { SectionCard, SectionTitle } from "../SettingsShared";
import { useExpertRows } from "../frame/useExpertRows";
import StaySuggestionRow from "../StaySuggestionRows";
import StayScanSection from "../location/StayScanSection";
import TrackGapSetting from "../location/TrackGapSetting";
import TravTrackCitiesRow from "../location/TravTrackCitiesRow";

const NS = "settings:tt.detect";
const INBOX_PATH = "/pending-updates";

/**
 * Settings → TravTrack → Erkennung & Vorschläge, in the design's four groups:
 * Aufenthalte (suggest stays, name stops), Suchlauf (the automatic stay search,
 * its last run, "Jetzt suchen"), Belege (Immich photos as evidence) and
 * Feinabstimmung (where a track splits, city names, the AI place type, the
 * search period, markets and parks).
 *
 * The stay suggestions and the search read the account's location source, so
 * they work with Dawarich alone. What needs TravTrack itself — naming stops,
 * the track gap, city names — is left out while TravTrack is neither offered
 * nor holding data (an account on Dawarich only).
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
  const travTrack = travTrackSettingsVisible(caps);
  const locked = isDemo
    ? { why: "demo" as const, reason: t("settings:blocks.lock.demo") }
    : undefined;

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
      <SectionCard>
        <SectionTitle title={t("settings:tt.groups.aufenthalte")} />
        <SettingRows>
          <StaySuggestionRow id="avor" />
          {travTrack ? (
            <SettingItem
              title={t(`${NS}.stops.name`)}
              sub={t(`${NS}.stops.sub`)}
              help={t(`${NS}.stops.help`)}
              save={write}
              locked={locked}
              control={
                <SwitchControl
                  checked={write.value}
                  onChange={write.choose}
                  label={t(`${NS}.stops.name`)}
                />
              }
            />
          ) : null}
          <SettingItem
            title={t(`${NS}.inbox.name`)}
            control={
              <JumpControl label={t(`${NS}.inbox.jump`)} onJump={() => navigate(INBOX_PATH)} />
            }
          />
        </SettingRows>
      </SectionCard>
      <StayScanSection
        belege={
          <SectionCard>
            <SectionTitle title={t("settings:tt.groups.belege")} />
            <SettingRows>
              <StaySuggestionRow id="immichbeleg" />
            </SettingRows>
          </SectionCard>
        }
        fineBefore={
          <>
            {travTrack ? <TrackGapSetting locked={locked} /> : null}
            {travTrack && caps?.enabled ? (
              <ExpertOnly>
                <TravTrackCitiesRow demo={isDemo} active={caps.active} />
              </ExpertOnly>
            ) : null}
            <ExpertOnly>
              <StaySuggestionRow id="kiort" />
            </ExpertOnly>
          </>
        }
      />
    </div>
  );
}

/** Rows of Feinabstimmung that only the expert level draws; each counts as one hidden setting. */
function ExpertOnly({ children }: { children: ReactNode }): JSX.Element | null {
  return useExpertRows(1) ? <>{children}</> : null;
}
