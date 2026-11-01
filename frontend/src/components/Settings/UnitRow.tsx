import { useEffect, useRef, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useRemoteSettingsStatus } from "../../store/remoteSettingsStatus";
import { useSettingsStore, type UnitsSettings } from "../../store/settingsStore";
import { ChoiceControl, SettingItem, SettingWriteError, useSettingWrite } from "../ui/settings";

type UnitField = "distanceUnit" | "weightUnit";

interface UnitRowProps<V extends string> {
  field: UnitField;
  title: string;
  sub: string;
  saved: V;
  values: readonly V[];
  shortLabel: (value: V) => string;
  name: (value: V) => string;
  locked: boolean;
}

/**
 * A units choice on the new building blocks: the REFERENCE page of the
 * settings rebuild (package 2). It writes immediately, shows the row's save
 * state, and keeps the user's pick when the server refuses — "Verwerfen" then
 * brings the last saved unit back.
 */
export function UnitRow<V extends string>({
  field,
  title,
  sub,
  saved,
  values,
  shortLabel,
  name,
  locked,
}: UnitRowProps<V>): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const savedRef = useRef(saved);
  useEffect(() => {
    savedRef.current = saved;
  });
  const write = useSettingWrite<V>(`units.${field}`, saved, async (value, { keepalive }) => {
    // Settings that never loaded must not be written over the server's (the
    // same guard the document autosave holds, forgejo#372).
    if (useRemoteSettingsStatus.getState().failed) throw new SettingWriteError("notLoaded");
    const store = useSettingsStore.getState();
    const previous = savedRef.current;
    store.setUnits({ [field]: value } as Partial<UnitsSettings>);
    try {
      await store.saveRemoteSettings({ keepalive });
    } catch (error) {
      // The row keeps the CHOICE; the store goes back to what the server holds,
      // so no later save of the document carries the refused value.
      useSettingsStore.getState().setUnits({ [field]: previous } as Partial<UnitsSettings>);
      throw error;
    }
  });
  return (
    <SettingItem
      title={title}
      sub={sub}
      save={write}
      locked={locked ? { why: "demo", reason: t("settings:blocks.lock.demo") } : undefined}
      control={
        <ChoiceControl<V>
          label={title}
          value={write.value}
          options={values.map((value) => ({ value, label: shortLabel(value), name: name(value) }))}
          onChange={write.choose}
        />
      }
    />
  );
}
