import { SectionCard, SectionTitle } from "./SettingsShared";
import HelpIcon from "../Help/HelpIcon";
import { Segmented } from "../ui/Segmented";
import { useTranslation } from "../../hooks/useTranslation";
import { useSettingsStore } from "../../store/settingsStore";
import {
  DEFAULT_COUNTRY_TIER,
  countryTierChoicesFor,
  type CountryTier,
} from "../../types/passport";

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
 *
 * ## And one option is not always offered
 *
 * `transited` — a border crossed on the ground — only exists once a location
 * history has been swept, and until then choosing it produces exactly the same
 * number as `visited`. §3.4c: *"the UI must not offer it as a filter that
 * always returns nothing"*. A control with two settings that do the same thing
 * does not read as an empty set; it reads as broken. So it appears only for an
 * account that has track evidence — or one that already chose it, because a
 * choice whose current value is not drawn shows nothing selected at all.
 *
 * Round 4 draws the choice as pills (short tier names); the long option text
 * stays each pill's spoken name, and the effect sentence stays underneath.
 */

/** The sentinel for "no choice of my own". A radio value cannot be null, and an
 *  empty string would be indistinguishable from an unset control. */
const FOLLOW_INSTANCE = "__instance__";

export default function CountryCountingCard(): JSX.Element {
  const { t } = useTranslation(["settings", "passport"]);
  const countryThreshold = useSettingsStore((s) => s.countryThreshold);
  const instanceCountryThreshold = useSettingsStore((s) => s.instanceCountryThreshold);
  const setCountryThreshold = useSettingsStore((s) => s.setCountryThreshold);
  // `null` = /settings has not answered. Read as "no tracks": drawing an option
  // that cannot work is worse than withholding one for a moment.
  const hasCountryTracks = useSettingsStore((s) => s.hasCountryTracks) === true;

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
      <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
        <span
          className="inline-flex items-center gap-1.5"
          style={{ fontSize: 14, fontWeight: 600, color: "var(--ts-text-bright)" }}
        >
          {t("settings:countryCounting.label")}
          <HelpIcon content={t("settings:countryCounting.help")} position="top" />
        </span>
        <Segmented
          label={t("settings:countryCounting.label")}
          value={countryThreshold ?? FOLLOW_INSTANCE}
          onChange={(value) =>
            setCountryThreshold(value === FOLLOW_INSTANCE ? null : (value as CountryTier))
          }
          options={[
            {
              value: FOLLOW_INSTANCE,
              label: t("settings:countryCounting.instanceShort", {
                tier: t(`passport:thresholdChoice.short.${instanceTier}`),
              }),
              name: t("settings:countryCounting.useInstanceDefault", {
                tier: t(`passport:thresholdChoice.options.${instanceTier}`),
              }),
            },
            ...countryTierChoicesFor(hasCountryTracks, countryThreshold).map((tier) => ({
              value: tier,
              label: t(`passport:thresholdChoice.short.${tier}`),
              name: t(`passport:thresholdChoice.options.${tier}`),
            })),
          ]}
        />
        {/* What this choice does to the number, said before it happens —
            and what it does NOT do: the list. */}
        <p className="t-caption">{t(`passport:thresholdChoice.effect.${effective}`)}</p>
        <p className="t-caption">{t("passport:thresholdChoice.listUnchanged")}</p>
      </div>
    </SectionCard>
  );
}
