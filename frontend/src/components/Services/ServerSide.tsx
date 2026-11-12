import { useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import {
  ErrorLine,
  SettingItem,
  SettingWriteError,
  StatusValue,
  SwitchControl,
  useSettingWrite,
} from "../ui/settings";
import {
  externalServicesApi,
  type AdminConnectionPolicy,
  type AdminService,
} from "../../lib/api/externalServices";
import AdminConsentDialog from "../ExternalServices/AdminConsentDialog";
import { serviceName } from "../ExternalServices/serviceText";
import { useInternetDependency } from "../ServerPages/useInternetDependency";
import FieldsGroup from "./FieldsGroup";
import QuotaRow from "./QuotaRow";
import TestRow from "./TestRow";
import { ServerExtras, ownsEnabledSwitch, ownsFields } from "./serverExtras";
import { useServices } from "./servicesContext";
import {
  INTERNET_GATED_SWITCH_CARDS,
  OUTBOUND_EXPERT_FIELDS,
  type ServiceCardDef,
} from "./serviceCards";
import { useDemoLock } from "./useLockFor";

/** The "Alle Konten" switch rows of one service, each its own immediate write. */
function SwitchRows({
  card,
  service,
  connection,
}: {
  card: ServiceCardDef;
  service: AdminService | undefined;
  connection: AdminConnectionPolicy | undefined;
}): JSX.Element {
  const { t } = useTranslation(["settingsRows"]);
  const { admin } = useServices();
  const demo = useDemoLock();
  const internet = useInternetDependency();
  const uses = (u: string): boolean => (card.use as readonly string[]).includes(u);
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const cloud = service?.consent !== undefined;
  const reload = async (): Promise<void> => {
    await admin?.reload();
  };
  const refuse = (): never => {
    throw new SettingWriteError("rejected");
  };

  const on = useSettingWrite<boolean>(
    `services.${card.id}.on`,
    service?.enabled ?? false,
    async (v) => {
      try {
        await externalServicesApi.adminUpdate(card.id, { enabled: v });
      } catch {
        refuse();
      }
      await reload();
    }
  );
  const allowKeys = useSettingWrite<boolean>(
    `services.${card.id}.allowKeys`,
    service?.allowAccountKeys ?? true,
    async (v) => {
      try {
        await externalServicesApi.adminUpdate(card.id, { allowAccountKeys: v });
      } catch {
        refuse();
      }
      await reload();
    }
  );
  const allowConn = useSettingWrite<boolean>(
    `services.${card.id}.allowConn`,
    connection?.allowed ?? true,
    async (v) => {
      try {
        await externalServicesApi.adminSetConnection(card.id as AdminConnectionPolicy["id"], v);
      } catch {
        refuse();
      }
      await reload();
    }
  );

  const confirmAllow = async (): Promise<void> => {
    if (!admin) return;
    const failure = await admin.setEnabled(card.id, true, true);
    if (failure) {
      setConsentError(failure);
      return;
    }
    setConsentOpen(false);
    setConsentError(null);
  };

  return (
    <>
      {uses("always") ? (
        <SettingItem
          title={t("settingsRows:services.tpl.always.t")}
          sub={t("settingsRows:services.tpl.always.s")}
          scope="allAccounts"
          control={<StatusValue>{t("settingsRows:services.status.always")}</StatusValue>}
        />
      ) : null}
      {service && uses("aiAllow") && !ownsEnabledSwitch(card.id) ? (
        <SettingItem
          title={t("settingsRows:services.tpl.aiAllow.t")}
          sub={t("settingsRows:services.tpl.aiAllow.s")}
          help={t("settingsRows:services.tpl.aiAllow.h")}
          scope="allAccounts"
          locked={demo}
          dependency={INTERNET_GATED_SWITCH_CARDS.has(card.id) ? internet : undefined}
          save={cloud ? undefined : on}
          control={
            <SwitchControl
              checked={cloud ? service.enabled : on.value}
              onChange={(next) => {
                if (cloud && next) setConsentOpen(true);
                else if (cloud) void admin?.setEnabled(card.id, false);
                else on.choose(next);
              }}
            />
          }
        />
      ) : null}
      {/* "Pausieren" (the prototype's card dialog): a service with something to pause. It starts
          on by itself with its first key (ServerSide `write`), so there is no separate "on". */}
      {service &&
      uses("on") &&
      !uses("aiAllow") &&
      !ownsEnabledSwitch(card.id) &&
      (service.configured || service.keyless || service.enabled) ? (
        <SettingItem
          title={t("settingsRows:services.tpl.pause.t")}
          sub={t("settingsRows:services.tpl.pause.s")}
          help={t("settingsRows:services.tpl.pause.h")}
          scope="allAccounts"
          locked={demo}
          dependency={INTERNET_GATED_SWITCH_CARDS.has(card.id) ? internet : undefined}
          save={cloud ? undefined : on}
          control={
            <SwitchControl
              checked={cloud ? !service.enabled : !on.value}
              onChange={(paused) => {
                if (cloud && !paused) setConsentOpen(true);
                else if (cloud) void admin?.setEnabled(card.id, false);
                else on.choose(!paused);
              }}
            />
          }
        />
      ) : null}
      {service && uses("allowKeys") && service.allowAccountKeys !== null ? (
        <SettingItem
          title={t("settingsRows:services.tpl.allowKeys.t")}
          scope="allAccounts"
          locked={demo}
          save={allowKeys}
          control={<SwitchControl checked={allowKeys.value} onChange={allowKeys.choose} />}
        />
      ) : null}
      {connection && uses("allowConn") ? (
        <SettingItem
          title={t("settingsRows:services.tpl.allowConn.t")}
          help={t("settingsRows:services.tpl.allowConn.h")}
          scope="allAccounts"
          locked={demo}
          save={allowConn}
          control={<SwitchControl checked={allowConn.value} onChange={allowConn.choose} />}
        >
          <p className="t-caption" style={{ margin: 0 }}>
            {t("settingsRows:services.ui.connectedAccounts", {
              count: connection.connectedAccounts,
            })}
          </p>
        </SettingItem>
      ) : null}
      {consentOpen ? (
        <AdminConsentDialog
          serviceId={card.id}
          busy={admin?.isBusy(card.id) ?? false}
          error={consentError}
          onConfirm={() => void confirmAllow()}
          onClose={() => {
            setConsentOpen(false);
            setConsentError(null);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * The server's half of a card ("Alle Konten"), for admins: the switch, the
 * server's own key or connection, whether accounts may bring theirs, the quota.
 * It reads and writes `/admin/external-services` — never the account's group.
 */
export default function ServerSide({ card }: { card: ServiceCardDef }): JSX.Element | null {
  const { t } = useTranslation(["settingsRows", "externalServices"]);
  const { admin } = useServices();
  const demo = useDemoLock();
  const uses = (u: string): boolean => (card.use as readonly string[]).includes(u);
  // A remote Ollama is "cloud" for the data it is sent: turning that on asks first.
  const [ask, setAsk] = useState<((agreed: boolean) => void) | null>(null);
  const data = admin?.data;
  if (!admin || !data) return null;
  const service = data.categories.flatMap((c) => c.services).find((s) => s.id === card.id);
  const connection = data.accountConnections.find((c) => c.id === card.id);
  const feedback = admin.feedback[card.id];
  const name = serviceName(t, card.id);
  const cardFields = (service?.fields ?? []).filter(
    (f) => !OUTBOUND_EXPERT_FIELDS.has(`${card.id}.${f.key}`)
  );

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }} data-service-side="server">
      <div>
        <h3 className="t-card-title">{t("settingsRows:services.ui.serverHead")}</h3>
        <p className="t-caption" style={{ margin: 0 }}>
          {t("settingsRows:services.ui.serverHint")}
        </p>
      </div>
      <SwitchRows card={card} service={service} connection={connection} />
      {service && cardFields.length > 0 && !ownsFields(card.id) ? (
        <FieldsGroup
          id={`services.${card.id}.server`}
          label={t("settingsRows:services.ui.serverGroup", { name })}
          serviceId={card.id}
          fields={cardFields}
          secretTemplate="instKey"
          tests={uses("test")}
          lock={demo}
          errorText={null}
          write={async (changes) => {
            // The refusal is worded on the card (`feedback`); the group keeps the draft.
            const remote = changes.remoteOptIn === true;
            if (remote && !(await new Promise<boolean>((resolve) => setAsk(() => resolve)))) {
              throw new Error("consent declined");
            }
            if (!(await admin.write(card.id, changes, remote))) throw new Error("save refused");
            // The first key switches the service on (the prototype's "auto-on"). A service that
            // was configured before and is off was paused on purpose and stays paused; a cloud
            // model still needs the admin's data-sharing confirmation, so it is asked for here.
            const firstKey =
              !service?.configured &&
              !service?.enabled &&
              uses("on") &&
              Object.values(changes).some((v) => typeof v === "string" && v.length > 0);
            if (firstKey) {
              if (service?.consent !== undefined) {
                if (await new Promise<boolean>((resolve) => setAsk(() => resolve))) {
                  await admin.setEnabled(card.id, true, true);
                }
              } else {
                await admin.setEnabled(card.id, true);
              }
            }
            if (uses("test")) await admin.test(card.id);
          }}
          onRemoveSecret={async (key) => {
            await admin.write(card.id, { [key]: "" });
          }}
        />
      ) : null}
      <ServerExtras card={card} service={service} />
      {service && uses("quota") ? <QuotaRow quota={service.quota} /> : null}
      {service && !uses("quota") && service.quota?.kind === "budget" ? (
        <QuotaRow quota={service.quota} />
      ) : null}
      {service && uses("test") ? (
        <TestRow
          lastTest={service.lastTest}
          name={name}
          lock={demo}
          run={() => externalServicesApi.adminTest(card.id)}
          onDone={() => admin.reload()}
        />
      ) : null}
      {feedback?.kind === "error" ? <ErrorLine>{feedback.text}</ErrorLine> : null}
      {ask ? (
        <AdminConsentDialog
          serviceId={card.id}
          busy={false}
          error={null}
          onConfirm={() => {
            ask(true);
            setAsk(null);
          }}
          onClose={() => {
            ask(false);
            setAsk(null);
          }}
        />
      ) : null}
    </div>
  );
}
