import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { RouteNotice } from "../../ui/RouteNotice";
import type { DomainKey } from "../../../shared/domains";

const TAB_ICON: Record<DomainKey, string> = {
  flight: "✈",
  cruise: "⚓",
  poi: "📍",
  lodging: "🏨",
};

/**
 * Shown when the reader opens a dashboard tab — or, since forgejo#88 finding 6,
 * a ROUTE — whose domain is disabled. Domain-gating rule: a disabled domain
 * must not render any of its content, so this card is the only thing there is.
 *
 * The card itself is `ui/RouteNotice`, shared with the admin notice: the same
 * card was being drawn from two places, and the second one was written because
 * the first was not reusable rather than because it should look different.
 *
 * `domain` is a `DomainKey`, not `Exclude<DashboardTab, "all">` — the
 * "Touren" tab has no domain to disable (types/dashboard.ts), so it never
 * renders this notice, and this type must not claim it could.
 */
export function DomainDisabledNotice({ domain }: { domain: DomainKey }): JSX.Element {
  const { t } = useTranslation(["dashboard"]);

  return (
    <RouteNotice
      glyph={TAB_ICON[domain]}
      title={t("dashboard:tabDisabled.title")}
      body={t("dashboard:tabDisabled.body", { domain: t(`dashboard:tabStrip.tabs.${domain}`) })}
      action={{ to: "/settings#modules", label: t("dashboard:tabDisabled.goToSettings") }}
    />
  );
}
