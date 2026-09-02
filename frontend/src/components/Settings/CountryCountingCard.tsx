import { FieldLabel, SectionCard, SectionTitle } from "./SettingsShared";
import { useTranslation } from "../../hooks/useTranslation";
import { useSettingsStore } from "../../store/settingsStore";
import { COUNTRY_TIER_CHOICES, DEFAULT_COUNTRY_TIER, type CountryTier } from "../../types/passport";

/**
 * "Ein Land zählt ab …" — the user's own answer to the one question the data
 * cannot settle (spec §3.2).
 *
 * Three things this card is careful about, each because getting it wrong would
 * be worse than not offering the choice at all:
 *
 * 1. **It says what CHANGES, in plain language, at the point of choosing.**
 *    This moves a number the user has already seen, and spec §5 is blunt about
 *    what that reads as: "a number that changes without explanation reads as
 *    data loss". The effect sentence sits under the control, not behind a
 *    tooltip.
 * 2. **It states that the LIST does not move.** The one thing a threshold could
 *    plausibly be feared to do is hide a country, and it never does — every
 *    country with evidence stays in the passport at every setting, greyed rather
 *    than gone. Being able to see a wrongly-classed country is how the Bucharest
 *    hotel was found, and a user who thought the setting hid rows would not look.
 * 3. **"Follow the instance" is an option, and it NAMES the default.** Not
 *    choosing is a real state that keeps tracking the admin, so it is offered as
 *    a value rather than implied by leaving the control alone — and the word in
 *    the brackets comes from the server, because guessing it would say the wrong
 *    one on any instance whose admin changed it.
 *
 * There is deliberately no hours-based option. §2 refuses duration thresholds on
 * principle and has the measurement: six hours and twelve hours returned the
 * same set of countries, so a dial would promise precision the data lacks.
 */

/** The sentinel the `<select>` uses for "no choice of my own". A select cannot
 *  carry a null value, and an empty string would be indistinguishable from an
 *  unset control. */
const FOLLOW_INSTANCE = "__instance__";

export default function CountryCountingCard(): JSX.Element {
  const { t } = useTranslation(["settings", "passport"]);
  const countryThreshold = useSettingsStore((s) => s.countryThreshold);
  const instanceCountryThreshold = useSettingsStore((s) => s.instanceCountryThreshold);
  const setCountryThreshold = useSettingsStore((s) => s.setCountryThreshold);

  // Null while /settings has not answered yet. Falling back to the module
  // default only names the fallback in the label — it never decides anything,
  // because the number itself is computed on the server.
  const instanceTier: CountryTier = instanceCountryThreshold ?? DEFAULT_COUNTRY_TIER;
  const effective: CountryTier = countryThreshold ?? instanceTier;

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:countryCounting.title")}
        description={t("settings:countryCounting.description")}
      />
      <div>
        <FieldLabel htmlFor="country-threshold" help={t("settings:countryCounting.help")}>
          {t("settings:countryCounting.label")}
        </FieldLabel>
        <select
          id="country-threshold"
          value={countryThreshold ?? FOLLOW_INSTANCE}
          onChange={(e) =>
            setCountryThreshold(
              e.target.value === FOLLOW_INSTANCE ? null : (e.target.value as CountryTier)
            )
          }
          className="input"
        >
          <option value={FOLLOW_INSTANCE}>
            {t("settings:countryCounting.useInstanceDefault", {
              tier: t(`passport:thresholdChoice.options.${instanceTier}`),
            })}
          </option>
          {COUNTRY_TIER_CHOICES.map((tier) => (
            <option key={tier} value={tier}>
              {t(`passport:thresholdChoice.options.${tier}`)}
            </option>
          ))}
        </select>
        {/* What this choice does to the number, said before it happens. */}
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {t(`passport:thresholdChoice.effect.${effective}`)}
        </p>
        {/* And what it does NOT do — the list. */}
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {t("passport:thresholdChoice.listUnchanged")}
        </p>
      </div>
    </SectionCard>
  );
}
