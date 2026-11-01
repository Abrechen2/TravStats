import { useEffect, useState, type JSX } from "react";
import { SectionCard, LoadGuardNotice } from "./SettingsShared";
import { useTranslation } from "../../hooks/useTranslation";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { pendingUpdatesApi } from "../../lib/api/pendingUpdates";
import { logger } from "../../lib/logger";
import { SettingRows } from "../ui/SettingRow";
import {
  JumpControl,
  SettingItem,
  SwitchControl,
  useGuardedNavigate,
  useSettingWrite,
} from "../ui/settings";
import { useExpertRows } from "./frame/useExpertRows";
import { NumberSettingRow } from "./NumberSettingRow";

export interface AutoUpdateSettings {
  enabled: boolean;
  requireApproval: boolean;
  checkInterval: number;
  onlyDuringFlight: boolean;
  expiryHours: number;
}

interface AutoUpdateSectionProps {
  autoUpdateSettings: AutoUpdateSettings;
  /** Whether the values come from the server; anything but "loaded" locks the section. */
  loadState: "loading" | "loaded" | "failed";
  onRetryLoad: () => void;
  /** Writes ONE field; rejects when the server refuses (the row keeps the choice). */
  onSave: (patch: Partial<AutoUpdateSettings>) => Promise<void>;
  /** False when no flight data service is usable for this account; null while unknown. */
  flightDataAvailable?: boolean | null;
}

/** Live-Updates: whether they run, whether they wait for approval, how long they stay open. */
export default function AutoUpdateSection({
  autoUpdateSettings: settings,
  loadState,
  onRetryLoad,
  onSave,
  flightDataAvailable = null,
}: AutoUpdateSectionProps): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const isDemo = useIsDemoAccount();
  const navigate = useGuardedNavigate();
  // Checks follow the fixed per-flight schedule (forgejo#389); the interval and
  // "only during flight" are gone from the screen. The expiry is tuning.
  const expert = useExpertRows(settings.enabled ? 1 : 0);
  const [open, setOpen] = useState<number | null>(null);

  const loaded = loadState === "loaded";
  useEffect(() => {
    if (!loaded) return;
    let alive = true;
    pendingUpdatesApi
      .getAll({ status: "pending" })
      .then((r) => alive && setOpen(r.count))
      .catch((error: unknown) => logger.warn("Failed to count open updates", error));
    return () => {
      alive = false;
    };
  }, [loaded]);

  const enabled = useSettingWrite<boolean>("autoUpdate.enabled", settings.enabled, (enabled) =>
    onSave({ enabled })
  );
  const approval = useSettingWrite<boolean>(
    "autoUpdate.requireApproval",
    settings.requireApproval,
    (requireApproval) => onSave({ requireApproval })
  );
  const expiry = useSettingWrite<number>(
    "autoUpdate.expiryHours",
    settings.expiryHours,
    (expiryHours) => onSave({ expiryHours })
  );

  if (loadState !== "loaded") {
    return (
      <SectionCard>
        <LoadGuardNotice
          failed={loadState === "failed"}
          message={t("settings:autoUpdate.loadFailed")}
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
          title={t("settings:rows.liveUpdates.name")}
          sub={t("settings:rows.liveUpdates.sub")}
          save={enabled}
          locked={locked}
          dependency={
            flightDataAvailable === false
              ? {
                  reason: t("settings:rows.liveUpdates.noFlightData"),
                  jump: {
                    label: t("settings:rows.liveUpdates.toServices"),
                    onJump: () => navigate("/settings/services"),
                  },
                }
              : undefined
          }
          control={
            <SwitchControl
              checked={enabled.value}
              label={t("settings:rows.liveUpdates.name")}
              onChange={enabled.choose}
            />
          }
        />
        {settings.enabled && (
          <SettingItem
            title={t("settings:rows.approveUpdates.name")}
            save={approval}
            locked={locked}
            control={
              <SwitchControl
                checked={approval.value}
                label={t("settings:rows.approveUpdates.name")}
                onChange={approval.choose}
              />
            }
          />
        )}
        {settings.enabled && expert && (
          <NumberSettingRow
            expert
            title={t("settings:rows.updateExpiry.name")}
            sub={t("settings:rows.updateExpiry.sub")}
            write={expiry}
            min={1}
            max={168}
            locked={locked}
          />
        )}
        <SettingItem
          title={t("settings:rows.openUpdates.name")}
          control={
            <>
              {open !== null && (
                <span className="t-caption">
                  {t("settings:rows.openUpdates.count", { count: open })}
                </span>
              )}
              <JumpControl
                label={t("settings:autoUpdate.viewPending")}
                onJump={() => navigate("/pending-updates")}
              />
            </>
          }
        />
      </SettingRows>
    </SectionCard>
  );
}
