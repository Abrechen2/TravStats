import { useRef, useState, type JSX, type ReactNode } from "react";
import { Card } from "../ui/Card";
import Button from "../ui/Button";
import PhotoJourneyNightlyScanCard from "../Settings/PhotoJourneyNightlyScanCard";
import StravaConnectionCard from "../Settings/StravaConnectionCard";
import { WebdavSyncPanel } from "../Settings/WebdavSyncRow";
import { useTranslation } from "../../hooks/useTranslation";
import { useToursVisible } from "../../hooks/useToursVisible";
import { useEffectiveSettingsLevel } from "../../store/settingsLevelStore";
import type { AccountAiConsent, AccountService } from "../../lib/api/externalServices";
import AccountConsentDialog from "./AccountConsentDialog";
import { AccountFieldsForm, AccountRow, accountDetail } from "./AccountServiceRow";
import InstanceProvided from "./InstanceProvided";
import ServiceInfoDialog from "./ServiceInfoDialog";
import { useAccountServices } from "./useAccountServices";
import { accountStatus } from "./serviceStatus";
import { serviceName } from "./serviceText";

/**
 * Strava has its own connect flow (OAuth), so the row embeds the card. The
 * card knows first when the athlete is disconnected; the row's pill and line
 * come from the page's own data, which is reloaded then.
 */
