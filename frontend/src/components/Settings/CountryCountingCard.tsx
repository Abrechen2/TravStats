import { useTranslation } from "../../hooks/useTranslation";
import { SectionCard, SectionTitle } from "./SettingsShared";

/** Country counts use two explicit sets; old stored thresholds are retained for compatibility. */
export default function CountryCountingCard(): JSX.Element {
  const { t } = useTranslation(["settings", "passport"]);
  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:countryCounting.title")}
        description={t("passport:countingRule")}
      />
    </SectionCard>
  );
}
