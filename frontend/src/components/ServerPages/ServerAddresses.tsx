import { useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useDialogCopy, useRowCopy } from "../Settings/rowCopy";
import {
  ConfirmDialog,
  InputControl,
  SettingItem,
  TextAreaControl,
  useGroupSave,
} from "../ui/settings";
import { addressProblem, originsProblem, parseOrigins, rpIdProblem } from "./fieldChecks";
import GroupFooter from "./GroupFooter";
import InstanceGate from "./InstanceGate";
import { useInstanceStore } from "./instanceStore";
import SubHeading from "./SubHeading";
import type { InstanceSettings } from "../../lib/api/admin";

type Draft = Record<string, string>;

const stack = { gap: "var(--ts-space-md)" } as const;

/**
 * Server › Adressen & Passkeys (expert page, settings v3 S5): the address for
 * phones, the address in the own network and the passkey domain with its allowed
 * addresses — two groups with their own "Speichern". The public address itself
 * is a row of "Allgemein".
 */
export default function ServerAddresses(): JSX.Element {
  return <InstanceGate>{(settings) => <Groups settings={settings} />}</InstanceGate>;
}

function Groups({ settings }: { settings: InstanceSettings }): JSX.Element {
  const { t } = useTranslation(["settingsRows", "admin", "settings"]);
  const row = useRowCopy("server");
  const dialog = useDialogCopy();
  const patch = useInstanceStore((s) => s.patch);
  const passkeyStatus = useInstanceStore((s) => s.passkeyStatus);
  const [asking, setAsking] = useState(false);

  const addresses = useGroupSave<Draft>({
    id: "server-addresses",
    label: t("settingsRows:server.groups.addresses"),
    saved: { publicUrl: settings.publicUrl ?? "", lanUrl: settings.lanUrl ?? "" },
    write: async (draft) => {
      const next = await patch({
        publicUrl: draft.publicUrl.trim(),
        lanUrl: draft.lanUrl.trim(),
      });
      return { publicUrl: next.publicUrl ?? "", lanUrl: next.lanUrl ?? "" };
    },
  });

  const savedRpId = settings.webauthnRpId ?? "";
  const passkeys = useGroupSave<Draft>({
    id: "server-passkeys",
    label: t("settingsRows:server.groups.passkeys"),
    saved: { rpId: savedRpId, origins: settings.webauthnOrigins.join("\n") },
    write: async (draft) => {
      const next = await patch({
        webauthnRpId: draft.rpId.trim(),
        webauthnOrigins: parseOrigins(draft.origins),
      });
      return { rpId: next.webauthnRpId ?? "", origins: next.webauthnOrigins.join("\n") };
    },
  });

  const problem = (code: "scheme" | "domain" | null): string | undefined =>
    code ? t(`settingsRows:server.errors.${code}`) : undefined;
  const urlRow = (
    id: "pairurl" | "lanurl",
    field: "publicUrl" | "lanUrl",
    placeholder: string
  ): JSX.Element => {
    const copy = row(id);
    const value = addresses.draft[field];
    return (
      <SettingItem
        title={copy.title}
        sub={copy.sub}
        help={copy.help}
        scope="allAccounts"
        changed={addresses.isChanged(field)}
        error={problem(addressProblem(value))}
        control={
          <InputControl
            type="url"
            inputMode="url"
            value={value}
            placeholder={placeholder}
            onChange={(next) => addresses.edit({ [field]: next })}
          />
        }
      />
    );
  };

  const addressesInvalid =
    addressProblem(addresses.draft.publicUrl) !== null ||
    addressProblem(addresses.draft.lanUrl) !== null;
  const passkeysInvalid =
    rpIdProblem(passkeys.draft.rpId) !== null || originsProblem(passkeys.draft.origins) !== null;
  // A credential is bound to the domain it was made on: changing a domain that is
  // already set voids every passkey of every account, so it asks first.
  const rpIdChange = savedRpId !== "" && passkeys.draft.rpId.trim() !== savedRpId;
  const rpFooter = {
    ...passkeys,
    save: async (): Promise<boolean> => {
      if (rpIdChange) {
        setAsking(true);
        return false;
      }
      return passkeys.save();
    },
  };

  const rp = row("rpid");
  const origins = row("origins");
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-xl)" }}>
      <section className="flex flex-col" style={stack}>
        <SubHeading id="addresses">{t("settingsRows:server.sections.addresses")}</SubHeading>
        {urlRow("pairurl", "publicUrl", "https://trav.example.de")}
        {urlRow("lanurl", "lanUrl", "http://192.168.1.10:3010")}
        <GroupFooter group={addresses} disabled={addressesInvalid} />
      </section>

      <section className="flex flex-col" style={stack}>
        <SubHeading id="passkeys" expert>
          {t("settingsRows:server.sections.passkeys")}
        </SubHeading>
        {passkeyStatus ? (
          <p
            role="status"
            className="t-caption"
            style={{ color: passkeyStatus.usable ? "var(--ts-good)" : "var(--ts-muted)" }}
          >
            {passkeyStatus.usable
              ? t("admin:instance.passkeys.statusUsable")
              : t(`admin:instance.passkeys.status.${passkeyStatus.reason ?? "notConfigured"}`)}
          </p>
        ) : null}
        <SettingItem
          title={rp.title}
          sub={rp.sub}
          help={rp.help}
          scope="allAccounts"
          expert
          changed={passkeys.isChanged("rpId")}
          error={problem(rpIdProblem(passkeys.draft.rpId))}
          control={
            <InputControl
              value={passkeys.draft.rpId}
              placeholder="travstats.example.com"
              onChange={(next) => passkeys.edit({ rpId: next })}
            />
          }
        />
        <SettingItem
          title={origins.title}
          sub={origins.sub}
          help={origins.help}
          scope="allAccounts"
          expert
          changed={passkeys.isChanged("origins")}
          error={problem(originsProblem(passkeys.draft.origins))}
          control={
            <TextAreaControl
              value={passkeys.draft.origins}
              placeholder={"https://travstats.example.com\nhttps://www.travstats.example.com"}
              onChange={(next) => passkeys.edit({ origins: next })}
            />
          }
        />
        <GroupFooter group={rpFooter} disabled={passkeysInvalid} />
        <ConfirmDialog
          open={asking}
          {...dialog("rpid")}
          busy={passkeys.state === "saving"}
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            void passkeys.save();
          }}
        />
      </section>
    </div>
  );
}
