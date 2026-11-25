import type { JSX } from "react";
import Button from "../ui/Button";
import Dialog from "../ui/Dialog";
import { useTranslation } from "../../hooks/useTranslation";
import type { ServiceDisclosure, UseConfirmation } from "../../lib/api/serviceUse";

/**
 * The confirmation in front of every outbound use that carries the account's
 * own data (owner, 2026-11-25): it names the service, where it runs (host,
 * provider, cloud or LAN) and exactly what would be sent. Nothing is sent
 * until one of the two allow buttons is pressed; "Abbrechen" and closing the
 * dialog send nothing.
 */
export default function ServiceUseConfirmDialog({
  disclosure,
  onDecide,
}: {
  disclosure: ServiceDisclosure;
  onDecide: (confirmation: UseConfirmation | null) => void;
}): JSX.Element {
  const { t } = useTranslation(["externalServices"]);
  const target = `${disclosure.provider}@${disclosure.host.toLowerCase()}`;
  const decide = (mode: UseConfirmation["mode"]) => onDecide({ mode, target });
  const rows: Array<[string, string]> = [
    [
      t("externalServices:useConsent.service"),
      t(`externalServices:useConsent.services.${disclosure.serviceId}`),
    ],
    [t("externalServices:useConsent.host"), disclosure.host],
    [t("externalServices:useConsent.provider"), disclosure.provider],
    [
      t("externalServices:useConsent.location"),
      t(`externalServices:useConsent.locations.${disclosure.location}`),
    ],
    [
      t("externalServices:useConsent.fields"),
      disclosure.fields.map((f) => t(`externalServices:useConsent.fieldNames.${f}`)).join(", "),
    ],
    [t("externalServices:useConsent.points"), String(disclosure.pointCount)],
  ];
  if (disclosure.privacyZonesApplied !== null) {
    rows.push([
      t("externalServices:useConsent.zones"),
      disclosure.privacyZonesApplied
        ? t("externalServices:useConsent.zonesApplied")
        : t("externalServices:useConsent.zonesNone"),
    ]);
  }
  return (
    <Dialog
      open
      onClose={() => onDecide(null)}
      title={t("externalServices:useConsent.title")}
      maxWidth={560}
      dismissLabel={t("externalServices:useConsent.cancel")}
      closeLabel={t("externalServices:actions.close")}
      action={
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => decide("once")} data-testid="use-consent-once">
            {t("externalServices:useConsent.once")}
          </Button>
          <Button
            variant="primary"
            onClick={() => decide("always")}
            data-testid="use-consent-always"
          >
            {t("externalServices:useConsent.always")}
          </Button>
        </div>
      }
    >
      <p className="t-body">{t("externalServices:useConsent.intro")}</p>
      <dl
        className="grid gap-2"
        style={{ gridTemplateColumns: "max-content 1fr" }}
        data-testid="use-consent-facts"
      >
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="t-caption">{k}</dt>
            <dd className="t-body">{v}</dd>
          </div>
        ))}
      </dl>
      {disclosure.location === "cloud" && (
        <p className="t-caption" role="note">
          {t("externalServices:useConsent.cloudNote")}
        </p>
      )}
    </Dialog>
  );
}
