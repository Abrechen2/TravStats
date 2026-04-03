import { AmberToggle, SectionCard, SectionTitle } from "./SettingsShared";
import InlineHelp from "../Help/InlineHelp";
import { useTranslation } from "../../hooks/useTranslation";

interface DeveloperSectionProps {
  developerModeEnabled: boolean;
  loadingDeveloperMode: boolean;
  onToggleDeveloperMode: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export default function DeveloperSection({
  developerModeEnabled,
  loadingDeveloperMode,
  onToggleDeveloperMode,
}: DeveloperSectionProps): JSX.Element {
  const { t } = useTranslation(["settings"]);

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:developer.title")}
        description={t("settings:developer.description")}
      />
      <InlineHelp
        title={t("settings:developer.help.title")}
        category="expert"
        content={
          <div className="space-y-3">
            <p>{t("settings:developer.help.description")}</p>
            <div>
              <p className="font-semibold mb-1">{t("settings:developer.help.features.title")}</p>
              <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
                <li>{t("settings:developer.help.features.items.trainingPage")}</li>
                <li>{t("settings:developer.help.features.items.uploadAnnotation")}</li>
                <li>{t("settings:developer.help.features.items.loraTraining")}</li>
                <li>{t("settings:developer.help.features.items.parserAccuracy")}</li>
              </ul>
            </div>
            <div>
              <p className="font-semibold mb-1">
                {t("settings:developer.help.requirements.title")}
              </p>
              <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
                <li>{t("settings:developer.help.requirements.items.ollama")}</li>
                <li>{t("settings:developer.help.requirements.items.hardware")}</li>
                <li>{t("settings:developer.help.requirements.items.trainingData")}</li>
              </ul>
            </div>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              <strong>{t("settings:developer.help.noteLabel")}:</strong>{" "}
              {t("settings:developer.help.note")}
            </p>
          </div>
        }
      />
      <div className="space-y-4">
        <div
          className="flex items-center justify-between p-4 rounded-lg"
          style={{ background: "var(--bg-elevated)" }}
        >
          <div className="flex-1">
            <h3 className="font-semibold mb-1" style={{ color: "var(--text-primary)" }}>
              {t("settings:developer.modeTitle")}
            </h3>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {t("settings:developer.modeDescription")}
            </p>
          </div>
          <AmberToggle
            checked={developerModeEnabled}
            onChange={onToggleDeveloperMode}
            disabled={loadingDeveloperMode}
          />
        </div>
      </div>
    </SectionCard>
  );
}
