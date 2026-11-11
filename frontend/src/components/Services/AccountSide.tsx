import { useRef, useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import {
  ActionControl,
  Dependency,
  ErrorLine,
  SettingItem,
  SwitchControl,
  useSettingWrite,
  SettingWriteError,
} from "../ui/settings";
import { externalServicesApi, type AccountService } from "../../lib/api/externalServices";
import AccountConsentDialog from "../ExternalServices/AccountConsentDialog";
import { serviceName } from "../ExternalServices/serviceText";
import StravaConnectionCard from "../Settings/StravaConnectionCard";
import PhotoJourneyNightlyScanCard from "../Settings/PhotoJourneyNightlyScanCard";
import VisitPhotoImmichLink from "../Settings/VisitPhotoImmichLink";
import ImmichModeRow from "./ImmichModeRow";
import DawarichProviderHint from "../Settings/DawarichProviderHint";
import FieldsGroup from "./FieldsGroup";
import TestRow from "./TestRow";
import WebdavAccountRows from "./WebdavAccountRows";
import { useServices } from "./servicesContext";
import type { ServiceCardDef } from "./serviceCards";
import { useDemoLock } from "./useLockFor";

/** Does this save carry a credential, not just an address or a clear? */
const hasNewSecret = (changes: Record<string, unknown>): boolean =>
  Object.values(changes).some((v) => typeof v === "string" && v.length > 0);

function Strava({ onDisconnected }: { onDisconnected: () => void }): JSX.Element {
  const wasConnected = useRef(false);
  return (
    <StravaConnectionCard
      isAdmin={false}
      onStatus={(status) => {
        if (wasConnected.current && !status.connected) onDisconnected();
        wasConnected.current = status.connected;
      }}
    />
  );
}

/**
 * "Pausieren" (the prototype's card dialog): the account stops using the service without losing
 * its key or connection. Inverted against the stored `accountDisabled`.
 */
function PauseRow({
  service,
  adminOff,
}: {
  service: AccountService;
  adminOff: boolean;
}): JSX.Element {
  const { t } = useTranslation(["settingsRows"]);
  const { account } = useServices();
  const demo = useDemoLock();
  const write = useSettingWrite<boolean>(
    `services.${service.id}.pause`,
    service.accountDisabled,
    async (paused) => {
      try {
        await externalServicesApi.accountUpdate(service.id, { accountDisabled: paused });
      } catch {
        throw new SettingWriteError("rejected");
      }
      await account.reload();
    }
  );
  return (
    <SettingItem
      title={t("settingsRows:services.tpl.pauseMine.t")}
      help={t("settingsRows:services.tpl.pauseMine.h")}
      save={write}
      locked={
        demo ??
        (adminOff
          ? { why: "adminForbade", reason: t("settingsRows:services.tpl.on.us") }
          : undefined)
      }
      control={<SwitchControl checked={write.value} onChange={write.choose} />}
    />
  );
}

/**
 * The account's half of a card ("Für dein Konto"): use it, bring your own key
 * or connection, agree to cloud AI. Credentials written here go to
 * `PUT /settings/external-services/:id` — never to the server's group.
 */
export default function AccountSide({
  card,
  service,
}: {
  card: ServiceCardDef;
  service: AccountService | undefined;
}): JSX.Element | null {
  const { t } = useTranslation(["settingsRows", "externalServices", "settings"]);
  const { account } = useServices();
  const demo = useDemoLock();
  const data = account.data;
  const uses = (u: string): boolean => (card.use as readonly string[]).includes(u);
  const consent = data?.aiConsents.find((c) => c.id === card.id);
  const blocked = data?.blocked.find((b) => b.id === card.id);
  const feedback = account.feedback[card.id];
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [dawarichSaved, setDawarichSaved] = useState(0);
  const name = serviceName(t, card.id);

  const hasRows = uses("mine") || uses("ownKey") || uses("aiConsent") || uses("allowConn");
  if (!hasRows) return null;

  const blockedLine = blocked
    ? t(
        blocked.reason === "disabled"
          ? "settingsRows:services.tpl.on.us"
          : blocked.reason === "keysForbidden"
            ? "settingsRows:services.tpl.allowKeys.us"
            : "settingsRows:services.tpl.allowConn.us"
      )
    : null;

  /** The account's own key or connection as one group, and the check of it. */
  const ownRows = (acct: AccountService): JSX.Element[] => {
    const rows: JSX.Element[] = [];
    if (acct.fields.length > 0) {
      rows.push(
        <FieldsGroup
          key="fields"
          id={`services.${card.id}.account`}
          label={t("settingsRows:services.ui.accountGroup", { name })}
          serviceId={card.id}
          fields={acct.fields}
          secretTemplate="ownKey"
          tests={uses("test")}
          lock={demo}
          errorText={null}
          write={async (changes) => {
            // The refusal is worded on the card (`feedback`); the group keeps the draft.
            // The first own key of a paused account puts the service back on (the prototype's
            // "auto-on"); a paused service that already had a key stays paused.
            const resume = acct.accountDisabled && !acct.configured && hasNewSecret(changes);
            const ok = await account.save(
              card.id,
              resume ? { fields: changes, accountDisabled: false } : { fields: changes },
              uses("test")
            );
            if (!ok) throw new Error("save refused");
            if (card.id === "dawarich") setDawarichSaved((n) => n + 1);
          }}
          onRemoveSecret={async (key) => {
            await account.save(card.id, { fields: { [key]: "" } }, false);
          }}
        />
      );
    }
    if (uses("test") && acct.configured && acct.effectiveSource === "account") {
      rows.push(
        <TestRow
          key="test"
          lastTest={acct.lastTest}
          lock={demo}
          name={name}
          run={() => externalServicesApi.accountTest(card.id)}
          onDone={() => account.reload()}
        />
      );
    }
    return rows;
  };

  const body: JSX.Element[] = [];
  if (uses("aiConsent")) {
    const consented = consent?.consentedAt != null;
    body.push(
      <SettingItem
        key="consent"
        title={t("settingsRows:services.tpl.aiConsent.t")}
        sub={t("settingsRows:services.tpl.aiConsent.s")}
        help={t("settingsRows:services.tpl.aiConsent.h")}
        locked={demo}
        dependency={consent ? undefined : { reason: t("settings:blocks.dep.aiNotAllowed.reason") }}
        control={
          <ActionControl
            label={
              consented
                ? t("settingsRows:services.ui.withdraw")
                : t("settingsRows:services.tpl.aiConsent.btn")
            }
            busy={account.isBusy(card.id)}
            onClick={() => {
              if (!consent) return;
              if (consented) void account.setConsent(consent, false);
              else setConsentOpen(true);
            }}
          />
        }
      >
        {consented ? (
          <p role="status" className="t-caption" style={{ margin: 0 }}>
            {t("settingsRows:services.tpl.aiConsent.res")}
          </p>
        ) : null}
      </SettingItem>
    );
    // A cloud model an account may bring its own key for (Gemini, settings v3 S2): the
    // consent above is still what lets reading bookings send text to it.
    if (uses("ownKey") && service) {
      body.push(...ownRows(service));
      if (service.configured) {
        body.push(
          <PauseRow
            key="pause"
            service={service}
            adminOff={service.effectiveSource === "off" && !service.accountDisabled}
          />
        );
      }
    }
  } else if (service) {
    if (uses("mine")) {
      body.push(
        <PauseRow
          key="mine"
          service={service}
          adminOff={service.effectiveSource === "off" && !service.accountDisabled}
        />
      );
    }
    if (card.id === "strava") {
      body.push(<Strava key="strava" onDisconnected={() => void account.reload()} />);
    } else if (card.id === "webdav") {
      body.push(<WebdavAccountRows key="webdav" />);
    } else {
      body.push(...ownRows(service));
    }
    if (card.id === "dawarich")
      body.push(<DawarichProviderHint key="hint" check={dawarichSaved} />);
    if (card.id === "immich") {
      body.push(<ImmichModeRow key="mode" />);
      body.push(<PhotoJourneyNightlyScanCard key="nightly" />);
      body.push(<VisitPhotoImmichLink key="visit" connected />);
    }
  } else if (blockedLine) {
    body.push(<Dependency key="blocked" reason={blockedLine} />);
  }

  const confirmConsent = async (): Promise<void> => {
    if (!consent) return;
    const failure = await account.setConsent(consent, true);
    if (failure) {
      setConsentError(failure);
      return;
    }
    setConsentOpen(false);
    setConsentError(null);
  };

  return (
    <div
      className="flex flex-col"
      style={{ gap: "var(--ts-space-md)" }}
      data-service-side="account"
    >
      <h3 className="t-card-title">{t("settingsRows:services.ui.accountHead")}</h3>
      {body}
      {feedback ? (
        feedback.kind === "error" ? (
          <ErrorLine>{feedback.text}</ErrorLine>
        ) : (
          <p role="status" className="t-caption" style={{ margin: 0 }}>
            {feedback.text}
          </p>
        )
      ) : null}
      {consentOpen ? (
        <AccountConsentDialog
          name={name}
          busy={account.isBusy(card.id)}
          error={consentError}
          onConfirm={() => void confirmConsent()}
          onClose={() => {
            setConsentOpen(false);
            setConsentError(null);
          }}
        />
      ) : null}
    </div>
  );
}
