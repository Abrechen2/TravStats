import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useRowCopy } from "../Settings/rowCopy";
import { InputControl, SettingItem, useGroupSave } from "../ui/settings";
import { addressProblem } from "./fieldChecks";
import GroupFooter from "./GroupFooter";
import InstanceGate from "./InstanceGate";
import { useInstanceStore } from "./instanceStore";
import type { InstanceSettings } from "../../lib/api/admin";

type Draft = Record<string, string>;

const stack = { gap: "var(--ts-space-md)" } as const;

/**
 * Server › Allgemein › Dein Server (design §1, C1, settings v3 S5): the server's
 * name and its public address, one group with one "Speichern". The public
 * address is required — a missing one makes every invitation, mail and calendar
 * point at localhost — so its row warns (B15) for as long as it is empty, saved
 * or not. The other addresses and the passkey domain have a page of their own
 * ("Adressen & Passkeys", `ServerAddresses`).
 */
export default function ServerGeneral(): JSX.Element {
  return <InstanceGate>{(settings) => <Groups settings={settings} />}</InstanceGate>;
}

function Groups({ settings }: { settings: InstanceSettings }): JSX.Element {
  const { t } = useTranslation(["settingsRows", "settings"]);
  const row = useRowCopy("server");
  const patch = useInstanceStore((s) => s.patch);

  const general = useGroupSave<Draft>({
    id: "server-general",
    label: t("settingsRows:server.groups.general"),
    saved: { instanceName: settings.instanceName, frontendUrl: settings.frontendUrl ?? "" },
    write: async (draft) => {
      const next = await patch({
        instanceName: draft.instanceName.trim(),
        frontendUrl: draft.frontendUrl.trim(),
      });
      return { instanceName: next.instanceName, frontendUrl: next.frontendUrl ?? "" };
    },
  });

  const name = row("instname");
  const address = row("puburl");
  const addressCode = addressProblem(general.draft.frontendUrl);
  const invalid = general.draft.instanceName.trim() === "" || addressCode !== null;
  return (
    <section className="flex flex-col" style={stack}>
      <SettingItem
        title={name.title}
        sub={name.sub}
        scope="allAccounts"
        changed={general.isChanged("instanceName")}
        control={
          <InputControl
            value={general.draft.instanceName}
            onChange={(next) => general.edit({ instanceName: next })}
          />
        }
      />
      <SettingItem
        title={address.title}
        sub={address.sub}
        help={address.help}
        scope="allAccounts"
        changed={general.isChanged("frontendUrl")}
        error={addressCode ? t(`settingsRows:server.errors.${addressCode}`) : undefined}
        required={
          general.draft.frontendUrl.trim() === ""
            ? t("settingsRows:server.publicUrlMissing")
            : undefined
        }
        control={
          <InputControl
            type="url"
            inputMode="url"
            value={general.draft.frontendUrl}
            placeholder="https://travstats.example.com"
            onChange={(next) => general.edit({ frontendUrl: next })}
          />
        }
      />
      <GroupFooter group={general} disabled={invalid} />
    </section>
  );
}
