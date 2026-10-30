import type { JSX } from "react";
import Dialog from "../ui/Dialog";
import { useTranslation } from "../../hooks/useTranslation";
import type { ServiceLevel, ServiceRecommended } from "../../lib/api/externalServices";
import { serviceCopy, serviceName } from "./serviceText";

/**
 * The info panel of one service: why TravStats needs it, the recommendation,
 * cost, quota, what leaves the server, who sets it up and where to get a key.
 * Rows without copy are left out rather than shown empty.
 */
export default function ServiceInfoDialog({
  serviceId,
  level,
  recommended,
  scope,
  getKeyUrl = null,
  alwaysOn = false,
  onClose,
}: {
  serviceId: string;
  level: ServiceLevel;
  recommended: ServiceRecommended;
  /** The account view omits the rows only an admin acts on. */
  scope: "admin" | "account";
  /** From the catalogue; used when the copy carries no link of its own. */
  getKeyUrl?: string | null;
  /** A service without an off switch explains why. */
  alwaysOn?: boolean;
  onClose: () => void;
}): JSX.Element {
  const { t } = useTranslation(["externalServices"]);
  const name = serviceName(t, serviceId);
  const why: [string, string] = [t("externalServices:info.why"), serviceCopy(t, serviceId, "why")];
  const cost: [string, string] = [
    t("externalServices:info.cost"),
    serviceCopy(t, serviceId, "cost"),
  ];
  const dataOut: [string, string] = [
    t("externalServices:info.dataOut"),
    serviceCopy(t, serviceId, "dataOut"),
  ];
  const rows: Array<[string, string]> =
    scope === "admin"
      ? [
          why,
          [
            t("externalServices:info.recommendation"),
            t(`externalServices:info.recommendationText.${recommended ?? "none"}`),
          ],
          cost,
          [t("externalServices:info.quota"), serviceCopy(t, serviceId, "quota")],
          dataOut,
          [t("externalServices:info.who"), t(`externalServices:info.whoText.${level}`)],
          [
            t("externalServices:info.alwaysOn"),
            alwaysOn ? serviceCopy(t, serviceId, "alwaysOnWhy") : "",
          ],
        ]
      : [
          why,
          cost,
          dataOut,
          [t("externalServices:info.source"), serviceCopy(t, serviceId, "order")],
        ];
  const url = serviceCopy(t, serviceId, "getKeyUrl") || getKeyUrl || "";
  const linkLabel = serviceCopy(t, serviceId, "getKeyLabel");
  return (
    <Dialog
      open
      onClose={onClose}
      title={name}
      maxWidth={520}
      dismissLabel={t("externalServices:actions.close")}
      closeLabel={t("externalServices:actions.close")}
    >
      <div className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
        {scope === "admin" ? (
          <p className="t-caption">{t(`externalServices:info.setup.${level}`)}</p>
        ) : null}
        {rows
          .filter(([, value]) => value)
          .map(([key, value]) => (
            <div key={key}>
              <div className="t-caption">{key}</div>
              <div>{value}</div>
            </div>
          ))}
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--ts-accent)" }}
          >
            {linkLabel || url} ↗
          </a>
        ) : null}
      </div>
    </Dialog>
  );
}
