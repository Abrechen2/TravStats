import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useRowCopy } from "../Settings/rowCopy";
import { ChoiceControl, InputControl, SettingItem, useGroupSave } from "../ui/settings";
import { LoginBackgroundsCard } from "../Admin/LoginBackgroundsCard";
import { useExpertRows } from "../Settings/frame/useExpertRows";
import GroupFooter from "./GroupFooter";
import InstanceGate from "./InstanceGate";
import { useInstanceStore } from "./instanceStore";
import type { InstanceSettings } from "../../lib/api/admin";

type Draft = { maxUsers: string; allowRegistration: boolean };

const MIN = 1;
const MAX = 1000;

/**
 * Allgemein › Zugang & Konten (design C1, settings v3 S5): whether anyone may
 * sign up, how many accounts there may be and — for the expert level — the
 * pictures of the sign-in page.
 */
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
  const expert = useExpertRows(1);
  const max = row("maxnutzer");
  const reg = row("registr");
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
      <SettingItem
        title={reg.title}
        help={reg.help}
        scope="allAccounts"
        changed={group.isChanged("allowRegistration")}
        control={
          <ChoiceControl<"invite" | "open">
            label={reg.title}
            value={group.draft.allowRegistration ? "open" : "invite"}
            options={[
              { value: "invite", label: t("settingsRows:users.registr.o.0") },
              { value: "open", label: t("settingsRows:users.registr.o.1") },
            ]}
            onChange={(next) => group.edit({ allowRegistration: next === "open" })}
          />
        }
      />
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
      <GroupFooter group={group} disabled={invalid} />
      {/* Outside the group, deliberately: an upload takes effect when it succeeds. */}
      {expert ? <LoginBackgroundsCard /> : null}
    </div>
  );
}
