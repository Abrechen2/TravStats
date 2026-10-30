import type { JSX, ReactNode } from "react";
import Pill from "../ui/Pill";
import { token } from "../ui/tokens";
import { useTranslation } from "../../hooks/useTranslation";
import type { ServiceRecommended } from "../../lib/api/externalServices";
import { initialsOf } from "./serviceStatus";

/** The monogram tile at the left of every row. */
export function Monogram({ name }: { name: string }): JSX.Element {
  return (
    <div
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center"
      style={{
        width: 40,
        height: 40,
        borderRadius: "var(--ts-radius-tile)",
        background: "var(--ts-surface2)",
        border: "1px solid var(--ts-border)",
        fontFamily: "var(--ts-font-mono)",
        fontSize: 13,
        color: "var(--ts-muted)",
      }}
    >
      {initialsOf(name)}
    </div>
  );
}

/** "Empfohlen · gratis" / "Empfohlen · Gratis-Guthaben". */
export function RecommendedTag({
  recommended,
}: {
  recommended: ServiceRecommended;
}): JSX.Element | null {
  const { t } = useTranslation(["externalServices"]);
  if (!recommended) return null;
  return <Pill color={token("accent")}>{t(`externalServices:recommended.${recommended}`)}</Pill>;
}

/** Name line: name, who sets it up, recommended tag, extra tags. */
export function ServiceTitle({
  name,
  levelLabel,
  recommended,
  extra,
}: {
  name: string;
  levelLabel?: string;
  recommended: ServiceRecommended;
  extra?: ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
      <span style={{ fontSize: 16, fontWeight: 700, color: "var(--ts-text-bright)" }}>{name}</span>
      {levelLabel ? <span className="t-caption">{levelLabel}</span> : null}
      <RecommendedTag recommended={recommended} />
      {extra}
    </div>
  );
}