function StravaEmbedded({ onDisconnected }: { onDisconnected: () => void }): JSX.Element {
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

function Section({
  id,
  title,
  hint,
  children,
}: {
  id: string;
  title: string;
  hint: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section
      className="flex flex-col"
      style={{ gap: "var(--ts-space-md)" }}
      data-account-section={id}
    >
      <div>
        <h2 className="t-card-title">{title}</h2>
        <p className="t-caption">{hint}</p>
      </div>
      <Card flush>{children}</Card>
    </section>
  );
}

/**
 * Einstellungen › Dienste (forgejo#392): what this account connects itself, the
 * keys it may bring, and its consent to cloud AI — in the same row the admin
 * page uses. What the instance provides for everyone is below, read-only.
 */
export default function AccountExternalServices(): JSX.Element {
  const { t } = useTranslation(["externalServices"]);
  const expert = useEffectiveSettingsLevel() === "expert";
  const services = useAccountServices();
  const toursVisible = useToursVisible();
  const [openId, setOpenId] = useState<string | null>(null);
  const [infoId, setInfoId] = useState<string | null>(null);
  const [consentFor, setConsentFor] = useState<AccountAiConsent | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);
  const { data } = services;

  if (services.loadError && !data) {
    return (
      <Card>
        <p role="alert" style={{ color: "var(--ts-bad)" }}>
          {services.loadError}
        </p>
        <Button variant="secondary" onClick={() => void services.reload()}>
          {t("externalServices:actions.retry")}
        </Button>
      </Card>
    );
  }
  if (!data) return <p className="t-caption">{t("externalServices:loading")}</p>;

  // Tours (and so their routing keys and the Strava import) sit behind the
  // `roadtrips` beta key, as the pre-forgejo#392 cards did. Admin view is ungated.
  const TOURS_ONLY = ["openrouteservice", "graphhopper", "strava"];
  const shown = <T extends { id: string }>(list: T[]): T[] =>
    toursVisible ? list : list.filter((s) => !TOURS_ONLY.includes(s.id));
  const connections = shown(data.connections);
  const ownKeys = shown(data.ownKeys);

  const everyService: Array<{ id: string; recommended: AccountService["recommended"] }> = [
    ...connections,
    ...ownKeys,
    ...data.aiConsents.map((c) => ({ id: c.id, recommended: null })),
  ];
  const info = everyService.find((s) => s.id === infoId);

  const close = (): void => setOpenId(null);

  const rowFor = (service: AccountService, kind: "connection" | "key"): JSX.Element => {
    const status = accountStatus(service, kind);
    const isStrava = service.id === "strava";
    const open = openId === service.id;
    const busy = services.isBusy(service.id);
    const own = service.effectiveSource === "account";
    const actionLabel =
      kind === "key" && service.accountDisabled
        ? t("externalServices:account.action.turnOn")
        : own
          ? t(
              isStrava
                ? "externalServices:account.action.manage"
                : "externalServices:account.action.change"
            )
          : t(
              kind === "key"
                ? "externalServices:account.action.addOwn"
                : service.id === "webdav"
                  ? "externalServices:account.action.setUp"
                  : "externalServices:account.action.connect"
            );
    return (
      <AccountRow
        key={service.id}
        id={service.id}
        recommended={service.recommended}
        status={status}
        detail={accountDetail(t, service, status)}
        feedback={services.feedback[service.id] ?? null}
        busy={busy}
        actionLabel={actionLabel}
        open={open}
        onInfo={() => setInfoId(service.id)}
        onAction={() => {
          if (kind === "key" && service.accountDisabled) {
            void services.save(service.id, { accountDisabled: false }, false);
            return;
          }
          setOpenId(open ? null : service.id);
        }}
        expanded={
          isStrava ? (
            <StravaEmbedded onDisconnected={() => void services.reload()} />
          ) : service.id === "webdav" ? (
            // The account's WebDAV sync has its own endpoint; the account PUT cannot write it.
            <WebdavSyncPanel />
          ) : (
            <div className="flex flex-col" style={{ gap: "var(--ts-space-xl)" }}>
              <AccountFieldsForm
                service={service}
                kind={kind}
                expert={expert}
                busy={busy}
                onCancel={close}
                onSave={async (changes) => {
                  if (await services.save(service.id, { fields: changes }, true)) close();
                }}
                onRemove={async (clear) => {
                  if (await services.save(service.id, { fields: clear }, false)) close();
                }}
                onDisable={
                  kind === "key"
                    ? async () => {
                        if (await services.save(service.id, { accountDisabled: true }, false))
                          close();
                      }
                    : undefined
                }
              />
              {/* The nightly photo scan reads the connected library (forgejo#94). */}
              {service.id === "immich" ? <PhotoJourneyNightlyScanCard /> : null}
            </div>
          )
        }
      />
    );
  };

  const confirmConsent = async (): Promise<void> => {
    if (!consentFor) return;
    const failure = await services.setConsent(consentFor, true);
    if (failure) {
      setConsentError(failure);
      return;
    }
    setConsentFor(null);
    setConsentError(null);
  };

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-xl)" }}>
      <p className="t-body" style={{ maxWidth: 720 }}>
        {t("externalServices:account.intro")}
      </p>
      {services.loadError ? (
        <p role="alert" className="t-caption" style={{ color: "var(--ts-bad)" }}>
          {services.loadError}
        </p>
      ) : null}

      {connections.length > 0 ? (
        <Section
          id="connections"
          title={t("externalServices:account.sections.connections")}
          hint={t("externalServices:account.hints.connections")}
        >
          {connections.map((service) => rowFor(service, "connection"))}
        </Section>
      ) : null}

      {ownKeys.length > 0 ? (
        <Section
          id="ownKeys"
          title={t("externalServices:account.sections.ownKeys")}
          hint={t("externalServices:account.hints.ownKeys")}
        >
          {ownKeys.map((service) => rowFor(service, "key"))}
        </Section>
      ) : null}

      {data.aiConsents.length > 0 ? (
        <Section
          id="ai"
          title={t("externalServices:account.sections.ai")}
          hint={t("externalServices:account.hints.ai")}
        >
          {data.aiConsents.map((consent) => {
            const consented = consent.consentedAt !== null;
            return (
              <AccountRow
                key={consent.id}
                id={consent.id}
                recommended={null}
                status={consented ? "consented" : "notConsented"}
                detail={t(
                  consented
                    ? "externalServices:account.detail.consented"
                    : "externalServices:account.detail.notConsented",
                  { name: serviceName(t, consent.id), destination: consent.destination }
                )}
                feedback={services.feedback[consent.id] ?? null}
                busy={services.isBusy(consent.id)}
                actionLabel={t(
                  consented
                    ? "externalServices:account.action.withdraw"
                    : "externalServices:account.action.consent"
                )}
                onInfo={() => setInfoId(consent.id)}
                onAction={() => {
                  if (consented) void services.setConsent(consent, false);
                  else setConsentFor(consent);
                }}
              />
            );
          })}
        </Section>
      ) : null}

      <InstanceProvided services={data.instanceProvided} />

      {info ? (
        <ServiceInfoDialog
          serviceId={info.id}
          level="instanceAndAccount"
          recommended={info.recommended}
          scope="account"
          onClose={() => setInfoId(null)}
        />
      ) : null}
      {consentFor ? (
        <AccountConsentDialog
          name={serviceName(t, consentFor.id)}
          busy={services.isBusy(consentFor.id)}
          error={consentError}
          onConfirm={() => void confirmConsent()}
          onClose={() => {
            setConsentFor(null);
            setConsentError(null);
          }}
        />
      ) : null}
    </div>
  );
}
