import type { JSX } from "react";
import { SectionCard, LoadGuardNotice } from "./SettingsShared";
import { useTranslation } from "../../hooks/useTranslation";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import EnrichmentCandidatesPanel from "./EnrichmentCandidatesPanel";
import { SettingRows } from "../ui/SettingRow";
import { SettingItem, SwitchControl, useSettingWrite } from "../ui/settings";
import { NumberSettingRow } from "./NumberSettingRow";

export interface HistoricalEnrichmentSettings {
  enabled: boolean;
  minConfidence: number;
  maxPerDay: number;
}

interface EnrichmentSectionProps {
  historicalEnrichmentSettings: HistoricalEnrichmentSettings;
  /** Whether the values come from the server; anything but "loaded" locks the section. */
  loadState: "loading" | "loaded" | "failed";
  onRetryLoad: () => void;
  /** Writes ONE field; rejects when the server refuses (the row keeps the choice). */
  onSave: (patch: Partial<HistoricalEnrichmentSettings>) => Promise<void>;
}

/** Ältere Flüge ergänzen: only ever suggestions in the inbox, never a silent change. */
export default function EnrichmentSection({
  historicalEnrichmentSettings: settings,
  loadState,
  onRetryLoad,
  onSave,
}: EnrichmentSectionProps): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const isDemo = useIsDemoAccount();

  const enabled = useSettingWrite<boolean>("enrichment.enabled", settings.enabled, (enabled) =>
    onSave({ enabled })
  );
  const confidence = useSettingWrite<number>(
    "enrichment.minConfidence",
    settings.minConfidence,
    (minConfidence) => onSave({ minConfidence })
  );
  const perDay = useSettingWrite<number>("enrichment.maxPerDay", settings.maxPerDay, (maxPerDay) =>
    onSave({ maxPerDay })
  );

  if (loadState !== "loaded") {
    return (
      <SectionCard>
        <LoadGuardNotice
          failed={loadState === "failed"}
          message={t("settings:historicalEnrichment.loadFailed")}
          onRetry={onRetryLoad}
        />
      </SectionCard>
    );
  }

  const locked = isDemo
    ? { why: "demo" as const, reason: t("settings:blocks.lock.demo") }
    : undefined;

  return (
    <SectionCard>
      <SettingRows>
        <SettingItem
          title={t("settings:rows.enrichment.name")}
          sub={t("settings:rows.enrichment.sub")}
          help={t("settings:rows.enrichment.help")}
          expert
          save={enabled}
          locked={locked}
          control={
            <SwitchControl
              checked={enabled.value}
              label={t("settings:rows.enrichment.name")}
              onChange={enabled.choose}
            />
          }
        />
        {settings.enabled && (
          <NumberSettingRow
            expert
            title={t("settings:rows.enrichmentConfidence.name")}
            sub={t("settings:rows.enrichmentConfidence.sub")}
            write={confidence}
            min={0}
            max={100}
            locked={locked}
          />
        )}
        {settings.enabled && (
          <NumberSettingRow
            expert
            title={t("settings:rows.enrichmentPerNight.name")}
            sub={t("settings:rows.enrichmentPerNight.sub")}
            write={perDay}
            min={1}
            max={1000}
            locked={locked}
          />
        )}
      </SettingRows>
      {settings.enabled && <EnrichmentCandidatesPanel />}
    </SectionCard>
  );
}
