import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import Pill from "../Pill";
import { token } from "../tokens";

export type RowScope = "allAccounts" | "device";

/**
 * B8, the row half: "Alle Konten" (the server's, one admin decides) and "Nur
 * dieses Gerät". A row of the account's own needs no mark — the page head says
 * "Gilt für dein Konto" once (see `ScopeNote`).
 */
export function ScopeMark({ scope }: { scope: RowScope }): JSX.Element {
  const { t } = useTranslation(["settings"]);
  return (
    <span data-scope={scope} className="inline-flex">
      <Pill color={token(scope === "allAccounts" ? "warn" : "info")}>
        {t(`settings:blocks.scope.${scope}`)}
      </Pill>
    </span>
  );
}

/** B8, the page half: who a whole page applies to. */
export function ScopeNote({ kind }: { kind: "account" | "mixed" | "instance" }): JSX.Element {
  const { t } = useTranslation(["settings"]);
  return (
    <p className="t-caption" data-page-scope={kind} style={{ margin: 0 }}>
      {t(`settings:area.scope.${kind}`)}
    </p>
  );
}
