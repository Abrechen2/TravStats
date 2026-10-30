import { useState, type JSX } from "react";
import { Card } from "../ui/Card";
import Pill from "../ui/Pill";
import { token } from "../ui/tokens";
import { Icon } from "../ui/Icon";
import { useTranslation } from "../../hooks/useTranslation";
import type { InstanceProvidedService } from "../../lib/api/externalServices";
import { serviceCopy, serviceName } from "./serviceText";

/** "Von der Instanz bereitgestellt": collapsed, read-only; only an admin changes it. */
export default function InstanceProvided({
  services,
}: {
  services: readonly InstanceProvidedService[];
}): JSX.Element | null {
  const { t } = useTranslation(["externalServices"]);
  const [open, setOpen] = useState(false);
  if (services.length === 0) return null;
  const active = services.filter((s) => s.enabled).length;
  return (
    <Card flush data-testid="instance-provided">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between"
        style={{
          gap: "var(--ts-space-lg)",
          padding: "var(--ts-space-lg)",
          minHeight: "var(--ts-size-touch-min)",
          textAlign: "left",
          color: "var(--ts-text)",
        }}
      >
        <span className="flex flex-col">
          <span className="t-card-title">{t("externalServices:instance.title")}</span>
          <span className="t-caption">
            {t("externalServices:instance.summary", { count: services.length, active })}
          </span>
        </span>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={20} />
      </button>
      {open ? (
        <div style={{ padding: "0 var(--ts-space-lg) var(--ts-space-lg)" }}>
          {services.map((service) => (
            <div
              key={service.id}
              className="flex flex-wrap items-center justify-between"
              style={{ gap: "var(--ts-space-md)", padding: "var(--ts-space-sm) 0" }}
            >
              <span>
                <strong>{serviceName(t, service.id)}</strong>{" "}
                <span className="t-caption">– {serviceCopy(t, service.id, "purpose")}</span>
              </span>
              <Pill color={token(service.enabled ? "status-flown" : "status-historical")}>
                {t(
                  service.enabled ? "externalServices:status.active" : "externalServices:status.off"
                )}
              </Pill>
            </div>
          ))}
          <p className="t-caption">{t("externalServices:instance.note")}</p>
        </div>
      ) : null}
    </Card>
  );
}
