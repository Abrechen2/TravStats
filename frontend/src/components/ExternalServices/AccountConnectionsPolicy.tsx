import type { JSX } from "react";
import { Card } from "../ui/Card";
import { Switch } from "../ui/Field";
import { useTranslation } from "../../hooks/useTranslation";
import type { AdminConnectionPolicy, ConnectionId } from "../../lib/api/externalServices";
import type { RowFeedback } from "./AdminServiceRow";

/**
 * "Was Konten selbst verbinden dürfen": the four connections every account sets
 * up with its own credentials. The admin decides only whether that is allowed.
 */
export default function AccountConnectionsPolicy({
  policies,
  isBusy,
  feedback,
  onChange,
}: {
  policies: readonly AdminConnectionPolicy[];
  isBusy: (id: string) => boolean;
  feedback: Record<string, RowFeedback>;
  onChange: (id: ConnectionId, allowed: boolean) => void;
}): JSX.Element {
  const { t } = useTranslation(["externalServices"]);
  return (
    <section
      className="flex flex-col"
      style={{ gap: "var(--ts-space-md)" }}
      data-testid="connections-policy"
    >
      <div>
        <h2 className="t-card-title">{t("externalServices:connections.title")}</h2>
        <p className="t-caption">{t("externalServices:connections.hint")}</p>
      </div>
      <Card flush>
        {policies.map((policy, index) => {
          const note = feedback[`connection:${policy.id}`];
          return (
            <div
              key={policy.id}
              style={{
                padding: "var(--ts-space-md) var(--ts-space-lg)",
                borderTop: index === 0 ? undefined : "1px solid var(--ts-border)",
              }}
            >
              <Switch
                id={`policy-${policy.id}`}
                label={t(`externalServices:connections.${policy.id}.name`)}
                sub={`${t(`externalServices:connections.${policy.id}.purpose`)} · ${t(
                  "externalServices:connections.usage",
                  { count: policy.connectedAccounts }
                )}`}
                checked={policy.allowed}
                disabled={isBusy(`connection:${policy.id}`)}
                onChange={(next) => onChange(policy.id, next)}
              />
              {note ? (
                <p role="alert" className="t-caption" style={{ color: "var(--ts-bad)" }}>
                  {note.text}
                </p>
              ) : null}
            </div>
          );
        })}
      </Card>
    </section>
  );
}
