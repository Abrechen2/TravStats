import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { BETA_FEATURES, BETA_FEATURE_KEYS } from "../../config/betaFeatures";

/**
 * What the beta switch actually turns on, in this build.
 *
 * An admin flipping a switch labelled "show beta features" was told what the
 * switch MEANS and never what it DOES — so the only way to find out was to
 * turn it on and go looking. That is a poor trade for something the help text
 * itself warns can change or disappear.
 *
 * DERIVED, NOT WRITTEN DOWN TWICE. The rows come from `BETA_FEATURE_KEYS`, the
 * same registry every gate reads, so the list cannot drift from reality: a
 * feature added to the registry appears here without anyone remembering to add
 * it, and one that is un-gated disappears the moment its entry is deleted. A
 * hand-maintained list beside the switch would be accurate on the day it was
 * written and misleading a release later — and a wrong list is worse than none,
 * because it is trusted.
 *
 * The one thing that cannot be derived is the German copy: the registry's own
 * `why` and `returnsWhen` are English developer prose aimed at whoever touches
 * the gate next, not at an admin. So each key carries a translated name and a
 * plain sentence, and `BetaFeatureList.copy.test.tsx` fails when a registry key
 * has none — which is what keeps "always current" true rather than aspirational.
 */
export default function BetaFeatureList(): JSX.Element {
  const { t } = useTranslation(["admin"]);

  if (BETA_FEATURE_KEYS.length === 0) {
    return (
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        {t("admin:instance.fields.betaFeatures.listEmpty")}
      </p>
    );
  }

  return (
    <div className="mt-2">
      <p className="mb-1 text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        {t("admin:instance.fields.betaFeatures.listTitle")}
      </p>
      <ul className="flex flex-col gap-1.5">
        {BETA_FEATURE_KEYS.map((key) => (
          <li key={key} className="text-xs" style={{ color: "var(--text-muted)" }}>
            <span className="font-medium" style={{ color: "var(--text-primary)" }}>
              {t(`admin:instance.fields.betaFeatures.features.${key}.name`)}
            </span>
            <span
              className="ml-1.5 rounded-full px-1.5 py-0.5"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
            >
              {t(`admin:instance.fields.betaFeatures.reason.${BETA_FEATURES[key].reason}`)}
            </span>
            <span className="block">
              {t(`admin:instance.fields.betaFeatures.features.${key}.what`)}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
        {t("admin:instance.fields.betaFeatures.listNote")}
      </p>
    </div>
  );
}
