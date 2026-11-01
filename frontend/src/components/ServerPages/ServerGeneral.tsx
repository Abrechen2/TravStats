import { useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useExpertRows } from "../Settings/frame/useExpertRows";
import { useDialogCopy, useRowCopy } from "../Settings/rowCopy";
import {
  ConfirmDialog,
  InputControl,
  SettingItem,
  TextAreaControl,
  useGroupSave,
} from "../ui/settings";
import { LoginBackgroundsCard } from "../Admin/LoginBackgroundsCard";
import { addressProblem, originsProblem, parseOrigins, rpIdProblem } from "./fieldChecks";
import GroupFooter from "./GroupFooter";
import InstanceGate from "./InstanceGate";
import { useInstanceStore } from "./instanceStore";
import SubHeading from "./SubHeading";
import type { InstanceSettings } from "../../lib/api/admin";

type Draft = Record<string, string>;

const stack = { gap: "var(--ts-space-md)" } as const;

/**
 * Server › Allgemein, Adressen and Passkeys (design §1, C1): three groups with
 * their own "Speichern". The public address is required — a missing one makes
 * every invitation, mail and calendar point at localhost — so its row warns
 * (B15) for as long as it is empty, saved or not.
 */
export default function ServerGeneral(): JSX.Element {
  return <InstanceGate>{(settings) => <Groups settings={settings} />}</InstanceGate>;
}

function Groups({ settings }: { settings: InstanceSettings }): JSX.Element {
  const { t } = useTranslation(["settingsRows", "admin", "settings"]);
  const row = useRowCopy("server");
  const dialog = useDialogCopy();
  const patch = useInstanceStore((s) => s.patch);
  const passkeyStatus = useInstanceStore((s) => s.passkeyStatus);
  const expert = useExpertRows(3);
  const [asking, setAsking] = useState(false);

  const general = useGroupSave<Draft>({
    id: "server-general",
    label: t("settingsRows:server.groups.general"),
    saved: { instanceName: settings.instanceName },
    write: async (draft) => {
      const next = await patch({ instanceName: draft.instanceName.trim() });
      return { instanceName: next.instanceName };
    },
  });

  const addresses = useGroupSave<Draft>({
    id: "server-addresses",
    label: t("settingsRows:server.groups.addresses"),
    saved: {
      frontendUrl: settings.frontendUrl ?? "",
      publicUrl: settings.publicUrl ?? "",
      lanUrl: settings.lanUrl ?? "",
    },
    write: async (draft) => {
      const next = await patch({
        frontendUrl: draft.frontendUrl.trim(),
        publicUrl: draft.publicUrl.trim(),
        lanUrl: draft.lanUrl.trim(),
      });
      return {
        frontendUrl: next.frontendUrl ?? "",
        publicUrl: next.publicUrl ?? "",
        lanUrl: next.lanUrl ?? "",
      };
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
    id: "puburl" | "pairurl" | "lanurl",
    field: "frontendUrl" | "publicUrl" | "lanUrl",
    placeholder: string,
    required?: boolean
  ): JSX.Element => {
    const copy = row(id);
    const value = addresses.draft[field];
    return (
      <SettingItem
        title={copy.title}
        sub={copy.sub}
        help={copy.help}
        scope="allAccounts"
        expert={id === "lanurl"}
        changed={addresses.isChanged(field)}
        error={problem(addressProblem(value))}
        required={
          required && value.trim() === "" ? t("settingsRows:server.publicUrlMissing") : undefined
        }
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
    addressProblem(addresses.draft.frontendUrl) !== null ||
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

  const name = row("instname");
  const rp = row("rpid");
  const origins = row("origins");
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-xl)" }}>
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
        <GroupFooter group={general} disabled={general.draft.instanceName.trim() === ""} />
        {/* Outside the group, deliberately: an upload takes effect when it succeeds. */}
        <LoginBackgroundsCard />
      </section>

      <section className="flex flex-col" style={stack}>
        <SubHeading id="addresses">{t("settingsRows:server.sections.addresses")}</SubHeading>
        {urlRow("puburl", "frontendUrl", "https://travstats.example.com", true)}
        {urlRow("pairurl", "publicUrl", "https://trav.example.de")}
        {expert ? urlRow("lanurl", "lanUrl", "http://192.168.1.10:3010") : null}
        <GroupFooter group={addresses} disabled={addressesInvalid} />
      </section>

      {expert ? (
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
      ) : null}
    </div>
  );
}
