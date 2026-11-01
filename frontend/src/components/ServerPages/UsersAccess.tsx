import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useRowCopy } from "../Settings/rowCopy";
import { InputControl, SettingItem, SwitchControl, useGroupSave } from "../ui/settings";
import GroupFooter from "./GroupFooter";
import InstanceGate from "./InstanceGate";
import { useInstanceStore } from "./instanceStore";
import type { InstanceSettings } from "../../lib/api/admin";

type Draft = { maxUsers: string; allowRegistration: boolean };

const MIN = 1;
const MAX = 1000;

/** Users › Zugang (design C1): how many accounts and whether anyone may sign up. */
export default function UsersAccess(): JSX.Element {
  return <InstanceGate>{(settings) => <Access settings={settings} />}</InstanceGate>;
}

function Access({ settings }: { settings: InstanceSettings }): JSX.Element {
  const { t } = useTranslation(["settingsRows"]);
  const row = useRowCopy("users");
  const patch = useInstanceStore((s) => s.patch);
  const group = useGroupSave<Draft>({
    id: "users-access",
    label: t("settingsRows:users.groups.access"),
    saved: { maxUsers: String(settings.maxUsers), allowRegistration: settings.allowRegistration },
    write: async (draft) => {
      const next = await patch({
        maxUsers: Number(draft.maxUsers),
        allowRegistration: draft.allowRegistration,
      });
      return { maxUsers: String(next.maxUsers), allowRegistration: next.allowRegistration };
    },
  });
  const n = Number(group.draft.maxUsers);
  const invalid = !Number.isInteger(n) || n < MIN || n > MAX;
  const max = row("maxnutzer");
  const reg = row("registr");
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
      <SettingItem
        title={max.title}
        scope="allAccounts"
        changed={group.isChanged("maxUsers")}
        error={invalid ? t("settingsRows:users.errors.range", { min: MIN, max: MAX }) : undefined}
        control={
          <InputControl
            type="number"
            inputMode="numeric"
            value={group.draft.maxUsers}
            onChange={(next) => group.edit({ maxUsers: next })}
          />
        }
      />
      <SettingItem
        title={reg.title}
        help={reg.help}
        scope="allAccounts"
        changed={group.isChanged("allowRegistration")}
        control={
          <SwitchControl
            checked={group.draft.allowRegistration}
            onChange={(next) => group.edit({ allowRegistration: next })}
          />
        }
      />
      <GroupFooter group={group} disabled={invalid} />
    </div>
  );
}
