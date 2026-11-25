import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import Toggletip from "../ui/Toggletip";
import { countingRuleOf, RULE_HOME } from "../../lib/comparison/countingRules";

/** "Wie gezählt?" beside a metric: the counting rule in words, and the module that owns it. */
export default function MetricHelp({
  metric,
  name,
}: {
  metric: string;
  name: string;
}): JSX.Element | null {
  const { t } = useTranslation(["comparison"]);
  const rule = countingRuleOf(metric);
  if (!rule) return null;
  return (
    <Toggletip
      subject={name}
      content={String(t(`counting.${rule}`))}
      expandedContent={<code>{String(t("counting.where", { home: RULE_HOME[rule] }))}</code>}
      data-testid={`how-counted-${metric}`}
    />
  );
}
