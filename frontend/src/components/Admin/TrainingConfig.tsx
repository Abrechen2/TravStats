import InlineHelp from "../Help/InlineHelp";
import { useTranslation } from "../../hooks/useTranslation";

export interface TrainingConfigData {
  trainingModelOutputDir: string | null;
  trainingEmailModelName: string | null;
  trainingVisionModelName: string | null;
  currentTrainingModelOutputDir: string;
  currentTrainingEmailModelName: string;
  currentTrainingVisionModelName: string;
  envTrainingModelOutputDir: string;
  envTrainingEmailModelName: string;
  envTrainingVisionModelName: string;
}

interface TrainingConfigProps {
  trainingConfig: TrainingConfigData;
  savingTrainingConfig: boolean;
  onSave: () => void;
  onTrainingConfigChange: (config: TrainingConfigData) => void;
}

export default function TrainingConfig({
  trainingConfig,
  savingTrainingConfig,
  onSave,
  onTrainingConfigChange,
}: TrainingConfigProps): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            {t("admin:trainingConfig.title")}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {t("admin:trainingConfig.description")}
          </p>
        </div>
        <button
          onClick={onSave}
          disabled={savingTrainingConfig}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-lg transition font-medium"
        >
          {savingTrainingConfig ? t("admin:trainingConfig.saving") : t("admin:saveConfiguration")}
        </button>
      </div>

      <InlineHelp
        title={t("admin:trainingConfig.helpTitle")}
        category="expert"
        content={
          <div className="space-y-3">
            <p>{t("admin:trainingConfig.helpContent.description")}</p>
            <div>
              <p className="font-semibold mb-1">
                {t("admin:trainingConfig.helpContent.priorityTitle")}
              </p>
              <ol className="list-decimal list-inside space-y-1 ml-2 text-sm">
                <li>{t("admin:trainingConfig.helpContent.priority1")}</li>
                <li>{t("admin:trainingConfig.helpContent.priority2")}</li>
                <li>{t("admin:trainingConfig.helpContent.priority3")}</li>
              </ol>
            </div>
            <p
              className="text-sm text-gray-600 dark:text-gray-400"
              dangerouslySetInnerHTML={{ __html: t("admin:trainingConfig.helpContent.note") }}
            />
          </div>
        }
      />

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          {t("admin:trainingConfig.modelStorage.title")}
        </h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t("admin:trainingConfig.modelStorage.label")}
            </label>
            <input
              type="text"
              value={trainingConfig.trainingModelOutputDir || ""}
              onChange={(e) =>
                onTrainingConfigChange({
                  ...trainingConfig,
                  trainingModelOutputDir: e.target.value,
                })
              }
              placeholder={trainingConfig.envTrainingModelOutputDir || "./data/training/models"}
              className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t("admin:trainingConfig.modelStorage.currentlyUsed")}{" "}
              <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">
                {trainingConfig.currentTrainingModelOutputDir}
              </code>
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t("admin:trainingConfig.modelStorage.envFallback")}{" "}
              <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">
                {trainingConfig.envTrainingModelOutputDir}
              </code>
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          {t("admin:trainingConfig.modelNames.title")}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t("admin:trainingConfig.modelNames.emailModel")}
            </label>
            <input
              type="text"
              value={trainingConfig.trainingEmailModelName || ""}
              onChange={(e) =>
                onTrainingConfigChange({
                  ...trainingConfig,
                  trainingEmailModelName: e.target.value,
                })
              }
              placeholder={trainingConfig.envTrainingEmailModelName || "travstats-email-custom"}
              className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t("admin:trainingConfig.modelNames.currently")}{" "}
              <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">
                {trainingConfig.currentTrainingEmailModelName}
              </code>
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t("admin:trainingConfig.modelNames.env")}{" "}
              <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">
                {trainingConfig.envTrainingEmailModelName}
              </code>
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t("admin:trainingConfig.modelNames.visionModel")}
            </label>
            <input
              type="text"
              value={trainingConfig.trainingVisionModelName || ""}
              onChange={(e) =>
                onTrainingConfigChange({
                  ...trainingConfig,
                  trainingVisionModelName: e.target.value,
                })
              }
              placeholder={trainingConfig.envTrainingVisionModelName || "travstats-vision-custom"}
              className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t("admin:trainingConfig.modelNames.currently")}{" "}
              <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">
                {trainingConfig.currentTrainingVisionModelName}
              </code>
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t("admin:trainingConfig.modelNames.env")}{" "}
              <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">
                {trainingConfig.envTrainingVisionModelName}
              </code>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
