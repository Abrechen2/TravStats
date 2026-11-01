import { useState } from "react";
import { Button, Card, Input, Pill } from "../../../components/ui";
import { useTranslation } from "../../../hooks/useTranslation";
import type { PlanView, PlanOperation, VariantComparison } from "../../../lib/api/travplan";
import { formatMoney } from "../planContext";
import { PlanActions, PlanCardHead, PlanGrow, PlanRow } from "../planLayout";
import { PlanCheck } from "../PlanParts";

const MAX_VARIANTS = 3;

/** An unknown figure is said to be unknown: a 0 would read as a free ferry or an empty tank. */
const money = (m: { amount: number; currency: string } | null, unknown: string) =>
  m ? formatMoney(m.amount, m.currency) : unknown;

/**
 * Variants (board 8, right): the active route beside up to three alternatives, compared on what the
 * plan can actually know. "Aktivieren" swaps the active route and the alternative; nothing is lost.
 */
export function VariantsPanel({
  plan,
  busy,
  mutate,
}: {
  plan: PlanView;
  busy: boolean;
  mutate: (op: PlanOperation) => Promise<boolean>;
}) {
  const { t } = useTranslation("travplan"),
    [name, setName] = useState(""),
    [copy, setCopy] = useState(true),
    rows = plan.variants ?? [],
    alternatives = rows.filter((r) => !r.active).length;
  const unknown = t("route.variants.unknown");
  const km = (v: VariantComparison) =>
    v.driveKm === null ? unknown : `${Math.round(v.driveKm)} km`;
  return (
    <Card>
      <PlanCardHead title={t("route.variants.title")} />
      <p className="t-caption">{t("route.variants.intro")}</p>
      {rows.map((v) => (
        <PlanRow key={v.id ?? "active"}>
          <PlanGrow>
            <h3 className="t-card-title">
              {v.name}{" "}
              {v.active && <Pill color="var(--ts-good)">{t("route.variants.active")}</Pill>}
            </h3>
            <dl className="t-body grid grid-cols-2" style={{ gap: "var(--ts-space-sm)" }}>
              <dt>{t("route.variants.km")}</dt>
              <dd>{km(v)}</dd>
              <dt>{t("route.variants.driveDays")}</dt>
              <dd>{v.driveDays}</dd>
              <dt>{t("route.variants.destinationNights")}</dt>
              <dd>{v.destinationNights}</dd>
              <dt>{t("route.variants.stageCosts")}</dt>
              <dd>
                {money(v.stageCosts, unknown)}
                {v.unknownCosts > 0 &&
                  ` · ${t("route.variants.unknownCosts", { count: v.unknownCosts })}`}
              </dd>
              <dt>{t("route.variants.fuel")}</dt>
              <dd>{money(v.fuel, unknown)}</dd>
            </dl>
            {v.obsoleteStageIds.length > 0 && (
              <p className="t-caption">
                {t("route.variants.obsolete", { count: v.obsoleteStageIds.length })}
              </p>
            )}
          </PlanGrow>
          {!v.active && v.id && (
            <PlanActions>
              <Button
                disabled={busy}
                onClick={() => void mutate({ type: "activate_variant", variantId: v.id! })}
              >
                {t("route.variants.activate")}
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => void mutate({ type: "remove_variant", variantId: v.id! })}
              >
                {t("delete")}
              </Button>
            </PlanActions>
          )}
        </PlanRow>
      ))}
      {alternatives < MAX_VARIANTS ? (
        <PlanActions>
          <Input
            aria-label={t("route.variants.name")}
            placeholder={t("route.variants.name")}
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
          />
          <PlanCheck checked={copy} onChange={setCopy}>
            {t("route.variants.copy")}
          </PlanCheck>
          <Button
            disabled={busy || !name.trim()}
            onClick={() =>
              void mutate({ type: "create_variant", name: name.trim(), copyActive: copy }).then(
                (ok) => ok && setName("")
              )
            }
          >
            {t("route.variants.create")}
          </Button>
        </PlanActions>
      ) : (
        <p className="t-caption">{t("route.variants.limit")}</p>
      )}
    </Card>
  );
}
