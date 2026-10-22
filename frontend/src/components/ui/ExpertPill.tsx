import type { JSX } from "react";
import Pill from "./Pill";
import { token } from "./tokens";
import { useTranslation } from "../../hooks/useTranslation";

/**
 * The blue "Experte" pill (the `info` token) beside a section or a row that only the expert view
 * draws (forgejo issue 321 prototype). Once the expert view shows a setting, this is
 * what tells it apart from the ones every account sees — so a reader who
 * switched levels knows what they would lose by switching back.
 */
export function ExpertPill(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  return (
    <span data-expert-pill="" className="inline-flex">
      <Pill color={token("info")}>{t("settings:level.expert")}</Pill>
    </span>
  );
}
