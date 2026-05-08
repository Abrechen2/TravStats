import { useTranslation } from "../../hooks/useTranslation";
import { SectionCard, SectionTitle } from "./SettingsShared";
import { Fr24ImportTile } from "../import/Fr24ImportTile";
import { GenericCsvImportTile } from "../import/GenericCsvImportTile";
import { RoundTripImportTile } from "../import/RoundTripImportTile";

export default function ImportSection(): JSX.Element {
  const { t } = useTranslation();
  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:import.title")}
        description={t("settings:import.description")}
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Fr24ImportTile />
        <GenericCsvImportTile />
        <RoundTripImportTile />
      </div>
    </SectionCard>
  );
}
