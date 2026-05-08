import { useTranslation } from "../../hooks/useTranslation";
import { Fr24ImportTile } from "../import/Fr24ImportTile";
import { GenericCsvImportTile } from "../import/GenericCsvImportTile";
import { RoundTripImportTile } from "../import/RoundTripImportTile";

export default function ImportSection(): JSX.Element {
  const { t } = useTranslation();
  return (
    <section className="settings-section">
      <h2>{t("settings:import.title")}</h2>
      <p className="settings-description">{t("settings:import.description")}</p>
      <div className="import-tiles">
        <Fr24ImportTile />
        <GenericCsvImportTile />
        <RoundTripImportTile />
      </div>
    </section>
  );
}
