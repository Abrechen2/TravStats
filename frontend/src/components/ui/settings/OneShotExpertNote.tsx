import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { LinkButton } from "./notes";

/**
 * B7, the one-time state: an expert row opened by a link or a search hit while
 * the account is on Standard. The level is NOT changed; "Immer zeigen" is the
 * explicit way to change it.
 */
export function OneShotExpertNote({ onAlways }: { onAlways: () => void }): JSX.Element {
  const { t } = useTranslation(["settings"]);
  return (
    <p
      role="note"
      data-one-shot-expert=""
      className="t-caption flex flex-wrap items-center"
      style={{ gap: "var(--ts-space-sm)", margin: 0 }}
    >
      <span>{t("settings:blocks.oneShot")}</span>
      <LinkButton onClick={onAlways}>{t("settings:blocks.oneShotAlways")}</LinkButton>
    </p>
  );
}
