import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useSettingsStore, type UnitsSettings } from "../../store/settingsStore";
import { ChoiceControl, SettingItem, useSettingWrite } from "../ui/settings";

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
  const write = useSettingWrite<V>(`units.${field}`, saved, async (value, { keepalive }) => {
    const store = useSettingsStore.getState();
    store.setUnits({ [field]: value } as Partial<UnitsSettings>);
    await store.saveRemoteSettings({ keepalive });
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
